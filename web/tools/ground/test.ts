// Dev test bed for the street surfaces (ground.ts + groundArt.ts) over the real city:
//   http://localhost:5173/tools/ground/test.html?cam=-154,1.6,575,20,-38   (x,y,z,yaw,pitch in degrees, like main.ts)
//   &q=low|medium|high   &nobuildings   &hazards (puddles, steam covers, open manholes from life.ts)
// WASD/QE to fly (shift = fast), drag to look. window.view(x,y,z,yaw,pitch) moves the camera and
// draws one frame (works with the tab hidden); window.stats() times frames.
import * as THREE from "three";
import { CityData } from "../../src/world/data";
import { Stage, type Quality } from "../../src/render/stage";
import { GroundMesh } from "../../src/render/ground";
import { BuildingsMesh } from "../../src/render/buildings";
import { buildFacadeTextures } from "../../src/render/facades";

const qs = new URLSearchParams(location.search);
const hud = document.getElementById("hud")!;
const stage = new Stage(document.getElementById("view") as HTMLCanvasElement, (qs.get("q") as Quality) ?? "high");
const city = await CityData.load("/city.json");
const t0 = performance.now();
const ground = new GroundMesh(city, { base: "/" });
const buildMs = performance.now() - t0;
stage.scene.add(ground.root);
if (!qs.has("nobuildings")) stage.scene.add(new BuildingsMesh(city, buildFacadeTextures()).root);
if (qs.has("hazards")) {
  const { Airflow } = await import("../../src/world/airflow");
  const { streetHazards } = await import("../../src/render/life");
  stage.scene.add(streetHazards(new Airflow(city)));
}

const cam = (qs.get("cam") ?? "-154,1.6,575,20,-38").split(",").map(Number);
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
  ground.updateFocus(pos);
  ground.update(t);
  stage.update(pos, t, 0, 0, false);
  stage.render();
}
let last = performance.now();
function frame(now: number) {
  draw(Math.min(0.05, (now - last) / 1000));
  last = now;
  const i = stage.renderer.info;
  hud.textContent = `ground built in ${buildMs.toFixed(0)} ms   pos ${pos.x.toFixed(0)},${pos.y.toFixed(1)},${pos.z.toFixed(0)}   calls ${i.render.calls} tris ${i.render.triangles}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, {
  THREE, stage, ground, buildMs,
  /** Jump the camera and draw a frame now (works while the tab is hidden). Returns a JPEG data URL. */
  view(x: number, y: number, z: number, yawDeg: number, pitchDeg: number) {
    pos.set(x, y, z); yaw = THREE.MathUtils.degToRad(yawDeg); pitch = THREE.MathUtils.degToRad(pitchDeg);
    stage.resize();
    draw(1 / 60); draw(1 / 60);
    return stage.renderer.domElement.toDataURL("image/jpeg", 0.88);
  },
  /** Average CPU time of n synchronous frames at the current view, and the draw stats of the main pass. */
  stats(n = 60) {
    const info = stage.renderer.info;
    info.autoReset = false;
    info.reset();
    draw(1 / 60);
    const calls = info.render.calls, tris = info.render.triangles;
    info.autoReset = true;
    const gl = stage.renderer.getContext();
    const a = performance.now();
    for (let k = 0; k < n; k++) draw(1 / 60);
    gl.finish();
    return { msPerFrame: +((performance.now() - a) / n).toFixed(2), calls, tris, textures: info.memory.textures, geometries: info.memory.geometries };
  },
});
