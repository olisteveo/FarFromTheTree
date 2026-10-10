// The edge of the playable corridor, made visible: a curtain of churning wind along both sides of
// the route (world/airflow.ts: the "wall of wind" that carries you back). It only shows when you
// get near it: faint streaks of air streaming back toward the route, thickest at street level.

import * as THREE from "three";
import type { CityData } from "../world/data";
import { AIR } from "../world/airflow";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
varying vec2 vUv;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d = distance(vWorld.xz, uCam.xz);
  float near = 1.0 - smoothstep(70.0, 170.0, d);
  if (near <= 0.0) discard;
  // long streaks along the wall, drifting and rising, broken up by slow churn
  vec2 p = vec2(vUv.x / 9.0 - uTime * 0.9, vUv.y / 2.2 - uTime * 0.25);
  float s = n(vec2(p.x * 0.6, p.y * 5.0)) * n(vec2(p.x * 1.7 + 3.1, p.y * 9.0 - uTime * 0.6));
  float streak = smoothstep(0.32, 0.62, s);
  float churn = 0.55 + 0.45 * n(vec2(vUv.x / 30.0 + uTime * 0.2, vUv.y / 25.0));
  float fall = (1.0 - smoothstep(10.0, 120.0, vUv.y)) * smoothstep(0.0, 1.5, vUv.y);
  float a = streak * churn * fall * near * 0.55;
  gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * a, a);
}`;

export class EdgeWall {
  readonly root: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(city: CityData) {
    const r = city.route, at = AIR.corridor - AIR.wallDepth * 0.5, H = 130, STEP = 8;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const side of [-1, 1]) {
      let prev = -1, u = 0, px = 0, pz = 0;
      for (let s = -40; s <= r.length + 40; s += STEP) {
        const p = r.at(Math.max(0, Math.min(r.length, s)));
        const x = p.x + p.tz * at * side, z = p.z - p.tx * at * side;
        // inside a bend the offset line folds back over itself: leave those bits out
        if (Math.abs(r.nearest(x, z).d - at) > 12) { prev = -1; continue; }
        if (prev >= 0) u += Math.hypot(x - px, z - pz);
        const v = pos.length / 3;
        pos.push(x, 0, z, x, H, z);
        uv.push(u, 0, u, H);
        if (prev >= 0) idx.push(prev, prev + 1, v, prev + 1, v + 1, v);
        prev = v; px = x; pz = z;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.root = new THREE.Mesh(g, this.mat);
    this.root.frustumCulled = false;
    this.root.name = "edgeWall";
    this.root.renderOrder = 2;
  }

  update(t: number, cam: THREE.Vector3) {
    this.root.visible = cam.y > -1;
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uCam.value as THREE.Vector3).copy(cam);
  }
}
