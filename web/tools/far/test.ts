// Far-city test bench (independent of the game's main.ts): the stage, the ground, the far city.
//   http://localhost:5173/tools/far/test.html?cam=x,y,z,yawDeg,pitchDeg&q=high&detail=0
// detail = the detail distance (0: draw the far versions of the corridor buildings everywhere).
// window.far: { stage, far, cam, time(n) } -- time(n) renders n frames with gl.finish and returns ms/frame.
import * as THREE from "three";
import { Stage, type Quality } from "../../src/render/stage";
import { CityData } from "../../src/world/data";
import { GroundMesh } from "../../src/render/ground";
import { FarCity } from "../../src/render/farCity";

const p = new URLSearchParams(location.search);
const hud = document.getElementById("hud")!;
const stage = new Stage(document.getElementById("view") as HTMLCanvasElement, (p.get("q") ?? "high") as Quality);
const city = await CityData.load("/city.json");
const ground = new GroundMesh(city, { skipTree: () => false });
const far = new FarCity(city, stage.sun, stage.hemi, { quality: stage.quality, waterMaterial: ground.water.material as THREE.Material, url: "/far.dat", inline: p.get("inline") === "1" });
far.setDetailDistance(Number(p.get("detail") ?? 0));
stage.scene.add(ground.root, far.root);
const c = (p.get("cam") ?? "-400,180,2500,30,-20").split(",").map(Number);
const cam = stage.camera;
const yaw = THREE.MathUtils.degToRad(c[3] ?? 0), pitch = THREE.MathUtils.degToRad(c[4] ?? 0);
cam.position.set(c[0], c[1], c[2]);
cam.lookAt(cam.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
let t = 0;
function frame() {
  t += 1 / 60;
  ground.update(t); ground.updateFocus(cam.position);
  stage.update(cam.position, t, 0, 0, false);
  stage.render();
}
const t0 = performance.now();
far.load().then(() => { hud.textContent = `far: ${JSON.stringify(far.stats)} load ${Math.round(performance.now() - t0)} ms`; (window as unknown as { farReady: boolean }).farReady = true; }).catch((e) => { hud.textContent = "far failed: " + e; console.error(e); });
function loop() { frame(); requestAnimationFrame(loop); }
loop();
function time(n = 60) {
  const gl = stage.renderer.getContext();
  frame(); gl.finish();
  const a = performance.now();
  for (let i = 0; i < n; i++) frame();
  gl.finish();
  return (performance.now() - a) / n;
}
Object.assign(window, { far: { stage, far, cam, time, THREE, ground } });


