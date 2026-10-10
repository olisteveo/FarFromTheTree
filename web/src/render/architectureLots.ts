// The lots between buildings that stay open (found offline by tools/buildings/gaps.ts into
// models/buildings_gaps.json): parking lots behind chain-link with a cashier's booth, lights,
// wheel stops and parked cars; construction sites behind painted plywood hoardings with sidewalk
// sheds, scaffolding against the neighbours, an excavator, a roll-off dumpster, portable toilets,
// stacked pipe and pallets, and a tower crane on the big ones. The old parks along the route
// (city.raw.sites, now building sites: ground.ts lays their dirt) get the same treatment.
// Everything is kit pieces (architectureKit.ts), so it is instanced and distance-culled.

import * as THREE from "three";
import type { CityData, Poly } from "../world/data";
import { inPoly, ringArea } from "../world/data";
import type { FacadeProp } from "../world/facades";
import type { ArchitectureKit } from "./architectureKit";
import type { FacadeQuality } from "./facades";
import { loadGaps, type GapsFile } from "./architectureInfill";
import { kitBase } from "./architectureModels";

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; return (x >>> 0) / 4294967296; };

const CARS = ["sedan", "sedan", "suv", "hatch", "van", "pickup", "sedan", "suv"];
const CAR_PAINT = [0x1c1c1e, 0xe8e8e8, 0x6d7278, 0x22344d, 0x7a1d1d, 0x2f4a3a, 0xb8b2a6, 0x3a3a3c, 0x8a8f94, 0xd0c8b8];

interface Edge { ax: number; az: number; bx: number; bz: number; tx: number; tz: number; nx: number; nz: number; L: number; front: boolean }

function edges(ring: number[], front: Set<number> | null): Edge[] {
  const n = ring.length / 2, out: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    // rings wind clockwise: (-tz, tx) points out of the lot
    out.push({ ax, az, bx, bz, tx, tz, nx: -tz, nz: tx, L, front: front ? front.has(i) : true });
  }
  return out;
}

export class LotsView {
  readonly root = new THREE.Group();
  private surfaces: THREE.Mesh[] = [];
  ready: Promise<void>;

  constructor(private city: CityData, private kit: ArchitectureKit, private quality: FacadeQuality, private solids: FacadeProp[] = []) {
    const K = kit;
    K.define("chainlink", 320, false);
    for (let i = 0; i < 4; i++) K.define(`hoarding_${i}`, 320, false);
    K.define("booth", 250, false);
    K.define("lot_light", 300, false);
    K.define("wheel_stop", 140, false);
    K.define("crane_mast", 1200, true);
    K.define("crane_top", 1200, true);
    K.define("dumpster", 250, false);
    K.define("toilet", 200, false);
    K.define("pipes", 220, false);
    K.define("pallets", 200, false);
    K.define("excavator", 280, false);
    K.define("shed", 260, true);
    K.define("scaffold", 260, false);
    K.define("jersey", 220, false);
    for (const c of new Set(CARS)) K.define(`car_${c}`, 170, false);
    this.ready = loadGaps().then((g) => this.build(g)).catch((e) => console.warn("lots didn't build", e));
  }

  private build(g: GapsFile | null) {
    const asphalt: THREE.BufferGeometry[] = [], dirt: THREE.BufferGeometry[] = [];
    for (const lot of g?.lots ?? []) {
      const ring = lot.p[0];
      // the file is made offline: skip a lot that a building now stands on (city.json changed since)
      let cx = 0, cz = 0;
      for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
      cx /= ring.length / 2; cz /= ring.length / 2;
      if (this.city.buildingAt(cx, cz) || [0, 2, 4].some((i) => this.city.buildingAt((ring[i] + cx) / 2, (ring[i + 1] + cz) / 2))) continue;
      const es = edges(ring, new Set(lot.front));
      if (!es.length) continue;
      const fronts = es.filter((e) => e.front);
      const main = (fronts.length ? fronts : es).reduce((a, b) => (b.L > a.L ? b : a));
      (lot.kind === "parking" ? asphalt : dirt).push(this.surface(lot.p, main));
      if (lot.kind === "parking") this.parking(lot.p, es, main, lot.k);
      else this.construction(lot.p, es, lot.k, true);
    }
    // the old parks along the route, now building sites
    this.city.raw.sites.forEach((s, i) => {
      const es = edges(s.p[0], null);
      if (es.length) this.construction(s.p, es, i * 7919 + 3, false);
    });
    const T = (name: string) => {
      const t = new THREE.TextureLoader().load(`${kitBase()}models/${name}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    const add = (list: THREE.BufferGeometry[], tex: string, rough: number) => {
      if (!list.length) return;
      const geo = mergeAll(list);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T(tex), roughness: rough, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.receiveShadow = true;
      this.surfaces.push(m);
      this.root.add(m);
    };
    add(asphalt, "buildings_lot_asphalt.webp", 0.9);
    add(dirt, "buildings_site_dirt.webp", 1);
    this.loadCars();
  }

  /** a flat surface with uvs along the lot's main frontage (stall lines run across it) */
  private surface(p: Poly, main: Edge): THREE.BufferGeometry {
    const contour = [], holes: THREE.Vector2[][] = [];
    for (let i = 0; i < p[0].length; i += 2) contour.push(new THREE.Vector2(p[0][i], p[0][i + 1]));
    for (const h of p.slice(1)) { const v: THREE.Vector2[] = []; for (let i = 0; i < h.length; i += 2) v.push(new THREE.Vector2(h[i], h[i + 1])); holes.push(v); }
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...contour, ...holes.flat()];
    const pos = new Float32Array(all.length * 3), uv = new Float32Array(all.length * 2), nor = new Float32Array(all.length * 3);
    all.forEach((v, i) => {
      pos.set([v.x, 0.05, v.y], i * 3);
      nor.set([0, 1, 0], i * 3);
      const rx = v.x - main.ax, rz = v.y - main.az;
      uv.set([(rx * main.tx + rz * main.tz) / 8, (-(rx * main.nx + rz * main.nz) - 0.0) / 8], i * 2);
    });
    const idx: number[] = [];
    for (const f of faces) idx.push(f[0], f[2], f[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g.toNonIndexed();
  }

  // ---------------------------------------------------------------- placing
  private m = new THREE.Matrix4();
  private basis = new THREE.Matrix4();
  private place(name: string, x: number, y: number, z: number, tx: number, tz: number, sx = 1, sy = 1, sz = 1, colour?: THREE.Color) {
    const xa = new THREE.Vector3(tx, 0, tz), ya = new THREE.Vector3(0, 1, 0), za = new THREE.Vector3().crossVectors(xa, ya);
    this.basis.makeBasis(xa, ya, za);
    this.m.copy(this.basis).scale(new THREE.Vector3(sx, sy, sz)).setPosition(x, y, z);
    this.kit.add(name, this.m, colour);
  }
  private solid(x: number, y: number, z: number, tx: number, tz: number, hw: number, hh: number, hd: number) {
    this.solids.push({ kind: "solid", x, y, z, tx, tz, nx: -tz, nz: tx, hw, hh, hd, seed: 0 });
  }

  /** panels of `w` metres along an edge (stretched to fit), skipping a gate of `gate` metres at `gateAt` (0..1) */
  private fence(e: Edge, piece: (i: number) => string, w: number, gate = 0, gateAt = 0.5, out = 0) {
    const n = Math.max(1, Math.round(e.L / w));
    const pw = e.L / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * pw;
      if (gate && Math.abs(t - e.L * gateAt) < gate / 2) continue;
      this.place(piece(i), e.ax + e.tx * t + e.nx * out, 0, e.az + e.tz * t + e.nz * out, e.tx, e.tz, pw / w, 1, 1);
    }
    this.solid(e.ax + e.tx * e.L / 2, 1.2, e.az + e.tz * e.L / 2, e.tx, e.tz, e.L / 2, 1.2, 0.15);
  }

  private inside(p: Poly, x: number, z: number, r: number) {
    return [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => inPoly(p, x + dx, z + dz));
  }

  private parking(p: Poly, es: Edge[], main: Edge, seed: number) {
    const r = (k: number) => hash(seed, k);
    const gateAt = 0.2 + 0.6 * r(1);
    for (const e of es) if (e.front) this.fence(e, () => "chainlink", 3, e === main ? 7 : 0, gateAt);
    // the booth by the gate, a light or two
    const gx = main.ax + main.tx * main.L * gateAt - main.nx * 2.5, gz = main.az + main.tz * main.L * gateAt - main.nz * 2.5;
    const bx = gx + main.tx * 5, bz = gz + main.tz * 5;
    if (this.inside(p, bx, bz, 1.2)) { this.place("booth", bx, 0, bz, main.tx, main.tz); this.solid(bx, 1.2, bz, main.tx, main.tz, 0.9, 1.2, 0.8); }
    // stalls in rows of 8/3 m (the painted lines), 8 m apart, noses to the line
    const area = Math.abs(ringArea(p[0]));
    let lights = 0;
    for (let v = 3.7; v < 120; v += 8) {
      for (let u = 4 / 3; u < main.L + 40; u += 8 / 3) {
        const x = main.ax + main.tx * u - main.nx * v, z = main.az + main.tz * u - main.nz * v;
        if (!this.inside(p, x, z, 2.6)) continue;
        const k = Math.round(u * 10) * 7 + Math.round(v);
        if (r(k + 3) < 0.66) {
          const car = CARS[Math.floor(r(k + 5) * CARS.length)];
          // facing the stall line (-n side), a little crooked
          const a = Math.atan2(main.nx, main.nz) + (r(k + 9) - 0.5) * 0.08 + (r(k + 11) < 0.15 ? Math.PI : 0);
          this.place(`car_${car}`, x, 0.02, z, Math.cos(a), -Math.sin(a), 1, 1, 1, new THREE.Color(CAR_PAINT[Math.floor(r(k + 7) * CAR_PAINT.length)]));
        }
        const wx = x + main.nx * 2.2, wz = z + main.nz * 2.2;
        if (r(k + 13) < 0.8) this.place("wheel_stop", wx, 0.05, wz, main.tx, main.tz);
        if (lights < Math.max(1, area / 1200) && r(k + 17) < 0.06) { lights++; this.place("lot_light", x + main.tx * 1.33, 0.05, z + main.tz * 1.33, main.tx, main.tz); }
      }
    }
  }

  private construction(p: Poly, es: Edge[], seed: number, sheds: boolean) {
    const r = (k: number) => hash(seed, k);
    const ring = p[0];
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
    cx /= ring.length / 2; cz /= ring.length / 2;
    const area = Math.abs(ringArea(ring));
    const fronts = es.filter((e) => e.front);
    const main = (fronts.length ? fronts : es).reduce((a, b) => (b.L > a.L ? b : a));
    // plywood hoardings round the street fronts (a truck gate on the longest), sidewalk sheds outside
    for (const e of fronts) {
      const v0 = Math.floor(r(Math.round(e.ax)) * 4);
      this.fence(e, (i) => `hoarding_${(v0 + i) % 4}`, 2.4, e === main && e.L > 14 ? 8 : 0, 0.3 + 0.4 * r(2));
      if (sheds && e.L > 6 && r(Math.round(e.az)) < 0.75) {
        const n = Math.max(1, Math.round(e.L / 3));
        for (let i = 0; i < n; i++) this.place("shed", e.ax + e.tx * (i + 0.5) * e.L / n, 0, e.az + e.tz * (i + 0.5) * e.L / n, e.tx, e.tz, e.L / n / 3, 1, 0.8);
        this.solid(e.ax + e.tx * e.L / 2 + e.nx * 1.2, 3.3, e.az + e.tz * e.L / 2 + e.nz * 1.2, e.tx, e.tz, e.L / 2, 0.25, 1.2);
      }
    }
    // scaffolding against the neighbours' walls (the back edges), a few lifts up
    if (sheds) {
      for (const e of es) {
        if (e.front || e.L < 4) continue;
        const lifts = 2 + Math.floor(r(Math.round(e.bx)) * 5);
        const n = Math.max(1, Math.round(e.L / 2.5));
        for (let i = 0; i < n; i++) {
          if (r(i * 31 + Math.round(e.bz)) < 0.25) continue;
          const t = (i + 0.5) * e.L / n;
          for (let l = 0; l < lifts; l++) this.place("scaffold", e.ax + e.tx * t, l * 2.05, e.az + e.tz * t, -e.tx, -e.tz, e.L / n / 2.5, 1, 1);
        }
      }
    }
    // the yard: machines and materials, kept inside the lot
    const spot = (k: number, rad: number): [number, number] | null => {
      for (let t = 0; t < 14; t++) {
        const x = cx + (r(k * 17 + t) - 0.5) * Math.sqrt(area) * 0.8, z = cz + (r(k * 19 + t) - 0.5) * Math.sqrt(area) * 0.8;
        if (this.inside(p, x, z, rad)) return [x, z];
      }
      return null;
    };
    const items: [string, number, number][] = [["excavator", 4, 0.7], ["dumpster", 3.4, 0.9], ["toilet", 1.0, 0.8], ["pipes", 3.2, 0.6], ["pallets", 1.5, 0.8], ["jersey", 1.8, 0.5]];
    items.forEach(([name, rad, chance], k) => {
      const reps = name === "toilet" ? 2 : name === "pallets" || name === "jersey" ? 3 : 1;
      if (r(k + 50) > chance) return;
      const s = spot(k + 3, rad);
      if (!s) return;
      const a = r(k + 60) * Math.PI * 2;
      for (let j = 0; j < reps; j++) {
        const ox = name === "toilet" ? j * 1.25 : name === "jersey" ? j * 3.05 : j * 1.6, oz = name === "pallets" ? (j % 2) * 1.4 : 0;
        const x = s[0] + Math.cos(a) * ox - Math.sin(a) * oz, z = s[1] - Math.sin(a) * ox - Math.cos(a) * oz;
        this.place(name, x, 0.04, z, Math.cos(a), -Math.sin(a));
      }
      if (name === "dumpster") this.solid(s[0], 0.8, s[1], Math.cos(a), -Math.sin(a), 3, 0.8, 1.2);
      if (name === "excavator") this.solid(s[0], 1.5, s[1], Math.cos(a), -Math.sin(a), 2.2, 1.5, 1.5);
    });
    // a tower crane on the big sites
    if (area > 1100) {
      const s = spot(99, 3);
      if (s) {
        const H = 42 + Math.floor(r(100) * 7) * 6;
        const n = Math.round(H / 6);
        for (let i = 0; i < n; i++) this.place("crane_mast", s[0], i * 6, s[1], 1, 0);
        const a = r(101) * Math.PI * 2;
        this.place("crane_top", s[0], n * 6, s[1], Math.cos(a), -Math.sin(a));
        this.solid(s[0], n * 3, s[1], 1, 0, 1.1, n * 3, 1.1);
      }
    }
  }

  // ---------------------------------------------------------------- parked cars (the traffic's own models)
  private async loadCars() {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(`${kitBase()}models/vehicles.glb`);
      const parts = new Map<string, { geo: THREE.BufferGeometry; mats: THREE.Material[] }>();
      const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
      for (const name of new Set(CARS)) {
        const obj = gltf.scene.getObjectByName(name);
        if (!obj) continue;
        obj.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
        const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
          const keep = new THREE.BufferGeometry();
          keep.setAttribute("position", g.attributes.position);
          keep.setAttribute("normal", g.attributes.normal);
          if (g.attributes.uv) keep.setAttribute("uv", g.attributes.uv);
          else keep.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (g.index) keep.setIndex(g.index);
          geos.push(keep.index ? keep.toNonIndexed() : keep);
          const src = mesh.material as THREE.MeshStandardMaterial;
          const mat = src.clone();
          if (src.name === "paint") mat.color.set(0xffffff);
          else {
            // only the paint takes the per-car colour
            mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("vColor.xyz *= instanceColor.xyz;", ""); };
            mat.customProgramCacheKey = () => "fftt-parked-" + src.name;
          }
          if (/light/.test(src.name)) mat.emissiveIntensity = 0;   // parked: lights off
          mats.push(mat);
        });
        if (!geos.length) continue;
        const geo = mergeGeometries(geos, true);
        if (geo) parts.set(`car_${name}`, { geo, mats });
      }
      if (parts.size) this.kit.useModels(parts);
    } catch (e) { console.warn("parked cars didn't load", e); }
  }

  update(_focus: THREE.Vector3) { void this.quality; }
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const n = list.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
