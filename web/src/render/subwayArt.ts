// The modelled subway: NYC-style stainless trains, proper track with the covered third rail,
// platform edges with the yellow tactile strip, fare control (turnstiles, full-height exit gates,
// emergency gates, token booths), mosaic name tablets, posters, benches, signs, tunnel signals,
// blue emergency boxes, cable runs, work lights and the street entrances with their green globes.
//
// Assets come from tools/subway (Blender + Tesseract): public/models/subway.glb (+ subway.json and
// four JPEG textures). Everything samples one texture atlas. Things that repeat along the line are
// instanced, and each frame only the stretch of line near the camera is copied into the instance
// buffers (instances are kept sorted by distance along the subway, so that is one contiguous copy).
// Station furniture is merged per station and shown only near that station.
//
// Same frame as subway.ts: s = distance along city.subway, lateral offset `off` in the sign of
// Polyline.nearest (world = p + (tz, -tx) * off), +Y up, TUNNEL.floor = the tunnel floor.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARE, PLATFORM_STAIR, STAIRS, TRAIN, TUNNEL, type FareArea, type Train, type Underground } from "../world/underground";
import { cutRects, entranceStyle, subwayCuts } from "./subwayEntrances";

/** heights the art is built to (world y) */
export const SUBWAY_ART = {
  /** top of the running rails: car wheels sit here */
  railTop: TUNNEL.floor + 0.35,
  /** top of the platforms (as subway.ts draws them) */
  platformTop: TUNNEL.floor + 1.1,
  /** where the platform edge (coping) is, laterally from the line's centre */
  platformEdge: 4.95,
  carLength: TRAIN.length / 8,
};

type Rect = [number, number, number, number];
interface Meta { railTop: number; tris: Record<string, number>; atlas: { size: [number, number]; rects: Record<string, Rect>; tablet_field: Rect } }
type MatName = "atlas" | "metal" | "glow" | "lamp";
interface Part { geo: THREE.BufferGeometry; mat: MatName }

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const _a = { x: 0, z: 0, tx: 0, tz: 1 }, _b = { x: 0, z: 0, tx: 0, tz: 1 };

function lowerBound(a: Float32Array, n: number, x: number) {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// ------------------------------------------------------------------ the shared look

export interface SubwayMaterials {
  atlas: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  /** the lit car interiors and signs (dimmer than the station signs so the windows don't blow out) */
  trainGlow: THREE.MeshBasicMaterial;
  lamp: THREE.MeshBasicMaterial;
  /** replacements for SubwayMesh's wall / floor materials (they keep subway.ts's UVs: u = s, v = y) */
  stationWall: THREE.MeshStandardMaterial;
  tunnelWall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  platformTop: THREE.MeshStandardMaterial;
}

// ------------------------------------------------------------------ instanced strips along the line

/** One kind of prop placed all along the line: instanced, windowed around the camera. */
class Strip {
  readonly meshes: THREE.InstancedMesh[] = [];
  private ss!: Float32Array;
  private mats!: Float32Array;
  private colors: Float32Array | null = null;
  private n = 0;
  private lo = -1;
  private hi = -1;
  constructor(readonly name: string, private items: { ss: number; m: THREE.Matrix4; c?: THREE.Color }[], readonly radius: number, readonly underOnly = true) {}

  build(parts: Part[], mats: Record<MatName, THREE.Material>, root: THREE.Object3D) {
    const items = this.items.sort((a, b) => a.ss - b.ss);
    this.n = items.length;
    this.ss = new Float32Array(this.n);
    this.mats = new Float32Array(this.n * 16);
    items.forEach((it, i) => { this.ss[i] = it.ss; it.m.toArray(this.mats, i * 16); });
    if (items.some((it) => it.c)) {
      this.colors = new Float32Array(this.n * 3);
      items.forEach((it, i) => (it.c ?? new THREE.Color(1, 1, 1)).toArray(this.colors!, i * 3));
    }
    // capacity: the most instances any window of this radius can hold
    let cap = 0;
    for (let i = 0, j = 0; i < this.n; i++) { while (this.ss[i] - this.ss[j] > this.radius * 2) j++; cap = Math.max(cap, i - j + 1); }
    cap = Math.max(1, cap);
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, mats[p.mat], cap);
      im.name = `${this.name}:${p.mat}`;
      im.frustumCulled = false;
      im.count = 0;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (this.colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(im);
      root.add(im);
    }
    this.items = [];
  }

  update(near: number, show: boolean) {
    let i0 = 0, i1 = 0;
    if (show) { i0 = lowerBound(this.ss, this.n, near - this.radius); i1 = lowerBound(this.ss, this.n, near + this.radius); }
    if (i0 === this.lo && i1 === this.hi) return;
    this.lo = i0; this.hi = i1;
    for (const im of this.meshes) {
      const count = Math.min(i1 - i0, im.instanceMatrix.count);
      (im.instanceMatrix.array as Float32Array).set(this.mats.subarray(i0 * 16, (i0 + count) * 16));
      im.instanceMatrix.needsUpdate = true;
      if (this.colors && im.instanceColor) {
        (im.instanceColor.array as Float32Array).set(this.colors.subarray(i0 * 3, (i0 + count) * 3));
        im.instanceColor.needsUpdate = true;
      }
      im.count = count;
      im.visible = count > 0;
    }
  }
}

// ------------------------------------------------------------------ trains

/**
 * Modelled subway cars for the trains. Drop-in for TrainsView: give it the same Train list.
 * Cars are drawn at lo0 + carL * (k + 0.5) and skipped outside [min(head, tail), max(head, tail)];
 * the end cars are cab cars facing outward, headlights white at the head and red at the tail.
 */
export class TrainsArt {
  readonly root = new THREE.Group();
  private sets: { key: string; meshes: THREE.InstancedMesh[]; lamp: THREE.InstancedMesh | null; n: number }[] = [];
  private head = new THREE.Color(6, 5.6, 4.6);
  private tail = new THREE.Color(5, 0.25, 0.15);

  constructor(variants: Record<string, Part[]>, mats: Record<MatName, THREE.Material>, readonly max = 96) {
    this.root.name = "trainsArt";
    for (const [key, parts] of Object.entries(variants)) {
      const meshes: THREE.InstancedMesh[] = [];
      let lamp: THREE.InstancedMesh | null = null;
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geo, mats[p.mat], max);
        im.name = `train_${key}:${p.mat}`;
        im.frustumCulled = false;
        im.count = 0;
        im.castShadow = false;
        im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (p.mat === "lamp") { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); lamp = im; }
        meshes.push(im);
        this.root.add(im);
      }
      this.sets.push({ key, meshes, lamp, n: 0 });
    }
  }

  /** sub: city.subway; trains: Airflow.trainsAt(t); focus: the camera / leaf position */
  update(sub: { at(s: number, out?: { x: number; z: number; tx: number; tz: number }): { x: number; z: number; tx: number; tz: number }; nearest(x: number, z: number): { s: number }; length: number },
    trains: Train[], focus: THREE.Vector3, range = 600, dip?: (s: number) => number) {
    const near = sub.nearest(focus.x, focus.z).s;
    const carL = SUBWAY_ART.carLength;
    const by = new Map(this.sets.map((s) => [s.key, s]));
    for (const s of this.sets) s.n = 0;
    for (const tr of trains) {
      const lo = Math.min(tr.head, tr.tail), hi = Math.max(tr.head, tr.tail);
      if (hi < near - range || lo > near + range) continue;
      const dirKey = tr.dir > 0 ? "up" : "dn";
      for (let k = 0; k < 8; k++) {
        const ss = tr.lo0 + carL * (k + 0.5);
        if (ss < 0 || ss > sub.length || ss < lo - carL * 0.3 || ss > hi + carL * 0.3) continue;
        const cab = k === 0 || k === 7;
        const set = by.get(`${cab ? "front" : "mid"}_${dirKey}`)!;
        if (set.n >= this.max) continue;
        // on its two bogies (round the bends and up and down the dips: the car is the chord between them)
        const back = k === 0 ? 1 : -1; // the rear cab faces backward
        const A = sub.at(ss - back * carL * 0.36, _a), xa = A.x + A.tz * tr.off, za = A.z - A.tx * tr.off, ya = dip ? dip(ss - back * carL * 0.36) : 0;
        const B = sub.at(ss + back * carL * 0.36, _b), xb = B.x + B.tz * tr.off, zb = B.z - B.tx * tr.off, yb = dip ? dip(ss + back * carL * 0.36) : 0;
        const yaw = Math.atan2(xb - xa, zb - za), pitch = Math.atan2(yb - ya, Math.hypot(xb - xa, zb - za));
        _q.setFromEuler(_e.set(-pitch, yaw, 0, "YXZ"));
        _m.compose(_p.set((xa + xb) / 2, SUBWAY_ART.railTop + (ya + yb) / 2, (za + zb) / 2), _q, _s.set(1, 1, 1));
        for (const im of set.meshes) im.setMatrixAt(set.n, _m);
        if (set.lamp) {
          const leading = (k === 7 && tr.dir > 0) || (k === 0 && tr.dir < 0);
          set.lamp.setColorAt(set.n, leading ? this.head : this.tail);
        }
        set.n++;
      }
    }
    for (const s of this.sets) for (const im of s.meshes) {
      im.count = s.n;
      im.visible = s.n > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ the whole thing

interface Placed { name: string; m: THREE.Matrix4; remap?: [string, string][] }

/**
 * Loads the subway art and builds it along the real line.
 *
 *   const art = new SubwayArt(flow.under);
 *   scene.add(art.root);
 *   await art.load();                         // ./models/subway.glb and friends
 *   art.update(cam.position, underMix, flow.trainsAt(t), focus);   // every frame
 */
export class SubwayArt {
  readonly root = new THREE.Group();
  materials!: SubwayMaterials;
  trains!: TrainsArt;
  ready = false;
  /** where the fare-control areas went (s along the line, platform side), for debugging */
  readonly fareAreas: { s: number; side: number; station: string }[] = [];
  private strips: Strip[] = [];
  private stations: { ss: number; group: THREE.Group }[] = [];
  private meta!: Meta;
  private parts = new Map<string, Part[]>();
  private hint = -1;
  /** the failing fluorescent tubes' glow (dimmed and stuttered in update) */
  private flickerMat: THREE.MeshBasicMaterial | null = null;

  constructor(readonly u: Underground, readonly base = "./models/") {
    this.root.name = "subwayArt";
  }

  // --- the tunnel shape, as subway.ts draws it
  width(s: number) {
    let k = 0;
    for (const st of this.u.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
    return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k, k };
  }

  async load(): Promise<void> {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const tl = new THREE.TextureLoader();
    const tex = (f: string, flip: boolean) => tl.loadAsync(this.base + f).then((t) => {
      t.flipY = flip; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
    });
    const [gltf, meta, atlas, swall, twall, floor] = await Promise.all([
      new GLTFLoader().loadAsync(this.base + "subway.glb"),
      fetch(this.base + "subway.json").then((r) => r.json() as Promise<Meta>),
      tex("subway_atlas.jpg", false), tex("subway_station_wall.jpg", true), tex("subway_tunnel_wall.jpg", true), tex("subway_floor.jpg", true),
    ]);
    this.meta = meta;
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    this.materials = this.makeMaterials(atlas, swall, twall, floor);
    gltf.scene.updateMatrixWorld(true);
    for (const obj of gltf.scene.children) {
      const list: Part[] = [];
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const geo = m.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        const name = ((m.material as THREE.Material).name || "atlas") as MatName;
        list.push({ geo, mat: name });
      });
      this.parts.set(obj.name, list);
    }
    const mats = this.matMap();
    // the trains, with their uptown / downtown destination signs
    const variant = (name: string, dn: boolean) => this.partsFor(name, dn ? [["dest_up", "dest_dn"], ["side_up", "side_dn"]] : []);
    this.trains = new TrainsArt({ front_up: variant("car_front", false), front_dn: variant("car_front", true), mid_up: variant("car_mid", false), mid_dn: variant("car_mid", true) }, { ...mats, glow: this.materials.trainGlow });
    this.root.add(this.trains.root);
    this.buildLine();
    this.buildStations();
    this.ready = true;
  }

  private matMap(): Record<MatName, THREE.Material> {
    const m = this.materials;
    return { atlas: m.atlas, metal: m.metal, glow: m.glow, lamp: m.lamp };
  }

  private makeMaterials(atlas: THREE.Texture, swall: THREE.Texture, twall: THREE.Texture, floor: THREE.Texture): SubwayMaterials {
    // a touch of self-light from the albedo so nothing goes pitch black between the lamps
    const atlasMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.8, metalness: 0, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.035 });
    atlasMat.name = "subway_atlas";
    const metal = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.4, metalness: 0.5, envMapIntensity: 0.3, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.025 });
    metal.name = "subway_metal";
    const glow = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    glow.color.setScalar(1.1);
    glow.name = "subway_glow";
    const trainGlow = glow.clone();
    trainGlow.color.setScalar(0.85);
    trainGlow.name = "subway_train_glow";
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    lamp.name = "subway_lamp";
    swall.repeat.set(1 / 2, 1 / (TUNNEL.stationCeiling - TUNNEL.floor));
    swall.offset.set(0, -TUNNEL.floor / (TUNNEL.stationCeiling - TUNNEL.floor));
    const stationWall = new THREE.MeshStandardMaterial({ map: swall, roughness: 0.35, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: swall, emissiveIntensity: 0.04 });
    twall.repeat.set(1 / 26, 1 / (TUNNEL.ceiling - TUNNEL.floor));
    twall.offset.set(0, -TUNNEL.floor / (TUNNEL.ceiling - TUNNEL.floor));
    const tunnelWall = new THREE.MeshStandardMaterial({ map: twall, roughness: 0.92, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: twall, emissiveIntensity: 0.03 });
    // subway.ts gives both walls the same UVs, so one wall is seen from behind: un-mirror it (the graffiti reads right)
    tunnelWall.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <map_fragment>", "vec2 wallUv = vMapUv; if (!gl_FrontFacing) wallUv.x = -wallUv.x;\nvec4 sampledDiffuseColor = texture2D( map, wallUv );\ndiffuseColor *= sampledDiffuseColor;")
        .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= texture2D( emissiveMap, wallUv ).rgb;");
    };
    const fl = floor.clone();
    fl.repeat.set(1 / 4, 1 / 4);
    fl.needsUpdate = true;
    const floorMat = new THREE.MeshStandardMaterial({ map: fl, roughness: 0.85, color: 0x8c8780 });
    const platformTop = new THREE.MeshStandardMaterial({ map: floor, roughness: 0.7, emissive: 0xffffff, emissiveMap: floor, emissiveIntensity: 0.03 });
    return { atlas: atlasMat, metal, glow, trainGlow, lamp, stationWall, tunnelWall, floor: floorMat, platformTop };
  }

  /** an object's parts, optionally with atlas regions swapped (e.g. a sign's text) */
  private partsFor(name: string, remap: [string, string][] = []): Part[] {
    const src = this.parts.get(name);
    if (!src) throw new Error(`subway.glb has no ${name}`);
    if (!remap.length) return src;
    return src.map((p) => {
      const geo = p.geo.clone();
      for (const [a, b] of remap) this.remapUV(geo, a, b);
      return { geo, mat: p.mat };
    });
  }

  private uvRect(name: string) {
    const [W, H] = this.meta.atlas.size;
    const r = this.meta.atlas.rects[name];
    return { u0: r[0] / W, v0: r[1] / H, u1: (r[0] + r[2]) / W, v1: (r[1] + r[3]) / H };
  }

  private remapUV(geo: THREE.BufferGeometry, from: string, to: string) {
    const f = this.uvRect(from), t = this.uvRect(to);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const e = 1e-4;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < f.u0 - e || u > f.u1 + e || v < f.v0 - e || v > f.v1 + e) continue;
      uv.setXY(i, t.u0 + ((u - f.u0) / (f.u1 - f.u0)) * (t.u1 - t.u0), t.v0 + ((v - f.v0) / (f.v1 - f.v0)) * (t.v1 - t.v0));
    }
    uv.needsUpdate = true;
  }

  // --- placement helpers --------------------------------------------------------------

  /** a prop at (s, lateral off, y), facing along the line (+Z = +s, +X = +off), turned by `turn`
   *  (y as if the line were level: it's raised or lowered with the tunnel's dips between the stations) */
  private at(s: number, off: number, y: number, turn = 0, scale?: THREE.Vector3) {
    const a = this.u.city.subway.at(s);
    return new THREE.Matrix4().compose(new THREE.Vector3(a.x + a.tz * off, y + this.u.dip(s), a.z - a.tx * off),
      new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(a.tx, a.tz) + turn), scale ?? new THREE.Vector3(1, 1, 1));
  }

  /** a 4 m module on polyline segment i (s = 4i .. 4i+4) at lateral off, with mitred joints so modules meet */
  private module(i: number, off: number, y: number, turn = 0) {
    const sub = this.u.city.subway;
    const n = sub.x.length;
    const joint = (j: number) => {
      const seg = (k: number) => { const a = Math.max(0, Math.min(n - 2, k)); const dx = sub.x[a + 1] - sub.x[a], dz = sub.z[a + 1] - sub.z[a], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
      const [ax, az] = seg(j - 1), [bx, bz] = seg(j);
      let nx = az + bz, nz = -ax - bx;
      const L = Math.hypot(nx, nz) || 1;
      nx /= L; nz /= L;
      const cos = Math.max(0.5, nx * bz + nz * -bx);
      return [sub.x[j] + nx * off / cos, sub.z[j] + nz * off / cos];
    };
    const [x0, z0] = joint(i), [x1, z1] = joint(i + 1);
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    // sheared to follow the line's grade (verticals stay vertical, the module's length runs up or down
    // the slope, so the modules meet end to end where the tunnel dips)
    const y0 = this.u.city.subwayDy[i] ?? 0, y1 = this.u.city.subwayDy[i + 1] ?? y0;
    const sgn = Math.cos(turn) >= 0 ? 1 : -1;
    const fx = dx / L, fz = dz / L;
    return new THREE.Matrix4().makeBasis(
      new THREE.Vector3(fz * sgn, 0, -fx * sgn),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx * sgn / sub.step, (y1 - y0) * sgn / sub.step, dz * sgn / sub.step),
    ).setPosition((x0 + x1) / 2, y + (y0 + y1) / 2, (z0 + z1) / 2);
  }

  private strip(name: string, items: { ss: number; m: THREE.Matrix4; c?: THREE.Color }[], radius = 110, underOnly = true, remap: [string, string][] = [], model = name, mats?: Partial<Record<MatName, THREE.Material>>) {
    if (!items.length) return;
    const st = new Strip(name, items, radius, underOnly);
    st.build(this.partsFor(model, remap), { ...this.matMap(), ...mats }, this.root);
    this.strips.push(st);
  }

  // --- along the whole line -----------------------------------------------------------

  private buildLine() {
    const u = this.u, sub = u.city.subway, F = TUNNEL.floor;
    const track: { ss: number; m: THREE.Matrix4 }[] = [], edge: typeof track = [], cables: typeof track = [];
    const nSeg = Math.floor(Math.min(u.end, sub.length) / sub.step);
    for (let i = 0; i < nSeg; i++) {
      const s = i * sub.step + sub.step / 2;
      if (u.isBlocked(s)) continue;
      const w = this.width(s);
      for (const off of [TRAIN.track, -TRAIN.track]) track.push({ ss: s, m: this.module(i, off, F, off > 0 ? 0 : Math.PI) });
      if (w.k > 0.6) for (const side of [1, -1]) edge.push({ ss: s, m: this.module(i, SUBWAY_ART.platformEdge * side, F, side > 0 ? 0 : Math.PI) });
      if (w.k < 0.4) for (const side of [1, -1]) cables.push({ ss: s, m: this.module(i, w.hw * side, F, side > 0 ? Math.PI : 0) });
    }
    this.strip("track", track, 120);
    this.strip("platform_edge", edge, 110);
    this.strip("cable_run", cables, 100);

    // the I-beam row between the tracks, on the collision columns (s = 8k)
    const beams: typeof track = [];
    for (let s = 0; s < u.end; s += TUNNEL.columnEvery) {
      if (u.isBlocked(s)) continue;
      const w = this.width(s);
      if (w.k >= 0.3) continue;
      beams.push({ ss: s, m: this.at(s, 0, F, 0, new THREE.Vector3(1, (w.ceil - F) / 6.9, 1)) });
    }
    this.strip("ibeam", beams, 100);

    // light fittings where subway.ts puts its lamps; signals, blue boxes, emergency lights
    const work: typeof track = [], fluor: typeof track = [], flicker: typeof track = [], sigR: typeof track = [], sigG: typeof track = [], blue: typeof track = [], emerg: typeof track = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let s = 0; s < u.end; s += 8) {
      if (u.isBlocked(s)) continue;
      const w = this.width(s);
      if (w.k > 0.999) {
        // (the stations proper: their fixtures hang from the girders, see buildStations)
      } else if (w.k > 0.6) {
        for (const off of [-3.3, 3.3, -8.5, 8.5]) fluor.push({ ss: s, m: this.at(s, off, w.ceil, 0) });
      } else if (s % 32 === 0) {
        const side = (s / 32) % 2 ? 1 : -1;
        work.push({ ss: s, m: this.at(s, w.hw * side, w.ceil - 1.2, side > 0 ? Math.PI : 0) });
      }
      if (w.k < 0.3) {
        // signals face the trains coming at them: the +off wall serves the uptown (+s) track
        if (Math.round(s) % 120 === 0) for (const side of [1, -1]) (rnd() < 0.5 ? sigR : sigG).push({ ss: s + 2, m: this.at(s + 2, w.hw * side, F, side > 0 ? Math.PI : 0) });
        if (Math.round(s) % 152 === 64) { const side = (s / 8) % 2 ? 1 : -1; blue.push({ ss: s + 4, m: this.at(s + 4, w.hw * side, F, side > 0 ? Math.PI : 0) }); }
        if (Math.round(s) % 24 === 16) { const side = (s / 24) % 2 ? 1 : -1; emerg.push({ ss: s + 1, m: this.at(s + 1, w.hw * side, F + 2.6, side > 0 ? Math.PI : 0) }); }
      }
    }
    this.strip("work_light", work, 110);
    this.strip("fluor", fluor, 110);
    this.flickerMat = this.materials.glow.clone();
    // (a few tubes in every station are on their way out: they buzz and stutter now and then)
    for (const h of u.hangers) if (h.kind === "fluor" && h.flicker) flicker.push({ ss: h.s, m: this.at(h.s, h.off, this.width(h.s).ceil, 0) });
    this.strip("fluor_flicker", flicker, 110, true, [], "fluor_hung", { glow: this.flickerMat });
    this.strip("signal_red", sigR, 130);
    this.strip("signal_green", sigG, 130);
    this.strip("blue_light", blue, 120);
    this.strip("emergency_light", emerg, 100);

    // the street entrances with the green railings (render/subwayEntrances.ts builds the other styles),
    // on the sidewalk round the opening, facing the stairs' way down (the shaft's +a axis); the ways out
    // get red globes
    const ent: typeof track = [], entOut: typeof track = [];
    for (const sh of u.shafts) {
      if (sh.kind !== "stairs" || entranceStyle(sh, u) !== "railing") continue;
      (sh.out ? entOut : ent).push({ ss: sh.ss, m: new THREE.Matrix4().compose(new THREE.Vector3(sh.x, STAIRS.top, sh.z), new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(sh.ux, sh.uz)), new THREE.Vector3(1, 1, 1)) });
    }
    this.strip("street_entrance", ent, 320, false);
    this.strip("street_entrance_out", entOut, 320, false, [["globe_green", "sig_red"]], "street_entrance");
  }

  // --- the stations ------------------------------------------------------------------

  private buildStations() {
    const u = this.u, F = TUNNEL.floor, PY = SUBWAY_ART.platformTop;
    for (const st of u.stations) {
      if (u.isBlocked(st.ss)) continue;
      const placed: Placed[] = [];
      const put = (name: string, s: number, off: number, y: number, turn = 0, remap?: [string, string][], scale?: THREE.Vector3) =>
        placed.push({ name, m: this.at(s, off, y, turn, scale), remap });
      // fare control at the foot of each entrance's passage, one per platform side within 30 m
      // (worked out in world/underground.ts, which makes them solid)
      const areas = u.fareAreas.filter((a) => a.station === st.name);
      for (const fa of areas) { this.fareArea(put, fa); this.fareAreas.push({ s: fa.s, side: fa.side, station: st.name }); }
      // (Bowling Green's platform would run on past where the line starts: nothing goes out there)
      const inLine = (s: number) => s > u.start + 2 && s < u.end - 2;

      for (const side of [1, -1]) {
        const away = side > 0 ? Math.PI : 0; // wall props face away from the wall
        // platform columns
        for (let ds = -63; ds <= 63; ds += 9) {
          const s = st.ss + ds;
          if (this.width(s).k < 0.95 || u.columnHidden(s, side) || !inLine(s)) continue;
          put("column", s, 7.0 * side, PY, 0, undefined, new THREE.Vector3(1, (this.width(s).ceil - PY) / 6.0, 1));
        }
        // the wall: posters, mosaic plaques, a map; benches and trash cans in front
        // posters, the map and plaques where world/underground.ts's placement pass put them (clear of everything)
        for (const wp of u.wallProps) {
          if (wp.side !== side || wp.kind === "tablet" || Math.abs(wp.s - st.ss) > TUNNEL.stationHalfLength) continue;
          const j = wp.j, s = wp.s, wall = this.width(s).hw * side;
          if (wp.kind === "map") put("map_frame", s, wall, PY, away);
          else if (wp.kind === "ad") {
            const ads = ["ad_soup", "ad_movie", "ad_dental", "ad_kites", "ad_owl", "ad_pigeon", "ad_mattress", "ad_tree"];
            const ad = ads[(j * 3 + (side > 0 ? 0 : 5) + Math.round(st.ss)) % ads.length];
            put("ad_frame", s, wall, PY, away, ad === "ad_soup" ? undefined : [["ad_soup", ad]]);
          } else put("plaque", s, wall, F + 3.65, away);
        }
      }
      // the ceiling: girders on every column line (in 2.5 m lengths, none across a stair's opening), conduit along
      // both walls, and what hangs from them (world/underground.ts: placed there, solid there)
      const C = this.width(st.ss).ceil;
      const open = (s: number, off: number) => { const a = u.city.subway.at(s), x = a.x + a.tz * off, z = a.z - a.tx * off; return u.sdf(x, C + 0.2, z) > 0 || u.ceilingClear(x, z); };
      for (let j = -8; j <= 8; j++) {
        const s = st.ss + j * 9;
        if (!inLine(s)) continue;
        const hw = this.width(s).hw;
        // (from each wall to its column line, as the old stations have them: none over the tracks)
        for (const off of [-hw + 1.25, -hw + 3.75, hw - 3.75, hw - 1.25]) {
          if (!(open(s, off) || open(s, off - 1.2) || open(s, off + 1.2))) { put("girder", s, off, C); continue; }
          // (by an opening: in half lengths, so the girder runs on up to the trimmer round it)
          for (const h of [-0.625, 0.625]) if (!(open(s, off + h) || open(s, off + h - 0.6) || open(s, off + h + 0.6))) put("girder", s, off + h, C, 0, undefined, new THREE.Vector3(0.5, 1, 1));
        }
      }
      for (const side of [1, -1]) for (let s = st.ss - 70.5; s <= st.ss + 70.5; s += 3) if (inLine(s) && !open(s, 10.2 * side)) put("conduit", s, 10.2 * side, C, side > 0 ? Math.PI : 0);
      for (const h of u.hangers) {
        if (h.station !== st.name) continue;
        if (h.kind === "fluor" && !h.flicker) put("fluor_hung", h.s, h.off, C);
        else if (h.kind === "cctv" || h.kind === "speaker") put(h.kind, h.s, h.off, C, h.off > 0 ? -Math.PI / 2 : Math.PI / 2);
        else if (h.kind === "sign_dir") put("sign_hang", h.s, h.off, C, 0, h.side > 0 ? undefined : [["sign_uptown", "sign_downtown"]]);
        else if (h.kind === "sign_exit") put("sign_hang", h.s, h.off, C, 0, [["sign_uptown", "sign_exit"]]);
      }
      // the furniture the leaf can hit (world/underground.ts places it and makes it solid): benches, trash
      // cans, the fare-card machines, someone asleep on a bench, a busker
      for (const p of u.stationProps) {
        if (p.station !== st.name) continue;
        const away = p.side > 0 ? Math.PI : 0;
        if (p.kind === "bench" || p.kind === "sleeper") put("bench", p.s, p.off, PY, away);
        if (p.kind === "sleeper") put("sleeper", p.s, p.off, PY, away);
        if (p.kind === "trash") put("trash", p.s, p.off, PY);
        if (p.kind === "fare_machine" || p.kind === "busker") put(p.kind, p.s, p.off, PY, away);
        if (p.kind === "commuter") put(p.variant ? "commuter_b" : "commuter_a", p.s, p.off, PY, away + (p.turn ?? 0) * Math.PI / 2);
      }
      this.stations.push({ ss: st.ss, group: this.mergeStation(placed, st) });
    }
  }

  /** fare control where a passage comes down to the platform: stairs up the wall to the passage
   *  mouth, a line of turnstiles, exit gates and an emergency gate, railings to the wall and a booth. */
  private fareArea(put: (name: string, s: number, off: number, y: number, turn?: number, remap?: [string, string][], scale?: THREE.Vector3) => void, fa: FareArea) {
    const PY = SUBWAY_ART.platformTop, P = PLATFORM_STAIR;
    const { s, side, dir } = fa;
    const hw = this.width(s).hw;
    const at = (d: number) => s + d * dir; // along the stairs' frame (world/underground.ts PLATFORM_STAIR, FARE)
    // the stairs up to the landing in front of the doorway the passage comes through (the tiled wall on the
    // platform side: the station wall, with the doorway, is the other), and the barrier across their foot
    put(side * dir > 0 ? "platform_stair_a" : "platform_stair_b", at(P.foot), (hw - (P.o0 + P.o1) / 2) * side, PY, dir > 0 ? 0 : Math.PI);
    put("barrier", at(FARE.barrier), (hw - 1.4) * side, PY);
    if (!fa.fare) return;
    const line = (hw - FARE.line) * side;
    const face = -side * Math.PI / 2; // turnstiles: entry (reader end) on the wall side
    put("fare_rail", at(FARE.s0 + 1), line, PY);
    put("emergency_gate", at(FARE.emergency), line, PY, Math.PI / 2);
    for (const d of FARE.turnstiles) put("turnstile", at(d), line, PY, face);
    for (const d of FARE.gates) put("exit_gate", at(d), line, PY, face);
    put("fare_rail", at(FARE.s1 - 1), line, PY);
    for (const d of [FARE.s0, FARE.s1]) for (const k of [1.0, 3.0]) put("fare_rail", at(d), line + k * side, PY, Math.PI / 2);
    put("booth", at(FARE.booth), (hw - 1.4) * side, PY, Math.PI);
  }

  private mergeStation(placed: Placed[], st: { ss: number; name: string }): THREE.Group {
    const g = new THREE.Group();
    g.name = "station:" + st.name;
    const byMat: Record<string, THREE.BufferGeometry[]> = {};
    const variants = new Map<string, Part[]>();
    for (const p of placed) {
      const key = p.name + JSON.stringify(p.remap ?? []);
      let parts = variants.get(key);
      if (!parts) variants.set(key, (parts = this.partsFor(p.name, p.remap ?? [])));
      for (const part of parts) {
        const geo = part.geo.clone().applyMatrix4(p.m);
        for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
        (byMat[part.mat] ??= []).push(geo.index ? geo : geo.setIndex([...Array(geo.attributes.position.count).keys()]));
      }
    }
    const mats = this.matMap();
    for (const [mat, geos] of Object.entries(byMat)) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[mat as MatName]);
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    // platform tops (from the tactile strip to the wall) and the mosaic name tablets; the vaulted ceiling
    g.add(this.platformTops(st.ss));
    g.add(this.stationCeiling(st.ss));
    g.add(this.tablets(st));
    this.root.add(g);
    return g;
  }

  /** The station's ceiling over its full width: shallow jack arches between the girder lines (rising 0.3 m over
   *  the ceiling line, so nothing of them hangs down), painted over the platforms and sooty over the tracks,
   *  and a moulded cornice where they meet the walls. The stairs' openings are cut out. (subway.ts leaves its
   *  flat ceiling out here.) */
  private stationCeiling(ss: number): THREE.Mesh {
    const sub = this.u.city.subway, R = TUNNEL.stationHalfLength;
    const pos: number[] = [], uv: number[] = [];
    const lines = [-R, ...Array.from({ length: 17 }, (_, i) => (i - 8) * 9), R].map((d) => ss + d);
    const rect = (n: string) => this.uvRect(n);
    const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], down: boolean) => {
      // wound to face down (seen from the platform) or into the hall (the cornice)
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const flip = down ? ny > 0 : false;
      void nx;
      if (flip) { pos.push(...a, ...c, ...b); uv.push(...ua, ...uc, ...ub); } else { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); }
    };
    const quad = (p: number[][], t: number[][], down: boolean) => { tri(p[0], p[1], p[2], t[0], t[1], t[2], down); tri(p[0], p[2], p[3], t[0], t[2], t[3], down); };
    const P = (s: number, off: number, y: number) => { const a = sub.at(s); return [a.x + a.tz * off, y, a.z - a.tx * off]; };
    const lerpUV = (r: { u0: number; v0: number; u1: number; v1: number }, a: number, b: number) => [r.u0 + (r.u1 - r.u0) * (0.01 + 0.98 * a), r.v0 + (r.v1 - r.v0) * (0.02 + 0.96 * b)];
    for (let b = 0; b < lines.length - 1; b++) {
      const s0 = Math.max(lines[b], this.u.start + 0.01), s1 = Math.min(lines[b + 1], this.u.end - 0.01);
      if (s1 - s0 < 0.2) continue;
      const span = lines[b + 1] - lines[b], rise = 0.3 * Math.min(1, span / 9), n = Math.max(2, Math.ceil((s1 - s0) / 1));
      const C = (s: number) => this.width(s).ceil + rise * Math.sin(Math.PI * Math.min(1, Math.max(0, (s - lines[b]) / span)));
      for (let i = 0; i < n; i++) {
        const sa = s0 + ((s1 - s0) * i) / n, sb = s0 + ((s1 - s0) * (i + 1)) / n;
        const ta = (sa - lines[b]) / span, tb = (sb - lines[b]) / span;
        const hw = this.width(sa).hw;
        // over each platform and over the tracks
        for (const [o0, o1, name] of [[-hw, -5.2, "vault_paint"], [-5.2, 5.2, "vault_soot"], [5.2, hw, "vault_paint"]] as const) {
          const r = rect(name), va = (x: number) => (x - o0) / (o1 - o0);
          quad([P(sa, o0, C(sa)), P(sb, o0, C(sb)), P(sb, o1, C(sb)), P(sa, o1, C(sa))],
            [lerpUV(r, ta, va(o0)), lerpUV(r, tb, va(o0)), lerpUV(r, tb, va(o1)), lerpUV(r, ta, va(o1))], true);
        }
        // the cornice down each wall: from 0.3 m under the ceiling line up into the arch
        const r = rect("cornice");
        for (const side of [1, -1]) {
          const o = (hw - 0.02) * side, ua = ((sa - ss) / 3) % 1, ub = ua + (sb - sa) / 3;
          quad([P(sa, o, C(sa)), P(sb, o, C(sb)), P(sb, o, this.width(sb).ceil - 0.3), P(sa, o, this.width(sa).ceil - 0.3)],
            [lerpUV(r, Math.abs(ua), 0), lerpUV(r, Math.abs(ub) > 1 ? 1 : Math.abs(ub), 0), lerpUV(r, Math.abs(ub) > 1 ? 1 : Math.abs(ub), 1), lerpUV(r, Math.abs(ua), 1)], false);
        }
      }
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g = cutRects(g, subwayCuts(this.u).ceil);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.materials.atlas);
    m.name = "stationCeiling";
    m.receiveShadow = true;
    // (the cornice faces into the hall from both walls: drawn both sides)
    return m;
  }

  private platformTops(ss: number): THREE.Mesh {
    const sub = this.u.city.subway;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const y = SUBWAY_ART.platformTop + 0.002;
    const inner = SUBWAY_ART.platformEdge + 1.2;
    const i0 = Math.floor((ss - TUNNEL.stationHalfLength - 30) / sub.step), i1 = Math.ceil((ss + TUNNEL.stationHalfLength + 30) / sub.step);
    for (const side of [1, -1]) {
      let prev = -1;
      for (let i = i0; i <= i1; i++) {
        const s = i * sub.step;
        const w = this.width(s);
        if (w.k <= 0.6 || this.u.isBlocked(s)) { prev = -1; continue; }
        const a = sub.at(s);
        const base = pos.length / 3;
        for (const off of [inner * side, w.hw * side]) {
          pos.push(a.x + a.tz * off, y, a.z - a.tx * off);
          uv.push(off / 4, s / 4);
        }
        if (prev >= 0) {
          // wind each triangle to face up
          const tri = (a: number, b: number, c: number) => {
            const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
            const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
            if (ny >= 0) idx.push(a, b, c); else idx.push(a, c, b);
          };
          tri(prev, prev + 1, base + 1);
          tri(prev, base + 1, base);
        }
        prev = base;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.materials.platformTop);
    m.receiveShadow = true;
    return m;
  }

  /** the station name in mosaic tesserae, set into the Tesseract-designed tablet frame */
  private tabletTexture(name: string): THREE.Texture {
    const [fx, fy, fw, fh] = this.meta.atlas.rects["tablet_frame"];
    const [tx, ty, tw, th] = this.meta.atlas.tablet_field;
    const cv = document.createElement("canvas");
    cv.width = fw; cv.height = fh;
    const c = cv.getContext("2d")!;
    const img = this.materials.atlas.map!.image as CanvasImageSource;
    c.drawImage(img, fx, fy, fw, fh, 0, 0, fw, fh);
    // the name at mosaic resolution: one pixel per 4 px tessera
    const T = 4, gw = Math.floor(tw / T), gh = Math.floor(th / T);
    const small = document.createElement("canvas");
    small.width = gw; small.height = gh;
    const sc = small.getContext("2d")!;
    const text = name.toUpperCase().replace(/-/g, " - ");
    let size = gh * 0.72;
    sc.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    const wmax = gw * 0.92;
    const tw0 = sc.measureText(text).width;
    if (tw0 > wmax) { size *= wmax / tw0; sc.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
    sc.fillStyle = "#000"; sc.textAlign = "center"; sc.textBaseline = "middle";
    sc.fillText(text, gw / 2, gh / 2 + size * 0.04);
    const px = sc.getImageData(0, 0, gw, gh).data;
    let seed = name.length * 977;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const a = px[(j * gw + i) * 4 + 3];
      if (a < 110) continue;
      const v = 22 + rnd() * 26;
      c.fillStyle = `rgb(${v},${v * 0.92},${v * 0.85})`;
      c.fillRect(tx + i * T + 0.5, ty + j * T + 0.5, T - 1, T - 1);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  private tablets(st: { ss: number; name: string }): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = [];
    // (where world/underground.ts's placement pass put them: clear of the stairs, fare controls and booths)
    for (const tp of this.u.wallProps) {
      if (tp.kind !== "tablet" || Math.abs(tp.s - st.ss) > TUNNEL.stationHalfLength) continue;
      const s = tp.s, side = tp.side;
      const w = this.width(s);
      const g = new THREE.PlaneGeometry(3.6, 0.9);
      // facing away from the wall: the plane's +Z normal turned to -side * lateral
      g.applyMatrix4(this.at(s, (w.hw - 0.03) * side, TUNNEL.floor + 4.7, side > 0 ? -Math.PI / 2 : Math.PI / 2));
      geos.push(g);
    }
    const mat = new THREE.MeshStandardMaterial({ map: this.tabletTexture(st.name), roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.05 });
    mat.emissiveMap = mat.map;
    const m = new THREE.Mesh(mergeGeometries(geos)!, mat);
    m.name = "tablets:" + st.name;
    return m;
  }

  // --- per frame -----------------------------------------------------------------------

  /**
   * cam: the camera position; underground: 0..1 (main.ts's underMix); trains/focus: pass
   * Airflow.trainsAt(t) and the leaf/focus position to drive the modelled trains too.
   */
  update(cam: THREE.Vector3, underground: number, trains?: Train[], focus?: THREE.Vector3) {
    if (!this.ready) return;
    const sub = this.u.city.subway;
    const near = sub.nearest(cam.x, cam.z, this.hint).s;
    this.hint = near;
    const under = underground > 0.01 || cam.y < -0.5;
    for (const st of this.strips) st.update(near, !st.underOnly || under);
    if (this.flickerMat && under) {
      // a tired tube: a little dim, and every few seconds a short, soft stutter (never a strobe)
      const t = performance.now() / 1000, ph = t % 6.7;
      const k = ph < 0.45 ? 0.35 + 0.45 * (Math.sin(ph * 41) > 0.2 ? 1 : 0) : ph < 0.9 ? 0.55 + 0.4 * ((ph - 0.45) / 0.45) : 0.95;
      this.flickerMat.color.setScalar(1.1 * k);
    }
    for (const st of this.stations) st.group.visible = under && Math.abs(st.ss - near) < TUNNEL.stationHalfLength + 140;
    if (trains) this.trains.update(sub, trains, focus ?? cam, 600, (s) => this.u.dip(s));
  }

  /**
   * Re-skins SubwayMesh's walls and floor with the Tesseract textures. Pass subway.root: the
   * first four meshes subway.ts adds are, in order, station walls, tunnel walls, floor, ceiling.
   */
  async retexture(subwayRoot: THREE.Object3D, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera) {
    if (!this.ready) return;
    const byName = (n: string) => subwayRoot.getObjectByName(n) as THREE.Mesh | undefined;
    const wall = byName("wall"), twall = byName("twall"), floor = byName("floor");
    const swaps: [THREE.Mesh | undefined, THREE.Material][] = [[wall, this.materials.stationWall], [twall, this.materials.tunnelWall], [floor, this.materials.floor]];
    // (swapping the materials on meshes already in the picture compiled their shaders and uploaded their
    // 2048 px textures inside a frame: ~100 ms each. Decode, upload and compile first, a piece a frame)
    if (renderer && scene && camera) {
      const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      const texs = new Set<THREE.Texture>();
      for (const [, m] of swaps) for (const t of [(m as THREE.MeshStandardMaterial).map, (m as THREE.MeshStandardMaterial).emissiveMap]) if (t) texs.add(t);
      for (const t of texs) {
        const img = t.image as HTMLImageElement | undefined;
        try { if (img && typeof img.decode === "function") await img.decode(); } catch { /* already decoded */ }
        renderer.initTexture(t);
        await nextFrame();
      }
      const probe = new THREE.Group();
      for (const [mesh, m] of swaps) if (mesh) probe.add(new THREE.Mesh(mesh.geometry, m));
      try { await renderer.compileAsync(probe, camera, scene); } catch { /* compiles on first draw instead */ }
      await nextFrame();
    }
    for (const [mesh, m] of swaps) if (mesh) mesh.material = m;
  }

  /** draw-call / triangle summary for debugging */
  stats() {
    let calls = 0, tris = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      let p: THREE.Object3D | null = m;
      while (p) { if (!p.visible) return; p = p.parent; }
      const im = m as THREE.InstancedMesh;
      const n = im.isInstancedMesh ? im.count : 1;
      if (!n) return;
      calls++;
      tris += ((m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3) * n;
    });
    return { calls, tris: Math.round(tris) };
  }
}
