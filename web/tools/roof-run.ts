// Can it be done? A skilled pilot flies the whole route from the tree over the rooftops: steers for
// the route 40 m ahead, holds ~12 m over the roofs (dives and flares to keep there), and at the end
// drops into Sheep Meadow. Several runs (wind changes with time); reports how far each gets and why
// it stopped.
//   npx tsx tools/roof-run.ts [runs=4] [minutes=25] [clearance=12]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { makeCourse } from "../src/world/course";
const runs = Number(process.argv[2] ?? 4), minutes = Number(process.argv[3] ?? 25), clear = Number(process.argv[4] ?? 12);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
for (let run = 0; run < runs; run++) {
  const g = new Glider(city, flow, course.start);
  g.detach();
  g.clock = run * 41;
  const dt = 1 / 120;
  let maxS = 0, stuck = 0, lastS = 0;
  const log: string[] = [];
  for (let i = 0; i < (minutes * 60) / dt && g.state === "flying"; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    const n = city.route.nearest(g.pos.x, g.pos.z);
    const end = n.s > city.route.length - 120;
    const a = city.route.at(Math.min(city.route.length, n.s + 40));
    let d = Math.atan2(a.x - g.pos.x, a.z - g.pos.z) - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    const H = Math.max(city.canopy(g.pos.x, g.pos.z, 25), city.canopy(a.x, a.z, 25));
    const want = end ? 0 : H + clear;
    const pitch = clamp((g.pos.y - want) * 0.15 - g.vel.y * 0.12, -1, 1);
    g.step(dt, { pitch, roll: clamp(-d * 2, -1, 1), spread: g.pos.y < want - 4, curl: false, corkscrew: 0, loop: false });
    if (g.grounded && course.inMeadow(g.pos.x, g.pos.z) && Math.hypot(g.vel.x, g.vel.z) < 2.5) g.plant();
    if (i % 1200 === 0) {
      if (n.s > maxS) maxS = n.s;
      if (Math.abs(n.s - lastS) < 5) stuck += 10; else stuck = 0;
      lastS = n.s;
      log.push(`${(g.clock - run * 41).toFixed(0)}s s${n.s.toFixed(0)} d${n.d.toFixed(0)} y${g.pos.y.toFixed(0)} ${g.lane}`);
      if (stuck > 60) break;
    }
  }
  console.log(`run ${run}: ${g.state} ${g.failure ?? ""} reached ${(maxS / 1000).toFixed(2)} km of ${(city.route.length / 1000).toFixed(2)} in ${(g.time / 60).toFixed(1)} min${stuck > 60 ? " (stuck)" : ""}`);
  console.log("   " + log.slice(-6).join(" | "));
  if (g.events.length) console.log("   " + g.events.slice(-3).join(" | "));
}
