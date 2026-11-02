// New York's street trees in late November: bare, as the story has them, but no two kinds alike (world/treeForms.ts).
// Each species is told apart by its silhouette and bark, the way you'd know them in winter. Streets are
// planted in runs of one kind, the way the Parks Department does it, with the odd different tree where one was replaced.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { FORM_SEED, SPECIES, VARIANTS, growForm, plant, type Species, type TreeSpot } from "../world/treeForms";

export type { TreeSpot };

function paint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}

function grow(sp: Species, seed: number): THREE.BufferGeometry {
  const form = growForm(sp, seed), parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(sp.bark), mark = new THREE.Color(sp.patch), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Color();
  for (const l of form.limbs) {
    const from = new THREE.Vector3(...l.a), d = new THREE.Vector3(...l.b).sub(from), L = d.length();
    const g = new THREE.CylinderGeometry(l.r1, l.r0, L, l.sides, 1, true).translate(0, L / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.normalize()));
    g.translate(from.x, from.y, from.z);
    parts.push(paint(g, l.patch ? mark : base));
  }
  for (const f of form.fists) parts.push(paint(new THREE.IcosahedronGeometry(f.r, 0).translate(...f.at), base));
  for (const f of form.fruit) {
    const [x, y, z] = f.at;
    if (sp.fruit === "balls") parts.push(paint(new THREE.IcosahedronGeometry(0.052, 0).translate(x, y - f.len, z), tmp.set(0x4a3a26)));
    else parts.push(paint(new THREE.BoxGeometry(0.035, f.len, 0.008).rotateZ(0.2 * f.tilt).rotateY(f.spin).translate(x, y - f.len / 2, z), tmp.set(0x2a1b12)));
  }
  // the root flare
  if (sp.radius > 0.1) parts.push(paint(new THREE.CylinderGeometry(sp.radius, sp.radius * 1.5, 0.28, 7, 1, true).translate(0, 0.14, 0), base));
  if (sp.staked) {
    // two stakes, with a strap across
    const stake = new THREE.Color(0x8a6f4c);
    for (const x of [-0.42, 0.42]) parts.push(paint(new THREE.BoxGeometry(0.045, 2, 0.045).translate(x, 1, 0), stake));
    parts.push(paint(new THREE.BoxGeometry(0.86, 0.035, 0.02).translate(0, 1.45, 0), tmp.set(0x1c1c1c)));
  }
  return mergeGeometries(parts)!;
}

/** The bed it's planted in: dark soil and, on many streets, a low iron guard. Street trees only. */
function pit(guard: boolean): THREE.BufferGeometry {
  const soil = new THREE.Color(0x241d16), iron = new THREE.Color(0x15171a), parts = [paint(new THREE.BoxGeometry(1.45, 0.012, 1.45).translate(0, 0.164, 0), soil)];
  if (guard) {
    const H = 0.46, half = 0.72;
    for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) parts.push(paint(new THREE.BoxGeometry(0.035, H, 0.035).translate(x, 0.16 + H / 2, z), iron));
    for (const s of [-half, half]) {
      parts.push(paint(new THREE.BoxGeometry(half * 2, 0.03, 0.03).translate(0, 0.16 + H, s), iron));
      parts.push(paint(new THREE.BoxGeometry(0.03, 0.03, half * 2).translate(s, 0.16 + H, 0), iron));
    }
  }
  return mergeGeometries(parts)!;
}

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

/** One chunk's worth of trees: a mesh per species variant, with a per-tree tint and the street trees' beds. */
export class StreetTrees {
  private geos = SPECIES.map((sp, s) => Array.from({ length: VARIANTS }, (_, v) => grow(sp, FORM_SEED(s, v))));
  private beds = [pit(false), pit(true)];
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });

  chunk(list: TreeSpot[]): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const groups = new Map<string, TreeSpot[]>(), pits: TreeSpot[][] = [[], []];
    for (const t of list) {
      const k = plant(t), key = `${k.kind},${k.variant}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
      if (t.street) pits[k.guard ? 1 : 0].push(t);
    }
    for (const [key, trees] of groups) {
      const [kind, variant] = key.split(",").map(Number);
      const im = new THREE.InstancedMesh(this.geos[kind][variant], this.mat, trees.length);
      trees.forEach((t, i) => {
        const k = plant(t);
        im.setMatrixAt(i, m.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(Y, k.yaw), s.set(k.age, k.tall, k.age)));
        const shade = 0.82 + hash(Math.round(t.x), Math.round(t.z)) * 0.34;
        im.setColorAt(i, c.setRGB(shade, shade, shade));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }
    pits.forEach((spots, guard) => {
      if (!spots.length) return;
      const im = new THREE.InstancedMesh(this.beds[guard], this.mat, spots.length);
      // squared up with the street grid, which the trees' own yaw ignores
      spots.forEach((t, i) => im.setMatrixAt(i, m.compose(p.set(t.x, 0, t.z), q.identity(), s.set(1, 1, 1))));
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    });
    return g;
  }
}
