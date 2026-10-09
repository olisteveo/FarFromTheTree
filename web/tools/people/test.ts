// Dev test bed for PeopleView: http://localhost:5173/tools/people/test.html
//   ?mode=crowd (default) | lineup | dogs     &n=600   &cam=x,y,z,tx,ty,tz
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PeopleView, type PeopleWalker } from "../../src/render/people";

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
scene.fog = new THREE.Fog(0x9aa4b0, 40, 160);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(8, 5, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const sun = new THREE.DirectionalLight(0xffd2a0, 3.0);
sun.position.set(-30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
sun.shadow.bias = -0.0003;
scene.add(sun, new THREE.HemisphereLight(0xa8b4c8, 0x4a4038, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8a8a8c, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0.15;
ground.receiveShadow = true;
scene.add(ground);

const people = new PeopleView();
scene.add(people.root);
const hud = document.getElementById("hud")!;

const h01 = (n: number) => { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; };

interface Sim { lane: number; dir: number; s0: number; speed: number; seed: number; h: number; pet?: number; idle: boolean }
const sims: Sim[] = [];
const walkers: PeopleWalker[] = [];
const LEN = 120;

function setup() {
  sims.length = 0;
  if (mode === "lineup" || mode === "dogs") {
    // one of each look in a row, idle (or walking in place with ?walk)
    const count = mode === "dogs" ? 8 : N;
    for (let i = 0; i < count; i++) sims.push({ lane: i, dir: 1, s0: 0, speed: 1.4, seed: 1000 + i * 17, h: 1.62 + h01(i * 31) * 0.26, pet: mode === "dogs" ? i % 4 : undefined, idle: !qs.has("walk") });
    return;
  }
  for (let i = 0; i < N; i++) {
    const lane = Math.floor(h01(i * 3 + 1) * 16);
    sims.push({ lane, dir: lane % 2 ? 1 : -1, s0: h01(i * 5 + 2) * LEN, speed: 1.1 + h01(i * 7 + 3) * 0.6, seed: 7 + i, h: 1.6 + h01(i * 11 + 4) * 0.3,
      pet: h01(i * 13 + 5) < 0.08 ? Math.floor(h01(i * 17 + 6) * 4) : undefined, idle: h01(i * 19 + 7) < 0.06 });
  }
}

function step(t: number) {
  walkers.length = 0;
  for (const s of sims) {
    if (mode === "lineup" || mode === "dogs") {
      const gap = mode === "dogs" ? 2.4 : 1.1;
      walkers.push({ x: (s.lane - (sims.length - 1) / 2) * gap, z: 0, tx: 0, tz: 1, phase: 0, speed: s.speed, seed: s.seed, h: s.h, idle: s.idle, pet: s.pet });
      continue;
    }
    const x = (s.lane - 7.5) * 2.2;
    const along = s.idle ? s.s0 : ((s.s0 + s.dir * s.speed * t) % LEN + LEN) % LEN;
    const flinch = (t + s.seed * 0.37) % 9;
    walkers.push({ x, z: along - LEN / 2, tx: 0, tz: s.dir, phase: along * 1.6, speed: s.speed, seed: s.seed, h: s.h, idle: s.idle, pet: s.pet,
      flinch: qs.has("flinch") ? flinch : undefined });
  }
}

const cam = qs.get("cam");
if (cam) {
  const v = cam.split(",").map(Number);
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
} else if (mode === "lineup") { camera.position.set(0, 1.6, 9); controls.target.set(0, 1.0, 0); }
else if (mode === "dogs") { camera.position.set(2, 1.6, 6); controls.target.set(0, 0.5, 0); }
controls.update();

let frames = 0, last = performance.now(), fps = 0;
const clock = new THREE.Clock();
const fixedT = qs.has("t") ? Number(qs.get("t")) : null;
(window as unknown as { __people: unknown }).__people = { people, walkers, camera, controls, renderer };

people.load("/models/").then(() => {
  setup();
  const v = people.variants;
  hud.textContent = `${v.characters.length} characters, dogs: ${v.dogs.join(", ")}`;
}).catch((e) => { hud.textContent = "load failed: " + e; console.error(e); });

renderer.setAnimationLoop(() => {
  const t = fixedT ?? clock.getElapsedTime();
  step(t);
  people.update(walkers, t);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 1000) {
    fps = (frames * 1000) / (now - last); frames = 0; last = now;
    const info = renderer.info.render;
    hud.textContent = `${walkers.length} walkers  ${fps.toFixed(0)} fps  ${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris`;
  }
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
