// Cloth that hangs in the real wind: washing, drying racks and banners. Each garment swings about its pegs
// like a pendulum, by how hard Airflow says it's blowing where it hangs (facadeProps.ts samples that), so the
// laundry shows the player what the air is doing. Everything is in world space, merged per chunk.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** How many separately-blown spots one chunk can have. More share (a line's garments all share one anyway). */
export const MAX_SPOTS = 48;

const COLOURS = [0xc8382a, 0xf0ece0, 0x2a5a9a, 0xe0b423, 0x3a8a4a, 0xd27aa2, 0x8a8a8a, 0x26262a, 0xe8e2d2, 0x6a8fb5];
export const FLAG = [0x2a7a4a, 0xefe8d6, 0xc0392b];

export type GarmentKind = "shirt" | "trousers" | "sheet" | "towel" | "socks" | "banner";
const KINDS: GarmentKind[] = ["shirt", "shirt", "trousers", "towel", "sheet", "socks"];

function sheetPart(w: number, h: number, x: number, top: number, c: number, c2 = c, stripes = 0): THREE.BufferGeometry {
  const sx = Math.max(3, Math.round(w / 0.16)), sy = Math.max(3, Math.round(h / 0.16));
  const g = new THREE.PlaneGeometry(w, h, sx, sy).translate(x, top - h / 2, 0);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), sway = new Float32Array(n);
  const a = new THREE.Color(c), b = new THREE.Color(c2);
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position.getY(i);
    const px = g.attributes.position.getX(i);
    const use = stripes && Math.floor(((px - x + w / 2) / w) * stripes) % 2 ? b : a;
    col.set([use.r, use.g, use.b], i * 3);
    sway[i] = -y;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSway", new THREE.BufferAttribute(sway, 1));
  g.deleteAttribute("uv");
  return g;
}

/** A garment in its own frame: x across, hanging down from y = 0. */
function garmentShape(kind: GarmentKind, r: number): { geo: THREE.BufferGeometry; width: number } {
  const c = COLOURS[Math.floor(r * COLOURS.length) % COLOURS.length];
  const c2 = COLOURS[Math.floor(r * 37) % COLOURS.length];
  switch (kind) {
    case "shirt": {
      const w = 0.5 + r * 0.14, h = 0.62 + r * 0.14;
      return { width: w + 0.34, geo: mergeGeometries([sheetPart(w, h, 0, 0, c), sheetPart(0.19, 0.28, -w / 2 - 0.09, 0, c), sheetPart(0.19, 0.28, w / 2 + 0.09, 0, c)])! };
    }
    case "trousers": {
      const h = 0.85 + r * 0.15, c0 = r < 0.5 ? 0x2c3a55 : 0x4a4640;
      return { width: 0.42, geo: mergeGeometries([sheetPart(0.19, h, -0.11, 0, c0), sheetPart(0.19, h, 0.11, 0, c0)])! };
    }
    case "sheet": {
      const w = 1.3 + r * 0.6, h = 1 + r * 0.5;
      return { width: w, geo: sheetPart(w, h, 0, 0, r < 0.5 ? 0xece6d8 : c, c2, r < 0.3 ? 7 : 0) };
    }
    case "towel":
      return { width: 0.62, geo: sheetPart(0.6, 0.85 + r * 0.2, 0, 0, c, c2, r < 0.4 ? 5 : 0) };
    case "socks":
      return { width: 0.34, geo: mergeGeometries([sheetPart(0.11, 0.3, -0.09, 0, c), sheetPart(0.11, 0.3, 0.09, 0, c)])! };
    case "banner": {
      const w = 0.78, third = w / 3, h = 1.3;
      return { width: w, geo: mergeGeometries(FLAG.map((col, i) => sheetPart(third, h, (i - 1) * third, 0, col)))! };
    }
  }
}

export const pickGarment = (r: number): GarmentKind => KINDS[Math.floor(r * KINDS.length) % KINDS.length];

/** A garment pegged at (x, y, z), its width along yaw, blown by spot `spot` of the chunk. */
export function garment(kind: GarmentKind, r: number, x: number, y: number, z: number, yaw: number, spot: number): { geo: THREE.BufferGeometry; width: number } {
  const { geo, width } = garmentShape(kind, r);
  geo.rotateY(yaw).translate(x, y, z);
  const n = geo.attributes.position.count;
  const spots = new Float32Array(n).fill(spot), phase = new Float32Array(n).fill(r * 40);
  geo.setAttribute("aSpot", new THREE.BufferAttribute(spots, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  return { geo, width };
}

const VERT_PARS = /* glsl */ `
  attribute float aSway, aSpot, aPhase;
  uniform vec3 uWind[${MAX_SPOTS}];
  uniform float uTime;
  vec3 clothOffset(vec3 p, out float flap) {
    vec3 w = uWind[int(aSpot + 0.5)];
    float s = length(w.xz);
    vec2 dir = s > 0.01 ? w.xz / s : vec2(1.0, 0.0);
    // a steady lean from the wind's strength, with gusts and a faster flap travelling down the cloth
    float lean = min(s * 0.042, 0.8);
    float gust = sin(uTime * (1.3 + s * 0.1) + aPhase) * 0.5 + sin(uTime * 2.7 + aPhase * 1.7) * 0.25;
    float across = p.x * 2.7 + p.z * 2.7;
    flap = sin(uTime * (3.5 + s * 0.55) + aPhase - aSway * 5.0 + across);
    flap = flap * 0.7 + sin(uTime * (5.3 + s * 0.4) + aPhase * 1.3 - across * 1.9 - aSway * 2.7) * 0.3;
    float angle = lean * (1.0 + gust * 0.35) + (0.05 + min(s, 16.0) * 0.016) * flap;
    float out_ = sin(angle) * aSway, lift = (1.0 - cos(angle)) * aSway;
    return vec3(dir.x * out_, lift, dir.y * out_);
  }`;

export interface ClothUniforms { uWind: { value: THREE.Vector3[] }; uTime: { value: number } }

function patch(sh: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, u: ClothUniforms, normals: boolean) {
  sh.uniforms.uWind = u.uWind;
  sh.uniforms.uTime = u.uTime;
  sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + VERT_PARS);
  if (normals) {
    // lean the shading normal with the flap, or the cloth reads as a flat card however it moves
    sh.vertexShader = sh.vertexShader.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
      { float flapN; clothOffset(position, flapN); objectNormal = normalize(objectNormal + vec3(0.0, flapN * 0.55, 0.0)); }`);
  }
  sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
    { float flapP; transformed += clothOffset(position, flapP); }`);
}

export function clothMesh(parts: THREE.BufferGeometry[], u: ClothUniforms): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    patch(sh as never, u, true);
    // thin cloth lets the sky through: seen from below it would otherwise be a dark card against the sky
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.34;");
  };
  mat.customProgramCacheKey = () => "cloth";
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, mat);
  mesh.castShadow = true;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => patch(sh as never, u, false);
  depth.customProgramCacheKey = () => "cloth-depth";
  mesh.customDepthMaterial = depth;
  return mesh;
}
