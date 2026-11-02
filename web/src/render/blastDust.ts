// What you see of a junction blast: grit and dust lifting off the road about a second before the gust arrives, then a
// fast sheet of it blowing down the side street. The warning, and the direction, are all a player gets to go on.

import * as THREE from "three";
import type { Airflow } from "../world/airflow";
import { blastGust, type Blast } from "../world/junctionBlasts";

const LEAD = 1.2, RANGE = 130, COUNT = 1400;

export class BlastDust {
  readonly points: THREE.Points;
  private p = new Float32Array(COUNT * 3);
  private v = new Float32Array(COUNT * 3);
  private age = new Float32Array(COUNT).fill(99);
  private size = new Float32Array(COUNT);
  private alpha = new Float32Array(COUNT);
  private next = 0;
  private near: Blast[] = [];

  constructor(private flow: Airflow, tex: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, premultipliedAlpha: true,
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.62, 0.58, 0.52) * a, a); }`,
    }));
    this.points.frustumCulled = false;
  }

  update(dt: number, focus: THREE.Vector3, t: number, viewH: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewH * 0.9;
    for (const b of this.flow.blasts.grid.around(focus.x, focus.z, RANGE, this.near)) {
      if (Math.hypot(b.x - focus.x, b.z - focus.z) > RANGE) continue;
      const coming = blastGust(b, t + LEAD), blowing = blastGust(b, t);
      if (coming <= 0.02) continue;
      let k = (blowing > 0.2 ? 55 : 28) * coming * dt + Math.random();
      while (k-- >= 1) {
        const j = this.next++ % COUNT, along = -b.back + Math.random() * (blowing > 0.2 ? b.back + b.len * 0.75 : b.back * 2), off = (Math.random() - 0.5) * b.half * 1.7;
        const speed = blowing > 0.2 ? 13 + Math.random() * 9 : 4 + Math.random() * 3;
        this.p.set([b.x + b.dx * along - b.dz * off, 0.3 + Math.random() * 1.2, b.z + b.dz * along + b.dx * off], j * 3);
        this.v.set([b.dx * speed + (Math.random() - 0.5), 0.7 + Math.random() * 1.6, b.dz * speed + (Math.random() - 0.5)], j * 3);
        this.age[j] = 0;
      }
    }
    for (let i = 0; i < COUNT; i++) {
      const a = (this.age[i] += dt);
      if (a > 1.5) { this.alpha[i] = 0; continue; }
      const o = i * 3;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
      this.size[i] = 1 + a * 2.6;
      this.alpha[i] = 0.16 * Math.min(1, a * 8) * (1 - a / 1.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
  }
}
