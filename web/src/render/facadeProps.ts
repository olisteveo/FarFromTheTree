// Draws the facade clutter (world/facades.ts): AC units, balconies with a table and two
// chairs, cats in open windows (with a lit room behind), and washing lines with clothes.
// Instanced per 280 m chunk and only drawn near the camera.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FacadeProp, Facades } from "../world/facades";

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

const CLOTHES = [0xc8382a, 0xf0ece0, 0x2a5a9a, 0xe0b423, 0x3a8a4a, 0xd27aa2, 0x8a8a8a, 0x1a1a1a];

export class FacadePropsView {
  readonly root = new THREE.Group();
  private chunks: { g: THREE.Group; cx: number; cz: number }[] = [];

  constructor(f: Facades) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 });
    const catMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0x000000 });
    catMat.onBeforeCompile = (sh) => {
      // the room behind the cat glows (its vertex colour is the warm one)
      sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * step(0.7, vColor.r) * step(0.4, vColor.g) * 0.9;");
    };
    const by = new Map<string, FacadeProp[]>();
    for (const p of f.props) {
      const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push(p);
    }
    const m = new THREE.Matrix4(), basis = new THREE.Matrix4(), xa = new THREE.Vector3(), ya = new THREE.Vector3(0, 1, 0), za = new THREE.Vector3();
    for (const [k, list] of by) {
      const g = new THREE.Group();
      const inst = (geo: THREE.BufferGeometry, material: THREE.Material, items: FacadeProp[], dy = 0) => {
        if (!items.length) return;
        const im = new THREE.InstancedMesh(geo, material, items.length);
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
      inst(AC, mat, list.filter((p) => p.kind === "ac"));
      inst(BALCONY, mat, list.filter((p) => p.kind === "balcony"), 0.07);
      inst(CAT, catMat, list.filter((p) => p.kind === "cat"), -0.2);
      // washing lines: a sagging cord and clothes pegged along it
      const lines = list.filter((p) => p.kind === "line");
      if (lines.length) {
        const pts: number[] = [], cloth: THREE.BufferGeometry[] = [];
        for (const p of lines) {
          const N = 12;
          for (let i = 0; i < N; i++) {
            for (const t of [i / N, (i + 1) / N]) {
              const sag = Math.sin(t * Math.PI) * 0.8;
              pts.push(p.x + (p.x2! - p.x) * t, p.y + (p.y2! - p.y) * t - sag, p.z + (p.z2! - p.z) * t);
            }
          }
          const len = Math.hypot(p.x2! - p.x, p.z2! - p.z);
          const yaw = Math.atan2(p.x2! - p.x, p.z2! - p.z) + Math.PI / 2;
          for (let t = 0.12; t < 0.9; t += 0.85 / Math.max(3, len / 1.2)) {
            if (((p.seed >> Math.floor(t * 20)) & 3) === 0) continue;
            const sag = Math.sin(t * Math.PI) * 0.8;
            const w = 0.4 + ((p.seed >> Math.floor(t * 13)) % 5) * 0.08, hh = 0.5 + ((p.seed >> Math.floor(t * 7)) % 4) * 0.12;
            const geo = new THREE.PlaneGeometry(w, hh).translate(0, -hh / 2, 0).rotateY(yaw)
              .translate(p.x + (p.x2! - p.x) * t, p.y + (p.y2! - p.y) * t - sag, p.z + (p.z2! - p.z) * t);
            cloth.push(colored(geo, CLOTHES[(p.seed + Math.floor(t * 100)) % CLOTHES.length]));
          }
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2624 })));
        if (cloth.length) {
          const cm = new THREE.Mesh(mergeGeometries(cloth)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
          cm.castShadow = true;
          g.add(cm);
        }
      }
      const [cx, cz] = k.split(",").map(Number);
      this.chunks.push({ g, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK });
      this.root.add(g);
    }
  }

  update(focus: THREE.Vector3) {
    for (const c of this.chunks) c.g.visible = Math.hypot(c.cx - focus.x, c.cz - focus.z) < 420;
  }
}
