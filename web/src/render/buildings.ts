// Real building footprints extruded into textured buildings: facades from the style
// arrays, storefronts on the ground floor, cornices, setbacks on tall prewar and deco
// towers, parapets, and roofs with clutter (water towers, bulkheads, HVAC).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Building, CityData, Poly, Style } from "../world/data";
import { ringArea, inPoly } from "../world/data";
import { SHOP_LAYER, SHOP_W, STYLE_LAYER, TILES, TINTS, LAYERS, type FacadeTextures, type Storefront } from "./facades";

const CHUNK = 280;

// ------------------------------------------------------------------ material

export function buildingMaterial(tex: FacadeTextures): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, envMapIntensity: 1 });
  const grid: THREE.Vector2[] = [];
  for (let i = 0; i < LAYERS; i++) grid.push(new THREE.Vector2(1, 1));
  for (const [st, layer] of Object.entries(STYLE_LAYER)) grid[layer].set(TILES[st as Style].bays, TILES[st as Style].floors);
  for (let i = 8; i < LAYERS; i++) grid[i].set(2, 1);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAlb = { value: tex.albedo };
    sh.uniforms.uNor = { value: tex.normal };
    sh.uniforms.uGrid = { value: grid };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec2 aUvm; attribute vec2 aTan; attribute vec3 aTint; attribute vec4 aInfo; attribute vec4 aMisc;
        varying vec2 vUvm; varying vec3 vTint; varying vec4 vInfo; varying vec4 vMisc; varying vec3 vTanV; varying vec3 vUpV; varying float vY;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vUvm = aUvm; vTint = aTint; vInfo = aInfo; vMisc = aMisc; vY = position.y;
        vTanV = normalize((viewMatrix * vec4(aTan.x, 0.0, aTan.y, 0.0)).xyz);
        vUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb; uniform sampler2DArray uNor; uniform vec2 uGrid[${LAYERS}];
        varying vec2 vUvm; varying vec3 vTint; varying vec4 vInfo; varying vec4 vMisc; varying vec3 vTanV; varying vec3 vUpV; varying float vY;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float gGlass = 0.0; vec3 gEm = vec3(0.0); vec3 gNt = vec3(0.0, 0.0, 1.0); float gKind = 0.0;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          // vMisc: x = top of this wall (cornice), y = lit fraction, z = seed, w = kind (0 wall, 1 roof, 2 parapet inside)
          gKind = vMisc.w;
          if (gKind > 0.5 && gKind < 1.5) {
            // roof: tar and gravel with patches
            float n = vnoise(vUvm * 0.35) * 0.5 + vnoise(vUvm * 2.3) * 0.3 + h21(floor(vUvm * 12.0)) * 0.2;
            vec3 tar = mix(vec3(0.16, 0.155, 0.15), vec3(0.34, 0.32, 0.29), n);
            tar = mix(tar, vec3(0.42, 0.40, 0.37), step(0.82, vnoise(vUvm * 0.12 + vMisc.z)) * 0.6);
            diffuseColor.rgb = tar;
          } else if (gKind > 2.5) {
            diffuseColor.rgb = min(vec3(1.0), vTint * 1.08 + 0.05) * (0.9 + 0.1 * vnoise(vUvm * 3.0));
          } else if (gKind > 1.5) {
            diffuseColor.rgb = vTint * 0.62;
          } else {
            float gH = vInfo.z;
            bool shop = vY < gH && vInfo.w >= 0.0;
            float layer = shop ? vInfo.w : vMisc.y < -0.5 ? 0.0 : floor(vInfo.w < -1.5 ? -vInfo.w - 2.0 : 0.0);
            vec3 tuv;
            if (shop) tuv = vec3(vUvm.x / ${SHOP_W.toFixed(1)}, vY / gH, vInfo.w);
            else tuv = vec3(vUvm.x / vInfo.x, (vY - gH) / vInfo.y, layer);
            vec4 a = texture(uAlb, tuv);
            vec3 nt = texture(uNor, tuv).xyz * 2.0 - 1.0;
            gGlass = a.a;
            vec3 wall = a.rgb * vTint;
            // grime toward the street and soot under the cornice
            float grime = mix(0.78, 1.0, smoothstep(0.0, 14.0, vY)) * mix(0.85, 1.0, smoothstep(vMisc.x - 6.0, vMisc.x - 2.5, vY) * 0.0 + 1.0);
            grime *= 0.9 + 0.2 * vnoise(vec2(vUvm.x * 0.08, vY * 0.03) + vMisc.z);
            vec3 col = mix(wall * grime, a.rgb, gGlass);
            // cornice band at the top of the wall
            float cor = smoothstep(vMisc.x - 1.15, vMisc.x - 1.0, vY);
            float corLine = smoothstep(vMisc.x - 0.45, vMisc.x - 0.38, vY) - smoothstep(vMisc.x - 0.3, vMisc.x - 0.24, vY);
            col = mix(col, min(vec3(1.0), vTint * 1.12 + 0.06) * (1.0 - 0.25 * corLine), cor);
            nt = mix(nt, normalize(vec3(0.0, -0.6 * corLine + 0.25 * cor, 1.0)), cor);
            gGlass *= 1.0 - cor;
            diffuseColor.rgb = col;
            gNt = nt;
            // lit windows: one random light per window cell
            vec2 g = uGrid[int(tuv.z + 0.5)];
            vec2 cell = floor(tuv.xy * g);
            float r = h21(cell + vMisc.z);
            float on = step(r, shop ? 0.75 : vMisc.y) * gGlass;
            vec3 lamp = mix(vec3(1.0, 0.58, 0.28), vec3(1.0, 0.82, 0.55), h21(cell * 1.7 + vMisc.z));
            gEm = lamp * on * (shop ? 0.55 * a.rgb * 2.5 : vec3(0.18 + 0.28 * h21(cell + 7.1)));
          }
        }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        if (gKind < 0.5) {
          vec3 T = normalize(vTanV), B = normalize(vUpV);
          normal = normalize(T * gNt.x + B * gNt.y + normal * gNt.z);
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(gKind > 0.5 && gKind < 1.5 ? 0.95 : 0.86, 0.22, gGlass);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.0, 0.18, gGlass);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEm;`);
  };
  m.customProgramCacheKey = () => "fftt-building";
  return m;
}

// ------------------------------------------------------------------ geometry

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uvm: number[] = []; tan: number[] = [];
  tint: number[] = []; info: number[] = []; misc: number[] = []; idx: number[] = [];
  v = 0;
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, tx: number, tz: number, tint: THREE.Color, info: number[], misc: number[]) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uvm.push(u, w); this.tan.push(tx, tz);
    this.tint.push(tint.r, tint.g, tint.b); this.info.push(...info); this.misc.push(...misc);
    return this.v++;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aUvm", new THREE.Float32BufferAttribute(this.uvm, 2));
    g.setAttribute("aTan", new THREE.Float32BufferAttribute(this.tan, 2));
    g.setAttribute("aTint", new THREE.Float32BufferAttribute(this.tint, 3));
    g.setAttribute("aInfo", new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute("aMisc", new THREE.Float32BufferAttribute(this.misc, 4));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const hash = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

function scaled(p: Poly, cx: number, cz: number, k: number): Poly {
  return p.map((r) => r.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * k : cz + (v - cz) * k)));
}

/** Inset a ring along its vertex normals (for parapets). */
function inset(r: number[], d: number): number[] {
  const n = r.length / 2, out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = r[((i - 1 + n) % n) * 2], az = r[((i - 1 + n) % n) * 2 + 1];
    const bx = r[i * 2], bz = r[i * 2 + 1];
    const cx = r[((i + 1) % n) * 2], cz = r[((i + 1) % n) * 2 + 1];
    const e1x = bx - ax, e1z = bz - az, l1 = Math.hypot(e1x, e1z) || 1;
    const e2x = cx - bx, e2z = cz - bz, l2 = Math.hypot(e2x, e2z) || 1;
    // inward normals of a clockwise ring are (dz, -dx)
    const n1x = e1z / l1, n1z = -e1x / l1, n2x = e2z / l2, n2z = -e2x / l2;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(0.35, mx * n1x + mz * n1z);
    out.push(bx + (mx * d) / cos, bz + (mz * d) / cos);
  }
  return out;
}

function storefrontFor(district: string, style: Style): Storefront {
  if (style === "glass" || style === "modern") return "lobby";
  if (district === "chinatown") return "chinatown";
  if (district === "littleitaly" || district === "village") return style === "castiron" ? "soho" : "generic";
  if (district === "midtown" || district === "columbus" || district === "flatiron") return "midtown";
  return "generic";
}

interface Tier { poly: Poly; y0: number; y1: number; top: boolean }

function tiers(b: Building): Tier[] {
  const tall = (b.style === "deco" && b.h > 70) || (b.style === "prewar" && b.h > 100);
  if (!tall || b.area < 300) return [{ poly: b.poly, y0: 0, y1: b.h, top: true }];
  const r = hash(b.seed);
  const h1 = b.h * (0.5 + r * 0.15), h2 = b.h * (0.78 + r * 0.08);
  return [
    { poly: b.poly, y0: 0, y1: h1, top: false },
    { poly: scaled(b.poly, b.cx, b.cz, 0.8), y0: h1, y1: h2, top: false },
    { poly: scaled(b.poly, b.cx, b.cz, 0.58), y0: h2, y1: b.h, top: true },
  ];
}

const tmpC = new THREE.Color();

function addBuilding(g: GeoBuilder, b: Building, district: string, roofs: RoofSpot[]) {
  const t = TILES[b.style];
  const r = hash(b.seed + 11);
  tmpC.set(TINTS[b.style][Math.floor(r * TINTS[b.style].length)]).convertSRGBToLinear();
  const tint = tmpC.clone();
  const layer = STYLE_LAYER[b.style];
  const sf = storefrontFor(district, b.style);
  const groundH = b.h > 8 ? (b.style === "castiron" ? 4.6 : b.style === "glass" || b.style === "modern" ? 5.5 : 4.4) : 0;
  const lit = district === "midtown" || district === "columbus" ? 0.1 + r * 0.12 : 0.04 + r * 0.1;
  const seed = (b.seed % 997) * 0.731;
  // vInfo: tile W, tile H, ground floor height, storefront layer (or -2-styleLayer for "no shops": encode style layer when no storefront)
  const infoWall = [t.bays * t.bayW, t.floors * t.floorH, groundH, groundH > 0 ? SHOP_LAYER(sf) : -2 - layer];
  for (const tier of tiers(b)) {
    const parapet = tier.top ? 1.1 : 0.6;
    const top = tier.y1 + parapet;
    const infoT = tier.y0 > 0 ? [infoWall[0], infoWall[1], tier.y0 - 0.01, -2 - layer] : infoWall;
    // the shader picks the style layer from info.w when it is <= -2
    for (const ring of tier.poly) {
      const n = ring.length / 2;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2], az = ring[i * 2 + 1];
        const bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        // footprint rings wind clockwise (holes anticlockwise), so (-dz, dx) points out of the solid
        const tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
        const misc = [top, lit, seed, 0];
        const v0 = g.vert(ax, tier.y0, az, nx, 0, nz, u, tier.y0, tx, tz, tint, infoT, misc);
        const v1 = g.vert(bx, tier.y0, bz, nx, 0, nz, u + L, tier.y0, tx, tz, tint, infoT, misc);
        const v2 = g.vert(bx, top, bz, nx, 0, nz, u + L, top, tx, tz, tint, infoT, misc);
        const v3 = g.vert(ax, top, az, nx, 0, nz, u, top, tx, tz, tint, infoT, misc);
        g.idx.push(v0, v1, v2, v0, v2, v3);
        u += L;
      }
    }
    const outer = tier.poly[0];
    // a projecting cornice on the old masonry styles: soffit, face and a sloped top
    if (tier.top && (b.style === "tenement" || b.style === "prewar" || b.style === "castiron" || b.style === "civic") && b.h > 8) {
      const out = inset(outer, -0.55), m = outer.length / 2;
      const yb = top - 1.05, ym = top - 0.6, yt = top - 0.4;
      const miscC = [top, 0, seed, 3];
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = outer[i * 2], az = outer[i * 2 + 1], bx = outer[j * 2], bz = outer[j * 2 + 1];
        const cx = out[i * 2], cz = out[i * 2 + 1], dx2 = out[j * 2], dz2 = out[j * 2 + 1];
        const ex = dx2 - cx, ez = dz2 - cz, L = Math.hypot(ex, ez) || 1, nx = -ez / L, nz = ex / L;
        // soffit (faces down)
        const s0 = g.vert(ax, yb, az, 0, -1, 0, 0, 0, 1, 0, tint, infoT, miscC), s1 = g.vert(bx, yb, bz, 0, -1, 0, 0, 0, 1, 0, tint, infoT, miscC);
        const s2 = g.vert(dx2, yb, dz2, 0, -1, 0, 0, 0, 1, 0, tint, infoT, miscC), s3 = g.vert(cx, yb, cz, 0, -1, 0, 0, 0, 1, 0, tint, infoT, miscC);
        g.idx.push(s0, s1, s2, s0, s2, s3);
        // face
        const f0 = g.vert(cx, yb, cz, nx, 0, nz, 0, 0, ex / L, ez / L, tint, infoT, miscC), f1 = g.vert(dx2, yb, dz2, nx, 0, nz, 0, 0, ex / L, ez / L, tint, infoT, miscC);
        const f2 = g.vert(dx2, ym, dz2, nx, 0, nz, 0, 0, ex / L, ez / L, tint, infoT, miscC), f3 = g.vert(cx, ym, cz, nx, 0, nz, 0, 0, ex / L, ez / L, tint, infoT, miscC);
        g.idx.push(f0, f1, f2, f0, f2, f3);
        // sloped top back to the wall
        const k = Math.SQRT1_2;
        const t0 = g.vert(cx, ym, cz, nx * k, k, nz * k, 0, 0, ex / L, ez / L, tint, infoT, miscC), t1 = g.vert(dx2, ym, dz2, nx * k, k, nz * k, 0, 0, ex / L, ez / L, tint, infoT, miscC);
        const t2 = g.vert(bx, yt, bz, nx * k, k, nz * k, 0, 0, ex / L, ez / L, tint, infoT, miscC), t3 = g.vert(ax, yt, az, nx * k, k, nz * k, 0, 0, ex / L, ez / L, tint, infoT, miscC);
        g.idx.push(t0, t1, t2, t0, t2, t3);
      }
    }
    // parapet: cap and the inside face, then the roof slab inset from the wall
    const inner = inset(outer, 0.35);
    const n = outer.length / 2;
    const miscP = [top, 0, seed, 2];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ox0 = outer[i * 2], oz0 = outer[i * 2 + 1], ox1 = outer[j * 2], oz1 = outer[j * 2 + 1];
      const ix0 = inner[i * 2], iz0 = inner[i * 2 + 1], ix1 = inner[j * 2], iz1 = inner[j * 2 + 1];
      // cap
      const c0 = g.vert(ox0, top, oz0, 0, 1, 0, 0, 0, 1, 0, tint, infoT, miscP);
      const c1 = g.vert(ox1, top, oz1, 0, 1, 0, 0, 0, 1, 0, tint, infoT, miscP);
      const c2 = g.vert(ix1, top, iz1, 0, 1, 0, 0, 0, 1, 0, tint, infoT, miscP);
      const c3 = g.vert(ix0, top, iz0, 0, 1, 0, 0, 0, 1, 0, tint, infoT, miscP);
      g.idx.push(c0, c1, c2, c0, c2, c3);
      // inner face (faces into the roof)
      const dx = ix1 - ix0, dz = iz1 - iz0, L = Math.hypot(dx, dz) || 1;
      const nx = dz / L, nz = -dx / L; // faces into the roof
      const f0 = g.vert(ix0, tier.y1, iz0, nx, 0, nz, 0, 0, dx / L, dz / L, tint, infoT, miscP);
      const f1 = g.vert(ix1, tier.y1, iz1, nx, 0, nz, 0, 0, dx / L, dz / L, tint, infoT, miscP);
      const f2 = g.vert(ix1, top, iz1, nx, 0, nz, 0, 0, dx / L, dz / L, tint, infoT, miscP);
      const f3 = g.vert(ix0, top, iz0, nx, 0, nz, 0, 0, dx / L, dz / L, tint, infoT, miscP);
      g.idx.push(f0, f2, f1, f0, f3, f2);
    }
    // roof slab
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < inner.length; i += 2) contour.push(new THREE.Vector2(inner[i], inner[i + 1]));
    const holes = tier.poly.slice(1).map((h) => { const v: THREE.Vector2[] = []; for (let i = 0; i < h.length; i += 2) v.push(new THREE.Vector2(h[i], h[i + 1])); return v; });
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...contour, ...holes.flat()];
    const base = g.v;
    const miscR = [top, 0, seed, 1];
    for (const p of all) g.vert(p.x, tier.y1, p.y, 0, 1, 0, p.x, p.y, 1, 0, tint, infoT, miscR);
    for (const f of faces) g.idx.push(base + f[0], base + f[2], base + f[1]);
    if (tier.top) roofs.push({ b, poly: tier.poly, y: tier.y1, district });
  }
}

// ------------------------------------------------------------------ roof clutter

interface RoofSpot { b: Building; poly: Poly; y: number; district: string }

function vc(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const col = new THREE.Color(c), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g.index ? g.toNonIndexed() : g;
}
const bx = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => vc(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), c);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: number, seg = 12) => vc(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z), c);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

/** The rooftop kit: each item is built at unit scale around its own origin (y = roof level). */
const ROOF_KIT = {
  waterTower: merge([
    cyl(1, 1, 3.6, 0, 2.6, 0, 0x6e4c34, 16), vc(new THREE.ConeGeometry(1.08, 0.9, 16).translate(0, 6.65, 0), 0x5a3c28),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => bx(0.12, 2.6, 0.12, a * 0.7, 0, c * 0.7, 0x3a3a3a)),
    bx(1.6, 0.08, 1.6, 0, 2.55, 0, 0x4a4a4a),
    ...[0.9, 1.8, 2.7].map((y) => vc(new THREE.TorusGeometry(1.01, 0.03, 4, 20).rotateX(Math.PI / 2).translate(0, 2.6 + y, 0), 0x2a2a2a)),
  ]),
  steelTank: merge([cyl(1.4, 1.4, 4.2, 0, 1.2, 0, 0xb8bcc0, 18), bx(2.4, 1.2, 2.4, 0, 0, 0, 0x6a6a6a), cyl(0.05, 0.05, 1.2, 1.5, 5.4, 0, 0x6a6a6a, 5)]),
  bulkhead: merge([bx(3, 2.6, 3.4, 0, 0, 0, 0x8c8378), bx(0.9, 2, 0.05, 0.6, 0, 1.72, 0x4a3a2e), bx(3.2, 0.15, 3.6, 0, 2.6, 0, 0x5a554e)]),
  hvacBank: merge([
    ...[-1.6, 0, 1.6].map((x) => bx(1.4, 1.1, 1.4, x, 0, 0, 0x9aa0a4)),
    ...[-1.6, 0, 1.6].map((x) => vc(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16).translate(x, 1.12, 0), 0x2a2a2a)),
    bx(4.6, 0.2, 1.8, 0, 0, 0, 0x5a5a5a),
  ]),
  chimney: merge([bx(0.9, 2.4, 0.7, 0, 0, 0, 0x8a3e30), bx(1.0, 0.18, 0.8, 0, 2.4, 0, 0x6a6058), cyl(0.14, 0.14, 0.5, 0.18, 2.58, 0, 0x5a3a2a, 6), cyl(0.14, 0.14, 0.4, -0.18, 2.58, 0, 0x5a3a2a, 6)]),
  dish: merge([vc(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-1.1).translate(0, 1.0, 0), 0xdcdcd8), cyl(0.04, 0.04, 1, 0, 0, 0, 0x5a5a5a, 5)]),
  skylight: merge([bx(2.4, 0.4, 1.6, 0, 0, 0, 0x6a6058), vc(new THREE.ConeGeometry(1.35, 0.9, 4).rotateY(Math.PI / 4).scale(1, 1, 0.7).translate(0, 0.85, 0), 0x6a8a9a)]),
  mast: merge([cyl(0.06, 0.1, 9, 0, 0, 0, 0x5a5a5a, 6), ...[3, 5, 7].map((y) => bx(1.2, 0.05, 0.05, 0, y, 0, 0x5a5a5a)), vc(new THREE.SphereGeometry(0.12, 6, 4).translate(0, 9.05, 0), 0xff3a2a)]),
  garden: merge([
    bx(5.5, 0.12, 4, 0, 0, 0, 0x7a5a3a),                                      // deck
    ...[-2.2, 2.2].map((x) => bx(0.9, 0.6, 3.6, x, 0.12, 0, 0x5a4a3a)),        // planters
    ...[-2.2, 2.2].map((x) => vc(new THREE.IcosahedronGeometry(0.55, 0).translate(x, 1.2, -1), 0x4a5a2a)),
    ...[-2.2, 2.2].map((x) => cyl(0.05, 0.08, 1.6, x, 0.7, 1, 0x3e342c, 5)),   // little bare trees
    bx(0.8, 0.05, 0.8, 0, 0.75, 0, 0x2a2a2a), cyl(0.04, 0.04, 0.62, 0, 0.12, 0, 0x2a2a2a, 5),     // table
    ...[-0.8, 0.8].map((x) => bx(0.45, 0.06, 0.45, x, 0.55, 0.1, 0xb8a080)),  // chairs
    ...[-0.8, 0.8].map((x) => bx(0.45, 0.5, 0.05, x, 0.6, 0.32, 0xb8a080)),
    ...[-2.7, 2.7].map((x) => cyl(0.03, 0.03, 2.4, x, 0, 1.9, 0x2a2a2a, 4)),  // string light poles
  ]),
  coop: merge([
    bx(2.4, 1.6, 1.6, 0, 0.3, 0, 0xb09070), vc(new THREE.ConeGeometry(1.8, 0.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.75).translate(0, 2.2, 0), 0x6a4a3a),
    bx(2.5, 0.3, 1.7, 0, 0, 0, 0x5a5a5a), bx(1.8, 0.8, 0.04, 0, 0.7, 0.81, 0x3a3a3a),
    bx(3, 0.05, 0.05, 0, 2.5, 1.4, 0x3a3a3a),
  ]),
  solar: merge([...[-1.4, 0, 1.4].map((x) => vc(new THREE.BoxGeometry(1.2, 0.05, 2).rotateX(-0.45).translate(x, 0.6, 0), 0x1f2a44)), bx(4.2, 0.25, 0.2, 0, 0, -0.7, 0x5a5a5a), bx(4.2, 0.6, 0.2, 0, 0, 0.7, 0x5a5a5a)]),
  billboard: merge([
    ...[-3.5, 3.5].map((x) => bx(0.25, 6, 0.25, x, 0, 0, 0x3a3a3a)),
    bx(9, 4.2, 0.2, 0, 6, 0, 0xf0f0f0),                                       // the face (tinted by the instance)
    ...[1, 3, 5].map((y) => bx(7.5, 0.1, 0.1, 0, y, -0.15, 0x3a3a3a)),
  ]),
  gooseneck: merge([cyl(0.12, 0.12, 0.9, 0, 0, 0, 0x8a8a8a, 6), vc(new THREE.TorusGeometry(0.22, 0.12, 6, 8, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.9, 0.22), 0x8a8a8a)]),
  laundry: merge([
    ...[-2, 2].map((x) => cyl(0.04, 0.04, 2, x, 0, 0, 0x5a5a5a, 4)),
    ...[-1.4, -0.7, 0.1, 0.8, 1.5].map((x, i) => vc(new THREE.PlaneGeometry(0.45, 0.6).translate(x, 1.65, 0), [0xc8382a, 0xf0ece0, 0x2a5a9a, 0xe0b423, 0xd27aa2][i])),
  ]),
};
type RoofItem = keyof typeof ROOF_KIT;
const ROOF_FOOTPRINT: Record<RoofItem, number> = { waterTower: 3, steelTank: 3, bulkhead: 2.6, hvacBank: 3, chimney: 1, dish: 1, skylight: 1.6, mast: 0.6, garden: 3.6, coop: 1.8, solar: 2.6, billboard: 5, gooseneck: 0.5, laundry: 2.2 };

/** What goes on a roof, by the building's age, style, district and height. */
function roofPlan(b: Building, district: string, r: (k: number) => number): RoofItem[] {
  const out: RoofItem[] = [];
  const add = (it: RoofItem, chance: number, max = 1) => { for (let i = 0; i < max; i++) if (r(out.length * 7 + i + it.length) < chance) out.push(it); };
  if (b.area > 120) add("bulkhead", 0.85);
  switch (b.style) {
    case "tenement":
      add("chimney", 0.7, 3); add("dish", 0.5, 2); add("gooseneck", 0.6, 2);
      if (district === "chinatown" || district === "littleitaly") { add("coop", 0.22); add("laundry", 0.35); }
      add("waterTower", b.h > 18 ? 0.45 : 0.15);
      break;
    case "castiron":
      add("skylight", 0.6, 2); add("waterTower", 0.45); add("gooseneck", 0.4, 2); add("garden", 0.18);
      break;
    case "prewar": case "deco": case "civic":
      add("waterTower", b.h < 110 ? 0.5 : 0.1); add("garden", district === "village" || district === "littleitaly" ? 0.3 : 0.12);
      add("skylight", 0.25); add("hvacBank", 0.3); add("mast", b.h > 90 ? 0.6 : 0.05);
      break;
    case "brick":
      add("hvacBank", 0.4); add("dish", 0.4, 2); add("garden", 0.15); add("steelTank", 0.15); add("gooseneck", 0.5, 2);
      break;
    case "modern": case "glass":
      add("hvacBank", 0.75, 2); add("steelTank", 0.35); add("solar", 0.3, 2); add("mast", b.h > 70 ? 0.55 : 0.1); add("gooseneck", 0.4, 3);
      break;
  }
  if ((district === "midtown" || district === "columbus") && b.h < 60 && b.area > 250) add("billboard", 0.35);
  return out;
}

const BILLBOARD_TINTS = [0xffd84a, 0x4ad8ff, 0xff4a8a, 0xffffff, 0x8aff6a, 0xff8a3a];

function roofClutter(spots: RoofSpot[]): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15 });
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.0 });
  const lists = new Map<RoofItem, { m: THREE.Matrix4; tint?: number }[]>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (const { b, poly, y, district } of spots) {
    if (b.area < 40) continue;
    const r = (k: number) => hash(b.seed * 31 + k * 977);
    const plan = roofPlan(b, district, r);
    const placed: [number, number, number][] = [];
    const yawBase = (() => { const ring = poly[0]; return Math.atan2(ring[2] - ring[0], ring[3] - ring[1]); })();
    plan.forEach((it, i) => {
      const fp = ROOF_FOOTPRINT[it];
      for (let tries = 0; tries < 10; tries++) {
        const x = b.x0 + fp + (b.x1 - b.x0 - 2 * fp) * r(i * 13 + tries * 3 + 1);
        const z = b.z0 + fp + (b.z1 - b.z0 - 2 * fp) * r(i * 17 + tries * 5 + 2);
        if (b.x1 - b.x0 < 2 * fp || b.z1 - b.z0 < 2 * fp) return;
        const ok = [[0, 0], [fp, 0], [-fp, 0], [0, fp], [0, -fp]].every(([dx, dz]) => inPoly(poly, x + dx, z + dz));
        if (!ok || placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + fp)) continue;
        placed.push([x, z, fp]);
        const yaw = yawBase + (r(i * 29 + tries) < 0.5 ? 0 : Math.PI / 2);
        const k = it === "waterTower" ? 1.6 + r(i * 3) * 1.0 : it === "steelTank" ? 0.9 + r(i * 5) * 0.5 : 1;
        q.setFromAxisAngle(Y, yaw);
        (lists.get(it) ?? lists.set(it, []).get(it)!).push({ m: m.clone().compose(p.set(x, y, z), q, sc.set(k, k, k)), tint: it === "billboard" ? BILLBOARD_TINTS[Math.floor(r(i * 41) * BILLBOARD_TINTS.length)] : undefined });
        return;
      }
    });
  }
  const tint = new THREE.Color();
  for (const [it, list] of lists) {
    const im = new THREE.InstancedMesh(ROOF_KIT[it], it === "billboard" ? glow : mat, list.length);
    list.forEach((e, i) => { im.setMatrixAt(i, e.m); if (e.tint !== undefined) im.setColorAt(i, tint.set(e.tint)); });
    im.castShadow = it !== "gooseneck" && it !== "dish";
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

// ------------------------------------------------------------------ the city's buildings

export class BuildingsMesh {
  readonly root = new THREE.Group();
  readonly chunks: { mesh: THREE.Mesh; clutter: THREE.Group; cx: number; cz: number }[] = [];
  constructor(city: CityData, tex: FacadeTextures) {
    const mat = buildingMaterial(tex);
    const by = new Map<string, Building[]>();
    for (const b of city.buildings) {
      const k = `${Math.floor(b.cx / CHUNK)},${Math.floor(b.cz / CHUNK)}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push(b);
    }
    for (const [k, list] of by) {
      const g = new GeoBuilder();
      const roofs: RoofSpot[] = [];
      for (const b of list) {
        try { addBuilding(g, b, city.district(b.s).id, roofs); } catch { /* skip a broken footprint */ }
      }
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const clutter = roofClutter(roofs);
      const [cx, cz] = k.split(",").map(Number);
      this.chunks.push({ mesh, clutter, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK });
      this.root.add(mesh, clutter);
    }
    // distant skyline: towers outside the playable corridor
    const sky = new GeoBuilder();
    const roofsSky: RoofSpot[] = [];
    city.raw.skyline.forEach((s, i) => {
      const st: Style = s.y >= 1985 ? "glass" : s.y >= 1950 ? "modern" : s.h > 120 ? "deco" : "prewar";
      const bb = { x0: 0, z0: 0, x1: 0, z1: 0 };
      void bb;
      let cx = 0, cz = 0;
      for (let k = 0; k < s.p[0].length; k += 2) { cx += s.p[0][k]; cz += s.p[0][k + 1]; }
      cx /= s.p[0].length / 2; cz /= s.p[0].length / 2;
      const b: Building = { id: -1, poly: s.p, h: s.h, year: s.y, style: st, seed: i * 7919 + 13, s: 0, off: 0, x0: cx, z0: cz, x1: cx, z1: cz, cx, cz, area: Math.abs(ringArea(s.p[0])) };
      try { addBuilding(sky, b, "midtown", roofsSky); } catch { /* skip */ }
    });
    const skyMesh = new THREE.Mesh(sky.build(), mat);
    skyMesh.receiveShadow = true;
    this.root.add(skyMesh);
  }

  /** Roof clutter only near the player. */
  update(focus: THREE.Vector3) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - focus.x, c.cz - focus.z);
      c.clutter.visible = d < 520;
      c.mesh.castShadow = d < 480; // only nearby blocks throw shadows into the shadow map
    }
  }
}
