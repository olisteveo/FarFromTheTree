// Pedestrians (and their dogs) drawn with vertex animation textures.
//
// Every character / dog is one InstancedMesh. Each frame of each baked clip (walk, stroll, idle,
// flinch; dogs: walk, idle) is a row of texels in one RGBA16UI texture: xyz = quantised position,
// w = octahedral normal. The vertex shader fetches the two frames around the instance's playhead
// and blends them, so hundreds of walkers cost one draw call per character type.
//
// Assets (built by web/tools/people/build_people.py): models/people.json, people.glb,
// people_vat.bin (gzip), people_atlas.png.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface PeopleWalker {
  x: number; z: number; tx: number; tz: number;
  /** metres along the walker's path (unused for timing: time * speed drives the cycle, see update) */
  phase: number;
  speed: number; seed: number; h: number;
  idle?: boolean;
  /** seconds since a leaf whooshed past (plays the flinch-and-look-up clip while < ~1.1 s) */
  flinch?: number;
  /** dog breed index (0 labrador, 1 terrier, 2 dachshund, 3 pug; taken modulo the breeds available) */
  pet?: number;
  /** ground height under the walker (defaults to PeopleView.groundY) */
  y?: number;
}

interface Clip { base: number; frames: number; loop: boolean; seconds: number; stride: number }
interface MeshMeta {
  name: string; verts: number; boundsMin: number[]; boundsMax: number[];
  anchors: Record<string, number>; clips: Record<string, Clip>;
}
interface CharMeta extends MeshMeta {
  height: number; kid: boolean; pair: boolean; old: boolean; stroller: boolean;
  face: number; faceGroup: string; kidFace: number; hat: boolean; scarf: boolean; coatTint: boolean;
  props: string[]; leadSide: number;
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

/** One instanced draw: a character or a dog breed. */
interface Kind {
  meta: MeshMeta;
  mesh: THREE.InstancedMesh;
  vat: THREE.InstancedBufferAttribute;   // baseA, baseB, blend, hat on
  tintA: THREE.InstancedBufferAttribute; // coat rgb, scarf hue
  tintB: THREE.InstancedBufferAttribute; // accessory rgb, face index
  tintC: THREE.InstancedBufferAttribute; // hair rgb, child face index
  n: number;
  min: THREE.Vector3; range: THREE.Vector3;
}

/** Per-walker look, chosen once from the seed. */
interface Look {
  kind: number; scale: number; offset: number; stroll: boolean;
  tintA: THREE.Color; tintB: THREE.Color; tintC: THREE.Color;
  scarfHue: number; face: number; kidFace: number; hat: number;
  dogScale: number; dogOffset: number; dogFur: THREE.Color; dogCoat: THREE.Color; collar: THREE.Color; lead: THREE.Color;
}

const hash = (n: number) => {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
};
const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// winter palettes (sRGB hex; THREE.Color keeps them linear)
const COATS = [0x1d2230, 0x111214, 0x2e3033, 0x4a4c50, 0x7b5a3a, 0xa8865c, 0x3c4a2e, 0x24382a, 0x5a1e22, 0x7a2626, 0x2a3f5c,
  0x3b5f7a, 0x9aa3ab, 0xc9c1b0, 0x5d3a52, 0x8a6a2a, 0x1f4a4a, 0xb04a2a, 0x6b7c8a, 0x403028];
const ACCENTS = [0xc0392b, 0xe0b23a, 0x2f6fb0, 0xe8e2d4, 0x3f8a4a, 0x8e4a9a, 0xe0782a, 0x2a2a2e, 0xd04a6a, 0x5aa0c8,
  0xd8d040, 0x7a4a2a, 0xf0a0b0, 0x40a0a0, 0xffffff, 0x223355];
const DOG_FUR = [0xf2e6c8, 0xe6c07a, 0xd9a050, 0x2a2420, 0x5a3a24];   // cream, golden, fox red, black, chocolate
const CHAR_WEIGHT: Record<string, number> = { kid: 0.3, parent_kid: 0.45, stroller: 0.4, hivis: 0.45, courier: 0.6, tourist: 0.7 };

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
attribute vec4 aTintA;
attribute vec4 aTintB;
attribute vec4 aTintC;
varying vec4 vMask;
varying vec3 vTintA;
varying vec3 vTintB;
varying vec3 vTintC;
varying float vScarfHue;
vec3 vatP(uvec4 t) { return uMin + vec3(t.xyz) / uPosMax * uRange; }
vec3 vatN(uint w) {
  vec2 e = vec2(float(w & 255u), float(w >> 8u)) / 255.0 * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
`;
const VAT_FETCH = /* glsl */ `
  int vatId = int(_vatid + 0.5);
  int ia = int(aVat.x + 0.5) + vatId;
  int ib = int(aVat.y + 0.5) + vatId;
  uvec4 ta = texelFetch(uVat, ivec2(ia % uVatW, ia / uVatW), 0);
  uvec4 tb = texelFetch(uVat, ivec2(ib % uVatW, ib / uVatW), 0);
  vec3 vatPos = mix(vatP(ta), vatP(tb), aVat.z);
  float vatFlag = floor(aMask.a * 8.0 + 0.5);
  if (vatFlag == 2.0 && aVat.w < 0.5) vatPos = vec3(0.0);   // hat off: collapse it
`;

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, withNormals: boolean) {
  shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\n" + VERT_HEAD);
  if (withNormals) {
    shader.vertexShader = shader.vertexShader
      .replace("#include <beginnormal_vertex>", VAT_FETCH + `
  vec3 objectNormal = normalize(mix(vatN(ta.w), vatN(tb.w), aVat.z));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(1.0, 0.0, 0.0);
  #endif`)
      .replace("#include <begin_vertex>", "vec3 transformed = vatPos;")
      .replace("#include <uv_vertex>", `#include <uv_vertex>
  vMask = aMask;
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
vec3 hueShift(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float h = atan(yiq.z, yiq.y) + a, ch = length(yiq.yz);
  return max(toRGB * vec3(yiq.x, ch * cos(h), ch * sin(h)), 0.0);
}
`;
const FRAG_TINT = /* glsl */ `#include <map_fragment>
  {
    vec3 g = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * uTintGain;
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintA, vMask.r);
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintB, vMask.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, g * vTintC, vMask.b);
    if (abs(vMask.a * 8.0 - 3.0) < 0.5) diffuseColor.rgb = hueShift(diffuseColor.rgb, vScarfHue);
  }`;

export class PeopleView {
  readonly root = new THREE.Group();
  /** sidewalk top (the crowd walks on the kerb-height pavement) */
  groundY = 0.15;
  /** where people.json & co live, relative to the page */
  baseUrl = "./models/";
  /** max instances per character type (and per dog breed) */
  readonly capacity: number;
  private chars: Kind[] = [];
  private dogs: Kind[] = [];
  private looks = new Map<number, Look>();
  private json?: PeopleJson;
  private vatData?: Uint16Array;
  private posMax = 4095;
  private charWeights: number[] = [];
  private faceGroups = new Map<string, number[]>();
  private leads?: THREE.InstancedMesh;
  private loaded = false;
  // scratch
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3(); private p = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);

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
    const make = (meta: MeshMeta, face0: number, face1: number): Kind => {
      const geo = geoms.get(meta.name)!.clone();
      const col = geo.getAttribute("color");
      geo.setAttribute("aMask", col);
      geo.deleteAttribute("color");
      const cap = this.capacity;
      const vat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const tintA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const tintB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const tintC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aVat", vat);
      geo.setAttribute("aTintA", tintA);
      geo.setAttribute("aTintB", tintB);
      geo.setAttribute("aTintC", tintC);
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
          .replace("#include <map_fragment>", FRAG_TINT);
      };
      mat.customProgramCacheKey = () => "fftt-people-vat";
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, uniforms); patchVertex(sh, false); };
      depth.customProgramCacheKey = () => "fftt-people-vat-depth";
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.customDepthMaterial = depth;
      mesh.name = meta.name;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return { meta, mesh, vat, tintA, tintB, tintC, n: 0, min, range };
    };
    this.chars = json.characters.map((c) => make(c, c.face, c.kidFace));
    this.dogs = json.dogs.map((d) => make(d, 0, 0));
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

  /** The look (character, colours, face, hat...) for a seed: deterministic. */
  /** kid: the crowd made this walker a child (short): always the lone kid, and never for adults */
  private look(seed: number, kid = false): Look {
    let L = this.looks.get(seed);
    if (L) return L;
    const r = (k: number) => hash(seed * 7919 + k * 104729);
    const chars = this.json!.characters;
    const lone = (i: number) => chars[i].kid && !chars[i].pair;
    const w = this.charWeights.map((x, i) => (kid ? (lone(i) ? 1 : 0) : lone(i) ? 0 : x));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let pick = r(1) * tot, kind = 0;
    for (; kind < w.length - 1; kind++) { pick -= w[kind]; if (pick < 0 && w[kind] > 0) break; }
    const c = this.json!.characters[kind];
    const faces = this.json!.atlasLayout.faces;
    const group = this.faceGroups.get(c.faceGroup) ?? [c.face];
    const face = r(2) < 0.4 ? c.face : group[Math.floor(r(3) * group.length) % group.length];
    const kids = this.faceGroups.get("kid") ?? [0];
    const kidFace = c.kidFace >= 0 ? kids[Math.floor(r(4) * kids.length) % kids.length] : 0;
    const hair = faces[face].hair;
    const tintC = new THREE.Color().setRGB(hair[0], hair[1], hair[2], THREE.SRGBColorSpace);
    L = {
      kind, scale: 1, offset: r(5), stroll: c.old || (r(6) < 0.25),
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
  private frames(meta: MeshMeta, clip: Clip, cyc: number, out: number[]) {
    const F = clip.frames, V = meta.verts;
    let fa: number, fb: number, t: number;
    if (clip.loop) {
      const f = (cyc - Math.floor(cyc)) * F;
      fa = Math.floor(f) % F; fb = (fa + 1) % F; t = f - Math.floor(f);
    } else {
      const f = Math.min(1, Math.max(0, cyc)) * (F - 1);
      fa = Math.floor(f); fb = Math.min(F - 1, fa + 1); t = f - fa;
    }
    out[0] = clip.base + fa * V; out[1] = clip.base + fb * V; out[2] = t;
  }

  /** CPU decode of one baked vertex (for lead anchors), in the mesh's local space */
  private vertexAt(k: Kind, vat: number[], vid: number, out: THREE.Vector3) {
    const d = this.vatData!, pm = this.posMax;
    const ia = (vat[0] + vid) * 4, ib = (vat[1] + vid) * 4, t = vat[2];
    out.set(
      k.min.x + ((d[ia] + (d[ib] - d[ia]) * t) / pm) * k.range.x,
      k.min.y + ((d[ia + 1] + (d[ib + 1] - d[ia + 1]) * t) / pm) * k.range.y,
      k.min.z + ((d[ia + 2] + (d[ib + 2] - d[ia + 2]) * t) / pm) * k.range.z,
    );
    return out;
  }

  /**
   * Draw this frame's walkers. `time` is the shared clock in seconds. A walker's cycle advances by
   * speed / stride per second, so feet stay planted whichever way it walks along its path.
   */
  update(walkers: PeopleWalker[], time: number) {
    if (!this.loaded) return;
    for (const k of this.chars) k.n = 0;
    for (const k of this.dogs) k.n = 0;
    let leadN = 0;
    const fr = [0, 0, 0], frD = [0, 0, 0];
    const hand = new THREE.Vector3(), collar = new THREE.Vector3(), mid = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    const mDog = new THREE.Matrix4();
    const leadCol = this.leads!.instanceColor!;
    for (const w of walkers) {
      const L = this.look(w.seed, w.h < 1.4);
      const k = this.chars[L.kind];
      if (k.n >= this.capacity) continue;
      const c = k.meta as CharMeta;
      // adults take the walker's height; a lone child is scaled relative to an adult of that height
      const scale = c.kid ? w.h / 1.75 : w.h / c.height;
      const gy = w.y ?? this.groundY;
      // pick the clip and the playhead
      let clip: Clip, cyc: number;
      if (w.flinch !== undefined && w.flinch >= 0 && w.flinch < c.clips.flinch.seconds) {
        clip = c.clips.flinch; cyc = w.flinch / clip.seconds;
      } else if (w.idle) {
        clip = c.clips.idle; cyc = time / clip.seconds + L.offset;
      } else {
        clip = L.stroll ? c.clips.stroll : c.clips.walk;
        cyc = (time * w.speed) / (clip.stride * scale) + L.offset;
      }
      this.frames(c, clip, cyc, fr);
      const i = k.n++;
      const yaw = Math.atan2(w.tx, w.tz);
      this.q.setFromAxisAngle(this.Y, yaw);
      this.m.compose(this.p.set(w.x, gy, w.z), this.q, this.s.set(scale, scale, scale));
      k.mesh.setMatrixAt(i, this.m);
      k.vat.setXYZW(i, fr[0], fr[1], fr[2], L.hat);
      k.tintA.setXYZW(i, L.tintA.r, L.tintA.g, L.tintA.b, c.scarf ? L.scarfHue : 0);
      k.tintB.setXYZW(i, L.tintB.r, L.tintB.g, L.tintB.b, L.face);
      k.tintC.setXYZW(i, L.tintC.r, L.tintC.g, L.tintC.b, L.kidFace);

      // ---- the dog, alongside on the lead side and a little ahead
      if (w.pet === undefined || this.dogs.length === 0) continue;
      const dk = this.dogs[((Math.floor(w.pet) % this.dogs.length) + this.dogs.length) % this.dogs.length];
      if (dk.n >= this.capacity) continue;
      const dm = dk.meta as DogMeta;
      const side = c.leadSide || 1;
      const lx = w.tz, lz = -w.tx;                      // the walker's left in world space
      const off = 0.8 * side, ahead = 0.35;
      const dx = w.x + lx * off + w.tx * ahead, dz = w.z + lz * off + w.tz * ahead;
      const ds = L.dogScale;
      let dclip: Clip, dcyc: number;
      if (w.idle) { dclip = dm.clips.idle; dcyc = time / dclip.seconds + L.dogOffset; }
      else { dclip = dm.clips.walk; dcyc = (time * w.speed) / (dclip.stride * ds) + L.dogOffset; }
      this.frames(dm, dclip, dcyc, frD);
      const j = dk.n++;
      mDog.compose(this.p.set(dx, gy, dz), this.q, this.s.set(ds, ds, ds));
      dk.mesh.setMatrixAt(j, mDog);
      dk.vat.setXYZW(j, frD[0], frD[1], frD[2], 1);
      dk.tintA.setXYZW(j, L.dogCoat.r, L.dogCoat.g, L.dogCoat.b, 0);
      dk.tintB.setXYZW(j, L.collar.r, L.collar.g, L.collar.b, 0);
      dk.tintC.setXYZW(j, L.dogFur.r, L.dogFur.g, L.dogFur.b, 0);

      // ---- lead: hand -> collar, three segments with a little sag
      if (leadN + 3 > this.capacity) continue;
      const hv = c.anchors[side > 0 ? "handL" : "handR"];
      this.vertexAt(k, fr, hv, hand).applyMatrix4(this.m);
      this.vertexAt(dk, frD, dm.anchors.collar, collar).applyMatrix4(mDog);
      const dist = hand.distanceTo(collar);
      const sag = Math.max(0.03, 0.22 - dist * 0.12);
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
        leadCol.setXYZ(leadN, L.lead.r, L.lead.g, L.lead.b);
        leadN++;
        prev = a.copy(b);
      }
    }
    for (const k of [...this.chars, ...this.dogs]) {
      k.mesh.count = k.n;
      if (k.n === 0) continue;
      k.mesh.instanceMatrix.clearUpdateRanges();
      k.mesh.instanceMatrix.addUpdateRange(0, k.n * 16);
      k.mesh.instanceMatrix.needsUpdate = true;
      for (const at of [k.vat, k.tintA, k.tintB, k.tintC]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, k.n * 4);
        at.needsUpdate = true;
      }
    }
    this.leads!.count = leadN;
    if (leadN) { this.leads!.instanceMatrix.needsUpdate = true; leadCol.needsUpdate = true; }
  }

  /** Names of the character meshes and dog breeds (in pet index order), once loaded. */
  get variants() {
    return { characters: this.chars.map((k) => k.meta.name), dogs: this.dogs.map((k) => (k.meta as DogMeta).breed) };
  }
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
