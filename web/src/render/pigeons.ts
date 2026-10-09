// Pigeons: little flocks pecking on sidewalks and roof edges that burst into the air when
// the leaf comes close, wheel around and settle back a while later. Harmless; life.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData } from "../world/data";

interface Bird { hx: number; hy: number; hz: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; flap: number; seed: number }
interface Flock { x: number; y: number; z: number; birds: Bird[]; state: "ground" | "flying"; t: number }

const COLOURS = [0x6b6f78, 0x7a7e86, 0x5a5e66, 0x8a8a8a, 0x4a4a52, 0xb8b4ac];

export class Pigeons {
  readonly mesh: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  onScatter: (x: number, y: number, z: number) => void = () => {};

  constructor(city: CityData) {
    // body + head + two wings (wings flap via the instance's local scale trick below)
    const body = mergeGeometries([
      new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.85, 1.5),
      new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.08, 0.14),
      new THREE.ConeGeometry(0.015, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0.07, 0.21),
      new THREE.BoxGeometry(0.34, 0.015, 0.12).translate(0, 0.03, -0.02),
      new THREE.BoxGeometry(0.08, 0.01, 0.12).translate(0, 0.01, -0.2),
    ].map((g) => g.toNonIndexed()))!;
    this.mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 1400);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    // flocks every ~120 m along the route, on the sidewalk or a low roof edge
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let s = 150; s < city.route.length - 300; s += 90 + rnd() * 80) {
      const p = city.route.at(s);
      const side = rnd() < 0.5 ? -1 : 1;
      let x = p.x + p.tz * side * (8 + rnd() * 10), z = p.z - p.tx * side * (8 + rnd() * 10), y = 0.15;
      const b = city.buildingAt(x, z);
      if (b) { if (b.h > 30) continue; y = b.h; }
      const n = 6 + Math.floor(rnd() * 10);
      const birds: Bird[] = [];
      for (let i = 0; i < n; i++) {
        const hx = x + (rnd() - 0.5) * 4, hz = z + (rnd() - 0.5) * 4;
        birds.push({ hx, hy: y, hz, x: hx, y, z: hz, vx: 0, vy: 0, vz: 0, yaw: rnd() * 6.28, flap: rnd() * 10, seed: Math.floor(rnd() * 1e6) });
      }
      this.flocks.push({ x, y, z, birds, state: "ground", t: 0 });
    }
  }

  update(dt: number, leaf: THREE.Vector3, time: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    for (const f of this.flocks) {
      const dx = f.x - leaf.x, dz = f.z - leaf.z;
      const far = dx * dx + dz * dz > 200 * 200;
      if (far && f.state === "ground") continue;
      f.t += dt;
      const near = Math.hypot(dx, f.y - leaf.y, dz) < 9;
      if (f.state === "ground" && near) {
        f.state = "flying"; f.t = 0;
        for (const b of f.birds) {
          const a = Math.atan2(b.x - leaf.x, b.z - leaf.z) + (Math.random() - 0.5) * 1.6;
          b.vx = Math.sin(a) * (4 + Math.random() * 3); b.vz = Math.cos(a) * (4 + Math.random() * 3); b.vy = 3 + Math.random() * 3;
        }
        this.onScatter(f.x, f.y, f.z);
      }
      for (const b of f.birds) {
        if (f.state === "flying") {
          // flee, then wheel round in a loose circle and glide home after ~14 s
          const home = f.t > 14;
          const cx = home ? b.hx : f.x + Math.cos(f.t * 0.6 + b.seed) * 18, cy = home ? b.hy : f.y + 10 + Math.sin(f.t + b.seed) * 3, cz = home ? b.hz : f.z + Math.sin(f.t * 0.6 + b.seed) * 18;
          if (f.t > 1.2) { b.vx += (cx - b.x) * dt * 0.8; b.vy += (cy - b.y) * dt * 0.8; b.vz += (cz - b.z) * dt * 0.8; }
          const sp = Math.hypot(b.vx, b.vy, b.vz), max = 7;
          if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; b.vz *= max / sp; }
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          b.yaw = Math.atan2(b.vx, b.vz);
          b.flap += dt * 14;
          if (home && Math.hypot(b.x - b.hx, b.y - b.hy, b.z - b.hz) < 0.6) { b.x = b.hx; b.y = b.hy; b.z = b.hz; b.vx = b.vy = b.vz = 0; }
        }
        if (f.state === "flying" && f.t > 30) f.state = "ground";
        if (n >= 1400 || far) continue;
        const flying = b.vx !== 0 || b.vy !== 0;
        const peck = flying ? 0 : Math.max(0, Math.sin(time * 3 + b.seed)) * 0.4;
        e.set(peck, b.yaw, flying ? Math.sin(b.flap) * 0.3 : 0);
        q.setFromEuler(e);
        // wings: squash the instance's x when flapping (they're the wide part of the mesh)
        s.set(flying ? 0.45 + Math.abs(Math.sin(b.flap)) * 0.8 : 0.42, 1, 1);
        this.mesh.setMatrixAt(n, m.compose(p.set(b.x, b.y + 0.1, b.z), q, s));
        this.mesh.setColorAt(n, c.set(COLOURS[b.seed % COLOURS.length]));
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
