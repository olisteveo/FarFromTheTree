// The city to the horizon: every building outside the detailed set (public/far.dat: the rest of
// Manhattan, the Brooklyn / Queens / Bronx waterfronts, Jersey City and Hoboken), far versions of
// the corridor's own buildings beyond the detail distance, the land across the rivers, the
// harbour out to the horizon, the landmark spires and the East River and Hudson bridges.
//
// One cheap shader for every far building: flat normals from screen derivatives (so footprints
// share vertices), window grids from a perimeter coordinate and the height, lit windows in the
// November afternoon, tar roofs and the odd water tower, all hazed by the stage's height fog.
// Merged per 1.6 km tile, frustum culled, with a per-tile level of detail (buildings are sorted
// by importance inside each tile so a shorter draw range keeps just the big ones).
//
// The contract with render/buildings.ts: the detailed buildings draw within `detailDistance`
// (buildings.setDrawDistance). The far versions of corridor buildings ("gated") are hidden
// within detailDistance - GATE_MARGIN (per building, by centroid), and are pushed back in depth
// (polygon offset) so wherever both exist the detailed building wins without z-fighting.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData, Style } from "../world/data";
import type { FarIn, FarOut, FarTile } from "./farCity.worker";
import { projLL } from "./farData";
import { isModelled, DISTRICT_ZONE } from "../world/modelled";

const GATE_MARGIN = 30; // buildings.ts shows a chunk when any of it is within the draw distance of the focus (the leaf, a few metres from the camera)
const STYLE_TYPE: Record<Style, number> = { tenement: 0, brick: 0, castiron: 1, prewar: 1, civic: 1, deco: 2, modern: 3, glass: 4 };

const VERT = /* glsl */ `
  attribute float aU;
  attribute vec4 aInfo;
  #ifdef GATED
  attribute vec2 aCenter;
  uniform float uGate;
  #endif
  varying vec3 vWorld;
  varying float vU;
  flat varying vec4 vInfo;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    #ifdef GATED
    if (distance(aCenter, cameraPosition.xz) < uGate) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    #endif
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vU = aU;
    vInfo = aInfo;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uSunDir, uSunCol, uHemiSky, uHemiGround, uEnv;
  uniform float uLit;
  varying vec3 vWorld;
  varying float vU;
  flat varying vec4 vInfo;
  #include <common>
  #include <fog_pars_fragment>
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  // anti-aliased box: 1 inside [0.5-w/2, 0.5+w/2] of a unit cell, filtered by the cell's footprint
  float pulse(float x, float w, float fw) {
    float a = 0.5 - w * 0.5, b = 0.5 + w * 0.5;
    float e = max(fw, 1e-4);
    return clamp((min(x + e * 0.5, b) - max(x - e * 0.5, a)) / e, 0.0, 1.0);
  }
  void main() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 V = normalize(cameraPosition - vWorld);
    if (dot(n, V) < 0.0) n = -n;
    int type = int(vInfo.x + 0.5);
    float seed = vInfo.y;
    float flags = vInfo.z;
    float H = vInfo.w * 2.0;
    float r = h21(vec2(seed, seed * 0.37 + 3.1));
    float r2 = h21(vec2(seed * 1.7, 9.2));
    // albedo (linear) by type
    vec3 alb;
    if (type == 0) alb = mix(vec3(0.19, 0.075, 0.05), vec3(0.30, 0.16, 0.10), r);
    else if (type == 1) alb = r < 0.55 ? mix(vec3(0.34, 0.28, 0.20), vec3(0.42, 0.38, 0.31), r2) : mix(vec3(0.22, 0.11, 0.07), vec3(0.30, 0.20, 0.13), r2);
    else if (type == 2) alb = mix(vec3(0.38, 0.34, 0.27), vec3(0.48, 0.45, 0.39), r);
    else if (type == 3) alb = mix(vec3(0.26, 0.26, 0.26), vec3(0.42, 0.40, 0.37), r);
    else if (type == 4) alb = mix(vec3(0.05, 0.07, 0.09), vec3(0.10, 0.12, 0.13), r);
    else if (type == 5) alb = mix(vec3(0.20, 0.12, 0.08), vec3(0.32, 0.29, 0.25), r);
    else if (type == 6) alb = flags > 1.5 ? vec3(0.03) : vec3(0.13, 0.075, 0.04);
    else alb = vec3(0.42, 0.44, 0.47);
    vec3 emit = vec3(0.0);
    float glass = 0.0;
    bool roof = n.y > 0.6;
    if (roof) {
      // tar, gravel, the odd pale membrane
      alb = type == 6 ? vec3(0.08, 0.05, 0.03) : r2 < 0.75 ? mix(vec3(0.035, 0.035, 0.04), vec3(0.09, 0.085, 0.08), r2 / 0.75) : vec3(0.22, 0.22, 0.21);
    } else if (type <= 5) {
      #ifdef LOW
      // integrated GPUs: the grid's average only, no per-window work
      float m = type == 4 ? 0.7 : type == 3 ? 0.4 : 0.27;
      float street = 1.0 - step(4.6, vWorld.y);
      glass = mix(m, 0.7, street) * (1.0 - step(H - 0.8, vWorld.y));
      emit = vec3(1.0, 0.72, 0.45) * (uLit * m * 0.9 + street * 0.12);
      #else
      // the window grid: bays along the perimeter, floors up the height
      float fh = type == 4 ? 3.9 : type == 0 || type == 5 ? 3.1 : 3.6;
      float bw = type == 4 ? 1.6 : type == 3 ? 2.1 : 2.6;
      vec2 g = vec2(vU / bw, vWorld.y / fh);
      vec2 fw = fwidth(g);
      vec2 f = fract(g);
      vec2 cell = floor(g);
      float wx = type == 4 ? 0.88 : type == 3 ? 0.8 : 0.48;
      float wy = type == 4 ? 0.78 : type == 3 ? 0.5 : 0.56;
      float m = pulse(f.x, wx, fw.x) * pulse(f.y, wy, fw.y);
      float far = smoothstep(0.35, 0.8, max(fw.x, fw.y));
      m = mix(m, wx * wy, far);
      float y = vWorld.y;
      // shopfronts at street level, a cornice at the top of the old ones, a plain band at the crown
      float street = 1.0 - step(4.6, y);
      if (type <= 2) { float c = smoothstep(H - 1.6, H - 1.1, y) * (1.0 - smoothstep(H - 0.5, H - 0.2, y)); alb *= 1.0 - 0.35 * c; m *= 1.0 - step(H - 1.8, y); }
      m *= 1.0 - step(H - 0.8, y);
      m = mix(m, 0.7, street);
      glass = m;
      // lit windows: a few offices and flats already lit in the late afternoon, more higher up the towers
      float lit = step(h21(cell + vec2(seed * 7.13, seed * 1.31)), uLit * (type >= 3 ? 1.3 : 0.7));
      vec3 warm = mix(vec3(1.0, 0.70, 0.40), vec3(0.85, 0.9, 1.0), step(0.8, h21(cell.yx + seed)));
      emit = warm * mix(lit * m, uLit * wx * wy * 0.9, far) * 0.9;
      emit += vec3(1.0, 0.75, 0.45) * street * 0.25 * step(0.5, h21(vec2(cell.x, seed)));
      #endif
    }
    // light: the low sun, the cold sky, the city's bounce
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) + uEnv;
    // canyons: darker toward the street (the light that reaches down between the blocks is mostly sky)
    float ao = roof ? 1.0 : mix(0.55, 1.0, smoothstep(0.0, 30.0, vWorld.y));
    vec3 col = alb * (uSunCol * ndl * 1.35 * smoothstep(-2.0, 18.0, vWorld.y) + amb * 0.6 * ao) * RECIPROCAL_PI;
    // glass reflects the pale sky
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    vec3 refl = uEnv * mix(0.05, 0.45, fres) + uSunCol * pow(max(dot(reflect(-V, n), uSunDir), 0.0), 60.0) * 0.08;
    vec3 glassCol = vec3(0.008, 0.011, 0.015) + refl * (type == 4 ? 1.0 : 0.5);
    col = mix(col, glassCol, glass * (1.0 - step(0.5, length(emit))));
    col += emit;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export interface FarCityOptions {
  quality: "low" | "medium" | "high";
  /** the harbour material from ground.ts, so the water out to the horizon matches */
  waterMaterial?: THREE.Material;
  url?: string;
  /** build on the main thread instead of a worker (tests) */
  inline?: boolean;
  /** rectangles to keep clear of far buildings (the basketball courts) */
  clear?: { x: number; z: number; hw: number; hd: number; yaw: number }[];
}

interface TileMesh { mesh: THREE.Mesh; lod: number[]; box: number[] }

export class FarCity {
  readonly root = new THREE.Group();
  /** detailed buildings draw within this distance (keep in step with buildings.setDrawDistance) */
  detailDistance = 900;
  ready = false;
  stats = { buildings: 0, tiles: 0, verts: 0, tris: 0, ms: 0 };
  private tiles: TileMesh[] = [];
  private uniforms: Record<string, THREE.IUniform>;
  private matOpen: THREE.ShaderMaterial;
  private matGated: THREE.ShaderMaterial;
  private low: boolean;
  private landMesh: THREE.Mesh | null = null;
  private bridgeMesh: THREE.Mesh | null = null;
  /** the Manhattan Bridge's box version, apart so the modelled one (render/chinatown.ts) can replace it */
  private manhattanMesh: THREE.Mesh | null = null;

  constructor(private city: CityData, private sun: THREE.DirectionalLight, private hemi: THREE.HemisphereLight, private opts: FarCityOptions) {
    this.low = opts.quality === "low";
    this.root.name = "farCity";
    this.uniforms = {
      ...THREE.UniformsLib.fog,
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() },
      uHemiSky: { value: new THREE.Color() },
      uHemiGround: { value: new THREE.Color() },
      uEnv: { value: new THREE.Color(0.85, 0.9, 1.0) },
      uLit: { value: 0.11 },
      uGate: { value: this.detailDistance - GATE_MARGIN },
    };
    const make = (gated: boolean) => {
      const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, defines: { ...(gated ? { GATED: 1 } : {}), ...(this.low ? { LOW: 1 } : {}) } });
      if (gated) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 12; }
      return m;
    };
    this.matOpen = make(false);
    this.matGated = make(true);
    this.root.add(this.harbour(), this.bridges());
  }

  /** Fetch far.dat and build the tiles in a worker (the game runs meanwhile). */
  async load() {
    const t0 = performance.now();
    const res = await fetch(this.opts.url ?? "./far.dat");
    if (!res.ok) throw new Error(`far.dat: ${res.status}`);
    const buf = await res.arrayBuffer();
    const corridor = this.corridorSet();
    // (the bridge district east of the Bowery is drawn by render/chinatownDistrict.ts: its far buildings stay out)
    const msg: FarIn = { buf, corridor, low: this.low, clear: this.opts.clear, dropZone: DISTRICT_ZONE };
    const inline = async () => (await import("./farCity.worker")).runFar(msg);
    // ?farinline=1: build on the main thread (headless screenshots run on virtual time, which workers don't follow)
    const forceInline = typeof location !== "undefined" && new URLSearchParams(location.search).get("farinline") === "1";
    const out = this.opts.inline || forceInline ? await inline() : await new Promise<FarOut>((resolve, reject) => {
      let w: Worker;
      try { w = new Worker(new URL("./farCity.worker.ts", import.meta.url), { type: "module" }); } catch { inline().then(resolve, reject); return; }
      w.onmessage = (e) => { w.terminate(); if ((e.data as { error?: string }).error) reject(new Error(e.data.error)); else resolve(e.data as FarOut); };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
      w.postMessage(msg); // no transfer: the inline fallback could still need the buffers
    });
    for (const t of out.tiles) this.addTile(t);
    this.root.add(this.land(out.landV, out.landI));
    this.stats.ms = Math.round(performance.now() - t0);
    this.stats.tiles = this.tiles.length;
    this.ready = true;
  }

  /** The corridor's detailed buildings and the skyline towers (city.json), for their far versions. */
  private corridorSet(): FarIn["corridor"] {
    const raw = this.city.raw;
    const list: { p: number[]; h: number; t: number; k: number }[] = [];
    for (const b of this.city.buildings) if (b.id < raw.buildings.length && !isModelled(b.cx, b.cz)) list.push({ p: b.poly[0], h: b.h, t: STYLE_TYPE[b.style] ?? 1, k: b.seed });
    raw.skyline.forEach((s, i) => list.push({ p: s.p[0], h: s.h, t: s.y >= 1985 ? 4 : s.y >= 1950 ? 3 : s.h > 120 ? 2 : 1, k: i * 7919 + 13 }));
    let nv = 0;
    for (const b of list) nv += b.p.length / 2;
    const verts = new Float32Array(nv * 2), start = new Uint32Array(list.length), count = new Uint16Array(list.length);
    const h = new Float32Array(list.length), type = new Uint8Array(list.length), seed = new Uint16Array(list.length);
    let o = 0;
    list.forEach((b, i) => {
      start[i] = o / 2; count[i] = b.p.length / 2; h[i] = b.h; type[i] = b.t; seed[i] = b.k & 0xffff;
      verts.set(b.p, o); o += b.p.length;
    });
    this.stats.buildings = list.length;
    return { verts, start, count, h, type, seed };
  }

  private addTile(t: FarTile) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute("aU", new THREE.BufferAttribute(t.u, 1));
    g.setAttribute("aInfo", new THREE.BufferAttribute(t.info, 4));
    if (t.center) g.setAttribute("aCenter", new THREE.BufferAttribute(t.center, 2));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    g.computeBoundingSphere();
    g.boundingBox = new THREE.Box3(new THREE.Vector3(t.box[0], -2, t.box[1]), new THREE.Vector3(t.box[2], t.box[4], t.box[3]));
    const mesh = new THREE.Mesh(g, t.gated ? this.matGated : this.matOpen);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.name = t.gated ? "farTileGated" : "farTile";
    // scenery only: never raycast, and the CPU copies go once they're on the GPU (tens of MB)
    mesh.raycast = () => {};
    const drop = function (this: THREE.BufferAttribute) { (this as unknown as { array: unknown }).array = null; };
    for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(drop);
    g.index!.onUpload(drop);
    this.root.add(mesh);
    this.tiles.push({ mesh, lod: t.lod, box: t.box });
    this.stats.verts += t.pos.length / 3;
    this.stats.tris += t.index.length / 3;
  }

  /** Brooklyn, Queens, the Bronx, Staten Island and New Jersey: flat land under their buildings. */
  private land(v: Float32Array, idx: Uint32Array) {
    const pos = new Float32Array((v.length / 2) * 3);
    for (let i = 0; i < v.length / 2; i++) { pos[i * 3] = v[i * 2]; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = v[i * 2 + 1]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    // make every triangle face up
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ny = (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[a * 3]) - (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[a * 3 + 2]);
      if (ny < 0) { idx[i + 1] = c; idx[i + 2] = b; }
    }
    const n = new Float32Array(pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    // pulled toward the camera a touch: the harbour is only 1.6 m below and depth precision is poor kilometres out
    const m = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(g, m);
    this.landMesh = mesh;
    mesh.name = "farLand";
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** The harbour beyond ground.ts's 14 km water plane, out past the horizon. */
  private harbour() {
    // ground.ts: a 14000 m plane centred on (0, 3000); this is a frame around it, UVs continuing its tiling
    const R = 40000, X0 = -7000, X1 = 7000, Z0 = -4000, Z1 = 10000;
    const quads: number[][] = [
      [-R, -R, R, Z0], [-R, Z1, R, R], [-R, Z0, X0, Z1], [X1, Z0, R, Z1],
    ];
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const [a, b, c, d] of quads) {
      const base = pos.length / 3;
      for (const [x, z] of [[a, b], [c, b], [c, d], [a, d]]) { pos.push(x, -1.6, z); uv.push(x / 14000 + 0.5, (3000 - z) / 14000 + 0.5); }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = this.opts.waterMaterial ?? new THREE.MeshStandardMaterial({ color: 0x2a3b44, roughness: 0.08, metalness: 0.2 });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = "farHarbour";
    mesh.matrixAutoUpdate = false;
    // the far city updates itself as the harbour is drawn (first, every frame): main.ts only creates it
    mesh.frustumCulled = false;
    mesh.renderOrder = -0.5;
    mesh.onBeforeRender = (_r, _s, camera) => this.update(camera);
    return mesh;
  }

  /** Brooklyn, Manhattan, Williamsburg, Queensboro and the George Washington bridges. */
  private bridges() {
    const parts: THREE.BufferGeometry[] = [];
    const color = (g: THREE.BufferGeometry, c: number) => {
      const col = new THREE.Color(c);
      const n = g.getAttribute("position").count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
      return g;
    };
    const add = (g: THREE.BufferGeometry, c: number) => parts.push(color(g.index ? g.toNonIndexed() : g, c));
    /** a box between two points (x,y,z), of the given width (sideways) and thickness */
    const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, c: number) => {
      const L = a.distanceTo(b);
      const g = new THREE.BoxGeometry(w, t, L);
      const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0));
      g.applyMatrix4(m);
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      add(g, c);
    };
    const cable = (pts: THREE.Vector3[], r: number, c: number) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      add(new THREE.TubeGeometry(curve, pts.length * 3, r, 3, false), c);
    };
    interface Spec { mid: [number, number]; dir: [number, number]; span: number; side: number; approach: number; deck: number; tower: number; width: number; stone?: boolean; c: number; cantilever?: boolean }
    const specs: Spec[] = [
      { mid: [40.70595, -73.99686], dir: [40.6996 - 40.7127, -73.9900 + 74.0043], span: 486, side: 283, approach: 330, deck: 40, tower: 84, width: 26, stone: true, c: 0x8a7f6e },
      { mid: [40.70750, -73.99060], dir: [40.7000 - 40.7148, -73.9850 + 73.9958], span: 448, side: 222, approach: 380, deck: 41, tower: 102, width: 37, c: 0x6f7a80 },
      { mid: [40.71335, -73.97230], dir: [40.7106 - 40.7164, -73.9634 + 73.9812], span: 488, side: 182, approach: 420, deck: 41, tower: 101, width: 36, c: 0x6a6e70 },
      { mid: [40.75700, -73.95480], dir: [40.7518 - 40.7600, -73.9437 + 73.9625], span: 360, side: 300, approach: 350, deck: 41, tower: 95, width: 27, c: 0x5f6a6a, cantilever: true },
      { mid: [40.85170, -73.95270], dir: [40.8540 - 40.8495, -73.9617 + 73.9440], span: 1067, side: 186, approach: 300, deck: 65, tower: 184, width: 36, c: 0x7a8288 },
    ];
    let manhattan: THREE.BufferGeometry[] = [], i0 = 0;
    for (const s of specs) {
      if (s === specs[1]) i0 = parts.length;
      else if (s === specs[2]) manhattan = parts.splice(i0);
      const [mx, mz] = projLL(s.mid[0], s.mid[1]);
      const p2 = projLL(s.mid[0] + s.dir[0], s.mid[1] + s.dir[1]);
      const ux = p2[0] - mx, uz = p2[1] - mz, L = Math.hypot(ux, uz);
      const u = new THREE.Vector3(ux / L, 0, uz / L), side = new THREE.Vector3(-u.z, 0, u.x);
      const at = (t: number, y: number, o = 0) => new THREE.Vector3(mx + u.x * t + side.x * o, y, mz + u.z * t + side.z * o);
      const half = s.span / 2, anch = half + s.side, end = anch + s.approach;
      // deck with its approaches down to the street
      const deckC = 0x3c3f3d;
      beam(at(-anch, s.deck - 3), at(anch, s.deck - 3), s.width, 5, deckC);
      beam(at(-end, -1), at(-anch, s.deck - 3), s.width * 0.8, 4, deckC);
      beam(at(anch, s.deck - 3), at(end, -1), s.width * 0.8, 4, deckC);
      for (const sgn of [-1, 1]) {
        const tx = sgn * half;
        if (s.stone) {
          // granite towers with two pointed arches: legs, the solid top, a plinth
          for (const o of [-1, 1]) add(new THREE.BoxGeometry(11, s.tower * 0.72, 18).translate(0, s.tower * 0.36, 0).applyMatrix4(new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), u)).translate(at(tx, 0, o * 11).x, -1.6, at(tx, 0, o * 11).z), 0x9a8f7c);
          add(new THREE.BoxGeometry(41, s.tower * 0.3, 18).translate(0, s.tower * 0.85, 0).applyMatrix4(new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), u)).translate(at(tx, 0).x, -1.6, at(tx, 0).z), 0x9a8f7c);
          add(new THREE.BoxGeometry(41, 4, 18).translate(0, s.tower * 0.72 - 6, 0).applyMatrix4(new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), u)).translate(at(tx, 0).x, -1.6, at(tx, 0).z), 0x9a8f7c);
          // the anchorages
          add(new THREE.BoxGeometry(45, s.deck + 2, 40).applyMatrix4(new THREE.Matrix4().makeBasis(side, new THREE.Vector3(0, 1, 0), u)).translate(at(sgn * anch, 0).x, (s.deck + 2) / 2 - 2, at(sgn * anch, 0).z), 0x8a7f6e);
        } else {
          // steel towers: two legs and cross bracing
          for (const o of [-1, 1]) beam(at(tx, -1.6, o * s.width * 0.45), at(tx, s.tower, o * s.width * 0.42), 5, 5, s.c);
          for (let k = 1; k <= 3; k++) beam(at(tx, (s.tower * k) / 3.2, -s.width * 0.45), at(tx, (s.tower * k) / 3.2, s.width * 0.45), 3, 4, s.c);
        }
      }
      if (s.cantilever) {
        // Queensboro: truss humps over each pier instead of cables
        for (const t of [-half - s.side * 0.4, -half * 0.25, half * 0.25, half + s.side * 0.4]) {
          beam(at(t - 140, s.deck), at(t, s.tower), 3, 6, s.c); beam(at(t, s.tower), at(t + 140, s.deck), 3, 6, s.c);
          for (const o of [-1, 1]) beam(at(t, -1.6, o * 10), at(t, s.tower, o * 10), 6, 6, s.c);
        }
        continue;
      }
      // the main cables: sagging over the main span, down to the anchorages over the side spans
      for (const o of [-1, 1]) {
        const off = o * s.width * 0.44;
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 16; k++) {
          const t = -half + (k / 16) * s.span;
          const q = t / half;
          pts.push(at(t, s.deck + 2 + (s.tower - s.deck - 2) * q * q, off));
        }
        cable(pts, 0.9, 0x404448);
        for (const sgn of [-1, 1]) cable([at(sgn * half, s.tower, off), at(sgn * (half + s.side * 0.5), s.deck + (s.tower - s.deck) * 0.3, off), at(sgn * anch, s.deck + 1, off)], 0.9, 0x404448);
        // a few suspenders, so the cable curtain reads
        for (let k = 1; k < 16; k += 1) {
          const t = -half + (k / 16) * s.span, q = t / half;
          beam(at(t, s.deck - 1, off), at(t, s.deck + 2 + (s.tower - s.deck - 2) * q * q, off), 0.25, 0.25, 0x505458);
        }
      }
    }
    const merged = (list: THREE.BufferGeometry[]) => {
      const g = mergeGeometries(list.map((p) => { p.deleteAttribute("uv"); return p; }))!;
      g.computeVertexNormals();
      return g;
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
    const mesh = new THREE.Mesh(merged(parts), mat);
    mesh.name = "farBridges";
    this.bridgeMesh = mesh;
    // (the loop above parked the Manhattan Bridge's parts in `manhattan`)
    this.manhattanMesh = new THREE.Mesh(merged(manhattan), mat);
    this.manhattanMesh.name = "farBridgeManhattan";
    mesh.add(this.manhattanMesh);
    return mesh;
  }

  /** The modelled Manhattan Bridge is in (render/chinatown.ts): drop the box one. */
  hideManhattanBridge() {
    if (!this.manhattanMesh) return;
    this.manhattanMesh.removeFromParent();
    this.manhattanMesh.geometry.dispose();
    this.manhattanMesh = null;
  }

  setDetailDistance(m: number) {
    this.detailDistance = m;
    this.uniforms.uGate.value = m - GATE_MARGIN;
  }

  /** Per frame: lights into the shader, a level of detail per tile. No allocation. */
  update(cam: THREE.Camera) {
    const u = this.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(this.sun.position).sub(this.sun.target.position).normalize();
    (u.uSunCol.value as THREE.Color).copy(this.sun.color).multiplyScalar(this.sun.intensity);
    (u.uHemiSky.value as THREE.Color).copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 1.6);
    (u.uHemiGround.value as THREE.Color).copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity * 1.6);
    // underground the tunnels hide everything: skip it all
    const under = cam.position.y < -1;
    if (this.landMesh) this.landMesh.visible = !under;
    if (this.bridgeMesh) this.bridgeMesh.visible = !under;
    const px = cam.position.x, pz = cam.position.z, hy = Math.max(0, cam.position.y);
    // higher up you see further: stretch the detail rings with the camera height
    const k = (this.low ? 0.55 : 1) * (1 + hy / 400);
    for (const t of this.tiles) {
      const dx = Math.max(t.box[0] - px, 0, px - t.box[2]), dz = Math.max(t.box[1] - pz, 0, pz - t.box[3]);
      const d = Math.hypot(dx, dz);
      const lvl = d < 2200 * k ? 3 : d < 4200 * k ? 2 : d < 7000 * k ? 1 : 0;
      t.mesh.visible = !under && d < 15000 && t.lod[lvl] > 0;
      t.mesh.geometry.setDrawRange(0, t.lod[lvl]);
    }
  }
}
