// Everything that moves or matters in the street: traffic, subway trains, steam from
// the manholes, puddles, Con Ed holes behind barriers, the wind made visible, and the
// old tree in Battery Park. Only what's near the camera is drawn.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Airflow, AirSample } from "../world/airflow";
import { VEHICLE_SIZE, type VehicleKind } from "../world/traffic";
import { TRAIN, TUNNEL } from "../world/underground";

// ------------------------------------------------------------------ vehicles

function coloured(g: THREE.BufferGeometry, c: number | string): THREE.BufferGeometry {
  const col = new THREE.Color(c);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, l: number, x: number, y: number, z: number, c: number | string) => coloured(new THREE.BoxGeometry(w, h, l).translate(x, y, z), c);

function vehicleGeo(kind: VehicleKind): THREE.BufferGeometry {
  const s = VEHICLE_SIZE[kind];
  const parts: THREE.BufferGeometry[] = [];
  const wheel = (x: number, z: number) => coloured(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10).rotateZ(Math.PI / 2).translate(x, 0.36, z), 0x111111);
  const glass = 0x1d2630;
  if (kind === "cab" || kind === "car") {
    const body = 0xffffff; // tinted per instance
    parts.push(box(s.w, 0.7, s.l, 0, 0.62, 0, body));
    parts.push(box(s.w * 0.92, 0.55, s.l * 0.48, 0, 1.24, -0.2, glass));
    parts.push(box(s.w * 0.9, 0.06, s.l * 0.46, 0, 1.53, -0.2, body));
    if (kind === "cab") parts.push(box(0.7, 0.26, 0.28, 0, 1.68, -0.1, 0xfff2b0)); // roof light
    parts.push(box(0.4, 0.15, 0.05, -0.62, 0.7, s.l / 2, 0xfff6d8), box(0.4, 0.15, 0.05, 0.62, 0.7, s.l / 2, 0xfff6d8)); // headlights
    parts.push(box(0.35, 0.14, 0.05, -0.65, 0.72, -s.l / 2, 0xff2a1a), box(0.35, 0.14, 0.05, 0.65, 0.72, -s.l / 2, 0xff2a1a));
    for (const [x, z] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) parts.push(wheel(x, z));
  } else if (kind === "bus") {
    parts.push(box(s.w, 2.4, s.l, 0, 1.55, 0, 0xffffff));
    parts.push(box(s.w + 0.02, 0.95, s.l * 0.86, 0, 2.05, -0.3, glass));
    parts.push(box(s.w * 0.98, 1.2, 0.05, 0, 2.0, s.l / 2, glass));
    parts.push(box(s.w + 0.03, 0.22, s.l, 0, 1.05, 0, 0x1d4f9a));
    for (const [x, z] of [[-1.1, 4.2], [1.1, 4.2], [-1.1, -3.6], [1.1, -3.6]]) parts.push(wheel(x, z));
  } else {
    parts.push(box(s.w, 2.6, s.l * 0.7, 0, 1.75, -s.l * 0.13, 0xe8e8e8));
    parts.push(box(s.w, 1.6, s.l * 0.24, 0, 1.25, s.l * 0.36, 0xffffff));
    parts.push(box(s.w * 0.96, 0.7, 0.05, 0, 1.6, s.l * 0.48, glass));
    for (const [x, z] of [[-1.05, 2.8], [1.05, 2.8], [-1.05, -2.6], [1.05, -2.6]]) parts.push(wheel(x, z));
  }
  return mergeGeometries(parts)!;
}

const CAB = 0xf2b705;
/** Box-car shape to draw until the modelled vehicle loads. */
const fallbackShape = (k: VehicleKind): VehicleKind => (k === "cab" || k === "bus" || k === "truck" ? k : ["tourbus", "schoolbus", "firetruck", "garbage"].includes(k) ? "bus" : ["ambulance", "foodtruck", "van"].includes(k) ? "truck" : "car");
function paintFor(kind: VehicleKind, seed: number): number {
  switch (kind) {
    case "cab": return CAB;
    case "schoolbus": return 0xf2b400;
    case "bus": return 0xf4f4f0;
    case "tourbus": case "firetruck": return 0xc81e1e;
    case "police": case "ambulance": return 0xf6f6f2;
    case "garbage": return [0xf0f0ec, 0x2a6a3a][seed % 2];
    case "limo": return 0x111114;
    case "sports": return [0xd8261e, 0xf2b705, 0x1e3a8a, 0x111111, 0xe8e8e8][seed % 5];
    case "truck": case "van": case "foodtruck": return [0xf0f0ec, 0xc8382a, 0x2b5d9a, 0xe8e8e0, 0x3a7a4a][seed % 5];
    default: return CAR_COLOURS[seed % CAR_COLOURS.length];
  }
}
const CAR_COLOURS = [0x1c1c1e, 0xe8e8e8, 0x6d7278, 0x22344d, 0x7a1d1d, 0x2f4a3a, 0xb8b2a6, 0x3a3a3c];

export class TrafficView {
  readonly root = new THREE.Group();
  /** per vehicle kind: one instanced mesh per material part; "paint" parts get a colour per car */
  private parts = new Map<VehicleKind, { mesh: THREE.InstancedMesh; paint: boolean }[]>();
  /** simple box versions for the far distance (and until the models load) */
  private far = new Map<VehicleKind, THREE.InstancedMesh>();
  constructor(private flow: Airflow) {
    // simple box cars straight away, swapped for the modelled ones when they load
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
    for (const k of Object.keys(VEHICLE_SIZE) as VehicleKind[]) {
      const far = new THREE.InstancedMesh(vehicleGeo(fallbackShape(k)), mat, 900);
      far.frustumCulled = false; far.count = 0; far.receiveShadow = true;
      this.far.set(k, far);
      this.root.add(far);
      this.parts.set(k, []);
    }
    this.loadModels();
  }

  private setParts(kind: VehicleKind, list: { geo: THREE.BufferGeometry; mat: THREE.Material; paint: boolean }[]) {
    for (const old of this.parts.get(kind) ?? []) { this.root.remove(old.mesh); old.mesh.dispose(); }
    const made = list.map(({ geo, mat, paint }) => {
      const mesh = new THREE.InstancedMesh(geo, mat, 700);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.root.add(mesh);
      return { mesh, paint };
    });
    this.parts.set(kind, made);
  }

  private async loadModels() {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync("./models/vehicles.glb");
      // which modelled vehicle stands in for each traffic kind (cars alternate sedan / suv / van)
      const map = Object.fromEntries((Object.keys(VEHICLE_SIZE) as VehicleKind[]).map((k) => [k, [k === "car" ? "sedan" : k]])) as Record<VehicleKind, string[]>;
      for (const [kind, names] of Object.entries(map) as [VehicleKind, string[]][]) {
        const list: { geo: THREE.BufferGeometry; mat: THREE.Material; paint: boolean }[] = [];
        const obj = gltf.scene.getObjectByName(names[0]);
        if (!obj) continue;
        obj.updateMatrixWorld(true);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const geo = m.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().copy(m.matrixWorld).premultiply(new THREE.Matrix4().copy(obj.matrixWorld).invert()));
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          const name = (m.material as THREE.Material).name;
          const paint = name === "paint";
          if (paint) mat.color.set(0xffffff);
          if (name === "light_front" || name === "light_rear" || name === "sign") mat.emissiveIntensity = name === "sign" ? 2 : 2.6; // so they glow and bloom
          list.push({ geo, mat, paint });
        });
        if (list.length) this.setParts(kind, list);
      }
    } catch { /* keep the box cars */ }
  }

  update(focus: THREE.Vector3) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const counts = new Map<VehicleKind, number>(), farCounts = new Map<VehicleKind, number>();
    for (const v of this.flow.traffic.now) {
      const dx = v.x - focus.x, dz = v.z - focus.z, d2 = dx * dx + dz * dz;
      if (d2 > 320 * 320) continue;
      const kind = v.v.kind;
      const parts = this.parts.get(kind)!;
      q.setFromAxisAngle(Y, Math.atan2(v.tx, v.tz));
      m.compose(p.set(v.x, 0.02, v.z), q, s);
      c.set(paintFor(kind, v.v.colorSeed));
      // the full model up close, a simple shape in the distance (or until it loads)
      if (d2 < 160 * 160 && parts.length) {
        const i = counts.get(kind) ?? 0;
        if (i >= 700) continue;
        counts.set(kind, i + 1);
        for (const part of parts) {
          part.mesh.setMatrixAt(i, m);
          if (part.paint) part.mesh.setColorAt(i, c);
        }
      } else {
        const far = this.far.get(kind)!;
        const i = farCounts.get(kind) ?? 0;
        if (i >= 900) continue;
        farCounts.set(kind, i + 1);
        far.setMatrixAt(i, m);
        far.setColorAt(i, c);
      }
    }
    for (const [k, parts] of this.parts) {
      for (const part of parts) {
        part.mesh.count = counts.get(k) ?? 0;
        part.mesh.visible = part.mesh.count > 0;
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const [k, far] of this.far) {
      far.count = farCounts.get(k) ?? 0;
      far.visible = far.count > 0;
      far.instanceMatrix.needsUpdate = true;
      if (far.instanceColor) far.instanceColor.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ subway trains

export class TrainsView {
  readonly root = new THREE.Group();
  private cars: THREE.InstancedMesh;
  private windows: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  constructor(private flow: Airflow) {
    this.cars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xb4bcc4, metalness: 0.85, roughness: 0.3 }), 120);
    const wm = new THREE.MeshBasicMaterial({ toneMapped: false });
    wm.color.setRGB(2.0, 1.85, 1.4);
    this.windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wm, 120);
    const lm = new THREE.MeshBasicMaterial({ toneMapped: false });
    lm.color.setRGB(8, 7, 5);
    this.lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), lm, 40);
    for (const m of [this.cars, this.windows, this.lights]) { m.frustumCulled = false; m.count = 0; this.root.add(m); }
  }
  update(t: number, focus: THREE.Vector3) {
    const sub = this.flow.city.subway;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    let ci = 0, li = 0;
    const near = sub.nearest(focus.x, focus.z).s;
    for (const tr of this.flow.trainsAt(t)) {
      const lo = Math.min(tr.head, tr.tail), hi = Math.max(tr.head, tr.tail);
      if (hi < near - 600 || lo > near + 600) continue;
      const carL = TRAIN.length / 8;
      for (let k = 0; k < 8 && ci < 120; k++) {
        const ss = tr.lo0 + carL * (k + 0.5);
        if (ss < 0 || ss > sub.length || ss < lo - carL * 0.3 || ss > hi + carL * 0.3) continue;
        const a = sub.at(ss);
        // the track's lateral offset uses the same sign as Polyline.nearest's "off"
        const px = a.x + a.tz * tr.off, pz = a.z - a.tx * tr.off;
        q.setFromAxisAngle(Y, Math.atan2(a.tx, a.tz));
        this.cars.setMatrixAt(ci, m.compose(p.set(px, TUNNEL.floor + 0.6 + TRAIN.height / 2, pz), q, s.set(TRAIN.width, TRAIN.height, carL - 0.9)));
        this.windows.setMatrixAt(ci, m.compose(p.set(px, TUNNEL.floor + 0.6 + TRAIN.height * 0.62, pz), q, s.set(TRAIN.width + 0.04, 1.0, carL - 3)));
        ci++;
      }
      const hd = sub.at(Math.max(0, Math.min(sub.length, tr.head)));
      const headOut = Math.abs(tr.head - (tr.dir > 0 ? tr.lo0 + TRAIN.length : tr.lo0)) < 0.5;
      for (const d of headOut ? [-0.9, 0.9] : []) {
        if (li >= 40) break;
        const px = hd.x + hd.tz * (tr.off + d), pz = hd.z - hd.tx * (tr.off + d);
        this.lights.setMatrixAt(li++, m.compose(p.set(px + hd.tx * tr.dir * 0.2, TUNNEL.floor + 1.6, pz + hd.tz * tr.dir * 0.2), q.identity(), s.set(1, 1, 1)));
      }
    }
    this.cars.count = ci; this.windows.count = ci; this.lights.count = li;
    for (const mm of [this.cars, this.windows, this.lights]) mm.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ steam, puddles, manholes

function softDot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class SteamView {
  readonly points: THREE.Points;
  private n = 2400;
  private p: Float32Array; private v: Float32Array; private age: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private next = 0;
  constructor(private flow: Airflow) {
    this.p = new Float32Array(this.n * 3);
    this.v = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(99);
    this.size = new Float32Array(this.n);
    this.alpha = new Float32Array(this.n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTex: { value: softDot() }, uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vec3(0.93, 0.93, 0.95) * a, a); }`,
    }));
    this.points.frustumCulled = false;
  }
  update(dt: number, focus: THREE.Vector3, t: number, viewH: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = viewH * 0.9;
    const life = this.flow.life;
    const near = life.steamGrid.around(focus.x, focus.z, 140, []);
    const seen = new Set();
    for (const st of near) {
      if (seen.has(st)) continue;
      seen.add(st);
      const puff = 0.55 + 0.45 * Math.max(0, Math.sin(((t + st.phase) / st.period) * 6.283));
      let k = 30 * puff * dt + Math.random();
      while (k-- >= 1) {
        const j = this.next++ % this.n;
        this.p.set([st.x + (Math.random() - 0.5) * 0.8, 0.15, st.z + (Math.random() - 0.5) * 0.8], j * 3);
        this.v.set([0, st.speed * 0.6, 0], j * 3);
        this.age[j] = 0;
      }
    }
    // warm station air steaming out of the "way out" stairs into the cold
    for (const sh of this.flow.under.shaftGrid.around(focus.x, focus.z, 120, [])) {
      if (sh.kind !== "stairs" || !sh.out || seen.has(sh)) continue;
      seen.add(sh);
      let k = 14 * dt + Math.random();
      while (k-- >= 1) {
        const j = this.next++ % this.n;
        this.p.set([sh.x + (Math.random() - 0.5) * 3, 0.4, sh.z + (Math.random() - 0.5) * 3], j * 3);
        this.v.set([0, 2.5 + Math.random() * 2, 0], j * 3);
        this.age[j] = 0;
      }
    }
    for (let j = 0; j < this.n; j++) {
      const a = (this.age[j] += dt);
      if (a > 5) { this.alpha[j] = 0; continue; }
      this.v[j * 3 + 1] *= 1 - dt * 0.5;
      this.v[j * 3] += (Math.random() - 0.5) * dt * 2; this.v[j * 3 + 2] += (Math.random() - 0.5) * dt * 2;
      this.p[j * 3] += this.v[j * 3] * dt; this.p[j * 3 + 1] += this.v[j * 3 + 1] * dt; this.p[j * 3 + 2] += this.v[j * 3 + 2] * dt;
      this.size[j] = 1.4 + a * 2.2;
      this.alpha[j] = Math.min(1, a * 3) * (1 - a / 5) * 0.4;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

export function streetHazards(flow: Airflow): THREE.Group {
  const g = new THREE.Group();
  const life = flow.life;
  // puddles: dark mirror-still water in the gutters
  const pud = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.02, metalness: 0.3 }), life.puddles.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  life.puddles.forEach((d, i) => pud.setMatrixAt(i, m.compose(p.set(d.x, 0.045, d.z), q.setFromAxisAngle(Y, d.ang), s.set(d.rx, 1, d.rz))));
  pud.receiveShadow = true;
  g.add(pud);
  // steam manhole covers
  const cover = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.6 }), life.steam.length);
  life.steam.forEach((st, i) => cover.setMatrixAt(i, m.compose(p.set(st.x, 0.04, st.z), q.identity(), s.set(1, 1, 1))));
  g.add(cover);
  // open manholes: a black hole ringed by orange-and-white barriers
  const hole = new THREE.InstancedMesh(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 }), life.manholes.length);
  const barrier = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.9, 0.08).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 }), life.manholes.length * 4);
  life.manholes.forEach((mh, i) => {
    hole.setMatrixAt(i, m.compose(p.set(mh.x, 0.05, mh.z), q.identity(), s.set(1, 1, 1)));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      barrier.setMatrixAt(i * 4 + k, m.compose(p.set(mh.x + Math.sin(a) * 1.1, 0, mh.z + Math.cos(a) * 1.1), q.setFromAxisAngle(Y, a), s.set(1, 1, 1)));
    }
  });
  g.add(hole, barrier);
  return g;
}

// ------------------------------------------------------------------ the wind, made visible

/** Streaks that flow with the wind around the camera: gold where it helps you uptown,
 *  blue where it blows against you, white where it lifts. */
export class WindStreaks {
  readonly mesh: THREE.LineSegments;
  private n = 560;
  private flip = 0;
  private p: Float32Array; private age: Float32Array; private life: Float32Array;
  private pos: Float32Array; private col: Float32Array;
  private s: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
  enabled = true;
  constructor(private flow: Airflow) {
    this.p = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(999);
    this.life = new Float32Array(this.n);
    this.pos = new Float32Array(this.n * 6);
    this.col = new Float32Array(this.n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false;
  }
  update(dt: number, focus: THREE.Vector3, t: number) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const R = 28, under = focus.y < -0.4;
    const route = this.flow.city.route;
    const rt = route.at(route.nearest(focus.x, focus.z).s);
    // half the streaks each frame (each moves two frames' worth): the same look for half the wind samples
    this.flip ^= 1;
    dt *= 2;
    for (let i = this.flip; i < this.n; i += 2) {
      let x = this.p[i * 3], y = this.p[i * 3 + 1], z = this.p[i * 3 + 2];
      if (this.age[i] > this.life[i] || Math.abs(x - focus.x) > R || Math.abs(z - focus.z) > R || Math.abs(y - focus.y) > 14 || (under !== y < -0.4)) {
        x = focus.x + (Math.random() * 2 - 1) * R;
        z = focus.z + (Math.random() * 2 - 1) * R;
        y = under ? TUNNEL.floor + 0.6 + Math.random() * 5.5 : Math.max(0.3, focus.y + (Math.random() * 2 - 1) * 12);
        this.age[i] = 0;
        this.life[i] = 0.8 + Math.random() * 1.4;
      }
      const w = this.flow.sample(x, y, z, t, this.s);
      x += w.x * dt; y += w.y * dt; z += w.z * dt;
      this.age[i] += dt;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      const sp = Math.hypot(w.x, w.y, w.z) || 1;
      const k = 0.09 + sp * 0.004;
      this.pos.set([x, y, z, x - w.x * k, y - w.y * k, z - w.z * k], i * 6);
      const fade = Math.sin(Math.min(1, this.age[i] / this.life[i]) * Math.PI) * Math.min(1, sp / 8) * 0.45;
      const along = (w.x * rt.tx + w.z * rt.tz) / sp, lift = w.y / sp;
      // gold = tailwind uptown, blue = headwind, white = updraft
      let r = 0.8, g = 0.8, b = 0.8;
      if (lift > 0.5) { r = 1; g = 1; b = 1; }
      else if (along > 0.3) { r = 1; g = 0.78; b = 0.4; }
      else if (along < -0.3) { r = 0.45; g = 0.65; b = 1; }
      this.col.set([r * fade, g * fade, b * fade, 0, 0, 0], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the last tree in Battery Park

export function lastTree(at: { x: number; z: number }, leafAt: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x46392f, roughness: 1 });
  const base = new THREE.Vector3(at.x, 0, at.z);
  const parts: THREE.BufferGeometry[] = [];
  const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const d = to.clone().sub(from);
    const geo = new THREE.CylinderGeometry(r1, r0, d.length(), 8, 1, true);
    geo.translate(0, d.length() / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    geo.translate(from.x, from.y, from.z);
    parts.push(geo.toNonIndexed());
  };
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    limb(from, to, r, r * 0.7);
    if (depth === 0) return;
    for (let i = 0; i < (depth > 3 ? 2 : 3); i++) {
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(), 0.4 + rnd() * 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.2 + rnd());
      d.y = Math.max(0.1, d.y);
      grow(to, d.normalize(), len * 0.7, r * 0.66, depth - 1);
    }
  };
  grow(base, new THREE.Vector3(0, 1, 0), 6, 0.9, 6);
  // the branch the last leaf hangs from
  limb(new THREE.Vector3(at.x, 7.5, at.z), leafAt.clone().add(new THREE.Vector3(0, 0.25, 0)), 0.32, 0.03);
  const m = new THREE.Mesh(mergeGeometries(parts)!, bark);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

// ------------------------------------------------------------------ people on the sidewalks

export class CrowdView {
  readonly mesh: THREE.InstancedMesh;
  readonly dogs: THREE.InstancedMesh;
  readonly leads: THREE.LineSegments;
  readonly root = new THREE.Group();
  private leadPos: Float32Array;
  constructor(private flow: Airflow) {
    const body = mergeGeometries([
      coloured(new THREE.CylinderGeometry(0.19, 0.25, 1.05, 8).translate(0, 0.62, 0), 0xffffff),   // coat (tinted)
      coloured(new THREE.CylinderGeometry(0.09, 0.08, 0.5, 6).translate(-0.09, 0.25, 0), 0x1a1a1c), // legs
      coloured(new THREE.CylinderGeometry(0.09, 0.08, 0.5, 6).translate(0.09, 0.25, 0), 0x1a1a1c),
      coloured(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.3, 0), 0xc89a7a),               // head
      coloured(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8).translate(0, 1.42, 0), 0x2a2a2a),    // hat
      coloured(new THREE.BoxGeometry(0.34, 0.08, 0.2).translate(0, 1.12, 0.02), 0xb03a2a),          // scarf
    ])!;
    this.mesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 1800);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    // a dog: body, head, snout, ears, legs and a tail (breeds by scale and colour)
    const dog = mergeGeometries([
      coloured(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.85, 1.9).translate(0, 0.32, 0), 0xffffff),
      coloured(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.46, 0.3), 0xffffff),
      coloured(new THREE.BoxGeometry(0.08, 0.07, 0.12).translate(0, 0.43, 0.42), 0xffffff),
      coloured(new THREE.BoxGeometry(0.05, 0.1, 0.03).translate(-0.07, 0.55, 0.28), 0xffffff),
      coloured(new THREE.BoxGeometry(0.05, 0.1, 0.03).translate(0.07, 0.55, 0.28), 0xffffff),
      ...[[-0.08, 0.18], [0.08, 0.18], [-0.08, -0.18], [0.08, -0.18]].map(([x, z]) => coloured(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 5).translate(x, 0.13, z), 0xffffff)),
      coloured(new THREE.CylinderGeometry(0.015, 0.025, 0.22, 4).rotateX(-0.8).translate(0, 0.42, -0.34), 0xffffff),
    ])!;
    this.dogs = new THREE.InstancedMesh(dog, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 400);
    this.dogs.frustumCulled = false;
    this.dogs.count = 0;
    this.dogs.castShadow = true;
    this.leadPos = new Float32Array(400 * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(this.leadPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.leads = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8a1a1a }));
    this.leads.frustumCulled = false;
    this.root.add(this.mesh, this.dogs, this.leads);
  }
  update() {
    const coats = [0x2a2a30, 0x5a2a2a, 0x2a3a5a, 0x6b5a40, 0x1e1e1e, 0x3a4a3a, 0x8a7a6a, 0x4a2a4a, 0x9a3a2a, 0x2a5a5a, 0xc8b89a, 0x3a3a50];
    // terrier, dachshund, golden, pug: [scale x, y, z], colour
    const breeds: [number, number, number, number][] = [[0.8, 0.85, 0.8, 0xe8e2d6], [0.75, 0.6, 1.25, 0x6a3a1a], [1.35, 1.35, 1.3, 0xd8a050], [0.85, 0.8, 0.75, 0xd8c8a8]];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let n = 0, d = 0;
    for (const w of this.flow.crowd.now) {
      if (n >= 1800) break;
      q.setFromAxisAngle(Y, Math.atan2(w.tx, w.tz));
      const k = w.w.h / 1.55;
      this.mesh.setMatrixAt(n, m.compose(p.set(w.x, 0.15 + Math.abs(Math.sin(w.phase * 2)) * 0.04, w.z), q, s.set(1, k, 1)));
      this.mesh.setColorAt(n, c.set(coats[w.w.seed % coats.length]));
      n++;
      if (w.w.pet !== undefined && d < 400) {
        const [bx, by, bz, col] = breeds[w.w.pet];
        // trotting beside and a little ahead, on the street side
        const rx = -w.tz, rz = w.tx;
        const dx = w.x + rx * 0.85 + w.tx * 0.5, dz = w.z + rz * 0.85 + w.tz * 0.5;
        const trot = Math.abs(Math.sin(w.phase * 4)) * 0.03;
        this.dogs.setMatrixAt(d, m.compose(p.set(dx, 0.15 + trot, dz), q, s.set(bx, by, bz)));
        this.dogs.setColorAt(d, c.set(col));
        this.leadPos.set([w.x + rx * 0.25, 0.15 + 0.95 * k, w.z + rz * 0.25, dx + w.tx * 0.3 * bz, 0.15 + 0.48 * by, dz + w.tz * 0.3 * bz], d * 6);
        d++;
      }
    }
    this.mesh.count = n;
    this.dogs.count = d;
    this.leads.geometry.setDrawRange(0, d * 2);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dogs.instanceMatrix.needsUpdate = true;
    this.leads.geometry.attributes.position.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.dogs.instanceColor) this.dogs.instanceColor.needsUpdate = true;
  }
}
