// What do pilots hit underground? Records every hard tunnel contact: where along the line,
// how far off the centreline, its normal, and whether it's a station.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { Pilot, PROFILES } from "../src/sim/pilot";
import { makeCourse } from "../src/world/course";
const [pn = "regular", seeds = "1,2,3,4,5,6"] = process.argv.slice(2);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const kinds: Record<string, number> = {};
const rows: string[] = [];
for (const seed of seeds.split(",").map(Number)) {
  const g = new Glider(city, flow, course.start);
  g.detach();
  const pilot = new Pilot(city, flow, g, PROFILES.find((p) => p.name === pn)!, seed);
  const gg = g as unknown as { contact: (nx: number, ny: number, nz: number, d: number, what: string) => void };
  const orig = gg.contact.bind(g);
  gg.contact = (nx, ny, nz, d, what) => {
    const vn = -(g.vel.x * nx + g.vel.y * ny + g.vel.z * nz);
    if (vn > 9 && what.startsWith("the tunnel")) {
      const sb = city.subway.nearest(g.pos.x, g.pos.z);
      const st = flow.under.stationAt(sb.s);
      const sp = city.subway.at(sb.s);
      const along = nx * sp.tx + nz * sp.tz, side = nx * sp.tz - nz * sp.tx;
      const k = Math.abs(ny) > 0.7 ? (ny > 0 ? "floor" : "ceiling") : Math.abs(along) > 0.7 ? "end wall (facing along)" : Math.abs(sb.off) < 1.5 ? "column row" : "side wall";
      kinds[k] = (kinds[k] ?? 0) + 1;
      rows.push(`${pn}#${seed} ss${sb.s.toFixed(0)} off${sb.off.toFixed(1)} y${g.pos.y.toFixed(1)} v${vn.toFixed(0)} ${k}${st ? " STATION " + st.name : ""} n(${along.toFixed(2)},${ny.toFixed(2)},${side.toFixed(2)})`);
    }
    orig(nx, ny, nz, d, what);
  };
  const dt = 1 / 120;
  for (let i = 0; i < 20 * 60 / dt && g.state === "flying"; i++) {
    if (i % 6 === 0) { flow.traffic.update(g.clock); flow.crowd.update(g.clock, g.pos.x, g.pos.z, 60); }
    g.step(dt, pilot.update(dt));
  }
}
console.log(kinds);
console.log(rows.slice(0, 40).join("\n"));
