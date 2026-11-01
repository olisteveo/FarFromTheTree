// What people do with a balcony. The hero block's households (world/heroBlock.ts) pick from these. Each has the
// same footprint as the plain balcony except the Juliet, so the leaf's colliders stay honest. Local frame as in
// facadeProps.ts: x along the wall, y up, z out from the wall, y = 0 at the slab.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BalconyVariant } from "../world/heroBlock";

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const ball = (r: number, x: number, y: number, z: number, c: number) => colored(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), c);
const stick = (len: number, r: number, x: number, y: number, z: number, c: number, tilt = 0) => colored(new THREE.CylinderGeometry(r, r, len, 6).rotateZ(tilt).translate(x, y, z), c);

function railing(iron: number, slab: number, depth = 1.5, width = 2.8): THREE.BufferGeometry[] {
  const hw = width / 2, front = depth / 2 - 0.02;
  const posts: THREE.BufferGeometry[] = [];
  for (let x = -hw; x <= hw + 0.01; x += 0.23) posts.push(box(0.025, 0.88, 0.025, x, 0.5, front, iron));
  for (const side of [-hw, hw]) for (let z = -depth / 2 + 0.2; z < front; z += 0.3) posts.push(box(0.025, 0.88, 0.025, side, 0.5, z, iron));
  return [
    box(width, 0.12, depth, 0, 0, 0, slab),
    box(width, 0.05, 0.05, 0, 0.95, front, iron),
    box(0.05, 0.05, depth, -hw, 0.95, 0, iron),
    box(0.05, 0.05, depth, hw, 0.95, 0, iron),
    ...posts,
  ];
}

const FOLIAGE = [0x4d6a34, 0x5d7a3a, 0x3f5a2e, 0x6e7f3c, 0x7a6e38];
function plant(x: number, z: number, scale: number, seed: number, dead = false): THREE.BufferGeometry[] {
  const pot = [0x8a4a30, 0x6e3c28, 0x4a4a48, 0xa0603c][seed % 4];
  const out = [colored(new THREE.CylinderGeometry(0.15 * scale, 0.11 * scale, 0.26 * scale, 8).translate(x, 0.2, z), pot)];
  if (dead) for (let i = 0; i < 3; i++) out.push(stick(0.5 * scale, 0.012, x + (i - 1) * 0.05, 0.55, z, 0x5a4a30, (i - 1) * 0.3));
  else for (let i = 0; i < 4; i++) out.push(ball((0.14 + (i % 3) * 0.06) * scale, x + Math.sin(i * 2.4) * 0.13 * scale, 0.42 + i * 0.13 * scale, z + Math.cos(i * 2.4) * 0.13 * scale, FOLIAGE[(seed + i) % FOLIAGE.length]));
  return out;
}

const chair = (x: number, z: number, c: number) => [box(0.38, 0.04, 0.38, x, 0.48, z, c), box(0.38, 0.42, 0.04, x, 0.72, z - 0.17, c), ...[-0.15, 0.15].flatMap((dx) => [-0.15, 0.15].map((dz) => box(0.03, 0.42, 0.03, x + dx, 0.27, z + dz, 0x2a2a2a)))];

const bike = (x: number, z: number): THREE.BufferGeometry[] => {
  const wheel = (dx: number) => colored(new THREE.TorusGeometry(0.31, 0.018, 5, 18).translate(x + dx, 0.38, z), 0x18181a);
  const frame = 0xb0342a;
  return [wheel(-0.5), wheel(0.5), stick(0.62, 0.016, x - 0.06, 0.55, z, frame, 1.2), stick(0.5, 0.016, x + 0.26, 0.55, z, frame, -0.6), stick(0.42, 0.016, x - 0.28, 0.54, z, frame, 0.5), box(0.2, 0.04, 0.08, x - 0.14, 0.78, z, 0x18181a), box(0.04, 0.04, 0.4, x + 0.42, 0.84, z, 0x18181a)];
};

/** Parts that glow (string lights) are kept apart so they can use the emissive material. */
export interface BalconyGeo { body: THREE.BufferGeometry; glow?: THREE.BufferGeometry }

function make(body: THREE.BufferGeometry[], glow?: THREE.BufferGeometry[]): BalconyGeo {
  return { body: mergeGeometries(body)!, glow: glow ? mergeGeometries(glow)! : undefined };
}

export function balconyGeometries(): Record<Exclude<BalconyVariant, "cafe">, BalconyGeo> {
  const iron = 0x2c2d30;
  const stringBulbs: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    stringBulbs.push(colored(new THREE.IcosahedronGeometry(0.04, 0).translate(-1.35 + 2.7 * t, 1.5 - Math.sin(t * Math.PI) * 0.28, 0.68), 0xffc27a));
  }
  return {
    // iron across a tall window, a box of geraniums gone leggy: barely a balcony at all
    juliet: make([
      box(1.5, 0.08, 0.5, 0, 0, 0, 0x8e8a82),
      box(1.5, 0.05, 0.04, 0, 0.92, 0.22, iron),
      ...[-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].map((x) => box(0.025, 0.86, 0.025, x, 0.48, 0.22, iron)),
      box(0.04, 0.05, 0.42, -0.75, 0.92, 0, iron), box(0.04, 0.05, 0.42, 0.75, 0.92, 0, iron),
      box(1.2, 0.18, 0.2, 0, 0.12, 0.05, 0x7a4a30),
      ...[-0.42, -0.14, 0.14, 0.42].map((x, i) => ball(0.13, x, 0.31, 0.05, FOLIAGE[i])),
    ]),
    // every inch of it planted, vines over the rail
    jungle: make([
      ...railing(iron, 0x9c9890),
      ...plant(-1.05, -0.3, 1.4, 1), ...plant(-0.5, 0.2, 1.1, 2), ...plant(0.1, -0.35, 1.7, 3), ...plant(0.65, 0.3, 1, 4), ...plant(1.05, -0.2, 1.5, 5, true), ...plant(-0.95, 0.42, 0.9, 6),
      ...[-1.1, -0.45, 0.3, 0.95].flatMap((x, i) => [0, 1, 2, 3].map((k) => ball(0.09 - k * 0.01, x + Math.sin(k + i) * 0.04, 0.92 - k * 0.2, 0.76, FOLIAGE[(i + k) % FOLIAGE.length]))),
    ]),
    // the bike, the boxes, the thing under the tarp
    junk: make([
      ...railing(0x3a3a3c, 0x8e8a80),
      ...bike(-0.5, 0.45),
      box(0.5, 0.42, 0.42, 0.92, 0.27, -0.42, 0xa98a5e), box(0.4, 0.3, 0.34, 0.86, 0.63, -0.42, 0x8f744c), box(0.34, 0.26, 0.3, 0.48, 0.19, -0.48, 0xb49868),
      colored(new THREE.SphereGeometry(0.46, 9, 6).scale(1.15, 0.8, 0.8).translate(-0.72, 0.36, -0.36), 0x2f4a66),
      stick(0.5, 0.05, 1.2, 0.31, 0.45, 0x7a7a7a), // a gas can's worth of nothing
    ]),
    // a folding rack; the washing on it is cloth (cloth.ts)
    rack: make([
      ...railing(iron, 0xa4a098),
      box(1.9, 0.025, 0.025, 0, 1.28, 0.28, 0xd4d4d2), box(1.9, 0.025, 0.025, 0, 1.28, -0.12, 0xd4d4d2),
      stick(1.3, 0.016, -0.94, 0.68, 0.28, 0xd4d4d2), stick(1.3, 0.016, 0.94, 0.68, 0.28, 0xd4d4d2), stick(1.3, 0.016, -0.94, 0.68, -0.12, 0xd4d4d2), stick(1.3, 0.016, 0.94, 0.68, -0.12, 0xd4d4d2),
      ...plant(1.14, 0.48, 0.8, 7),
    ]),
    // the good balcony: two chairs, a rug, a crate table, lights up already
    lights: make([
      ...railing(0x24252a, 0x8a867c),
      box(2.1, 0.012, 1.0, 0, 0.07, 0, 0x7a2f3a),
      ...chair(-0.7, 0.05, 0xb5823c), ...chair(0.75, 0.05, 0x3a6f7a),
      box(0.42, 0.34, 0.42, 0.02, 0.24, 0.08, 0x8a6a42),
      box(0.14, 0.2, 0.1, -0.02, 0.5, 0.08, 0x2a5a3a),
      stick(1.45, 0.012, -1.38, 0.78, 0.68, 0x2a2a2a), stick(1.45, 0.012, 1.38, 0.78, 0.68, 0x2a2a2a),
    ], stringBulbs),
    // someone's nonna: a wreath on the rail, one chair, and pumpkins not yet surrendered to the frost
    wreath: make([
      ...railing(0x1f2a24, 0xb2aea4),
      colored(new THREE.TorusGeometry(0.26, 0.085, 6, 14).translate(0, 0.68, 0.78), 0x24512f),
      box(0.14, 0.14, 0.04, 0, 0.92, 0.8, 0xb0242a),
      ...chair(0.72, -0.2, 0x7a5a3a),
      colored(new THREE.SphereGeometry(0.17, 10, 7).scale(1, 0.8, 1).translate(-0.7, 0.2, 0.3), 0xb45f1c),
      colored(new THREE.SphereGeometry(0.12, 10, 7).scale(1, 0.8, 1).translate(-0.98, 0.16, 0.05), 0x8f4a18),
      ...plant(-0.2, -0.45, 1, 8),
    ]),
    // nobody's touched it since the seventies: rust, a dead plant, a dish that points at nothing
    rust: make([
      ...railing(0x5a3a2a, 0x76716a),
      ...plant(-0.9, 0.3, 1, 9, true),
      stick(0.75, 0.025, 0.9, 0.42, -0.4, 0x6a6a6a),
      colored(new THREE.SphereGeometry(0.34, 12, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.1).translate(0.9, 0.78, -0.3), 0xcfcfca),
      box(0.5, 0.05, 0.42, -0.1, 0.09, -0.3, 0x4a4238),
    ]),
  };
}

/** A window box: alive, or left to the season. */
export const WINDOW_BOX: BalconyGeo = make([box(0.95, 0.2, 0.26, 0, 0, 0, 0x6e4a30), box(0.97, 0.03, 0.28, 0, 0.09, 0, 0x4e3422), ...[-0.32, -0.1, 0.12, 0.34].map((x, i) => ball(0.13, x, 0.19, 0, FOLIAGE[i]))]);
export const WINDOW_BOX_DEAD: BalconyGeo = make([box(0.95, 0.2, 0.26, 0, 0, 0, 0x5a4a3a), box(0.97, 0.03, 0.28, 0, 0.09, 0, 0x3e3226), ...[-0.3, -0.05, 0.2, 0.36].flatMap((x, i) => [stick(0.34, 0.012, x, 0.25, 0, 0x5a4a30, (i - 1.5) * 0.25), stick(0.24, 0.012, x + 0.05, 0.22, 0.05, 0x6a5a38, (1.5 - i) * 0.3)])]);
