// Far From the Tree (web build): the last leaf in the city, from Battery Park to
// Central Park through real Manhattan.
//
// URL options (testing and screenshots):
//   ?q=low|medium|high      render quality (default picked from the GPU)
//   ?at=s[,height]          start flying at route distance s (height above the street)
//   ?sub=ss                 start flying in the subway at subway distance ss
//   ?cam=x,y,z,yaw,pitch    free camera (WASD/QE, drag to look) instead of the game
//   ?fly=1                  autopilot

import * as THREE from "three";
import GUI from "lil-gui";
import { Leaderboard } from "./game/leaderboard";
import { SubwayArt } from "./render/subwayArt";
import { CentralPark } from "./render/centralPark";
import { StreetFurniture } from "./render/streetFurniture";
import { SubwaySigns } from "./render/subwaySigns";
import { WindDebris } from "./render/windDebris";
import { Minimap } from "./game/minimap";
import { Discoveries } from "./game/discoveries";
import { TouchControls, isTouchDevice } from "./game/touch";
import { useTouchWording } from "./game/tutorial";
import { PeopleView, type PeopleWalker } from "./render/people";
import { CityData } from "./world/data";
import { makeCourse } from "./world/course";
import { Landmarks } from "./world/landmarks";
import { landmarkMeshes, landmarkSolids } from "./render/landmarks";
import { Achievements } from "./game/achievements";
import { Airflow, AIR } from "./world/airflow";
import { TUNNEL } from "./world/underground";
import { Glider, FLIGHT } from "./sim/glider";
import { Stage, type Quality } from "./render/stage";
import { buildFacadeTextures } from "./render/facades";
import { BuildingsMesh } from "./render/buildings";
import { addInfill } from "./render/architectureInfill"; // architecture: gap infill
import { GroundMesh } from "./render/ground";
import { FarCity } from "./render/farCity"; // far city
import { SubwayMesh } from "./render/subway";
import { SubwayEntrances, deepOpenings, streetOpenings } from "./render/subwayEntrances";
import { LeafView } from "./render/leaf";
import { FacadePropsView } from "./render/facadeProps";
import { Pigeons } from "./render/pigeons";
import { blockerMeshes } from "./render/blockers";
import { Chinatown } from "./render/chinatown";
import { EdgeWall } from "./render/edgeWall";
import { PauseMenu } from "./game/pauseMenu";
import { CrowdView, SteamView, TrafficView, TrainsView, WindStreaks, lastTree, streetHazards } from "./render/life";
import { Input } from "./game/input";
import { Hud } from "./game/hud";
import { Audio } from "./game/audio";
import { Recorder, sampleAt, type RunLog } from "./game/recorder";
import { Tutorial } from "./game/tutorial";
import { playIntro } from "./game/intro";
import { LeafMeter } from "./game/leafmeter";
import { clamp } from "./core/rng";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudEl = document.getElementById("hud")!;
hudEl.innerHTML = `<div class="loading">Loading Manhattan…</div>`;

function pickQuality(): Quality {
  const q = params.get("q");
  if (q === "low" || q === "medium" || q === "high") return q;
  // phones and tablets: keep it light
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (isTouchDevice() && Math.min(screen.width, screen.height) < 900)) return "low";
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  const r = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/Intel|UHD|Iris|Mali|Adreno|Apple M1/i.test(r)) return "medium";
  return "high";
}

const stage = new Stage(canvas, pickQuality());

/** low quality (phones, small laptops): less simulated around you, fewer effects */

const LOW = stage.quality === "low";
const city = await CityData.load();
// ---- architecture (render/architectureInfill.ts): infill buildings for the gaps in the open data (vacant lots,
// missing footprints, slivers) join city.buildings before anything reads them, so the flight model, the wind
// and the facade props treat them like every other building
await addInfill(city);
// ---- end architecture
const flow = new Airflow(city);
// the basketball courts sit where four of the old-park building sites were: those sites go
{
  const courtSites = new Set(flow.streetLayout.courts.map((c) => c.site).filter((i) => i >= 0));
  (city.raw as { sites: typeof city.raw.sites }).sites = city.raw.sites.filter((_, i) => !courtSites.has(i));
}
const tex = buildFacadeTextures();
const buildings = new BuildingsMesh(city, tex);
// Central Park plants its own trees (render/centralPark.ts): the ground only does Battery Park's and the streets'
const parkBounds = flow.parkLayout.bounds;
const ground = new GroundMesh(city, { skipTree: (x, z) => x > parkBounds.x0 && x < parkBounds.x1 && z > parkBounds.z0 && z < parkBounds.z1, holes: streetOpenings(flow.under), waterHoles: deepOpenings(flow.under) });
// ---- the far city (render/farCity.ts): the rest of Manhattan, the waterfronts across the rivers, the bridges
// and the harbour to the horizon. It loads public/far.dat in a worker after start and updates itself each
// frame; the detailed buildings stop at the detail distance and the far versions take over beyond it.
const farCity = new FarCity(city, stage.sun, stage.hemi, { quality: stage.quality, waterMaterial: ground.water.material as THREE.Material, clear: flow.streetLayout.courts.map((c) => ({ x: c.x, z: c.z, hw: c.hw, hd: c.hd, yaw: c.yaw })) });
{
  // phones (low) skip the far city: decoding ~92k buildings is a big memory spike an iPhone tab can't
  // take; they get a foggy November horizon instead (the view and the haze close in, stage.ts)
  const detail = stage.quality === "low" ? 600 : stage.quality === "medium" ? 750 : 900;
  if ("setDrawDistance" in buildings) (buildings as { setDrawDistance(m: number): void }).setDrawDistance(detail);
  if (!LOW) {
    farCity.setDetailDistance(detail);
    stage.scene.add(farCity.root);
    farCity.load().catch((e) => console.warn("far city didn't load", e));
  }
}
// ---- end far city
const subway = new SubwayMesh(flow.under);
const leafView = new LeafView();
const traffic = new TrafficView(flow);
const trains = new TrainsView(flow);
// the modelled subway: trains, track, stations, fare control (the simple versions show until it loads)
const subwayArt = new SubwayArt(flow.under);
// Central Park: the Pond, Gapstow Bridge, Wollman Rink, rocks, lamps, benches, bare elms and planes
const centralPark = new CentralPark(city, { layout: flow.parkLayout });
let subwayArtReady = false;
subwayArt.load().then(() => { subwayArtReady = true; subwayArt.retexture(subway.root); subway.legacy.visible = false; trains.root.visible = false; })
  .catch((e) => console.warn("subway art didn't load", e));
// ---- subway entrances, stairwells and air vents (render/subwayEntrances.ts): the street entrance styles,
// the stairwells and passages down to the stations, the big vents with their fans and plumes. The holes
// they need are cut out of the pavement (GroundMesh holes, above) and the tunnel (subway.ts). Their
// light fittings join the subway's lamp list so the camera's point lights follow you down the stairs.
const entrances = new SubwayEntrances(flow.under, {
  quality: stage.quality,
  // (one real light per ~6 m of stairwell is plenty: the fittings glow anyway, and packing all eight of the
  // camera's point lights into one short stairwell blew the white tile out into a haze)
  onLamp: (x, y, z) => {
    if (subway.lampGrid.at(x, z).some((q) => Math.hypot(q.x - x, q.y - y, q.z - z) < 6)) return;
    const l = { x, y, z, station: true }; subway.lamps.push(l); subway.lampGrid.add(l, x - 1, z - 1, x + 1, z + 1);
  },
});
entrances.load().catch((e) => console.warn("subway entrances didn't load", e));
stage.scene.add(entrances.root);
// ----
const steam = new SteamView(flow);
const streaks = new WindStreaks(flow, stage.quality === "low" ? 220 : 560);
const facadeProps = new FacadePropsView(flow.facades);
// fire-escape landings, awnings, canopies, shed roofs, lot fences and hoardings, cranes: solid
buildings.attachFacades(flow.facades, true);
const crowdView = new CrowdView(flow);
// modelled, animated people and dogs (the simple crowd shows until they've loaded)
// the crowd walks the real sidewalks (block loops) once it has the city (the headless pilots: see world/crowd.ts)
flow.crowd.attach(city, { street: flow.streetLayout });
const people = new PeopleView(900);
people.quality = stage.quality;
let peopleReady = false;
// (phones keep the simple crowd: the animated people are heavy, and on iPhones their animation
// textures came out garbled into shards across the screen; ?people=1 forces them on to test)
if (!LOW || params.get("people") === "1") people.load().then(() => { peopleReady = true; crowdView.root.visible = false; people.setProps(flow.crowd.props); }).catch((e) => console.warn("people didn't load", e));
const flinchAt = new Map<number, number>();
const peopleList: PeopleWalker[] = [];
const peoplePool: PeopleWalker[] = [];
Object.assign(window, { ffttPeople: people }); // for tools/people/bench.ts
const pigeons = new Pigeons(city);
const landmarks = new Landmarks(city);
landmarkSolids(landmarks, flow.facades);
const blockerView = blockerMeshes(flow.blockers);
// ---- chinatown (render/chinatown.ts): paifang gates close the festival streets (they replace the stand-in lantern
// curtains once loaded), lanterns over the streets, neon signs, and the modelled Manhattan Bridge with its arch
const chinatown = new Chinatown(city, flow.blockers, { quality: stage.quality, festival: blockerView.userData.festival, farCity: LOW ? null : farCity });
chinatown.load().catch((e) => console.warn("chinatown didn't load", e));
stage.scene.add(chinatown.root);
// ---- the edge of the corridor: a wall of wind you can see when you get near it
const edgeWall = new EdgeWall(city);
stage.scene.add(edgeWall.root);
// ----
stage.scene.add(blockerView, pigeons.mesh, landmarkMeshes(landmarks), crowdView.root, people.root, facadeProps.root, buildings.root, ground.root, subway.root, subwayArt.root, centralPark.root, leafView.root, traffic.root, trains.root, steam.points, streaks.mesh, streetHazards(flow));
// ---- street furniture (render/streetFurniture.ts): lamps, live signals, street name blades, hydrants,
// mailboxes, baskets, newsstands, carts, bike docks, bus stops, kiosks, sheds, plaza bollards, steam
// stacks, parked cars. Its colliders are streetFurniture.layout.colliders (not wired into the sim here).
const streetFurniture = new StreetFurniture(city, { traffic: flow.traffic, life: flow.life, blockers: flow.blockers, quality: stage.quality, layout: flow.streetLayout });
stage.scene.add(streetFurniture.root);

// ------------------------------------------------------------------ the start: the last leaf on the last tree
const course = makeCourse(city);
const treeAt = course.tree;
const startPos = new THREE.Vector3(course.start.x, course.start.y, course.start.z);
const toward = course.start.heading;
stage.scene.add(lastTree(treeAt, startPos));
const leaf = new Glider(city, flow, { x: startPos.x, y: startPos.y, z: startPos.z, heading: toward });

function placeAt() {
  const at = params.get("at")?.split(",").map(Number);
  const sub = params.get("sub");
  if (at) {
    const p = city.route.at(at[0]);
    leaf.pos.set(p.x, at[1] ?? 8, p.z);
    leaf.heading = Math.atan2(p.tx, p.tz);
    leaf.detach();
  } else if (sub) {
    const p = city.subway.at(Number(sub));
    leaf.pos.set(p.x, (TUNNEL.floor + TUNNEL.ceiling) / 2, p.z);
    leaf.heading = Math.atan2(p.tx, p.tz);
    leaf.lane = "subway";
    leaf.detach();
  }
}
placeAt();

const input = new Input();
const hud = new Hud(hudEl, city);
const leaderboard = new Leaderboard(hudEl);
// touch screens: a thumb stick and buttons
const touch = isTouchDevice() ? new TouchControls(document.body, input) : null;
if (touch) document.body.classList.add("is-touch");
// finding the subway: big signs at every way in, and a beam + pointer to the next one ahead
const subwaySigns = new SubwaySigns(city, flow.under, hudEl);
// litter riding the wind: makes the air readable
const debris = new WindDebris(flow, stage.quality === "low" ? 120 : 260);
stage.scene.add(debris.mesh);
let lastGust = -1;
// the minimap, bottom right (top left on touch screens)
const minimap = new Minimap(hudEl, city, flow.under, flow.blockers, { x: city.raw.landmarks.sheepMeadow[0], z: city.raw.landmarks.sheepMeadow[1] });
// the wind's secrets: hidden currents (remembered, shown on the minimap once found) and dust devils
const discoveries = new Discoveries(flow.features);
minimap.features = flow.features;
minimap.found = discoveries.found;
stage.scene.add(subwaySigns.root);
const audio = new Audio(city);
audio.lowMusic = LOW;
// phones only allow sound to start inside a gesture: unlock it on every tap/click/key until it runs
// (and again if the browser suspends it, e.g. after switching apps)
for (const ev of ["touchend", "pointerup", "click", "keydown"] as const) addEventListener(ev, () => { if (!audio.running) audio.unlock(); }, { capture: true, passive: true });
// finding a hidden current: a toast and a rush of wind; riding a known one: just the rush
discoveries.onFind = (html, kind) => {
  if (html) hud.notify(html, kind === "jet" ? 4.5 : 3);
  audio.play(kind === "devil" ? "corkscrew_whoosh" : "whoosh_drop", { vol: html ? 0.85 : 0.45 });
};
const leafMeter = new LeafMeter(hudEl);
pigeons.onScatter = (x, y, z) => audio.play("pigeon_flap", { at: [x, y + 1, z], vol: 1, world: true });
const recorder = new Recorder(canvas, stage.quality);
if (touch) useTouchWording();
const tutorial = new Tutorial(hudEl, params.get("tutorial") === "1");
const achievements = new Achievements(landmarks);
achievements.onUnlock = (a) => {
  hud.notify(`<b>${a.name}</b><br/><span style="opacity:.75">${a.desc}</span>`, 4.5);
  audio.ui("achievement_chime");
  recorder.event("achievement", a.name);
};

// ------------------------------------------------------------------ replay (?replay=<session>/<run>)
let replay: RunLog | null = null;
let replayT = 0, replaySpeed = 1, replayPaused = false;
const replayArg = params.get("replay");
if (replayArg) {
  const [ses, run] = replayArg.split("/");
  try {
    const r = await fetch(`/__rec/${ses}/run/run${run}.json`);
    if (r.ok) { replay = await r.json(); leaf.detach(); recorder.enabled = false; }
  } catch { /* no recording */ }
}

const inMeadow = course.inMeadow;

// ------------------------------------------------------------------ camera
const cam = stage.camera;
const camPos = new THREE.Vector3().copy(startPos).add(new THREE.Vector3(3, 1, -3));
let camYaw = leaf.heading;
const look = new THREE.Vector3();
const freeCam = params.get("cam")?.split(",").map(Number);
let freeYaw = 0, freePitch = 0;
const freePos = new THREE.Vector3();
if (freeCam) { freePos.set(freeCam[0], freeCam[1], freeCam[2]); freeYaw = THREE.MathUtils.degToRad(freeCam[3] ?? 0); freePitch = THREE.MathUtils.degToRad(freeCam[4] ?? 0); }
// The title screen: a different view of the city behind it every time (x, y, z, yaw, pitch in degrees),
// drifting slowly; letting go cuts to the leaf on its tree.
const SHOWCASE: number[][] = [
  [-860, 8, 2150, -90, 8],      // Chinatown: a red bus up the street, the bridge arch beyond
  [-331, 45, 2038, 84, -8],     // over the rooftops toward the towers
  [-601, 7, 2331, -172, -5],    // a festival gate across Mulberry St
  [-738, 7, 2103, 94, -4],      // the wide gate
  [-560, 60, 2200, -150, -25],  // high over Chinatown
  [-1380, 55, 1700, -128, 4],   // the Manhattan Bridge's tower
  [-930, 5, 2085, -119, 10],    // the arch and colonnade at Canal St
  [700, 7, 6679, -90, -5],      // Times Square, packed solid
  [760, 9, 7505, 21, -2],       // the parade and its turkey
];
let showcase = !freeCam && !params.get("at") && !params.get("sub") && !params.get("replay") && params.get("fly") !== "1" && params.get("showcase") !== "0";
let showT = 0, showYaw = 0;
if (showcase) {
  const v = SHOWCASE[Math.floor(Math.random() * SHOWCASE.length)];
  freePos.set(v[0], v[1], v[2]); showYaw = freeYaw = THREE.MathUtils.degToRad(v[3]); freePitch = THREE.MathUtils.degToRad(v[4]);
}
const viewing = () => !!freeCam || showcase;

function blocked(p: THREE.Vector3): boolean {
  if (leaf.pos.y > -0.4 && p.y < 0.3 && !flow.under.openingAt(p.x, p.z)) return true;
  if (p.y < -0.4 || (leaf.pos.y < -0.4 && p.y < 1)) return flow.under.sdf(p.x, p.y, p.z) < 0.35;
  const b = city.buildingAt(p.x, p.z);
  return !!b && p.y < b.h + 0.3;
}

function updateCamera(dt: number, t: number) {
  if (showcase) {
    // a slow look around
    showT += dt;
    const yaw = showYaw + Math.sin(showT * 0.07) * 0.12;
    const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(freePitch), Math.sin(freePitch), Math.cos(yaw) * Math.cos(freePitch));
    cam.position.copy(freePos);
    cam.lookAt(freePos.clone().add(f));
    cam.fov = 50;
    cam.updateProjectionMatrix();
    return;
  }
  if (freeCam) {
    const f = new THREE.Vector3(Math.sin(freeYaw) * Math.cos(freePitch), Math.sin(freePitch), Math.cos(freeYaw) * Math.cos(freePitch));
    const r = new THREE.Vector3(-Math.cos(freeYaw), 0, Math.sin(freeYaw));
    const sp = (input.held("ShiftLeft") ? 120 : 30) * dt;
    if (input.held("KeyW")) freePos.addScaledVector(f, sp);
    if (input.held("KeyS")) freePos.addScaledVector(f, -sp);
    if (input.held("KeyD")) freePos.addScaledVector(r, sp);
    if (input.held("KeyA")) freePos.addScaledVector(r, -sp);
    if (input.held("KeyE")) freePos.y += sp;
    if (input.held("KeyQ")) freePos.y -= sp;
    cam.position.copy(freePos);
    cam.lookAt(freePos.clone().add(f));
    return;
  }
  const p = leaf.pos;
  if (leaf.state === "attached") {
    const a = leaf.heading + Math.PI * 0.42 + Math.sin(t * 0.12) * 0.35; // beside the leaf, the city behind it
    cam.position.set(p.x + Math.sin(a) * 1.25, p.y + 0.75 + Math.sin(t * 0.3) * 0.1, p.z + Math.cos(a) * 1.25);
    cam.lookAt(p.x, p.y + 0.05, p.z);
    cam.fov = 50;
    cam.updateProjectionMatrix();
    camPos.copy(cam.position);
    camYaw = leaf.heading;
    return;
  }
  // chase: behind the direction of travel, leaning toward where the wind is taking you
  const v = leaf.vel;
  const vh = Math.hypot(v.x, v.z);
  let want = leaf.heading;
  if (vh > 1.5) {
    let d = Math.atan2(v.x, v.z) - want;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    want += d * clamp((vh - 1.5) / 6, 0, 0.8);
  }
  let d = want - camYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * (1 - Math.exp(-dt * 3));
  const under = p.y < -0.4;
  const speed = v.length();
  const dist = under ? 2.2 : 2.6 + Math.min(2.5, speed * 0.07);
  const height = under ? 0.5 : 0.8;
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const desired = new THREE.Vector3(p.x - fx * dist, p.y + height, p.z - fz * dist);
  const from = p.clone().add(new THREE.Vector3(0, 0.15, 0));
  let ok = desired.clone();
  for (let i = 1; i <= 10; i++) {
    const q = from.clone().lerp(desired, i / 10);
    if (blocked(q)) { ok = from.clone().lerp(desired, Math.max(0.05, (i - 1.5) / 10)); break; }
  }
  camPos.lerp(ok, 1 - Math.exp(-dt * 9));
  if (camPos.distanceTo(p) > 14) camPos.copy(ok);
  cam.position.copy(camPos);
  look.set(p.x + fx * 1.8 + v.x * 0.06, p.y + 0.2 + v.y * 0.03, p.z + fz * 1.8 + v.z * 0.06);
  cam.lookAt(look);
  // inside a gust front the air buffets the camera a little
  if (leaf.state === "flying" && leaf.lane !== "subway") {
    const g = flow.gustAt(city.route.nearest(p.x, p.z).s, leaf.clock);
    if (g > 0.05) cam.rotateZ(Math.sin(t * 23) * 0.006 * g + Math.sin(t * 13.7) * 0.004 * g);
  }
  // speed widens the view; a layer drop kicks it
  const kick = Math.max(0, 1 - (leaf.clock - leaf.boost.t) / 0.6) * 12;
  cam.fov += (clamp(66 + speed * 0.75, 66, 100) + kick - cam.fov) * (1 - Math.exp(-dt * 4));
  cam.updateProjectionMatrix();
}

if (freeCam) {
  let drag = false;
  canvas.addEventListener("pointerdown", () => (drag = true));
  addEventListener("pointerup", () => (drag = false));
  addEventListener("pointermove", (e) => { if (drag) { freeYaw -= e.movementX * 0.003; freePitch = clamp(freePitch - e.movementY * 0.003, -1.5, 1.5); } });
}

// ------------------------------------------------------------------ tuning panel (G)
const gui = new GUI({ title: "Tuning (G)" });
gui.hide();
const fg = gui.addFolder("Flight");
for (const k of Object.keys(FLIGHT) as (keyof typeof FLIGHT)[]) fg.add(FLIGHT, k, 0, Math.max(1, FLIGHT[k] * 3), 0.01);
const ag = gui.addFolder("Wind");
for (const k of Object.keys(AIR) as (keyof typeof AIR)[]) ag.add(AIR, k, 0, Math.max(1, AIR[k] * 3), 0.1);
gui.add(streaks, "enabled").name("wind streaks");
// a tuned flight model doesn't go on the leaderboard
gui.onChange((e) => { if (e.object !== streaks) leaderboard.eligible = false; });

// ------------------------------------------------------------------ loop
const autopilot = params.get("fly") === "1";
if (autopilot || freeCam || params.get("at") || params.get("sub") || params.get("replay")) leaderboard.eligible = false;
// the flight sim's step: 240 Hz, or 120 Hz on low quality (the test pilots fly at 120 Hz too)
const STEP = LOW ? 1 / 120 : 1 / 240;
let lowFrame = 0;
let last = performance.now(), acc = 0, wall = 0, bestS = 0;
let underMix = 0;
let lastHint = "";

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Esc / P pauses a run (and resumes); while paused the world stands still and only draws
  if ((input.hit("Escape") || input.hit("KeyP")) && leaf.state === "flying" && !replay) setPaused(!pause.open);
  pause.update(leaf.state === "flying" && !replay && !introPlaying);
  if (pause.open) input.endFrame();
  tick(pause.open ? 0 : dt, true);
  stage.adapt(dt); // drop the resolution if the frame rate sags (phones)
  requestAnimationFrame(frame);
}

function tick(dt: number, render: boolean) {
  wall += dt;
  input.update(dt);
  if (introPlaying) { input.endFrame(); input.state.pitch = input.state.roll = 0; }
  if (input.hit("KeyT") && tutorial.active) tutorial.skip();
  if (input.hit("KeyG")) (gui as unknown as { _hidden: boolean })._hidden ? gui.show() : gui.hide();
  if (replay) {
    if (input.hit("Space")) replayPaused = !replayPaused;
    if (input.hit("ArrowRight")) replayT += 5;
    if (input.hit("ArrowLeft")) replayT = Math.max(0, replayT - 5);
    if (input.hit("BracketRight")) replaySpeed *= 2;
    if (input.hit("BracketLeft")) replaySpeed /= 2;
  }
  if (input.hit("KeyR") && !replay) restartRun();
  if (input.anyKey) {
    audio.start();
    if (leaf.state === "attached" && !input.hit("KeyG") && !freeCam) { showcase = false; leaf.detach(); recorder.start(leaf); leaderboard.startRun(); }
  }
  if (autopilot) {
    if (leaf.state === "attached") { leaf.detach(); recorder.start(leaf); }
    const n = city.route.nearest(leaf.pos.x, leaf.pos.z);
    const ahead = city.route.at(n.s + 25);
    let d = Math.atan2(ahead.x - leaf.pos.x, ahead.z - leaf.pos.z) - leaf.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    input.state.roll = clamp(-d * 2.2, -1, 1);
    input.state.pitch = clamp((leaf.pos.y - 6) * 0.25 - leaf.vel.y * 0.15, -1, 1);
    input.state.spread = leaf.pos.y < 3;
  }

  if (replay) {
    if (!replayPaused) replayT += dt * replaySpeed;
    const sm = sampleAt(replay, replayT);
    if (sm) {
      leaf.pos.set(sm.p[0], sm.p[1], sm.p[2]); leaf.vel.set(sm.v[0], sm.v[1], sm.v[2]);
      leaf.heading = sm.h; leaf.bank = sm.b; leaf.alpha = sm.a; leaf.integrity = sm.hp; leaf.time = sm.t; leaf.clock = sm.t;
      leaf.lane = sm.lane as typeof leaf.lane;
      leaf.state = replayT >= (replay.samples.at(-1)?.t ?? 0) && replay.result?.state === "dead" ? "dead" : "flying";
      leaf.failure = replay.result?.failure ?? "";
      (leaf as unknown as { updateQuat(s: number): void }).updateQuat(0);
    }
    flow.traffic.update(leaf.clock, leaf.pos.x, leaf.pos.z, LOW ? 260 : 400);
  } else if (!freeCam) {
    acc += dt;
    // (on low quality the traffic and the crowd move every other frame: phones' CPUs are slow)
    if (!showcase && (!LOW || (lowFrame ^= 1))) {
      flow.traffic.update(leaf.clock, leaf.pos.x, leaf.pos.z, LOW ? 260 : 400);
      flow.crowd.update(leaf.clock, leaf.pos.x, leaf.pos.z, LOW ? 110 : 170);
    }
    let steps = 0;
    while (acc >= STEP && steps < 12) {
      leaf.step(STEP, input.state);
      acc -= STEP;
      steps++;
      input.state.corkscrew = 0;
      input.state.loop = false;
    }
    if (leaf.state === "flying" && leaf.grounded && Math.hypot(leaf.vel.x, leaf.vel.z) < 2 && inMeadow(leaf.pos.x, leaf.pos.z)) leaf.plant();
  }
  const ns = city.route.nearest(leaf.pos.x, leaf.pos.z);
  if (leaf.state === "flying") bestS = Math.max(bestS, ns.s);

  updateCamera(dt, wall);
  const focus = viewing() ? freePos : leaf.pos;
  leafView.update(leaf.pos, leaf.q, wall, leaf.airspeed, leaf.integrity);
  streaks.update(dt, viewing() ? freePos : cam.position.clone().lerp(leaf.pos, 0.6), viewing() ? leaf.clock + wall : leaf.clock);
  debris.update(dt, viewing() ? freePos : leaf.pos, viewing() ? leaf.clock + wall : leaf.clock);
  // a gust front coming up behind you: you hear it first
  if (leaf.state === "flying" && leaf.lane !== "subway") {
    const s = city.route.nearest(leaf.pos.x, leaf.pos.z).s;
    const id = Math.floor((leaf.clock * AIR.gustSpeed - s) / (AIR.gustSpeed * AIR.gustEvery));
    if (flow.gustEta(s, leaf.clock) < 1.4 && id !== lastGust) { lastGust = id; audio.play("gust_blast", { vol: 0.8 }); }
  }
  steam.update(dt, focus, leaf.clock, window.innerHeight);
  traffic.update(focus);
  if (!subwayArtReady) trains.update(leaf.clock, focus);
  buildings.update(focus);
  facadeProps.update(focus);
  if (viewing()) { flow.crowd.update(leaf.clock + wall, focus.x, focus.z); flow.traffic.update(leaf.clock + wall, focus.x, focus.z, LOW ? 260 : 400); }
  if (peopleReady) {
    // the people near the camera; anyone the leaf whooshes past flinches and looks up
    peopleList.length = 0;
    const lp = leaf.pos, flying = leaf.state === "flying", fast = leaf.vel.length() > 4;
    const R = 170;
    const next = (): PeopleWalker => {
      const o = peoplePool[peopleList.length] ?? (peoplePool[peopleList.length] = { x: 0, z: 0, tx: 0, tz: 1, phase: 0, speed: 0, seed: 0, h: 1.7, idle: undefined, flinch: undefined, pet: undefined, pets: undefined, y: undefined, act: undefined, v: undefined, char: undefined });
      peopleList.push(o);
      return o;
    };
    for (const w of flow.crowd.now) {
      const dx = w.x - focus.x, dz = w.z - focus.z;
      if (dx * dx + dz * dz > R * R) continue;
      if (flying && fast && lp.y < 3.5 && Math.abs(w.x - lp.x) < 2.5 && Math.abs(w.z - lp.z) < 2.5) {
        const last = flinchAt.get(w.w.seed);
        if (last === undefined || leaf.clock - last > 4) flinchAt.set(w.w.seed, leaf.clock);
      }
      const f = flinchAt.get(w.w.seed);
      const o = next();
      o.x = w.x; o.z = w.z; o.tx = w.tx; o.tz = w.tz; o.phase = w.phase; o.speed = w.w.speed || w.v; o.v = w.v; o.seed = w.w.seed; o.h = w.w.h;
      o.pet = w.w.pet; o.pets = w.w.pets; o.act = w.act; o.char = w.w.char; o.y = w.y; o.idle = undefined;
      o.flinch = f === undefined ? undefined : leaf.clock - f;
    }
    if (flinchAt.size > 400) for (const [k, t] of flinchAt) if (leaf.clock - t > 5) flinchAt.delete(k);
    for (const k of flow.park.kids) {
      const dx = k.x - focus.x, dz = k.z - focus.z;
      if (dx * dx + dz * dz > R * R) continue;
      const o = next();
      o.x = k.x; o.z = k.z; o.tx = k.tx; o.tz = k.tz; o.phase = 0; o.speed = Math.max(0.3, k.speed); o.v = undefined; o.seed = k.seed; o.h = k.h;
      o.pet = o.pets = o.char = o.y = o.flinch = undefined; o.idle = k.speed < 0.25; o.act = k.speed < 0.25 ? "idle" : "walk";
    }
    // the parade balloon's handlers, arms up on the ropes
    for (const hd of (blockerView.userData.handlers ?? []) as { x: number; z: number; yaw: number; seed: number }[]) {
      if ((hd.x - focus.x) ** 2 + (hd.z - focus.z) ** 2 > R * R) continue;
      const o = next();
      o.x = hd.x; o.z = hd.z; o.tx = Math.sin(hd.yaw); o.tz = Math.cos(hd.yaw); o.phase = 0; o.speed = 0; o.v = 0; o.seed = hd.seed; o.h = 1.78;
      o.pet = o.pets = o.y = o.flinch = undefined; o.idle = undefined; o.act = "hail"; o.char = hd.seed % 2 ? "banker" : "commuter";
    }
    people.update(peopleList, viewing() ? leaf.clock + wall : leaf.clock, cam);
  } else crowdView.update();
  pigeons.update(dt, leaf.pos, wall);
  blockerView.userData.update(wall);
  centralPark.update(cam.position, wall);
  chinatown.update(cam.position, wall);
  edgeWall.update(wall, cam.position);
  streetFurniture.update(cam.position, focus, wall); // street furniture: refill near the focus, signal clock
  ground.update(wall);
  ground.updateFocus(focus);
  // light: underground the sun goes and the fluorescents take over
  underMix += ((cam.position.y < -0.6 ? 1 : 0) - underMix) * (1 - Math.exp(-dt * 4));
  stage.sun.intensity = 3.4 * (1 - underMix);
  stage.hemi.intensity = 0.6 * (1 - underMix) + 0.07 * underMix; // the tunnels are dark: the lamps do the lighting
  stage.hemi.color.setRGB(0.66 + underMix * 0.2, 0.7 + underMix * 0.1, 0.78 - underMix * 0.2);
  subway.update(leaf.clock, cam.position, underMix);
  entrances.update(viewing() ? leaf.clock + wall : leaf.clock, cam.position, window.innerHeight);
  if (subwayArtReady) subwayArt.update(cam.position, underMix, flow.trainsAt(leaf.clock), focus);
  stage.update(focus, wall, leaf.state === "flying" ? leaf.vel.length() : 0, Math.max(0, 0.6 - leaf.integrity) * 1.4, underMix > 0.5);
  hud.update(dt, leaf, bestS);
  touch?.show(leaf.state === "flying", leaf.state === "attached"); // controls once the run has started; restart after it ends
  subwaySigns.update(wall, leaf.pos, ns.s, leaf.state === "flying" && leaf.lane === "street" && !replay, cam, dt, leaf.state === "flying" && leaf.lane === "subway" && !replay ? city.subway.nearest(leaf.pos.x, leaf.pos.z).s : null);
  minimap.el.classList.toggle("away", leaf.state === "attached");
  if (leaf.state !== "attached") minimap.update(dt, leaf.pos.x, leaf.pos.y, leaf.pos.z, leaf.heading, leaf.lane === "subway", ns.s, subwaySigns.next);
  if (leaf.state === "planted" && !replay) leaderboard.showWon(leaf.time);
  leaderboard.showMini(leaf.state === "attached" && !introPlaying);
  leafMeter.update(dt, leaf.integrity, leaf.maxIntegrity, wall);
  // the leaf meter only once you're off the tree (it sat over the title screen's text)
  leafMeter.el.classList.toggle("away", leaf.state === "attached");
  audio.musicHold = introPlaying;
  audio.update(dt, leaf, cam, city.district(ns.s).name);
  recorder.update(dt, leaf, input.state, ns.s, city.district(ns.s).name);
  tutorial.update(dt, leaf, input.state);
  // a hint when a closed street is ahead
  {
    const bl = leaf.state === "flying" && leaf.lane === "street" ? flow.blockers.near(leaf.pos.x, leaf.pos.z) : null;
    if (bl && bl.id !== lastHint) { lastHint = bl.id; hud.notify(`<b>${bl.name}</b><br/><span style="opacity:.8">${bl.hint}</span>`, 5); }
    if (!bl && leaf.state !== "flying") lastHint = "";
  }
  if (!replay) achievements.update(dt, leaf);
  if (!replay) {
    discoveries.update(leaf);
    if (discoveries.found.size >= 5) achievements.grant("currents");
    if (discoveries.found.size >= discoveries.total) achievements.grant("allcurrents");
    if (discoveries.devilClimb > 20) achievements.grant("devil");
  }
  minimap.clock = leaf.clock;
  if (render) { stage.render(); recorder.afterRender(leaf.time, ns.s); }
  input.endFrame();
}
requestAnimationFrame(frame);
function restartRun() {
  recorder.finish(leaf, "restart");
  achievements.reset();
  discoveries.reset();
  leaf.reset();
  hud.reset();
  leaderboard.hide();
  audio.reset();
  bestS = 0;
  placeAt();
}
function setPaused(on: boolean) { pause.show(on); }
const pause = new PauseMenu(hudEl, {
  onRestart: () => restartRun(),
  onShow: (on) => audio.pause(on),
  onStory: () => {
    restartRun();
    introPlaying = true;
    playIntro(document.body, () => audio.start(), true).then(() => { introPlaying = false; input.endFrame(); });
  },
  setVolume: (v) => audio.setVolume(v),
});
// away from the game (another tab, the phone locked): pause the run
document.addEventListener("visibilitychange", () => { if (document.hidden && leaf.state === "flying" && !replay) setPaused(true); });
// the story first (skippable); the game keeps drawing the leaf on its branch underneath
let introPlaying = !replay && !freeCam && !params.get("at") && !params.get("sub") && !autopilot;
if (introPlaying) playIntro(document.body, () => audio.start()).then(() => { introPlaying = false; input.endFrame(); });
// the title screen's "watch the story" button (caught before it can count as letting go)
addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement | null)?.closest?.(".intro-again") || introPlaying || leaf.state !== "attached") return;
  e.stopPropagation(); e.preventDefault();
  introPlaying = true;
  playIntro(document.body, () => audio.start(), true).then(() => { introPlaying = false; input.endFrame(); });
}, true);

/** Debug: run the game forward (works while the tab is hidden), then draw one frame. */
function advance(seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 30) tick(1 / 30, false);
  tick(1 / 60, true);
  const l = leaf;
  return { state: l.state, failure: l.failure, t: +l.time.toFixed(1), s: +city.route.nearest(l.pos.x, l.pos.z).s.toFixed(0), y: +l.pos.y.toFixed(1), lane: l.lane, v: +l.vel.length().toFixed(1), integrity: +l.integrity.toFixed(2) };
}

// phones: halve (or more) every big texture once it has loaded: GPU memory is what kills an iPhone tab
function shrinkTextures(max: number) {
  const seen = new Set<THREE.Texture>();
  stage.scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material ? ([] as THREE.Material[]).concat((o as THREE.Mesh).material as THREE.Material) : [];
    for (const m of mats) for (const k in m) {
      const t = (m as unknown as Record<string, unknown>)[k] as THREE.Texture | undefined;
      if (!t || !(t as THREE.Texture).isTexture || seen.has(t)) continue;
      seen.add(t);
      const img = t.image as { width?: number; height?: number } | undefined;
      if (!img || !img.width || !img.height || (t as THREE.DataTexture).isDataTexture || (t as unknown as { isDataArrayTexture?: boolean }).isDataArrayTexture) continue;
      if (Math.max(img.width, img.height) <= max || !(img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap))) continue;
      const k2 = max / Math.max(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k2)); c.height = Math.max(1, Math.round(img.height * k2));
      c.getContext("2d")!.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
      t.image = c;
      t.needsUpdate = true;
    }
  });
}
if (LOW) for (const ms of [6000, 15000, 30000]) setTimeout(() => shrinkTextures(512), ms);

// the views, for timing and debugging from the console
Object.assign(window, { ffttViews: { chinatown, traffic, buildings, facadeProps, centralPark, farCity, subwayArt, debris, streaks, minimap, steam, ground, subwaySigns, people, entrances, streetFurniture, pigeons, leafView, hud, audio, leafMeter, trains } });
Object.assign(window, { fftt: { THREE, city, flow, streetFurniture, leaf, stage, cam, advance, input, recorder, subway, pigeons, entrances } });
