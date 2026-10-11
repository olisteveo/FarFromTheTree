// The ways through: how many links each has, how much of its line the currents cover, the biggest gap.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const F = flow.features;
for (const r of F.routes) {
  const links = F.jets.filter((j) => j.route === r.id);
  const cover = new Uint8Array(Math.ceil(r.line.length / 10));
  for (const j of links) for (let i = 0; i < j.pts.length; i += 3) { const s = r.line.nearest(j.pts[i], j.pts[i + 2]).s; cover[Math.floor(s / 10)] = 1; }
  let covered = 0, gap = 0, maxGap = 0, at = 0;
  for (let i = 0; i < cover.length; i++) { if (cover[i]) { covered++; gap = 0; } else if (++gap > maxGap) { maxGap = gap; at = i * 10; } }
  const grades = [0, 1, 2].map((g) => links.filter((j) => j.grade === g).length);
  console.log(`${r.name}: ${(r.line.length / 1000).toFixed(1)} km, ${links.length} links (breeze/stream/gale ${grades.join("/")}), currents over ${((100 * covered) / cover.length).toFixed(0)}%, longest gap ${maxGap * 10} m at ${(at / 1000).toFixed(1)} km`);
}
