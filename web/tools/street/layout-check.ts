// Street furniture layout check: counts by kind, timing, colliders, solids near the route.
//   npx tsx tools/street/layout-check.ts [dump.json]
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { streetLayout } from "../../src/render/streetLayout";

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const t = performance.now();
const L = streetLayout(city);
console.log(`layout ${(performance.now() - t).toFixed(0)} ms`);
const kinds: Record<string, number> = {};
for (const it of L.items) kinds[it.k] = (kinds[it.k] ?? 0) + 1;
console.log("items", L.items.length, kinds);
const pk: Record<string, number> = {};
for (const p of L.parked) pk[p.kind] = (pk[p.kind] ?? 0) + 1;
console.log("parked", L.parked.length, pk);
console.log("plates", L.plates.length, "lenses", L.lenses.length, "colliders", L.colliders.length, "names", L.names.length);
console.log("stats", L.stats);
// anything solid right on the route centreline at street level?
let near = 0;
for (let s = 0; s < city.route.length; s += 2) {
  const p = city.route.at(s);
  for (const c of L.colliders) if (Math.hypot(c.x - p.x, c.z - p.z) < 1) { near++; break; }
}
console.log("route samples with a solid within 1 m:", near);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ items: L.items, parked: L.parked, plates: L.plates }));
