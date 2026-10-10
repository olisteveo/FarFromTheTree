// One human-like pilot run, logged every half second (PROFILE, SEED, SECS env).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { Pilot, PROFILES } from "../src/sim/pilot";
import { makeCourse } from "../src/world/course";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const prof = PROFILES.find((p) => p.name === (process.env.PROFILE ?? "casual"))!;
const g = new Glider(city, flow, course.start);
g.detach();
const pilot = new Pilot(city, flow, g, prof, Number(process.env.SEED ?? 3));
const dt = 1 / 120;
let lastLog = 0;
for (let i = 0; i < Number(process.env.SECS ?? 120) / dt && g.state === "flying"; i++) {
  if (i % 6 === 0) { flow.traffic.update(g.clock); flow.crowd.update(g.clock, g.pos.x, g.pos.z, 60); }
  g.step(dt, pilot.update(dt));
  if (g.clock - lastLog > 0.5) {
    lastLog = g.clock;
    const s = city.route.nearest(g.pos.x, g.pos.z).s;
    console.log(`${g.clock.toFixed(1)} s${s.toFixed(0)} ${g.lane} pos ${g.pos.x.toFixed(1)},${g.pos.y.toFixed(1)},${g.pos.z.toFixed(1)} v ${g.vel.length().toFixed(1)} guide ${(g.air.guide ?? 0).toFixed(2)} mode ${(pilot as any).mode}`);
  }
}
console.log(pilot.log.join("\n"));
