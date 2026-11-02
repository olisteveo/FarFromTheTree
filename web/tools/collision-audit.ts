// What can the leaf fly straight through? Compares what is drawn with what the sim treats as solid: it samples the
// real triangles in the scene around a list of sites and drops the leaf's collision test on each sample (and a little
// either side of it, in case the collider is inset). A sample nothing pushes back from is a surface you pass through.
//
// Runs in the page, because only the page has the meshes. From the dev server's console:
//   const a = await import("/tools/collision-audit.ts"); await a.run();  then a.report()
// Moving vehicles are left to tools/vehicle-solid-check.ts: they aren't where the camera last saw them.

const w = window as never as { fftt: any };

export interface Row { key: string; tested: number; through: number; solid: number; misses: number[][]; bbox: number[] }
export const rows = new Map<string, Row>();
export const hitsBy = new Map<string, number>();

function probe(x: number, y: number, z: number): string | null {
  const g = w.fftt.leaf;
  let what: string | null = null;
  const contact = g.contact, hitBy = g.hitBy, fail = g.fail;
  const keep = { x: g.pos.x, y: g.pos.y, z: g.pos.z, vx: g.vel.x, vy: g.vel.y, vz: g.vel.z, i: g.integrity, m: g.maxIntegrity, snag: g.lastSnag, hit: g.lastHit, st: g.state, ev: g.events.length, gr: g.grounded };
  g.contact = (_nx: number, _ny: number, _nz: number, _d: number, name: string) => { what ??= name; };
  g.hitBy = (name: string) => { what ??= name; };
  g.fail = () => {};
  g.pos.set(x, y, z); g.vel.set(0, 0, 0); g.lastSnag = -99; g.lastHit = -99;
  g.collide();
  g.contact = contact; g.hitBy = hitBy; g.fail = fail;
  g.pos.set(keep.x, keep.y, keep.z); g.vel.set(keep.vx, keep.vy, keep.vz);
  g.integrity = keep.i; g.maxIntegrity = keep.m; g.lastSnag = keep.snag; g.lastHit = keep.hit; g.state = keep.st; g.grounded = keep.gr;
  g.events.length = keep.ev;
  delete g.contact; delete g.hitBy; delete g.fail; // back to the prototype's
  return what;
}

function rootLabels(scene: any) {
  const named = new Map<any, string>(), f = w.fftt;
  for (const k of Object.keys(f)) { const v = f[k]; if (v?.root?.isObject3D) named.set(v.root, k); if (v?.mesh?.isObject3D) named.set(v.mesh, k); if (v?.isObject3D) named.set(v, k); }
  scene.children.forEach((c: any, i: number) => { if (!named.has(c)) named.set(c, c.name || `scene[${i}]:${c.type}:${c.children.length}`); });
  return named;
}

/** One pass over what's in the scene now, within `reach` of (cx, cz). */
export function sample(cx: number, cz: number, reach = 110, perMesh = 700) {
  const T = w.fftt.THREE, scene = w.fftt.stage.scene, named = rootLabels(scene);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3(), m = new T.Matrix4(), im = new T.Matrix4();
  const meshes: any[] = [];
  scene.traverseVisible((o: any) => { if (o.isMesh && !o.isSprite) meshes.push(o); });
  scene.updateMatrixWorld(true);
  for (const o of meshes) {
    const pos = o.geometry?.attributes?.position, index = o.geometry?.index;
    if (!pos) continue;
    const tris = (index ? index.count : pos.count) / 3, count = o.isInstancedMesh ? o.count : 1;
    if (!tris || !count) continue;
    let r = o; while (r.parent && r.parent !== scene) r = r.parent;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const tex = mat?.map?.image?.src?.split("/").pop()?.split("?")[0] ?? mat?.map?.source?.data?.src?.split("/").pop() ?? "";
    const key = `${named.get(r)} | ${o.name || "-"} | ${tex || mat?.type} ${mat?.transparent ? "transparent" : ""}`;
    for (let k = 0, done = 0; k < perMesh * 12 && done < perMesh; k++) {
      const t = Math.floor(Math.random() * tris) * 3;
      const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1, ic = index ? index.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      m.copy(o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(Math.floor(Math.random() * count), im); m.multiply(im); }
      a.applyMatrix4(m); b.applyMatrix4(m); c.applyMatrix4(m);
      const px = (a.x + b.x + c.x) / 3, py = (a.y + b.y + c.y) / 3, pz = (a.z + b.z + c.z) / 3;
      if (Math.abs(px - cx) > reach || Math.abs(pz - cz) > reach) continue;
      n.copy(b).sub(a).cross(c.clone().sub(a));
      const area = n.length() / 2;
      if (area < 1e-5) continue;
      n.normalize(); done++;
      const row = rows.get(key) ?? { key, tested: 0, through: 0, solid: 0, misses: [], bbox: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9] };
      rows.set(key, row);
      row.tested++;
      let what: string | null = null;
      for (const s of [0, 0.3, -0.3, 0.7, -0.7]) { what = probe(px + n.x * s, py + n.y * s, pz + n.z * s); if (what) break; }
      if (what) { row.solid++; hitsBy.set(what, (hitsBy.get(what) ?? 0) + 1); continue; }
      row.through++;
      if (row.misses.length < 60) row.misses.push([+px.toFixed(1), +py.toFixed(1), +pz.toFixed(1), +area.toFixed(2)]);
      row.bbox[0] = Math.min(row.bbox[0], px); row.bbox[1] = Math.min(row.bbox[1], py); row.bbox[2] = Math.min(row.bbox[2], pz);
      row.bbox[3] = Math.max(row.bbox[3], px); row.bbox[4] = Math.max(row.bbox[4], py); row.bbox[5] = Math.max(row.bbox[5], pz);
    }
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Move the camera to each site, let the near-camera systems fill in, sample. Site: [x, y, z]. */
export async function run(sites: number[][], settle = 2500) {
  rows.clear(); hitsBy.clear();
  (w as never as { auditDone: number }).auditDone = 0;
  for (const [x, y, z] of sites) {
    w.fftt.setCam(x, y, z, 0.6, -0.15);
    await wait(settle);
    sample(x, z);
    (w as never as { auditDone: number }).auditDone++;
  }
}

export function report(minThrough = 5) {
  return [...rows.values()].sort((p, q) => q.through - p.through).filter((r) => r.through >= minThrough)
    .map((r) => `${(100 * r.through / r.tested).toFixed(0).padStart(3)}% of ${String(r.tested).padStart(5)}  y ${r.bbox[1].toFixed(0)}..${r.bbox[4].toFixed(0)}  ${r.key}  e.g. ${r.misses.slice(0, 2).map((p) => p.slice(0, 3).join(",")).join(" ")}`).join("\n");
}
