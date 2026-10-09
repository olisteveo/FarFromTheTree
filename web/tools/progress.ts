// Where does a pilot lose time? Prints progress per 100 m of route: seconds taken, lane, height, off-route.
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
let bucket = 0, tIn = 0, ys = 0, offs = 0, n = 0, back = 0;
let lastS = 0;
let anchor = { x: 0, z: 0, t: 0 };
const lanes: Record<string, number> = {};
for (let i = 0; i < Number(sec ?? 600) / dt && g.state === "flying"; i++) {
  if (i % 6 === 0) flow.traffic.update(g.clock);
  g.step(dt, pilot.update(dt));
  const r = city.route.nearest(g.pos.x, g.pos.z);
  if (r.s < lastS - 0.01) back += lastS - r.s;
  lastS = r.s;
  tIn += dt; ys += g.pos.y; offs += Math.abs(r.off); n++; lanes[g.lane] = (lanes[g.lane] ?? 0) + dt;
  if (g.time - anchor.t > 20) {
    if (Math.hypot(g.pos.x - anchor.x, g.pos.z - anchor.z) < 50) console.log(`  TRAP ${city.street(g.pos.x, g.pos.z).name} b=${!!city.buildingAt(g.pos.x, g.pos.z)} H${city.canopy(g.pos.x, g.pos.z, 14).toFixed(0)} near (${g.pos.x.toFixed(0)}, ${g.pos.y.toFixed(1)}, ${g.pos.z.toFixed(0)}) s${r.s.toFixed(0)} wind(${g.air.x.toFixed(1)},${g.air.y.toFixed(1)},${g.air.z.toFixed(1)}) ${pilot.mode} grounded=${g.grounded}`);
    anchor = { x: g.pos.x, z: g.pos.z, t: g.time };
  }
  const b = Math.floor(r.s / 100);
  if (b > bucket) {
    console.log(`${(bucket * 100).toString().padStart(5)}m ${tIn.toFixed(0).padStart(4)}s  y${(ys / n).toFixed(1).padStart(5)} off${(offs / n).toFixed(0).padStart(4)} back${back.toFixed(0).padStart(4)} ${Object.entries(lanes).map(([k, v]) => `${k}${v.toFixed(0)}`).join(" ")} ${pilot.mode} int${g.integrity.toFixed(2)} ${city.district(r.s).name}`);
    bucket = b; tIn = 0; ys = 0; offs = 0; n = 0; back = 0; for (const k in lanes) delete lanes[k];
  }
}
console.log(g.state, g.failure, g.time.toFixed(0));
