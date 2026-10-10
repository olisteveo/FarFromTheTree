// Chinatown, late November: the Mulberry Street festival's paifang gates (red lacquered pillars on
// granite drums, painted beams, gilded plaques with 華埠 / 天下為公, bracket sets and green glazed
// roofs with upturned eaves) closing the streets into the festival, each with a curtain of red paper
// lanterns, festival barricades, a STREET CLOSED sign, stalls and the odd resting lion-dance lion;
// strings of lanterns zig-zagging over Mott, Mulberry, Elizabeth, Bayard, Pell, Doyers, Mosco, Hester
// and Baxter, lanterns under the shop awnings, neon blade signs; and the Manhattan Bridge coming down
// into the plaza at Canal St and the Bowery: steel towers with their arched portals, four cables and
// suspenders, the stiffening truss, the granite anchorages and approach, Carrère & Hastings' arch
// and colonnade.
//
// Assets: public/models/chinatown.glb (+ .json) and chinatown_bridge.glb, public/textures/chinatown/*
// (built by tools/chinatown/build_chinatown.py: textures designed in Tesseract, models made in Blender).
//
//   const ct = new Chinatown(city, flow.blockers, { quality, festival: blockerView.userData.festival, farCity });
//   scene.add(ct.root); ct.load();          // the old festival curtains stay until the gates are in
//   ct.update(camPos, t);                    // every frame: lanterns sway, culling by distance, nothing allocated
//
// Pure decoration: the gameplay collider is still the festival barrier rectangle (world/blockers.ts),
// which the lantern curtain under each gate fills. The lantern strings over the streets don't collide.
// chinatownLayout() is the placement step (no three.js objects), so tools can check it headless.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CityData } from "../world/data";
import type { Barrier, Blockers } from "../world/blockers";

// ================================================================== layout (pure data)

/** A placed kit part: position, yaw (local +x turns to (cos, -sin)), scale. */
export interface Put { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number }
export interface CtLayout {
  gates: { kind: "gate_1" | "gate_3"; put: Put; bar: Barrier }[];
  /** lanterns: hanging point (they hang down from it), scale; gate curtains and strings kept apart (they sway differently) */
  curtain: Put[];
  strings: Put[];
  awning: Put[];
  wires: number[];
  barricades: Put[];
  signs: Put[];
  stalls: Put[];
  lions: Put[];
  neon: Put[][];
}

/** The gates' bays (x0, x1, lintel height) at nominal size: chinatown.json, mirrored here so the layout is pure. */
const GATES = {
  gate_1: { half: 7.4, bays: [[-6, 6, 5.5]], eave: [[-6, 6, 8.35]] },
  gate_3: { half: 14, bays: [[-5, 5, 5.7], [-13, -5, 4.4], [5, 13, 4.4]], eave: [[-5, 5, 8.45], [-13, -5, 6.65], [5, 13, 6.65]] },
} as const;

/** Streets that get lanterns strung across them, and the box they get them in (Chinatown south of Grand). */
const LANTERN_STREETS = new Set(["MOTT ST", "MULBERRY ST", "ELIZABETH ST", "BAYARD ST", "PELL ST", "DOYERS ST", "MOSCO ST", "HESTER ST", "BAXTER ST"]);
const BOX = { x0: -880, x1: -545, z0: 1800, z1: 2340 };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function chinatownLayout(city: CityData, blockers: Blockers, quality: "low" | "medium" | "high"): CtLayout {
  const L: CtLayout = { gates: [], curtain: [], strings: [], awning: [], wires: [], barricades: [], signs: [], stalls: [], lions: [], neon: [[], [], [], []] };
  const r = rng(2026);
  const put = (x: number, y: number, z: number, yaw: number, s = 1, sy = s, sz = s): Put => ({ x, y, z, yaw, sx: s, sy, sz });
  const bars = blockers.barriers.filter((b) => b.blocker === "festival");
  // ---- the gates
  bars.forEach((bar, gi) => {
    const kind = bar.half > 10.5 ? "gate_3" : "gate_1";
    const G = GATES[kind];
    const sx = bar.half / G.half;
    // local +x along the barrier, local +z (the plaque_a "華埠" face) out of the closed area
    let yaw = Math.atan2(-bar.az, bar.ax), ax = bar.ax, az = bar.az;
    if (-az * bar.nx + ax * bar.nz < 0) { yaw += Math.PI; ax = -ax; az = -az; }
    const zx = -az, zz = ax; // local +z in the world (= the barrier's outward normal)
    const W = (lx: number, lz: number): [number, number] => [bar.x + ax * lx * sx + zx * lz, bar.z + az * lx * sx + zz * lz];
    L.gates.push({ kind, put: put(bar.x, 0, bar.z, yaw, sx, 1, 1), bar });
    G.bays.forEach(([x0, x1, lintel], bi) => {
      // the lantern curtain: strings every ~0.8 m, a lantern every metre from the lintel down to head height
      const w = (x1 - x0) * sx - 1.0, n = Math.max(2, Math.round(w / 0.8));
      for (let i = 0; i < n; i++) {
        const lx = (x0 * sx + 0.5 + (w * (i + 0.5)) / n) / sx;
        const lz = i % 2 ? 0.1 : -0.1;
        const [x, z] = W(lx, lz);
        let y = lintel - 0.1;
        const top = y;
        for (; y > 2.5; y -= 1.0) L.curtain.push(put(x, y, z, yaw + r() * 6.28, 0.8));
        L.wires.push(x, top + 0.1, z, x, y + 1.0, z);
      }
      // a big lantern under each end of the eaves, front and back
      const [ex0, ex1, eave] = G.eave[bi];
      for (const ex of [ex0 - 0.7, ex1 + 0.7]) for (const ez of [-1.25, 1.25]) {
        const [x, z] = W(ex, ez);
        L.curtain.push(put(x, eave - 0.55, z, r() * 6.28, 1.45));
      }
      // barricades across the bay, just outside the curtain
      const nb = Math.max(1, Math.floor(((x1 - x0) * sx) / 2.35));
      for (let i = 0; i < nb; i++) {
        const [x, z] = W(x0 + ((x1 - x0) * (i + 0.5)) / nb, 0.55);
        L.barricades.push(put(x, 0, z, yaw));
      }
      if (bi === 0) { const [x, z] = W(0, 1.3); L.signs.push(put(x, 0, z, yaw)); }
    });
    // inside: a stall either side of the street, facing across it, and every third gate a resting lion
    if (quality !== "low") {
      const inner = Math.max(2.4, bar.half - 4.6);
      for (const s of [-1, 1]) {
        const [x, z] = W((s * inner) / sx, -6.5 - r() * 3);
        L.stalls.push(put(x, 0, z, yaw + (s > 0 ? -Math.PI / 2 : Math.PI / 2)));
      }
      if (gi % 3 === 0) { const [x, z] = W(1.2 / sx, -2.6); L.lions.push(put(x, 0, z, yaw + 0.4)); }
    }
  });
  // ---- lanterns strung across the streets, under the awnings, neon blade signs
  const nearGate = (x: number, z: number, d: number) => bars.some((b) => Math.hypot(x - b.x, z - b.z) < d);
  /** walk out from the centreline to the first building face; null if none within reach (or it's too low) */
  const facade = (x: number, z: number, nx: number, nz: number, from: number, minH: number): [number, number] | null => {
    for (let d = from; d < from + 9; d += 0.4) {
      const b = city.buildingAt(x + nx * d, z + nz * d);
      if (b) return b.h >= minH ? [x + nx * (d - 0.25), z + nz * (d - 0.25)] : null;
    }
    return null;
  };
  const step = quality === "low" ? 26 : quality === "medium" ? 15 : 12;
  const lanternGap = quality === "low" ? 1.9 : 1.35;
  const awnStep = quality === "low" ? 30 : 9;
  for (const st of city.raw.streets) {
    if (!LANTERN_STREETS.has(st.n)) continue;
    const p = st.p;
    let carry = r() * step, awnCarry = r() * awnStep, side = r() < 0.5 ? 1 : -1;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
      for (let d = carry; d < len; d += step) {
        const x = ax + tx * d, z = az + tz * d;
        if (x < BOX.x0 || x > BOX.x1 || z < BOX.z0 || z > BOX.z1 || nearGate(x, z, 9)) continue;
        // zig-zag: from one side here to the other side a few metres on
        const y0 = 7.0 + r() * 1.6, y1 = 7.0 + r() * 1.6;
        const A = facade(x, z, nx * side, nz * side, st.w / 2, y0 + 1);
        const x2 = x + tx * 5.5, z2 = z + tz * 5.5;
        const B = facade(x2, z2, -nx * side, -nz * side, st.w / 2, y1 + 1);
        side = -side;
        if (!A || !B) continue;
        const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (span > 30 || span < 6) continue;
        const sag = 0.35 + span * 0.045;
        const at = (f: number): [number, number, number] => [A[0] + (B[0] - A[0]) * f, y0 + (y1 - y0) * f - sag * 4 * f * (1 - f), A[1] + (B[1] - A[1]) * f];
        for (let i = 0; i < 10; i++) { const a = at(i / 10), b = at((i + 1) / 10); L.wires.push(...a, ...b); }
        const n = Math.floor((span - 1.6) / lanternGap);
        for (let i = 0; i < n; i++) {
          const f = (0.8 + (i + 0.5) * ((span - 1.6) / n)) / span;
          const q = at(f);
          L.strings.push(put(q[0], q[1], q[2], r() * 6.28, 0.62 + r() * 0.12));
        }
      }
      carry = (carry - len) % step; if (carry < 0) carry += step;
      // shopfront lanterns (hung from a bracket under the awnings) and neon blade signs higher up
      for (let d = awnCarry; d < len; d += awnStep) {
        const x = ax + tx * d, z = az + tz * d;
        if (x < BOX.x0 || x > BOX.x1 || z < BOX.z0 || z > BOX.z1 || nearGate(x, z, 7)) continue;
        for (const s of [-1, 1]) {
          const f = facade(x, z, nx * s, nz * s, st.w / 2, 7);
          if (!f) continue;
          const roll = r();
          const ox = -nx * s, oz = -nz * s; // out of the wall
          if (roll < 0.55) {
            L.awning.push(put(f[0] + ox * 0.75, 3.55, f[1] + oz * 0.75, r() * 6.28, 0.62));
            if (r() < 0.6) L.awning.push(put(f[0] + ox * 0.75 + tx * 1.6, 3.55, f[1] + oz * 0.75 + tz * 1.6, r() * 6.28, 0.62));
          } else if (roll < (quality === "low" ? 0.62 : 0.67)) {
            L.neon[Math.floor(r() * 4)].push(put(f[0], 5.6 + r() * 1.4, f[1], Math.atan2(-oz, ox)));
          }
        }
      }
      awnCarry = (awnCarry - len) % awnStep; if (awnCarry < 0) awnCarry += awnStep;
    }
  }
  return L;
}

// ================================================================== the view

export interface ChinatownOptions {
  quality: "low" | "medium" | "high";
  /** the old festival lantern curtains (render/blockers.ts userData.festival): hidden once the gates are in */
  festival?: THREE.Object3D[];
  /** the far city: its box Manhattan Bridge goes when the modelled one is in */
  farCity?: { hideManhattanBridge(): void } | null;
  base?: string;
}

interface Part { geo: THREE.BufferGeometry; mat: string }

const SWAY_VERT = /* glsl */ `
  #ifdef USE_INSTANCING
    float ctPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23 + instanceMatrix[3].y * 1.7;
  #else
    float ctPh = 0.0;
  #endif
  float ctAmp = uSway.y * (0.65 + 0.35 * sin(uSway.x * 0.31 + ctPh * 0.13));
  float ctA = ctAmp * sin(uSway.x * 1.9 + ctPh);
  float ctB = ctAmp * 0.55 * sin(uSway.x * 1.37 + ctPh * 1.61);
  // swing about the hook (the origin): around z, then around x
  transformed.xy = vec2(transformed.x * cos(ctA) - transformed.y * sin(ctA), transformed.x * sin(ctA) + transformed.y * cos(ctA));
  transformed.zy = vec2(transformed.z * cos(ctB) - transformed.y * sin(ctB), transformed.z * sin(ctB) + transformed.y * cos(ctB));
`;

/** a material that swings its instances about their origin (lanterns on their hooks) */
function swaying<M extends THREE.Material>(m: M, uSway: { value: THREE.Vector2 }, key: string): M {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = uSway;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uSway;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + SWAY_VERT);
  };
  m.customProgramCacheKey = () => "ctSway" + key;
  return m;
}

export class Chinatown {
  readonly root = new THREE.Group();
  readonly bridge = new THREE.Group();
  ready = false;
  layout: CtLayout;
  /** byte counts of what this adds to the GPU (geometry, textures), filled in by load() */
  stats = { tris: 0, geometryBytes: 0, textureBytes: 0, lanterns: 0 };
  private uSwayCurtain = { value: new THREE.Vector2(0, 0.05) };
  private uSwayString = { value: new THREE.Vector2(0, 0.14) };
  private centre = new THREE.Vector3(-690, 0, 2070);

  constructor(city: CityData, blockers: Blockers, private opts: ChinatownOptions) {
    this.root.name = "chinatown";
    this.bridge.name = "manhattanBridge";
    this.layout = chinatownLayout(city, blockers, opts.quality);
    this.root.add(this.bridge);
  }

  async load() {
    const low = this.opts.quality === "low";
    const base = this.opts.base ?? "./";
    const url = (f: string) => new URL(f, new URL(base, document.baseURI)).href;
    const tl = new THREE.TextureLoader();
    const tex = async (f: string, repeat: boolean) => {
      const t = await tl.loadAsync(url("textures/chinatown/" + f));
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = low ? 2 : 8;
      t.needsUpdate = true;
      return t;
    };
    const gl = new GLTFLoader();
    // (phones get the arch and colonnade, not the bridge itself: they don't draw the far city either)
    const [atlas, granite, lime, kit, arch, br, steel, truss] = await Promise.all([
      tex(low ? "atlas_512.webp" : "atlas.webp", false), tex("granite.webp", true), tex("limestone.webp", true),
      gl.loadAsync(url("models/chinatown.glb")), gl.loadAsync(url("models/chinatown_arch.glb")),
      low ? Promise.resolve(null) : gl.loadAsync(url("models/chinatown_bridge.glb")),
      low ? Promise.resolve(null) : tex("steel.webp", true), low ? Promise.resolve(null) : tex("truss.webp", false),
    ]);
    // ---- materials
    const std = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.62, metalness: 0.0 });
    const glow = new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(1.75, 1.55, 1.45), toneMapped: false });
    const neonMat = new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(2.1, 2.1, 2.1), toneMapped: false });
    const swayMats = (u: { value: THREE.Vector2 }, key: string) => ({
      ct: swaying(std.clone(), u, key), ct_glow: swaying(glow.clone(), u, key),
    });
    const curtainMats = swayMats(this.uSwayCurtain, "c"), stringMats = swayMats(this.uSwayString, "s");
    const brMats: Record<string, THREE.Material> = {
      br_granite: new THREE.MeshStandardMaterial({ map: granite, roughness: 0.9 }),
      br_lime: new THREE.MeshStandardMaterial({ map: lime, roughness: 0.8, color: 0xf2efe8 }),
      br_steel: new THREE.MeshStandardMaterial({ map: steel, roughness: 0.62, metalness: 0.25, color: 0xd8e2ea }),
      br_deck: new THREE.MeshStandardMaterial({ color: 0x2b2c2d, roughness: 0.9 }),
      br_alpha: new THREE.MeshStandardMaterial({ map: truss, roughness: 0.6, metalness: 0.25, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xd8e2ea }),
    };
    // ---- the kit's parts (geometry baked in the node's frame)
    const lib = new Map<string, Part[]>();
    for (const g of [kit, arch, br]) {
      if (!g) continue;
      g.scene.updateMatrixWorld(true);
      for (const node of g.scene.children) {
        const list: Part[] = [];
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          list.push({ geo: m.geometry.clone().applyMatrix4(m.matrixWorld), mat: (Array.isArray(m.material) ? m.material[0] : m.material).name });
        });
        lib.set(node.name, list);
      }
    }
    const parts = (n: string) => lib.get(n) ?? [];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const kitGroup = new THREE.Group();
    kitGroup.name = "chinatownKit";
    const instanced = (name: string, list: Put[], mats: Record<string, THREE.Material>, shadow = false) => {
      if (!list.length) return;
      for (const p of parts(name)) {
        const im = new THREE.InstancedMesh(p.geo, mats[p.mat] ?? std, list.length);
        list.forEach((q, i) => im.setMatrixAt(i, M.compose(P.set(q.x, q.y, q.z), Q.setFromAxisAngle(Y, q.yaw), S.set(q.sx, q.sy, q.sz))));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = shadow;
        im.receiveShadow = !low;
        im.name = "ct_" + name;
        kitGroup.add(im);
      }
    };
    const L = this.layout;
    const base_ = { ct: std, ct_glow: glow };
    for (const kind of ["gate_1", "gate_3"] as const) instanced(kind, L.gates.filter((g) => g.kind === kind).map((g) => g.put), base_, !low);
    instanced(this.opts.quality === "high" ? "lantern_hi" : "lantern_lo", L.curtain, curtainMats);
    instanced("lantern_lo", L.strings, stringMats);
    instanced("lantern_lo", L.awning, stringMats);
    instanced("barricade", L.barricades, base_, !low);
    instanced("sign_closed", L.signs, base_);
    instanced("stall", L.stalls, base_, !low);
    instanced("lion", L.lions, base_, !low);
    L.neon.forEach((list, k) => instanced("neon_" + k, list, { ct: std, ct_glow: neonMat }));
    if (L.wires.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(L.wires, 3));
      const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1512 }));
      wires.name = "ct_wires";
      kitGroup.add(wires);
    }
    this.stats.lanterns = L.curtain.length + L.strings.length + L.awning.length;
    this.root.add(kitGroup);
    // ---- the Manhattan Bridge, in its frame (origin at the arch, +x toward Brooklyn)
    const meta = (await fetch(url("models/chinatown.json")).then((r) => r.json()).catch(() => null)) as { bridge?: { arch: [number, number]; axis: [number, number] } } | null;
    if (meta?.bridge) {
      const [ax, az] = meta.bridge.arch, [ux, uz] = meta.bridge.axis;
      this.bridge.position.set(ax, 0, az);
      this.bridge.rotation.y = Math.atan2(-uz, ux);
      for (const name of low ? ["bridge_arch"] : ["bridge_arch", "bridge_main"]) {
        for (const p of parts(name)) {
          const mesh = new THREE.Mesh(p.geo, brMats[p.mat] ?? brMats.br_granite);
          mesh.name = "ct_" + name;
          mesh.castShadow = name === "bridge_arch" && !low;
          mesh.receiveShadow = !low;
          this.bridge.add(mesh);
        }
      }
      this.bridge.updateMatrixWorld(true);
      if (!low) this.opts.farCity?.hideManhattanBridge();
    }
    // ---- the CPU copies of the geometry go once uploaded; count what this costs
    const seen = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry || seen.has(m.geometry)) return;
      seen.add(m.geometry);
      for (const a of Object.values(m.geometry.attributes)) this.stats.geometryBytes += (a as THREE.BufferAttribute).array.byteLength;
      if (m.geometry.index) this.stats.geometryBytes += m.geometry.index.array.byteLength;
      const n = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
      this.stats.tris += n * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
      if ((o as THREE.InstancedMesh).isInstancedMesh) this.stats.geometryBytes += (o as THREE.InstancedMesh).instanceMatrix.array.byteLength;
    });
    for (const t of [atlas, granite, lime, steel, truss]) if (t) { const im = t.image as { width: number; height: number }; this.stats.textureBytes += Math.round(im.width * im.height * 4 * 1.33); }
    for (const o of this.opts.festival ?? []) o.visible = false;
    this.ready = true;
  }

  /** Per frame: lanterns sway; the street dressing only near Chinatown; nothing underground. No allocation. */
  update(cam: THREE.Vector3, t: number) {
    this.uSwayCurtain.value.x = t;
    this.uSwayString.value.x = t;
    const under = cam.y < -1;
    this.bridge.visible = !under;
    const near = !under && Math.hypot(cam.x - this.centre.x, cam.z - this.centre.z) < 1100 + Math.max(0, cam.y) * 2;
    for (const c of this.root.children) if (c !== this.bridge) c.visible = near;
  }
}
