// Fly at every way in by the stairs like a player would (from 14 m out, a few angles and heights,
// gliding at 8 m/s and nosing down at it) and count how many end up in the station hall.
//   npx tsx tools/entry-approach.ts
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const u = flow.under;
function hallAt(x: number, z: number) {
  const q = city.subway.nearest(x, z);
  if (u.isBlocked(q.s)) return null;
  let k = 0;
  for (const st of u.stations) { const d = Math.abs(st.ss - q.s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
  const hw = TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k;
  return Math.abs(q.off) < hw ? { ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k } : null;
}
let ok = 0, n = 0, dead = 0;
const fails: string[] = [];
const ins = u.shafts.filter((s) => s.kind === "stairs" && !s.out && !u.isBlocked(s.ss));
for (const s of ins) {
  for (const ang of [-40, 0, 40, 180]) for (const h of [2, 3.5]) {
    // approach direction: from the open side (ang 0), from the sides, or from over the far end (180)
    const A = (ang * Math.PI) / 180, dx = s.ux * Math.cos(A) - s.uz * Math.sin(A), dz = s.uz * Math.cos(A) + s.ux * Math.sin(A);
    const g = new Glider(city, flow, { x: s.x - dx * 14, y: h, z: s.z - dz * 14, heading: Math.atan2(dx, dz) });
    g.vel.set(dx * 8, -0.5, dz * 8);
    g.detach();
    let inHall = false;
    for (let i = 0; i < 8 * 120 && g.state === "flying" && !inHall; i++) {
      if (i % 6 === 0) flow.traffic.update(g.clock);
      // steer at the opening, nose down once close
      const tx = s.x - g.pos.x, tz = s.z - g.pos.z, want = Math.atan2(tx, tz);
      let d = want - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      const dist = Math.hypot(tx, tz);
      g.step(1 / 120, { pitch: dist < 7 ? 0.6 : 0.1, roll: Math.max(-1, Math.min(1, -d * 2)), spread: false, curl: false, corkscrew: 0, loop: false });
      const hall = hallAt(g.pos.x, g.pos.z);
      if (hall && g.pos.y < hall.ceil - 1) inHall = true;
    }
    n++;
    if (inHall) ok++;
    else { if (g.state !== "flying") dead++; if (fails.length < 12) fails.push(`${s.name} d ${Math.hypot(g.pos.x - s.x, g.pos.z - s.z).toFixed(1)} a ${((g.pos.x - s.x) * s.ux + (g.pos.z - s.z) * s.uz).toFixed(1)} air ${flow.sample(g.pos.x, g.pos.y, g.pos.z, g.clock, g.air).x.toFixed(1)},${g.air.y.toFixed(1)},${g.air.z.toFixed(1)} guide ${(g.air.guide ?? 0).toFixed(2)} ang ${ang} h ${h}: ${g.state} at y ${g.pos.y.toFixed(1)} int ${g.integrity.toFixed(2)} ${g.failure ?? ""}`); }
  }
}
console.log(`ways in reached the hall: ${ok}/${n} (${((100 * ok) / n).toFixed(0)}%), dead ${dead}`);
console.log(fails.join("\n"));
