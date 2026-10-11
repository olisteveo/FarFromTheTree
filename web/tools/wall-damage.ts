// Fly a leaf into building walls at speed and report whether it took damage (a regression check).
//   npx tsx tools/wall-damage.ts
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
let hits = 0, tried = 0;
for (let s = 300; s < 8000 && tried < 12; s += 650) {
  const a = city.route.at(s);
  // find a building wall within 40 m sideways, and aim straight at it from 15 m out
  for (const side of [1, -1]) {
    let wx = 0, wz = 0, found = false;
    for (let k = 2; k < 60 && !found; k++) { const x = a.x + a.tz * k * side, z = a.z - a.tx * k * side; const b = city.buildingAt(x, z); if (b && b.h > 20) { wx = x; wz = z; found = true; } }
    if (!found) continue;
    tried++;
    const dx = wx - a.x, dz = wz - a.z, L = Math.hypot(dx, dz);
    const g = new Glider(city, flow, { x: wx - (dx / L) * 15, y: 10, z: wz - (dz / L) * 15, heading: Math.atan2(dx, dz) });
    g.detach();
    g.vel.set((dx / L) * 14, 0, (dz / L) * 14);
    const hp0 = g.integrity;
    for (let i = 0; i < 240 && g.state === "flying"; i++) g.step(1 / 120, { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0, loop: false });
    const hit = g.integrity < hp0 - 0.01;
    if (hit) hits++;
    console.log(`s${s} side ${side}: integrity ${hp0.toFixed(2)} -> ${g.integrity.toFixed(2)} ${hit ? "HURT" : "no damage"}  ${g.events.slice(-1)[0] ?? "(no events)"}`);
  }
}
console.log(`${hits}/${tried} wall runs did damage`);
