// Dev test bed for SubwayArt: http://localhost:5173/tools/subway/test.html
//   ?view=station (default) | tunnel | fare | train | street | platform
//   &st=Times        station name match for station/fare/platform views
//   &sub=ss&off=x&y=y  custom camera spot (look along +s)      &old=1  also show SubwayMesh's own props
//   &t=seconds       freeze the clock (trains)   &trainAt=s  an uptown train head at s when t=0   &bright=1  extra fill light
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CityData } from "../../src/world/data";
import { TUNNEL, Underground, trainsAt, type Train } from "../../src/world/underground";
import { SubwayMesh } from "../../src/render/subway";
import { SubwayArt, SUBWAY_ART } from "../../src/render/subwayArt";

const qs = new URLSearchParams(location.search);
const hud = document.getElementById("hud")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050403);
scene.fog = new THREE.FogExp2(0x0d0b09, Number(qs.get("fog") ?? 0.045));
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const hemi = new THREE.HemisphereLight(0xa8b4c8, 0x4a4038, qs.has("bright") ? 0.8 : 0.07);
scene.add(hemi);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.55, 0.9));
composer.addPass(new OutputPass());

const city = await CityData.load("/city.json");
const u = new Underground(city);
const sub = city.subway;
const subway = new SubwayMesh(u);
scene.add(subway.root);
const art = new SubwayArt(u, "/models/");
scene.add(art.root);
(window as unknown as { __subway: unknown }).__subway = { art, subway, camera, controls, renderer, u, THREE };

function look(s: number, off: number, y: number, ts: number, toff: number, ty: number) {
  const a = sub.at(s), b = sub.at(ts);
  camera.position.set(a.x + a.tz * off, y, a.z - a.tx * off);
  controls.target.set(b.x + b.tz * toff, ty, b.z - b.tx * toff);
  controls.update();
}

const stName = (qs.get("st") ?? "Times").toLowerCase();
const station = u.stations.find((s) => s.name.toLowerCase().includes(stName)) ?? u.stations[7];
const view = qs.get("view") ?? "station";
const t0 = performance.now();
let fixedT = qs.has("t") ? Number(qs.get("t")) : null;

await art.load().catch((e) => { hud.textContent = "load failed: " + e; throw e; });
art.retexture(subway.root);
if (!qs.has("old")) {
  // hide what SubwayArt replaces (everything after the walls/floor/ceiling, except the shafts, grates, flood and rats)
  const meshes = subway.root.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[];
  meshes.forEach((m, i) => {
    const g = m.geometry as THREE.PlaneGeometry;
    const col = (m.material as THREE.MeshStandardMaterial).color;
    const tablet = g.type === "PlaneGeometry" && g.parameters.width === 5;
    const streetRail = col && col.getHex() === 0x1f2a22;
    const globe = col && col.g > 2;
    if ((i >= 4 && i <= 16) || tablet || streetRail || globe) m.visible = false;
  });
}

const F = TUNNEL.floor, PY = SUBWAY_ART.platformTop;
if (qs.has("sub")) {
  const s = Number(qs.get("sub")), off = Number(qs.get("off") ?? 0), y = Number(qs.get("y") ?? F + 2);
  const back = qs.has("back") ? -1 : 1;
  look(s, off, y, s + 20 * back, Number(qs.get("toff") ?? off), y - 0.5);
} else if (view === "tunnel") {
  const s = Number(qs.get("s") ?? 900);
  look(s, -1.0, F + 2.2, s + 30, 1.5, F + 1.6);
} else if (view === "fare") {
  const fa = art.fareAreas.find((f) => f.station === station.name) ?? art.fareAreas[0];
  const w = art.width(fa.s);
  look(fa.s - 9, (w.hw - 9) * fa.side, PY + 2.2, fa.s, (w.hw - 3) * fa.side, PY + 0.8);
} else if (view === "platform") {
  look(station.ss - 50, 9.5, PY + 1.7, station.ss, 7, PY + 1.4);
} else if (view === "train") {
  fixedT = fixedT ?? 0;
  look(station.ss - 30, 7.5, PY + 1.6, station.ss - 10, 3.3, F + 2.2);
} else if (view === "street") {
  const sh = u.shafts.find((x) => x.kind === "stairs" && x.name === station.name) ?? u.shafts.find((x) => x.kind === "stairs")!;
  const L = Math.hypot(sh.tx, sh.tz) || 1;
  camera.position.set(sh.x - (sh.tx / L) * 7 + 2, 2.6, sh.z - (sh.tz / L) * 7 + 2);
  controls.target.set(sh.x, 0.8, sh.z);
  controls.update();
  scene.fog = new THREE.FogExp2(0xb9bcc4, 0.004);
  scene.background = new THREE.Color(0x9aa4b0);
  hemi.intensity = 1.2;
  const sun = new THREE.DirectionalLight(0xffd2a0, 2.5);
  sun.position.set(-30, 40, 20);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x77777a, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(sh.x, 0, sh.z);
  scene.add(ground);
} else {
  look(station.ss - 40, -9.5, PY + 1.7, station.ss, 10, PY + 1.0);
}

const trains: Train[] = [];
// ?trainAt=s: shift the clock so an uptown train's head is at s when t = 0
const trainOffset = qs.has("trainAt") ? trainTimeAt(Number(qs.get("trainAt"))) : view === "train" ? trainTimeAt(station.ss - 20) : 0;
let frames = 0, last = performance.now(), fps = 0;
renderer.setAnimationLoop(() => {
  const t = fixedT ?? (performance.now() - t0) / 1000;
  // in the train view, put a train through the station at a known time
  const tt = t + trainOffset;
  trainsAt(tt, sub.length, trains, u.noTrains);
  const underground = view === "street" ? 0 : 1;
  subway.update(tt, camera.position, underground);
  art.update(camera.position, underground, trains, camera.position);
  controls.update();
  composer.render();
  frames++;
  const now = performance.now();
  if (now - last > 1000) {
    fps = (frames * 1000) / (now - last); frames = 0; last = now;
    const info = renderer.info.render, st = art.stats();
    hud.textContent = `${view} @ ${station.name}  ${fps.toFixed(0)} fps  ${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris\nsubwayArt: ${st.calls} draws, ${(st.tris / 1000).toFixed(0)}k tris  fare areas ${art.fareAreas.length}`;
  }
});

/** the time at which an uptown train's head reaches s (searching forward from 0) */
function trainTimeAt(s: number) {
  const out: Train[] = [];
  for (let t = 0; t < 400; t += 0.25) {
    trainsAt(t, sub.length, out, u.noTrains);
    if (out.some((tr) => tr.dir > 0 && Math.abs(tr.head - s) < 3)) return t;
  }
  return 0;
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
