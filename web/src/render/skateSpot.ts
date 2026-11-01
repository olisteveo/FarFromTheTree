// The skate spot on the corner of Prince and Mulberry (world/heroBlock.ts holds the layout and colliders):
// a concrete strip with quarter pipes at each end, a manual pad, a ledge, a kinked rail and a funbox, with
// the graffiti wall behind it. Nobody's skating it yet: it's a place first.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SKATE } from "../world/heroBlock";

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), c);

// tints over the baked floor (tools/block/skate_floor.mjs): white is the concrete as baked
const CONCRETE = 0xffffff, RAMP = 0xf4f1ea, COPING = 0x34353a, YELLOW = 0xe8b12c;

/** Box-project the floor's maps over everything, so ramps and ledges are visibly the same pour. */
function projectUv(g: THREE.BufferGeometry) {
  const { x0, x1, z0, z1 } = SKATE;
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
    if (ay < ax || ay < az) { if (ax > az) u += y / (x1 - x0); else v += y / (z1 - z0); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** A prism: a side profile (u across, y up) extruded along z. Faces its own normals, flat shaded. */
function extrude(profile: [number, number][], x: number, dir: number, z0: number, z1: number, base: number, c: number): THREE.BufferGeometry {
  const P = profile.map(([u, y]) => [x + dir * u, y + base] as [number, number]);
  // anticlockwise, so every face points out whichever way the piece was mirrored
  let area = 0;
  for (let i = 0; i < P.length; i++) { const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length]; area += ax * by - bx * ay; }
  if (area < 0) P.reverse();
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c2: number[], d: number[]) => pos.push(...a, ...b, ...c2, ...a, ...c2, ...d);
  for (let i = 0; i < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
    quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]);
  }
  // the end caps, as a fan from the first point
  for (let i = 1; i < P.length - 1; i++) {
    pos.push(P[0][0], P[0][1], z0, P[i + 1][0], P[i + 1][1], z0, P[i][0], P[i][1], z0);
    pos.push(P[0][0], P[0][1], z1, P[i][0], P[i][1], z1, P[i + 1][0], P[i + 1][1], z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colored(g, c);
}

function quarterPipe(x: number, dir: number, z0: number, z1: number, h: number): THREE.BufferGeometry[] {
  const R = h * 1.25, profile: [number, number][] = [[0, 0], [R + 0.4, 0]];
  const top = Math.acos(1 - h / R);
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * top;
    profile.push([R + 0.4 - Math.sin(a) * R, R - Math.cos(a) * R]);
  }
  profile.push([0, h]);
  return [
    extrude(profile, x, dir, z0, z1, 0.1, RAMP),
    box(0.06, 0.06, z1 - z0, x + dir * (R + 0.4 - Math.sin(top) * R), h + 0.08, (z0 + z1) / 2, COPING),
    // the deck railing a kid sits on between runs
    box(0.05, 1, 0.05, x - dir * 0, h + 0.1, z0 + 0.2, COPING), box(0.05, 1, 0.05, x, h + 0.1, z1 - 0.2, COPING), box(0.05, 0.05, z1 - z0 - 0.4, x, h + 1.05, (z0 + z1) / 2, COPING),
  ];
}

function funbox(x: number, z: number, len: number, wide: number, h: number): THREE.BufferGeometry[] {
  const k = 1.8;
  const profile: [number, number][] = [[-len / 2 - k, 0], [len / 2 + k, 0], [len / 2, h], [-len / 2, h]];
  const z0 = z - wide / 2, z1 = z + wide / 2;
  return [extrude(profile, x, 1, z0, z1, 0.1, RAMP), box(len, 0.03, 0.06, x, h + 0.1, z0, YELLOW), box(len, 0.03, 0.06, x, h + 0.1, z1, YELLOW)];
}

function rail(x0: number, x1: number, z: number, h: number): THREE.BufferGeometry[] {
  const mid = (x0 + x1) / 2, r = 0.03, kink = 0.28;
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay);
    return colored(new THREE.CylinderGeometry(r, r, L, 8).rotateZ(Math.PI / 2 - Math.atan2(by - ay, bx - ax) + Math.PI).translate((ax + bx) / 2, (ay + by) / 2 + 0.1, z), COPING);
  };
  return [seg(x0, h, mid, h), seg(mid, h, x1, h - kink), ...[x0 + 0.3, mid, x1 - 0.3].map((px, i) => box(0.05, (i === 2 ? h - kink - 0.04 : h), 0.05, px, 0.1, z, COPING))];
}

export class SkateSpotView {
  readonly root = new THREE.Group();

  constructor() {
    const { x0, x1, z0, z1, wall, quarters } = SKATE;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    const parts: THREE.BufferGeometry[] = [box(w, 0.1, d, cx, 0, cz, CONCRETE)];
    for (const q of quarters) parts.push(...quarterPipe(q.x, q.dir, q.z0, q.z1, q.h));
    parts.push(box(wall.x1 - wall.x0, wall.h, 0.34, (wall.x0 + wall.x1) / 2, 0, wall.z, 0xa8a49a), box(wall.x1 - wall.x0 + 0.2, 0.08, 0.44, (wall.x0 + wall.x1) / 2, wall.h, wall.z, 0x6a675f));
    // the manual pad and the waxed ledge
    parts.push(box(8, 0.26, 2.3, -533, 0.1, 2836, CONCRETE), box(8, 0.04, 0.07, -533, 0.34, 2834.85, COPING), box(8, 0.04, 0.07, -533, 0.34, 2837.15, COPING));
    parts.push(box(6.5, 0.46, 0.62, -520, 0.1, 2841.6, YELLOW), box(6.5, 0.05, 0.06, -520, 0.56, 2841.3, COPING));
    parts.push(...rail(-546.5, -540.5, 2838.2, 0.62));
    parts.push(...funbox(-524, 2836.4, 2.4, 3.6, 0.8));
    // what gets left at a skate spot: a bench, a bin, a backpack, a board against the wall
    parts.push(box(2.2, 0.08, 0.5, -540, 0.52, 2843.5, 0x6e4a30), box(0.08, 0.42, 0.42, -541, 0.1, 2843.5, COPING), box(0.08, 0.42, 0.42, -539, 0.1, 2843.5, COPING));
    parts.push(colored(new THREE.CylinderGeometry(0.28, 0.25, 0.9, 10).translate(-536.8, 0.55, 2843.6), 0x2f4a3a));
    parts.push(box(0.32, 0.46, 0.18, -539.3, 0.6, 2843.5, 0xb0342a));
    parts.push(colored(new THREE.BoxGeometry(0.2, 0.8, 0.02).rotateX(-0.12).translate(-543.4, 0.5, 2844.3), 0xd8b24a));
    const geo = mergeGeometries(parts)!;
    projectUv(geo);
    const tex = (name: string, srgb: boolean) => {
      const t = new THREE.TextureLoader().load(`./textures/block/skate_floor_${name}.webp`);
      t.flipY = false; // the bake's first row is z0
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      t.anisotropy = 16;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
      map: tex("c", true), normalMap: tex("n", false), normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: tex("r", false),
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }
}
