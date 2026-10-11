// Down on the ground in Central Park, dry and in the rain: can a leaf get airborne again? Places a resting leaf
// at points across the park and has it do what a player would (flare and spread to catch a gust, then climb),
// and reports how high it gets and how long that takes.
//   npx tsx tools/park/takeoff.ts
import fs from "node:fs";
import os from "node:os";
import { CityData } from "../../src/world/data";
import { Airflow } from "../../src/world/airflow";
import { Glider } from "../../src/sim/glider";
import { makeCourse } from "../../src/world/course";
try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* ignore */ }
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const L = course.path.length;
for (const wet of [0, 0.4, 0.75]) {
  const rows: string[] = [];
  let ok = 0, n = 0;
  for (let s = L - 900; s < L - 150; s += 75) {
    const a = course.path.at(s);
    const g = new Glider(city, flow, { x: a.x, y: 0.15, z: a.z, heading: Math.atan2(a.tx, a.tz) });
    g.detach();
    g.clock = 60 + s * 0.01;
    // already in the rain a while (so it's raining hard), already this wet
    if (wet > 0) { (g as unknown as { rainFor: number }).rainFor = 30; (g as unknown as { rain: number }).rain = 1; }
    g.wet = wet;
    g.vel.set(0, 0, 0);
    const dt = 1 / 120;
    let maxY = 0, tUp = -1;
    for (let i = 0; i < 20 / dt && g.state === "flying"; i++) {
      if (i % 6 === 0) flow.traffic.update(g.clock);
      const p = g.pos;
      // on the ground: flare (pitch back) with the leaf spread to catch the air; airborne: climb into the wind
      const pitch = g.grounded ? -1 : p.y < 6 ? -0.6 : 0;
      g.step(dt, { pitch, roll: 0, spread: true, curl: false, corkscrew: 0, loop: false });
      if (g.wet !== undefined && wet > 0) g.wet = Math.max(g.wet, wet);
      maxY = Math.max(maxY, p.y);
      if (tUp < 0 && p.y > 4) tUp = g.time;
    }
    n++;
    if (tUp >= 0) ok++;
    rows.push(`  s${s.toFixed(0)} (${a.x.toFixed(0)},${a.z.toFixed(0)}): ${g.state}${g.failure ? " (" + g.failure + ")" : ""}, max height ${maxY.toFixed(1)} m${tUp >= 0 ? `, above 4 m after ${tUp.toFixed(1)} s` : ", never got above 4 m"}`);
  }
  console.log(`\nwet ${wet}: ${ok}/${n} got airborne (above 4 m) within 20 s`);
  console.log(rows.join("\n"));
}
