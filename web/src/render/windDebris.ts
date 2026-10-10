// Litter in the wind: dead leaves (every other leaf in the city) and scraps of paper that ride
// the same air the player does. They make the wind readable: they skitter along the gutters,
// swirl in the eddies at corners, shoot up the steam vents, lie still in the lee of a wall,
// and all kick up together when a gust front comes through. Purely visual.

import * as THREE from "three";
import type { AirSample, Airflow } from "../world/airflow";


function leafTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  // a little five-lobed dead leaf on the left half, a crumpled paper scrap on the right
  x.fillStyle = "#fff";
  x.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2, lobe = 0.55 + 0.45 * Math.abs(Math.sin(a * 2.5));
    const r = 13 * lobe;
    x.lineTo(16 + Math.sin(a) * r, 34 - Math.cos(a) * r);
  }
  x.fill();
  x.fillRect(15, 40, 2, 9);
  x.beginPath(); x.moveTo(38, 22); x.lineTo(60, 18); x.lineTo(62, 44); x.lineTo(36, 48); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WindDebris {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array;
  private v: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private kind: Uint8Array; // 0 leaf, 1 paper
  private alive: Uint8Array;
  private readonly n: number;
  private s: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
  private turn = 0;
  private seed = 1;
  enabled = true;

  /** count: how many bits of litter (fewer on low quality) */
  constructor(private flow: Airflow, count = 260) {
    const N = (this.n = count);
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3); this.rot = new Float32Array(N * 3); this.spin = new Float32Array(N * 3);
    this.kind = new Uint8Array(N); this.alive = new Uint8Array(N);
    const geo = new THREE.PlaneGeometry(0.24, 0.24);
    // two UV halves: leaf (left) and paper (right): the instance picks one via a uv offset attribute
    const half = new Float32Array(N);
    geo.setAttribute("uvHalf", new THREE.InstancedBufferAttribute(half, 1));
    const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float uvHalf;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2(vMapUv.x * 0.5 + uvHalf * 0.5, vMapUv.y);\n#endif");
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const paper = this.rnd() < 0.22;
      this.kind[i] = paper ? 1 : 0;
      half[i] = paper ? 1 : 0;
      const leafCols = [0x7a4a24, 0x8a5a2a, 0x6a3a1a, 0x9a6a32, 0x5a3a20, 0xa0522d];
      c.set(paper ? [0xe8e4d8, 0xd8d0c0, 0xf2f0ea][i % 3] : leafCols[i % leafCols.length]);
      this.mesh.setColorAt(i, c);
    }
  }

  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  private respawn(i: number, fx: number, fy: number, fz: number, under: boolean) {
    const a = this.rnd() * Math.PI * 2, d = 4 + this.rnd() * 34;
    const x = fx + Math.cos(a) * d, z = fz + Math.sin(a) * d;
    // mostly on or near the ground; some up in the air near the player
    const y = under ? fy + (this.rnd() - 0.5) * 4 : this.rnd() < 0.7 ? 0.05 + this.rnd() * 0.3 : Math.max(0.3, fy + (this.rnd() - 0.5) * 10);
    const b = this.flow.city.buildingAt(x, z);
    if (!under && b && y < b.h) { this.alive[i] = 0; return; }
    this.p.set([x, y, z], i * 3);
    this.v.set([0, 0, 0], i * 3);
    this.rot.set([this.rnd() * 6, this.rnd() * 6, this.rnd() * 6], i * 3);
    this.spin.set([(this.rnd() - 0.5) * 8, (this.rnd() - 0.5) * 8, (this.rnd() - 0.5) * 8], i * 3);
    this.alive[i] = 1;
  }

  update(dt: number, focus: THREE.Vector3, t: number) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const under = focus.y < -0.4;
    const fx = focus.x, fy = focus.y, fz = focus.z;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    // sample the wind for a sixth of them each frame (their velocity eases toward it in between)
    this.turn = (this.turn + 1) % 10;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      let x = this.p[o], y = this.p[o + 1], z = this.p[o + 2];
      const far = (x - fx) ** 2 + (z - fz) ** 2 > 42 * 42 || Math.abs(y - fy) > 30;
      if (!this.alive[i] || far) { this.respawn(i, fx, fy, fz, under); continue; }
      if (i % 10 === this.turn) {
        this.flow.sample(x, y, z, t, this.s);
        this.v[o] += (this.s.x - this.v[o]) * Math.min(1, dt * 10 * 3.2);
        this.v[o + 2] += (this.s.z - this.v[o + 2]) * Math.min(1, dt * 10 * 3.2);
        this.v[o + 1] += (this.s.y - this.v[o + 1]) * Math.min(1, dt * 10 * 1.6);
      }
      // they fall slowly (paper more slowly) and rest on the ground until the air's strong enough
      this.v[o + 1] -= (this.kind[i] ? 1.2 : 1.8) * dt;
      x += this.v[o] * dt; y += this.v[o + 1] * dt; z += this.v[o + 2] * dt;
      const floor = under ? -9.4 : 0.03;
      let resting = false;
      if (y < floor) {
        y = floor;
        const wind = Math.hypot(this.v[o], this.v[o + 2]);
        if (wind < 3.2) { this.v[o] *= 0.85; this.v[o + 2] *= 0.85; this.v[o + 1] = 0; resting = true; }
        else this.v[o + 1] = Math.abs(this.v[o + 1]) * 0.3 + (wind - 3.2) * 0.15; // skitter and hop
      }
      // into a wall: drop and slide down it
      if (!under) {
        const b = this.flow.city.buildingAt(x, z);
        if (b && y < b.h) { x = this.p[o]; z = this.p[o + 2]; this.v[o] *= -0.2; this.v[o + 2] *= -0.2; }
      }
      this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;
      const sp = resting ? 0.05 : Math.min(1, Math.hypot(this.v[o], this.v[o + 1], this.v[o + 2]) / 6);
      this.rot[o] += this.spin[o] * dt * sp; this.rot[o + 1] += this.spin[o + 1] * dt * sp; this.rot[o + 2] += this.spin[o + 2] * dt * sp;
      if (resting) { this.rot[o] = Math.PI / 2; } // lying flat
      q.setFromEuler(e.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]));
      this.mesh.setMatrixAt(i, m.compose(pos.set(x, y + 0.02, z), q, one));
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
