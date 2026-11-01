// Draws the facade clutter (world/facades.ts): AC units, balconies with a table and two
// chairs, cats in open windows (with a lit room behind), and washing lines with clothes.
// Instanced per 280 m chunk and only drawn near the camera.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FacadeProp, Facades } from "../world/facades";
import type { AirSample, Airflow } from "../world/airflow";
import { loadKitModels } from "./architectureModels";
import { WINDOW_BOX, WINDOW_BOX_DEAD, balconyGeometries } from "./balconyKinds";
import { MAX_SPOTS, clothMesh, garment, pickGarment, type ClothUniforms } from "./cloth";

const CHUNK = 280;

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);

// local frame: x along the wall, y up, z out from the wall
const AC = mergeGeometries([
  box(0.76, 0.48, 0.6, 0, 0, 0, 0xc9c3b4),
  box(0.6, 0.3, 0.02, 0, 0.02, 0.31, 0x4a4a46),          // grille
  box(0.8, 0.04, 0.5, 0, -0.27, -0.05, 0x6b6b66),         // bracket
])!;
const BALCONY = mergeGeometries([
  box(2.8, 0.14, 1.5, 0, 0, 0, 0xb0aca4),                 // slab
  box(2.8, 0.05, 0.05, 0, 0.95, 0.73, 0x3a3b3d),          // top rail
  box(0.05, 0.05, 1.5, -1.38, 0.95, 0, 0x3a3b3d),
  box(0.05, 0.05, 1.5, 1.38, 0.95, 0, 0x3a3b3d),
  ...[-1.38, -0.92, -0.46, 0, 0.46, 0.92, 1.38].map((x) => box(0.03, 0.88, 0.03, x, 0.5, 0.73, 0x3a3b3d)), // balusters
  ...[-0.4, 0.4].flatMap((z) => [box(0.03, 0.88, 0.03, -1.38, 0.5, z, 0x3a3b3d), box(0.03, 0.88, 0.03, 1.38, 0.5, z, 0x3a3b3d)]),
  box(0.6, 0.04, 0.6, 0.5, 0.75, 0.05, 0x6b4a32),          // table top
  box(0.05, 0.68, 0.05, 0.5, 0.41, 0.05, 0x3a3a3a),        // table leg
  box(0.36, 0.05, 0.36, 0.0, 0.48, 0.15, 0x7a5a3a),        // chair seat
  box(0.36, 0.42, 0.04, 0.0, 0.72, -0.03, 0x7a5a3a),       // chair back
  box(0.36, 0.05, 0.36, 1.0, 0.48, 0.0, 0x7a5a3a),
  box(0.04, 0.42, 0.36, 1.18, 0.72, 0.0, 0x7a5a3a),
  box(0.3, 0.32, 0.3, -1.0, 0.23, 0.4, 0x5a3a2a),          // a plant pot
  colored(new THREE.IcosahedronGeometry(0.28, 0).translate(-1.0, 0.6, 0.4), 0x5a5a32),
])!;
const CAT = mergeGeometries([
  colored(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.9, 1.3).translate(0, 0.13, 0.02), 0x1e1c1c),
  colored(new THREE.SphereGeometry(0.1, 8, 6).translate(0, 0.32, 0.1), 0x1e1c1c),
  colored(new THREE.ConeGeometry(0.035, 0.08, 4).translate(-0.05, 0.42, 0.1), 0x1e1c1c),
  colored(new THREE.ConeGeometry(0.035, 0.08, 4).translate(0.05, 0.42, 0.1), 0x1e1c1c),
  colored(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 5).rotateZ(1.2).translate(0.18, 0.08, -0.05), 0x1e1c1c),
  box(0.03, 0.02, 0.01, -0.035, 0.33, 0.195, 0xd8e86a),     // eyes
  box(0.03, 0.02, 0.01, 0.035, 0.33, 0.195, 0xd8e86a),
  box(0.95, 1.25, 0.02, 0, 0.35, -0.22, 0xffc27a),          // the warm room behind the open window
])!;

const hash01 = (n: number) => { let x = Math.imul(n | 0, 0x9e3779b1) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

/** The spots a chunk's cloth is blown at, and the wind each is easing toward. */
interface ClothChunk { u: ClothUniforms; spots: THREE.Vector3[]; target: THREE.Vector3[]; next: number }
const clothTime = { value: 0 };
const _air: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };

/** The facade clutter the game is using, so buildings.ts can keep fire escapes clear of it without extra wiring. */
export const facadeRegistry: { facades: Facades | null } = { facades: null };

export class FacadePropsView {
  readonly root = new THREE.Group();
  private chunks: { g: THREE.Group; cx: number; cz: number; cloth?: ClothChunk }[] = [];
  /** AC units and balconies swap to the modelled kit (models/buildings_kit.glb) when it arrives: same sizes and places */
  private modelled: { im: THREE.InstancedMesh; model: string }[] = [];

  constructor(f: Facades) {
    facadeRegistry.facades = f;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 });
    const catMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0x000000 });
    catMat.onBeforeCompile = (sh) => {
      // the room behind the cat glows (its vertex colour is the warm one)
      sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * step(0.7, vColor.r) * step(0.4, vColor.g) * 0.9;");
    };
    const variants = balconyGeometries();
    const by = new Map<string, FacadeProp[]>();
    for (const p of f.props) {
      const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push(p);
    }
    const m = new THREE.Matrix4(), basis = new THREE.Matrix4(), xa = new THREE.Vector3(), ya = new THREE.Vector3(0, 1, 0), za = new THREE.Vector3();
    for (const [k, list] of by) {
      const g = new THREE.Group();
      const inst = (geo: THREE.BufferGeometry, material: THREE.Material, items: FacadeProp[], dy = 0, model?: string) => {
        if (!items.length) return;
        const im = new THREE.InstancedMesh(geo, material, items.length);
        if (model) this.modelled.push({ im, model });
        items.forEach((p, i) => {
          xa.set(p.tx, 0, p.tz); za.set(p.nx, 0, p.nz);
          basis.makeBasis(xa, ya, za);
          m.copy(basis).setPosition(p.x, p.y + dy, p.z);
          im.setMatrixAt(i, m);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im);
      };
      inst(AC, mat, list.filter((p) => p.kind === "ac"), 0, "ac_unit");
      inst(BALCONY, mat, list.filter((p) => p.kind === "balcony" && (!p.variant || p.variant === "cafe")), 0.07, "balcony");
      for (const [name, geo] of Object.entries(variants)) {
        const items = list.filter((p) => p.variant === name);
        inst(geo.body, mat, items, 0.07);
        if (geo.glow) inst(geo.glow, catMat, items, 0.07);
      }
      inst(WINDOW_BOX.body, mat, list.filter((p) => p.dress === "windowbox"));
      inst(WINDOW_BOX_DEAD.body, mat, list.filter((p) => p.dress === "windowbox_dead"));
      inst(CAT, catMat, list.filter((p) => p.kind === "cat"), -0.2);
      // washing lines: a sagging cord and clothes pegged along it, blown by the wind where each line hangs
      const lines = list.filter((p) => p.kind === "line");
      const racks = list.filter((p) => p.variant === "rack" || p.variant === "wreath");
      const pts: number[] = [], cloth: THREE.BufferGeometry[] = [], spots: THREE.Vector3[] = [];
      const spotAt = (x: number, y: number, z: number) => {
        if (spots.length < MAX_SPOTS) { spots.push(new THREE.Vector3(x, y, z)); return spots.length - 1; }
        return spots.length ? cloth.length % MAX_SPOTS : 0;
      };
      for (const p of lines) {
        const N = 12;
        for (let i = 0; i < N; i++) {
          for (const t of [i / N, (i + 1) / N]) {
            const sag = Math.sin(t * Math.PI) * 0.8;
            pts.push(p.x + (p.x2! - p.x) * t, p.y + (p.y2! - p.y) * t - sag, p.z + (p.z2! - p.z) * t);
          }
        }
        const len = Math.hypot(p.x2! - p.x, p.z2! - p.z);
        const yaw = Math.atan2(p.z2! - p.z, p.x2! - p.x) * -1;
        const spot = spotAt((p.x + p.x2!) / 2, (p.y + p.y2!) / 2 - 0.8, (p.z + p.z2!) / 2);
        // along the line from one peg to the next, each garment as wide as it is, with a gap now and then
        let along = 0.8, n = 0;
        while (along < len - 0.6) {
          const r = hash01(p.seed + n * 131);
          n++;
          if (r < 0.14) { along += 0.5 + r * 3; continue; }
          const t = along / len, sag = Math.sin(t * Math.PI) * 0.8;
          const g = garment(pickGarment(hash01(p.seed + n * 17)), r, p.x + (p.x2! - p.x) * t, p.y + (p.y2! - p.y) * t - sag, p.z + (p.z2! - p.z) * t, yaw, spot);
          cloth.push(g.geo);
          along += g.width + 0.12;
        }
      }
      for (const p of racks) {
        const spot = spotAt(p.x, p.y + 1, p.z);
        const yaw = Math.atan2(p.tz, p.tx) * -1;
        const out = (d: number, a: number): [number, number] => [p.x + p.nx * d + p.tx * a, p.z + p.nz * d + p.tz * a];
        if (p.variant === "rack") {
          for (let i = 0; i < 3; i++) {
            const r = hash01(p.seed + i * 41), [x, z] = out(0.28, -0.6 + i * 0.6);
            cloth.push(garment(pickGarment(r) === "sheet" ? "towel" : pickGarment(r), r, x, p.y + 1.35, z, yaw, spot).geo);
          }
        } else if (hash01(p.seed) < 0.5) {
          // the flag's colours off the rail, for the feast days and every day since
          const [x, z] = out(0.8, -0.9);
          cloth.push(garment("banner", 0.5, x, p.y + 1.0, z, yaw, spot).geo);
        }
      }
      if (pts.length) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2624 })));
      }
      let clothChunk: ClothChunk | undefined;
      if (cloth.length) {
        const wind = Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3());
        clothChunk = { u: { uWind: { value: wind }, uTime: clothTime }, spots, target: wind.map(() => new THREE.Vector3()), next: 0 };
        g.add(clothMesh(cloth, clothChunk.u));
      }
      const [cx, cz] = k.split(",").map(Number);
      this.chunks.push({ g, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK, cloth: clothChunk });
      this.root.add(g);
    }
    loadKitModels().then((parts) => {
      if (!parts) return;
      for (const { im, model } of this.modelled) {
        const p = parts.get(model);
        if (!p) continue;
        im.geometry = p.geo;
        im.material = p.mats.length === 1 ? p.mats[0] : p.mats;
        im.computeBoundingSphere();
      }
    }).catch(() => { /* keep the simple ones */ });
  }

  /** flow and t move the cloth (the tools that only look at buildings leave them out, and it hangs still). */
  update(focus: THREE.Vector3, flow?: Airflow, t = 0) {
    clothTime.value = t;
    for (const c of this.chunks) {
      c.g.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < 420;
      if (!c.g.visible || !c.cloth || !flow) continue;
      const k = c.cloth, wind = k.u.uWind.value;
      // a few samples a frame is plenty: the wind eases in the shader's terms anyway, and sampling isn't free
      for (let i = 0; i < 3 && k.spots.length; i++) {
        const j = k.next++ % k.spots.length, sp = k.spots[j];
        flow.sample(sp.x, sp.y, sp.z, t, _air);
        k.target[j].set(_air.x, _air.y, _air.z);
      }
      for (let j = 0; j < k.spots.length; j++) wind[j].lerp(k.target[j], 0.04);
    }
  }
}
