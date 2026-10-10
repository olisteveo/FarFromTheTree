// The bridge district: Manhattan east of the Bowery around the Manhattan Bridge (Chinatown east, Two
// Bridges and the Lower East Side down to the East River), outside the playable corridor. The far city
// left it to its box shader and a flat paved plain; this draws it as a place you can look into:
//   - the far city's footprints there (world/modelled.ts DISTRICT_ZONE; farCity.ts drops its own
//     versions) as textured buildings: red and buff brick walk-ups with fire escapes over Chinese
//     shopfronts, NYCHA brick towers, concrete low-rises, cornices, water tanks on the roofs
//   - a painted street plan under them (asphalt streets, sidewalks with curbs, paved plazas and parking
//     lots, the East River esplanade and the FDR Drive), transparent where ground.ts draws the corridor
//   - cobra-head lamps on the curbs, parked cars, cars in the lots, the FDR's median barrier, the
//     esplanade railing and its lamps
// Assets (tools/chinatown/build_chinatown.py): models/ct_district.json (footprints and prop positions,
// from far.dat and the painter), models/ct_district_kit.glb (Blender), textures/chinatown/district*.webp
// (Tesseract facades; the ground painted by district_ground.py). Not collidable: the leaf can't get here.
// Phones get the buildings (no cornices or roof tanks) and the ground at 512, no props.

import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { loadParkAssets } from "./centralPark";

interface DistrictFile {
  box: { x0: number; x1: number; z0: number; z1: number };
  buildings: { p: number[]; h: number; t: number; k: number }[];
  props?: { lamps: number[][]; cars: number[][]; lot_cars: number[][]; rail: number[][]; esp_lamps: number[][]; barrier: number[][]; hoardings: number[][]; fences: number[][]; cranes: number[][]; cabins: number[][];
    courts?: number[][]; playgrounds?: number[][]; walls?: number[][]; benches?: number[][]; cans?: number[][]; planters?: number[][]; trees?: number[][]; plaza_lamps?: number[][] };
}
export interface DistrictMeta { size: number; rects: Record<string, [number, number, number, number]>; metres: Record<string, [number, number]> }

const h01 = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** The district material: each vertex carries the atlas cell its UVs repeat in (aCell: x, y, w, h in
 *  atlas UV; w = 0 means untextured) and a tint; repeats are wrapped in the shader (textureGrad, so the
 *  mip level doesn't jump at the seams). */
function districtMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.86, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aCell; attribute vec3 aTint; varying vec4 vCell; varying vec3 vTint; varying vec2 vRep; varying vec3 vWp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCell = aCell; vTint = aTint; vRep = uv; vWp = (modelMatrix * vec4(position, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vCell; varying vec3 vTint; varying vec2 vRep; varying vec3 vWp;")
      .replace("#include <map_fragment>", `
        if (vCell.z > 0.0) {
          vec2 f = fract(vRep);
          vec2 uvA = vCell.xy + vec2(f.x, 1.0 - f.y) * vCell.zw;
          vec2 sc = vCell.zw * vec2(1.0, -1.0);
          vec4 tx = textureGrad(map, uvA, dFdx(vRep) * sc, dFdy(vRep) * sc);
          diffuseColor *= tx;
        } else {
          // untextured (roofs, cornices): a little grain so they aren't flat
          float n = fract(sin(dot(floor(vWp.xz * 1.3), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= 0.9 + 0.12 * n;
        }
        diffuseColor.rgb *= vTint;`);
  };
  m.customProgramCacheKey = () => "ctDistrict";
  return m;
}

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; cell: number[] = []; tint: number[] = []; idx: number[] = [];
  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, c: number[], t: number[]) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, w); this.cell.push(...c); this.tint.push(...t);
    return this.pos.length / 3 - 1;
  }
  /** a vertical wall quad from (ax, az) to (bx, bz), y0..y1, facing (nx, nz); u along, v up */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, u0: number, u1: number, v0: number, v1: number, c: number[], t: number[]) {
    const a = this.v(ax, y0, az, nx, 0, nz, u0, v0, c, t), b = this.v(bx, y0, bz, nx, 0, nz, u1, v0, c, t);
    const d = this.v(bx, y1, bz, nx, 0, nz, u1, v1, c, t), e = this.v(ax, y1, az, nx, 0, nz, u0, v1, c, t);
    // wind so the front faces (nx, nz)
    const cross = -(bz - az) * nx + (bx - ax) * nz; // ((b - a) x up) . n, sign only
    if (cross > 0) this.idx.push(a, b, d, a, d, e); else this.idx.push(a, d, b, a, e, d);
  }
  quad(p: number[][], n: number[], c: number[], t: number[]) {
    const i = p.map((q) => this.v(q[0], q[1], q[2], n[0], n[1], n[2], 0, 0, c, t));
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]); else this.idx.push(i[0], i[2], i[1], i[0], i[3], i[2]);
  }
  roof(xs: number[], zs: number[], y: number, c: number[], t: number[]) {
    const contour = xs.map((x, k) => new THREE.Vector2(x, zs[k]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.pos.length / 3;
    xs.forEach((x, k) => this.v(x, y, zs[k], 0, 1, 0, 0, 0, c, t));
    for (const tr of tris) {
      // face up (+y): (b - a) x (c - a) must point up
      const [a, b, d] = tr;
      const up = (zs[b] - zs[a]) * (xs[d] - xs[a]) - (xs[b] - xs[a]) * (zs[d] - zs[a]);
      if (up >= 0) this.idx.push(base + a, base + b, base + d); else this.idx.push(base + a, base + d, base + b);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    // packed small: normals as bytes, the cells as 16-bit, the tints as bytes (it's ~36 bytes a vertex)
    g.setAttribute("normal", new THREE.BufferAttribute(Int8Array.from(this.nor, (v) => Math.round(v * 127)), 3, true));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("aCell", new THREE.BufferAttribute(Uint16Array.from(this.cell, (v) => Math.round(v * 65535)), 4, true));
    g.setAttribute("aTint", new THREE.BufferAttribute(Uint8Array.from(this.tint, (v) => Math.round(Math.min(1, v) * 255)), 3, true));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    // the CPU copies go once they're on the GPU (phones are short of memory)
    const drop = function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; };
    for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(drop);
    g.index!.onUpload(drop);
    return g;
  }
}

export class ChinatownDistrict {
  readonly root = new THREE.Group();
  stats = { buildings: 0, tris: 0, geometryBytes: 0, textureBytes: 0 };
  private low: boolean;

  private medium: boolean;

  /** near(x, z): on phones, only the buildings this returns true for are built (the rest is in the fog) */
  constructor(quality: "low" | "medium" | "high", private near?: (x: number, z: number) => boolean) {
    this.low = quality === "low";
    this.medium = quality === "medium";
    this.root.name = "chinatownDistrict";
  }

  /** build it all from the loaded assets (called by Chinatown.load) */
  async build(url: (f: string) => string, meta: DistrictMeta, kit: GLTF | null, mats: Record<string, THREE.Material>, facades: THREE.Texture) {
    const kitMat = mats.ct;
    const tl = new THREE.TextureLoader();
    const tex = async (f: string) => {
      const t = await tl.loadAsync(url("textures/chinatown/" + f));
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.low ? 2 : 8; t.needsUpdate = true;
      return t;
    };
    const atlas = facades;   // (shared with the shops in the bridge approach's arches: chinatown.ts loads it)
    const [data, groundTex] = await Promise.all([
      fetch(url("models/ct_district.json")).then((r) => r.json()) as Promise<DistrictFile>,
      tex(this.low ? "district_ground_512.webp" : this.medium ? "district_ground_1k.webp" : "district_ground.webp"),
    ]);
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    // ---- the buildings, merged into four chunks (frustum culling)
    const S = meta.size;
    const cellOf = (name: string) => { const r = meta.rects[name]; return [r[0] / S, r[1] / S, r[2] / S, r[3] / S]; };
    const C = Object.fromEntries(Object.keys(meta.rects).map((k) => [k, cellOf(k)]));
    const M = meta.metres;
    const NONE = [0, 0, 0, 0];
    const box = data.box, midX = (box.x0 + box.x1) / 2, midZ = (box.z0 + box.z1) / 2;
    const chunks = [new Builder(), new Builder(), new Builder(), new Builder()];
    const towers: number[][] = [], bulk: number[][] = [];
    for (const b of data.buildings) {
      let xs: number[] = [], zs: number[] = [];
      for (let k = 0; k < b.p.length; k += 2) { xs.push(b.p[k]); zs.push(b.p[k + 1]); }
      if (xs.length > 3 && Math.hypot(xs[0] - xs[xs.length - 1], zs[0] - zs[zs.length - 1]) < 0.05) { xs.pop(); zs.pop(); }
      const n = xs.length;
      if (n < 3) continue;
      let area = 0, cx = 0, cz = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) { area += xs[j] * zs[i] - xs[i] * zs[j]; cx += xs[i]; cz += zs[i]; }
      area /= 2; cx /= n; cz /= n;
      if (this.low && this.near && !this.near(cx, cz)) continue;
      const g = chunks[(cx < midX ? 0 : 1) + (cz < midZ ? 0 : 2)];
      const h = Math.max(4, b.h), r = h01(b.k + 0.5), r2 = h01(b.k * 3.1 + 2.0);
      // the style from the far city's type and the height
      let style: string, store: string | null = null, cornice = false;
      if (b.t === 3 || b.t === 4) style = h > 22 ? "project" : "modern";
      else if (h > 34) style = "project";
      else { style = r < 0.58 ? "tenement_red" : "tenement_tan"; cornice = true; store = h > 9 ? (r2 < 0.5 ? "store_a" : "store_b") : null; }
      if (h < 7) { style = "modern"; cornice = false; store = r2 < 0.6 ? (r2 < 0.3 ? "store_a" : "store_b") : null; }
      const wallT = style.startsWith("tenement") ? [0.78 + r2 * 0.22, 0.78 + r2 * 0.2, 0.78 + r * 0.2] : [0.86 + r * 0.14, 0.86 + r * 0.14, 0.86 + r * 0.14];
      const cell = C[style], [mw, mh] = M[style];
      const storeH = store ? 4.0 : 0;
      const sgn = area > 0 ? 1 : -1;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = xs[j] - xs[i], dz = zs[j] - zs[i], L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
        if (store) g.wall(xs[i], zs[i], xs[j], zs[j], 0, storeH, nx, nz, u / M[store][0], (u + L) / M[store][0], 0, 0.999, C[store], [1, 1, 1]);
        g.wall(xs[i], zs[i], xs[j], zs[j], storeH, h, nx, nz, u / mw, (u + L) / mw, (storeH - 0.0) / mh + (store ? 0 : 0.15), h / mh, cell, wallT);
        u += L;
      }
      // cornice: a band standing out round the top, mitred at the corners
      // tar, the odd silver-painted or pale membrane roof
      const rv = h01(b.k * 5.3 + 1.0);
      const roofT = rv < 0.75 ? [0.085 + r * 0.04, 0.085 + r * 0.04, 0.09 + r * 0.04] : rv < 0.9 ? [0.42, 0.43, 0.44] : [0.30, 0.27, 0.24];
      if (cornice && !this.low) {
        const o = 0.38, ox: number[] = [], oz: number[] = [];
        for (let i = 0; i < n; i++) {
          const p = (i + n - 1) % n, q = (i + 1) % n;
          const l1 = Math.hypot(xs[i] - xs[p], zs[i] - zs[p]) || 1, l2 = Math.hypot(xs[q] - xs[i], zs[q] - zs[i]) || 1;
          const n1x = ((zs[i] - zs[p]) / l1) * sgn, n1z = (-(xs[i] - xs[p]) / l1) * sgn;
          const n2x = ((zs[q] - zs[i]) / l2) * sgn, n2z = (-(xs[q] - xs[i]) / l2) * sgn;
          let mx = n1x + n2x, mz = n1z + n2z;
          const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
          const d = o / Math.max(0.35, mx * n1x + mz * n1z);
          ox.push(xs[i] + mx * d); oz.push(zs[i] + mz * d);
        }
        const cc = r < 0.5 ? [0.78, 0.74, 0.66] : [0.30, 0.28, 0.26];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const dx = xs[j] - xs[i], dz = zs[j] - zs[i], L = Math.hypot(dx, dz);
          if (L < 0.05) continue;
          const nx = (dz / L) * sgn, nz = (-dx / L) * sgn;
          g.wall(ox[i], oz[i], ox[j], oz[j], h - 0.75, h + 0.2, nx, nz, 0, 0, 0, 0, NONE, cc);
          g.quad([[xs[i], h - 0.75, zs[i]], [xs[j], h - 0.75, zs[j]], [ox[j], h - 0.75, oz[j]], [ox[i], h - 0.75, oz[i]]], [0, -1, 0], NONE, cc.map((v) => v * 0.6));
          g.quad([[xs[i], h + 0.2, zs[i]], [ox[i], h + 0.2, oz[i]], [ox[j], h + 0.2, oz[j]], [xs[j], h + 0.2, zs[j]]], [0, 1, 0], NONE, cc);
        }
        g.roof(xs, zs, h + 0.05, NONE, roofT);
      } else g.roof(xs, zs, h, NONE, roofT);
      // roof clutter: a water tank on some old walk-ups, a stair bulkhead on most
      const absA = Math.abs(area);
      if (!this.low && style.startsWith("tenement") && h > 11 && absA > 120 && r2 < 0.32) towers.push([cx, h + 0.2, cz, r * 6.28]);
      if (!this.low && absA > 90 && r < 0.6 && style !== "project") bulk.push([cx + (r2 - 0.5) * 3, h, cz + (r - 0.5) * 3, r * 6.28]);
      this.stats.buildings++;
    }
    const mat = districtMaterial(atlas);
    for (const c of chunks) {
      if (!c.idx.length) continue;
      const geo = c.geometry();
      // (counted now: the arrays are dropped once they're on the GPU)
      for (const a of Object.values(geo.attributes)) this.stats.geometryBytes += (a as THREE.BufferAttribute).array.byteLength;
      this.stats.geometryBytes += geo.index!.array.byteLength;
      this.stats.tris += geo.index!.count / 3;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = "ct_district_buildings";
      mesh.castShadow = !this.low; mesh.receiveShadow = !this.low;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    // ---- the ground plan
    {
      const g = new THREE.BufferGeometry();
      const y = 0.035;
      g.setAttribute("position", new THREE.Float32BufferAttribute([box.x0, y, box.z0, box.x1, y, box.z0, box.x1, y, box.z1, box.x0, y, box.z1], 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      // (+x is west here, so this winding faces up)
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const m = new THREE.MeshStandardMaterial({ map: groundTex, alphaTest: 0.5, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(g, m);
      mesh.name = "ct_district_ground";
      mesh.receiveShadow = !this.low;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    // ---- the kit: roof tanks, bulkheads, lamps, cars, barriers, railings
    const lib = new Map<string, { geo: THREE.BufferGeometry; mat: string }[]>();
    if (kit) {
      kit.scene.updateMatrixWorld(true);
      for (const node of kit.scene.children) {
        const list: { geo: THREE.BufferGeometry; mat: string }[] = [];
        node.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) list.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat: (Array.isArray(m.material) ? m.material[0] : m.material).name }); });
        lib.set(node.name, list);
      }
    }
    const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const place = (name: string, list: number[][], scale?: (q: number[]) => [number, number, number], colors?: THREE.Color[], shadow = false) => {
      if (!list.length) return;
      for (const p of lib.get(name) ?? []) {
        const im = new THREE.InstancedMesh(p.geo, mats[p.mat] ?? kitMat, list.length);
        list.forEach((q, i) => {
          const s = scale ? scale(q) : [1, 1, 1];
          im.setMatrixAt(i, Mx.compose(P.set(q[0], q[1], q[2]), Q.setFromAxisAngle(Y, q[3]), Sc.set(s[0], s[1], s[2])));
          if (colors && p.mat === "ct") im.setColorAt(i, colors[i]);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = shadow; im.receiveShadow = false;
        im.name = "ct_district_" + name;
        this.root.add(im);
      }
    };
    if (!this.low && data.props) {
      const pr = data.props;
      place("water_tower", towers, undefined, undefined, true);
      // bulkheads: plain brick-dark boxes
      if (bulk.length) {
        const bg = new THREE.BoxGeometry(3.2, 2.8, 2.6).translate(0, 1.4, 0);
        const im = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0x5a4a40, roughness: 0.9 }), bulk.length);
        bulk.forEach((q, i) => im.setMatrixAt(i, Mx.compose(P.set(q[0], q[1], q[2]), Q.setFromAxisAngle(Y, q[3]), Sc.set(1, 1, 1))));
        im.computeBoundingSphere(); im.name = "ct_district_bulkheads";
        this.root.add(im);
      }
      place("lamp", [...pr.lamps.map((q) => [q[0], 0, q[1], q[2]]), ...pr.esp_lamps.map((q) => [q[0], 0, q[1], h01(q[0]) * 6.28])]);
      const palette = [0xd8dadb, 0x101012, 0x8c9094, 0x1c3366, 0x8a1410, 0xf2b814, 0x5a5f52, 0xc8c2b0];
      const cars = this.medium ? [...pr.cars.filter((_, i) => i % 2 === 0), ...pr.lot_cars.filter((_, i) => i % 2 === 0)] : [...pr.cars, ...pr.lot_cars];
      const colors = cars.map((q, i) => new THREE.Color(palette[Math.floor(h01(i * 7.7 + q[0]) * palette.length)]));
      const sedans: number[][] = [], suvs: number[][] = [], cs: THREE.Color[] = [], cu: THREE.Color[] = [];
      cars.forEach((q, i) => { const v = q[3] ?? 0; if (v < 4) { sedans.push([q[0], 0, q[1], q[2]]); cs.push(colors[i]); } else { suvs.push([q[0], 0, q[1], q[2]]); cu.push(colors[i]); } });
      place("car", sedans, undefined, cs);
      place("suv", suvs, undefined, cu);
      const seg = (list: number[][]) => list.map((q) => [(q[0] + q[2]) / 2, 0, (q[1] + q[3]) / 2, Math.atan2(-(q[3] - q[1]), q[2] - q[0]), Math.hypot(q[2] - q[0], q[3] - q[1])]);
      place("jersey", seg(pr.barrier), (q) => [q[4] + 0.05, 1, 1]);
      place("railing", seg(pr.rail), (q) => [q[4] / 2, 1, 1]);
      // the building sites: painted hoardings, tower cranes, site cabins; chain-link round the parking lots
      const paint = [0x2f6b4f, 0x1f4f8a, 0xd8d2c0, 0x6a2a2a];
      place("hoarding", (pr.hoardings ?? []).map((q) => [q[0], 0, q[1], q[2]]), undefined, (pr.hoardings ?? []).map((q) => new THREE.Color(paint[q[3] % 4])));
      place("fence", (pr.fences ?? []).filter((_, i) => !this.medium || i % 2 === 0).map((q) => [q[0], 0, q[1], q[2]]), this.medium ? () => [2, 1, 1] : undefined);
      place("cabin", (pr.cabins ?? []).map((q) => [q[0], 0, q[1], q[2]]));
      place("crane", (pr.cranes ?? []).map((q) => [q[0], 0, q[1], q[2], q[3]]), (q) => [q[4] / 60, q[4] / 60, q[4] / 60], undefined, true);
      // the plazas between the towers: fenced basketball courts (their surfaces are painted into the ground),
      // playgrounds, handball walls, benches, bins, planters, lamps and a few bare trees
      const hoops: number[][] = [], courtFence: number[][] = [];
      for (const [x, z, a] of pr.courts ?? []) {
        const ca = Math.cos(a), sa = Math.sin(a);
        for (const sg of [-1, 1]) {
          const dx = -sg * ca, dz = -sg * sa;      // the rim reaches in toward the middle
          hoops.push([x + sg * 14.35 * ca, 0, z + sg * 14.35 * sa, Math.atan2(-dz, dx)]);
        }
        // chain-link round the 31 x 19 m pad, 2.4 m panels, 3.4 m high
        for (const [u0, v0, u1, v1] of [[-15.5, -9.5, 15.5, -9.5], [15.5, -9.5, 15.5, 9.5], [15.5, 9.5, -15.5, 9.5], [-15.5, 9.5, -15.5, -9.5]]) {
          const L = Math.hypot(u1 - u0, v1 - v0), n = Math.round(L / 2.4);
          for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n, u = u0 + (u1 - u0) * f, v = v0 + (v1 - v0) * f;
            const ex = ((u1 - u0) * ca - (v1 - v0) * sa) / L, ez = ((u1 - u0) * sa + (v1 - v0) * ca) / L;
            courtFence.push([x + u * ca - v * sa, 0, z + u * sa + v * ca, Math.atan2(-ez, ex), L / n / 2.4]);
          }
        }
      }
      place("hoop", hoops);
      // the courts' surfaces: crisp Tesseract-painted quads over the ground's blurrier version
      if (pr.courts?.length) {
        const ct = await tl.loadAsync(url("textures/chinatown/court.webp"));
        ct.flipY = false; ct.colorSpace = THREE.SRGBColorSpace; ct.anisotropy = 8;
        const geo = new THREE.PlaneGeometry(31, 19).rotateX(-Math.PI / 2);
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), pr.courts.length);
        pr.courts.forEach((q, i) => im.setMatrixAt(i, Mx.compose(P.set(q[0], 0.06, q[1]), Q.setFromAxisAngle(Y, Math.atan2(-Math.sin(q[2]), Math.cos(q[2]))), Sc.set(1, 1, 1))));
        im.computeBoundingSphere(); im.receiveShadow = true; im.name = "ct_district_courts";
        this.root.add(im);
        this.stats.textureBytes += 512 * 314 * 4 * 1.33;
      }
      place("fence", courtFence, (q) => [q[4], 1.8, 1]);
      place("jungle_gym", (pr.playgrounds ?? []).map((q) => [q[0], 0, q[1], -q[2]]));
      place("handball_wall", (pr.walls ?? []).map((q) => [q[0], 0, q[1], -q[2]]));
      place("bench_nyc", (pr.benches ?? []).map((q) => [q[0], 0, q[1], q[2]]));
      place("trash_can", (pr.cans ?? []).map((q) => [q[0], 0, q[1], 0]));
      place("planter", (pr.planters ?? []).map((q) => [q[0], 0, q[1], q[2]]));
      place("lamp", (pr.plaza_lamps ?? []).map((q) => [q[0], 0, q[1], q[2]]));
      if (pr.trees?.length) {
        // bare winter trees, the park's (render/centralPark.ts: the assets are loaded once and shared)
        const park = await loadParkAssets().catch(() => null);
        if (park) {
          const sp = ["elm", "oak", "plane"];
          for (let k = 0; k < 3; k++) {
            const list = pr.trees.filter((q) => q[3] === k);
            if (!list.length) continue;
            for (const p of park.parts(`tree_${sp[k]}_lod1`)) {
              const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
              list.forEach((q, i) => im.setMatrixAt(i, Mx.compose(P.set(q[0], 0, q[1]), Q.setFromAxisAngle(Y, q[2]), Sc.setScalar(0.75 + h01(q[0] + q[1]) * 0.3))));
              im.computeBoundingSphere(); im.name = "ct_district_trees";
              this.root.add(im);
            }
          }
        }
      }
    }
    // ---- what this costs
    const seen = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry || seen.has(m.geometry) || m.name === "ct_district_buildings") return;
      seen.add(m.geometry);
      for (const a of Object.values(m.geometry.attributes)) this.stats.geometryBytes += (a as THREE.BufferAttribute).array.byteLength;
      if (m.geometry.index) this.stats.geometryBytes += m.geometry.index.array.byteLength;
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) this.stats.geometryBytes += im.instanceMatrix.array.byteLength + (im.instanceColor?.array.byteLength ?? 0);
      this.stats.tris += (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3) * (im.isInstancedMesh ? im.count : 1);
    });
    for (const t of [atlas, groundTex]) { const im = t.image as { width: number; height: number }; this.stats.textureBytes += Math.round(im.width * im.height * 4 * 1.33); }
  }
}
