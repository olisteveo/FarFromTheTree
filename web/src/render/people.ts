// Pedestrians (and their dogs) drawn with vertex animation textures.
//
// Every character / dog is an InstancedMesh per level of detail. Each frame of each baked clip
// (walk, stroll, brisk, jog, idle, talk, hail, cheer, sit, flinch; dogs: walk, idle) is a row of
// texels in one RGBA16UI texture: xyz = quantised position, w = octahedral normal. The vertex
// shader fetches the two frames around the instance's playhead and blends them, and can blend in
// a second clip on top (stroll -> walk -> brisk by speed, walking -> standing as they stop, a
// flinch over whatever they were doing, one activity into the next).
//
// Level of detail: the full mesh up close (and only it casts shadows), then meshes with the
// vertices clustered (in the rest pose AND through the walk, so arms never weld to coats) to
// about 40% and 15%: the same VAT rows, just fewer of them fetched. Instances cross-fade
// between levels with a screen-door dither and dither away at the end of the range, so nobody
// pops. Instances outside the view frustum are skipped on the CPU.
//
// Assets (built by web/tools/people/build_people.py): models/people.json, people.glb,
// people_vat.bin (gzip), people_atlas.png.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface PeopleWalker {
  x: number; z: number;
  /** facing (unit) */
  tx: number; tz: number;
  /** metres walked: drives the walk cycle so the feet stay planted (falls back to time * speed) */
  phase: number;
  /** cruising speed (m/s) */
  speed: number; seed: number; h: number;
  /** standing still (old API: same as act "idle") */
  idle?: boolean;
  /** seconds since a leaf whooshed past (plays the flinch-and-look-up clip while < ~1.1 s) */
  flinch?: number;
  /** dog breed index (0 labrador, 1 terrier, 2 dachshund, 3 pug; taken modulo the breeds available) */
  pet?: number;
  /** how many dogs on leads (a dog walker's pack), breeds following on from pet */
  pets?: number;
  /** ground height under the walker (defaults to PeopleView.groundY); for sitters, the seat's height above the ground */
  y?: number;
  /** what they're doing: walk (default) | jog | idle | talk | hail | cheer | sit */
  act?: string;
  /** current speed (m/s) while slowing to a stop or setting off (defaults to speed) */
  v?: number;
  /** which character (people.json name); picked from the seed if unset */
  char?: string;
}

/** A static prop drawn with the people (crowd.ts CrowdProp). */
export interface PeopleProp { kind: "cart" | "stoop"; x: number; z: number; tx: number; tz: number; seed: number }

interface Clip { base: number; frames: number; loop: boolean; seconds: number; stride: number }
interface MeshMeta {
  name: string; verts: number; boundsMin: number[]; boundsMax: number[];
  anchors: Record<string, number>; clips: Record<string, Clip>;
}
interface CharMeta extends MeshMeta {
  height: number; kid: boolean; pair: boolean; old: boolean; stroller: boolean;
  face: number; faceGroup: string; kidFace: number; hat: boolean; scarf: boolean; coatTint: boolean;
  props: string[]; leadSide: number; seat?: number;
}
interface DogMeta extends MeshMeta { breed: string; withers: number; furTint: boolean; coat: boolean }
interface FaceMeta { name: string; rect: number[]; group: string; hair: number[]; skin: number[] }
interface PeopleJson {
  vatTexture: { width: number; height: number; posBits: number; blocks: [number, number, number][] };
  tintGain: number;
  characters: CharMeta[];
  dogs: DogMeta[];
  atlasLayout: { size: number[]; faces: FaceMeta[] };
}

/** One instanced draw: a character or a dog breed at one level of detail. */
interface Lod {
  mesh: THREE.InstancedMesh;
  vat: THREE.InstancedBufferAttribute;   // clip A frame a, frame b, blend, hat on
  vat2: THREE.InstancedBufferAttribute;  // clip B frame a, frame b, blend, weight of B
  tintA: THREE.InstancedBufferAttribute; // coat rgb, scarf hue
  tintB: THREE.InstancedBufferAttribute; // accessory rgb, face index
  tintC: THREE.InstancedBufferAttribute; // hair rgb, child face index
  fade: THREE.InstancedBufferAttribute;  // screen-door: + keep below, - keep above
  n: number; cap: number;
}
interface Kind { meta: MeshMeta; lods: Lod[]; min: THREE.Vector3; range: THREE.Vector3 }

/** Per-walker look, chosen once from the seed. */
interface Look {
  kind: number; offset: number;
  tintA: THREE.Color; tintB: THREE.Color; tintC: THREE.Color;
  scarfHue: number; face: number; kidFace: number; hat: number;
  dogScale: number; dogOffset: number; dogFur: THREE.Color; dogCoat: THREE.Color; collar: THREE.Color; lead: THREE.Color;
}
/** Per-walker state the renderer keeps (turning eases, activities cross-fade). */
interface Vis { yaw: number; act: string; prev: string; since: number; seen: number }

const hash = (n: number) => {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
};
const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// winter palettes (sRGB hex; THREE.Color keeps them linear)
const COATS = [0x1d2230, 0x111214, 0x2e3033, 0x4a4c50, 0x7b5a3a, 0xa8865c, 0x3c4a2e, 0x24382a, 0x5a1e22, 0x7a2626, 0x2a3f5c,
  0x3b5f7a, 0x9aa3ab, 0xc9c1b0, 0x5d3a52, 0x8a6a2a, 0x1f4a4a, 0xb04a2a, 0x6b7c8a, 0x403028];
const ACCENTS = [0xc0392b, 0xe0b23a, 0x2f6fb0, 0xe8e2d4, 0x3f8a4a, 0x8e4a9a, 0xe0782a, 0x2a2a2e, 0xd04a6a, 0x5aa0c8,
  0xd8d040, 0x7a4a2a, 0xf0a0b0, 0x40a0a0, 0xffffff, 0x223355];
const DOG_FUR = [0xf2e6c8, 0xe6c07a, 0xd9a050, 0x2a2420, 0x5a3a24];   // cream, golden, fox red, black, chocolate
/** how often each character turns up when the crowd doesn't say who (the specialists only when asked for) */
const CHAR_WEIGHT: Record<string, number> = { kid: 0.3, parent_kid: 0.45, stroller: 0.4, hivis: 0.45, courier: 0.6, tourist: 0.7, runner: 0, dolly: 0, vendor: 0, umbrella: 0.3 };

/** Level-of-detail settings per quality. */
const LOD_Q = {
  high: { d0: 28, d1: 70, end: 165, band: 4, cap0: 200, shadow1: true },
  medium: { d0: 22, d1: 55, end: 140, band: 4, cap0: 120, shadow1: false },
  low: { d0: 14, d1: 38, end: 105, band: 3, cap0: 60, shadow1: false },
};

const VERT_HEAD = /* glsl */ `
uniform highp usampler2D uVat;
uniform int uVatW;
uniform vec3 uMin;
uniform vec3 uRange;
uniform float uPosMax;
uniform vec2 uFace0;
uniform vec2 uFace1;
uniform vec2 uFaceSize;
attribute float _vatid;
attribute vec4 aMask;
attribute vec4 aVat;
attribute vec4 aVat2;
attribute float aFade;
attribute vec4 aTintA;
attribute vec4 aTintB;
attribute vec4 aTintC;
varying vec4 vMask;
varying vec3 vTintA;
varying vec3 vTintB;
varying vec3 vTintC;
varying float vScarfHue;
varying float vFade;
vec3 vatP(uvec4 t) { return uMin + vec3(t.xyz) / uPosMax * uRange; }
vec3 vatN(uint w) {
  vec2 e = vec2(float(w & 255u), float(w >> 8u)) / 255.0 * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
uvec4 vatT(float base, int id) { int i = int(base + 0.5) + id; return texelFetch(uVat, ivec2(i % uVatW, i / uVatW), 0); }
`;
const VAT_FETCH = /* glsl */ `
  int vatId = int(_vatid + 0.5);
  uvec4 ta = vatT(aVat.x, vatId), tb = vatT(aVat.y, vatId);
  uvec4 tc = ta, td = tb;
  vec3 vatPos = mix(vatP(ta), vatP(tb), aVat.z);
  if (aVat2.w > 0.002) {
    tc = vatT(aVat2.x, vatId); td = vatT(aVat2.y, vatId);
    vatPos = mix(vatPos, mix(vatP(tc), vatP(td), aVat2.z), aVat2.w);
  }
  float vatFlag = floor(aMask.a * 8.0 + 0.5);
  if (vatFlag == 2.0 && aVat.w < 0.5) vatPos = vec3(0.0);   // hat off: collapse it
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, withNormals: boolean) {
  shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\n" + VERT_HEAD);
  if (withNormals) {
    shader.vertexShader = shader.vertexShader
      .replace("#include <beginnormal_vertex>", VAT_FETCH + `
  vec3 objectNormal = normalize(mix(mix(vatN(ta.w), vatN(tb.w), aVat.z), mix(vatN(tc.w), vatN(td.w), aVat2.z), aVat2.w));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(1.0, 0.0, 0.0);
  #endif`)
      .replace("#include <begin_vertex>", "vec3 transformed = vatPos;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
  vMask = aMask;
  vFade = aFade;
  vTintA = aTintA.rgb; vTintB = aTintB.rgb; vTintC = aTintC.rgb; vScarfHue = aTintA.w;
  #ifdef USE_MAP
  {
    float fl = floor(aMask.a * 8.0 + 0.5);
    if (fl == 1.0) vMapUv += (vec2(mod(aTintB.w, 4.0), floor(aTintB.w / 4.0)) - uFace0) * uFaceSize;
    if (fl == 4.0) vMapUv += (vec2(mod(aTintC.w, 4.0), floor(aTintC.w / 4.0)) - uFace1) * uFaceSize;
  }
  #endif`);
  } else {
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", VAT_FETCH + "\n  vec3 transformed = vatPos;");
  }
}

const FRAG_HEAD = /* glsl */ `
uniform float uTintGain;
varying vec4 vMask;
varying vec3 vTintA;
varying vec3 vTintB;
varying vec3 vTintC;
varying float vScarfHue;
varying float vFade;
vec3 hueShift(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float h = atan(yiq.z, yiq.y) + a, ch = length(yiq.yz);
  return max(toRGB * vec3(yiq.x, ch * cos(h), ch * sin(h)), 0.0);
}
`;
// screen-door fade (interleaved gradient noise): a positive fade keeps the pixels below it, a negative one those above
const FRAG_DITHER = /* glsl */ `#include <clipping_planes_fragment>
  if (vFade < 0.999) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade >= 0.0 ? ign >= vFade : ign < -vFade) discard;
  }`;
const FRAG_TINT = /* glsl */ `#include <map_fragment>
  {
    vec3 g = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * uTintGain;
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintA, vMask.r);
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintB, vMask.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintC, vMask.b);
    if (abs(vMask.a * 8.0 - 3.0) < 0.5) diffuseColor.rgb = hueShift(diffuseColor.rgb, vScarfHue);
  }`;

const SOCIAL = new Set(["talk", "hail", "cheer", "sit", "idle", "jog"]);

export class PeopleView {
  readonly root = new THREE.Group();
  /** sidewalk top (the crowd walks on the kerb-height pavement) */
  groundY = 0.15;
  /** where people.json & co live, relative to the page */
  baseUrl = "./models/";
  /** max instances per character type (and per dog breed) at the far level of detail */
  readonly capacity: number;
  quality: "low" | "medium" | "high" = "high";
  /** debug: draw everyone at this level of detail */
  forceLod = -1;
  /** last frame's counts: drawn per level of detail, culled */
  readonly stats = { lod0: 0, lod1: 0, lod2: 0, culled: 0, dogs: 0 };
  private chars: Kind[] = [];
  private dogs: Kind[] = [];
  private charIndex = new Map<string, number>();
  private looks = new Map<number, Look>();
  private vis = new Map<number, Vis>();
  private json?: PeopleJson;
  private vatData?: Uint16Array;
  private posMax = 4095;
  private charWeights: number[] = [];
  private faceGroups = new Map<string, number[]>();
  private leads?: THREE.InstancedMesh;
  private propMeshes: THREE.InstancedMesh[] = [];
  private loaded = false;
  private lastTime = 0;
  private frame = 0;
  // scratch
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private p = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);
  private frustum = new THREE.Frustum(); private pv = new THREE.Matrix4(); private sphere = new THREE.Sphere();

  constructor(capacity = 900) {
    this.capacity = capacity;
    this.root.name = "people";
  }

  async load(baseUrl?: string): Promise<void> {
    if (baseUrl) this.baseUrl = baseUrl;
    const url = (f: string) => new URL(f, new URL(this.baseUrl, document.baseURI)).href;
    const json = (await (await fetch(url("people.json"))).json()) as PeopleJson;
    const [gltf, vatBuf, atlas] = await Promise.all([
      new GLTFLoader().loadAsync(url("people.glb")),
      fetch(url("people_vat.bin")).then((r) => r.arrayBuffer()),
      new THREE.TextureLoader().loadAsync(url("people_atlas.png")),
    ]);
    this.json = json;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.flipY = false;
    atlas.anisotropy = 4;
    atlas.needsUpdate = true;

    // ---- VAT texture
    const vt = json.vatTexture;
    this.posMax = (1 << vt.posBits) - 1;
    this.vatData = await decodeVat(vatBuf, vt.width, vt.height, vt.blocks);
    const tex = new THREE.DataTexture(this.vatData, vt.width, vt.height, THREE.RGBAIntegerFormat, THREE.UnsignedShortType);
    tex.internalFormat = "RGBA16UI";
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    // ---- faces (for per-instance face swaps)
    json.atlasLayout.faces.forEach((f, i) => {
      if (!this.faceGroups.has(f.group)) this.faceGroups.set(f.group, []);
      this.faceGroups.get(f.group)!.push(i);
    });
    const [aw, ah] = json.atlasLayout.size;
    const faceSize = new THREE.Vector2(256 / aw, 128 / ah);
    const faceCell = (i: number) => new THREE.Vector2(i % 4, Math.floor(i / 4));

    const geoms = new Map<string, THREE.BufferGeometry>();
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) geoms.set(o.name, (o as THREE.Mesh).geometry); });
    const make = (meta: MeshMeta, face0: number, face1: number, dog: boolean): Kind => {
      const base = geoms.get(meta.name)!.clone();
      const col = base.getAttribute("color");
      base.setAttribute("aMask", col);
      base.deleteAttribute("color");
      const min = new THREE.Vector3().fromArray(meta.boundsMin);
      const range = new THREE.Vector3().fromArray(meta.boundsMax).sub(min);
      const uniforms = {
        uVat: { value: tex }, uVatW: { value: vt.width }, uMin: { value: min }, uRange: { value: range },
        uPosMax: { value: this.posMax }, uFace0: { value: faceCell(Math.max(0, face0)) }, uFace1: { value: faceCell(Math.max(0, face1)) },
        uFaceSize: { value: faceSize }, uTintGain: { value: json.tintGain },
      };
      const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.88, metalness: 0 });
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        patchVertex(sh, true);
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + FRAG_HEAD)
          .replace("#include <clipping_planes_fragment>", FRAG_DITHER)
          .replace("#include <map_fragment>", FRAG_TINT);
      };
      mat.customProgramCacheKey = () => "fftt-people-vat2";
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uniforms); patchVertex(sh, false); };
      depth.customProgramCacheKey = () => "fftt-people-vat2-depth";
      // levels of detail: the full mesh, then clustered ones (same VAT ids, fewer of them)
      const levels = dog ? [0, 0.08] : [0, 0.07, 0.17];
      const caps = dog ? [Math.min(this.capacity, 260), this.capacity] : [Math.min(this.capacity, 260), this.capacity, this.capacity];
      const lods = levels.map((cell, li) => {
        const geo = li === 0 ? base : this.simplify(base, meta, cell);
        const cap = caps[li];
        const attr = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k).setUsage(THREE.DynamicDrawUsage);
        const L: Lod = { mesh: null!, vat: attr(4), vat2: attr(4), tintA: attr(4), tintB: attr(4), tintC: attr(4), fade: attr(1), n: 0, cap };
        geo.setAttribute("aVat", L.vat);
        geo.setAttribute("aVat2", L.vat2);
        geo.setAttribute("aFade", L.fade);
        geo.setAttribute("aTintA", L.tintA);
        geo.setAttribute("aTintB", L.tintB);
        geo.setAttribute("aTintC", L.tintC);
        const mesh = new THREE.InstancedMesh(geo, mat, cap);
        mesh.customDepthMaterial = depth;
        mesh.name = `${meta.name}_lod${li}`;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = li === 0;
        mesh.receiveShadow = li < 2;
        this.root.add(mesh);
        L.mesh = mesh;
        return L;
      });
      return { meta, lods, min, range };
    };
    this.chars = json.characters.map((c) => make(c, c.face, c.kidFace, false));
    this.dogs = json.dogs.map((d) => make(d, 0, 0, true));
    json.characters.forEach((c, i) => this.charIndex.set(c.name, i));
    this.charWeights = json.characters.map((c) => CHAR_WEIGHT[c.name] ?? 1);

    // leads: thin boxes, three sagging segments per dog
    const leadGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.leads = new THREE.InstancedMesh(leadGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), this.capacity);
    this.leads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.leads.count = 0;
    this.leads.frustumCulled = false;
    this.leads.castShadow = true;
    this.root.add(this.leads);
    this.loaded = true;
  }

  /**
   * A lower level of detail: vertices welded on a grid of `cell` metres, but only where they
   * stay together through the walk and the idle (so a swinging hand never welds to the coat).
   */
  private simplify(src: THREE.BufferGeometry, meta: MeshMeta, cell: number): THREE.BufferGeometry {
    const g = src.clone();
    const ids = g.getAttribute("_vatid");
    const idx = g.index!;
    const n = ids.count;
    const d = this.vatData!, pm = this.posMax;
    const lo = meta.boundsMin, hi = meta.boundsMax;
    const probes: number[] = [];
    // coarse levels look at fewer poses (the far ones only need the walk to hold together)
    const poses = cell > 0.15 ? [["walk", 0], ["walk", 12]] as const : [["walk", 0], ["walk", 12], ["idle", 0]] as const;
    for (const [name, fr] of poses) {
      const c = meta.clips[name];
      if (c) probes.push(c.base + Math.min(fr, c.frames - 1) * meta.verts);
    }
    // cluster, then let each cluster's vertex nearest its middle (in the first probe pose) stand for it
    const rep = new Int32Array(n), cl = new Int32Array(n);
    const map = new Map<string, number>();
    const pos = (v: number, k: number) => lo[k] + (d[(probes[0] + ids.getX(v)) * 4 + k] / pm) * (hi[k] - lo[k]);
    const cen: number[] = [];
    for (let v = 0; v < n; v++) {
      const vid = ids.getX(v);
      let key = "";
      for (const b of probes) {
        const t = (b + vid) * 4;
        for (let k = 0; k < 3; k++) key += Math.floor((lo[k] + (d[t + k] / pm) * (hi[k] - lo[k])) / cell) + ",";
      }
      let c = map.get(key);
      if (c === undefined) { c = cen.length / 4; map.set(key, c); cen.push(0, 0, 0, 0); }
      cl[v] = c;
      cen[c * 4] += pos(v, 0); cen[c * 4 + 1] += pos(v, 1); cen[c * 4 + 2] += pos(v, 2); cen[c * 4 + 3]++;
    }
    const best = new Float64Array(cen.length / 4).fill(Infinity), bestV = new Int32Array(cen.length / 4);
    for (let v = 0; v < n; v++) {
      const c = cl[v], m = cen[c * 4 + 3];
      const dd = (pos(v, 0) - cen[c * 4] / m) ** 2 + (pos(v, 1) - cen[c * 4 + 1] / m) ** 2 + (pos(v, 2) - cen[c * 4 + 2] / m) ** 2;
      if (dd < best[c]) { best[c] = dd; bestV[c] = v; }
    }
    for (let v = 0; v < n; v++) rep[v] = bestV[cl[v]];
    const out: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < idx.count; i += 3) {
      const a = rep[idx.getX(i)], b = rep[idx.getX(i + 1)], c = rep[idx.getX(i + 2)];
      if (a === b || b === c || a === c) continue;
      const k = [a, b, c].sort((x, y) => x - y).join(",") + (a < b ? "+" : "-");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a, b, c);
    }
    g.setIndex(out);
    return g;
  }

  /** The look (character, colours, face, hat...) for a seed: deterministic. */
  private look(seed: number, kid: boolean, char?: string): Look {
    let L = this.looks.get(seed);
    if (L) return L;
    const r = (k: number) => hash(seed * 7919 + k * 104729);
    const chars = this.json!.characters;
    let kind = char !== undefined ? this.charIndex.get(char) ?? -1 : -1;
    if (kind < 0) {
      const lone = (i: number) => chars[i].kid && !chars[i].pair;
      const w = this.charWeights.map((x, i) => (kid ? (lone(i) ? 1 : 0) : lone(i) ? 0 : x));
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      let pick = r(1) * tot;
      kind = 0;
      for (; kind < w.length - 1; kind++) { pick -= w[kind]; if (pick < 0 && w[kind] > 0) break; }
    }
    const c = chars[kind];
    const faces = this.json!.atlasLayout.faces;
    const group = this.faceGroups.get(c.faceGroup) ?? [c.face];
    const face = r(2) < 0.4 ? c.face : group[Math.floor(r(3) * group.length) % group.length];
    const kids = this.faceGroups.get("kid") ?? [0];
    const kidFace = c.kidFace >= 0 ? kids[Math.floor(r(4) * kids.length) % kids.length] : 0;
    const hair = faces[face].hair;
    const tintC = new THREE.Color().setRGB(hair[0], hair[1], hair[2], THREE.SRGBColorSpace);
    L = {
      kind, offset: r(5),
      tintA: srgb(COATS[Math.floor(r(7) * COATS.length)]),
      tintB: srgb(ACCENTS[Math.floor(r(8) * ACCENTS.length)]),
      tintC, scarfHue: r(9) < 0.7 ? r(10) * Math.PI * 2 : 0, face, kidFace, hat: c.hat ? (r(11) < 0.78 ? 1 : 0) : 1,
      dogScale: 0.9 + r(12) * 0.2, dogOffset: r(13), dogFur: srgb(DOG_FUR[Math.floor(r(14) * DOG_FUR.length)]),
      dogCoat: srgb(ACCENTS[Math.floor(r(15) * ACCENTS.length)]), collar: srgb(ACCENTS[Math.floor(r(16) * ACCENTS.length)]),
      lead: srgb([0x1a1a1a, 0xb02a2a, 0x2a4ab0, 0x2a8a3a, 0xd08a20][Math.floor(r(17) * 5)]),
    };
    // keep a little brightness variation on the coat itself
    L.tintA.multiplyScalar(0.85 + r(18) * 0.3);
    this.looks.set(seed, L);
    return L;
  }

  /** frame pair + blend for a clip at playhead `cyc` (cycles for loops, 0..1 for one-shots) */
  private frames(meta: MeshMeta, clip: Clip, cyc: number, out: number[], o = 0) {
    const F = clip.frames, V = meta.verts;
    let fa: number, fb: number, t: number;
    if (clip.loop) {
      const f = (cyc - Math.floor(cyc)) * F;
      fa = Math.floor(f) % F; fb = (fa + 1) % F; t = f - Math.floor(f);
    } else {
      const f = Math.min(1, Math.max(0, cyc)) * (F - 1);
      fa = Math.floor(f); fb = Math.min(F - 1, fa + 1); t = f - fa;
    }
    out[o] = clip.base + fa * V; out[o + 1] = clip.base + fb * V; out[o + 2] = t;
  }

  /** CPU decode of one baked vertex (for lead anchors), in the mesh's local space, both clips blended */
  private vertexAt(k: Kind, vat: number[], vid: number, out: THREE.Vector3) {
    const d = this.vatData!, pm = this.posMax;
    const at = (a: number, b: number, t: number, c: number) => d[(a + vid) * 4 + c] + (d[(b + vid) * 4 + c] - d[(a + vid) * 4 + c]) * t;
    const w = vat[6] ?? 0;
    const q = (c: number) => (w > 0.002 ? at(vat[0], vat[1], vat[2], c) * (1 - w) + at(vat[3], vat[4], vat[5], c) * w : at(vat[0], vat[1], vat[2], c));
    out.set(k.min.x + (q(0) / pm) * k.range.x, k.min.y + (q(1) / pm) * k.range.y, k.min.z + (q(2) / pm) * k.range.z);
    return out;
  }

  /** Draw the hot dog carts and stoops (static; call once). */
  setProps(props: PeopleProp[]) {
    for (const m of this.propMeshes) { this.root.remove(m); m.geometry.dispose(); }
    this.propMeshes = [];
    const build = (kind: PeopleProp["kind"], geo: THREE.BufferGeometry) => {
      const list = props.filter((p) => p.kind === kind);
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: kind === "cart" ? 0.35 : 0, side: kind === "cart" ? THREE.DoubleSide : THREE.FrontSide }), list.length);
      list.forEach((p, i) => {
        this.q.setFromAxisAngle(this.Y, Math.atan2(p.tx, p.tz));
        mesh.setMatrixAt(i, this.m.compose(this.p.set(p.x, this.groundY, p.z), this.q, this.s.set(1, 1, 1)));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      this.propMeshes.push(mesh);
    };
    build("cart", cartGeometry());
    build("stoop", stoopGeometry());
  }

  /**
   * Draw this frame's walkers. `time` is the shared clock in seconds; `camera` (optional) sets the
   * level of detail and culls what's out of view.
   */
  update(walkers: PeopleWalker[], time: number, camera?: THREE.Camera) {
    if (!this.loaded) return;
    const Q = LOD_Q[this.quality];
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.frame++;
    for (const k of this.chars) for (const L of k.lods) L.n = 0;
    for (const k of this.dogs) for (const L of k.lods) L.n = 0;
    const st = this.stats;
    st.lod0 = st.lod1 = st.lod2 = st.culled = st.dogs = 0;
    let leadN = 0;
    const fr = [0, 0, 0, 0, 0, 0, 0], frD = [0, 0, 0, 0, 0, 0, 0];
    const hand = new THREE.Vector3(), collar = new THREE.Vector3(), mid = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    const mDog = new THREE.Matrix4();
    const leadCol = this.leads!.instanceColor!;
    const cx = camera ? camera.position.x : 0, cz = camera ? camera.position.z : 0, cy = camera ? camera.position.y : 0;
    if (camera) {
      camera.updateMatrixWorld();
      this.pv.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.pv);
    }
    // close-up budget: if too many are near, pull the full-detail radius in
    let d0 = Q.d0;
    if (camera) {
      let near = 0;
      const d02 = d0 * d0;
      for (const w of walkers) { const a = w.x - cx, b = w.z - cz; if (a * a + b * b < d02) near++; }
      if (near > Q.cap0) d0 *= Math.sqrt(Q.cap0 / near);
    }
    const put = (k: Kind, li: number, fade: number, look: Look, vat: number[], hat: number, scarf: number): number => {
      const L = k.lods[Math.min(li, k.lods.length - 1)];
      if (L.n >= L.cap) return -1;
      const i = L.n++;
      L.mesh.setMatrixAt(i, this.m);
      L.vat.setXYZW(i, vat[0], vat[1], vat[2], hat);
      L.vat2.setXYZW(i, vat[3], vat[4], vat[5], vat[6]);
      L.fade.setX(i, fade);
      L.tintA.setXYZW(i, look.tintA.r, look.tintA.g, look.tintA.b, scarf);
      L.tintB.setXYZW(i, look.tintB.r, look.tintB.g, look.tintB.b, look.face);
      L.tintC.setXYZW(i, look.tintC.r, look.tintC.g, look.tintC.b, look.kidFace);
      return i;
    };
    const end2 = Q.end * Q.end, hy2 = ((cy - 1) * 0.5) ** 2;
    for (const w of walkers) {
      const ddx = w.x - cx, ddz = w.z - cz;
      const d2 = camera ? ddx * ddx + ddz * ddz + hy2 : 0;
      if (d2 > end2) continue;
      const dist = Math.sqrt(d2);
      if (camera) {
        this.sphere.center.set(w.x, (w.y ?? this.groundY) + 0.9, w.z);
        this.sphere.radius = w.pets ? 3 : 1.6;
        if (!this.frustum.intersectsSphere(this.sphere)) { st.culled++; continue; }
      }
      const kidish = w.h < 1.4;
      const look = this.look(w.seed, kidish, w.char);
      const k = this.chars[look.kind];
      const c = k.meta as CharMeta;
      // adults take the walker's height; a lone child is scaled relative to an adult of that height
      const scale = c.kid ? w.h / 1.22 : w.h / c.height;
      let gy = w.y ?? this.groundY;
      // ---- what they're doing, and the clips to blend
      let act = w.act ?? (w.idle ? "idle" : "walk");
      if (act === "jog" && !c.clips.jog) act = "walk";
      if (SOCIAL.has(act) && !c.clips[act]) act = act === "sit" ? "idle" : "idle";
      // remember who's who: turning eases, activities cross-fade
      let V = this.vis.get(w.seed);
      const yawT = Math.atan2(w.tx, w.tz);
      if (!V || this.frame - V.seen > 3) { V = { yaw: yawT, act, prev: act, since: -9, seen: this.frame }; this.vis.set(w.seed, V); }
      else {
        let dy = yawT - V.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const turn = dy * (1 - Math.exp(-dt * (act === "walk" || act === "jog" ? 7 : 4)));
        const maxT = 4.5 * dt;
        V.yaw += Math.max(-maxT, Math.min(maxT, turn));
        if (act !== V.act) { V.prev = V.act; V.act = act; V.since = time; }
        V.seen = this.frame;
      }
      const blendIn = smooth(0, 0.45, time - V.since);
      const vat = fr;
      vat[6] = 0;
      const sp = Math.max(0.05, w.speed);
      const cur = w.v ?? sp;
      const dist0 = w.phase || time * sp;
      if (act === "walk" || act === "jog") {
        this.gait(c, act, sp, scale, dist0, look.offset, vat);
        // slowing to a stop / setting off: blend toward standing
        const still = 1 - smooth(0.05, 0.95, cur / sp);
        if (still > 0.01) {
          // keep whichever gait clip dominates and put the idle in the second slot
          if (vat[6] > 0.5) { vat[0] = vat[3]; vat[1] = vat[4]; vat[2] = vat[5]; }
          this.frames(c, c.clips.idle, time / c.clips.idle.seconds + look.offset, vat, 3);
          vat[6] = still;
        }
      } else {
        const clip = c.clips[act] ?? c.clips.idle;
        this.frames(c, clip, time / clip.seconds + look.offset, vat, 0);
        if (blendIn < 1 && V.prev !== act) {
          // cross-fade from what they were doing
          const pc = V.prev === "walk" || V.prev === "jog" ? c.clips.idle : c.clips[V.prev] ?? c.clips.idle;
          this.frames(c, clip, time / clip.seconds + look.offset, vat, 3);
          this.frames(c, pc, time / pc.seconds + look.offset, vat, 0);
          vat[6] = blendIn;
        }
        if (act === "sit") gy = this.groundY + (w.y ?? 0.42) - (c.seat ?? 0.45) * scale;
      }
      // a leaf whooshed past: flinch over the top
      if (w.flinch !== undefined && w.flinch >= 0 && w.flinch < c.clips.flinch.seconds && act !== "sit") {
        const e = smooth(0, 0.12, w.flinch) * (1 - smooth(c.clips.flinch.seconds - 0.25, c.clips.flinch.seconds, w.flinch));
        if (vat[6] > 0.5) { vat[0] = vat[3]; vat[1] = vat[4]; vat[2] = vat[5]; }
        this.frames(c, c.clips.flinch, w.flinch / c.clips.flinch.seconds, vat, 3);
        vat[6] = e;
      }
      // ---- level of detail by distance (dithered across the boundaries and out at the end)
      let li = this.forceLod >= 0 ? this.forceLod : dist < d0 ? 0 : dist < Q.d1 ? 1 : 2;
      const endFade = 1 - smooth(Q.end - 30, Q.end, dist);
      this.q.setFromAxisAngle(this.Y, V.yaw);
      this.m.compose(this.p.set(w.x, gy, w.z), this.q, this.s.set(scale, scale, scale));
      const hat = look.hat, scarf = c.scarf ? look.scarfHue : 0;
      const edge = li === 0 ? d0 : li === 1 ? Q.d1 : Infinity;
      const into = edge - dist;                                        // metres before the next level
      if (into < Q.band && li < 2) {
        const f = smooth(0, Q.band, into);                              // 1 deep inside, 0 at the edge
        put(k, li, f * endFade, look, vat, hat, scarf);
        put(k, li + 1, -f, look, vat, hat, scarf);
      } else put(k, li, endFade, look, vat, hat, scarf);
      if (li === 0) st.lod0++; else if (li === 1) st.lod1++; else st.lod2++;

      // ---- the dog(s), trotting ahead on the lead side
      const nd = w.pet === undefined ? 0 : Math.max(1, w.pets ?? 1);
      if (!nd || this.dogs.length === 0 || (li === 2 && dist > Q.d1 + 25)) continue;
      const side = c.leadSide || 1;
      const lx = w.tz, lz = -w.tx;                      // the walker's left in world space
      for (let di = 0; di < nd; di++) {
        const breed = ((Math.floor((w.pet ?? 0) + di * 3 + (di ? hash(w.seed + di) * 4 : 0)) % this.dogs.length) + this.dogs.length) % this.dogs.length;
        const dk = this.dogs[breed];
        const dm = dk.meta as DogMeta;
        const ds = L2(look.dogScale, di, w.seed);
        // one dog at heel; a pack fans out ahead
        const fanA = nd === 1 ? 0 : (di / (nd - 1) - 0.5) * 1.6;
        const reach = nd === 1 ? 0.35 : 1.1 + hash(w.seed * 3 + di) * 0.7;
        const off = (nd === 1 ? 0.75 * side : Math.sin(fanA) * 1.2 + 0.3 * side);
        const ahead = nd === 1 ? reach : reach * Math.cos(fanA * 0.5);
        const dx = w.x + lx * off + w.tx * ahead, dz = w.z + lz * off + w.tz * ahead;
        const moving = (act === "walk" || act === "jog") && cur > 0.25;
        let dclip: Clip, dcyc: number;
        const doff = look.dogOffset + di * 0.37;
        if (!moving) { dclip = dm.clips.idle; dcyc = time / dclip.seconds + doff; }
        else { dclip = dm.clips.walk; dcyc = dist0 / (dclip.stride * ds) + doff; }
        frD[6] = 0;
        this.frames(dm, dclip, dcyc, frD);
        const dyaw = V.yaw + (nd > 1 ? Math.sin(time * 0.7 + di * 2) * 0.25 : 0);
        this.q.setFromAxisAngle(this.Y, dyaw);
        mDog.compose(this.p.set(dx, w.y ?? this.groundY, dz), this.q, this.s.set(ds, ds, ds));
        this.m.copy(mDog);
        const dl = li === 0 ? 0 : 1;
        const fur = look.dogFur, coat = look.dogCoat;
        const DL = dk.lods[Math.min(dl, dk.lods.length - 1)];
        if (DL.n >= DL.cap) continue;
        const j = DL.n++;
        st.dogs++;
        DL.mesh.setMatrixAt(j, mDog);
        DL.vat.setXYZW(j, frD[0], frD[1], frD[2], 1);
        DL.vat2.setXYZW(j, 0, 0, 0, 0);
        DL.fade.setX(j, endFade);
        DL.tintA.setXYZW(j, coat.r, coat.g, coat.b, 0);
        DL.tintB.setXYZW(j, look.collar.r, look.collar.g, look.collar.b, 0);
        const fk = di ? 0.6 + hash(w.seed * 5 + di) * 0.8 : 1;
        DL.tintC.setXYZW(j, fur.r * fk, fur.g * fk, fur.b * fk, 0);

        // ---- lead: hand -> collar, three segments with a little sag
        if (li === 2 || leadN + 3 > this.capacity) continue;
        this.q.setFromAxisAngle(this.Y, V.yaw);
        this.m.compose(this.p.set(w.x, gy, w.z), this.q, this.s.set(scale, scale, scale));
        const hv = c.anchors[side > 0 ? "handL" : "handR"];
        this.vertexAt(k, fr, hv, hand).applyMatrix4(this.m);
        this.vertexAt(dk, frD, dm.anchors.collar, collar).applyMatrix4(mDog);
        const dist2 = hand.distanceTo(collar);
        const sag = Math.max(0.03, 0.22 - dist2 * 0.12);
        let prev = a.copy(hand);
        for (let sgi = 1; sgi <= 3; sgi++) {
          const t = sgi / 3;
          const next = mid.lerpVectors(hand, collar, t);
          next.y -= sag * 4 * t * (1 - t);
          const len = prev.distanceTo(next);
          b.copy(next);
          this.m.lookAt(next, prev, this.Y);              // +Z from prev toward next
          this.m.scale(this.s.set(0.012, 0.012, len)).setPosition(prev);
          this.leads!.setMatrixAt(leadN, this.m);
          leadCol.setXYZ(leadN, look.lead.r, look.lead.g, look.lead.b);
          leadN++;
          prev = a.copy(b);
        }
      }
    }
    for (const k of [...this.chars, ...this.dogs]) for (const L of k.lods) {
      L.mesh.count = L.n;
      if (L.n === 0) continue;
      L.mesh.instanceMatrix.clearUpdateRanges();
      L.mesh.instanceMatrix.addUpdateRange(0, L.n * 16);
      L.mesh.instanceMatrix.needsUpdate = true;
      for (const at of [L.vat, L.vat2, L.tintA, L.tintB, L.tintC]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, L.n * 4);
        at.needsUpdate = true;
      }
      L.fade.clearUpdateRanges();
      L.fade.addUpdateRange(0, L.n);
      L.fade.needsUpdate = true;
    }
    this.leads!.count = leadN;
    if (leadN) { this.leads!.instanceMatrix.needsUpdate = true; leadCol.needsUpdate = true; }
    // forget people we haven't seen for a while
    if (this.vis.size > 6000) for (const [s, v] of this.vis) if (this.frame - v.seen > 120) this.vis.delete(s);
    // shadows from the middle distance only on high
    for (const k of this.chars) if (k.lods[1]) k.lods[1].mesh.castShadow = Q.shadow1;
  }

  /**
   * The walk cycle for a speed: stroll, walk and brisk blended by how fast this person goes (each
   * clip's natural pace is stride x scale / cycle), all on one shared stride so the feet stay put.
   */
  private gait(c: CharMeta, act: string, speed: number, scale: number, dist: number, offset: number, out: number[]) {
    out[6] = 0;
    if (act === "jog" && c.clips.jog) {
      const j = c.clips.jog;
      this.frames(c, j, dist / (j.stride * scale) + offset, out, 0);
      return;
    }
    const S = c.clips.stroll, W = c.clips.walk, B = c.clips.brisk;
    const pace = (k: Clip) => (k.stride * scale) / k.seconds;
    let A = W, Bc: Clip | null = null, w = 0;
    if (speed <= pace(W)) { A = S; Bc = W; w = smooth(pace(S) * 0.95, pace(W), speed); }
    else if (B) { A = W; Bc = B; w = smooth(pace(W), pace(B) * 1.02, speed); }
    const stride = (A.stride + ((Bc ?? A).stride - A.stride) * w) * scale;
    const cyc = dist / stride + offset;
    if (!Bc || w < 0.01) { this.frames(c, A, cyc, out, 0); return; }
    if (w > 0.99) { this.frames(c, Bc, cyc, out, 0); return; }
    this.frames(c, A, cyc, out, 0);
    this.frames(c, Bc, cyc, out, 3);
    out[6] = w;
  }

  /** Names of the character meshes and dog breeds (in pet index order), once loaded. */
  get variants() {
    return { characters: this.chars.map((k) => k.meta.name), dogs: this.dogs.map((k) => (k.meta as DogMeta).breed) };
  }
}

/** a pack's dogs vary a little in size */
function L2(base: number, i: number, seed: number) { return i === 0 ? base : 0.85 + hash(seed * 11 + i) * 0.3; }

/** A New York hot dog cart: steel box on wheels, a striped umbrella (about 2 m long, facing +z along the kerb). */
function cartGeometry(): THREE.BufferGeometry {
  const col = (g: THREE.BufferGeometry, hex: number) => {
    g = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  };
  const parts: THREE.BufferGeometry[] = [
    col(new THREE.BoxGeometry(0.9, 0.75, 1.7).translate(0, 0.62, 0), 0xb8bec4),              // steel body
    col(new THREE.BoxGeometry(0.92, 0.08, 1.72).translate(0, 1.02, 0), 0x8a9096),           // counter
    col(new THREE.BoxGeometry(0.6, 0.22, 0.5).translate(0, 1.17, -0.45), 0xd8dde0),          // steam box
    col(new THREE.BoxGeometry(0.94, 0.28, 0.9).translate(0, 0.7, 0.2), 0x2a5ab0),            // side panel (blue)
    col(new THREE.BoxGeometry(0.95, 0.12, 0.5).translate(0, 0.42, 0.3), 0xe0b23a),           // sign stripe (yellow)
    col(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12).rotateZ(Math.PI / 2).translate(0.44, 0.22, -0.55), 0x1a1a1a),
    col(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12).rotateZ(Math.PI / 2).translate(-0.44, 0.22, -0.55), 0x1a1a1a),
    col(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6).translate(0, 1.75, 0.1), 0x6a6a6a),  // umbrella pole
    col(new THREE.BoxGeometry(0.08, 0.6, 0.08).translate(0, 0.3, 0.8), 0x5a5a5a),            // handle leg
  ];
  // the umbrella: alternating blue and yellow gores
  for (let i = 0; i < 8; i++) {
    const g = new THREE.ConeGeometry(1.15, 0.45, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4).translate(0, 2.55, 0.1);
    parts.push(col(g, i % 2 ? 0xe0b23a : 0x2a5ab0));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** A brownstone stoop's bottom steps (people sit on the top one, 0.42 m up), facing +z (the street). */
function stoopGeometry(): THREE.BufferGeometry {
  const col = (g: THREE.BufferGeometry, hex: number) => {
    g = g.toNonIndexed();
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  };
  return mergeGeometries([
    col(new THREE.BoxGeometry(1.7, 0.42, 0.75).translate(0, 0.21, -0.05), 0x6a4a3a),
    col(new THREE.BoxGeometry(1.7, 0.21, 0.35).translate(0, 0.105, 0.5), 0x7a5644),
    // iron railings: a sloping hand rail on two posts each side
    ...[0.88, -0.88].flatMap((x) => [
      col(new THREE.BoxGeometry(0.04, 0.04, 1.15).rotateX(-0.35).translate(x, 0.95, 0.05), 0x1a1a1a),
      col(new THREE.BoxGeometry(0.035, 0.75, 0.035).translate(x, 0.55, 0.62), 0x1a1a1a),
      col(new THREE.BoxGeometry(0.035, 1.15, 0.035).translate(x, 0.75, -0.4), 0x1a1a1a),
    ]),
  ])!;
}

/** people_vat.bin -> RGBA16UI texel data (see people.json vatTexture.file). */
async function decodeVat(buf: ArrayBuffer, W: number, H: number, blocks: [number, number, number][]): Promise<Uint16Array> {
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(ds).arrayBuffer());
  }
  const out = new Uint16Array(W * H * 4);
  let off = 0;
  for (const [base, F, V] of blocks) {
    const n = 5 * F * V;
    const lo = off, hi = off + n;
    off += 2 * n;
    for (let ch = 0; ch < 5; ch++) {
      for (let v = 0; v < V; v++) {
        let x0 = 0, x1 = 0;
        for (let f = 0; f < F; f++) {
          const idx = (ch * F + f) * V + v;
          const z = bytes[lo + idx] | (bytes[hi + idx] << 8);
          const d = z & 1 ? -((z + 1) >> 1) : z >> 1;
          let x: number;
          if (f === 0) x = d & 0xffff;
          else if (f === 1) x = (d + x1) & 0xffff;
          else x = (d + 2 * x1 - x0) & 0xffff;
          x0 = x1; x1 = x;
          const t = (base + f * V + v) * 4;
          if (ch < 3) out[t + ch] = x;
          else if (ch === 3) out[t + 3] = (out[t + 3] & 0xff00) | (x & 0xff);
          else out[t + 3] = (out[t + 3] & 0x00ff) | ((x & 0xff) << 8);
        }
      }
    }
  }
  return out;
}
