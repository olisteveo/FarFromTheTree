// The air over a patch: arrows of the wind at one height (B = building, # = barrier)
//   npx tsx tools/air-grid.ts x z y [half=40] [step=5]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const [x0, z0, y, half, step] = process.argv.slice(2).map(Number).concat([40, 5]).slice(0, 5) as number[];
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const o: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
console.log(`rows: z from ${z0 + half} (top) down; cols: x from ${x0 - half}. ↑ = +z, → = +x`);
for (let z = z0 + half; z >= z0 - half; z -= step) {
  let row = "";
  for (let x = x0 - half; x <= x0 + half; x += step) {
    const b = city.buildingAt(x, z);
    if (b && b.h > y) { row += " B  "; continue; }
    flow.sample(x, y, z, 30, o);
    const sp = Math.hypot(o.x, o.z), a = Math.atan2(o.x, o.z);
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    row += (sp < 1 ? " ·" : " " + arrows[k]) + String(Math.round(sp)).padStart(2);
  }
  console.log(String(z).padStart(6) + row);
}
