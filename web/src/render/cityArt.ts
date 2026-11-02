// Paint and paper on the rest of the city (render/wallArt.ts dresses the hero block by hand, from the same atlas,
// tools/block/wall_art.mjs). Blank walls and service walls take tags, throw-ups and wheatpaste; the piers between shops
// take stickers and tear-off flyers; side walls standing clear of a lower neighbour take a ghost sign, a mural or a
// roller tag up by the roofline; hoardings are papered over and stencilled POST NO BILLS; down below, the stairwells and
// platforms are tagged and stickered. Built a chunk at a time near the camera. Purely visual.

import * as THREE from "three";
import { BARRIER_NAME, inGap, type Blockers } from "../world/blockers";
import type { CityData } from "../world/data";
import { SKATE, inHeroBlock } from "../world/heroBlock";
import { STAIRS, TUNNEL, type Underground } from "../world/underground";
import type { FrontEdge } from "./buildings";

interface Rect { x: number; y: number; w: number; h: number }
interface Atlas { size: number; rects: Record<string, Rect> }
/** A straight run of plywood round a building site, facing the street. */
export interface HoardingRun { ax: number; az: number; tx: number; tz: number; L: number; nx: number; nz: number }

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };
const pick = <T,>(list: T[], r: number) => list[Math.floor(r * list.length) % list.length];

const HIGH = ["ghost_macaroni", "ghost_cigars", "ghost_collars", "geo_0", "geo_1", "pigeon_1"];
const ROOFLINE = ["roller_0", "roller_1", "roller_2", "block_0", "block_1", "tagwall_0"];
const BIG = ["throw_0", "throw_1", "throw_2", "throw_3", "wild_0", "wild_1", "chrome_0", "chrome_1", "bubble_0", "bubble_1", "block_0", "block_1", "tagwall_0", "roller_0", "roller_2", "naive_0"];
const HAND = ["tag_0", "tag_1", "tag_2", "tag_3", "tag_4", "tag_5", "marker_0", "marker_1", "marker_2", "marker_3", "marker_4", "marker_5", "tagwall_1", "rat_0", "rat_1", "tree_0", "tree_1", "cat_0", "cat_1", "leaf_0", "leaf_1", "pigeon_0", "slaps_0", "slaps_1", "naive_1"];
const GIGS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `gig_${i}`).concat([0, 1, 2, 3, 4, 5].map((i) => `bill_${i}`));
const PAPER = ["paste_0", "paste_1", "paste_0", ...GIGS];
const FLYERS = ["flyer_0", "flyer_1", "flyer_2", "flyer_3"];
const PIER = [...FLYERS, ...FLYERS, "gig_0", "gig_2", "gig_5", "bill_1", "bill_3", "marker_0", "marker_2", "marker_4", "slaps_1", "leaf_0", "cat_0", "rat_0"];
const HOARDING = ["paste_0", "paste_1", ...GIGS, "nobills_0", "nobills_1", "keepout_0", "tag_0", "tag_3", "throw_0", "throw_2", "tagwall_1"];
const BELOW = ["marker_0", "marker_1", "marker_2", "marker_3", "marker_4", "marker_5", "tag_0", "tag_3", "tag_5", "slaps_1", "slaps_0", "rat_0", "cat_0", "tagwall_1", "flyer_1", "flyer_3", "leaf_0"];

/** Metres wide, by what kind of thing it is. */
function widthOf(name: string, r: number): number {
  if (name.startsWith("paste_0")) return 3;
  if (name.startsWith("paste_1") || name.startsWith("tagwall")) return 2.2;
  if (name.startsWith("gig") || name.startsWith("bill")) return 0.62;
  if (name.startsWith("flyer")) return 0.24;
  if (name.startsWith("nobills_0")) return 1.7;
  if (name.startsWith("nobills") || name.startsWith("keepout")) return 1.1;
  if (name.startsWith("marker")) return 0.5 + r * 0.5;
  if (name.startsWith("slaps")) return 0.8;
  if (name.startsWith("rat") || name.startsWith("cat") || name.startsWith("leaf")) return 0.6;
  if (name.startsWith("tree")) return 0.8;
  if (name.startsWith("pigeon")) return 1;
  return 0.9 + r * 1.1;
}
const alphaOf = (name: string) => (name.startsWith("ghost") ? 0.74 : name.startsWith("geo") ? 0.88 : name.startsWith("flyer") || name.startsWith("gig") || name.startsWith("bill") || name.startsWith("paste") ? 1 : 0.94);

const SHOW = { chinatown: 1.1, littleitaly: 1, village: 0.85, flatiron: 0.55, fidi: 0.35, midtown: 0.3, columbus: 0.3, battery: 0.3 } as Record<string, number>;
const CHUNK = 200;

class Quads {
  pos: number[] = []; uv: number[] = []; nor: number[] = []; col: number[] = [];
  constructor(private art: Atlas) {}
  put(name: string, cx: number, y0: number, cz: number, nx: number, nz: number, width: number, maxH = Infinity) {
    const r = this.art.rects[name];
    if (!r) return;
    let w = width, h = (w * r.h) / r.w;
    if (h > maxH) { h = maxH; w = (h * r.w) / r.h; }
    const out = 0.05 + this.pos.length * 1e-7, rx = nz, rz = -nx, px = cx + nx * out, pz = cz + nz * out;
    const c = (s: number, t: number) => [px + rx * (s - 0.5) * w, y0 + t * h, pz + rz * (s - 0.5) * w];
    const a = c(0, 0), b = c(1, 0), e = c(1, 1), f = c(0, 1);
    this.pos.push(...a, ...b, ...e, ...a, ...e, ...f);
    const S = this.art.size, u0 = r.x / S, u1 = (r.x + r.w) / S, v1 = 1 - r.y / S, v0 = 1 - (r.y + r.h) / S;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    const al = alphaOf(name);
    for (let i = 0; i < 6; i++) { this.nor.push(nx, 0, nz); this.col.push(1, 1, 1, al); }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 4));
    return g;
  }
}

export class CityArtView {
  readonly root = new THREE.Group();
  private art: Atlas | null = null;
  private map: THREE.Texture | null = null;
  private mat: THREE.Material | null = null;
  private edges = new Map<number, FrontEdge[]>();
  private runs = new Map<number, HoardingRun[]>();
  private meshes = new Map<number, THREE.Mesh>();
  private lastKey = NaN;

  constructor(private city: CityData, private fronts: () => FrontEdge[], private hoardings: () => HoardingRun[], private blockers: Blockers, private under: Underground) {
    this.load();
  }

  private key(x: number, z: number) { return (Math.floor(x / CHUNK) + 4096) * 16384 + (Math.floor(z / CHUNK) + 4096); }

  private async load() {
    try { this.art = await (await fetch("./textures/block/wall_art.json")).json(); } catch { return; }
    const map = (this.map = new THREE.TextureLoader().load("./textures/block/wall_art.webp"));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    this.mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, envMapIntensity: 0.25 });
    this.belowGround();
  }

  private indexed = false;
  private index() {
    for (const e of this.fronts()) {
      if (e.y0 !== 0 || e.L < 2) continue;
      const k = this.key(e.ax + (e.tx * e.L) / 2, e.az + (e.tz * e.L) / 2);
      (this.edges.get(k) ?? this.edges.set(k, []).get(k)!).push(e);
    }
    for (const h of this.hoardings()) {
      const k = this.key(h.ax + (h.tx * h.L) / 2, h.az + (h.tz * h.L) / 2);
      (this.runs.get(k) ?? this.runs.set(k, []).get(k)!).push(h);
    }
    this.indexed = true;
  }

  update(focus: THREE.Vector3) {
    if (!this.art || !this.mat) return;
    if (!this.indexed) { if (!this.fronts().length) return; this.index(); }
    const k = this.key(focus.x, focus.z);
    let built = 0;
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    for (let dx = -1; dx <= 1 && !built; dx++) for (let dz = -1; dz <= 1 && !built; dz++) {
      const q = (cx + dx + 4096) * 16384 + (cz + dz + 4096);
      if (!this.meshes.has(q)) { this.build(q, cx + dx, cz + dz); built = 1; }
    }
    if (k !== this.lastKey) {
      this.lastKey = k;
      for (const [q, m] of this.meshes) {
        const ix = Math.floor(q / 16384) - 4096, iz = (q % 16384) - 4096;
        if (Math.abs(ix - cx) > 2 || Math.abs(iz - cz) > 2) { this.root.remove(m); m.geometry.dispose(); this.meshes.delete(q); }
      }
    }
  }

  private build(q: number, ix: number, iz: number) {
    const out = new Quads(this.art!);
    for (const e of this.edges.get(q) ?? []) this.dressWall(out, e);
    for (const h of this.runs.get(q) ?? []) this.dressHoarding(out, h);
    this.dressBarriers(out, ix, iz);
    const m = new THREE.Mesh(out.geometry(), this.mat!);
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.visible = out.pos.length > 0;
    this.meshes.set(q, m);
    this.root.add(m);
  }

  private dressWall(out: Quads, e: FrontEdge) {
    const b = e.b;
    const midX = e.ax + (e.tx * e.L) / 2, midZ = e.az + (e.tz * e.L) / 2;
    if (inHeroBlock(b.cx, b.cz) || (midX > SKATE.x0 - 34 && midX < SKATE.x1 + 12 && midZ > SKATE.z0 - 8 && midZ < SKATE.z1 + 62)) return;
    const seed = (b.seed * 31 + Math.round(e.u0 * 10) * 7 + Math.round(e.ax)) | 0, r = (k: number) => hash(seed, k);
    const rate = (SHOW[e.district] ?? 0.5) * (b.style === "glass" ? 0.15 : b.style === "modern" || b.style === "civic" ? 0.4 : 1);
    const along = (t: number) => [e.ax + e.tx * t, e.az + e.tz * t] as const;

    // up high: a side wall standing clear of a lower neighbour
    const o = this.city.buildingAt(midX + e.nx * 3, midZ + e.nz * 3);
    if (e.kind === "party" || (o && o !== b)) {
      const low = o && o !== b ? o.h : 0, room = b.h - low - 1.2;
      if (room > 4 && e.L > 6) {
        const [x, z] = along(e.L * (0.3 + r(1) * 0.4));
        if (r(2) < 0.2 * rate) out.put(pick(HIGH, r(3)), x, low + 0.6, z, e.nx, e.nz, Math.min(e.L - 1.2, 15), room);
        else if (r(2) < 0.32 * rate && b.h < 45) out.put(pick(ROOFLINE, r(3)), x, b.h - 3.1, z, e.nx, e.nz, Math.min(e.L * 0.8, 9), 2.5);
      }
      return;
    }
    // along a shopfront: only the piers between the bays
    if (e.kind === "front" && e.ground !== "none" && e.ground !== "residential" && e.ground !== "lobby") {
      for (let s = 1; s < e.bays; s++) {
        if (r(10 + s) > 0.34 * rate) continue;
        const [x, z] = along(s * e.bayW + (r(40 + s) - 0.5) * 0.06);
        const name = pick(PIER, r(70 + s));
        out.put(name, x, 0.85 + r(100 + s) * 0.75, z, e.nx, e.nz, Math.min(0.42, widthOf(name, 0)), 0.75);
      }
      return;
    }
    // a blank stretch of wall, a service wall, a residential base (a doorman keeps a lobby clean)
    const n = Math.floor((e.L / 5.5) * rate * (e.ground === "lobby" ? 0.3 : 1) + r(5));
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.15 + r(10 + i) * 0.7) / n) * e.L, [x, z] = along(t), roll = r(30 + i), wid = r(60 + i);
      const room = Math.min(t, e.L - t) * 2 - 0.3;
      if (room < 0.4) continue;
      if (roll < 0.16 && room > 3.5) { const name = pick(BIG, r(90 + i)); out.put(name, x, 0.3, z, e.nx, e.nz, Math.min(room, 6.5), 2.6); }
      else if (roll < 0.42) { const name = pick(PAPER, r(90 + i)); out.put(name, x, name.startsWith("paste") ? 0.5 : 0.9 + wid * 0.6, z, e.nx, e.nz, Math.min(room, widthOf(name, wid)), 2.2); }
      else { const name = pick(HAND, r(90 + i)); out.put(name, x, 0.45 + wid * 1.4, z, e.nx, e.nz, Math.min(room, widthOf(name, wid)), 1.8); }
    }
  }

  private dressHoarding(out: Quads, h: HoardingRun) {
    const n = Math.floor(h.L / 1.5), seed = Math.round(h.ax * 3 + h.az * 7);
    for (let i = 0; i < n; i++) {
      const r = (k: number) => hash(seed + i * 11, k);
      if (r(1) > 0.72) continue;
      const name = pick(HOARDING, r(2)), t = ((i + 0.2 + r(3) * 0.6) / n) * h.L;
      const w = Math.min(widthOf(name, r(4)) * (name.startsWith("gig") || name.startsWith("bill") ? 1.3 : 1), h.L);
      out.put(name, h.ax + h.tx * t + h.nx * 0.12, name.startsWith("paste") ? 0.25 : 0.55 + r(5) * 0.7, h.az + h.tz * t + h.nz * 0.12, h.nx, h.nz, w, 2.1);
    }
  }

  /** The street closures' plywood: only the ones that are a wall of hoarding, on the side facing the open street. */
  private dressBarriers(out: Quads, ix: number, iz: number) {
    for (const bar of this.blockers.barriers) {
      if (Math.floor(bar.x / CHUNK) !== ix || Math.floor(bar.z / CHUNK) !== iz || !/hoarding/.test(BARRIER_NAME[bar.kind])) continue;
      const n = Math.floor((bar.half * 2) / 1.6), seed = Math.round(bar.x * 5 + bar.z * 3);
      for (let i = 0; i < n; i++) {
        const r = (k: number) => hash(seed + i * 13, k), across = -bar.half + ((i + 0.5) / n) * bar.half * 2;
        if (r(1) > 0.75 || inGap(bar, across, 1.2)) continue;
        const name = pick(HOARDING, r(2)), d = bar.depth[1] + 0.06;
        out.put(name, bar.x + bar.ax * across + bar.nx * d, name.startsWith("paste") ? 0.25 : 0.6 + r(3) * 0.8, bar.z + bar.az * across + bar.nz * d, bar.nx, bar.nz, widthOf(name, r(4)), 2.1);
      }
    }
  }

  /** The stairwell walls and the platforms: lit by the stations' own tubes, so they don't need the sun. */
  private belowGround() {
    const u = this.under, sub = this.city.subway, out = new Quads(this.art!);
    for (const s of u.shafts) {
      if (s.kind !== "stairs") continue;
      for (let k = 0; k < 5; k++) {
        const r = (j: number) => hash(Math.round(s.x * 7) + k * 41, Math.round(s.z * 7) + j);
        if (r(1) > 0.8) continue;
        const a = -STAIRS.half + 1.2 + r(2) * 3.6;
        if (s.aCut !== undefined && a > s.aCut - 1) continue;
        const side = r(3) < 0.5 ? -1 : 1, b = side * (STAIRS.halfWidth - 0.02);
        const y = STAIRS.top - (a + STAIRS.half) * STAIRS.slope + 0.55 + r(4) * 0.9;
        const x = s.x + s.ux * a + s.uz * b, z = s.z + s.uz * a - s.ux * b, name = pick(BELOW, r(5));
        // the wall faces into the stairwell, back toward the middle
        out.put(name, x, y, z, -s.uz * side, s.ux * side, Math.min(1.1, widthOf(name, r(6))), 0.9);
      }
    }
    for (const st of u.stations) {
      if (u.isBlocked(st.ss)) continue;
      for (const side of [1, -1]) {
        for (let d = -66; d <= 66; d += 2.6) {
          const ss = st.ss + d, r = (j: number) => hash(Math.round(ss * 5) + side, j);
          if (r(1) > 0.46 || u.wallProps.some((w) => w.side === side && Math.abs(w.s - ss) < 2.2) || u.fareAreas.some((f) => f.station === st.name && f.side === side && Math.abs(f.s - ss) < 12)) continue;
          const p = sub.at(ss), off = (TUNNEL.stationHalfWidth - 0.03) * side, name = pick(BELOW, r(2));
          const y = TUNNEL.floor + u.dip(ss) + 1.1 + 0.35 + r(3) * 1.3;
          out.put(name, p.x + p.tz * off, y, p.z - p.tx * off, -p.tz * side, p.tx * side, Math.min(1.2, widthOf(name, r(4))), 0.85);
        }
      }
    }
    const m = new THREE.Mesh(out.geometry(), new THREE.MeshBasicMaterial({ map: this.map, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, color: 0x8c8c8c }));
    m.renderOrder = 1;
    m.frustumCulled = false;
    this.root.add(m);
  }
}
