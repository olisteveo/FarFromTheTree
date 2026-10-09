// The ground: the harbour, the island and its seawall, asphalt from the real roadbed
// with lane markings and crosswalks, raised sidewalks with curbs, medians, plazas, the
// building sites (old parks) behind hoardings with cranes, winter lawns and bare trees.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData, Poly } from "../world/data";
import { ringArea } from "../world/data";

// ------------------------------------------------------------------ canvas textures

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
let sd = 7;
const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);

function speckle(c: CanvasRenderingContext2D, s: number, n: number, dark: number, light: number, size = 2) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${dark * rnd()})` : `rgba(255,255,255,${light * rnd()})`;
    const r = 0.5 + rnd() * size;
    c.fillRect(rnd() * s, rnd() * s, r, r);
  }
}

const asphaltTex = () => canvasTex(1024, (c, s) => {
  c.fillStyle = "#4a4846"; c.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) { // patches
    c.fillStyle = `rgba(${rnd() < 0.5 ? "20,20,22" : "70,70,72"},${0.15 + rnd() * 0.2})`;
    c.fillRect(rnd() * s, rnd() * s, 40 + rnd() * 260, 30 + rnd() * 160);
  }
  speckle(c, s, 60000, 0.35, 0.18, 2.2);
  c.strokeStyle = "rgba(15,15,15,0.55)"; c.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) { // cracks
    let x = rnd() * s, y = rnd() * s;
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 12; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; c.lineTo(x, y); }
    c.stroke();
  }
  // tar seams
  c.strokeStyle = "rgba(10,10,10,0.6)"; c.lineWidth = 4;
  for (let i = 0; i < 5; i++) { c.beginPath(); const y = rnd() * s; c.moveTo(0, y); c.bezierCurveTo(s * 0.3, y + 30, s * 0.6, y - 30, s, y); c.stroke(); }
});

const concreteTex = () => canvasTex(512, (c, s) => {
  c.fillStyle = "#9a958c"; c.fillRect(0, 0, s, s);
  speckle(c, s, 20000, 0.18, 0.15, 1.6);
  // 1.5 m slabs: texture covers 3 m, so 2x2 slabs
  c.strokeStyle = "rgba(50,46,40,0.55)"; c.lineWidth = 3;
  for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo((i * s) / 2, 0); c.lineTo((i * s) / 2, s); c.stroke(); c.beginPath(); c.moveTo(0, (i * s) / 2); c.lineTo(s, (i * s) / 2); c.stroke(); }
  for (let i = 0; i < 4; i++) { c.fillStyle = `rgba(60,55,50,${0.08 + rnd() * 0.1})`; c.fillRect((i % 2) * s / 2, Math.floor(i / 2) * s / 2, s / 2, s / 2); }
  for (let i = 0; i < 18; i++) { c.fillStyle = "rgba(40,40,40,0.25)"; c.beginPath(); c.arc(rnd() * s, rnd() * s, 2 + rnd() * 5, 0, 7); c.fill(); } // gum
});

const dirtTex = () => canvasTex(512, (c, s) => {
  c.fillStyle = "#6b5a46"; c.fillRect(0, 0, s, s);
  speckle(c, s, 30000, 0.35, 0.2, 3);
  for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? "60,48,36" : "120,104,84"},0.3)`; c.beginPath(); c.arc(rnd() * s, rnd() * s, 10 + rnd() * 50, 0, 7); c.fill(); }
  c.strokeStyle = "rgba(40,30,20,0.4)"; c.lineWidth = 6; // tyre tracks
  for (let i = 0; i < 3; i++) { c.beginPath(); const x = rnd() * s; c.moveTo(x, 0); c.bezierCurveTo(x + 80, s * 0.3, x - 80, s * 0.6, x + 20, s); c.stroke(); }
});

const grassTex = () => canvasTex(512, (c, s) => {
  c.fillStyle = "#6a6a3e"; c.fillRect(0, 0, s, s);
  for (let i = 0; i < 40000; i++) {
    const v = rnd();
    c.fillStyle = v < 0.4 ? "rgba(140,128,80,0.5)" : v < 0.7 ? "rgba(80,88,48,0.5)" : "rgba(160,150,110,0.4)";
    c.fillRect(rnd() * s, rnd() * s, 1, 2 + rnd() * 3);
  }
  for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(${120 + rnd() * 50},${70 + rnd() * 30},30,0.7)`; c.fillRect(rnd() * s, rnd() * s, 3, 2); } // old leaves
});

const hoardingTex = () => canvasTex(1024, (c, s) => {
  // 12 m of plywood hoarding, painted, with posters and the odd tag
  const paints = ["#2f5d8a", "#2d6a4f", "#e8e4da", "#394049", "#8a2f2f"];
  let x = 0;
  while (x < s) {
    const w = 120 + rnd() * 260;
    c.fillStyle = paints[Math.floor(rnd() * paints.length)];
    c.fillRect(x, 0, w, s);
    x += w;
  }
  c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 2;
  for (let i = 0; i < s; i += s / 10) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, s); c.stroke(); }
  for (let i = 0; i < 9; i++) {
    const px = rnd() * (s - 120), py = s * 0.25 + rnd() * s * 0.3;
    c.fillStyle = ["#f2e14c", "#f2f2f2", "#ff7a3c", "#7ad1ff", "#e6e6e6"][i % 5];
    c.fillRect(px, py, 70 + rnd() * 60, 100 + rnd() * 60);
    c.fillStyle = "rgba(0,0,0,0.7)"; c.font = "bold 22px Inter, Arial";
    c.fillText(["LIVE", "SALE", "NOW", "NYC", "SOON"][i % 5], px + 8, py + 34);
  }
  c.fillStyle = "#ffffff"; c.fillRect(0, s * 0.82, s, s * 0.06);
  c.fillStyle = "#1d1d1d"; c.font = "bold 40px Inter, Arial";
  c.fillText("POST NO BILLS", 40, s * 0.865); c.fillText("POST NO BILLS", s / 2 + 40, s * 0.865);
  speckle(c, s, 20000, 0.25, 0.1, 2);
});

// ------------------------------------------------------------------ geometry helpers

function flatPoly(p: Poly, y: number): THREE.BufferGeometry | null {
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < p[0].length; i += 2) contour.push(new THREE.Vector2(p[0][i], p[0][i + 1]));
  const holes = p.slice(1).map((h) => { const v: THREE.Vector2[] = []; for (let i = 0; i < h.length; i += 2) v.push(new THREE.Vector2(h[i], h[i + 1])); return v; });
  if (contour.length < 3) return null;
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  if (!faces.length) return null;
  const all = [...contour, ...holes.flat()];
  const pos = new Float32Array(all.length * 3), uv = new Float32Array(all.length * 2), nor = new Float32Array(all.length * 3);
  all.forEach((v, i) => { pos.set([v.x, y, v.y], i * 3); uv.set([v.x, v.y], i * 2); nor.set([0, 1, 0], i * 3); });
  const idx: number[] = [];
  for (const f of faces) idx.push(f[0], f[2], f[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Vertical faces along a ring between y0 and y1 (u along the ring in metres, v in metres). */
function wallRing(r: number[], y0: number, y1: number, flip = false): THREE.BufferGeometry {
  const n = r.length / 2;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let u = 0, v = 0;
  for (let i = 0; i < n; i++) {
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[((i + 1) % n) * 2], bz = r[((i + 1) % n) * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    // rings wind clockwise: (-dz, dx) points out of the polygon
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (flip) { nx = -nx; nz = -nz; }
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uv.push(u, y0, u + L, y0, u + L, y1, u, y1);
    if (flip) idx.push(v, v + 2, v + 1, v, v + 3, v + 2); else idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    u += L; v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function merge(list: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry {
  const ok = list.filter((g): g is THREE.BufferGeometry => !!g).map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(ok)!;
}

function stripe(ax: number, az: number, bx: number, bz: number, w: number, y: number): THREE.BufferGeometry {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * w / 2, nz = (dx / L) * w / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// ------------------------------------------------------------------ bare winter trees

function bareTree(seed: number): THREE.BufferGeometry {
  sd = seed;
  const parts: THREE.BufferGeometry[] = [];
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.68, rad, len, depth > 3 ? 5 : 3, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    if (depth === 0 || rad < 0.025) return;
    const kids = depth > 1 ? 2 : 3;
    for (let i = 0; i < kids; i++) {
      const d = dir.clone();
      const ang = 0.45 + rnd() * 0.5;
      const axis = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize();
      d.applyAxisAngle(axis, ang).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i / kids) * Math.PI * 2 + rnd());
      d.y = Math.max(d.y, 0.15);
      d.normalize();
      branch(to, d, len * (0.62 + rnd() * 0.18), rad * 0.62, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 3.2, 0.22, 4);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

// ------------------------------------------------------------------ tower cranes

function crane(h: number, jib: number): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a81e, roughness: 0.6, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.5 });
  const mast = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), yellow);
  mast.position.y = h / 2;
  const jibM = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, jib), yellow);
  jibM.position.set(0, h + 1, jib / 2 - 6);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 14), yellow);
  counter.position.set(0, h + 1, -12);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 4), steel);
  weight.position.set(0, h - 0.3, -16);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.6), steel);
  cab.position.set(1.8, h - 0.4, 0);
  const peak = new THREE.Mesh(new THREE.ConeGeometry(1.2, 8, 4), yellow);
  peak.position.set(0, h + 5, 0);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h * 0.6), steel);
  cable.position.set(0, h - h * 0.3, jib * 0.6);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
  hook.position.set(0, h * 0.4, jib * 0.6);
  for (const m of [mast, jibM, counter, weight, cab, peak, cable, hook]) { m.castShadow = true; g.add(m); }
  return g;
}

// ------------------------------------------------------------------ build

export class GroundMesh {
  readonly root = new THREE.Group();
  readonly water: THREE.Mesh;
  private treeChunks: { g: THREE.Group; cx: number; cz: number }[] = [];
  private waterNormal: THREE.Texture;

  constructor(city: CityData) {
    const raw = city.raw;
    const T = (t: THREE.Texture, metres: number) => { t.repeat.set(1 / metres, 1 / metres); return t; };

    // the harbour
    this.waterNormal = canvasTex(512, (c, s) => {
      const img = c.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const a = Math.sin((x / s) * Math.PI * 8 + Math.sin((y / s) * Math.PI * 6) * 1.5) + Math.sin((y / s) * Math.PI * 10 + (x / s) * 4) * 0.6;
        const b = Math.cos((y / s) * Math.PI * 8 + Math.sin((x / s) * Math.PI * 4)) + Math.cos((x / s) * Math.PI * 12) * 0.5;
        const i = (y * s + x) * 4;
        img.data[i] = 128 + a * 30; img.data[i + 1] = 128 + b * 30; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    });
    this.waterNormal.colorSpace = THREE.NoColorSpace;
    this.waterNormal.repeat.set(220, 220);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a3b44, roughness: 0.08, metalness: 0.2, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }));
    this.water.position.set(0, -1.6, 3000);
    this.water.receiveShadow = true;
    this.root.add(this.water);

    // the island, its seawall, and the base of everything (lots, curbs, the gaps between polygons)
    const baseMat = new THREE.MeshStandardMaterial({ map: T(concreteTex(), 3), color: 0x8f8a80, roughness: 0.95 });
    const land = merge(raw.land.map((p) => flatPoly(p, 0)));
    const landMesh = new THREE.Mesh(land, baseMat);
    landMesh.receiveShadow = true;
    const seawall = new THREE.Mesh(merge(raw.land.map((p) => wallRing(p[0], -1.8, 0))), new THREE.MeshStandardMaterial({ color: 0x5d5952, roughness: 0.9 }));
    this.root.add(landMesh, seawall);

    // asphalt
    const asphalt = new THREE.MeshStandardMaterial({ map: T(asphaltTex(), 14), roughness: 0.9, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const road = new THREE.Mesh(merge(raw.roadbed.map((p) => flatPoly(p, 0.02))), asphalt);
    road.receiveShadow = true;
    this.root.add(road);

    // lane markings and crosswalks from the centrelines
    const white: THREE.BufferGeometry[] = [], yellow: THREE.BufferGeometry[] = [];
    for (const st of raw.streets) {
      if (st.rw !== 1) continue; // roads only
      const p = st.p;
      const segs: [number, number, number, number][] = [];
      for (let i = 0; i < p.length - 2; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
      let total = 0;
      for (const [ax, az, bx, bz] of segs) total += Math.hypot(bx - ax, bz - az);
      if (total < 14) continue;
      // centre line: double yellow on two-way streets
      let run = 0;
      for (const [ax, az, bx, bz] of segs) {
        const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        const t0 = Math.max(0, 9 - run), t1 = Math.min(L, total - 9 - run);
        if (t1 > t0) {
          const sx = ax + tx * t0, sz = az + tz * t0, ex = ax + tx * t1, ez = az + tz * t1;
          if (st.d === 0) {
            yellow.push(stripe(sx + nx * 0.12, sz + nz * 0.12, ex + nx * 0.12, ez + nz * 0.12, 0.11, 0.04));
            yellow.push(stripe(sx - nx * 0.12, sz - nz * 0.12, ex - nx * 0.12, ez - nz * 0.12, 0.11, 0.04));
          } else if (st.l >= 2) {
            // dashed lane lines
            const lanes = Math.min(st.l, 5), lw = st.w / Math.max(lanes + 1, 2);
            for (let k = 1; k < lanes; k++) {
              const o = (k - lanes / 2) * lw;
              for (let t = t0; t < t1 - 3; t += 9) white.push(stripe(ax + tx * t + nx * o, az + tz * t + nz * o, ax + tx * (t + 3) + nx * o, az + tz * (t + 3) + nz * o, 0.12, 0.04));
            }
          }
        }
        run += L;
      }
      // zebra crossings at both ends
      for (const end of [0, 1]) {
        const [ax, az, bx, bz] = end === 0 ? segs[0] : segs[segs.length - 1];
        const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        const ox = end === 0 ? ax + tx * 7.5 : bx - tx * 7.5, oz = end === 0 ? az + tz * 7.5 : bz - tz * 7.5;
        const half = st.w / 2 - 0.4;
        for (let o = -half; o < half; o += 1.1) white.push(stripe(ox + nx * o - tx * 1.6, oz + nz * o - tz * 1.6, ox + nx * o + tx * 1.6, oz + nz * o + tz * 1.6, 0.55, 0.045));
      }
    }
    const paint = (list: THREE.BufferGeometry[], col: number) => {
      if (!list.length) return;
      const m = new THREE.Mesh(merge(list), new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.receiveShadow = true;
      this.root.add(m);
    };
    paint(white, 0xd9d6cc);
    paint(yellow, 0xd8a530);

    // sidewalks, raised with curbs
    const walkMat = new THREE.MeshStandardMaterial({ map: T(concreteTex(), 3), roughness: 0.92 });
    const walks = new THREE.Mesh(merge(raw.sidewalk.map((p) => flatPoly(p, 0.15))), walkMat);
    walks.receiveShadow = true;
    const curbs = new THREE.Mesh(merge(raw.sidewalk.map((p) => wallRing(p[0], 0, 0.15))), new THREE.MeshStandardMaterial({ color: 0x8c877e, roughness: 0.8 }));
    this.root.add(walks, curbs);

    // medians and plazas
    const med = new THREE.Mesh(merge([...raw.median.map((p) => flatPoly(p, 0.22)), ...raw.median.map((p) => wallRing(p[0], 0, 0.22))]), new THREE.MeshStandardMaterial({ color: 0x7d786f, roughness: 0.9 }));
    med.receiveShadow = true;
    const plazaMat = new THREE.MeshStandardMaterial({ map: T(concreteTex(), 1.6), color: 0xb9ad98, roughness: 0.85 });
    const plz = new THREE.Mesh(merge(raw.plaza.map((p) => flatPoly(p, 0.08))), plazaMat);
    plz.receiveShadow = true;
    this.root.add(med, plz);

    // building sites: dirt, hoardings, cranes on the big ones
    const dirt = new THREE.Mesh(merge(raw.sites.map((s) => flatPoly(s.p, 0.1))), new THREE.MeshStandardMaterial({ map: T(dirtTex(), 8), roughness: 1 }));
    dirt.receiveShadow = true;
    const fenceTex = hoardingTex();
    fenceTex.repeat.set(1 / 12, 1 / 2.6);
    const fences = new THREE.Mesh(merge(raw.sites.flatMap((s) => [wallRing(s.p[0], 0, 2.6), wallRing(s.p[0], 0, 2.6, true)])), new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.85 }));
    fences.castShadow = true; fences.receiveShadow = true;
    this.root.add(dirt, fences);
    raw.sites.forEach((s, i) => {
      const a = Math.abs(ringArea(s.p[0]));
      if (a < 1800) return;
      let cx = 0, cz = 0;
      const r = s.p[0];
      for (let k = 0; k < r.length; k += 2) { cx += r[k]; cz += r[k + 1]; }
      cx /= r.length / 2; cz /= r.length / 2;
      const c = crane(55 + (i * 37) % 70, 50 + (i * 13) % 30);
      c.position.set(cx, 0, cz);
      c.rotation.y = (i * 1.7) % (Math.PI * 2);
      this.root.add(c);
    });

    // winter lawns (Battery Park, Central Park) and bare trees
    const lawn = new THREE.Mesh(merge(raw.parks.map((p) => flatPoly(p.p, 0.12))), new THREE.MeshStandardMaterial({ map: T(grassTex(), 5), roughness: 1 }));
    lawn.receiveShadow = true;
    this.root.add(lawn);
    this.trees(city);
  }

  private trees(city: CityData) {
    const variants = [11, 23, 37, 51].map((s) => bareTree(s));
    const bark = new THREE.MeshStandardMaterial({ color: 0x3e342c, roughness: 1 });
    const spots: [number, number, number][] = [];
    const t = city.raw.trees;
    for (let i = 0; i < t.length; i += 3) spots.push([t[i], t[i + 1], 0.75 + Math.min(1.1, t[i + 2] / 20)]);
    // park trees: scattered through Battery Park and Central Park, but never on the lawns' open middles
    sd = 99;
    for (const p of city.raw.parks) {
      const r = p.p[0];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); }
      if (/Sheep Meadow/.test(p.n)) continue; // the open meadow: the place to plant
      const n = Math.min(900, Math.abs(ringArea(r)) / 260);
      for (let k = 0; k < n; k++) {
        const x = x0 + (x1 - x0) * rnd(), z = z0 + (z1 - z0) * rnd();
        if (!city.raw.parks.some((q) => /Sheep Meadow/.test(q.n) && inRingFlat(q.p[0], x, z)) && inRingFlat(r, x, z)) spots.push([x, z, 0.9 + rnd() * 0.9]);
      }
    }
    // instanced per 300 m chunk, so only trees near the player are drawn
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const chunks = new Map<string, [number, number, number][]>();
    for (const sp of spots) {
      const k = `${Math.floor(sp[0] / 300)},${Math.floor(sp[1] / 300)}`;
      (chunks.get(k) ?? chunks.set(k, []).get(k)!).push(sp);
    }
    for (const [k, list] of chunks) {
      const g = new THREE.Group();
      variants.forEach((geo, vi) => {
        const mine = list.filter((_, i) => i % variants.length === vi);
        if (!mine.length) return;
        const im = new THREE.InstancedMesh(geo, bark, mine.length);
        mine.forEach(([x, z, sc], i) => im.setMatrixAt(i, m.compose(p.set(x, 0, z), q.setFromAxisAngle(Y, (x * 13.7 + z) % 6.28), s.set(sc, sc, sc))));
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im);
      });
      const [cx, cz] = k.split(",").map(Number);
      this.treeChunks.push({ g, cx: (cx + 0.5) * 300, cz: (cz + 0.5) * 300 });
      this.root.add(g);
    }
  }

  /** Trees only near the player. */
  updateFocus(focus: THREE.Vector3) {
    for (const c of this.treeChunks) c.g.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < 520;
  }

  update(t: number) {
    this.waterNormal.offset.set(t * 0.004, t * 0.006);
  }
}

function inRingFlat(r: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
