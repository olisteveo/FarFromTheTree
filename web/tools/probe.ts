import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const u = flow.under;
const near = u.shafts.filter((s) => s.kind === "stairs" && city.route.nearest(s.x, s.z).s < 400);
for (const s of near) {
  const L = Math.hypot(s.tx, s.tz);
  const line: string[] = [];
  for (const y of [0.3, -1, -3, -5, -6]) line.push(`y${y}:${u.sdf(s.x, y, s.z).toFixed(1)}`);
  const mid: string[] = [];
  for (const f of [0.25, 0.5, 0.75, 1.0]) mid.push(`${f}:${u.sdf(s.x + s.tx * f, -4.5, s.z + s.tz * f).toFixed(1)}`);
  console.log(`${s.name} ss${s.ss.toFixed(0)} route s${city.route.nearest(s.x, s.z).s.toFixed(0)} passage ${L.toFixed(1)}m | shaft ${line.join(" ")} | passage ${mid.join(" ")}`);
}
