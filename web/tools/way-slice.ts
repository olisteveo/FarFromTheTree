// Across the island at one z: how "on a way" each spot is, and where the roof air goes vs uptown (deg)
//   npx tsx tools/way-slice.ts z [y=60]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const o: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
const z = Number(process.argv[2]), y = Number(process.argv[3] ?? 60);
for (let x = -900; x <= 400; x += 25) {
  if (city.canopy(x, z, 2) <= 0 && !city.buildingAt(x, z) && Math.abs(x) > 600) continue;
  flow.sample(x, y, z, 30, o);
  const r = city.route.at(city.route.nearest(x, z).s);
  const ang = (Math.atan2(o.x * r.tz - o.z * r.tx, o.x * r.tx + o.z * r.tz) * 180) / Math.PI;
  console.log(`x ${x} way ${flow.onWay(x, z).toFixed(2)} air ${Math.hypot(o.x, o.z).toFixed(1)} m/s at ${ang.toFixed(0)} deg from uptown`);
}
