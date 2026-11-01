// Paint and paper on the hero block's walls (art from tools/block/wall_art.mjs): ghost signs and murals where a
// taller building's blank side stands clear of its neighbour, tags and posters at hand height, throw-ups on
// the walls facing the skate lot, and the graffiti wall itself. One merged mesh of decals, a hand's width off
// the wall. Purely visual: nothing here touches the flight model.

import * as THREE from "three";
import type { Building, CityData } from "../world/data";
import { SKATE, inHeroBlock } from "../world/heroBlock";

interface Rect { x: number; y: number; w: number; h: number }
interface Art { size: number; rects: Record<string, Rect> }

const hash01 = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

// by where they go: a blank wall high up, a big one low down, or whatever a passing hand could reach
const HIGH = ["ghost_macaroni", "ghost_cigars", "mural_mulberry", "ghost_collars", "geo_0", "pigeon_1", "geo_1"];
const BIG = ["throw_0", "throw_1", "wild_0", "chrome_0", "throw_2", "block_1", "wild_1", "throw_3", "chrome_1", "bubble_0", "block_0", "bubble_1", "tagwall_0", "memorial_0", "naive_0"];
const HAND = ["tag_0", "paste_0", "tag_1", "leaf_0", "slaps_0", "tag_2", "pigeon_0", "tagwall_1", "tag_3", "paste_1", "cat_0", "tag_4", "naive_1", "slaps_1", "tag_5", "leaf_1", "cat_1"];

/** Width in metres each piece is painted at, when it's placed at hand height. */
const HAND_WIDTH: Record<string, number> = { paste_0: 3.2, paste_1: 2.4, tagwall_1: 2.8, slaps_0: 1.1, slaps_1: 0.9, leaf_0: 0.8, leaf_1: 0.8, cat_0: 0.7, cat_1: 0.7, pigeon_0: 1.1, naive_1: 1.5 };

/** The wall behind the skate spot, from the east end: read left to right facing it from the street. */
const SKATE_WALL = ["piece_leaf", "throw_1", "memorial_0", "wild_0", "chrome_1", "block_1", "piece_mott"];

export class WallArtView {
  readonly root = new THREE.Group();

  constructor(private city: CityData) {
    this.load();
  }

  private async load() {
    let art: Art;
    try { art = await (await fetch("./textures/block/wall_art.json")).json(); } catch { return; }
    const quads: number[] = [], uvs: number[] = [], normals: number[] = [], colours: number[] = [];
    const put = (name: string, cx: number, y0: number, cz: number, nx: number, nz: number, width: number, maxH = Infinity) => {
      const r = art.rects[name];
      if (!r) return;
      let w = width, h = (w * r.h) / r.w;
      if (h > maxH) { h = maxH; w = (h * r.w) / r.h; }
      const out = 0.04 + quads.length * 1e-7; // later pieces sit over earlier ones
      // left to right as you face the wall, which looks along -n
      const rx = nz, rz = -nx, px = cx + nx * out, pz = cz + nz * out;
      const c = (s: number, t: number) => [px + rx * (s - 0.5) * w, y0 + t * h, pz + rz * (s - 0.5) * w];
      const a = c(0, 0), b = c(1, 0), e = c(1, 1), f = c(0, 1);
      quads.push(...a, ...b, ...e, ...a, ...e, ...f);
      const u0 = r.x / art.size, u1 = (r.x + r.w) / art.size, v1 = 1 - r.y / art.size, v0 = 1 - (r.y + r.h) / art.size;
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      // old paint has sunk into the wall; even fresh paint lets the brick's colour through a little
      const alpha = name.startsWith("ghost") ? 0.78 : name.startsWith("mural") ? 0.84 : name.startsWith("geo") ? 0.9 : 0.96;
      for (let i = 0; i < 6; i++) { normals.push(nx, 0, nz); colours.push(1, 1, 1, alpha); }
    };

    const nearLot = (x: number, z: number) => x > SKATE.x0 - 34 && x < SKATE.x1 + 12 && z > SKATE.z0 - 8 && z < SKATE.z1 + 62;
    let high = 0, big = 0, hand = 0;
    for (const b of this.city.buildings) {
      const hero = inHeroBlock(b.cx, b.cz), lot = nearLot(b.cx, b.cz);
      if (!hero && !lot) continue;
      this.eachWall(b, (ax, az, tx, tz, L, nx, nz, seed, other) => {
        const mx = ax + tx * L / 2, mz = az + tz * L / 2;
        if (other) {
          // a blank side wall standing clear of a lower neighbour: the sign painter's canvas
          const room = b.h - other.h - 1.2;
          if (room > 3.5 && L > 5 && high < 40) {
            const name = HIGH[high++ % HIGH.length], w = Math.min(L - 1.2, 15);
            put(name, mx, other.h + 0.6, mz, nx, nz, w, room);
          }
          return;
        }
        // a street or the lot: low on the wall. Only the bigger walls take a big piece.
        const roll = hash01(seed, 5);
        if ((lot && L > 7 && roll < 0.8) || (L > 11 && roll < 0.12)) {
          put(BIG[big++ % BIG.length], ax + tx * L * (0.28 + roll * 0.44), 0.35, az + tz * L * (0.28 + roll * 0.44), nx, nz, Math.min(L * 0.7, 6.5), 2.6);
        }
        const count = Math.min(7, Math.floor(L / 2.4));
        for (let i = 0; i < count; i++) {
          if (hash01(seed, 11 + i) > 0.82) continue;
          const name = HAND[hand++ % HAND.length];
          const t = (i + 0.2 + hash01(seed, 23 + i) * 0.6) / count;
          const width = HAND_WIDTH[name] ?? 0.9 + hash01(seed, 31 + i) * 1.2;
          const y = 0.5 + hash01(seed, 41 + i) * 1.3;
          put(name, ax + tx * L * t, y, az + tz * L * t, nx, nz, width, 2.4);
        }
      });
    }
    // the hall of fame, facing Prince St, end to end with overlaps
    {
      const { x0, x1, z, h } = SKATE.wall;
      let x = x1 - 0.5;
      const zf = z - 0.2;
      for (const name of SKATE_WALL) {
        const r = art.rects[name];
        const pieceH = h - 0.25 - (name.startsWith("memorial") ? 0 : 0.2), pieceW = (pieceH * r.w) / r.h;
        if (x - pieceW < x0) break;
        put(name, x - pieceW / 2, 0.14, zf, 0, -1, pieceW, pieceH);
        x -= pieceW * 0.97;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(quads, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
    const map = new THREE.TextureLoader().load("./textures/block/wall_art.webp");
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 16;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMapIntensity: 0.25,
    }));
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  /** Each outer wall of a building long enough to paint, with what stands in front of it (null if nothing). */
  private eachWall(b: Building, fn: (ax: number, az: number, tx: number, tz: number, L: number, nx: number, nz: number, seed: number, other: Building | null) => void) {
    const ring = b.poly[0], n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
      const o = this.city.buildingAt((ax + bx) / 2 + nx * 3, (az + bz) / 2 + nz * 3);
      fn(ax, az, tx, tz, L, nx, nz, (b.seed + i * 53) | 0, o && o !== b ? o : null);
    }
  }
}
