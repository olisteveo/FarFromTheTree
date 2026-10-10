// Dev test bed for PeopleView: http://localhost:5173/tools/people/test.html
//   ?mode=crowd (default) | lineup | dogs | clips | city
//   &n=600   &cam=x,y,z,tx,ty,tz   &t=fixed time   &q=low|medium|high
//   clips: every character side by side doing &clip=walk|stroll|brisk|jog|idle|talk|hail|cheer|sit (&speed=1.4 for walks)
//   city: the real crowd (world/crowd.ts) on the real sidewalks, blocks drawn as boxes: &at=x,z (default near Times Square)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PeopleView, type PeopleWalker } from "../../src/render/people";
import { CityData } from "../../src/world/data";
import { Traffic } from "../../src/world/traffic";
import { Crowd } from "../../src/world/crowd";
import { Blockers } from "../../src/world/blockers";
import { streetLayout } from "../../src/render/streetLayout";
import { StreetLife } from "../../src/world/streetlife";

const qs = new URLSearchParams(location.search);
const mode = qs.get("mode") ?? "crowd";
const N = Number(qs.get("n") ?? 600);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa4b0);
scene.fog = new THREE.Fog(0x9aa4b0, mode === "city" ? 150 : 40, mode === "city" ? 400 : 160);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 800);
camera.position.set(8, 5, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const sun = new THREE.DirectionalLight(0xffd2a0, 3.0);
sun.position.set(-30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
sun.shadow.bias = -0.0003;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xa8b4c8, 0x4a4038, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: mode === "city" ? 0x45484c : 0x8a8a8c, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = mode === "city" ? 0 : 0.15;
ground.receiveShadow = true;
scene.add(ground);

const people = new PeopleView();
const q = qs.get("q");
if (q === "low" || q === "medium" || q === "high") people.quality = q;
if (qs.has("lod")) people.forceLod = Number(qs.get("lod"));
scene.add(people.root);
const hud = document.getElementById("hud")!;

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

interface Sim { lane: number; dir: number; s0: number; speed: number; seed: number; h: number; pet?: number; idle: boolean; char?: string }
const sims: Sim[] = [];
const walkers: PeopleWalker[] = [];
const LEN = 120;
let crowd: Crowd | null = null;

function setup() {
  sims.length = 0;
  const v = people.variants.characters;
  if (mode === "clips") {
    v.forEach((c, i) => sims.push({ lane: i, dir: 1, s0: 0, speed: Number(qs.get("speed") ?? 1.4), seed: 1000 + i * 17, h: c === "kid" ? 1.2 : 1.72, idle: false, char: c }));
    return;
  }
  if (mode === "lineup" || mode === "dogs") {
    // one of each look in a row, idle (or walking in place with ?walk)
    const count = mode === "dogs" ? 8 : N;
    for (let i = 0; i < count; i++) sims.push({ lane: i, dir: 1, s0: 0, speed: 1.4, seed: 1000 + i * 17, h: 1.62 + h01(i * 31) * 0.26, pet: mode === "dogs" ? i % 4 : undefined, idle: !qs.has("walk") });
    return;
  }
  for (let i = 0; i < N; i++) {
    const lane = Math.floor(h01(i * 3 + 1) * 16);
    sims.push({ lane, dir: lane % 2 ? 1 : -1, s0: h01(i * 5 + 2) * LEN, speed: 0.8 + h01(i * 7 + 3) * 1.0, seed: 7 + i, h: 1.6 + h01(i * 11 + 4) * 0.3,
      pet: h01(i * 13 + 5) < 0.08 ? Math.floor(h01(i * 17 + 6) * 4) : undefined, idle: h01(i * 19 + 7) < 0.06 });
  }
}

async function setupCity() {
  const city = await CityData.load("/city.json");
  const traffic = new Traffic(city);
  const blockers = new Blockers(city);
  traffic.closed = blockers.list;
  crowd = new Crowd(traffic);
  crowd.attach(city, { street: streetLayout(city, { traffic, blockers, life: new StreetLife(city) }) });
  people.setProps(crowd.props);
  people.groundY = 0.15;
  const at = qs.get("at")?.split(",").map(Number) ?? [city.raw.landmarks.timesSquare[0], city.raw.landmarks.timesSquare[1] - 150];
  // blocks as plain boxes (the buildings near the focus), sidewalks as raised slabs
  const shape = (r: number[], holes: number[][] = []) => {
    const s = new THREE.Shape();
    for (let i = 0; i < r.length; i += 2) (i ? s.lineTo(r[i], -r[i + 1]) : s.moveTo(r[i], -r[i + 1]));
    for (const h of holes) { const p = new THREE.Path(); for (let i = 0; i < h.length; i += 2) (i ? p.lineTo(h[i], -h[i + 1]) : p.moveTo(h[i], -h[i + 1])); s.holes.push(p); }
    return s;
  };
  const geos: THREE.BufferGeometry[] = [], walks: THREE.BufferGeometry[] = [];
  for (const b of city.buildings) {
    if (Math.hypot(b.cx - at[0], b.cz - at[1]) > 420) continue;
    geos.push(new THREE.ExtrudeGeometry(shape(b.poly[0]), { depth: Math.min(b.h, 60), bevelEnabled: false }).rotateX(-Math.PI / 2));
  }
  for (const p of city.raw.sidewalk) {
    const r = p[0];
    if (Math.hypot(r[0] - at[0], r[1] - at[1]) > 700) continue;
    walks.push(new THREE.ExtrudeGeometry(shape(r, p.slice(1)), { depth: 0.15, bevelEnabled: false }).rotateX(-Math.PI / 2));
  }
  if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 })); m.castShadow = m.receiveShadow = true; scene.add(m); }
  if (walks.length) { const m = new THREE.Mesh(mergeGeometries(walks)!, new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 0.95 })); m.receiveShadow = true; scene.add(m); }
  if (!cam) { camera.position.set(at[0] + 25, 12, at[1] + 25); controls.target.set(at[0], 1, at[1]); }
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 300 });
}

function step(t: number) {
  walkers.length = 0;
  if (crowd) {
    const tgt = controls.target;
    crowd.update(t, tgt.x, tgt.z, 220);
    for (const w of crowd.now) {
      walkers.push({ x: w.x, z: w.z, tx: w.tx, tz: w.tz, phase: w.phase, speed: w.w.speed || w.v, v: w.v, seed: w.w.seed, h: w.w.h,
        pet: w.w.pet, pets: w.w.pets, act: w.act, char: w.w.char, y: w.y,
        flinch: qs.has("flinch") ? (t + w.w.seed * 0.37) % 9 : undefined });
    }
    sun.position.set(tgt.x - 30, 40, tgt.z + 20); sun.target.position.copy(tgt);
    return;
  }
  for (const s of sims) {
    if (mode === "clips") {
      const clip = qs.get("clip") ?? "walk";
      const walking = clip === "walk" || clip === "jog" || clip === "stroll" || clip === "brisk";
      walkers.push({ x: (s.lane - (sims.length - 1) / 2) * 1.3, z: 0, tx: 0, tz: 1, phase: walking ? t * s.speed : 0, speed: s.speed, seed: s.seed, h: s.h,
        act: walking ? (clip === "jog" ? "jog" : "walk") : clip, char: s.char, y: clip === "sit" ? 0.42 : undefined });
      continue;
    }
    if (mode === "lineup" || mode === "dogs") {
      const gap = mode === "dogs" ? 2.4 : 1.1;
      walkers.push({ x: (s.lane - (sims.length - 1) / 2) * gap, z: 0, tx: 0, tz: 1, phase: 0, speed: s.speed, seed: s.seed, h: s.h, idle: s.idle, pet: s.pet });
      continue;
    }
    const x = (s.lane - 7.5) * 2.2;
    const along = s.idle ? s.s0 : ((s.s0 + s.dir * s.speed * t) % LEN + LEN) % LEN;
    const flinch = (t + s.seed * 0.37) % 9;
    walkers.push({ x, z: along - LEN / 2, tx: 0, tz: s.dir, phase: s.speed * t, speed: s.speed, seed: s.seed, h: s.h, idle: s.idle, pet: s.pet,
      flinch: qs.has("flinch") ? flinch : undefined });
  }
}

const cam = qs.get("cam");
if (cam) {
  const v = cam.split(",").map(Number);
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
} else if (mode === "lineup" || mode === "clips") { camera.position.set(0, 1.6, 14); controls.target.set(0, 1.0, 0); }
else if (mode === "dogs") { camera.position.set(2, 1.6, 6); controls.target.set(0, 0.5, 0); }
controls.update();

let frames = 0, last = performance.now(), fps = 0;
const clock = new THREE.Clock();
const fixedT = qs.has("t") ? Number(qs.get("t")) : null;
let ready = false;
(window as unknown as { __people: unknown }).__people = { people, walkers, camera, controls, renderer, scene, get crowd() { return crowd; }, step, render: () => renderer.render(scene, camera) };

people.load("/models/").then(async () => {
  if (mode === "city") await setupCity();
  setup();
  const v = people.variants;
  hud.textContent = `${v.characters.length} characters, dogs: ${v.dogs.join(", ")}`;
  ready = true;
}).catch((e) => { hud.textContent = "load failed: " + e; console.error(e); });

renderer.setAnimationLoop(() => {
  if (!ready) return;
  const t = fixedT ?? clock.getElapsedTime();
  step(t);
  people.update(walkers, t, camera);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 1000) {
    fps = (frames * 1000) / (now - last); frames = 0; last = now;
    const info = renderer.info.render, st = people.stats;
    hud.textContent = `${walkers.length} walkers  ${fps.toFixed(0)} fps  ${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris  lod ${st.lod0}/${st.lod1}/${st.lod2} culled ${st.culled}`;
  }
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
