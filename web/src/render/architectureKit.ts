// The architecture kit: modelled pieces (tools/buildings/kit_blender.py -> models/buildings_kit.glb)
// instanced on and around the buildings: fire escapes, cornice brackets, awnings, lobby canopies,
// blade signs, water towers, bulkheads, chimneys, HVAC, skylights, masts, scaffolding, sidewalk
// sheds, chain-link fences, hoardings, cranes... Every piece also has a simple procedural stand-in,
// drawn until the GLB arrives (and for good if it doesn't).
//
// Instances live in one big list per piece with a coarse grid; each frame the pieces near the
// camera are copied into one InstancedMesh per piece (rebuilt only when the camera has moved),
// so the whole kit is a few dozen draw calls however big the city is.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ------------------------------------------------------------------ stand-in geometry

function vc(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const col = new THREE.Color(c), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}
const bx = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => vc(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), c);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: number, seg = 12) => vc(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z), c);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

/** Stand-ins, built at unit scale around their own origin (y = 0 at the base). Facade pieces: x along the wall, z out of it. */
function standIns(): Record<string, () => THREE.BufferGeometry> {
  return {
    water_tower: () => merge([
      cyl(1, 1, 3.6, 0, 2.6, 0, 0x6e4c34, 16), vc(new THREE.ConeGeometry(1.08, 0.9, 16).translate(0, 6.65, 0), 0x5a3c28),
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => bx(0.12, 2.6, 0.12, a * 0.7, 0, c * 0.7, 0x3a3a3a)),
      bx(1.6, 0.08, 1.6, 0, 2.55, 0, 0x4a4a4a),
      ...[0.9, 1.8, 2.7].map((y) => vc(new THREE.TorusGeometry(1.01, 0.03, 4, 20).rotateX(Math.PI / 2).translate(0, 2.6 + y, 0), 0x2a2a2a)),
    ]),
    steel_tank: () => merge([cyl(1.4, 1.4, 4.2, 0, 1.2, 0, 0xb8bcc0, 18), bx(2.4, 1.2, 2.4, 0, 0, 0, 0x6a6a6a)]),
    bulkhead: () => merge([bx(3, 2.6, 3.4, 0, 0, 0, 0x8c8378), bx(0.95, 2.1, 0.04, 0.6, 0, 1.72, 0x4a3a2e), bx(3.2, 0.16, 3.6, 0, 2.6, 0, 0x5a554e)]),
    hvac: () => merge([...[-1.6, 0, 1.6].map((x) => bx(1.4, 1.1, 1.4, x, 0, 0, 0x9aa0a4)), ...[-1.6, 0, 1.6].map((x) => vc(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16).translate(x, 1.12, 0), 0x2a2a2a)), bx(4.6, 0.2, 1.8, 0, 0, 0, 0x5a5a5a)]),
    condenser: () => merge([bx(1.0, 0.9, 1.0, 0, 0.1, 0, 0xa8acae), vc(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 14).translate(0, 1.01, 0), 0x2a2a2a), bx(1.1, 0.1, 1.1, 0, 0, 0, 0x5a5a5a)]),
    chimney: () => merge([bx(0.9, 2.4, 0.7, 0, 0, 0, 0x8a3e30), bx(1.0, 0.18, 0.8, 0, 2.4, 0, 0x6a6058), cyl(0.14, 0.14, 0.5, 0.18, 2.58, 0, 0x5a3a2a, 6), cyl(0.14, 0.14, 0.4, -0.18, 2.58, 0, 0x5a3a2a, 6)]),
    vent: () => merge([cyl(0.12, 0.12, 0.9, 0, 0, 0, 0x8a8a8a, 6), vc(new THREE.TorusGeometry(0.22, 0.12, 6, 8, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.9, 0.22), 0x8a8a8a)]),
    fan: () => merge([cyl(0.3, 0.3, 0.5, 0, 0, 0, 0x9a9c9c, 10), vc(new THREE.ConeGeometry(0.45, 0.3, 10).translate(0, 0.65, 0), 0x9a9c9c)]),
    dish: () => merge([vc(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.1).translate(0, 1.0, 0), 0xdcdcd8), cyl(0.04, 0.04, 1, 0, 0, 0, 0x5a5a5a, 5)]),
    skylight: () => merge([bx(2.4, 0.4, 1.6, 0, 0, 0, 0x6a6058), vc(new THREE.ConeGeometry(1.35, 0.9, 4).rotateY(Math.PI / 4).scale(1, 1, 0.7).translate(0, 0.85, 0), 0x6a8a9a)]),
    mast: () => merge([cyl(0.06, 0.1, 9, 0, 0, 0, 0x5a5a5a, 6), ...[3, 5, 7].map((y) => bx(1.2, 0.05, 0.05, 0, y, 0, 0x5a5a5a)), vc(new THREE.SphereGeometry(0.12, 6, 4).translate(0, 9.05, 0), 0xff3a2a)]),
    solar: () => merge([...[-1.4, 0, 1.4].map((x) => vc(new THREE.BoxGeometry(1.2, 0.05, 2).rotateX(-0.45).translate(x, 0.6, 0), 0x1f2a44)), bx(4.2, 0.25, 0.2, 0, 0, -0.7, 0x5a5a5a), bx(4.2, 0.6, 0.2, 0, 0, 0.7, 0x5a5a5a)]),
    billboard: () => merge([...[-3.5, 3.5].map((x) => bx(0.25, 6, 0.25, x, 0, 0, 0x3a3a3a)), bx(9, 4.2, 0.2, 0, 6, 0, 0xf0f0f0), ...[1, 3, 5].map((y) => bx(7.5, 0.1, 0.1, 0, y, -0.15, 0x3a3a3a))]),
    coop: () => merge([bx(2.4, 1.6, 1.6, 0, 0.3, 0, 0xb09070), vc(new THREE.ConeGeometry(1.8, 0.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.75).translate(0, 2.2, 0), 0x6a4a3a), bx(2.5, 0.3, 1.7, 0, 0, 0, 0x5a5a5a)]),
    laundry: () => merge([...[-2, 2].map((x) => cyl(0.04, 0.04, 2, x, 0, 0, 0x5a5a5a, 4)), ...[-1.4, -0.7, 0.1, 0.8, 1.5].map((x, i) => vc(new THREE.PlaneGeometry(0.45, 0.6).translate(x, 1.65, 0), [0xc8382a, 0xf0ece0, 0x2a5a9a, 0xe0b423, 0xd27aa2][i]))]),
    deck: () => merge([bx(5.5, 0.12, 4, 0, 0, 0, 0x7a5a3a), bx(0.8, 0.05, 0.8, 0, 0.75, 0, 0x2a2a2a), cyl(0.04, 0.04, 0.62, 0, 0.12, 0, 0x2a2a2a, 5), ...[-0.8, 0.8].map((x) => bx(0.45, 0.06, 0.45, x, 0.55, 0.1, 0xb8a080)), ...[-2.7, 2.7].map((x) => cyl(0.03, 0.03, 2.4, x, 0, 1.9, 0x2a2a2a, 4))]),
    roof_rail: () => merge([bx(1, 0.05, 0.05, 0, 1.05, 0, 0x6a6a68), bx(0.05, 1.05, 0.05, -0.475, 0, 0, 0x6a6a68)]),
    // facade pieces (x along the wall, z out of it, y up from the landing)
    fire_escape: () => merge([bx(4.6, 0.06, 1.1, 0, 0, 0.6, 0x1c1c1c), bx(4.6, 0.04, 0.04, 0, 1.0, 1.13, 0x1c1c1c), ...[-2.28, 2.28].map((x) => bx(0.04, 1.0, 1.1, x, 0, 0.6, 0x1c1c1c)),
      ...Array.from({ length: 12 }, (_, i) => bx(0.02, 1.0, 0.02, -2.2 + i * 0.4, 0, 1.13, 0x1c1c1c)), vc(new THREE.BoxGeometry(0.5, 0.05, 3.4).rotateX(-0.95).rotateY(Math.PI / 2).translate(0.4, -1.55, 0.75), 0x1c1c1c)]),
    fire_escape_top: () => merge([bx(4.6, 0.06, 1.1, 0, 0, 0.6, 0x1c1c1c), bx(4.6, 0.04, 0.04, 0, 1.0, 1.13, 0x1c1c1c), ...[-2.28, 2.28].map((x) => bx(0.04, 1.0, 1.1, x, 0, 0.6, 0x1c1c1c)),
      ...Array.from({ length: 12 }, (_, i) => bx(0.02, 1.0, 0.02, -2.2 + i * 0.4, 0, 1.13, 0x1c1c1c)), vc(new THREE.BoxGeometry(0.5, 0.05, 3.4).rotateX(-0.95).rotateY(Math.PI / 2).translate(0.4, -1.55, 0.75), 0x1c1c1c),
      bx(0.04, 3.4, 0.04, 1.9, 0, 0.9, 0x1c1c1c), bx(0.04, 3.4, 0.04, 2.3, 0, 0.9, 0x1c1c1c)]),
    fire_escape_bottom: () => merge([bx(4.6, 0.06, 1.1, 0, 0, 0.6, 0x1c1c1c), bx(4.6, 0.04, 0.04, 0, 1.0, 1.13, 0x1c1c1c), ...[-2.28, 2.28].map((x) => bx(0.04, 1.0, 1.1, x, 0, 0.6, 0x1c1c1c)),
      bx(0.04, 2.6, 0.04, 1.6, -2.6, 0.9, 0x1c1c1c), bx(0.04, 2.6, 0.04, 2.0, -2.6, 0.9, 0x1c1c1c), ...Array.from({ length: 8 }, (_, i) => bx(0.42, 0.03, 0.03, 1.8, -2.5 + i * 0.32, 0.9, 0x1c1c1c))]),
    water_tower_far: () => merge([cyl(1, 1, 3.6, 0, 2.6, 0, 0x6e4c34, 8), vc(new THREE.ConeGeometry(1.08, 0.9, 8).translate(0, 6.65, 0), 0x5a3c28), bx(1.5, 2.6, 0.1, 0, 0, 0, 0x3a3a3a), bx(0.1, 2.6, 1.5, 0, 0, 0, 0x3a3a3a)]),
    elevator: () => merge([bx(5, 4.5, 5, 0, 0, 0, 0xc8c0b4), bx(5.2, 0.2, 5.2, 0, 4.5, 0, 0x5a554e)]),
    hatch: () => merge([bx(0.9, 0.5, 0.9, 0, 0, 0, 0x6a6460)]),
    bracket: () => merge([bx(0.18, 0.55, 0.45, 0, -0.55, 0.22, 0xe0dccf)]),
    awning: () => merge([vc(new THREE.BoxGeometry(1, 0.03, 1.25).rotateX(0.35).translate(0, 0, 0.6), 0xffffff), bx(1, 0.28, 0.02, 0, -0.5, 1.18, 0xffffff)]),
    canopy: () => merge([bx(3.4, 0.3, 4.2, 0, 0, 2.1, 0x2a2a2a), ...[-1.5, 1.5].map((x) => cyl(0.05, 0.05, 3.3, x, -3.3, 4.0, 0x8a7a50, 6))]),
    blade_sign: () => merge([bx(0.15, 2.4, 1.0, 0, -1.2, 0.75, 0xffffff), bx(0.05, 0.05, 0.4, 0, 1.1, 0.2, 0x2a2a2a), bx(0.05, 0.05, 0.4, 0, -1.1, 0.2, 0x2a2a2a)]),
    // street-level kit
    scaffold: () => merge([...[[-1.2, 0], [1.2, 0], [-1.2, 1.1], [1.2, 1.1]].map(([x, z]) => bx(0.05, 2, 0.05, x, 0, z, 0x9a9c9a)), bx(2.5, 0.06, 1.2, 0, 1.94, 0.55, 0x8a6a40), bx(2.4, 0.04, 0.04, 0, 1.0, 1.1, 0x9a9c9a), bx(2.4, 1.94, 0.02, 0, 0, 1.15, 0x2a5a9a)]),
    shed: () => merge([bx(3, 0.25, 3, 0, 3.0, 1.5, 0x2e4a32), ...[0.2, 2.8].flatMap((z) => [bx(0.12, 3.0, 0.12, -1.4, 0, z, 0x2e4a32), bx(0.12, 3.0, 0.12, 1.4, 0, z, 0x2e4a32)]), bx(3, 0.8, 0.05, 0, 3.25, 2.98, 0x2e4a32)]),
    hoarding: () => merge([bx(2.4, 2.6, 0.05, 0, 0, 0, 0x2f5d8a), bx(0.08, 2.6, 0.12, -1.2, 0, -0.08, 0x5a4a3a)]),
    chainlink: () => merge([vc(new THREE.PlaneGeometry(3, 2.4).translate(0, 1.2, 0), 0x9a9c9c), cyl(0.04, 0.04, 2.5, -1.5, 0, 0, 0x8a8c8c, 6), bx(3, 0.03, 0.03, 0, 2.4, 0, 0x8a8c8c)]),
    crane_mast: () => merge([bx(2, 6, 2, 0, 0, 0, 0xe0a81e)]),
    crane_top: () => merge([bx(1.4, 1.6, 60, 0, 0.5, 24, 0xe0a81e), bx(1.6, 1.4, 14, 0, 0.5, -8, 0xe0a81e), bx(3, 2.6, 4, 0, -1, -12, 0x55585c), bx(2.6, 2.4, 2.6, 1.8, -2.4, 0, 0x55585c), vc(new THREE.ConeGeometry(1.2, 8, 4).translate(0, 6, 0), 0xe0a81e)]),
    dumpster: () => merge([bx(4, 1.6, 1.9, 0, 0, 0, 0x2a5a8a)]),
    toilet: () => merge([bx(1.1, 2.3, 1.1, 0, 0, 0, 0x2a6a9a)]),
    booth: () => merge([bx(1.8, 2.4, 1.6, 0, 0, 0, 0xd8d0b8), bx(2.0, 0.12, 1.8, 0, 2.4, 0, 0x3a3a3a)]),
    jersey: () => merge([vc(new THREE.CylinderGeometry(0.15, 0.3, 0.8, 4, 1).rotateY(Math.PI / 4).scale(4.2, 1, 1).translate(0, 0.4, 0), 0xb0aca4)]),
    wheel_stop: () => merge([bx(1.8, 0.12, 0.2, 0, 0, 0, 0xc8c4bc)]),
    lot_light: () => merge([cyl(0.08, 0.1, 7, 0, 0, 0, 0x5a5a5a, 6), bx(0.9, 0.2, 0.4, 0.4, 7, 0, 0x4a4a4a)]),
    pipes: () => merge([...[0, 1, 2, 3, 4].map((i) => vc(new THREE.CylinderGeometry(0.3, 0.3, 6, 10).rotateZ(Math.PI / 2).translate(0, 0.3 + (i > 2 ? 0.52 : 0), -1 + (i % 3) * 0.62 + (i > 2 ? 0.31 : 0)), 0x6a6460))]),
    pallets: () => merge([bx(1.2, 0.15, 1.0, 0, 0, 0, 0x9a7a50), bx(1.0, 0.9, 0.9, 0, 0.15, 0, 0xc8c0b0)]),
    car: () => merge([bx(1.8, 0.75, 4.4, 0, 0.3, 0, 0xffffff), bx(1.6, 0.55, 2.2, 0, 1.05, -0.2, 0x1d2630)]),
    excavator: () => merge([bx(3.2, 0.9, 2.4, 0, 0, 0, 0x2a2a2a), bx(2.8, 1.4, 2.4, -0.2, 0.9, 0, 0xe0a81e), bx(1.2, 1.3, 1.1, 0.7, 2.3, 0.5, 0xe0a81e), vc(new THREE.BoxGeometry(0.35, 0.35, 4.2).rotateX(0.5).translate(0, 3.0, 1.9), 0xe0a81e)]),
  };
}

export type KitName = string;

// ------------------------------------------------------------------ instancing

interface KitPiece {
  name: KitName;
  /** instance matrices (16 floats each) and optional colours */
  m: number[];
  c: number[] | null;
  /** grid cell -> instance indices */
  cells: Map<number, number[]>;
  near: number;   // draw radius (metres)
  shadow: boolean;
  mesh: THREE.InstancedMesh | null;
  far?: KitName;  // a lower-detail piece drawn beyond `lodAt`
  lodAt?: number;
}

const CELL = 100;
const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

export interface KitOptions { quality: "low" | "medium" | "high" }

export class ArchitectureKit {
  readonly root = new THREE.Group();
  private pieces = new Map<KitName, KitPiece>();
  private stand = standIns();
  private standMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15 });
  private glbParts: Map<string, { geo: THREE.BufferGeometry; mats: THREE.Material[] }> | null = null;
  private last = new THREE.Vector3(1e9, 0, 1e9);
  private dirty = true;
  private scale: number;
  drawDistance = 900;

  constructor(private opts: KitOptions) {
    this.scale = opts.quality === "low" ? 0.55 : opts.quality === "medium" ? 0.8 : 1;
  }

  /** Register a piece type: draw radius, shadows, and an optional far LOD piece. */
  define(name: KitName, near: number, shadow: boolean, far?: { name: KitName; at: number }) {
    if (this.pieces.has(name)) return;
    this.pieces.set(name, { name, m: [], c: null, cells: new Map(), near, shadow, mesh: null, far: far?.name, lodAt: far?.at });
    if (far) this.define(far.name, near, shadow);
  }

  /** Place one instance. colour: optional per-instance tint (multiplies the material). */
  add(name: KitName, mat: THREE.Matrix4, colour?: THREE.Color) {
    const p = this.pieces.get(name);
    if (!p) throw new Error("kit piece not defined: " + name);
    const i = p.m.length / 16;
    for (const v of mat.elements) p.m.push(v);
    if (colour) {
      if (!p.c) p.c = new Array(i * 3).fill(1);
      p.c.push(colour.r, colour.g, colour.b);
    } else if (p.c) p.c.push(1, 1, 1);
    const x = mat.elements[12], z = mat.elements[14];
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    (p.cells.get(k) ?? p.cells.set(k, []).get(k)!).push(i);
    this.dirty = true;
  }

  count(name: KitName) { return (this.pieces.get(name)?.m.length ?? 0) / 16; }

  /** Swap the stand-ins for the modelled pieces. */
  useModels(parts: Map<string, { geo: THREE.BufferGeometry; mats: THREE.Material[] }>) {
    this.glbParts = new Map([...(this.glbParts ?? []), ...parts]);
    for (const p of this.pieces.values()) if (p.mesh) { this.root.remove(p.mesh); p.mesh.dispose(); p.mesh = null; }
    this.dirty = true;
  }

  private meshFor(p: KitPiece, n: number): THREE.InstancedMesh {
    if (p.mesh && p.mesh.instanceMatrix.count >= n) return p.mesh;
    const cap = Math.max(16, Math.ceil(n * 1.5));
    if (p.mesh) { this.root.remove(p.mesh); p.mesh.dispose(); }
    const glb = this.glbParts?.get(p.name);
    let geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[];
    if (glb) { geo = glb.geo; mat = glb.mats.length === 1 ? glb.mats[0] : glb.mats; }
    else { geo = (this.stand[p.name] ?? this.stand[p.name.replace(/_\d+$/, "")] ?? (p.name.startsWith("car_") ? this.stand.car : this.stand.bulkhead))(); mat = this.standMat; }
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.castShadow = p.shadow && this.opts.quality !== "low";
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    if (p.c) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.name = "kit:" + p.name;
    this.root.add(m);
    p.mesh = m;
    return m;
  }

  /** Copy the instances near the camera into the meshes (only when the camera has moved a little). */
  update(focus: THREE.Vector3, force = false) {
    if (!force && !this.dirty && Math.hypot(focus.x - this.last.x, focus.z - this.last.z) < 25) return;
    this.last.copy(focus);
    this.dirty = false;
    const fx = focus.x, fz = focus.z;
    const fill = (p: KitPiece, src: KitPiece, idx: number[]) => {
      if (!idx.length) { if (p.mesh) { p.mesh.count = 0; p.mesh.visible = false; } return; }
      if (src.c && !p.c) p.c = [];
      const m = this.meshFor(p, idx.length);
      const arr = m.instanceMatrix.array as Float32Array;
      const col = m.instanceColor ? (m.instanceColor.array as Float32Array) : null;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        for (let e = 0; e < 16; e++) arr[k * 16 + e] = src.m[i * 16 + e];
        if (col && src.c) { col[k * 3] = src.c[i * 3]; col[k * 3 + 1] = src.c[i * 3 + 1]; col[k * 3 + 2] = src.c[i * 3 + 2]; }
      }
      m.count = idx.length;
      m.visible = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    for (const p of this.pieces.values()) {
      if (!p.m.length) continue;   // far-LOD pieces have no instances of their own: their owner fills them
      const R = Math.min(this.drawDistance, p.near * this.scale);
      const far = p.far ? this.pieces.get(p.far)! : null;
      const lod = (p.lodAt ?? Infinity) * this.scale;
      const near: number[] = [], beyond: number[] = [];
      const c0x = Math.floor((fx - R) / CELL), c1x = Math.floor((fx + R) / CELL), c0z = Math.floor((fz - R) / CELL), c1z = Math.floor((fz + R) / CELL);
      for (let ix = c0x; ix <= c1x; ix++) for (let iz = c0z; iz <= c1z; iz++) {
        const idx = p.cells.get(key(ix, iz));
        if (!idx) continue;
        for (const i of idx) {
          const dx = p.m[i * 16 + 12] - fx, dz = p.m[i * 16 + 14] - fz, d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          if (far && d2 > lod * lod) beyond.push(i); else near.push(i);
        }
      }
      fill(p, p, near);
      if (far) fill(far, p, beyond);
    }
  }
  /** Total instances per piece (for the report / debugging). */
  stats(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const p of this.pieces.values()) if (p.m.length) o[p.name] = p.m.length / 16;
    return o;
  }
}
