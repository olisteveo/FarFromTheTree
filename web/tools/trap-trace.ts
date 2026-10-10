// Trace a pilot around where it gets stuck underground: npx tsx tools/trap-trace.ts profile seed
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { Pilot, PROFILES } from "../src/sim/pilot";
import { makeCourse } from "../src/world/course";
const [pn = "speedrunner", sd = "1"] = process.argv.slice(2);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const g = new Glider(city, flow, course.start);
g.detach();
const pilot = new Pilot(city, flow, g, PROFILES.find((p) => p.name === pn)!, Number(sd));
const rows: string[] = [];

const u = flow.under as unknown as { sdf: (x: number, y: number, z: number, info: { ss: number; off: number; inShaft: unknown }) => number };
for (let i = 0; i < 6 * 60 * 120 && g.state === "flying"; i++) {
  if (i % 6 === 0) { flow.traffic.update(g.clock); flow.crowd.update(g.clock, g.pos.x, g.pos.z, 60); }
  g.step(1 / 120, pilot.update(1 / 120));
  if (i % 30 === 0 && g.pos.y < 1) {
    const info = { ss: 0, off: 0, inShaft: null as unknown };
    const d = u.sdf(g.pos.x, g.pos.y, g.pos.z, info);
    const sh = info.inShaft as { kind: string; x: number; z: number; ux: number; uz: number } | null;
    const a = sh ? ((g.pos.x - sh.x) * sh.ux + (g.pos.z - sh.z) * sh.uz).toFixed(1) : "-";
    rows.push(`t${g.clock.toFixed(1)} y${g.pos.y.toFixed(1)} v${g.vel.length().toFixed(1)} sdf${d.toFixed(2)} ss${info.ss.toFixed(0)} off${info.off.toFixed(1)} ${sh ? sh.kind + " a" + a : ""} mode ${(pilot as unknown as { mode: string }).mode}`);
  }
}
console.log(g.state, g.failure, "route", city.route.nearest(g.pos.x, g.pos.z).s.toFixed(0));
console.log(rows.slice(-25).join("\n"));
console.log(g.events.slice(-5).join("\n"));
