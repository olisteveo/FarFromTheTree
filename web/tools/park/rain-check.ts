// Central Park's rain (world/rain.ts): how many puddles there are, and what a crossing from the park's
// edge to Sheep Meadow costs a steady pilot (wetness, integrity, time), flying normally, spread or curled.
//   npx tsx tools/park/rain-check.ts [height=10]
import fs from "node:fs";
import os from "node:os";
import { CityData } from "../../src/world/data";
import { Airflow } from "../../src/world/airflow";
import { Glider } from "../../src/sim/glider";
import { makeCourse } from "../../src/world/course";
import { rainField } from "../../src/world/rain";

try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* ignore */ }
const H = Number(process.argv[2] ?? 10);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const rf = rainField(city, flow.parkLayout);
console.log(`rain zone x ${rf.x0.toFixed(0)}..${rf.x1.toFixed(0)} z ${rf.z0.toFixed(0)}..${rf.z1.toFixed(0)}; ${rf.puddles.length} puddles, ${rf.puddles.filter((p) => Math.hypot(p.x - 600, p.z - 8100) < 450).length} near the route`);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// where the way through crosses into the park
let s0 = 0;
for (let s = 0; s < course.path.length; s += 4) { const a = course.path.at(s); if (rf.inRain(a.x, a.z)) { s0 = Math.max(0, s - 30); break; } }

for (const style of ["normal", "spread", "curl", "mixed"]) {
  for (const run of [0, 1, 2]) {
    const a = course.path.at(s0);
    const g = new Glider(city, flow, { x: a.x, y: H, z: a.z, heading: Math.atan2(a.tx, a.tz) });
    g.detach();
    g.clock = 100 + run * 37;
    const dt = 1 / 120;
    let inParkT = 0, minI = 1;
    for (let i = 0; i < 400 / dt && g.state === "flying"; i++) {
      if (i % 6 === 0) flow.traffic.update(g.clock);
      const p = g.pos, pn = course.path.nearest(p.x, p.z);
      const t = course.path.at(Math.min(course.path.length, pn.s + (pn.d > 10 ? 6 : 40)));
      const end = course.path.length - pn.s < 120 || course.inMeadow(p.x, p.z);
      const want = end ? 0 : H;
      let d = Math.atan2(t.x - p.x, t.z - p.z) - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      const spread = style === "spread" || (style === "mixed" && g.wet < 0.3);
      const curl = style === "curl" || (style === "mixed" && g.wet >= 0.3 && p.y > want + 2);
      g.step(dt, { pitch: g.grounded && !course.inMeadow(p.x, p.z) ? -1 : clamp((p.y - want) * 0.15 - g.vel.y * 0.12, -1, 1), roll: clamp(-d * 2, -1, 1), spread: spread && !curl, curl });
      if (g.grounded && course.inMeadow(p.x, p.z) && Math.hypot(g.vel.x, g.vel.z) < 2.5) g.plant();
      if (g.rain > 0) inParkT += dt;
      minI = Math.min(minI, g.integrity);
    }
    console.log(`${style.padEnd(7)} run ${run}: ${g.state.padEnd(8)} ${g.failure.padEnd(24)} ${inParkT.toFixed(0)} s in the rain, wet ${g.wet.toFixed(2)}, integrity ${g.integrity.toFixed(2)} (max ${g.maxIntegrity.toFixed(2)}), rain fell ${g.rainFor.toFixed(0)} s  ${g.events.slice(-2).join(" | ")}`);
  }
}
