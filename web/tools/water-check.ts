// Where in the corridor does the airflow think it's over open water? (s ranges and sides)
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, AIR } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const r = city.route;
const hits: string[] = [];
for (let s = 0; s < r.length; s += 20) {
  const p = r.at(s);
  for (const side of [-1, 1]) for (let o = 0; o <= AIR.corridor; o += 20) {
    const x = p.x + p.tz * o * side, z = p.z - p.tx * o * side;
    if (flow.overWater(x, z)) { hits.push(`s${s} ${side > 0 ? "R" : "L"}${o}`); break; }
  }
}
console.log(hits.length, "route points with water inside the corridor");
console.log(hits.join(" "));
