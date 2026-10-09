// Dev test bed for the Central Park module over the real city:
//   http://localhost:5173/tools/park/test.html?cam=700,25,8050,-10,-25   (x,y,z,yaw,pitch in degrees, like main.ts)
//   http://localhost:5173/tools/park/test.html?at=8250,2                  (on the route at s, height above the lawn)
//   &noground  (skip ground.ts)  &nobuildings  &colliders (draw the collider shapes)  &glow=0..1  &q=low|medium|high
// WASD/QE to fly (shift = fast), drag to look.
import * as THREE from "three";
import { CityData } from "../../src/world/data";
import { Stage, type Quality } from "../../src/render/stage";
import { GroundMesh } from "../../src/render/ground";
import { BuildingsMesh } from "../../src/render/buildings";
import { buildFacadeTextures } from "../../src/render/facades";
import { CentralPark, type ParkCollider } from "../../src/render/centralPark";

const qs = new URLSearchParams(location.search);
const hud = document.getElementById("hud")!;
const stage = new Stage(document.getElementById("view") as HTMLCanvasElement, (qs.get("q") as Quality) ?? "high");
const city = await CityData.load("/city.json");
let groundOk = false;
if (!qs.has("noground")) {
  // ground.ts is being reworked in parallel: fall back to a plain winter lawn if it doesn't build
  try { const g = new GroundMesh(city); stage.scene.add(g.root); groundOk = true; } catch (e) { console.warn("ground.ts failed, using a plain lawn", e); }
}
if (!groundOk) {
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f6a48, roughness: 1 }));
  lawn.position.set(450, 0.12, 8300);
  lawn.receiveShadow = true;
  stage.scene.add(lawn);
}
if (!qs.has("nobuildings")) stage.scene.add(new BuildingsMesh(city, buildFacadeTextures()).root);
const t0 = performance.now();
const park = new CentralPark(city, { base: "/" });
const layoutMs = performance.now() - t0;
stage.scene.add(park.root);
if (qs.has("glow")) park.glow = Number(qs.get("glow"));
await park.ready;
const buildMs = performance.now() - t0;
(window as unknown as { park: CentralPark; THREE: typeof THREE; stage: Stage }).park = park;
Object.assign(window, { THREE, stage });

for (const n of (qs.get("hide") ?? "").split(",").filter(Boolean)) park.root.traverse((o) => { if (o.name === n) o.visible = false; });
if (qs.has("colliders")) stage.scene.add(colliderMeshes(park.colliders));

// camera
const cam = stage.camera;
const pos = new THREE.Vector3(700, 25, 8050);
let yaw = THREE.MathUtils.degToRad(-10), pitch = THREE.MathUtils.degToRad(-25);
const c = qs.get("cam")?.split(",").map(Number);
const at = qs.get("at")?.split(",").map(Number);
if (c) { pos.set(c[0], c[1], c[2]); yaw = THREE.MathUtils.degToRad(c[3] ?? 0); pitch = THREE.MathUtils.degToRad(c[4] ?? 0); }
else if (at) { const p = city.route.at(at[0]); pos.set(p.x, (at[1] ?? 2) + 0.12, p.z); yaw = Math.atan2(p.tx, p.tz); pitch = -0.05; }
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let drag = false;
addEventListener("pointerdown", () => (drag = true));
addEventListener("pointerup", () => (drag = false));
addEventListener("pointermove", (e) => { if (drag) { yaw -= e.movementX * 0.003; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.003)); } });

let last = performance.now(), wall = 0, frames = 0, acc = 0, worst = 0;
const ms: number[] = [];
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  ms.push(now - last);
  last = now; wall += dt;
  const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  const sp = (keys.has("ShiftLeft") ? 120 : 20) * dt;
  if (keys.has("KeyW")) pos.addScaledVector(f, sp);
  if (keys.has("KeyS")) pos.addScaledVector(f, -sp);
  if (keys.has("KeyD")) pos.addScaledVector(r, sp);
  if (keys.has("KeyA")) pos.addScaledVector(r, -sp);
  if (keys.has("KeyE")) pos.y += sp;
  if (keys.has("KeyQ")) pos.y -= sp;
  cam.position.copy(pos);
  cam.lookAt(pos.clone().add(f));
  const tu = performance.now();
  park.update(pos, wall);
  const upd = performance.now() - tu;
  stage.update(pos, wall, 0, 0, false);
  stage.render();
  frames++; acc += dt; worst = Math.max(worst, upd);
  if (acc > 1) {
    const info = stage.renderer.info.render;
    const sorted = [...ms].sort((a, b) => a - b);
    hud.textContent = `${(frames / acc).toFixed(0)} fps  median ${sorted[sorted.length >> 1].toFixed(1)} ms  p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms\n` +
      `park.update worst ${worst.toFixed(2)} ms   layout ${layoutMs.toFixed(0)} ms, ready ${buildMs.toFixed(0)} ms\n` +
      `${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris\ncam ${pos.x.toFixed(0)},${pos.y.toFixed(1)},${pos.z.toFixed(0)},${THREE.MathUtils.radToDeg(yaw).toFixed(0)},${THREE.MathUtils.radToDeg(pitch).toFixed(0)}`;
    frames = 0; acc = 0; worst = 0; ms.length = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function colliderMeshes(list: ParkCollider[]) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true });
  for (const c of list) {
    let m: THREE.Mesh;
    if (c.kind === "box") { m = new THREE.Mesh(new THREE.BoxGeometry(c.hw * 2, c.hh * 2, c.hd * 2), mat); m.position.set(c.x, c.y, c.z); m.rotation.y = Math.atan2(-c.tz, c.tx); }
    else if (c.kind === "cyl") { m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.y1 - c.y0, 8), mat); m.position.set(c.x, (c.y0 + c.y1) / 2, c.z); }
    else if (c.kind === "sphere") { m = new THREE.Mesh(new THREE.SphereGeometry(c.r, 8, 6), mat); m.position.set(c.x, c.y, c.z); }
    else { m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat); m.scale.set(c.rx, c.h, c.rz); m.position.set(c.x, c.y0, c.z); m.rotation.y = Math.atan2(-c.tz, c.tx); }
    g.add(m);
  }
  return g;
}

/** Synchronous benchmark (works even when the tab isn't animating): renders n frames, with and
 *  without the park, and reports mean CPU+GPU ms per frame (a 1-pixel readback forces the GPU to finish). */
async function bench(n = 60) {
  const gl = stage.renderer.getContext();
  const px = new Uint8Array(4);
  const run = () => {
    const t = performance.now();
    for (let i = 0; i < n; i++) { park.update(pos, wall + i / 60); stage.update(pos, wall, 0, 0, false); stage.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t) / n;
  };
  cam.position.copy(pos);
  run();
  const on = run();
  const info = { calls: stage.renderer.info.render.calls, tris: stage.renderer.info.render.triangles };
  park.root.visible = false;
  const off = run();
  park.root.visible = true;
  return { withPark: +on.toFixed(2), withoutPark: +off.toFixed(2), ...info };
}
Object.assign(window, { bench });
