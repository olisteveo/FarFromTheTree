// Street surface art: the Tesseract-designed textures (tools/ground) and the materials and
// geometry that put them on the ground.
//
// Surfaces (sidewalk flags, asphalt, lawns) are shaded in world space: one shader samples
// the tile textures at world-metre UVs, rotates/flips/swaps sidewalk tiles per 6 m cell on
// slab joints (so the repeat never shows), blends two asphalts or turf and leaf litter
// through a 64 m macro mask, and lays damp darker patches over everything. Kerbs, gutters,
// paint and decals are thin meshes with their own UVs into small atlases, built per 300 m
// chunk so the far ones can be culled.

import * as THREE from "three";
import { Grid, inPoly, type Poly } from "../world/data";

const loader = new THREE.TextureLoader();
let base = "./";

function tex(name: string, srgb: boolean, wrapT = true): THREE.Texture {
  const t = loader.load(new URL("textures/ground/" + name, new URL(base, document.baseURI)).href);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ textures

export interface GroundTextures {
  walkA: THREE.Texture; walkAN: THREE.Texture; walkB: THREE.Texture; walkBN: THREE.Texture;
  roadA: THREE.Texture; roadAN: THREE.Texture; roadB: THREE.Texture; roadBN: THREE.Texture;
  lawnA: THREE.Texture; lawnAN: THREE.Texture; lawnB: THREE.Texture; lawnBN: THREE.Texture;
  strips: THREE.Texture; stripsN: THREE.Texture; paint: THREE.Texture; paintN: THREE.Texture;
  decals: THREE.Texture; decalsN: THREE.Texture; macro: THREE.Texture;
}

/** base: URL of the folder holding textures/ (default: next to the page). */
export function loadGroundTextures(baseUrl = "./"): GroundTextures {
  base = baseUrl;
  const pair = (n: string, wrapT = true): [THREE.Texture, THREE.Texture] => [tex(`${n}_c.webp`, true, wrapT), tex(`${n}_n.webp`, false, wrapT)];
  const [walkA, walkAN] = pair("walk_a"), [walkB, walkBN] = pair("walk_b");
  const [roadA, roadAN] = pair("road_a"), [roadB, roadBN] = pair("road_b");
  const [lawnA, lawnAN] = pair("lawn_a"), [lawnB, lawnBN] = pair("lawn_b");
  const [strips, stripsN] = pair("strips", false), [paint, paintN] = pair("paint", false);
  const [decals, decalsN] = pair("decals", false);
  decals.wrapS = decalsN.wrapS = THREE.ClampToEdgeWrapping;
  const macro = tex("macro.webp", false);
  return { walkA, walkAN, walkB, walkBN, roadA, roadAN, roadB, roadBN, lawnA, lawnAN, lawnB, lawnBN, strips, stripsN, paint, paintN, decals, decalsN, macro };
}

// ------------------------------------------------------------------ the world-space surface shader

export interface SurfaceOpts {
  a: THREE.Texture; an: THREE.Texture; scaleA: number;
  b: THREE.Texture; bn: THREE.Texture; scaleB: number;
  macro: THREE.Texture;
  /** 0: per-cell tile shuffle (sidewalk flags), 1: macro-masked blend of A and B (asphalt, lawn) */
  mode: 0 | 1;
  shareB?: number;                     // mode 0: fraction of cells that use B
  mask?: [number, number, number];     // mode 1: macro channel weights for the A/B mask
  maskRange?: [number, number];
  wet?: number;
  normalScale?: number;
  tint?: number;
  polygonOffset?: number;
}

export function surfaceMaterial(o: SurfaceOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: o.tint ?? 0xffffff });
  if (o.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = o.polygonOffset; m.polygonOffsetUnits = o.polygonOffset; }
  m.defines = { GMODE: o.mode };
  const u = {
    gA: { value: o.a }, gAn: { value: o.an }, gB: { value: o.b }, gBn: { value: o.bn }, gMacro: { value: o.macro },
    gScale: { value: new THREE.Vector2(o.scaleA, o.scaleB) },
    gShareB: { value: o.shareB ?? 0.35 },
    gMask: { value: new THREE.Vector3(...(o.mask ?? [0, 1, 0])) },
    gMaskRange: { value: new THREE.Vector2(...(o.maskRange ?? [0.4, 0.6])) },
    gWet: { value: o.wet ?? 1 },
    gNS: { value: o.normalScale ?? 1 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D gA, gAn, gB, gBn, gMacro;
        uniform vec2 gScale, gMaskRange; uniform vec3 gMask; uniform float gShareB, gWet, gNS;
        varying vec2 vGW;
        vec3 gNW = vec3(0.0, 1.0, 0.0); float gR = 0.9;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace("#include <map_fragment>", `{
        vec4 alb, nr; vec2 nw;
      #if GMODE == 0
        // sidewalk: each tile-sized cell picks a variant, a quarter turn and a flip. Cells
        // break on slab joints, so the seams are invisible; explicit gradients keep the mips.
        vec2 p = vGW / gScale.x;
        vec2 cell = floor(p);
        float h1 = gHash(cell), h2 = gHash(cell + 17.31);
        float k = floor(h1 * 4.0);
        vec2 cs = k < 1.0 ? vec2(1.0, 0.0) : k < 2.0 ? vec2(0.0, 1.0) : k < 3.0 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
        mat2 M = mat2(h2 > 0.5 ? -1.0 : 1.0, 0.0, 0.0, 1.0) * mat2(cs.x, cs.y, -cs.y, cs.x);
        vec2 uv = M * (p - cell - 0.5) + 0.5;
        vec2 gx = M * dFdx(p), gy = M * dFdy(p);
        if (gHash(cell + 3.7) < gShareB) { alb = textureGrad(gB, uv, gx, gy); nr = textureGrad(gBn, uv, gx, gy); }
        else { alb = textureGrad(gA, uv, gx, gy); nr = textureGrad(gAn, uv, gx, gy); }
        nw = transpose(M) * (nr.xy * 2.0 - 1.0);
        float nz = nr.z * 2.0 - 1.0;
      #else
        // asphalt / lawn: two tiles at different periods (B turned a quarter), mixed by the macro mask
        vec2 pa = vGW / gScale.x, pb = vec2(vGW.y, -vGW.x) / gScale.y;
        vec4 aA = texture2D(gA, pa), nA = texture2D(gAn, pa), aB = texture2D(gB, pb), nB = texture2D(gBn, pb);
        vec3 mk = texture2D(gMacro, vGW / 64.0).rgb;
        float lumd = dot(aB.rgb - aA.rgb, vec3(0.3, 0.6, 0.1));
        float t = smoothstep(gMaskRange.x, gMaskRange.y, dot(mk, gMask) + lumd * 0.25);
        alb = mix(aA, aB, t); nr = mix(nA, nB, t);
        vec2 nwA = nA.xy * 2.0 - 1.0, nwB = nB.xy * 2.0 - 1.0;
        nw = mix(nwA, vec2(-nwB.y, nwB.x), t);
        float nz = nr.z * 2.0 - 1.0;
      #endif
        // large-scale grime and damp: breaks the repeat at a distance, and it's November
        vec3 mac = texture2D(gMacro, vGW / 64.0).rgb;
        vec3 mac2 = texture2D(gMacro, vGW.yx / 23.0 + 0.37).rgb;
        float grime = mix(0.88, 1.08, mac.g) * mix(0.94, 1.05, mac2.b);
        float wet = smoothstep(0.64, 0.78, mac.r * 0.7 + mac2.r * 0.3) * gWet;
        diffuseColor.rgb *= alb.rgb * grime * mix(1.0, 0.5, wet);
        gR = mix(nr.a, 0.36, wet);
        nw *= gNS * (1.0 - 0.7 * wet);
        gNW = normalize(vec3(nw.x, max(nz, 0.25), nw.y));
      }`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * gR;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);");
  };
  m.customProgramCacheKey = () => `ground-surface-${o.mode}`;
  return m;
}

/** Atlas-mapped meshes (kerbs, gutters, paint, decals): roughness lives in the normal map's alpha. */
export function atlasMaterial(map: THREE.Texture, nrm: THREE.Texture, o: { transparent?: boolean; offset?: number; vertexColors?: boolean; normalScale?: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map, normalMap: nrm, normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1), roughness: 1, metalness: 0,
    transparent: !!o.transparent, depthWrite: !o.transparent, vertexColors: !!o.vertexColors,
  });
  if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = o.offset; m.polygonOffsetUnits = o.offset; }
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <roughnessmap_fragment>",
      "float roughnessFactor = roughness * max(texture2D(normalMap, vNormalMapUv).a, 0.1);");
  };
  m.customProgramCacheKey = () => "ground-atlas";
  return m;
}

// ------------------------------------------------------------------ atlas layout (tools/ground/ground_design.py)

const A = 1024;
/** Strips atlas rows, in image px top-down: kerb face, kerb cap, gutter, hex pavers. 4 m per u. */
export const ROW = { face: [0, 160], cap: [160, 384], gutter: [384, 768], hex: [768, 1024] } as const;
export const rowV = (row: readonly [number, number], t: number) => 1 - (row[0] + (row[1] - row[0]) * t) / A;
export const STRIP_M = 4;

/** Decal atlas cells (x, y, w, h) in px. */
export const CELL = {
  sewer: [0, 0, 256, 256], coned: [256, 0, 256, 256], valves: [512, 0, 256, 256], oil_a: [768, 0, 256, 256],
  plate: [0, 256, 256, 256], cut: [256, 256, 256, 256], oil_b: [512, 256, 256, 256], leaves: [768, 256, 256, 256],
  grate: [0, 512, 512, 256], cellar: [512, 512, 256, 256], tactile: [768, 512, 256, 256],
  busonly: [0, 768, 512, 256], polish: [512, 768, 256, 256], drain: [768, 768, 256, 256],
} as const;
export type CellName = keyof typeof CELL;

// ------------------------------------------------------------------ chunked mesh builder

export const CHUNK = 300;

class Batch {
  pos: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = []; nor: number[] = [];
  get n() { return this.pos.length / 3; }
}

/** Collects quads into per-chunk batches of one kind; build() returns one mesh per chunk. */
export class ChunkedQuads {
  readonly chunks = new Map<string, Batch>();
  constructor(readonly colors = false, readonly size = CHUNK) {}
  private batch(x: number, z: number) {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let b = this.chunks.get(k);
    if (!b) this.chunks.set(k, (b = new Batch()));
    return b;
  }
  /** Four corners (x, y, z) with uvs, CCW seen from the front; nrm is the face normal. */
  quad(p: number[], uv: number[], rgba: number[] = [1, 1, 1, 1], nrm: number[] = [0, 1, 0]) {
    const b = this.batch((p[0] + p[6]) / 2, (p[2] + p[8]) / 2);
    const v = b.n;
    b.pos.push(...p);
    b.uv.push(...uv);
    for (let i = 0; i < 4; i++) { b.nor.push(nrm[0], nrm[1], nrm[2]); if (this.colors) b.col.push(rgba[0], rgba[1], rgba[2], rgba[3]); }
    // pick the winding that faces along nrm
    const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] >= 0) b.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    else b.idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
  }
  /** A flat decal: centre, forward (unit, maps to +v), half-sizes along right (u) and forward (v). */
  decal(x: number, y: number, z: number, fx: number, fz: number, hu: number, hv: number, cell: readonly number[], rgba?: number[], sub?: [number, number, number, number]) {
    const rx = -fz, rz = fx; // screen-right when looking along forward from above, so text reads correctly
    const [cx, cy, cw, ch] = cell;
    const s = sub ?? [0, 0, 1, 1];
    const pad = 1.5;
    const u0 = (cx + cw * s[0] + pad) / A, u1 = (cx + cw * s[2] - pad) / A;
    const v0 = 1 - (cy + ch * s[3] - pad) / A, v1 = 1 - (cy + ch * s[1] + pad) / A;   // image bottom -> near
    const p = (su: number, sv: number) => [x + rx * hu * su + fx * hv * sv, y, z + rz * hu * su + fz * hv * sv];
    this.quad([...p(-1, -1), ...p(1, -1), ...p(1, 1), ...p(-1, 1)], [u0, v0, u1, v0, u1, v1, u0, v1], rgba);
  }
  build(mat: THREE.Material, opts: { shadow?: boolean; order?: number } = {}): { mesh: THREE.Mesh; cx: number; cz: number }[] {
    const out: { mesh: THREE.Mesh; cx: number; cz: number }[] = [];
    for (const [k, b] of this.chunks) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      if (this.colors) g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 4));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = !!opts.shadow;
      if (opts.order) mesh.renderOrder = opts.order;
      const [cx, cz] = k.split(",").map(Number);
      out.push({ mesh, cx: (cx + 0.5) * this.size, cz: (cz + 0.5) * this.size });
    }
    return out;
  }
}

// ------------------------------------------------------------------ polygon lookups

export class PolyIndex {
  private grid = new Grid<Poly>(48);
  constructor(polys: Poly[]) {
    for (const p of polys) {
      const r = p[0];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
      this.grid.add(p, x0, z0, x1, z1);
    }
  }
  has(x: number, z: number) {
    for (const p of this.grid.at(x, z)) if (inPoly(p, x, z)) return true;
    return false;
  }
}

/** Outward unit normals per edge of a ring, whatever its winding. */
export function ringNormals(r: number[]): { nx: number[]; nz: number[]; L: number[] } {
  const n = r.length / 2, nx: number[] = [], nz: number[] = [], L: number[] = [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[((i + 1) % n) * 2], bz = r[((i + 1) % n) * 2 + 1];
    area += ax * bz - bx * az;
  }
  // shoelace > 0: anticlockwise in (x, z), so the outward normal of edge (dx, dz) is (dz, -dx)
  const s = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[((i + 1) % n) * 2], bz = r[((i + 1) % n) * 2 + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1e-6;
    nx.push((s * (bz - az)) / l); nz.push((-s * (bx - ax)) / l); L.push(l);
  }
  return { nx, nz, L };
}
