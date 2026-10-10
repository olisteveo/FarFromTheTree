// The ground: the harbour, the island and its seawall, asphalt from the real roadbed
// with lane markings and crosswalks, raised sidewalks with curbs, medians, plazas, the
// building sites (old parks) behind hoardings with cranes, winter lawns and bare trees.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData, Poly } from "../world/data";
import { ringArea } from "../world/data";
import { cutRects, type Rect } from "./subwayEntrances";
import { atlasMaterial, CELL, ChunkedQuads, loadGroundTextures, PolyIndex, ringNormals, ROW, rowV, STRIP_M, surfaceMaterial, type CellName } from "./groundArt";

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

// (the building sites' tower cranes are kit pieces now: render/architectureLots.ts)

// ------------------------------------------------------------------ build

export class GroundMesh {
  readonly root = new THREE.Group();
  readonly water: THREE.Mesh;
  private treeChunks: { g: THREE.Group; cx: number; cz: number }[] = [];
  private dress: { mesh: THREE.Mesh; cx: number; cz: number; r: number }[] = [];
  private waterNormal: THREE.Texture;
  private holes: Rect[];

  /** opts.base: URL of the folder holding textures/ (default: next to the page).
   *  opts.skipTree: spots where ground.ts must not plant a bare tree (e.g. Central Park, which plants its own).
   *  opts.holes: openings to cut out of the street surfaces (the subway stairs and vents: subwayEntrances.streetOpenings);
   *  opts.waterHoles: where the harbour plane (under the whole city) must not show inside a shaft (deepOpenings). */
  constructor(city: CityData, opts: { base?: string; skipTree?: (x: number, z: number) => boolean; holes?: Rect[]; waterHoles?: Rect[] } = {}) {
    const raw = city.raw;
    // the subway's openings are cut out of every street surface, so you really go down into them
    this.holes = opts.holes ?? [];
    const cut = (g: THREE.BufferGeometry) => cutRects(g, this.holes);
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
    this.water = new THREE.Mesh(cutRects(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2).translate(0, 0, 3000), opts.waterHoles ?? []).translate(0, 0, -3000), new THREE.MeshStandardMaterial({ color: 0x2a3b44, roughness: 0.08, metalness: 0.2, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }));
    this.water.position.set(0, -1.6, 3000);
    this.water.receiveShadow = true;
    this.root.add(this.water);

    // the street surfaces: Tesseract-designed tiles shaded in world space (groundArt.ts)
    const gt = loadGroundTextures(opts.base);
    const walk = (tint: number, wet = 1) => surfaceMaterial({ a: gt.walkA, an: gt.walkAN, b: gt.walkB, bn: gt.walkBN, scaleA: 6, scaleB: 6, macro: gt.macro, mode: 0, shareB: 0.4, wet, tint });
    const asphalt = (tint: number, offset: number) => surfaceMaterial({ a: gt.roadA, an: gt.roadAN, b: gt.roadB, bn: gt.roadBN, scaleA: 8, scaleB: 11, macro: gt.macro, mode: 1, mask: [0, 1, 0], maskRange: [0.4, 0.62], wet: 1, tint, polygonOffset: offset, normalScale: 0.9 });
    const kerbMat = atlasMaterial(gt.strips, gt.stripsN, {});
    const gutterMat = atlasMaterial(gt.strips, gt.stripsN, { transparent: true, offset: -2 });
    const paintMat = atlasMaterial(gt.paint, gt.paintN, { transparent: true, offset: -3, vertexColors: true, normalScale: 0.6 });
    const decalMat = atlasMaterial(gt.decals, gt.decalsN, { transparent: true, offset: -4, vertexColors: true });

    // the island, its seawall, and the base of everything (lots, the gaps between polygons)
    const land = cut(merge(raw.land.map((p) => flatPoly(p, 0))));
    const landMesh = new THREE.Mesh(land, walk(0x9a968f));
    landMesh.receiveShadow = true;
    const seawall = new THREE.Mesh(merge(raw.land.map((p) => wallRing(p[0], -1.8, 0))), new THREE.MeshStandardMaterial({ color: 0x5d5952, roughness: 0.9 }));
    this.root.add(landMesh, seawall);

    // asphalt
    const roadMat = asphalt(0xffffff, -1);
    const road = new THREE.Mesh(cut(merge(raw.roadbed.map((p) => flatPoly(p, 0.02)))), roadMat);
    road.receiveShadow = true;
    this.root.add(road);

    // sidewalks, raised, with steel-edged kerbs, granite caps and grimy gutters full of dead leaves
    const walks = new THREE.Mesh(cut(merge(raw.sidewalk.map((p) => flatPoly(p, 0.15)))), walk(0xffffff));
    walks.receiveShadow = true;
    this.root.add(walks);

    // medians and plazas
    const med = new THREE.Mesh(cut(merge(raw.median.map((p) => flatPoly(p, 0.22)))), walk(0xb0aca4, 0.6));
    med.receiveShadow = true;
    const plz = new THREE.Mesh(cut(merge(raw.plaza.map((p) => flatPoly(p, 0.08)))), walk(0xd6ccbc));
    plz.receiveShadow = true;
    this.root.add(med, plz);

    // park paths: paler, weathered asphalt with no utility cuts (both tiles are the plain one)
    const pathMat = surfaceMaterial({ a: gt.roadA, an: gt.roadAN, b: gt.roadA, bn: gt.roadAN, scaleA: 7, scaleB: 9, macro: gt.macro, mode: 1, mask: [0, 1, 0], maskRange: [0.3, 0.7], wet: 0.7, polygonOffset: -1, normalScale: 0.8 });
    pathMat.color.setRGB(1.3, 1.29, 1.24);
    this.streetDressing(city, { kerbMat, gutterMat, paintMat, decalMat, driveMat: asphalt(0xffffff, -1), pathMat });

    // building sites (the old parks): churned clay with tyre ruts and puddles (Tesseract, tools/buildings).
    // Their hoardings, sidewalk sheds, machines and tower cranes are kit pieces placed by
    // render/architectureLots.ts (part of the buildings), so they're instanced and culled with the rest.
    const siteTex = new THREE.TextureLoader().load(`${opts.base ?? "./"}models/buildings_site_dirt.webp`);
    siteTex.wrapS = siteTex.wrapT = THREE.RepeatWrapping;
    siteTex.colorSpace = THREE.SRGBColorSpace;
    siteTex.anisotropy = 8;
    const dirt = new THREE.Mesh(merge(raw.sites.map((s) => flatPoly(s.p, 0.1))), new THREE.MeshStandardMaterial({ map: T(siteTex, 8), roughness: 1 }));
    dirt.receiveShadow = true;
    this.root.add(dirt);

    // winter lawns (Battery Park, Central Park): tired November turf with drifts of the
    // city's fallen leaves raked into it, and bare trees
    const lawnMat = surfaceMaterial({ a: gt.lawnA, an: gt.lawnAN, b: gt.lawnB, bn: gt.lawnBN, scaleA: 5, scaleB: 4, macro: gt.macro, mode: 1, mask: [0, 0, 1], maskRange: [0.5, 0.76], wet: 0, normalScale: 0.8 });
    const lawn = new THREE.Mesh(merge(raw.parks.map((p) => flatPoly(p.p, 0.12))), lawnMat);
    lawn.receiveShadow = true;
    this.root.add(lawn);
    this.trees(city, opts.skipTree);
  }

  /** Kerbs, gutters, paint, park drives and paths, and the decals that make it New York. */
  private streetDressing(city: CityData, m: { kerbMat: THREE.Material; gutterMat: THREE.Material; paintMat: THREE.Material; decalMat: THREE.Material; driveMat: THREE.MeshStandardMaterial; pathMat: THREE.MeshStandardMaterial }) {
    const raw = city.raw;
    const roadIdx = new PolyIndex(raw.roadbed);
    const walkIdx = new PolyIndex(raw.sidewalk);
    const parkIdx = new PolyIndex(raw.parks.map((p) => p.p));
    const meadowIdx = new PolyIndex(raw.parks.filter((p) => /Sheep Meadow/.test(p.n)).map((p) => p.p));
    const inMeadow = (x: number, z: number) => (x > 430 && x < 730 && z > 8290 && z < 8565) || meadowIdx.has(x, z);
    const kerbs = new ChunkedQuads(false, 600), gutters = new ChunkedQuads(false, 600), paint = new ChunkedQuads(true, 600);
    const drives = new ChunkedQuads(false, 600), paths = new ChunkedQuads(false, 600);
    const decals = new ChunkedQuads(true, 300), text = new ChunkedQuads(true, 300);
    const h = (a: number, b: number) => { let n = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12; return (n >>> 0) / 4294967296; };
    const cell = (c: CellName) => CELL[c];

    const WHITE = [0.86, 0.85, 0.81, 1], YELLOW = [0.88, 0.62, 0.16, 1], BUSRED = [0.64, 0.25, 0.17, 0.95];
    const stripe = (q: ChunkedQuads, ax: number, az: number, bx: number, bz: number, w: number, y: number, col: number[], u0 = 0, uLen = 3) => {
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * w / 2, nz = (dx / L) * w / 2;
      q.quad([ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz], [u0, 1, u0 + L / uLen, 1, u0 + L / uLen, 0, u0, 0], col);
    };
    /** A ribbon along a segment (world-shaded materials ignore its uvs; hex edges use the strips atlas). */
    const ribbon = (q: ChunkedQuads, ax: number, az: number, bx: number, bz: number, o0: number, o1: number, y: number, ext: number, uv?: [number, number, number, number]) => {
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
      const sx = ax - tx * ext, sz = az - tz * ext, ex = bx + tx * ext, ez = bz + tz * ext;
      const [u0, u1, v0, v1] = uv ?? [0, 1, 0, 1];
      q.quad([sx + nx * o0, y, sz + nz * o0, ex + nx * o0, y, ez + nz * o0, ex + nx * o1, y, ez + nz * o1, sx + nx * o1, y, sz + nz * o1], [u0, v0, u1, v0, u1, v1, u0, v1]);
    };

    // ---- kerbs: a steel-angled face all round, a cap and a gutter where the kerb meets a road
    raw.sidewalk.forEach((p, pi) => {
      const r = p[0], n = r.length / 2;
      if (n < 3) return;
      const { nx, nz, L } = ringNormals(r);
      const road: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const mx = (r[i * 2] + r[((i + 1) % n) * 2]) / 2, mz = (r[i * 2 + 1] + r[((i + 1) % n) * 2 + 1]) / 2;
        road.push(L[i] > 0.05 && (roadIdx.has(mx + nx[i] * 1.0, mz + nz[i] * 1.0) || roadIdx.has(mx + nx[i] * 2.5, mz + nz[i] * 2.5)));
      }
      // mitred offsets at each vertex
      const mxv: number[] = [], mzv: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + n - 1) % n;
        let ax = nx[j] + nx[i], az = nz[j] + nz[i];
        const l = Math.hypot(ax, az) || 1;
        ax /= l; az /= l;
        const k = 1 / Math.max(0.4, ax * nx[i] + az * nz[i]);
        mxv.push(ax * k); mzv.push(az * k);
      }
      let u = h(pi, 1) * 40;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const u0 = u / STRIP_M, u1 = (u + L[i]) / STRIP_M;
        u += L[i];
        kerbs.quad([ax, 0, az, bx, 0, bz, bx, 0.15, bz, ax, 0.15, az],
          [u0, rowV(ROW.face, 1), u1, rowV(ROW.face, 1), u1, rowV(ROW.face, 0), u0, rowV(ROW.face, 0)], undefined, [nx[i], 0, nz[i]]);
        if (!road[i]) continue;
        const CAP = 0.3, GUT = 0.6;
        kerbs.quad([ax, 0.151, az, bx, 0.151, bz, bx - mxv[j] * CAP, 0.151, bz - mzv[j] * CAP, ax - mxv[i] * CAP, 0.151, az - mzv[i] * CAP],
          [u0, rowV(ROW.cap, 0), u1, rowV(ROW.cap, 0), u1, rowV(ROW.cap, 1), u0, rowV(ROW.cap, 1)]);
        gutters.quad([ax, 0.028, az, bx, 0.028, bz, bx + mxv[j] * GUT, 0.028, bz + mzv[j] * GUT, ax + mxv[i] * GUT, 0.028, az + mzv[i] * GUT],
          [u0, rowV(ROW.gutter, 0), u1, rowV(ROW.gutter, 0), u1, rowV(ROW.gutter, 1), u0, rowV(ROW.gutter, 1)]);
        // sidewalk furniture along the kerb: subway vent grates, cellar doors, vault covers, leaves
        if (L[i] < 9) continue;
        const tx = (bx - ax) / L[i], tz = (bz - az) / L[i];
        for (let d = 4, k = 0; d < L[i] - 4; d += 7, k++) {
          const rr = h(pi * 131 + i, k);
          const px = ax + tx * d, pz = az + tz * d;
          const at = (o: number): [number, number] => [px - nx[i] * o, pz - nz[i] * o];
          const ok = (...pts: [number, number][]) => pts.every(([x, z]) => walkIdx.has(x, z));
          if (rr < 0.05) {
            const [cx, cz] = at(1.1);
            if (ok([cx + tx * 2, cz + tz * 2], [cx - tx * 2, cz - tz * 2], at(1.8))) decals.decal(cx, 0.153, cz, -nx[i], -nz[i], 1.9, 0.62, cell("grate"));
          } else if (rr < 0.11) {
            const [cx, cz] = at(3.3);
            if (ok(at(2.4), at(4.6), [cx + tx, cz + tz], [cx - tx, cz - tz])) decals.decal(cx, 0.153, cz, -nx[i], -nz[i], 0.8, 0.8, cell("cellar"));
          } else if (rr < 0.14) {
            const [cx, cz] = at(0.9 + h(k, pi) * 1.5);
            if (ok([cx, cz])) decals.decal(cx, 0.153, cz, tx, tz, 0.3, 0.3, cell("valves"), undefined, [(k % 2) * 0.5, 0.5, (k % 2) * 0.5 + 0.5, 1]);
          } else if (rr < 0.2) {
            const [cx, cz] = at(0.5 + h(k, pi + 7) * 2.5);
            const a = h(k, pi + 9) * 6.28;
            if (ok([cx, cz])) decals.decal(cx, 0.154, cz, Math.cos(a), Math.sin(a), 0.6, 0.6, cell("leaves"), [1, 1, 1, 0.9]);
          }
        }
      }
    });
    // median sides
    for (const p of raw.median) {
      const r = p[0], n = r.length / 2;
      const { nx, nz, L } = ringNormals(r);
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const u0 = u / STRIP_M, u1 = (u + L[i]) / STRIP_M;
        u += L[i];
        kerbs.quad([r[i * 2], 0, r[i * 2 + 1], r[j * 2], 0, r[j * 2 + 1], r[j * 2], 0.22, r[j * 2 + 1], r[i * 2], 0.22, r[i * 2 + 1]],
          [u0, rowV(ROW.face, 1), u1, rowV(ROW.face, 1), u1, rowV(ROW.face, 0), u0, rowV(ROW.face, 0)], undefined, [nx[i], 0, nz[i]]);
      }
    }

    // ---- the roads: paint, tyre polish, oil, ironwork
    const BUS = /^(1|2|5|7|8) AVE$|^AVE OF THE AMERICAS$|^6 AVE$|^MADISON AVE$|^LEXINGTON AVE$|^CHURCH ST$|^(E|W) {2}(14|23|34|42) ST$/;
    raw.streets.forEach((st, si) => {
      if (st.rw !== 1) return;
      const p = st.p;
      const segs: [number, number, number, number][] = [];
      for (let i = 0; i < p.length - 2; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
      let total = 0;
      for (const [ax, az, bx, bz] of segs) total += Math.hypot(bx - ax, bz - az);
      if (!segs.length) return;
      const [sx, sz, ex, ez] = segs[Math.floor(segs.length / 2)];
      const park = parkIdx.has((sx + ex) / 2, (sz + ez) / 2);
      const y = park ? 0.15 : 0.04;
      if (park) {
        // park drives: asphalt over the lawn
        const w = Math.max(7, st.w);
        for (const [ax, az, bx, bz] of segs) ribbon(drives, ax, az, bx, bz, -w / 2, w / 2, 0.13, w * 0.35);
      }
      if (total < 14) return;
      const bus = !park && st.w >= 15 && BUS.test(st.n);
      const lanes = Math.max(1, Math.min(st.l, 6)), lw = st.w / lanes;
      let run = 0;
      for (const [si2, [ax, az, bx, bz]] of segs.entries()) {
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.01) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        const t0 = Math.max(0, 9 - run), t1 = Math.min(L, total - 9 - run);
        const P = (t: number, o: number): [number, number] => [ax + tx * t + nx * o, az + tz * t + nz * o];
        if (t1 > t0) {
          const [qx, qz] = P(t0, 0), [rx, rz] = P(t1, 0);
          if (st.d === 0) {
            stripe(paint, qx + nx * 0.12, qz + nz * 0.12, rx + nx * 0.12, rz + nz * 0.12, 0.11, y, YELLOW, h(si, 2) * 7);
            stripe(paint, qx - nx * 0.12, qz - nz * 0.12, rx - nx * 0.12, rz - nz * 0.12, 0.11, y, YELLOW, h(si, 3) * 7);
          } else if (st.l >= 2) {
            const nl = Math.min(st.l, 5), lw2 = st.w / Math.max(nl + 1, 2);
            for (let k = 1; k < nl; k++) {
              const o = (k - nl / 2) * lw2;
              for (let t = t0; t < t1 - 3; t += 9) stripe(paint, ...P(t, o), ...P(t + 3, o), 0.12, y, WHITE, h(si, k) * 5 + t / 9);
            }
          }
          if (bus) {
            // NYC red bus lanes, offset one lane from the kerb (parking at the kerb)
            for (const side of st.d === 0 ? [1, -1] : [st.d]) {
              const o = side * (st.w / 2 - 4.15);
              stripe(paint, ...P(t0, o), ...P(t1, o), 3.3, y + 0.001, BUSRED, h(si, 11) * 9, 8);
              stripe(paint, ...P(t0, o - side * 1.75), ...P(t1, o - side * 1.75), 0.15, y + 0.002, WHITE, h(si, 12) * 9);
              for (let t = t0 + 12; t < t1 - 6; t += 55) {
                const [cx, cz] = P(t, o);
                text.decal(cx, y + 0.004, cz, tx * side, tz * side, 1.25, 2.6, cell("busonly"), [1, 1, 1, 0.92]);
              }
            }
          }
        }
        if (!park) {
          // tyre-polished wheel paths, darker and smoother
          for (let k = 0; k < lanes; k++) {
            const oc = -st.w / 2 + lw * (k + 0.5);
            for (const wo of [-0.85, 0.85]) {
              const [cx, cz] = P(L / 2, oc + wo);
              decals.decal(cx, 0.033, cz, nx, nz, L / 2, 0.4, cell("polish"), [1, 1, 1, 0.28]);
            }
          }
          // ironwork and patches, half-way between the gameplay hazards (StreetLife puts those at 8 + 9k)
          for (let d = 3.5, k = 0; d < L - 3; d += 9, k++) {
            const rr = h(si * 977 + si2 * 31 + k, 21);
            const lane = Math.floor(h(si + k, 22) * lanes);
            const o = -st.w / 2 + lw * (lane + 0.5) + (h(si + k, 23) - 0.5) * 1.2;
            const [cx, cz] = P(d, o);
            if (rr < 0.07) decals.decal(cx, 0.036, cz, tx, tz, 0.56, 0.56, cell("sewer"));
            else if (rr < 0.11) decals.decal(cx, 0.036, cz, tx, tz, 0.56, 0.56, cell("coned"));
            else if (rr < 0.15) { const q = k % 4; decals.decal(cx, 0.036, cz, tx, tz, 0.26, 0.26, cell("valves"), undefined, [(q % 2) * 0.5, Math.floor(q / 2) * 0.5, (q % 2) * 0.5 + 0.5, Math.floor(q / 2) * 0.5 + 0.5]); }
            else if (rr < 0.17) decals.decal(cx, 0.037, cz, tx, tz, 1.25, 1.6, cell("plate"));
            else if (rr < 0.19) { const s = 1.1 + h(k, si) * 1.4; decals.decal(cx, 0.031, cz, tx, tz, s, s * (0.7 + h(si, k) * 0.8), cell("cut")); }
            else if (rr < 0.33) { const s = 0.6 + h(k, si + 1) * 0.7; decals.decal(cx, 0.034, cz, tx, tz, s, s * 1.3, cell(rr < 0.27 ? "oil_a" : "oil_b"), [1, 1, 1, 0.75]); }
            else if (rr < 0.37) {
              const side = h(si, k + 5) < 0.5 ? -1 : 1;
              const [lx, lz] = P(d, side * (st.w / 2 - 0.9 - h(k, si + 2) * 1.2));
              const a = h(k, si + 3) * 6.28;
              decals.decal(lx, 0.035, lz, Math.cos(a), Math.sin(a), 0.65, 0.65, cell("leaves"), [1, 1, 1, 0.9]);
            }
          }
        }
        run += L;
      }
      // crossings at both ends: ladder bars, stop lines, storm drains and tactile pads at the ramps
      for (const end of [0, 1]) {
        const [ax, az, bx, bz] = end === 0 ? segs[0] : segs[segs.length - 1];
        const L = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
        const ox = end === 0 ? ax + tx * 7.5 : bx - tx * 7.5, oz = end === 0 ? az + tz * 7.5 : bz - tz * 7.5;
        const half = st.w / 2 - 0.4;
        for (let o = -half; o < half; o += 1.1) stripe(paint, ox + nx * o - tx * 1.6, oz + nz * o - tz * 1.6, ox + nx * o + tx * 1.6, oz + nz * o + tz * 1.6, 0.55, y + 0.005, WHITE, h(si, end * 7 + Math.round(o)) * 3);
        // traffic arriving at this end: end 1 is reached moving +t (lanes on +n), end 0 moving -t (lanes on -n)
        const arrive = st.d === 0 || (st.d > 0) === (end === 1);
        const up = end === 1 ? -1 : 1;
        if (arrive) {
          const lo = st.d === 0 ? (end === 1 ? 0 : -half) : -half, hi = st.d === 0 ? (end === 1 ? half : 0) : half;
          const cx = ox + tx * up * 2.6, cz = oz + tz * up * 2.6;
          stripe(paint, cx + nx * lo, cz + nz * lo, cx + nx * hi, cz + nz * hi, 0.6, y + 0.005, WHITE, h(si, end + 40));
          if (!park) {
            // cars wait here: drips
            const o = (lo + hi) / 2 + (h(si, end + 41) - 0.5) * (hi - lo) * 0.6;
            decals.decal(cx + tx * up * 3 + nx * o, 0.034, cz + tz * up * 3 + nz * o, tx, tz, 0.7, 1.1, cell("oil_b"), [1, 1, 1, 0.7]);
          }
        }
        if (park) continue;
        for (const side of [-1, 1]) {
          if (h(si * 3 + end, side + 50) < 0.55) {
            const dx = ox + tx * up * 3.4 + nx * side * (st.w / 2 - 0.32), dz = oz + tz * up * 3.4 + nz * side * (st.w / 2 - 0.32);
            decals.decal(dx, 0.035, dz, nx * side, nz * side, 0.55, 0.55, cell("drain"));
          }
          const px = ox + nx * side * (st.w / 2 + 0.45), pz = oz + nz * side * (st.w / 2 + 0.45);
          if (walkIdx.has(px, pz) && walkIdx.has(px + tx * 0.8, pz + tz * 0.8) && walkIdx.has(px - tx * 0.8, pz - tz * 0.8))
            decals.decal(px, 0.153, pz, -nx * side, -nz * side, 0.8, 0.3, cell("tactile"));
        }
      }
    });

    // ---- park footpaths: grey asphalt edged with hexagonal pavers, never across Sheep Meadow
    for (const st of raw.streets) {
      if (st.rw !== 3 && st.rw !== 6) continue;
      const p = st.p;
      const w = Math.max(3, Math.min(st.w, 8));
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (!parkIdx.has(mx, mz) || inMeadow(mx, mz) || inMeadow(ax, az) || inMeadow(bx, bz)) continue;
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.3) continue;
        ribbon(paths, ax, az, bx, bz, -w / 2, w / 2, 0.128, w * 0.3);
        const u1 = (L + w * 0.6) / STRIP_M;
        ribbon(kerbs, ax, az, bx, bz, w / 2, w / 2 + 0.5, 0.133, 0.1, [0, u1, rowV(ROW.hex, 0), rowV(ROW.hex, 0.5)]);
        ribbon(kerbs, ax, az, bx, bz, -w / 2, -w / 2 - 0.5, 0.133, 0.1, [0, u1, rowV(ROW.hex, 0), rowV(ROW.hex, 0.5)]);
      }
    }

    const add = (list: { mesh: THREE.Mesh; cx: number; cz: number }[], r: number) => {
      for (const c of list) { c.mesh.geometry = cutRects(c.mesh.geometry, this.holes); this.root.add(c.mesh); this.dress.push({ ...c, r }); }
    };
    add(kerbs.build(m.kerbMat, { shadow: true }), 900);
    add(drives.build(m.driveMat, { shadow: true }), 1100);
    add(paths.build(m.pathMat, { shadow: true }), 1100);
    add(gutters.build(m.gutterMat, { shadow: true, order: 1 }), 700);
    add(paint.build(m.paintMat, { shadow: true, order: 2 }), 900);
    add(decals.build(m.decalMat, { shadow: true, order: 3 }), 450);
    add(text.build(m.decalMat, { shadow: true, order: 4 }), 600);
  }

  private trees(city: CityData, skip?: (x: number, z: number) => boolean) {
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
      if (skip?.(sp[0], sp[1])) continue;
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

  /** Trees and street dressing only near the player. */
  updateFocus(focus: THREE.Vector3) {
    for (const c of this.treeChunks) c.g.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < 520;
    for (const c of this.dress) c.mesh.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < c.r;
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
