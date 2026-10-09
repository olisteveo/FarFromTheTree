// Things that move: the leaf itself, the wind made visible, steam, drifting
// leaves, the subway trains and the old tree in Columbus Park.

import * as THREE from "three";
import type { City } from "../world/city";
import { WORLD } from "../world/spec";
import { trainsAt, type WindField } from "../world/wind";
import { hash01 } from "../core/rng";

// ------------------------------------------------------------------ the leaf

function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const x = c.getContext("2d")!;
  // outline: a broad leaf with a pointed tip (tip at the top of the canvas)
  const path = new Path2D();
  path.moveTo(128, 500);
  path.bezierCurveTo(10, 420, 0, 220, 128, 12);
  path.bezierCurveTo(256, 220, 246, 420, 128, 500);
  const g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, "#b8521f");
  g.addColorStop(0.45, "#e0892c");
  g.addColorStop(0.8, "#f0b443");
  g.addColorStop(1, "#c9c14a");
  x.fillStyle = g;
  x.fill(path);
  // blotches
  x.save();
  x.clip(path);
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(${120 + Math.random() * 60},${40 + Math.random() * 40},20,${Math.random() * 0.18})`;
    x.beginPath();
    x.arc(Math.random() * 256, Math.random() * 512, 4 + Math.random() * 26, 0, 6.3);
    x.fill();
  }
  // veins
  x.strokeStyle = "rgba(255,226,170,0.55)";
  x.lineWidth = 5;
  x.beginPath(); x.moveTo(128, 500); x.lineTo(128, 30); x.stroke();
  x.lineWidth = 2.5;
  for (let i = 0; i < 7; i++) {
    const y = 440 - i * 58;
    for (const s of [-1, 1]) {
      x.beginPath(); x.moveTo(128, y); x.quadraticCurveTo(128 + s * 50, y - 30, 128 + s * (95 - i * 9), y - 80); x.stroke();
    }
  }
  x.restore();
  x.strokeStyle = "rgba(90,40,15,0.6)";
  x.lineWidth = 3;
  x.stroke(path);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class LeafView {
  readonly root = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private uniforms = { uTime: { value: 0 }, uFlutter: { value: 0.3 }, uTear: { value: 0 } };

  constructor() {
    const geo = new THREE.PlaneGeometry(0.22, 0.34, 8, 14);
    geo.rotateX(-Math.PI / 2); // lie flat, normal +Y, tip toward -Z ...
    geo.rotateY(Math.PI);      // ... then turn the tip to +Z (forward)
    this.mat = new THREE.MeshStandardMaterial({ map: leafTexture(), side: THREE.DoubleSide, alphaTest: 0.5, transparent: false, roughness: 0.65 });
    const U = this.uniforms;
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime, uFlutter;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float along = position.z / 0.17;
          float side = position.x / 0.11;
          transformed.y += sin(uTime * 13.0 + along * 2.4) * 0.012 * uFlutter * (along + 1.0);
          transformed.y += side * side * 0.025 - along * along * 0.01;
          transformed.y += sin(uTime * 21.0 + side * 3.0) * 0.006 * uFlutter * abs(side);`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTear;")
        .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
          { vec2 cell = floor(vMapUv * vec2(14.0, 24.0));
            float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
            float edge = abs(vMapUv.x - 0.5) * 2.0;
            if (n * 0.6 + (1.0 - edge) * 0.7 < uTear * 1.1) discard; }`);
    };
    const leaf = new THREE.Mesh(geo, this.mat);
    leaf.castShadow = true;
    // the seed it carries, tucked at the stem
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(1, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.5 }));
    seed.position.set(0, 0.018, -0.14);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.06, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b3a1a }));
    stem.position.set(0, 0, -0.19);
    this.root.add(leaf, seed, stem);
  }

  update(pos: THREE.Vector3, q: THREE.Quaternion, t: number, airspeed: number, integrity: number) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.uniforms.uTime.value = t;
    this.uniforms.uFlutter.value = 0.25 + Math.min(1.5, airspeed / 8) + (1 - integrity) * 0.8;
    this.uniforms.uTear.value = 1 - integrity;
  }
}

// ------------------------------------------------------------------ wind made visible

export class WindStreaks {
  readonly mesh: THREE.LineSegments;
  private n = 700;
  private p: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private pos: Float32Array;
  private col: Float32Array;
  private w = { x: 0, y: 0, z: 0 };
  enabled = true;

  constructor(private wind: WindField) {
    this.p = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.pos = new Float32Array(this.n * 6);
    this.col = new Float32Array(this.n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.n; i++) this.age[i] = 999;
  }

  update(dt: number, focus: THREE.Vector3, t: number) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const R = 34;
    const under = focus.y < -0.5;
    for (let i = 0; i < this.n; i++) {
      let x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      if (this.age[i] > this.life[i] || Math.abs(x - focus.x) > R || Math.abs(z - focus.z) > R || (under !== y < -0.5)) {
        x = focus.x + (Math.random() * 2 - 1) * R;
        z = focus.z + (Math.random() * 2 - 1) * R;
        y = under ? WORLD.subway.floor + 0.5 + Math.random() * 6.5 : Math.max(0.3, focus.y + (Math.random() * 2 - 1) * 16);
        if (under) x = WORLD.subway.x + (Math.random() * 2 - 1) * WORLD.subway.halfWidth;
        this.age[i] = 0;
        this.life[i] = 1.2 + Math.random() * 1.8;
      }
      const w = this.wind.sample(x, y, z, t, this.w);
      x += w.x * dt; y += w.y * dt; z += w.z * dt;
      this.age[i] += dt;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      const sp = Math.hypot(w.x, w.y, w.z);
      const k = 0.11;
      this.pos.set([x, y, z, x - w.x * k, y - w.y * k, z - w.z * k], i * 6);
      const life = this.age[i] / this.life[i];
      const a = Math.sin(Math.min(1, life) * Math.PI) * Math.min(1, sp / 9) * 0.32;
      this.col.set([a, a * 0.97, a * 0.92, 0, 0, 0], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ steam from the street

function softDot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Steam {
  readonly points: THREE.Points;
  private n = 1400;
  private p: Float32Array;
  private v: Float32Array;
  private age: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private next = 0;
  private w = { x: 0, y: 0, z: 0 };

  constructor(private city: City, private wind: WindField) {
    this.p = new Float32Array(this.n * 3);
    this.v = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(99);
    this.size = new Float32Array(this.n);
    this.alpha = new Float32Array(this.n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTex: { value: softDot() }, uScale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.95, 0.93, 0.9) * a, a); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, focus: THREE.Vector3, t: number, viewH: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewH * 0.9;
    // emit from plumes near the player
    for (const i of this.near(focus)) {
      const s = this.city.wind[i];
      if (s.kind !== "plume" || s.train) continue;
      const pulse = s.period > 0 ? 0.45 + 0.55 * Math.max(0, Math.sin(((t + s.phase) / s.period) * Math.PI * 2)) : 1;
      const rate = 26 * pulse;
      let k = rate * dt + Math.random();
      while (k-- >= 1) {
        const j = this.next++ % this.n;
        this.p.set([s.x + (Math.random() - 0.5) * 1.2, s.y + 0.2, s.z + (Math.random() - 0.5) * 1.2], j * 3);
        this.v.set([0, s.speed * 0.5, 0], j * 3);
        this.age[j] = 0;
      }
    }
    for (let j = 0; j < this.n; j++) {
      const a = (this.age[j] += dt);
      if (a > 4.5) { this.alpha[j] = 0; continue; }
      const x = this.p[j * 3], y = this.p[j * 3 + 1], z = this.p[j * 3 + 2];
      const w = this.wind.sample(x, y, z, t, this.w);
      for (let c = 0; c < 3; c++) {
        const target = c === 0 ? w.x : c === 1 ? w.y : w.z;
        this.v[j * 3 + c] += (target - this.v[j * 3 + c]) * Math.min(1, dt * 2);
        this.p[j * 3 + c] += this.v[j * 3 + c] * dt;
      }
      this.size[j] = 1.2 + a * 1.6;
      this.alpha[j] = Math.min(1, a * 3) * (1 - a / 4.5) * 0.32;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  private near(focus: THREE.Vector3): number[] {
    const out = new Set<number>();
    const c = this.city.index.cell;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const i of this.city.index.windsNear(focus.x + dx * c, focus.z + dz * c)) out.add(i);
    return [...out];
  }
}

// ------------------------------------------------------------------ the subway trains

export class Trains {
  readonly root = new THREE.Group();
  private body: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private max = 48;
  constructor() {
    const car = new THREE.BoxGeometry(1, 1, 1);
    this.body = new THREE.InstancedMesh(car, new THREE.MeshStandardMaterial({ color: 0xaab2bb, metalness: 0.85, roughness: 0.35 }), this.max * 6);
    const gm = new THREE.MeshBasicMaterial({ toneMapped: false });
    gm.color.setRGB(2.2, 2.0, 1.5);
    this.glow = new THREE.InstancedMesh(car, gm, this.max * 6);
    const hm = new THREE.MeshBasicMaterial({ toneMapped: false });
    hm.color.setRGB(6, 5.5, 4);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 8, 6), hm, this.max * 2);
    for (const m of [this.body, this.glow, this.heads]) m.frustumCulled = false;
    this.root.add(this.body, this.glow, this.heads);
  }
  update(t: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const sw = WORLD.subway;
    let i = 0, h = 0;
    for (const tr of trainsAt(t)) {
      if (i >= this.max * 6) break;
      const cx = (tr.x0 + tr.x1) / 2, w = tr.x1 - tr.x0;
      const len = (tr.z1 - tr.z0) / 6;
      for (let k = 0; k < 6; k++) {
        const z = tr.z0 + len * (k + 0.5);
        this.body.setMatrixAt(i, m.compose(p.set(cx, sw.floor + 2.1, z), q, s.set(w, 3.6, len - 0.8)));
        this.glow.setMatrixAt(i, m.compose(p.set(cx, sw.floor + 2.5, z), q, s.set(w + 0.04, 0.9, len - 2.4)));
        i++;
      }
      const head = tr.dir > 0 ? tr.z1 : tr.z0;
      for (const dx of [-0.8, 0.8]) this.heads.setMatrixAt(h++, m.compose(p.set(cx + dx, sw.floor + 1.2, head + tr.dir * 0.1), q, s.set(1, 1, 1)));
    }
    this.body.count = i; this.glow.count = i; this.heads.count = h;
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the old tree and its falling leaves

export function startTree(): THREE.Group {
  const g = new THREE.Group();
  const s = WORLD.start;
  const bark = new THREE.MeshStandardMaterial({ color: 0x4b3527, roughness: 1 });
  const base = new THREE.Vector3(s.x - 6.5, 0, s.z - 3);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 15, 9), bark);
  trunk.position.set(base.x, 7.5, base.z);
  trunk.castShadow = true;
  g.add(trunk);
  // a few big limbs, one reaching out to where the leaf hangs
  const limb = (to: THREE.Vector3, r: number) => {
    const from = new THREE.Vector3(base.x, 13, base.z);
    const d = to.clone().sub(from);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r, d.length(), 7), bark);
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    g.add(m);
  };
  limb(new THREE.Vector3(s.x, s.y + 0.25, s.z), 0.45);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.4;
    limb(new THREE.Vector3(base.x + Math.cos(a) * 7, 17 + (i % 3) * 2.5, base.z + Math.sin(a) * 7), 0.5);
  }
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), canopyMat, 26);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const cols = ["#d9822b", "#c4532a", "#e8b04a", "#b8521f", "#e39a3b"];
  for (let i = 0; i < 26; i++) {
    const a = hash01(i, 1) * 6.28, r = 2 + hash01(i, 2) * 6.5;
    p.set(base.x + Math.cos(a) * r, 18 + hash01(i, 3) * 8, base.z + Math.sin(a) * r);
    if (p.distanceTo(new THREE.Vector3(s.x, s.y, s.z)) < 5.5) p.y += 4;
    const k = 2.2 + hash01(i, 4) * 2.2;
    im.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), sc.set(k, k * 0.8, k)));
    im.setColorAt(i, c.set(cols[i % cols.length]));
  }
  im.castShadow = true;
  im.receiveShadow = true;
  g.add(im);
  return g;
}

export class DriftingLeaves {
  readonly mesh: THREE.InstancedMesh;
  private n = 160;
  private p: Float32Array;
  private spin: Float32Array;
  private w = { x: 0, y: 0, z: 0 };
  constructor(private wind: WindField) {
    const geo = new THREE.PlaneGeometry(0.16, 0.22);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(this.n * 3).fill(1e6);
    this.spin = new Float32Array(this.n);
    const c = new THREE.Color();
    const cols = ["#d9822b", "#c4532a", "#e8b04a", "#9c3b22", "#e39a3b"];
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, c.set(cols[i % cols.length]));
      this.spin[i] = Math.random() * 100;
    }
  }
  update(dt: number, focus: THREE.Vector3, t: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const R = 45;
    for (let i = 0; i < this.n; i++) {
      let x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      if (Math.abs(x - focus.x) > R || Math.abs(z - focus.z) > R || y < 0.05 || Math.abs(y - focus.y) > 40) {
        x = focus.x + (Math.random() * 2 - 1) * R;
        z = focus.z + (Math.random() * 2 - 1) * R;
        y = Math.max(0.5, focus.y + Math.random() * 30 - 8);
      }
      const w = this.wind.sample(x, y, z, t, this.w);
      x += w.x * dt * 0.9; y += (w.y * 0.9 - 1.3) * dt; z += w.z * dt * 0.9;
      this.p[i * 3] = x; this.p[i * 3 + 1] = Math.max(0.05, y); this.p[i * 3 + 2] = z;
      const sp = this.spin[i] + t;
      e.set(sp * 2.1, sp * 1.3, sp * 0.7);
      this.mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q.setFromEuler(e), s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
