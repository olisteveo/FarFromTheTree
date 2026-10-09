// Far From the Tree, web build. (Stage: world viewer while the new city comes together.)
//
// URL options:
//   ?cam=x,y,z,yaw,pitch   place the camera (degrees; yaw 0 looks uptown)
//   ?at=s,height           put the camera on the route at distance s, height metres up
//   ?q=low|medium|high     render quality

import * as THREE from "three";
import { CityData } from "./world/data";
import { Stage, type Quality } from "./render/stage";
import { buildFacadeTextures } from "./render/facades";
import { BuildingsMesh } from "./render/buildings";
import { GroundMesh } from "./render/ground";

const params = new URLSearchParams(location.search);
const quality = (params.get("q") as Quality) ?? "high";
const canvas = document.getElementById("view") as HTMLCanvasElement;
const hud = document.getElementById("hud")!;
hud.innerHTML = `<div class="loading">Loading Manhattan…</div>`;

const stage = new Stage(canvas, quality);
const t0 = performance.now();
const city = await CityData.load();
const tex = buildFacadeTextures();
const t1 = performance.now();
const buildings = new BuildingsMesh(city, tex);
const ground = new GroundMesh(city);
stage.scene.add(buildings.root, ground.root);
const t2 = performance.now();
console.log(`[fftt] city ${city.buildings.length} buildings; textures ${(t1 - t0).toFixed(0)} ms, meshes ${(t2 - t1).toFixed(0)} ms`);

// ------------------------------------------------------------------ free camera
const cam = stage.camera;
let yaw = 0, pitch = -0.05;
const pos = new THREE.Vector3();
{
  const c = params.get("cam")?.split(",").map(Number);
  const at = params.get("at")?.split(",").map(Number);
  if (c) { pos.set(c[0], c[1], c[2]); yaw = THREE.MathUtils.degToRad(c[3] ?? 0); pitch = THREE.MathUtils.degToRad(c[4] ?? 0); }
  else {
    const s = at?.[0] ?? 40, h = at?.[1] ?? 14;
    const p = city.route.at(s);
    pos.set(p.x, h, p.z);
    yaw = Math.atan2(p.tx, p.tz);
  }
}
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let drag = false;
canvas.addEventListener("pointerdown", () => (drag = true));
addEventListener("pointerup", () => (drag = false));
addEventListener("pointermove", (e) => {
  if (!drag) return;
  yaw -= e.movementX * 0.003;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003));
});

const fpsEl = document.createElement("div");
fpsEl.className = "fps";
hud.innerHTML = "";
hud.appendChild(fpsEl);
let frames = 0, acc = 0, last = performance.now(), wall = 0;

/** Point the camera and update everything that depends on where it is. */
function sync() {
  const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  cam.position.copy(pos);
  cam.lookAt(pos.clone().add(f));
  cam.updateMatrixWorld();
  buildings.update(pos);
  ground.update(wall);
  ground.updateFocus(pos);
  stage.update(pos, wall, 0, 0, pos.y < -0.5);
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  wall += dt;
  const sp = (keys.has("ShiftLeft") ? 120 : 30) * dt;
  const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  if (keys.has("KeyW")) pos.addScaledVector(f, sp);
  if (keys.has("KeyS")) pos.addScaledVector(f, -sp);
  if (keys.has("KeyD")) pos.addScaledVector(r, sp);
  if (keys.has("KeyA")) pos.addScaledVector(r, -sp);
  if (keys.has("KeyE")) pos.y += sp;
  if (keys.has("KeyQ")) pos.y -= sp;
  sync();
  stage.render();
  frames++; acc += dt;
  if (acc > 0.5) {
    const s = city.route.nearest(pos.x, pos.z);
    fpsEl.textContent = `${Math.round(frames / acc)} fps · ${city.district(s.s).name} · s ${s.s.toFixed(0)} m · (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`;
    frames = 0; acc = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
/** Times n synchronous renders (works while the pane is hidden). */
function bench(n = 10) {
  const gl = stage.renderer.getContext();
  const px = new Uint8Array(4);
  const r = stage.renderer;
  sync();
  r.info.autoReset = false; r.info.reset();
  stage.render();
  const info = { calls: r.info.render.calls, tris: r.info.render.triangles };
  r.info.autoReset = true;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t = performance.now();
  for (let i = 0; i < n; i++) { stage.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  return { ms: (performance.now() - t) / n, ...info };
}
Object.assign(window, { fftt: { bench, city, stage, pos, setView: (x: number, y: number, z: number, yw: number, pt: number) => { pos.set(x, y, z); yaw = THREE.MathUtils.degToRad(yw); pitch = THREE.MathUtils.degToRad(pt); } } });
