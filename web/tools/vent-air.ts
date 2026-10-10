import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const v = flow.under.shafts.filter((q) => q.out && q.kind === "vent")[Number(process.argv[2] ?? 2)];
const sub = city.subway, s: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
console.log("vent", v.ss.toFixed(0), "u", v.ux.toFixed(2), v.uz.toFixed(2));
for (const ds of [-8, -4, 0]) for (const off of [3.3, 5.2, 6.5, 7.0]) {
  const p = sub.at(v.ss + ds);
  const x = p.x + p.tz * off, z = p.z - p.tx * off;
  flow.sample(x, Number(process.env.Y ?? -5), z, 50, s);
  const along = s.x * p.tx + s.z * p.tz, side = s.x * p.tz - s.z * p.tx;
  const n = sub.nearest(x, z);
  console.log(`ds ${ds} off ${off} (nearest off ${n.off.toFixed(1)}): along ${along.toFixed(1)} toward+off ${side.toFixed(1)} up ${s.y.toFixed(1)}`);
}
