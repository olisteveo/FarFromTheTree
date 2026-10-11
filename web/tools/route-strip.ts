// One way through, metre by metre: heading, turns, street width, the currents and the air at its height.
//   npx tsx tools/route-strip.ts <west|east|roofs> <from m> <to m> [step=40]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const [id, a0, a1, st] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5] ?? 40)];
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const w = flow.features.routes.find((r) => r.id === id)!;
const o: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
let lastH = 0;
for (let s = a0; s <= a1; s += st) {
  const a = w.line.at(s), y = w.y(s);
  const h = (Math.atan2(a.tx, a.tz) * 180) / Math.PI;
  let turn = h - lastH; turn = ((turn + 540) % 360) - 180; lastH = h;
  let L = 0, R = 0;
  for (let k = 1; k < 40; k++) { if (!L && city.buildingAt(a.x - a.tz * k, a.z + a.tx * k)) L = k; if (!R && city.buildingAt(a.x + a.tz * k, a.z - a.tx * k)) R = k; }
  let sa = 0, sy = 0, jet = -1, n = 0;
  for (const t of [20, 60, 100]) { flow.sample(a.x, y, a.z, t, o); sa += o.x * a.tx + o.z * a.tz; sy += o.y; if ((o.jet ?? -1) >= 0) jet = o.jet!; n++; }
  console.log(`${String(s).padStart(5)} (${a.x.toFixed(0)},${a.z.toFixed(0)}) hdg ${h.toFixed(0).padStart(4)} turn ${turn.toFixed(0).padStart(4)} width ${(L || 40) + (R || 40)} y ${y.toFixed(0)} air along ${(sa / n).toFixed(1).padStart(5)} up ${(sy / n).toFixed(1)} ${jet >= 0 ? "current " + jet : ""} ${city.buildingAt(a.x, a.z) ? "IN BUILDING" : ""}`);
}
