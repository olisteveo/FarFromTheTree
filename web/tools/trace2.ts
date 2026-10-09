// Trace a human pilot: npx tsx tools/trace2.ts profile seed seconds
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { Pilot, PROFILES } from "../src/sim/pilot";
import { makeCourse } from "../src/world/course";
const [pn, sd, sec] = process.argv.slice(2);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const g = new Glider(city, flow, course.start);
g.detach();
const pilot = new Pilot(city, flow, g, PROFILES.find((p) => p.name === (pn ?? "regular"))!, Number(sd ?? 1));
const dt = 1 / 120;
for (let i = 0; i < Number(sec ?? 60) / dt && g.state === "flying"; i++) {
  if (i % 6 === 0) flow.traffic.update(g.clock);
  const inp = pilot.update(dt);
  g.step(dt, inp);
  if (i % 240 === 0) {
    const n = city.route.nearest(g.pos.x, g.pos.z);
    console.log(`t${g.time.toFixed(0).padStart(3)} s${n.s.toFixed(0).padStart(5)} off${n.off.toFixed(0).padStart(4)} y${g.pos.y.toFixed(1).padStart(5)} v${g.vel.length().toFixed(1).padStart(5)} vy${g.vel.y.toFixed(1).padStart(5)} air${g.airspeed.toFixed(1).padStart(5)} wind(${g.air.x.toFixed(1)},${g.air.y.toFixed(1)},${g.air.z.toFixed(1)}) ${g.air.lane.padEnd(6)} ${pilot.mode.padEnd(9)} in p${inp.pitch.toFixed(1)} r${inp.roll.toFixed(1)}${inp.spread ? " S" : ""}${inp.curl ? " C" : ""} a${g.alpha.toFixed(2)} gr${g.grounded ? 1 : 0} int${g.integrity.toFixed(2)}`);
  }
}
console.log(g.state, g.failure, g.events.slice(-3));
