// New York's street furniture, drawn: cobra-head and bishop's-crook lamps, signal masts with live
// red/amber/green and WALK/hand timing, green street-name blades with the real names, one-way
// arrows and parking rules, hydrants, standpipes, blue mailboxes, green wire baskets, newsstands,
// halal and hot dog carts, bike share docks and hoop racks, bus stops and shelters, wi-fi kiosks,
// pay stations, plaza bollards, planters and Jersey barriers, sidewalk sheds, Con Ed steam
// stacks, parked cars and double-parked delivery trucks with their hazards going.
//
// Placement: streetLayout.ts (pure data; its colliders are for sim/). Assets: tools/street/
// (Tesseract textures -> public/textures/street/, Blender -> public/models/street_props.glb).
//
//   const street = new StreetFurniture(city, { traffic, life, blockers, quality });
//   scene.add(street.root);
//   street.update(camera.position, focus, t);   // every frame: cheap unless the focus moved
//
// One instanced draw per part per kind, refilled from a 100 m grid with whatever is in range
// (ranges per kind, shorter at q=low), LODs for the lamps and the parked cars. Signals and
// blinkers animate in their shader from a time uniform: no per-frame CPU work.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Grid, type CityData } from "../world/data";
import { VEHICLE_SIZE, type Traffic, type VehicleKind } from "../world/traffic";
import type { StreetLife } from "../world/streetlife";
import type { Blockers } from "../world/blockers";
import { loadParkAssets } from "./centralPark";
import { SIGNAL, streetLayout, type StreetKind, type StreetLayout, type Court } from "./streetLayout";
import type { Quality } from "./stage";

export interface StreetFurnitureOptions {
  /** reuse a layout already made (e.g. by the sim for its colliders) */
  layout?: StreetLayout;
  traffic?: Traffic; life?: StreetLife; blockers?: Blockers;
  quality?: Quality;
  /** URL of the folder holding models/ and textures/ */
  base?: string;
}

interface Rect { x: number; y: number; w: number; h: number }
interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }

/** model name(s) per kind: [near, far] (far = the LOD beyond lodDist) */
const MODELS: Record<StreetKind, [string, string?]> = {
  light_cobra: ["light_cobra_lod0", "light_cobra_lod1"], light_crook: ["light_crook_lod0", "light_crook_lod1"],
  signal_pole: ["signal_pole"], mast_arm: ["mast_arm"], signal_head: ["signal_head"], ped_head: ["ped_head"],
  hydrant: ["hydrant"], standpipe: ["standpipe"], mailbox: ["mailbox"], basket: ["basket"], newsstand: ["newsstand"],
  food_cart: ["food_cart"], hotdog_cart: ["park:cart"], bike_dock: ["bike_dock"], bike: ["bike"], bike_kiosk: ["bike_kiosk"],
  bike_rack: ["bike_rack"], bus_pole: ["bus_pole"], bus_shelter: ["bus_shelter"], kiosk: ["kiosk"], munimeter: ["munimeter"],
  sign_post: ["sign_post"], planter: ["planter"], planter_round: ["planter_round"], bollard: ["bollard"], jersey: ["jersey"],
  shed_bay: ["shed_bay"], shed_end: ["shed_end"], steam_stack: ["steam_stack"],
  hoop: ["hoop"], fence_post: ["fence_post"], court_bench: ["park:bench"],
};
/** draw distance (m) at high quality; q=low takes 70% */
const RANGE: Partial<Record<StreetKind, number>> = {
  light_cobra: 480, light_crook: 420, signal_pole: 360, mast_arm: 360, signal_head: 320, shed_bay: 380, shed_end: 380,
  bus_shelter: 300, newsstand: 300, hoop: 340, fence_post: 300, steam_stack: 320, kiosk: 260, food_cart: 260, hotdog_cart: 260, jersey: 260, planter: 260, planter_round: 260,
};
const SMALL_RANGE = 220;
const SHADOW = new Set<StreetKind>(["hoop", "light_cobra", "light_crook", "signal_pole", "mast_arm", "signal_head", "shed_bay", "shed_end", "bus_shelter", "newsstand", "kiosk", "food_cart", "hotdog_cart", "steam_stack", "bike_kiosk"]);
const LOD_DIST = 90;

const PAINT = [0x1c1c1e, 0xe8e8e8, 0x6d7278, 0x22344d, 0x7a1d1d, 0x2f4a3a, 0xb8b2a6, 0x3a3a3c, 0x8a8f96, 0x5a1f2a];
function paintFor(kind: VehicleKind, seed: number): number {
  switch (kind) {
    case "cab": return 0xf2b705;
    case "police": return 0xf6f6f2;
    case "limo": return 0x111114;
    case "sports": return [0xd8261e, 0xf2b705, 0x1e3a8a, 0x111111][seed % 4];
    case "truck": case "van": return [0xf0f0ec, 0xc8382a, 0x2b5d9a, 0xe8e8e0, 0x6a4a2a][seed % 5];
    default: return PAINT[seed % PAINT.length];
  }
}

/** instanced parts sharing transforms, refilled from precomputed matrices */
class Batch {
  readonly meshes: THREE.InstancedMesh[];
  n = 0;
  constructor(parts: Part[], readonly cap: number, shadow: boolean, readonly colors = false, readonly coat = false) {
    this.meshes = parts.map((p) => {
      let geo = p.geo;
      if (coat) {
        // the park's figure material tints the coat from aCoat (and animates with aPhase / aMode)
        geo = geo.clone();
        const n = Math.max(1, cap);
        geo.setAttribute("aCoat", new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
        geo.setAttribute("aMode", new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
      }
      const m = new THREE.InstancedMesh(geo, p.mat, Math.max(1, cap));
      m.count = 0; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (colors && (p as Part & { paint?: boolean }).paint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3).setUsage(THREE.DynamicDrawUsage);
      return m;
    });
  }
  push(mats: Float32Array, i: number, cols?: Float32Array) {
    if (this.n >= this.cap) return;
    for (const m of this.meshes) {
      copy(mats, i * 16, m.instanceMatrix.array as Float32Array, this.n * 16, 16);
      if (cols && m.instanceColor) copy(cols, i * 3, m.instanceColor.array as Float32Array, this.n * 3, 3);
      if (cols && this.coat) copy(cols, i * 3, (m.geometry.getAttribute("aCoat") as THREE.BufferAttribute).array as Float32Array, this.n * 3, 3);
    }
    this.n++;
  }
  end() {
    for (const m of this.meshes) {
      m.count = this.n; m.visible = this.n > 0;
      upload(m.instanceMatrix, this.n * 16);
      if (m.instanceColor) upload(m.instanceColor, this.n * 3);
      if (this.coat) upload(m.geometry.getAttribute("aCoat") as THREE.BufferAttribute, this.n * 3);
    }
    this.n = 0;
  }
}

/** a set of placed things of one kind: matrices + a grid of their indices */
class Placed {
  readonly mats: Float32Array;
  readonly pos: Float32Array;
  readonly grid = new Grid<number>(100);
  extra?: Float32Array;   // per-instance attribute data (plates, lenses)
  cols?: Float32Array;
  constructor(readonly count: number) { this.mats = new Float32Array(count * 16); this.pos = new Float32Array(count * 2); }
  set(i: number, m: THREE.Matrix4, x: number, z: number) { m.toArray(this.mats, i * 16); this.pos[i * 2] = x; this.pos[i * 2 + 1] = z; this.grid.add(i, x, z, x, z); }
}

/** copy n floats from a[ai..] to b[bi..] (no subarray views: this runs for thousands of instances) */
function copy(a: Float32Array, ai: number, b: Float32Array, bi: number, n: number) { for (let k = 0; k < n; k++) b[bi + k] = a[ai + k]; }

/** upload only the part of an instance buffer in use */
function upload(a: THREE.BufferAttribute, n: number) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.max(1, n));
  a.needsUpdate = true;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const compose = (x: number, y: number, z: number, rot: number, sx = 1, sy = 1, sz = 1) => _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_Y, rot), _s.set(sx, sy, sz));

// ------------------------------------------------------------------ shaders

/** sign plates: a front and a back quad, each picking its own rect of the texture per instance */
function plateMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.25 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aFront; attribute vec4 aBack; attribute float aSide;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
        { vec4 R = aSide > 0.5 ? aBack : aFront; vMapUv = vec2(mix(R.x, R.z, uv.x), mix(R.y, R.w, uv.y)); }`);
  };
  return m;
}

/** signal lenses, WALK/hand, blinkers: lit by the clock (see streetLayout.signalState) */
function lensMaterial(atlas: THREE.Texture, rects: Record<string, Rect>, size: [number, number]): THREE.ShaderMaterial {
  const r = (n: string) => { const c = rects[n]; return new THREE.Vector4(c.x / size[0], c.y / size[1], (c.x + c.w) / size[0], (c.y + c.h) / size[1]); };
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: atlas }, uLens: { value: r("lens") }, uWalk: { value: r("walk") }, uHand: { value: r("hand") } },
    vertexShader: /* glsl */ `
      attribute vec4 aSig; varying vec4 vSig; varying vec2 vUv;
      void main() { vSig = aSig; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uMap; uniform vec4 uLens, uWalk, uHand;
      varying vec4 vSig; varying vec2 vUv;
      const float C = ${SIGNAL.cycle.toFixed(1)}, G = ${SIGNAL.green.toFixed(1)}, A = ${SIGNAL.amber.toFixed(1)}, W = ${SIGNAL.walk.toFixed(1)};
      void main() {
        float kind = vSig.x, group = vSig.y;
        float p = mod(uTime + vSig.z, C);
        float q = group < 0.5 ? p : mod(p + C * 0.5, C);
        float veh = q < G ? 2.0 : (q < G + A ? 1.0 : 0.0);
        float o = mod(q + C * 0.5, C);
        float walk = o < W ? 2.0 : (o < G + A ? 1.0 : 0.0);
        vec4 R = kind > 3.5 && kind < 4.5 ? uHand : (kind > 2.5 && kind < 3.5 ? uWalk : uLens);
        vec2 uv = vec2(mix(R.x, R.z, vUv.x), mix(R.w, R.y, vUv.y));
        float mask = texture2D(uMap, uv).r;
        vec3 col; float on;
        if (kind < 0.5) { col = vec3(1.0, 0.06, 0.03); on = veh < 0.5 ? 1.0 : 0.0; }
        else if (kind < 1.5) { col = vec3(1.0, 0.5, 0.02); on = veh > 0.5 && veh < 1.5 ? 1.0 : 0.0; }
        else if (kind < 2.5) { col = vec3(0.15, 1.0, 0.62); on = veh > 1.5 ? 1.0 : 0.0; }
        else if (kind < 3.5) { col = vec3(0.92, 0.96, 1.0); on = walk > 1.5 ? 1.0 : 0.0; }
        else if (kind < 4.5) { col = vec3(1.0, 0.42, 0.05); on = walk < 0.5 ? 1.0 : (walk < 1.5 ? step(0.5, fract(uTime)) : 0.0); }
        else { col = vec3(1.0, 0.55, 0.05); on = step(0.5, fract(uTime * 0.75 + vSig.z)); }
        if (kind > 2.5 && kind < 4.5) { if (on < 0.5 || mask < 0.35) discard; gl_FragColor = vec4(col * 3.2, 1.0); return; }
        if (mask < 0.08) discard;
        gl_FragColor = vec4(col * mask * mix(0.07, 4.0, on), 1.0);
      }`,
  });
}

function poolTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,190,120,1)"); g.addColorStop(0.5, "rgba(255,170,90,0.45)"); g.addColorStop(1, "rgba(255,160,80,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------------ the view

export class StreetFurniture {
  readonly root = new THREE.Group();
  readonly layout: StreetLayout;
  /** resolves once the assets are loaded and the batches built */
  readonly ready: Promise<void>;
  private scale: number;
  private kinds: { kind: StreetKind; placed: Placed; near: Batch; far?: Batch; range: number }[] = [];
  private plateSets: { placed: Placed; mesh: THREE.InstancedMesh; range: number }[] = [];
  private lens?: { placed: Placed; mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial };
  private cars: { placed: Placed; near: Batch; far: Batch; farMats: Float32Array }[] = [];
  private pools?: { placed: Placed; mesh: THREE.InstancedMesh };
  private figures: { placed: Placed; batch: Batch }[] = [];
  private steamPuffs?: { placed: Placed; mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial };
  private courtViews: { courts: Court[]; players: Batch; balls: THREE.InstancedMesh; root: THREE.Group; playerCols: Float32Array }[] = [];
  private standParts: Part[] | null = null;
  private pendingCourts: Court[][] = [];

  /** more courts to put players on (the bridge district's plazas): their fences and surfaces are drawn elsewhere */
  addCourtPlayers(courts: Court[]) {
    if (!courts.length) return;
    if (!this.standParts) { this.pendingCourts.push(courts); return; }
    const root = new THREE.Group();
    root.name = "street:court-players";
    this.root.add(root);
    this.courtViews.push({ courts, root, ...this.playersFor(courts, root) });
  }

  private playersFor(courts: Court[], root: THREE.Group) {
    const np = courts.reduce((a, c) => a + c.players.length, 0);
    const players = new Batch(this.standParts!, np, this.opts.quality !== "low", false, true);
    const kit = [0xd8d8d2, 0x1d1d22, 0xb02a2a, 0x2a4a9a, 0xe0a020, 0x3a6a3a];
    const playerCols = new Float32Array(np * 3);
    const col = new THREE.Color();
    let k = 0;
    for (const c of courts) for (const p of c.players) col.set(kit[(p.seed * 7 + k++) % kit.length]).toArray(playerCols, (k - 1) * 3);
    for (const m of players.meshes) { m.name = "street:players"; root.add(m); }
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8551c, roughness: 0.7 }), np);
    balls.count = 0; balls.frustumCulled = false; balls.castShadow = this.opts.quality !== "low"; balls.name = "street:balls";
    root.add(balls);
    return { players, balls, playerCols };
  }
  private last = new THREE.Vector2(1e9, 1e9);
  private idx: number[] = [];

  constructor(readonly city: CityData, private opts: StreetFurnitureOptions = {}) {
    this.root.name = "street-furniture";
    this.scale = opts.quality === "low" ? 0.5 : opts.quality === "medium" ? 0.85 : 1;
    this.layout = opts.layout ?? streetLayout(city, { traffic: opts.traffic, life: opts.life, blockers: opts.blockers });
    this.ready = this.load().catch((e) => console.warn("street furniture didn't load", e));
  }

  private async load() {
    const base = this.opts.base ?? "./";
    const url = (f: string) => new URL(f, new URL(base, document.baseURI)).href;
    const tl = new THREE.TextureLoader();
    const tex = async (f: string, srgb = true) => {
      const t = await tl.loadAsync(url(f));
      t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8; t.needsUpdate = true;
      return t;
    };
    const [atlas, names, wire, meta, props, vehicles, park, court, chain, netTex] = await Promise.all([
      tex("textures/street/atlas.jpg"), tex("textures/street/names.jpg"), tex("textures/street/wire.png"),
      fetch(url("models/street.json")).then((r) => r.json()) as Promise<{ atlas: { size: [number, number]; rects: Record<string, [number, number, number, number]> }; names: { size: [number, number]; rects: Record<string, [number, number, number, number]> } }>,
      new GLTFLoader().loadAsync(url("models/street_props.glb")), new GLTFLoader().loadAsync(url("models/vehicles.glb")),
      loadParkAssets(base),
      tex("textures/street/court.jpg"), tex("textures/street/chainlink.png"), tex("textures/street/net.png"),
    ]);
    const rect = (r: [number, number, number, number]): Rect => ({ x: r[0], y: r[1], w: r[2], h: r[3] });
    const aRects = Object.fromEntries(Object.entries(meta.atlas.rects).map(([k, v]) => [k, rect(v)]));
    const nRects = Object.fromEntries(Object.entries(meta.names.rects).map(([k, v]) => [k, rect(v)]));

    const screen = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3 });
    const lampMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    lampMat.color.setRGB(2.1, 1.62, 1.1); // warm sodium-ish, enough to bloom a little
    const mats: Record<string, THREE.Material> = {
      street: new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.72, metalness: 0.2 }),
      wire: new THREE.MeshStandardMaterial({ map: wire, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.3 }),
      net: new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xa8bcc4, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }),
      lamp: lampMat, screen,
    };
    const lib = new Map<string, Part[]>();
    props.scene.updateMatrixWorld(true);
    for (const node of props.scene.children) {
      const list: Part[] = [];
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
        list.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat: mats[name] ?? mats.street });
      });
      lib.set(node.name, list);
    }
    lib.set("park:cart", [...park.parts("cart"), ...park.parts("cart_umbrella")]);
    lib.set("park:bench", park.parts("bench"));

    // ---- furniture, per kind
    const L = this.layout;
    const byKind = new Map<StreetKind, number[]>();
    L.items.forEach((it, i) => (byKind.get(it.k) ?? byKind.set(it.k, []).get(it.k)!).push(i));
    for (const [kind, list] of byKind) {
      const [nearName, farName] = MODELS[kind];
      const nearParts = lib.get(nearName);
      if (!nearParts) { console.warn("street model missing:", nearName); continue; }
      const placed = new Placed(list.length);
      list.forEach((ii, j) => { const it = L.items[ii]; placed.set(j, compose(it.x, it.y, it.z, it.rot, it.sx ?? 1, it.sy ?? 1, it.sz ?? 1), it.x, it.z); });
      const shadow = SHADOW.has(kind) && this.opts.quality !== "low";
      const near = new Batch(nearParts, list.length, shadow);
      const far = farName && lib.get(farName) ? new Batch(lib.get(farName)!, list.length, shadow) : undefined;
      for (const m of [...near.meshes, ...(far?.meshes ?? [])]) { m.name = "street:" + kind; this.root.add(m); }
      this.kinds.push({ kind, placed, near, far, range: (RANGE[kind] ?? SMALL_RANGE) * this.scale });
    }

    // ---- sign plates: names on their own texture, everything else on the atlas
    const plateGeo = (() => {
      const g = new THREE.BufferGeometry();
      // front quad (+Z) and back quad (-Z, u mirrored so text reads right from behind)
      const P = [-0.5, -0.5, 0.012, 0.5, -0.5, 0.012, 0.5, 0.5, 0.012, -0.5, 0.5, 0.012, 0.5, -0.5, -0.012, -0.5, -0.5, -0.012, -0.5, 0.5, -0.012, 0.5, 0.5, -0.012];
      const N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
      const UV = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
      g.setAttribute("aSide", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
      g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
      return g;
    })();
    const uvRect = (r: Rect | undefined, size: [number, number]) => r ? [r.x / size[0], (r.y + r.h) / size[1], (r.x + r.w) / size[0], r.y / size[1]] : [0, 0, 0, 0];
    for (const which of ["names", "atlas"] as const) {
      const list = L.plates.filter((p) => p.front.startsWith("name:") === (which === "names"));
      if (!list.length) continue;
      const size = which === "names" ? meta.names.size : meta.atlas.size;
      const cellOf = (c: string) => which === "names" ? (nRects[L.names[+c.slice(5)]] ?? undefined) : aRects[c];
      const blank = uvRect(aRects.blank_blade, meta.atlas.size);
      const placed = new Placed(list.length);
      placed.extra = new Float32Array(list.length * 8);
      list.forEach((p, i) => {
        placed.set(i, compose(p.x, p.y, p.z, p.rot, p.w, p.h, 1), p.x, p.z);
        const f = cellOf(p.front), b = cellOf(p.back);
        placed.extra!.set([...(f ? uvRect(f, size) : blank), ...(b ? uvRect(b, size) : blank)], i * 8);
      });
      const geo = plateGeo.clone();
      const aF = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const aB = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aFront", aF); geo.setAttribute("aBack", aB);
      const mesh = new THREE.InstancedMesh(geo, plateMaterial(which === "names" ? names : atlas), list.length);
      mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.name = "street:plates-" + which;
      this.root.add(mesh);
      this.plateSets.push({ placed, mesh, range: SMALL_RANGE * this.scale });
    }

    // ---- lenses
    {
      const list = L.lenses;
      const placed = new Placed(list.length);
      placed.extra = new Float32Array(list.length * 4);
      list.forEach((l, i) => { placed.set(i, compose(l.x, l.y, l.z, l.rot, l.size, l.size, 1), l.x, l.z); placed.extra!.set([l.kind, l.group, l.offset, 0], i * 4); });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.setAttribute("aSig", new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const mat = lensMaterial(atlas, aRects, meta.atlas.size);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      mesh.count = 0; mesh.frustumCulled = false; mesh.name = "street:lenses";
      this.root.add(mesh);
      this.lens = { placed, mesh, mat };
    }

    // ---- light pools on the ground (not at q=low)
    if (this.opts.quality !== "low" && L.pools.length) {
      const placed = new Placed(L.pools.length);
      L.pools.forEach((p, i) => placed.set(i, compose(p.x, 0.17, p.z, 0, p.r * 2, 1, p.r * 2), p.x, p.z));
      const mat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, L.pools.length);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = "street:pools";
      this.root.add(mesh);
      this.pools = { placed, mesh };
    }

    // ---- parked vehicles: the modelled ones near, painted boxes further out
    {
      vehicles.scene.updateMatrixWorld(true);
      const byKind = new Map<VehicleKind, number[]>();
      L.parked.forEach((p, i) => (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(i));
      // far: a two-box car (body, darker glasshouse), unit size, scaled per vehicle
      const tint = (g: THREE.BufferGeometry, v: number) => { const n = g.attributes.position.count; g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n * 3).fill(v), 3)); return g; };
      const boxGeo = mergeGeometries([tint(new THREE.BoxGeometry(1, 0.46, 1).translate(0, 0.39, 0).toNonIndexed(), 1), tint(new THREE.BoxGeometry(0.9, 0.38, 0.55).translate(0, 0.81, -0.04).toNonIndexed(), 0.18)])!;
      const boxMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35, vertexColors: true });
      const restMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4, vertexColors: true });
      const paintMat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.45 });
      /** just position + normal (+ a colour), non-indexed, so parts merge into one draw */
      const strip = (g: THREE.BufferGeometry, col?: THREE.Color) => {
        const o = new THREE.BufferGeometry();
        const ng = g.index ? g.toNonIndexed() : g;
        o.setAttribute("position", ng.getAttribute("position"));
        o.setAttribute("normal", ng.getAttribute("normal"));
        if (col) { const n = ng.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); o.setAttribute("color", new THREE.BufferAttribute(a, 3)); }
        return o;
      };
      for (const [kind, list] of byKind) {
        const obj = vehicles.scene.getObjectByName(kind === "car" ? "sedan" : kind);
        if (!obj) continue;
        const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
        const paintGeos: THREE.BufferGeometry[] = [], restGeos: THREE.BufferGeometry[] = [];
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const src = m.material as THREE.MeshStandardMaterial;
          const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().copy(m.matrixWorld).premultiply(inv));
          if (src.name === "paint") { paintGeos.push(strip(geo)); return; }
          // the rest keep their material's colour (lights off: parked); liveries become their base colour
          const col = src.color.clone();
          if (src.name === "glass") col.setRGB(0.05, 0.07, 0.09);
          if (src.name === "livery" || src.name === "sign") col.copy(new THREE.Color(paintFor(kind, 0))).multiplyScalar(0.9);
          restGeos.push(strip(geo, col));
        });
        const parts: (Part & { paint?: boolean })[] = [];
        if (paintGeos.length) parts.push({ geo: mergeGeometries(paintGeos)!, mat: paintMat, paint: true });
        if (restGeos.length) parts.push({ geo: mergeGeometries(restGeos)!, mat: restMat });
        const placed = new Placed(list.length);
        placed.cols = new Float32Array(list.length * 3);
        const farMats = new Float32Array(list.length * 16);
        const sz = VEHICLE_SIZE[kind], c = new THREE.Color();
        list.forEach((pi, j) => {
          const p = L.parked[pi];
          placed.set(j, compose(p.x, 0.02, p.z, p.rot), p.x, p.z);
          compose(p.x, 0.02, p.z, p.rot, sz.w, sz.h * 0.85, sz.l).toArray(farMats, j * 16);
          c.set(paintFor(kind, p.seed)).toArray(placed.cols!, j * 3);
        });
        const near = new Batch(parts, list.length, this.opts.quality === "high", true);
        const far = new Batch([{ geo: boxGeo, mat: boxMat, paint: true } as Part], list.length, false, true);
        for (const m of [...near.meshes, ...far.meshes]) { m.name = "street:parked-" + kind; this.root.add(m); }
        this.cars.push({ placed, near, far, farMats });
      }
    }
    this.buildFigures(park.parts("person_stand"), park.parts("person_sit"));
    this.buildSteam();
    this.standParts = park.parts("person_stand");
    this.buildCourts(court, chain, this.standParts);
    for (const c of this.pendingCourts.splice(0)) this.addCourtPlayers(c);
    this.last.set(1e9, 1e9);
  }

  /** hot dog vendors, their queues, court spectators: the park's plain figures, coats tinted per person */
  private buildFigures(stand: Part[], sit: Part[]) {
    const pal = [0x2f3b4c, 0x6b2d2a, 0x3b4a35, 0x7a6a55, 0x1d1d20, 0x8c7d6a, 0x4d3a5c, 0xb0432f, 0x5c6f82, 0x9a8c74, 0xc8a24a, 0x2a5a6a];
    const c = new THREE.Color();
    for (const pose of ["stand", "sit"] as const) {
      const list = this.layout.figures.filter((f) => f.pose === pose);
      if (!list.length) continue;
      const placed = new Placed(list.length);
      placed.cols = new Float32Array(list.length * 3);
      list.forEach((f, i) => {
        placed.set(i, compose(f.x, f.y, f.z, f.rot), f.x, f.z);
        c.set(pal[Math.abs(f.seed * 7919) % pal.length]).toArray(placed.cols!, i * 3);
      });
      const batch = new Batch(pose === "stand" ? stand : sit, list.length, this.opts.quality !== "low", false, true);
      for (const m of batch.meshes) { m.name = "street:figures-" + pose; this.root.add(m); }
      this.figures.push({ placed, batch });
    }
  }

  /** steam curling up from the hot dog carts' bun warmers: billboard puffs animated in the shader */
  private buildSteam() {
    const carts = this.layout.items.filter((i) => i.k === "hotdog_cart");
    if (!carts.length) return;
    const PER = 4;
    const placed = new Placed(carts.length * PER);
    placed.extra = new Float32Array(carts.length * PER * 4);
    carts.forEach((it, i) => {
      // the park cart's steam box sits at local x 0.45, its lid ~1.5 m up
      const x = it.x + Math.cos(it.rot) * 0.45, z = it.z - Math.sin(it.rot) * 0.45;
      for (let k = 0; k < PER; k++) {
        placed.set(i * PER + k, compose(x, it.y + 1.52, z, 0), x, z);
        placed.extra!.set([k / PER + (i % 7) * 0.13, 0.6 + (k % 2) * 0.3, (i * 3 + k) % 5, 0], (i * PER + k) * 4);
      }
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("aPuff", new THREE.InstancedBufferAttribute(new Float32Array(carts.length * PER * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; attribute vec4 aPuff; varying vec2 vUv; varying float vA;
        void main() {
          float t = fract(uTime * 0.38 + aPuff.x);
          vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          c.y += t * 1.6;
          c.x += sin(t * 5.0 + aPuff.z) * 0.18 * t;
          c.z += cos(t * 4.0 + aPuff.z) * 0.18 * t;
          float size = (0.25 + t * 0.9) * aPuff.y;
          vec4 mv = viewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * size;
          vUv = uv; vA = smoothstep(0.0, 0.15, t) * (1.0 - t) * 0.42;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying float vA;
        void main() { float d = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.3, 1.0, d)) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.94, 0.94, 0.96) * a, a); }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, carts.length * PER);
    mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = "street:cart-steam";
    this.root.add(mesh);
    this.steamPuffs = { placed, mesh, mat };
  }

  /** the courts: painted asphalt, chain-link fences with a top rail, and players with a ball each */
  private buildCourts(courtTex: THREE.Texture, chainTex: THREE.Texture, stand: Part[]) {
    const courts = this.layout.courts;
    if (!courts.length) return;
    const root = new THREE.Group();
    root.name = "street:courts";
    const surf: number[] = [], suv: number[] = [], fen: number[] = [], fuv: number[] = [], rails: THREE.BufferGeometry[] = [];
    const quad = (pos: number[], uv: number[], P: number[][], U: number[][]) => {
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); uv.push(...U[k]); }
    };
    for (const c of courts) {
      const ax = Math.cos(c.yaw), az = -Math.sin(c.yaw), bx = Math.sin(c.yaw), bz = Math.cos(c.yaw);
      const W = (u: number, v: number, y: number) => [c.x + ax * u + bx * v, y, c.z + az * u + bz * v];
      // the court texture covers 30 x 16 m centred on a full court; a half court uses its left end
      const u1 = c.half ? (2 * c.hw) / 30 : 1;
      quad(surf, suv, [W(-c.hw, c.hd, 0.135), W(c.hw, c.hd, 0.135), W(c.hw, -c.hd, 0.135), W(-c.hw, -c.hd, 0.135)], [[0, 1], [u1, 1], [u1, 0], [0, 0]]);
      // fence: chain-link sides (the texture repeats every 2 m), a top rail and a mid rail
      const sides: [number, number, number, number][] = [[-c.hw, -c.hd, c.hw, -c.hd], [c.hw, -c.hd, c.hw, c.hd], [c.hw, c.hd, -c.hw, c.hd], [-c.hw, c.hd, -c.hw, -c.hd]];
      for (const [u0, v0, u2, v2] of sides) {
        const len = Math.hypot(u2 - u0, v2 - v0), y0 = 0.15, y1 = 0.12 + c.fence;
        quad(fen, fuv, [W(u0, v0, y0), W(u2, v2, y0), W(u2, v2, y1), W(u0, v0, y1)], [[0, 0], [len / 2, 0], [len / 2, (y1 - y0) / 2], [0, (y1 - y0) / 2]]);
        for (const ry of [y1, 1.4]) {
          const [mx, , mz] = W((u0 + u2) / 2, (v0 + v2) / 2, 0);
          const g = new THREE.CylinderGeometry(0.03, 0.03, len, 6).rotateZ(Math.PI / 2);
          g.rotateY(c.yaw + (Math.abs(u2 - u0) > 0.1 ? 0 : Math.PI / 2));
          g.translate(mx, ry, mz);
          rails.push(g.toNonIndexed());
        }
      }
    }
    const mk = (pos: number[], uv: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    };
    const surface = new THREE.Mesh(mk(surf, suv), new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    surface.receiveShadow = true;
    chainTex.wrapS = chainTex.wrapT = THREE.RepeatWrapping;
    const fence = new THREE.Mesh(mk(fen, fuv), new THREE.MeshStandardMaterial({ map: chainTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5 }));
    fence.castShadow = this.opts.quality !== "low";
    const rail = new THREE.Mesh(mergeGeometries(rails)!, new THREE.MeshStandardMaterial({ color: 0x8a8e90, roughness: 0.5, metalness: 0.6 }));
    rail.castShadow = this.opts.quality !== "low";
    root.add(surface, fence, rail);
    // players (jerseys and hoodies) and their balls, moved every frame while a court is near
    void stand;
    this.root.add(root);
    this.courtViews.push({ courts, root, ...this.playersFor(courts, root) });
  }

  /** the games: shooters shoot (jump, arc, swish, bounce back), the others dribble about */
  private animateCourts(focus: THREE.Vector3, t: number) {
    for (const cv of this.courtViews) this.animateCourtView(cv, focus, t);
  }

  private animateCourtView(cv: StreetFurniture["courtViews"][number], focus: THREE.Vector3, t: number) {
    const near = cv.courts.some((c) => Math.hypot(c.x - focus.x, c.z - focus.z) < 380);
    // (the district's courts have only their players in this group: the fences stay drawn)
    for (const o of cv.root.children) if (o.name === "street:players" || o.name === "street:balls") o.visible = near;
    if (cv.root.name !== "street:courts") cv.root.visible = true;
    else cv.root.visible = near;
    if (!near) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const mats = new Float32Array(16);
    let i = 0, nb = 0;
    const fy = 0.12;
    for (const c of cv.courts) {
      for (const pl of c.players) {
        const hp = c.hoops[pl.hoop];
        const rimX = hp.x + Math.sin(hp.rot) * 0.29, rimZ = hp.z + Math.cos(hp.rot) * 0.29, rimY = fy + 3.05;
        const ph = (pl.seed * 0.37) % 1;
        let x = pl.x, z = pl.z, y = fy, face = Math.atan2(rimX - x, rimZ - z);
        let bx: number, by: number, bz: number;
        if (pl.mode === "dribble") {
          const a = t * 0.9 + ph * 6.28, r = 1.4;
          x = pl.x + Math.cos(a) * r; z = pl.z + Math.sin(a) * r * 0.6;
          face = Math.atan2(-Math.sin(a), Math.cos(a) * 0.6);
          const fx = Math.sin(face), fz = Math.cos(face);
          bx = x + fx * 0.35 + fz * 0.3; bz = z + fz * 0.35 - fx * 0.3;
          by = fy + 0.12 + Math.abs(Math.sin((t + ph) * Math.PI * 1.9)) * 0.75;
        } else {
          const T = 3.4, u = (((t / T + ph) % 1) + 1) % 1 * T;
          const fx = Math.sin(face), fz = Math.cos(face);
          const hx = x + fx * 0.3, hz = z + fz * 0.3;
          if (u < 0.7) { bx = hx; bz = hz; by = fy + 1.25; }
          else if (u < 1.0) { const k = (u - 0.7) / 0.3; y = fy + Math.sin(k * Math.PI) * 0.45; bx = hx; bz = hz; by = y + 1.3 + k * 0.9; }
          else if (u < 2.0) {
            const k = u - 1.0, sx = hx, sz = hz, sy = fy + 2.5;
            bx = sx + (rimX - sx) * k; bz = sz + (rimZ - sz) * k; by = sy + (rimY + 0.1 - sy) * k + Math.sin(k * Math.PI) * 1.6;
          } else {
            // through the net, then bouncing back out to the shooter
            const k = (u - 2.0) / (T - 2.0);
            bx = rimX + (hx - rimX) * k; bz = rimZ + (hz - rimZ) * k;
            const drop = Math.max(0, rimY - k * 12);
            by = Math.max(fy + 0.12 + Math.abs(Math.sin(k * Math.PI * 3)) * 0.9 * (1 - k), drop);
          }
        }
        q.setFromAxisAngle(Y, face);
        m.compose(p.set(x, y, z), q, s).toArray(mats);
        cv.players.push(mats, 0, cv.playerCols.subarray(i * 3, i * 3 + 3));
        cv.balls.setMatrixAt(nb++, m.compose(p.set(bx, by, bz), q.identity(), s));
        i++;
      }
    }
    cv.players.end();
    cv.balls.count = nb;
    cv.balls.instanceMatrix.needsUpdate = true;
  }

  /** cam: the camera (hides it all underground); focus: what to fill around; t: seconds (signal clock) */
  update(cam: THREE.Vector3, focus: THREE.Vector3, t: number) {
    this.root.visible = cam.y > -0.6;
    if (this.lens) this.lens.mat.uniforms.uTime.value = t;
    if (this.steamPuffs) this.steamPuffs.mat.uniforms.uTime.value = t;
    if (!this.root.visible) return;
    this.animateCourts(focus, t);
    if (Math.hypot(focus.x - this.last.x, focus.z - this.last.y) < 7) return;
    this.last.set(focus.x, focus.z);
    const fx = focus.x, fz = focus.z;
    const idx = this.idx;
    const each = (pl: Placed, range: number, fn: (i: number, d2: number) => void) => {
      pl.grid.around(fx, fz, range, idx);
      const r2 = range * range;
      for (const i of idx) {
        const dx = pl.pos[i * 2] - fx, dz = pl.pos[i * 2 + 1] - fz, d2 = dx * dx + dz * dz;
        if (d2 < r2) fn(i, d2);
      }
    };
    const lod2 = (LOD_DIST * this.scale) ** 2;
    for (const k of this.kinds) {
      each(k.placed, k.range, (i, d2) => (k.far && d2 > lod2 ? k.far : k.near).push(k.placed.mats, i));
      k.near.end(); k.far?.end();
    }
    for (const ps of this.plateSets) {
      const aF = ps.mesh.geometry.getAttribute("aFront") as THREE.InstancedBufferAttribute;
      const aB = ps.mesh.geometry.getAttribute("aBack") as THREE.InstancedBufferAttribute;
      let n = 0;
      each(ps.placed, ps.range, (i) => {
        copy(ps.placed.mats, i * 16, ps.mesh.instanceMatrix.array as Float32Array, n * 16, 16);
        copy(ps.placed.extra!, i * 8, aF.array as Float32Array, n * 4, 4);
        copy(ps.placed.extra!, i * 8 + 4, aB.array as Float32Array, n * 4, 4);
        n++;
      });
      ps.mesh.count = n; upload(ps.mesh.instanceMatrix, n * 16); upload(aF, n * 4); upload(aB, n * 4);
    }
    if (this.lens) {
      const { placed, mesh } = this.lens;
      const a = mesh.geometry.getAttribute("aSig") as THREE.InstancedBufferAttribute;
      let n = 0;
      each(placed, 320 * this.scale, (i) => {
        copy(placed.mats, i * 16, mesh.instanceMatrix.array as Float32Array, n * 16, 16);
        copy(placed.extra!, i * 4, a.array as Float32Array, n * 4, 4);
        n++;
      });
      mesh.count = n; upload(mesh.instanceMatrix, n * 16); upload(a, n * 4);
    }
    if (this.pools) {
      const { placed, mesh } = this.pools;
      let n = 0;
      each(placed, 260, (i) => { copy(placed.mats, i * 16, mesh.instanceMatrix.array as Float32Array, n * 16, 16); n++; });
      mesh.count = n; upload(mesh.instanceMatrix, n * 16);
    }
    for (const f of this.figures) { each(f.placed, 200 * this.scale, (i) => f.batch.push(f.placed.mats, i, f.placed.cols)); f.batch.end(); }
    if (this.steamPuffs) {
      const { placed, mesh } = this.steamPuffs;
      const a = mesh.geometry.getAttribute("aPuff") as THREE.InstancedBufferAttribute;
      let n = 0;
      each(placed, 150 * this.scale, (i) => {
        copy(placed.mats, i * 16, mesh.instanceMatrix.array as Float32Array, n * 16, 16);
        copy(placed.extra!, i * 4, a.array as Float32Array, n * 4, 4);
        n++;
      });
      mesh.count = n; upload(mesh.instanceMatrix, n * 16); upload(a, n * 4);
    }
    const carNear = (75 * this.scale) ** 2;
    for (const c of this.cars) {
      each(c.placed, 280 * this.scale, (i, d2) => d2 < carNear ? c.near.push(c.placed.mats, i, c.placed.cols) : c.far.push(c.farMats, i, c.placed.cols));
      c.near.end(); c.far.end();
    }
  }
}
