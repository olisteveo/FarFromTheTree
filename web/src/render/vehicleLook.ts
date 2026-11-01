// How the vehicles sit in the world: clearcoat paint and glass that reflect the sky and the street, road grime on the
// bodies, wheels that turn, and a soft shadow on the ground beneath each one, which is most of what stops them floating.

import * as THREE from "three";
import { REFLECT_GLSL } from "./reflections";
import { sunDirection } from "./sun";

export const WHEEL_RADIUS = 0.33;
const uSun = { value: sunDirection() };

/** Which wheel each vertex of a tyre or rim part belongs to, found from gaps along the body: aAxle = (centre y, centre z). */
export function prepareWheels(g: THREE.BufferGeometry) {
  const p = g.attributes.position, n = p.count;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => p.getZ(a) - p.getZ(b));
  const axle = new Float32Array(n * 2);
  let start = 0;
  for (let k = 1; k <= n; k++) {
    if (k < n && p.getZ(order[k]) - p.getZ(order[k - 1]) < 0.15) continue;
    let y0 = Infinity, y1 = -Infinity;
    const z0 = p.getZ(order[start]), z1 = p.getZ(order[k - 1]);
    for (let j = start; j < k; j++) { const y = p.getY(order[j]); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let j = start; j < k; j++) { axle[order[j] * 2] = (y0 + y1) / 2; axle[order[j] * 2 + 1] = (z0 + z1) / 2; }
    start = k;
  }
  g.setAttribute("aAxle", new THREE.BufferAttribute(axle, 2));
}

const KIND: Record<string, number> = { paint: 0, livery: 0, glass: 1, chrome: 2, rim: 3, tyre: 4, trim: 5 };

export function dressVehicleMaterial(m: THREE.MeshStandardMaterial, name: string) {
  if (name === "light_rear") {
    // tail lights: dim while driving, bright on the brakes
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aBrake; varying float vBrake;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvBrake = aBrake;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vBrake;").replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix(0.4, 2.2, vBrake);");
    };
    m.customProgramCacheKey = () => "vehicle-tail-light";
    return;
  }
  const kind = KIND[name];
  if (kind === undefined) return; // lights and signs shade themselves
  const wheel = name === "tyre" || name === "rim";
  if (kind === 0) { m.roughness = 0.4; m.metalness = 0; }
  if (kind === 1) { m.roughness = 0.1; m.metalness = 0; }
  if (kind === 2 || kind === 3) { m.roughness = 0.32; m.metalness = 0.1; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSun = uSun;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        ${wheel ? "attribute vec2 aAxle; attribute float aRoll;" : ""}
        varying vec3 vWP, vWN, vLP;`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        ${wheel ? "{ float c = cos(aRoll), s = sin(aRoll); objectNormal = vec3(objectNormal.x, objectNormal.y * c - objectNormal.z * s, objectNormal.y * s + objectNormal.z * c); }" : ""}
        vWN = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        ${wheel ? "{ float c = cos(aRoll), s = sin(aRoll); vec2 q = transformed.yz - aAxle; transformed.yz = aAxle + vec2(q.x * c - q.y * s, q.x * s + q.y * c); }" : ""}
        vLP = position;
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        #define VKIND ${kind}
        uniform vec3 uSun;
        varying vec3 vWP, vWN, vLP;
        vec3 gVehEm = vec3(0.0);
        float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        ${REFLECT_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec3 N = normalize(vWN), V = normalize(cameraPosition - vWP);
          // Sides are close to flat panels, so left alone they'd reflect one flat colour. Doors really do curve in
          // toward the roof and under toward the sill: bend the normal that way, and the sky, the horizon and the
          // road sweep down the body, which is what makes a car look like a car.
          float sideOn = 1.0 - abs(N.y);
          vec3 RN = normalize(N + vec3(0.0, (vLP.y - 0.82) * 0.62 * sideOn, 0.0));
          float facing = max(dot(RN, V), 0.0);
          float F = 0.05 + 0.95 * pow(1.0 - facing, 5.0);
        #if VKIND == 0
          // road film: thick along the sills and behind the wheels, thinning up the doors, in uneven sweeps
          float film = (1.0 - smoothstep(0.1, 1.05, vLP.y)) * (0.42 + 0.58 * vnoise(vec2(vLP.z * 2.1, vLP.y * 7.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.15, 0.125), film * 0.82);
          diffuseColor.rgb *= 0.92 + 0.1 * vnoise(vLP.zy * 13.0);
          gVehEm = reflCity(vWP, reflect(-V, RN)) * min(F * 2.0 + 0.035, 0.8) * (1.0 - film * 0.75);
        #elif VKIND == 1
          diffuseColor.rgb *= 0.14;
          gVehEm = reflCity(vWP, reflect(-V, RN)) * min(F * 2.4 + 0.1, 0.9);
        #elif VKIND == 2
          diffuseColor.rgb *= 0.3;
          gVehEm = reflCity(vWP, reflect(-V, RN)) * 0.62;
        #elif VKIND == 3
          diffuseColor.rgb *= 0.55;
          gVehEm = reflCity(vWP, reflect(-V, RN)) * 0.28;
        #elif VKIND == 4
          // dust on the sidewalls
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.145, 0.125), 0.45);
        #else
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.17, 0.15), (1.0 - smoothstep(0.1, 1.0, vLP.y)) * 0.4);
        #endif
        }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += gVehEm;`);
  };
  m.customProgramCacheKey = () => `vehicle-look-${kind}-${wheel ? 1 : 0}-${m.map ? 1 : 0}`;
}

// ------------------------------------------------------------------ the shadow under each vehicle

const MAX_SHADOWS = 1600;

export class GroundShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x050608, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vQuad;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvQuad = position.xz * 2.0;");
      // a rounded box, darkest under the body and gone a little beyond it
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vQuad;").replace("#include <color_fragment>", `#include <color_fragment>
        { vec2 d = abs(vQuad) - vec2(0.56, 0.74); float r = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
          diffuseColor.a = 0.78 * (1.0 - smoothstep(-0.32, 0.2, r)); }`);
    };
    mat.customProgramCacheKey = () => "vehicle-ground-shadow";
    this.mesh = new THREE.InstancedMesh(g, mat, MAX_SHADOWS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
  }
  begin() { this.n = 0; }
  add(x: number, z: number, tx: number, tz: number, length: number, width: number) {
    if (this.n >= MAX_SHADOWS) return;
    this.q.setFromAxisAngle(this.up, Math.atan2(tx, tz));
    this.m.compose(this.p.set(x, 0.045, z), this.q, this.s.set(width * 1.45, 1, length * 1.25));
    this.mesh.setMatrixAt(this.n++, this.m);
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
}
