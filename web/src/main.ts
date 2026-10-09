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
import { GroundMesh } from "./render/ground";
import { SubwayMesh } from "./render/subway";
import { LeafView } from "./render/leaf";
import { FacadePropsView } from "./render/facadeProps";
import { Pigeons } from "./render/pigeons";
import { CrowdView, SteamView, TrafficView, TrainsView, WindStreaks, lastTree, streetHazards } from "./render/life";
import { Input } from "./game/input";
import { Hud } from "./game/hud";
import { Audio } from "./game/audio";
import { Recorder, sampleAt, type RunLog } from "./game/recorder";
import { Tutorial } from "./game/tutorial";
import { playIntro } from "./game/intro";
import { clamp } from "./core/rng";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudEl = document.getElementById("hud")!;
hudEl.innerHTML = `<div class="loading">Loading Manhattan…</div>`;

function pickQuality(): Quality {
  const q = params.get("q");
  if (q === "low" || q === "medium" || q === "high") return q;
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  const r = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/Intel|UHD|Iris|Mali|Adreno|Apple M1/i.test(r)) return "medium";
  return "high";
}

const stage = new Stage(canvas, pickQuality());
const city = await CityData.load();
const flow = new Airflow(city);
const tex = buildFacadeTextures();
const buildings = new BuildingsMesh(city, tex);
const ground = new GroundMesh(city);
const subway = new SubwayMesh(flow.under);
const leafView = new LeafView();
const traffic = new TrafficView(flow);
const trains = new TrainsView(flow);
const steam = new SteamView(flow);
const streaks = new WindStreaks(flow);
const facadeProps = new FacadePropsView(flow.facades);
const crowdView = new CrowdView(flow);
const pigeons = new Pigeons(city);
const landmarks = new Landmarks(city);
landmarkSolids(landmarks, flow.facades);
stage.scene.add(pigeons.mesh, landmarkMeshes(landmarks), crowdView.mesh, facadeProps.root, buildings.root, ground.root, subway.root, leafView.root, traffic.root, trains.root, steam.points, streaks.mesh, streetHazards(flow));

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
const audio = new Audio(city);
pigeons.onScatter = (x, y, z) => audio.play("pigeon_flap", { at: [x, y + 1, z], vol: 1, world: true });
const recorder = new Recorder(canvas, stage.quality);
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

function blocked(p: THREE.Vector3): boolean {
  if (leaf.pos.y > -0.4 && p.y < 0.3 && !flow.under.openingAt(p.x, p.z)) return true;
  if (p.y < -0.4 || (leaf.pos.y < -0.4 && p.y < 1)) return flow.under.sdf(p.x, p.y, p.z) < 0.35;
  const b = city.buildingAt(p.x, p.z);
  return !!b && p.y < b.h + 0.3;
}

function updateCamera(dt: number, t: number) {
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

// ------------------------------------------------------------------ loop
const autopilot = params.get("fly") === "1";
const STEP = 1 / 240;
let last = performance.now(), acc = 0, wall = 0, bestS = 0;
let underMix = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt, true);
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
  if (input.hit("KeyR") && !replay) {
    recorder.finish(leaf, "restart");
    achievements.reset();
    leaf.reset();
    hud.reset();
    audio.reset();
    bestS = 0;
    placeAt();
  }
  if (input.anyKey) {
    audio.start();
    if (leaf.state === "attached" && !input.hit("KeyG") && !freeCam) { leaf.detach(); recorder.start(leaf); }
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
    flow.traffic.update(leaf.clock, leaf.pos.x, leaf.pos.z, 400);
  } else if (!freeCam) {
    acc += dt;
    flow.traffic.update(leaf.clock, leaf.pos.x, leaf.pos.z, 400);
    flow.crowd.update(leaf.clock, leaf.pos.x, leaf.pos.z);
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
  const focus = freeCam ? freePos : leaf.pos;
  leafView.update(leaf.pos, leaf.q, wall, leaf.airspeed, leaf.integrity);
  streaks.update(dt, freeCam ? freePos : cam.position.clone().lerp(leaf.pos, 0.6), leaf.clock);
  steam.update(dt, focus, leaf.clock, window.innerHeight);
  traffic.update(focus);
  trains.update(leaf.clock, focus);
  buildings.update(focus);
  facadeProps.update(focus);
  if (freeCam) flow.crowd.update(leaf.clock + wall, focus.x, focus.z);
  crowdView.update();
  pigeons.update(dt, leaf.pos, wall);
  ground.update(wall);
  ground.updateFocus(focus);
  // light: underground the sun goes and the fluorescents take over
  underMix += ((cam.position.y < -0.6 ? 1 : 0) - underMix) * (1 - Math.exp(-dt * 4));
  stage.sun.intensity = 3.4 * (1 - underMix);
  stage.hemi.intensity = 0.6 * (1 - underMix) + 0.07 * underMix; // the tunnels are dark: the lamps do the lighting
  stage.hemi.color.setRGB(0.66 + underMix * 0.2, 0.7 + underMix * 0.1, 0.78 - underMix * 0.2);
  subway.update(leaf.clock, cam.position, underMix);
  stage.update(focus, wall, leaf.state === "flying" ? leaf.vel.length() : 0, Math.max(0, 0.6 - leaf.integrity) * 1.4, underMix > 0.5);
  hud.update(dt, leaf, bestS);
  audio.update(dt, leaf, cam, city.district(ns.s).name);
  recorder.update(dt, leaf, input.state, ns.s, city.district(ns.s).name);
  tutorial.update(dt, leaf, input.state);
  if (!replay) achievements.update(dt, leaf);
  if (render) { stage.render(); recorder.afterRender(leaf.time, ns.s); }
  input.endFrame();
}
requestAnimationFrame(frame);
// the story first (skippable); the game keeps drawing the leaf on its branch underneath
let introPlaying = !replay && !freeCam && !params.get("at") && !params.get("sub") && !autopilot;
if (introPlaying) playIntro(document.body, () => audio.start()).then(() => { introPlaying = false; input.endFrame(); });

/** Debug: run the game forward (works while the tab is hidden), then draw one frame. */
function advance(seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 30) tick(1 / 30, false);
  tick(1 / 60, true);
  const l = leaf;
  return { state: l.state, failure: l.failure, t: +l.time.toFixed(1), s: +city.route.nearest(l.pos.x, l.pos.z).s.toFixed(0), y: +l.pos.y.toFixed(1), lane: l.lane, v: +l.vel.length().toFixed(1), integrity: +l.integrity.toFixed(2) };
}

Object.assign(window, { fftt: { THREE, city, flow, leaf, stage, cam, advance, input, recorder, subway, pigeons } });
