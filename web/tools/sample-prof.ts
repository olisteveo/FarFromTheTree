// Profile Airflow.sample at street level around the route (for the wind cost).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const s: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
flow.traffic.update(100);
const pts: [number, number, number][] = [];
for (let r = 300; r < 8000; r += 37) { const a = city.route.at(r); for (const off of [-6, -2, 3, 8]) for (const y of [1.5, 4, 9, 30]) pts.push([a.x + a.tz * off, y, a.z - a.tx * off]); }

for (let rep = 0; rep < 2; rep++) for (const [x, y, z] of pts) flow.sample(x, y, z, 100, s);
const t1 = performance.now();
for (let rep = 0; rep < 20; rep++) for (const [x, y, z] of pts) flow.sample(x, y, z, 100, s);
const n = pts.length * 20;
console.log(`${n} samples, ${(((performance.now() - t1) / n) * 1000).toFixed(1)} us each`);
