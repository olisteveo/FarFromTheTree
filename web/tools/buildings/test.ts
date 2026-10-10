// Dev test bed for the architecture (buildings.ts, facades.ts, the kit, the lots) over the real city:
//   http://localhost:5173/tools/buildings/test.html?cam=-597,2.5,2140,7,6   (x,y,z,yaw,pitch in degrees, like main.ts)
//   &q=low|medium|high   &noground   &clean (no HUD, for screenshots)   &dd=900 (draw distance)
// WASD/QE to fly (shift = fast), drag to look.
//   window.view(x,y,z,yaw,pitch)       jump the camera and draw a frame (works with the tab hidden)
//   await window.shot(name, x,y,z,yaw,pitch)  same, and save web/recordings/arch/<name>.jpg via the dev server
//   window.stats(n)                    time n synchronous frames at the current view
//   await window.ready                 textures and kit loaded
import * as THREE from "three";
import { CityData } from "../../src/world/data";
import { Facades } from "../../src/world/facades";
import { Stage, type Quality } from "../../src/render/stage";
import { GroundMesh } from "../../src/render/ground";
import { BuildingsMesh, DEBUG } from "../../src/render/buildings";
import { buildFacadeTextures } from "../../src/render/facades";
import { FacadePropsView } from "../../src/render/facadeProps";
import { loadKitModels } from "../../src/render/architectureModels";
import { addInfill } from "../../src/render/architectureInfill";

// other people edit these modules all the time: take the update quietly instead of reloading mid-shot
const hot = (import.meta as unknown as { hot?: { accept(deps: string[], cb: () => void): void } }).hot;
if (hot) {
  hot.accept(["../../src/world/data", "../../src/world/facades", "../../src/render/stage", "../../src/render/ground", "../../src/render/buildings",
    "../../src/render/facades", "../../src/render/facadeProps", "../../src/render/architectureModels", "../../src/render/architectureInfill"], () => {});
}

const qs = new URLSearchParams(location.search);
if (qs.has("clean")) document.body.classList.add("clean");
const hud = document.getElementById("hud")!;
const quality = (qs.get("q") as Quality) ?? "high";
const stage = new Stage(document.getElementById("view") as HTMLCanvasElement, quality);
const city = await CityData.load("/city.json");
if (!qs.has("noinfill")) await addInfill(city);
const facades = new Facades(city);
const t0 = performance.now();
const tex = buildFacadeTextures({ base: "/", quality });
const facadeProps = new FacadePropsView(facades);
const buildings = new BuildingsMesh(city, tex);
const buildMs = performance.now() - t0;
if (qs.has("dd")) buildings.setDrawDistance(Number(qs.get("dd")));
stage.scene.add(buildings.root, facadeProps.root);
let ground: GroundMesh | null = null;
if (!qs.has("noground")) { ground = new GroundMesh(city, { base: "/" }); stage.scene.add(ground.root); }

const cam = (qs.get("cam") ?? "-597,2.5,2140,7,6").split(",").map(Number);
const pos = new THREE.Vector3(cam[0], cam[1], cam[2]);
let yaw = THREE.MathUtils.degToRad(cam[3] ?? 0), pitch = THREE.MathUtils.degToRad(cam[4] ?? 0);
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let drag = false;
addEventListener("pointerdown", () => (drag = true));
addEventListener("pointerup", () => (drag = false));
addEventListener("pointermove", (e) => { if (drag) { yaw -= e.movementX * 0.003; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003)); } });

let t = 0;
function draw(dt: number) {
  t += dt;
  const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  const sp = (keys.has("ShiftLeft") ? 120 : 20) * dt;
  if (keys.has("KeyW")) pos.addScaledVector(f, sp);
  if (keys.has("KeyS")) pos.addScaledVector(f, -sp);
  if (keys.has("KeyD")) pos.addScaledVector(r, sp);
  if (keys.has("KeyA")) pos.addScaledVector(r, -sp);
  if (keys.has("KeyE")) pos.y += sp;
  if (keys.has("KeyQ")) pos.y -= sp;
  stage.camera.position.copy(pos);
  stage.camera.lookAt(pos.clone().add(f));
  buildings.update(pos);
  facadeProps.update(pos);
  if (ground) { ground.updateFocus(pos); ground.update(t); }
  stage.update(pos, t, 0, 0, false);
  stage.render();
}
let last = performance.now();
function frame(now: number) {
  draw(Math.min(0.05, (now - last) / 1000));
  last = now;
  const i = stage.renderer.info;
  hud.textContent = `buildings built in ${buildMs.toFixed(0)} ms   pos ${pos.x.toFixed(0)},${pos.y.toFixed(1)},${pos.z.toFixed(0)} yaw ${THREE.MathUtils.radToDeg(yaw).toFixed(0)} pitch ${THREE.MathUtils.radToDeg(pitch).toFixed(0)}   calls ${i.render.calls} tris ${i.render.triangles}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const ready = Promise.all([tex.ready, loadKitModels()]).then(() => { document.title = "ready"; });

function view(x: number, y: number, z: number, yawDeg: number, pitchDeg: number) {
  pos.set(x, y, z); yaw = THREE.MathUtils.degToRad(yawDeg); pitch = THREE.MathUtils.degToRad(pitchDeg);
  stage.resize();
  draw(1 / 60); draw(1 / 60); draw(1 / 60);
  return stage.renderer.domElement.toDataURL("image/jpeg", 0.9);
}

if (qs.has("dbg")) DEBUG.value = Number(qs.get("dbg"));
async function shot(name: string, x: number, y: number, z: number, yawDeg: number, pitchDeg: number) {
  await ready;
  let u = view(x, y, z, yawDeg, pitchDeg);
  if (qs.has("raw")) {   // straight from the scene, no post-processing
    stage.renderer.setRenderTarget(null);
    stage.renderer.render(stage.scene, stage.camera);
    u = stage.renderer.domElement.toDataURL("image/jpeg", 0.92);
  }
  await fetch(`/__rec/arch/${name}.jpg`, { method: "POST", body: u });
  return name;
}
// ?shots=name:x,y,z,yaw,pitch;name2:...  takes them all once everything has loaded (survives HMR reloads: it just redoes them)
if (qs.has("shots")) {
  ready.then(async () => {
    for (const s of qs.get("shots")!.split(";")) {
      const [name, v] = s.split(":");
      const [x, y, z, yw, p] = v.split(",").map(Number);
      await shot(name, x, y, z, yw, p);
    }
    document.title = "shots done";
    (window as unknown as { shotsDone: boolean }).shotsDone = true;
  });
}

Object.assign(window, {
  THREE, stage, buildings, city, facades, buildMs, ready, view, shot, DEBUG, tex,
  /** Average CPU time of n synchronous frames at the current view, and the draw stats of the main pass. */
  stats(n = 60) {
    const info = stage.renderer.info;
    info.autoReset = false;
    info.reset();
    draw(1 / 60);
    const calls = info.render.calls, tris = info.render.triangles;
    info.autoReset = true;
    const gl = stage.renderer.getContext();
    const px = new Uint8Array(4);
    const a = performance.now();
    for (let k = 0; k < n; k++) { draw(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return { msPerFrame: +((performance.now() - a) / n).toFixed(2), calls, tris, textures: info.memory.textures, geometries: info.memory.geometries };
  },
});
