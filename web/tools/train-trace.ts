// Why do pilots meet downtown trains head-on? Run pilots and print their last seconds
// underground before a train kills them: npx tsx tools/train-trace.ts profile seeds
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
for (const seed of seeds.split(",").map(Number)) {
  const g = new Glider(city, flow, course.start);
  g.detach();
  const pilot = new Pilot(city, flow, g, PROFILES.find((p) => p.name === pn)!, seed);
  const dt = 1 / 120, trail: string[] = [];
  for (let i = 0; i < 20 * 60 / dt && g.state === "flying"; i++) {
    if (i % 6 === 0) { flow.traffic.update(g.clock); flow.crowd.update(g.clock, g.pos.x, g.pos.z, 60); }
    g.step(dt, pilot.update(dt));
    if (i % 30 === 0 && g.lane === "subway") {
      const sb = city.subway.nearest(g.pos.x, g.pos.z);
      const near = flow.trainsAt(g.clock).filter((t) => Math.abs(t.head - sb.s) < 200).map((t) => `${t.dir > 0 ? "up" : "dn"}@${(t.head - sb.s).toFixed(0)}`).join(" ");
      trail.push(`t${g.clock.toFixed(1)} ss${sb.s.toFixed(0)} off${sb.off.toFixed(1)} y${g.pos.y.toFixed(1)} v${g.vel.length().toFixed(0)} | ${near}`);
    }
  }
  console.log(`== ${pn} #${seed}: ${g.state} ${g.failure ?? ""}`);
  console.log(trail.slice(-8).join("\n"));
  console.log(g.events.slice(-6).join("\n"));
}
