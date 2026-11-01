// Real building footprints extruded into textured buildings. Walls sample Tesseract-designed
// facade layers (facades.ts) with a per-building variant, per-band offsets, per-building tint
// (brick / stone / paint; trim and glass stay their own colour), grime toward the street and
// rain streaks, and a room behind every clear window pane (interior mapping). Walls that
// face a neighbour become blank party walls; only street fronts get shops, cornices and the
// kit (fire escapes, brackets, awnings, canopies, blade signs: architectureKit.ts). Roofs get
// tar / gravel / membrane and real rooftop clutter. Everything is chunked and culled by
// distance; setDrawDistance() hands the far distance to farCity.ts.

import * as THREE from "three";
import type { Building, CityData, Poly, Style } from "../world/data";
import { ringArea, inPoly } from "../world/data";
import type { Facades, FacadeProp } from "../world/facades";
import {
  FACADE_LAYERS, LAYERS, PARTY_LAYERS, ROOF_LAYERS, SHOP_LAYERS, SHOP_W, STYLE_LAYERS, TILES, TINTS,
  type FacadeTextures, type Storefront, type FacadeQuality,
} from "./facades";
import { ArchitectureKit } from "./architectureKit";
import { facadeRegistry } from "./facadeProps";
import { householdOf, inHeroBlock, pick } from "../world/heroBlock";
import { loadKitModels } from "./architectureModels";
import { sunDirection } from "./sun";
import { REFLECT_GLSL } from "./reflections";
import { LotsView } from "./architectureLots";
import { isModelled } from "../world/modelled";

const CHUNK = 280;

// ------------------------------------------------------------------ material

/** debug view for the facade shader: 0 off, 1 alpha (what each pixel is), 2 roughness, 3 normal xy, 4 emissive */
export const DEBUG = { value: 0 };
/** The detail edge: buildings fade out over the last FADE metres before the draw distance with an ordered
 *  4x4 dither (pixel discarded when bayer(gl_FragCoord) < fade). farCity.ts can draw the complement
 *  (keep a pixel only when bayer < fade) for a seamless hand-over. */
export const DRAW_EDGE = { value: new THREE.Vector2(900, 60) };
/** The weathering pass on the walls (tools/buildings/wall_wear.mjs): 0 turns it off, to compare look and cost. */
export const WEAR = { value: 1 };

/** Where each district's shops are on the sheet, [first, count]: keep in step with tools/buildings/shop_fronts.mjs. */
const SHOP_SHEET = { generic: "vec2(0.0, 32.0)", chinatown: "vec2(32.0, 10.0)", soho: "vec2(42.0, 10.0)", midtown: "vec2(52.0, 8.0)", lobby: "vec2(60.0, 4.0)" };

function dataTexture(name: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(`${location.pathname.includes("/tools/") ? "/" : "./"}textures/buildings/${name}.webp`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildingMaterial(tex: FacadeTextures): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, envMapIntensity: 1 });
  // per layer: bays, floors, reflectivity, room depth
  const grid: THREE.Vector4[] = FACADE_LAYERS.map((l) => new THREE.Vector4(l.bays, l.floors, /^glass/.test(l.name) ? 1 : 0, /^glass|^modern/.test(l.name) ? 6 : 4));
  const uAlb = { value: tex.albedo }, uNor = { value: tex.normal };
  const swap = () => { uAlb.value = tex.albedo; uNor.value = tex.normal; };
  tex.onSwap = swap;
  tex.ready.then(swap);
  const interior = tex.quality !== "low";
  const wearMaps = interior ? { uWearMap: { value: dataTexture("wear") }, uGrain: { value: dataTexture("grain") }, uSun: { value: sunDirection() }, uShopSheet: { value: null as THREE.Texture | null }, uShopOn: { value: 0 } } : null;
  if (wearMaps) {
    // tools/buildings/shop_fronts.mjs. Until it arrives (and on low quality) the older storefront layers show
    const sheet = new THREE.TextureLoader().load(`${location.pathname.includes("/tools/") ? "/" : "./"}textures/buildings/shops.webp`, () => { wearMaps.uShopOn.value = 1; });
    sheet.colorSpace = THREE.SRGBColorSpace;
    sheet.anisotropy = 16;
    wearMaps.uShopSheet.value = sheet;
  }
  m.onBeforeCompile = (sh) => {
    if (wearMaps) Object.assign(sh.uniforms, wearMaps, { uWear: WEAR });
    sh.uniforms.uAlb = uAlb;
    sh.uniforms.uNor = uNor;
    sh.uniforms.uGrid = { value: grid };
    sh.uniforms.uDebug = DEBUG;
    sh.uniforms.uEdge = DRAW_EDGE;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec2 aUvm; attribute vec2 aTan; attribute vec3 aTint; attribute vec4 aInfo; attribute vec4 aMisc; attribute vec4 aShop;
        varying vec4 vP0; varying vec3 vTint; varying vec4 vInfo; varying vec4 vMisc; varying vec4 vShop; varying vec3 vTanV;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        // few, packed varyings: ANGLE (D3D) mangles them when there are too many
        vP0 = vec4(aUvm, position.y, 0.0); vTint = aTint; vInfo = aInfo; vMisc = aMisc; vShop = aShop;
        vTanV = normalize((viewMatrix * vec4(aTan.x, 0.0, aTan.y, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        ${interior ? "#define FFTT_INTERIOR 1\n#define FFTT_WEAR 1\nuniform sampler2D uWearMap; uniform sampler2D uGrain; uniform float uWear; uniform vec3 uSun; uniform sampler2D uShopSheet; uniform float uShopOn;" : ""}
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb; uniform sampler2DArray uNor; uniform vec4 uGrid[${LAYERS}]; uniform float uDebug; uniform vec2 uEdge;
        float bayer4(vec2 p) { ivec2 q = ivec2(mod(p, 4.0)); int i = q.x + q.y * 4;
          int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }
        varying vec4 vP0; varying vec3 vTint; varying vec4 vInfo; varying vec4 vMisc; varying vec4 vShop; varying vec3 vTanV;
        #define vUvm vP0.xy
        #define vY vP0.z
        #define vUpV normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)
        // a sin-free hash: the sin trick turns the tiny interpolation error of a varying into per-pixel noise on D3D
        float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float gGlass = 0.0; float gRough = 0.85; float gMetal = 0.0; vec3 gEm = vec3(0.0); vec3 gNt = vec3(0.0, 0.0, 1.0); float gKind = 0.0; vec3 gDbg = vec3(0.0);
        // a room behind the glass: ray from the pane into a box the size of the window's bay
        vec3 room(vec2 pc, vec2 cs, vec3 rd, float depth, vec2 cell, float lit) {
          vec3 r = vec3(rd.xy, max(1e-3, -rd.z));
          float tb = depth / r.z;
          float tx = r.x > 0.0 ? (cs.x - pc.x) / r.x : (r.x < 0.0 ? -pc.x / r.x : 1e9);
          float ty = r.y > 0.0 ? (cs.y - pc.y) / r.y : (r.y < 0.0 ? -pc.y / r.y : 1e9);
          float t = min(tb, min(tx, ty));
          vec3 hit = vec3(pc + r.xy * t, r.z * t);
          float k1 = h21(cell * 1.31 + 4.7), k2 = h21(cell * 0.71 + 9.1);
          vec3 wall = mix(vec3(0.78, 0.72, 0.62), vec3(0.62, 0.68, 0.70), k1);
          wall = mix(wall, vec3(0.70, 0.52, 0.42), step(0.8, k2));
          vec3 c;
          if (t == tb) {
            c = wall;
            // furniture against the back wall: a sofa / a shelf / a bed
            float f = step(hit.y, 0.85 + 0.4 * k2) * step(cs.x * (0.15 + 0.3 * k1), hit.x) * step(hit.x, cs.x * (0.65 + 0.3 * k2));
            c = mix(c, mix(vec3(0.30, 0.22, 0.18), vec3(0.20, 0.26, 0.34), k1), f);
            // a picture or a doorway
            float p = step(abs(hit.x - cs.x * (0.3 + 0.4 * k2)), 0.35) * step(abs(hit.y - 1.7), 0.3);
            c = mix(c, vec3(0.35, 0.3, 0.25), p * step(0.5, k1));
          } else if (t == ty) {
            c = r.y < 0.0 ? mix(vec3(0.36, 0.24, 0.15), vec3(0.42, 0.40, 0.38), step(0.6, k1)) : vec3(0.86, 0.84, 0.80);
            if (r.y > 0.0) c += lit * vec3(1.0, 0.8, 0.5) * 0.8 * smoothstep(0.9, 0.0, length(hit.xz - vec2(cs.x * 0.5, depth * 0.5)) / depth);
          } else {
            c = wall * 0.82;
          }
          // deeper is darker, and the light from the window falls off
          c *= mix(1.0, 0.45, clamp(hit.z / depth, 0.0, 1.0));
          return c;
        }
#ifdef FFTT_WEAR
        ${REFLECT_GLSL}
        /** What this pane shows, and how much of it (F). No two panes hang quite flat: that's wobble. */
        vec3 mirrorOf(vec3 viewPos, vec3 viewNormal, vec2 cell, float wobble, float F0, float Fmax, out float F) {
          mat3 toWorld = transpose(mat3(viewMatrix));
          vec3 wV = normalize(toWorld * normalize(viewPos)), wN = normalize(toWorld * normalize(viewNormal));
          vec3 wP = cameraPosition - wV * length(viewPos);
          vec3 lean = vec3(h21(cell + 1.7), h21(cell + 4.3), h21(cell + 7.9)) - 0.5;
          F = min(Fmax, F0 + (1.0 - F0) * pow(1.0 - max(dot(wN, wV), 0.0), 4.0));
          return reflCity(wP, normalize(reflect(-wV, normalize(wN + lean * wobble)))) * (0.93 + 0.14 * h21(cell + 11.3));
        }
#endif`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        if (bayer4(gl_FragCoord.xy) < smoothstep(uEdge.x - uEdge.y, uEdge.x, length(vViewPosition))) discard;
        {
          // vMisc: x = top of this wall (cornice), y = lit fraction, z = seed, w = kind (0 wall, 1 roof, 3 trim)
          // vShop: x = first shop layer, y = shop layer count, z = shop offset (m), w = dirt
          gKind = vMisc.w;
          float SEED = floor(vMisc.z * 16.0 + 0.5) / 16.0;   // varyings drift a hair across a face: snap before hashing
          if (gKind > 0.5 && gKind < 1.5) {
            // roof: tar / gravel / membrane, 8 m tiles
            // each roof shifted and turned so the 8 m tile never lines up from one roof to the next
            float rr = fract(SEED * 7.13);
            vec2 ruv = (rr < 0.5 ? vUvm : vec2(vUvm.y, -vUvm.x)) / 8.0 + vec2(SEED * 0.37, SEED * 0.61);
            float rl = floor(vInfo.w + 0.5);   // ANGLE truncates the layer: round it ourselves
            vec4 a = texture(uAlb, vec3(ruv, rl));
            vec4 n = texture(uNor, vec3(ruv, rl));
            float tintW = 1.0 - smoothstep(0.53, 0.6, a.a);
            float big = vnoise(vUvm * 0.11 + SEED) * 0.5 + vnoise(vUvm * 0.37) * 0.5;
            diffuseColor.rgb = a.rgb * mix(vec3(1.0), vTint, tintW) * (0.82 + 0.3 * big);
            gNt = vec3(n.xy * 2.0 - 1.0, 0.0); gNt.z = sqrt(max(0.0, 1.0 - dot(gNt.xy, gNt.xy)));
            gRough = n.b;
          } else if (gKind > 2.5) {
            // cornices, copings, the band over the shops: solid, lighter, a little weathered
            diffuseColor.rgb = min(vec3(1.0), vTint * 1.04 + 0.03) * (0.85 + 0.15 * vnoise(vUvm * 3.0)) * mix(0.8, 1.0, smoothstep(0.0, 8.0, vY));
            gRough = 0.8;
          } else {
            float gH = vInfo.z;
            bool shop = vY < gH && vShop.y > 0.5;
            vec2 tuv, base;
            float layer;
            vec2 cs, pc, cell;
            vec4 g;
            if (shop) {
              float uu = vUvm.x + vShop.z;
              float tile = floor(uu / ${SHOP_W.toFixed(1)});
              float shopCount = floor(vShop.y), bayW = 3.0 + fract(vShop.y) * 4.0; // (each wall fits a whole number of bays: see edge building)
              layer = vShop.x + min(shopCount - 1.0, floor(h21(vec2(tile, SEED)) * shopCount));
              tuv = vec2(uu / ${SHOP_W.toFixed(1)}, vY / gH);
              base = tuv;
              g = vec4(2.0, 1.0, 0.0, 3.0);
              cs = vec2(bayW, gH); pc = vec2(mod(uu, bayW), vY); cell = vec2(floor(uu / bayW), -1.0);
            } else {
              layer = vInfo.w;
              g = uGrid[int(layer + 0.5)];
              float yy = vY - gH;
              float band = floor(yy / vInfo.y);
              cs = vec2(vInfo.x / g.x, vInfo.y / g.y);
              // every band of floors starts on a different bay, so the tile never stacks up
              float shift = floor(h21(vec2(band, SEED + 3.1)) * g.x) * cs.x;
              tuv = vec2((vUvm.x + shift) / vInfo.x, yy / vInfo.y);
              base = vec2(vUvm.x / vInfo.x, yy / vInfo.y);
              pc = vec2(mod(vUvm.x + shift, cs.x), mod(yy, cs.y));
              cell = floor(vec2(vUvm.x + shift, yy) / cs) + vec2(band * 37.0, 0.0);
            }
            layer = floor(layer + 0.5);   // interpolated layer ids can land a hair under the integer, and ANGLE truncates
            vec2 dx = dFdx(base), dy = dFdy(base);
            vec4 a = textureGrad(uAlb, vec3(tuv, layer), dx, dy);
            vec4 n = textureGrad(uNor, vec3(tuv, layer), dx, dy);
#ifdef FFTT_WEAR
            bool sheetShop = shop && uShopOn * uWear > 0.5 && abs(vShop.x - ${SHOP_LAYERS.residential[0].toFixed(1)}) > 0.5; // (a stoop stays a stoop)
            if (sheetShop) {
              // every shop its own business, from the ranges for this district and sometimes the general run of them
              float kindId = floor(vShop.x + 0.5);
              vec2 range = abs(kindId - ${SHOP_LAYERS.chinatown[0].toFixed(1)}) < 0.5 ? ${SHOP_SHEET.chinatown} : abs(kindId - ${SHOP_LAYERS.soho[0].toFixed(1)}) < 0.5 ? ${SHOP_SHEET.soho} : abs(kindId - ${SHOP_LAYERS.midtown[0].toFixed(1)}) < 0.5 ? ${SHOP_SHEET.midtown} : abs(kindId - ${SHOP_LAYERS.lobby[0].toFixed(1)}) < 0.5 ? ${SHOP_SHEET.lobby} : ${SHOP_SHEET.generic};
              bool lobbyKind = range.y < 5.0;
              float mixR = h21(cell + SEED * 5.1 + 2.0);
              if (!lobbyKind && mixR < 0.35) range = ${SHOP_SHEET.generic};
              float idx = range.x + floor(h21(cell + SEED * 9.7) * range.y);
              // never the same business twice running
              float prev = range.x + floor(h21(cell - vec2(1.0, 0.0) + SEED * 9.7) * range.y);
              if (idx == prev) idx = range.x + mod(idx - range.x + 1.0, range.y);
              vec2 local = vec2(pc.x / cs.x, clamp(vY / gH, 0.0, 1.0));
              const float G = ${(8 / 512).toFixed(6)};
              vec2 corner = vec2(mod(idx, 8.0), floor(idx / 8.0));
              vec2 scaleUv = vec2(1.0 - 2.0 * G) / 8.0;
              vec2 dlx = dFdx(vec2((vUvm.x + vShop.z) / cs.x, vY / gH)) * scaleUv, dly = dFdy(vec2((vUvm.x + vShop.z) / cs.x, vY / gH)) * scaleUv;
              #define SHEET_UV(L) vec2((corner.x + G + clamp(L.x, 0.0, 1.0) * (1.0 - 2.0 * G)) / 8.0, 1.0 - (corner.y + 1.0 - G - clamp(L.y, 0.0, 1.0) * (1.0 - 2.0 * G)) / 8.0)
              a = textureGrad(uShopSheet, SHEET_UV(local), dlx, dly);
              n = vec4(0.5, 0.5, 0.74, 1.0);
              if (a.a > 0.72 && length(vViewPosition) < 140.0) {
                // the display sits back behind the glass: look through to where this line of sight lands 35 cm in
                vec3 V = normalize(vViewPosition), N = normalize(vNormal), T = normalize(vTanV), B = normalize(vUpV);
                vec3 rd = -V;
                vec2 slide = 0.35 * vec2(dot(rd, T), dot(rd, B)) / max(0.25, -dot(rd, N));
                vec4 back = textureGrad(uShopSheet, SHEET_UV((local + slide / vec2(cs.x, gH))), dlx, dly);
                // landing on the frame means we're looking at the reveal: dark, not the frame's paint
                a.rgb = back.a > 0.72 ? back.rgb : a.rgb * 0.2;
              }
            }
#endif
            float tintW = 1.0 - smoothstep(0.53, 0.6, a.a);
            float glassW = smoothstep(0.7, 0.76, a.a);
            float clearW = smoothstep(0.86, 0.95, a.a);
            vec3 wall = a.rgb * mix(vec3(1.0), vTint, tintW);
#ifdef FFTT_WEAR
            vec2 wearGrain = vec2(0.0);
            float wearDark = 1.0;
            vec3 limeCol = vec3(0.0); float limeW = 0.0;
            if (uWear > 0.5) {
              float near = 1.0 - smoothstep(420.0, 760.0, length(vViewPosition)); // gone before the far city takes over
              vec2 wp = vec2(vUvm.x + SEED * 137.0, vY + SEED * 53.0);
              vec3 wBig = texture(uWearMap, wp / 19.0).rgb, wSmall = texture(uWearMap, wp.yx / 7.3 + 0.31).rgb;
              vec3 grain = texture(uGrain, wp / 1.7).rgb;
              // the frames and stone trim are painted by whoever owns the place: most white or cream, some not
              float paint = fract(SEED * 5.77);
              vec3 trimPaint = paint < 0.34 ? vec3(0.96, 0.94, 0.88) : paint < 0.52 ? vec3(0.78, 0.76, 0.70) : paint < 0.68 ? vec3(0.30, 0.38, 0.32) : paint < 0.82 ? vec3(0.42, 0.20, 0.17) : paint < 0.92 ? vec3(0.17, 0.18, 0.20) : vec3(0.60, 0.48, 0.34);
              float trimW = (1.0 - tintW) * (1.0 - smoothstep(0.66, 0.7, a.a));
              wall = mix(wall, a.rgb * trimPaint * 1.12, trimW * near * (shop || g.w > 5.0 ? 0.0 : 1.0));
              // a party wall has had no one looking after it for a hundred years
              float party = step(${PARTY_LAYERS.brick.toFixed(1)}, layer + 0.5) * step(layer, ${PARTY_LAYERS.parge.toFixed(1)} + 0.5);
              float age = (0.45 + 0.75 * vShop.w + party * 0.55) * near;
              float streaks = max(wBig.r, wBig.r * 0.4 + wSmall.g * wSmall.r);
              // what runs down from under each sill: a tongue the width of the window, fading toward the floor below
              float sill = 0.9;
              float under = sill - pc.y;
              float sillStain = 0.0;
              if (!shop && under > 0.0 && under < sill && party < 0.5) {
                float across = abs(pc.x - cs.x * 0.5) / (cs.x * 0.3);
                sillStain = (1.0 - smoothstep(0.7, 1.05, across)) * pow(1.0 - under / sill, 1.4) * (0.35 + 0.65 * wSmall.r + 0.4 * wBig.r) * (0.35 + 0.65 * h21(cell + 5.3));
              }
              wearDark = (1.0 - min(0.62, streaks * 0.55 * age)) * (1.0 - wBig.g * 0.3 * age) * (1.0 - sillStain * 0.5 * near);
              wearDark *= 1.0 - 0.2 * near * h21(vec2(floor(vY / 2.2), floor(vUvm.x / 4.0)) + SEED) * smoothstep(0.55, 0.9, wSmall.g); // a repair that never matched
              limeW = min(0.14, tintW * smoothstep(0.3, 1.0, wSmall.b) * (0.02 + 0.06 * smoothstep(6.0, 0.0, vY) + party * 0.03) * age); // a faint bloom: stronger reads as splashed paint
              limeCol = vec3(0.74, 0.72, 0.65);
              float gritAmt = tintW * (1.0 - glassW);
              wall *= mix(1.0, 0.76 + grain.b * 0.48, gritAmt);
              wearGrain = (grain.rg * 2.0 - 1.0) * 0.55 * gritAmt;
            }
#endif
            // weathering: dirt splashed up from the street, soot under the cornice, rain-washed streaks
            float dirt = vShop.w;
            float grime = mix(0.66, 1.0, smoothstep(0.0, 1.2, vY)) * mix(0.86, 1.0, smoothstep(1.0, 9.0, vY));
            grime *= 1.0 - 0.18 * dirt * smoothstep(vMisc.x - 5.0, vMisc.x - 0.5, vY);
            float streak = vnoise(vec2(vUvm.x * 1.7, vY * 0.035 + SEED)) * vnoise(vec2(vUvm.x * 0.35 + 7.0, vY * 0.012));
            grime *= 1.0 - dirt * 0.28 * smoothstep(0.25, 0.7, streak);
            grime *= 0.93 + 0.12 * vnoise(vec2(vUvm.x * 0.06, vY * 0.05) + SEED);
            vec3 col = wall * mix(grime, 1.0, glassW * 0.6);
            vec3 nt = vec3(n.xy * 2.0 - 1.0, 0.0); nt.z = sqrt(max(0.0, 1.0 - dot(nt.xy, nt.xy)));
#ifdef FFTT_WEAR
            col = mix(mix(col, limeCol, limeW) * wearDark, col, glassW);
            nt = normalize(vec3(nt.xy + wearGrain, nt.z));
#endif
            gRough = n.b;
            gGlass = glassW;
            // lit windows: one random light per window bay
            float r = h21(cell + SEED);
            float lit = step(r, shop ? 0.85 : vMisc.y);
#ifdef FFTT_WEAR
            bool curtain = !shop && g.w > 5.0 && uWear > 0.5;
            if (curtain) lit = step(r, vMisc.y * 0.35); // offices by day: most of it is reflection
#endif
            vec3 lamp = mix(vec3(1.0, 0.58, 0.28), vec3(1.0, 0.82, 0.55), h21(cell * 1.7 + SEED));
            if (shop) {
              // shop interiors: a soft glow by day, a few brightly lit
              float on = step(h21(cell + SEED * 1.7), 0.35);
              gEm = a.rgb * glassW * (0.10 + 0.32 * on);
              col = mix(col, a.rgb * 0.45, glassW);
#ifdef FFTT_WEAR
              if (uWear > 0.5) {
                float F;
                vec3 seen = mirrorOf(vViewPosition, vNormal, cell, 0.035, 0.07, 0.8, F);
                gEm = gEm * (1.0 - F) + seen * F * glassW;
              }
#endif
              gMetal = glassW * 0.1;
              gRough = mix(gRough, 0.12, glassW);
            } else {
              vec3 inside = vec3(0.1);
#ifdef FFTT_INTERIOR
              if (clearW > 0.01) {
                vec3 V = normalize(vViewPosition);
                vec3 N = normalize(vNormal);
                vec3 T = normalize(vTanV), B = normalize(vUpV);
                vec3 rd = -V;
                inside = room(pc, cs, vec3(dot(rd, T), dot(rd, B), dot(rd, N)), g.w * (0.8 + 0.5 * h21(cell + 2.3)), cell, lit);
#ifdef FFTT_WEAR
                if (uWear > 0.5 && g.w < 5.0) { // (not the office towers: on panes that size it's a patchwork)
                  // what's hung in the window: every home's different, and it's the first thing you read from the street
                  float which = h21(cell * 1.3 + SEED + 8.1), shade = h21(cell * 2.1 + SEED);
                  vec3 cloth = shade < 0.4 ? vec3(0.82, 0.78, 0.68) : shade < 0.6 ? vec3(0.62, 0.64, 0.66) : shade < 0.75 ? vec3(0.55, 0.26, 0.20) : shade < 0.88 ? vec3(0.28, 0.36, 0.44) : vec3(0.70, 0.60, 0.34);
                  float fy = pc.y / cs.y, cx = abs(pc.x - cs.x * 0.5) / cs.x;
                  float hung = 0.0;
                  if (which < 0.34) {
                    // a roller blind or venetian, down to wherever it was left
                    hung = step(0.86 - h21(cell + 3.9) * 0.56, fy);
                    cloth *= 0.82 + 0.18 * step(0.5, fract(pc.y * 16.0));
                  } else if (which < 0.62) {
                    // curtains, drawn back to the sides or half closed
                    float gap = 0.05 + 0.2 * h21(cell + 6.1);
                    hung = smoothstep(gap, gap + 0.012, cx);
                    cloth *= 0.8 + 0.2 * sin((pc.x + sin(fy * 9.0 + cell.x) * 0.012) * 58.0);
                  }
                  inside = mix(inside, cloth * (0.45 + 0.75 * lit), hung);
                }
#endif
              }
#endif
              // daylight inside is dim; a lamp makes it glow
              float roomK = 1.0;
              vec3 glassEm = vec3(0.0);
#ifdef FFTT_WEAR
              float spandrel = 0.0;
              if (uWear > 0.5) {
                float F;
                vec3 seen = mirrorOf(vViewPosition, vNormal, cell, curtain ? 0.028 : 0.05, curtain ? mix(0.14, 0.27, g.z) : 0.05, curtain ? 0.72 : 0.6, F);
                float tone = fract(SEED * 3.91);
                vec3 coat = !curtain ? vec3(1.0) : tone < 0.35 ? vec3(0.86, 0.96, 1.04) : tone < 0.6 ? vec3(0.88, 1.0, 0.94) : tone < 0.82 ? vec3(0.88, 0.9, 0.94) : vec3(1.02, 0.9, 0.78);
                vec3 mirror = seen * coat;
                glassEm = mirror * F * glassW;
                roomK = (1.0 - F) * (curtain ? 0.34 : 1.0);
                // the panels between floors are glass too, with nothing lit behind them
                spandrel = (1.0 - glassW) * g.z * step(0.5, tintW + 1.0);
                if (curtain) { col *= mix(1.0, 0.26, spandrel); glassEm += spandrel * mirror * F * 0.3; }
              }
#endif
              gEm = glassEm + roomK * (clearW * inside * mix(vec3(0.11), lamp * 0.85, lit) + (glassW - clearW) * a.rgb * lamp * lit * 0.55);
              col = mix(col, a.rgb * mix(0.35, 0.12, clearW), glassW);
              gMetal = glassW * mix(0.12, 0.55, g.z);
#ifdef FFTT_WEAR
              if (uWear > 0.5) gMetal = glassW * 0.06; // the sky's already in glassEm: this leaves the sun's own glint
#endif
              gRough = mix(gRough, mix(0.08, 0.04, g.z), clearW);
            }
            diffuseColor.rgb = col;
            gNt = normalize(mix(nt, vec3(0.0, 0.0, 1.0), glassW));
            if (uDebug > 0.5) {
              vec3 dbg = uDebug > 8.5 ? vec3(fract(tuv.x), fract(tuv.y), layer / 40.0) : uDebug > 7.5 ? vec3(fract(SEED * 7.13), fract(SEED * 3.7), fract(vInfo.w * 0.37)) : uDebug > 4.5 ? vec3(textureLod(uAlb, vec3(tuv, layer), uDebug - 5.0).a) : uDebug < 1.5 ? vec3(a.a) : uDebug < 2.5 ? vec3(n.b) : uDebug < 3.5 ? vec3(n.xy, 0.0) : gEm * 4.0;
              gDbg = dbg;
            }
          }
        }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        if (gKind < 0.5) {
          vec3 T = normalize(vTanV), B = normalize(vUpV);
          normal = normalize(T * gNt.x + B * gNt.y + normal * gNt.z);
        } else if (gKind < 1.5) {
          vec3 T = normalize(vTanV), B = normalize(cross(normal, T));
          normal = normalize(T * gNt.x - B * gNt.y + normal * gNt.z);
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = gRough;`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = gMetal;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEm;`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
        if (uDebug > 0.5) gl_FragColor = vec4(gDbg, 1.0);`);
  };
  m.customProgramCacheKey = () => "fftt-building-5" + (interior ? "i" : "");
  return m;
}

// ------------------------------------------------------------------ geometry

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; uvm: number[] = []; tan: number[] = [];
  tint: number[] = []; info: number[] = []; misc: number[] = []; shop: number[] = []; idx: number[] = [];
  v = 0;
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, tx: number, tz: number, tint: THREE.Color, info: number[], misc: number[], shop: number[]) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uvm.push(u, w); this.tan.push(tx, tz);
    this.tint.push(tint.r, tint.g, tint.b); this.info.push(info[0], info[1], info[2], info[3]); this.misc.push(misc[0], misc[1], misc[2], misc[3]); this.shop.push(shop[0], shop[1], shop[2], shop[3]);
    return this.v++;
  }
  /** a quad from four corners (counter-clockwise seen from the front) with one normal and tangent */
  quad(p: number[][], n: number[], u: number[][], t: number[], tint: THREE.Color, info: number[], misc: number[], shop: number[]) {
    const i = p.map((q, k) => this.vert(q[0], q[1], q[2], n[0], n[1], n[2], u[k][0], u[k][1], t[0], t[1], tint, info, misc, shop));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
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
    g.setAttribute("aShop", new THREE.Float32BufferAttribute(this.shop, 4));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const hash = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

function scaled(p: Poly, cx: number, cz: number, k: number): Poly {
  return p.map((r) => r.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * k : cz + (v - cz) * k)));
}

/** Inset a ring along its vertex normals (negative d: outward). */
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

type Ground = Storefront | "none";

function groundFor(b: Building, district: string): Ground {
  if (b.h <= 8) return "none";
  const r = hash(b.seed * 7 + 3);
  const shops: Storefront = district === "chinatown" ? "chinatown" : district === "midtown" || district === "columbus" || district === "flatiron" ? "midtown" : "generic";
  switch (b.style) {
    case "glass": case "modern": return r < 0.75 ? "lobby" : shops;
    case "castiron": return district === "fidi" || district === "battery" ? "generic" : "soho";
    case "tenement": return r < 0.78 ? shops : "residential";
    case "prewar": return r < 0.45 ? shops : r < 0.75 ? "lobby" : "residential";
    case "deco": return r < 0.5 ? "lobby" : shops;
    case "brick": return r < 0.55 ? shops : "residential";
    case "civic": return "residential";
  }
  return shops;
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

/** What a wall faces: a street (shops, cornice, kit), a neighbour (blank party wall), or a yard. */
export type EdgeKind = "front" | "party" | "rear";

export interface FrontEdge {
  b: Building; ax: number; az: number; bx: number; bz: number; tx: number; tz: number; nx: number; nz: number;
  L: number; u0: number; y0: number; top: number; gH: number; ground: Ground; shopOff: number; bayW: number; bays: number; kind: EdgeKind; tier: number; district: string;
}

/** The rooftop pieces the leaf can hit: half sizes along x, up, along z at scale 1 (from architectureKit), and
 *  what they're called when they tear you. */
const ROOF_SOLIDS: Record<string, [number, number, number, string]> = {
  bulkhead: [1.5, 1.3, 1.7, "a stair bulkhead"],
  elevator: [2.5, 2.25, 2.5, "a lift penthouse"],
  water_tower: [1.15, 3.5, 1.15, "a water tower"],
  steel_tank: [1.4, 2.7, 1.4, "a water tank"],
  chimney: [0.45, 1.25, 0.35, "a chimney"],
  condenser: [0.5, 0.5, 0.5, "an air conditioner"],
  coop: [1.2, 1.25, 0.8, "a pigeon coop"],
};

export interface RoofSpot { b: Building; poly: Poly; y: number; district: string; party: FrontEdge[] }

const tmpC = new THREE.Color();
const STREET = { tx: 0, tz: 1, w: 10, d: 0, dist: Infinity, name: "" };

function classify(city: CityData, b: Building, mx: number, mz: number, nx: number, nz: number, y0: number): EdgeKind {
  const o = city.buildingAt(mx + nx * 3.5, mz + nz * 3.5);
  if (o && o !== b && o.h > y0 + 2) return "party";
  const st = city.street(mx + nx * 3, mz + nz * 3, STREET);
  return st.dist < st.w / 2 + 9 ? "front" : "rear";
}

const PARTY_TINTS = ["#d4cfc6", "#c2beb6", "#b8b2a8", "#cfc8bc"];
const ROOF_TINTS = ["#ffffff", "#f0ece6", "#d8d6d2", "#c0bcb6", "#e8e8ea"];
const CORNICE_TINTS: Record<Style, string[]> = {
  tenement: ["#e8e2d4", "#d8d0c0", "#9a9890", "#5a5650", "#c9b89a", "#7a2e24"],
  castiron: ["#f0ece0", "#d8d4c8", "#4a4d52"], prewar: ["#efe6d4", "#ddd2bc"], deco: ["#efe6d4"], civic: ["#f4efe2"],
  modern: ["#c8ccc8"], glass: ["#9aa4aa"], brick: ["#c8c2b6"],
};
const SHOPBAND_TINTS = ["#2a2a2a", "#3a2a20", "#20302a", "#e8e2d4", "#5a2420", "#26303c"];

function addBuilding(g: GeoBuilder, city: CityData, b: Building, district: string, roofs: RoofSpot[], fronts: FrontEdge[]) {
  const r = hash(b.seed + 11);
  const tints = TINTS[b.style];
  const tint = tmpC.set(tints[Math.floor(r * tints.length)]).convertSRGBToLinear().clone();
  const variants = STYLE_LAYERS[b.style];
  const layer = variants[Math.floor(hash(b.seed * 3 + 1) * variants.length)];
  const L = FACADE_LAYERS[layer];
  const ground = groundFor(b, district);
  const gH = ground === "none" ? 0 : b.style === "castiron" ? 4.6 : b.style === "glass" || b.style === "modern" ? 5.5 : 4.4;
  const lit = district === "midtown" || district === "columbus" ? 0.1 + r * 0.12 : 0.04 + r * 0.1;
  const seed = (b.seed % 997) * 0.731;
  const dirt = b.style === "glass" ? 0.15 : b.style === "modern" ? 0.4 : 0.55 + hash(b.seed + 5) * 0.45;
  const shopOff = hash(b.seed + 17) * SHOP_W;
  const [shopFirst, shopCount] = ground === "none" ? [0, 0] : SHOP_LAYERS[ground];
  const party = hash(b.seed + 23) < 0.6 || b.style === "tenement" ? PARTY_LAYERS.brick : PARTY_LAYERS.parge;
  const partyTint = party === PARTY_LAYERS.brick ? tint : tmpC.set(PARTY_TINTS[Math.floor(r * 4)]).convertSRGBToLinear().clone();
  const roofLayer = b.style === "glass" || b.style === "modern" ? (r < 0.5 ? ROOF_LAYERS.gravel : ROOF_LAYERS.membrane)
    : b.style === "deco" || b.style === "prewar" ? (r < 0.6 ? ROOF_LAYERS.tar : ROOF_LAYERS.gravel) : ROOF_LAYERS.tar;
  const roofTint = tmpC.set(ROOF_TINTS[Math.floor(hash(b.seed + 31) * ROOF_TINTS.length)]).convertSRGBToLinear().clone();
  const ct = CORNICE_TINTS[b.style];
  const corniceTint = tmpC.set(ct[Math.floor(hash(b.seed + 41) * ct.length)]).convertSRGBToLinear().clone();
  const bandTint = tmpC.set(SHOPBAND_TINTS[Math.floor(hash(b.seed + 43) * SHOPBAND_TINTS.length)]).convertSRGBToLinear().clone();
  const old = b.style === "tenement" || b.style === "prewar" || b.style === "castiron" || b.style === "civic";
  const tierList = tiers(b);
  const partyEdges: FrontEdge[] = [];
  const mine: FrontEdge[] = [];
  tierList.forEach((tier, ti) => {
    const parapet = tier.top ? (old ? 1.1 : 0.9) : 0.6;
    const top = tier.y1 + parapet;
    const misc = [top, lit, seed, 0];
    const outer = tier.poly[0];
    for (let ri = 0; ri < tier.poly.length; ri++) {
      const ring = tier.poly[ri];
      const n = ring.length / 2;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2], az = ring[i * 2 + 1];
        const bx = ring[((i + 1) % n) * 2], bz = ring[((i + 1) % n) * 2 + 1];
        const dx = bx - ax, dz = bz - az, Le = Math.hypot(dx, dz);
        if (Le < 0.05) continue;
        // footprint rings wind clockwise (holes anticlockwise), so (-dz, dx) points out of the solid
        const tx = dx / Le, tz = dz / Le, nx = -tz, nz = tx;
        const kind = classify(city, b, (ax + bx) / 2, (az + bz) / 2, nx, nz, tier.y0);
        const isParty = kind === "party";
        const front = kind === "front";
        const eg = tier.y0 > 0 || !front ? 0 : gH;
        const info = isParty ? [12, 12, 0, party] : [L.W, L.H, eg, layer];
        // a whole number of shops to the wall, about 4.5 m each, so no sign runs off the end. The bay width travels in the
        // fraction of the count; the whole-bay shift keeps two walls of a building from opening with the same shops
        const bays = Math.max(1, Math.round(Le / 4.5)), bayW = Math.max(3, Math.min(6.9, Le / bays));
        const wallShift = (Math.floor(hash(b.seed + Math.round(u) * 7) * 64) * bayW) - u;
        const shop = isParty || !front || tier.y0 > 0 ? [0, 0, 0, dirt] : [shopFirst, shopCount + (bayW - 3) / 4, wallShift, dirt];
        const wt = isParty ? partyTint : tint;
        g.quad([[ax, tier.y0, az], [bx, tier.y0, bz], [bx, top, bz], [ax, top, az]], [nx, 0, nz], [[u, tier.y0], [u + Le, tier.y0], [u + Le, top], [u, top]], [tx, tz], wt, info, misc, shop);
        const e: FrontEdge = { b, ax, az, bx, bz, tx, tz, nx, nz, L: Le, u0: u, y0: tier.y0, top, gH: eg, ground: front && tier.y0 === 0 ? ground : "none", shopOff, bayW, bays, kind, tier: ti, district };
        if (ri === 0 && kind !== "party") mine.push(e);
        if (ri === 0 && isParty) partyEdges.push(e);
        // the band over the shops: a projecting painted fascia cornice
        if (front && eg > 0 && shopCount > 0 && ground !== "lobby" && Le > 2) {
          const d = 0.28, y0 = eg - 0.08, y1 = eg + 0.3;
          const ox = nx * d, oz = nz * d;
          const mt = [top, 0, seed, 3];
          g.quad([[ax + ox, y0, az + oz], [bx + ox, y0, bz + oz], [bx + ox, y1, bz + oz], [ax + ox, y1, az + oz]], [nx, 0, nz], [[0, 0], [1, 0], [1, 1], [0, 1]], [tx, tz], bandTint, info, mt, shop);
          g.quad([[ax, y0, az], [bx, y0, bz], [bx + ox, y0, bz + oz], [ax + ox, y0, az + oz]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [tx, tz], bandTint, info, mt, shop);
          g.quad([[ax + ox, y1, az + oz], [bx + ox, y1, bz + oz], [bx, y1 + 0.12, bz], [ax, y1 + 0.12, az]], [nx * 0.7, 0.7, nz * 0.7], [[0, 0], [1, 0], [1, 1], [0, 1]], [tx, tz], bandTint, info, mt, shop);
        }
        u += Le;
      }
    }
    // a projecting cornice on the street fronts of the old masonry styles: soffit, frieze, face, a sloped top
    const n = outer.length / 2;
    if (tier.top && old && b.h > 8) {
      const deep = b.style === "tenement" ? 0.75 : 0.6;
      const out = inset(outer, -deep);
      const yb = top - 1.15, ym = top - 0.55, yt = top - 0.38;
      const mc = [top, 0, seed, 3];
      const fr = mine.filter((e) => e.tier === ti && e.kind === "front");
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = outer[i * 2], az = outer[i * 2 + 1], bx = outer[j * 2], bz = outer[j * 2 + 1];
        if (!fr.some((e) => Math.abs(e.ax - ax) < 1e-6 && Math.abs(e.az - az) < 1e-6)) continue;
        const cx = out[i * 2], cz = out[i * 2 + 1], dx2 = out[j * 2], dz2 = out[j * 2 + 1];
        const ex = dx2 - cx, ez = dz2 - cz, Le = Math.hypot(ex, ez) || 1, nx = -ez / Le, nz = ex / Le, t = [ex / Le, ez / Le];
        const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
        g.quad([[ax, yb, az], [bx, yb, bz], [dx2, yb, dz2], [cx, yb, cz]], [0, -1, 0], q, t, corniceTint, [L.W, L.H, 0, layer], mc, [0, 0, 0, dirt]);
        g.quad([[cx, yb, cz], [dx2, yb, dz2], [dx2, ym, dz2], [cx, ym, cz]], [nx, 0, nz], q, t, corniceTint, [L.W, L.H, 0, layer], mc, [0, 0, 0, dirt]);
        const k = Math.SQRT1_2;
        g.quad([[cx, ym, cz], [dx2, ym, dz2], [bx, yt, bz], [ax, yt, az]], [nx * k, k, nz * k], q, t, corniceTint, [L.W, L.H, 0, layer], mc, [0, 0, 0, dirt]);
        // end caps where the cornice stops at a party wall or the back
        const prevFront = fr.some((e) => Math.abs(e.bx - ax) < 1e-6 && Math.abs(e.bz - az) < 1e-6);
        const nextFront = fr.some((e) => Math.abs(e.ax - bx) < 1e-6 && Math.abs(e.az - bz) < 1e-6);
        if (!prevFront) g.quad([[ax, yb, az], [cx, yb, cz], [cx, ym, cz], [ax, yt, az]], [-t[0], 0, -t[1]], q, t, corniceTint, [L.W, L.H, 0, layer], mc, [0, 0, 0, dirt]);
        if (!nextFront) g.quad([[dx2, yb, dz2], [bx, yb, bz], [bx, yt, bz], [dx2, ym, dz2]], [t[0], 0, t[1]], q, t, corniceTint, [L.W, L.H, 0, layer], mc, [0, 0, 0, dirt]);
      }
    }
    // parapet: a coping that overhangs a little, the brick inside face, then the roof slab
    const inner = inset(outer, 0.35);
    const lip = inset(outer, -0.06);
    const mp = [top, 0, seed, 3];
    const infoParty = [12, 12, 0, party];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ox0 = lip[i * 2], oz0 = lip[i * 2 + 1], ox1 = lip[j * 2], oz1 = lip[j * 2 + 1];
      const ix0 = inner[i * 2], iz0 = inner[i * 2 + 1], ix1 = inner[j * 2], iz1 = inner[j * 2 + 1];
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
      g.quad([[ox0, top + 0.08, oz0], [ox1, top + 0.08, oz1], [ix1, top + 0.08, iz1], [ix0, top + 0.08, iz0]], [0, 1, 0], q, [1, 0], corniceTint, infoParty, mp, [0, 0, 0, dirt]);
      const ex = ox1 - ox0, ez = oz1 - oz0, Le = Math.hypot(ex, ez) || 1;
      g.quad([[ox0, top - 0.08, oz0], [ox1, top - 0.08, oz1], [ox1, top + 0.08, oz1], [ox0, top + 0.08, oz0]], [-ez / Le, 0, ex / Le], q, [ex / Le, ez / Le], corniceTint, infoParty, mp, [0, 0, 0, dirt]);
      // inner face (faces into the roof): party-wall brick
      const dx = ix1 - ix0, dz = iz1 - iz0, Li = Math.hypot(dx, dz) || 1;
      const fnx = dz / Li, fnz = -dx / Li;
      const i0 = g.vert(ix0, tier.y1, iz0, fnx, 0, fnz, 0, tier.y1, -dx / Li, -dz / Li, partyTint, infoParty, [top, 0, seed, 0], [0, 0, 0, dirt]);
      const i1 = g.vert(ix1, tier.y1, iz1, fnx, 0, fnz, -Li, tier.y1, -dx / Li, -dz / Li, partyTint, infoParty, [top, 0, seed, 0], [0, 0, 0, dirt]);
      const i2 = g.vert(ix1, top + 0.08, iz1, fnx, 0, fnz, -Li, top + 0.08, -dx / Li, -dz / Li, partyTint, infoParty, [top, 0, seed, 0], [0, 0, 0, dirt]);
      const i3 = g.vert(ix0, top + 0.08, iz0, fnx, 0, fnz, 0, top + 0.08, -dx / Li, -dz / Li, partyTint, infoParty, [top, 0, seed, 0], [0, 0, 0, dirt]);
      g.idx.push(i0, i2, i1, i0, i3, i2);
    }
    // roof slab
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < inner.length; i += 2) contour.push(new THREE.Vector2(inner[i], inner[i + 1]));
    const holes = tier.poly.slice(1).map((h) => { const v: THREE.Vector2[] = []; for (let i = 0; i < h.length; i += 2) v.push(new THREE.Vector2(h[i], h[i + 1])); return v; });
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...contour, ...holes.flat()];
    const base = g.v;
    const miscR = [top, 0, seed, 1];
    for (const p of all) g.vert(p.x, tier.y1, p.y, 0, 1, 0, p.x, p.y, 1, 0, roofTint, [8, 8, 0, roofLayer], miscR, [0, 0, 0, dirt]);
    for (const f of faces) g.idx.push(base + f[0], base + f[2], base + f[1]);
    if (tier.top) roofs.push({ b, poly: tier.poly, y: tier.y1, district, party: partyEdges });
  });
  for (const e of mine) fronts.push(e);
}

// ------------------------------------------------------------------ the city's buildings

/** mesh is null while a streamed chunk is out of range (low quality frees far chunks' geometry) */
interface Chunk { mesh: THREE.Mesh | null; cx: number; cz: number; r: number; build?: () => THREE.BufferGeometry | null }

export class BuildingsMesh {
  readonly root = new THREE.Group();
  readonly chunks: Chunk[] = [];
  readonly kit: ArchitectureKit;
  readonly fronts: FrontEdge[] = [];
  readonly roofs: RoofSpot[] = [];
  readonly lots: LotsView;
  private drawDistance = 900;
  private facades: Facades | null = null;
  private placedFacadeKit = false;
  readonly quality: FacadeQuality;
  private solids: FacadeProp[] = [];

  constructor(city: CityData, tex: FacadeTextures) {
    this.quality = tex.quality;
    const mat = buildingMaterial(tex);
    this.kit = new ArchitectureKit({ quality: tex.quality });
    const by = new Map<string, { list: Building[]; sky: boolean }[]>();
    const put = (b: Building, sky: boolean) => {
      const k = `${Math.floor(b.cx / CHUNK)},${Math.floor(b.cz / CHUNK)}`;
      (by.get(k) ?? by.set(k, []).get(k)!).push({ list: [b], sky });
    };
    for (const b of city.buildings) if (!isModelled(b.cx, b.cz)) put(b, false);
    // the distant skyline: towers outside the playable corridor, chunked like the rest
    city.raw.skyline.forEach((s, i) => {
      const st: Style = s.y >= 1985 ? "glass" : s.y >= 1950 ? "modern" : s.h > 120 ? "deco" : "prewar";
      let cx = 0, cz = 0;
      for (let k = 0; k < s.p[0].length; k += 2) { cx += s.p[0][k]; cz += s.p[0][k + 1]; }
      cx /= s.p[0].length / 2; cz /= s.p[0].length / 2;
      const b: Building = { id: -1 - i, poly: s.p, h: s.h, year: s.y, style: st, seed: i * 7919 + 13, s: 0, off: 0, x0: cx, z0: cz, x1: cx, z1: cz, cx, cz, area: Math.abs(ringArea(s.p[0])) };
      put(b, true);
    });
    // On low quality (phones) the chunks stream: every building is still walked once here (that's
    // where the roof spots and street fronts for the kit come from), but a chunk's geometry is only
    // kept while it's near the player and rebuilt when they come back (a whole corridor of detailed
    // buildings was ~200 MB, which an iPhone tab can't hold).
    this.stream = tex.quality === "low";
    this.mat = mat;
    for (const [k, entries] of by) {
      const make = (roofs: RoofSpot[], fronts: FrontEdge[]) => {
        const g = new GeoBuilder();
        for (const { list, sky } of entries) for (const b of list) {
          try {
            const district = sky ? "midtown" : city.district(b.s).id;
            addBuilding(g, city, b, district, sky ? [] : roofs, sky ? [] : fronts);
          } catch { /* skip a broken footprint */ }
        }
        return g.v ? g.build() : null;
      };
      const geo = make(this.roofs, this.fronts);
      if (!geo) continue;
      const bs = geo.boundingSphere!;
      const chunk: Chunk = { mesh: null, cx: bs.center.x, cz: bs.center.z, r: Math.max(bs.radius, CHUNK * 0.71), build: () => make([], []) };
      this.chunks.push(chunk);
      void k;
      if (this.stream) geo.dispose();
      else this.attach(chunk, geo);
    }
    this.placeRoofKit();
    this.root.add(this.kit.root);
    this.lots = new LotsView(city, this.kit, tex.quality, this.solids);
    this.root.add(this.lots.root);
    loadKitModels().then((parts) => { if (parts) this.kit.useModels(parts); }).catch((e) => console.warn("architecture kit didn't load", e));
  }

  private stream = false;
  private mat!: THREE.Material;
  private attach(c: Chunk, geo: THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    c.mesh = mesh;
    this.root.add(mesh);
  }

  /** Beyond this the far city (farCity.ts) takes over: chunks, kit and clutter all stop here. */
  setDrawDistance(metres: number) {
    this.drawDistance = metres;
    this.kit.drawDistance = metres;
    DRAW_EDGE.value.x = metres;
  }

  /** The facade clutter (world/facades.ts), so fire escapes keep clear of AC units, cats and balconies.
   *  Optional: the FacadePropsView registers it automatically. */
  attachFacades(f: Facades, addSolids = false) {
    this.facades = f;
    if (addSolids) { this.solidsTo = f; this.flushSolids(); }
  }

  /** Solid boxes the leaf could hit / land on (fire-escape landings, shop awnings, lobby canopies, sidewalk sheds,
   *  lot fences and hoardings, crane masts, dumpsters...), in the oriented-box format world/facades.ts uses
   *  (kind "solid": centre, wall direction, half sizes along / up / out). They are only drawn unless the game
   *  opts in with attachFacades(flow.facades, true), which pushes them into flow.facades as they are placed. */
  getSolids(): FacadeProp[] { return this.solids; }
  private solidsTo: Facades | null = null;
  private flushed = 0;
  private flushSolids() {
    const f = this.solidsTo;
    if (!f) return;
    for (; this.flushed < this.solids.length; this.flushed++) {
      const p = this.solids[this.flushed];
      const r = Math.max(p.hw, p.hd) + 1;
      f.props.push(p);
      f.grid.add(p, p.x - r, p.z - r, p.x + r, p.z + r);
    }
  }

  update(focus: THREE.Vector3) {
    if (!this.placedFacadeKit) {
      this.placedFacadeKit = true;
      this.facades = this.facades ?? facadeRegistry.facades;
      this.placeFacadeKit();
    }
    if (this.solidsTo && this.flushed < this.solids.length) this.flushSolids();
    const dd = this.drawDistance;
    let built = 0;
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - focus.x, c.cz - focus.z) - c.r;
      if (this.stream) {
        // build what's about to come into view (one chunk a frame, nearest first in practice since
        // you approach them gradually); free what's well behind
        if (!c.mesh && d < dd + 160 && built < 1 && c.build) { const g = c.build(); if (g) { this.attach(c, g); built++; } }
        else if (c.mesh && d > dd + 420) { this.root.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
      }
      if (!c.mesh) continue;
      c.mesh.visible = d < dd;
      c.mesh.castShadow = d < 260; // only nearby blocks throw shadows into the shadow map
    }
    this.kit.update(focus);
    this.lots.update(focus);
  }

  // ---------------------------------------------------------------- roof kit

  private placeRoofKit() {
    const K = this.kit;
    K.define("water_tower", 750, true, { name: "water_tower_far", at: 200 });
    K.define("steel_tank", 450, false);
    K.define("bulkhead", 500, true);
    K.define("elevator", 550, true);
    K.define("hatch", 220, false);
    K.define("hvac", 350, false);
    K.define("condenser", 240, false);
    K.define("chimney", 300, false);
    K.define("vent", 180, false);
    K.define("fan", 260, false);
    K.define("dish", 240, false);
    K.define("skylight", 320, false);
    K.define("mast", 600, false);
    K.define("solar", 380, false);
    for (let i = 0; i < 4; i++) K.define(`billboard_${i}`, 600, false);
    K.define("coop", 300, false);
    K.define("laundry", 240, false);
    K.define("deck", 300, false);
    K.define("roof_rail", 200, false);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const TOWER = [0xffffff, 0xe8dccb, 0xc9b49a, 0x9a8a78];
    for (const { b, poly, y, district, party } of this.roofs) {
      if (b.area < 40) continue;
      const r = (k: number) => hash(b.seed * 31 + k * 977);
      const placed: [number, number, number][] = [];
      const ring = poly[0];
      const yawBase = Math.atan2(ring[2] - ring[0], ring[3] - ring[1]);
      const fits = (x: number, z: number, fp: number) =>
        [[0, 0], [fp, 0], [-fp, 0], [0, fp], [0, -fp], [fp * 0.7, fp * 0.7], [-fp * 0.7, -fp * 0.7], [fp * 0.7, -fp * 0.7], [-fp * 0.7, fp * 0.7]].every(([dx, dz]) => inPoly(poly, x + dx, z + dz))
        && !placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + fp);
      const put = (it: string, fp: number, k: number, scale: THREE.Vector3, colour?: THREE.Color, at?: [number, number], yaw?: number) => {
        for (let tries = 0; tries < 12; tries++) {
          let x: number, z: number;
          if (at && tries === 0) [x, z] = at;
          else {
            if (b.x1 - b.x0 < 2 * fp || b.z1 - b.z0 < 2 * fp) return false;
            x = b.x0 + fp + (b.x1 - b.x0 - 2 * fp) * r(k * 13 + tries * 3 + 1);
            z = b.z0 + fp + (b.z1 - b.z0 - 2 * fp) * r(k * 17 + tries * 5 + 2);
          }
          if (!fits(x, z, fp)) continue;
          placed.push([x, z, fp]);
          const yw = yaw ?? yawBase + (r(k * 29 + tries) < 0.5 ? 0 : Math.PI / 2);
          q.setFromAxisAngle(Y, yw);
          K.add(it, m.compose(p.set(x, y, z), q, scale), colour);
          // the big pieces are solid: you land on them or bounce off them, you don't fly through them
          const box = ROOF_SOLIDS[it];
          if (box) {
            const [hw, hh, hd, label] = box;
            const cx = Math.cos(yw), sx = Math.sin(yw);
            this.solids.push({ kind: "solid", x, y: y + hh * scale.y, z, tx: cx, tz: -sx, nx: sx, nz: cx, hw: hw * scale.x, hh: hh * scale.y, hd: hd * scale.z, seed: 0, label });
          }
          return true;
        }
        return false;
      };
      const S = (s: number, sy = s) => sc.set(s, sy, s);
      let k = 0;
      // stair bulkhead (and an elevator penthouse on the bigger ones)
      if (b.area > 120 && r(1) < 0.9) {
        const w = 2.6 + r(2) * 1.2, d = 3.0 + r(3) * 1.4, h = 2.5 + r(4) * 0.6;
        put("bulkhead", Math.max(w, d) * 0.6, k++, sc.set(w / 3, h / 2.6, d / 3.4), col.set(b.style === "glass" || b.style === "modern" ? 0xb8bcc0 : [0xffffff, 0xe0d4c8, 0xc8b8a8][Math.floor(r(5) * 3)]));
      }
      if ((b.style === "prewar" || b.style === "deco" || b.style === "modern" || b.style === "glass" || b.style === "brick") && b.h > 25 && b.area > 400) {
        const w = 4 + r(6) * 3, d = 4 + r(7) * 3, h = 3.5 + r(8) * 2.5;
        put("elevator", Math.max(w, d) * 0.6, k++, sc.set(w / 5, h / 4.5, d / 5), col.set(b.style === "glass" ? 0x9aa4aa : 0xe8e0d0));
      }
      // chimneys stand on the party walls
      if ((b.style === "tenement" || b.style === "castiron" || (b.style === "prewar" && b.h < 40)) && party.length) {
        const n = Math.floor(r(9) * 2.6);
        for (let i = 0; i < n; i++) {
          const e = party[Math.floor(r(10 + i) * party.length)];
          if (e.top < y + 0.5) continue;
          const t = 0.15 + r(14 + i) * 0.7;
          const x = e.ax + (e.bx - e.ax) * t - e.nx * 0.75, z = e.az + (e.bz - e.az) * t - e.nz * 0.75;
          put("chimney", 0.6, k++, S(0.9 + r(20 + i) * 0.5, 0.8 + r(21 + i) * 0.8), undefined, [x, z], Math.atan2(e.tx, e.tz));
        }
      }
      const add = (it: string, chance: number, fp: number, scale = 1, colour?: THREE.Color) => { if (r(k * 7 + it.length) < chance) put(it, fp, k, S(scale), colour); k++; };
      const tower = () => {
        const s = 1.35 + r(k * 3) * 0.7;
        if (r(k * 5 + 1) < 0.5 || !put("water_tower", 2.2 * s * 0.6, k, S(s), col.set(TOWER[Math.floor(r(k + 2) * TOWER.length)]))) { /* fine */ }
        k++;
      };
      switch (b.style) {
        case "tenement":
          add("hatch", 0.7, 0.7); add("vent", 0.7, 0.3); add("vent", 0.5, 0.3); add("dish", 0.45, 0.6); add("dish", 0.25, 0.6);
          add("condenser", 0.35, 0.7); add("condenser", 0.2, 0.7);
          if (district === "chinatown" || district === "littleitaly") { add("coop", 0.15, 1.8); add("laundry", 0.35, 2.2); }
          if (b.h > 18 && r(40) < 0.5) tower();
          if (r(41) < 0.25) add("roof_rail", 1, 0.6);
          break;
        case "castiron":
          add("skylight", 0.7, 1.6); add("skylight", 0.4, 1.6); add("vent", 0.6, 0.3); add("fan", 0.4, 0.5);
          if (r(40) < 0.55) tower();
          add("deck", 0.12, 3.2);
          break;
        case "prewar": case "deco": case "civic":
          if (b.h < 120 && r(40) < 0.65) tower();
          if (b.h < 120 && b.area > 900 && r(42) < 0.3) tower();
          add("deck", district === "village" || district === "littleitaly" ? 0.25 : 0.08, 3.2);
          add("skylight", 0.25, 1.6); add("hvac", 0.3, 3); add("fan", 0.5, 0.5); add("vent", 0.6, 0.3);
          add("mast", b.h > 90 ? 0.6 : 0.05, 0.6);
          break;
        case "brick":
          add("hvac", 0.4, 3); add("condenser", 0.5, 0.7); add("condenser", 0.4, 0.7); add("dish", 0.4, 0.6); add("vent", 0.6, 0.3);
          add("steel_tank", 0.15, 2.4); add("deck", 0.1, 3.2);
          break;
        case "modern": case "glass":
          add("hvac", 0.8, 3); add("hvac", 0.5, 3); add("steel_tank", 0.35, 2.4); add("solar", 0.3, 2.6); add("solar", 0.2, 2.6);
          add("fan", 0.7, 0.5); add("fan", 0.5, 0.5); add("mast", b.h > 70 ? 0.55 : 0.1, 0.6);
          break;
      }
      if ((district === "midtown" || district === "columbus" || district === "flatiron") && b.h < 60 && b.area > 250) add(`billboard_${Math.floor(r(51) * 4)}`, 0.35, 5, 1, col.set(0xffffff));
    }
  }

  // ---------------------------------------------------------------- facade kit

  private placeFacadeKit() {
    const K = this.kit;
    K.define("fire_escape", 220, true);
    K.define("fire_escape_top", 220, true);
    K.define("fire_escape_bottom", 220, true);
    for (const piece of ["fe_plants", "fe_canes", "fe_bike", "fe_boxes", "fe_chair"]) K.define(piece, 200, false);
    K.define("bracket", 150, false);
    K.define("awning", 220, false);
    K.define("canopy", 220, false);
    for (let i = 0; i < 6; i++) K.define(`blade_sign_${i}`, 320, false);
    const props = this.facades;
    const m = new THREE.Matrix4(), basis = new THREE.Matrix4(), xa = new THREE.Vector3(), ya = new THREE.Vector3(0, 1, 0), za = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    const at = (e: FrontEdge, along: number, y: number, out: number, s: THREE.Vector3) => {
      xa.set(e.tx, 0, e.tz); za.set(e.nx, 0, e.nz);
      basis.makeBasis(xa, ya, za);
      m.copy(basis).scale(s).setPosition(e.ax + e.tx * along + e.nx * out, y, e.az + e.tz * along + e.nz * out);
      return m;
    };
    const solid = (e: FrontEdge, along: number, y: number, out: number, hw: number, hh: number, hd: number) => {
      this.solids.push({ kind: "solid", x: e.ax + e.tx * along + e.nx * out, y, z: e.az + e.tz * along + e.nz * out, tx: e.tx, tz: e.tz, nx: e.nx, nz: e.nz, hw, hh, hd, seed: 0 });
    };
    // is anything of world/facades.ts on this stretch of wall?
    const blocked = (e: FrontEdge, a0: number, a1: number, y0: number, y1: number) => {
      if (!props) return false;
      const mx = e.ax + e.tx * (a0 + a1) / 2, mz = e.az + e.tz * (a0 + a1) / 2;
      for (const p of props.grid.around(mx, mz, (a1 - a0) / 2 + 2)) {
        // AC units and cats can share a bay with the stairs (as they do); balconies can't
        if (p.kind !== "balcony") continue;
        const rx = p.x - e.ax, rz = p.z - e.az;
        const along = rx * e.tx + rz * e.tz, outd = rx * e.nx + rz * e.nz;
        if (outd < -0.5 || outd > 2.2) continue;
        if (along + p.hw < a0 - 0.2 || along - p.hw > a1 + 0.2) continue;
        if (p.y + p.hh < y0 || p.y - p.hh > y1) continue;
        return true;
      }
      return false;
    };
    const FE_PAINT = [0x1a1a1a, 0x1a1a1a, 0x1a1a1a, 0x22302a, 0x3a2a24, 0x5a5e60];
    const AWNING = [0x8a1c1c, 0x1f4a2f, 0x1c2a4a, 0x5a1a2a, 0x2a2a2a, 0xc8a030, 0x245a6a, 0xd8d0c0];
    const CANOPY = [0x1f3a2a, 0x1c2238, 0x4a1a1a, 0x181818, 0x3a2a1a];
    const lobbyFront = new Map<Building, FrontEdge>();
    for (const e of this.fronts) if (e.kind === "front" && e.ground === "lobby" && (lobbyFront.get(e.b)?.L ?? 0) < e.L) lobbyFront.set(e.b, e);
    for (const e of this.fronts) {
      const b = e.b;
      const t = TILES[b.style];
      const r = (k: number) => hash(b.seed * 13 + Math.round(e.u0 * 10) * 7 + k * 131);
      const floors = Math.floor((e.top - 1.2 - Math.max(e.gH, e.y0)) / t.floorH);
      const isFront = e.kind === "front";
      const household = inHeroBlock(b.cx, b.cz) ? householdOf(b.seed, b.style) : null;
      // ---- fire escapes: the tenements' iron zig-zags, on the front and often the back
      const feStyle = b.style === "tenement" || (b.style === "brick" && b.h < 30) || (b.style === "prewar" && b.h < 34) || (b.style === "castiron" && !isFront);
      if (feStyle && e.L >= 2 * t.bayW + 1.2 && floors >= 2 && e.y0 === 0 && r(1) < (isFront ? 0.75 : 0.5)) {
        const g0 = e.gH > 0 ? e.gH : 3.2;
        const nFE = e.L > 20 && r(2) < 0.5 ? 2 : 1;
        const kFirst = Math.ceil((e.u0 + t.bayW * 1.2) / t.bayW), kLast = Math.floor((e.u0 + e.L - t.bayW * 1.2) / t.bayW);
        const done: number[] = [];
        for (let f = 0; f < nFE; f++) {
          // (the hero block's balconies are scattered: look harder for the bay, the fire escape is what makes these streets)
          for (let tries = 0, most = household ? 16 : 4; tries < most; tries++) {
            if (kLast < kFirst) break;
            const kk = kFirst + Math.floor(r(3 + f * 5 + tries) * (kLast - kFirst + 1));
            if (done.some((d) => Math.abs(d - kk) < 3)) continue;
            const along = kk * t.bayW - e.u0;
            const fl = Math.min(floors, 10);
            if (blocked(e, along - t.bayW, along + t.bayW, g0 - 0.5, g0 + fl * t.floorH + 1.2)) continue;
            done.push(kk);
            const w = (2 * t.bayW - 0.5) / 4.6, sy = t.floorH / 3.2;
            col.set(FE_PAINT[Math.floor(r(9) * FE_PAINT.length)]);
            for (let i = 0; i < fl; i++) {
              const y = g0 + i * t.floorH + 0.02;
              const piece = i === 0 ? "fire_escape_bottom" : i === fl - 1 ? "fire_escape_top" : "fire_escape";
              K.add(piece, at(e, along, y, 0, sc.set(w, sy, 1)), col);
              solid(e, along, y, 0.6, (2 * t.bayW - 0.5) / 2, 0.08, 0.55);
              // somebody lives here: what they keep on the landing, clear of the ladder's end
              if (household && i > 0 && r(40 + i + f * 13) < household.landing) {
                const piece = pick(household.landingPieces, r(70 + i + f * 13));
                K.add(piece, at(e, along + (r(90 + i) < 0.5 ? -1 : 1) * t.bayW * 0.45, y + 0.06, 0.55, sc.set(1, 1, 1)));
              }
            }
            break;
          }
        }
      }
      if (!isFront) continue;
      // ---- cornice brackets under the projecting cornice
      const old = b.style === "tenement" || b.style === "prewar" || b.style === "castiron" || b.style === "civic";
      if (old && b.h > 8 && b.h < 60 && e.tier === tiers(b).length - 1 && e.L > 1.5) {
        const yb = e.top - 1.15;
        const sp = b.style === "tenement" ? 0.95 : 1.25;
        const n = Math.max(1, Math.floor((e.L - 0.4) / sp));
        const off = (e.L - (n - 1) * sp) / 2;
        const deep = b.style === "tenement" ? 0.75 : 0.6;
        const ct = CORNICE_TINTS[b.style];
        col.set(ct[Math.floor(hash(b.seed + 41) * ct.length)]);
        for (let i = 0; i < n; i++) K.add("bracket", at(e, off + i * sp, yb, 0, sc.set(1, 1, deep / 0.6)), col);
      }
      if (e.ground === "none" || e.L < 3) continue;
      // ---- shop awnings and blade signs, one per 4.5 m shop
      if (e.ground !== "lobby" && e.ground !== "residential") {
        const first = 0, last = e.bays - 1;
        for (let s = first; s <= last; s++) {
          const along = (s + 0.5) * e.bayW;
          if (along < 2.2 || along > e.L - 2.2) continue;
          const rs = hash(b.seed * 5 + s * 977);
          const awn = e.ground === "chinatown" ? 0.55 : e.ground === "soho" ? 0.3 : 0.45;
          if (rs < awn) {
            const y = e.gH - 1.32;
            col.set(AWNING[Math.floor(hash(b.seed + s * 31) * AWNING.length)]);
            K.add("awning", at(e, along, y, 0.02, sc.set(3.9, 1, 1)), col);
            solid(e, along, y - 0.2, 0.65, 1.95, 0.22, 0.62);
          }
          const blade = e.ground === "chinatown" ? 0.3 : e.ground === "midtown" ? 0.22 : 0.1;
          if (hash(b.seed * 9 + s * 131) < blade && e.top > e.gH + 4) {
            const kind = e.ground === "chinatown" ? (hash(b.seed + s * 17) < 0.5 ? 3 : 5) : Math.floor(hash(b.seed + s * 19) * 3) + (hash(b.seed + s * 23) < 0.3 ? 4 : 0);
            col.set(0xffffff);
            K.add(`blade_sign_${Math.min(5, kind)}`, at(e, along - 2.25 + 0.2, e.gH + 1.8, 0.05, sc.set(1, 1, 1)), col);
          }
        }
      } else if (e.ground === "lobby" && e.L > 8) {
        // one canopy to the kerb per lobby building, on its longest front
        if (lobbyFront.get(b) === e) {
          const along = e.L * (0.3 + 0.4 * r(30));
          col.set(CANOPY[Math.floor(r(31) * CANOPY.length)]);
          const depth = 3.6;
          K.add("canopy", at(e, along, 3.3, 0, sc.set(1, 1, depth / 4.2)), col);
          this.solids.push({ kind: "solid", x: e.ax + e.tx * along + e.nx * depth / 2, y: 3.4, z: e.az + e.tz * along + e.nz * depth / 2, tx: e.tx, tz: e.tz, nx: e.nx, nz: e.nz, hw: 1.7, hh: 0.15, hd: depth / 2, seed: b.id + 1 });
        }
      }
    }
  }
}
