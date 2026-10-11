// Central Park's rain, drawn (the sim side is world/rain.ts, stepped by the leaf):
//   - rain streaks falling round the camera: one draw, animated on the GPU, fewer on phones
//   - the mood: overcast sky, grey haze, dim light (stage.rain), the ground darkening and going glossy
//     (groundArt GROUND_RAIN)
//   - puddles spreading over the paths and drives: dark water that mirrors the overcast, rain rippling it
//   - where to land: Sheep Meadow's planting zone ringed in soft pulsing green, and a faint green beacon
//     over it you can see from anywhere in the park, through the rain and the fog
//
//   const rain = new RainView(city, layout, quality); scene.add(rain.root);
//   rain.update(dt, wall, leaf, camera, stage)    // every frame

import * as THREE from "three";
import type { CityData } from "../world/data";
import { rainField, RAIN, type RainField } from "../world/rain";
import type { Glider } from "../sim/glider";
import type { Stage, Quality } from "./stage";
import { GROUND_RAIN } from "./groundArt";

/** Sheep Meadow's planting zone (world/course.ts inMeadow) */
const MEADOW = { x0: 430, x1: 730, z0: 8290, z1: 8565 };
const PUDDLE_Y = 0.165;

export class RainView {
  readonly root = new THREE.Group();
  private field: RainField;
  private drops: THREE.Mesh;
  private dropU: Record<string, THREE.IUniform>;
  private puddles: THREE.InstancedMesh;
  private puddleU: Record<string, THREE.IUniform>;
  private ring: THREE.Mesh;
  private beacon: THREE.Mesh;
  private markU = { uTime: { value: 0 }, uShow: { value: 0 }, uCam: { value: new THREE.Vector3() } };
  private show = 0;
  private wetGround = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(city: CityData, layout: Parameters<typeof rainField>[1], readonly quality: Quality) {
    this.root.name = "rain";
    this.field = rainField(city, layout);
    GROUND_RAIN.box.value.set(this.field.x0, this.field.z0, this.field.x1, this.field.z1);

    // ---- the streaks
    const N = quality === "low" ? 1800 : quality === "medium" ? 5500 : 8500;
    const pos = new Float32Array(N * 4 * 3), seed = new Float32Array(N * 4 * 4), idx = new Uint32Array(N * 6);
    let r = 1234567;
    const rnd = () => ((r = Math.imul(r, 1664525) + 1013904223 >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      const a = rnd(), b = rnd(), c = rnd(), d = (i + 0.5) / N;
      for (let k = 0; k < 4; k++) {
        const j = i * 4 + k;
        pos.set([k === 1 || k === 2 ? 1 : -1, k >= 2 ? 1 : 0, 0], j * 3); // corner: across, along
        seed.set([a, b, c, d], j * 4);
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.dropU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmount: { value: 0 }, uWind: { value: new THREE.Vector2(1.2, 0.6) }, uBox: { value: quality === "low" ? 22 : 30 } };
    const dm = new THREE.ShaderMaterial({
      uniforms: this.dropU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uCam; uniform float uTime, uAmount, uBox; uniform vec2 uWind;
        attribute vec4 aSeed; varying float vA; varying float vT;
        void main() {
          const float H = 26.0, FALL = 9.5;
          float size = uBox * 2.0;
          vec3 fallV = vec3(uWind.x, -FALL, uWind.y);
          // world-anchored drops wrapped into a box round the camera
          vec3 base = aSeed.xyz * vec3(size, H, size) + fallV * uTime * (0.9 + aSeed.x * 0.2);
          vec3 p = mod(base - uCam - vec3(-uBox, -H * 0.4, -uBox), vec3(size, H, size)) + uCam + vec3(-uBox, -H * 0.4, -uBox);
          vec3 dir = normalize(fallV);
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(dir, toCam));
          float len = 0.5 + aSeed.y * 0.35, w = 0.007 + 0.005 * aSeed.z;
          float dist = length(cameraPosition - p);
          p += dir * len * position.y + side * w * (1.0 + dist * 0.03) * position.x;
          vT = position.y;
          // fewer drops in a lighter rain; none right in your face; fade out at the edge of the box
          vA = step(aSeed.w, uAmount) * smoothstep(0.8, 3.0, dist) * (1.0 - smoothstep(uBox * 0.7, uBox, dist));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vT;
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(0.74, 0.78, 0.85, vA * 0.24 * sin(vT * 3.14159));
        }`,
    });
    this.drops = new THREE.Mesh(g, dm);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 5;

    // ---- the puddles
    const pg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.puddleU = { uTime: { value: 0 }, uRain: { value: 0 }, uLow: { value: quality === "low" ? 1 : 0 } };
    const pm = new THREE.ShaderMaterial({
      uniforms: this.puddleU, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; varying float vSeed;
        void main() {
          vUv = position.xz;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uRain, uLow;
        varying vec2 vUv; varying vec3 vW; varying float vSeed;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        // rings spreading from raindrops: one drop per cell, at its own time
        float ripples(vec2 p, float t) {
          vec2 c = floor(p), f = fract(p) - 0.5;
          float s = 0.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            float h = h21(c + o);
            vec2 at = o + vec2(h21(c + o + 7.1), h21(c + o + 3.3)) - 0.5;
            float ph = fract(t * 0.9 + h);
            float d = length(f - at);
            float r = ph * 0.6;
            s += (1.0 - ph) * smoothstep(0.05, 0.0, abs(d - r)) * step(d, 0.6);
          }
          return s;
        }
        void main() {
          // a ragged edge (the ellipse is the puddle's full size)
          float n = vn(vUv * 2.3 + vSeed * 40.0) * 0.55 + vn(vUv * 5.1 - vSeed * 17.0) * 0.25;
          float r = length(vUv) + (n - 0.4) * 0.45;
          float water = smoothstep(0.92, 0.8, r);
          float rim = smoothstep(1.12, 0.9, r) * (1.0 - water);
          if (water + rim < 0.01) discard;
          vec3 V = normalize(cameraPosition - vW);
          float rp = uLow > 0.5 ? 0.0 : ripples(vW.xz * 2.2, uTime) + ripples(vW.xz * 3.1 + 11.0, uTime * 1.3) * 0.6;
          // a cheap mirror: the reflected ray, nudged by the ripples, sees the overcast above a fake skyline of
          // trees and buildings round the park (dark shapes by azimuth); glancing looks mirror more
          vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
          float az = atan(R.x, R.z) + rp * 0.06, el = R.y + rp * 0.04;
          float trees = 0.06 + 0.1 * vn(vec2(az * 9.0, 1.0)) + 0.06 * vn(vec2(az * 31.0, 4.0));
          float blocks = step(0.55, vn(vec2(az * 5.0, 7.0))) * (0.12 + 0.2 * vn(vec2(floor(az * 14.0), 2.0)));
          float sky = smoothstep(-0.01, 0.02, el - max(trees, blocks));
          vec3 skyCol = mix(vec3(0.30, 0.33, 0.37), vec3(0.18, 0.2, 0.23), clamp(el * 1.5, 0.0, 1.0));
          vec3 refl = mix(vec3(0.035, 0.035, 0.04), skyCol, sky);
          float fres = 0.12 + 0.88 * pow(1.0 - max(V.y, 0.0), 4.0);
          vec3 col = mix(vec3(0.02, 0.022, 0.026), refl, fres) + rp * 0.09 * uRain;
          float a = water * (0.82 + 0.15 * fres) + rim * 0.35;
          gl_FragColor = vec4(rim > water ? vec3(0.03, 0.028, 0.025) : col, a);
        }`,
    });
    this.puddles = new THREE.InstancedMesh(pg, pm, Math.max(1, this.field.puddles.length));
    this.puddles.count = 0;
    this.puddles.frustumCulled = false;
    this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // ---- where to land: Sheep Meadow ringed in green, and a beacon over it
    const { x0, x1, z0, z1 } = MEADOW;
    const ringGeo = new THREE.PlaneGeometry(x1 - x0 + 8, z1 - z0 + 8).rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { ...this.markU, uHalf: { value: new THREE.Vector2((x1 - x0) / 2, (z1 - z0) / 2) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
      vertexShader: /* glsl */ `varying vec2 vP; varying float vD; void main() { vP = position.xz; vec4 w = modelMatrix * vec4(position, 1.0); vD = length(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uShow; uniform vec2 uHalf; varying vec2 vP; varying float vD;
        void main() {
          // distance in from the meadow's edge (rounded corners)
          vec2 q = abs(vP) - (uHalf - 18.0);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 18.0; // < 0 inside
          float line = smoothstep(1.6, 0.0, abs(d + 2.0));
          float glow = smoothstep(7.0, 0.0, abs(d + 4.0)) * 0.08;
          float fill = step(d, 0.0) * 0.02;
          // a pulse running inward from the edge
          float pulse = 0.65 + 0.35 * sin(uTime * 2.2);
          float wave = smoothstep(2.0, 0.0, abs(-d - mod(uTime * 14.0, 70.0))) * 0.14 * step(d, 0.0);
          // (soft up close, where you're about to land: it's a guide, not a wall of light)
          // and low down a grazing view stretches the band into a wash: it fades as you come down to land
          float a = (line * pulse + glow + fill + wave) * uShow * mix(0.12, 1.0, smoothstep(6.0, 90.0, vD))
            * mix(0.22, 1.0, smoothstep(6.0, 45.0, cameraPosition.y));
          gl_FragColor = vec4(vec3(0.25, 1.0, 0.45) * a, 1.0);
        }`,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.set((x0 + x1) / 2, 0.2, (z0 + z1) / 2);
    this.ring.renderOrder = 4;
    const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: this.markU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform vec3 uCam; varying vec2 vUv; varying float vNear;
        void main() {
          vUv = uv;
          // a column turned to face you
          vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 f = normalize(uCam.xz - c.xz + 1e-4);
          vec3 side = vec3(-f.y, 0.0, f.x);
          vec3 w = c + side * position.x * 16.0 + vec3(0.0, position.y * 160.0, 0.0);
          vNear = smoothstep(40.0, 140.0, length(uCam.xz - c.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uShow; varying vec2 vUv; varying float vNear;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float core = pow(across, 6.0) * 0.9 + pow(across, 2.0) * 0.25;
          float up = (1.0 - vUv.y) * smoothstep(0.0, 0.04, vUv.y);
          float shimmer = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0);
          float a = core * up * shimmer * uShow * mix(0.25, 1.0, vNear) * 0.55;
          gl_FragColor = vec4(vec3(0.3, 1.0, 0.5) * a, 1.0);
        }`,
    });
    this.beacon = new THREE.Mesh(beamGeo, beamMat);
    this.beacon.position.set((x0 + x1) / 2, 0.2, (z0 + z1) / 2);
    this.beacon.frustumCulled = false;
    this.beacon.renderOrder = 6;
    this.ring.visible = this.beacon.visible = false;
    this.drops.visible = false;

    this.root.add(this.puddles, this.drops, this.ring, this.beacon);
  }

  update(dt: number, t: number, leaf: Glider, cam: THREE.Camera, stage: Stage, leafView?: { wet: number }) {
    const f = this.field, rain = leaf.state === "attached" ? 0 : leaf.rain;
    // the mood
    stage.rain = rain;
    this.wetGround = leaf.rainFor <= 0 ? 0 : Math.min(1, this.wetGround + dt / 8);
    GROUND_RAIN.amount.value = this.wetGround * 0.9;
    if (leafView) leafView.wet = leaf.wet;
    // the streaks
    this.drops.visible = rain > 0.01 && cam.position.y > -0.5;
    this.dropU.uCam.value.copy(cam.position);
    this.dropU.uTime.value = t;
    this.dropU.uAmount.value = rain;
    // the puddles: spread in as the rain goes on (none until it has rained a while)
    this.puddleU.uTime.value = t;
    this.puddleU.uRain.value = rain;
    let n = 0;
    if (leaf.rainFor > RAIN.puddleAfter) {
      const cx = cam.position.x, cz = cam.position.z, R = this.quality === "low" ? 160 : 260;
      for (const p of f.puddles) {
        const g = f.growth(p, leaf.rainFor);
        if (g <= 0 || Math.abs(p.x - cx) > R || Math.abs(p.z - cz) > R) continue;
        // (the shape eases out as it fills)
        const k = 1 - (1 - g) * (1 - g);
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), Math.atan2(-p.tz, p.tx));
        this.m.compose(this.v.set(p.x, PUDDLE_Y, p.z), this.q, this.s.set(p.rx * k, 1, p.rz * k));
        this.puddles.setMatrixAt(n++, this.m);
      }
    }
    this.puddles.count = n;
    this.puddles.instanceMatrix.needsUpdate = true;
    // where to land: once you're in the park
    const inPark = leaf.state === "flying" && f.inRain(leaf.pos.x, leaf.pos.z);
    this.show += ((inPark ? 1 : 0) - this.show) * Math.min(1, dt * 1.5);
    if (leaf.state !== "flying") this.show = Math.max(0, this.show - dt * 2);
    this.markU.uShow.value = this.show;
    this.markU.uTime.value = t;
    this.markU.uCam.value.copy(cam.position);
    this.ring.visible = this.beacon.visible = this.show > 0.01;
  }
}
