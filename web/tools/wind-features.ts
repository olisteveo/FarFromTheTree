// List the hidden currents, dust devils and downdrafts, and time the wind with them.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const t0 = performance.now();
const flow = new Airflow(city);
const f = flow.features;
console.log(`built in ${(performance.now() - t0).toFixed(0)} ms (whole Airflow)`);
for (const j of f.jets) console.log(`${String(j.id).padStart(2)} ${j.kind.padEnd(6)} ${j.name.slice(0, 34).padEnd(34)} s ${j.s0.toFixed(0)}..${j.s1.toFixed(0)} len ${j.length.toFixed(0)} y ${j.pts[1].toFixed(0)}..${j.pts[j.pts.length - 2].toFixed(0)}`);
console.log(`${f.devils.length} devils: ${f.devils.map((d) => d.name).join(", ")}`);
console.log(`${f.lees.length} tower downdrafts`);
const s: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
const pts: [number, number, number][] = [];
for (let r = 300; r < 8000; r += 37) { const a = city.route.at(r); for (const off of [-6, 3, 30]) for (const y of [1.5, 9, 60]) pts.push([a.x + a.tz * off, y, a.z - a.tx * off]); }
for (const p of pts) flow.sample(p[0], p[1], p[2], 100, s);
const t1 = performance.now();
let inJet = 0;
for (let rep = 0; rep < 10; rep++) for (const p of pts) { flow.sample(p[0], p[1], p[2], 100, s); if ((s.jet ?? -1) >= 0) inJet++; }
console.log(`${(((performance.now() - t1) / (pts.length * 10)) * 1000).toFixed(1)} us per sample; ${((inJet / (pts.length * 10)) * 100).toFixed(1)}% of samples in a current`);
{
  const h = { x: 0, y: 0, z: 0, jet: -1, devil: -1, lee: false };
  const t2 = performance.now();
  for (let rep = 0; rep < 10; rep++) for (const p of pts) f.apply(p[0], p[1], p[2], 100, h);
  console.log(`features alone: ${(((performance.now() - t2) / (pts.length * 10)) * 1000).toFixed(1)} us per sample`);
}
