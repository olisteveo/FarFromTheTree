// Central Park layout sanity check: counts, timings, anything solid in Sheep Meadow, and an
// optional JSON dump for a map overlay.   npx tsx tools/park/layout-check.ts [out.json]
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { parkLayout } from "../../src/render/centralPark";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const t = performance.now();
const L = parkLayout(city);
console.log(`layout ${(performance.now() - t).toFixed(0)} ms`);
const sp: Record<string, number> = {};
for (const tr of L.trees) sp[tr.sp] = (sp[tr.sp] ?? 0) + 1;
console.log("trees", L.trees.length, sp);
console.log("props", Object.fromEntries(Object.entries(L.props).map(([k, v]) => [k, v.length])));
console.log("rocks", L.rocks.length, "walls", L.walls.length, "piers", L.piers.length, "colliders", L.colliders.length);
const kinds: Record<string, number> = {};
for (const c of L.colliders) kinds[c.name] = (kinds[c.name] ?? 0) + 1;
console.log(kinds);
const bad = L.colliders.filter((c) => L.inMeadow(c.x, c.z));
console.log("solids in the meadow:", bad.length, bad.slice(0, 5).map((c) => c.name + "@" + c.x.toFixed(0) + "," + c.z.toFixed(0)).join(" "));
// along the end of the route: the nearest solid to each route point in the park
let minD = Infinity, at = "";
const s0 = city.raw.districts.find((d) => d.id === "park")!.s0;
for (let s = s0; s < city.route.length; s += 2) {
  const p = city.route.at(s);
  for (const c of L.colliders) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < minD) { minD = d; at = `${c.name} at s ${s}`; } }
}
console.log("closest solid to the route centreline:", minD.toFixed(1), "m,", at);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ trees: L.trees, props: L.props, rocks: L.rocks, walls: L.walls, pond: L.pond, rink: L.rink, bridge: L.bridge, maine: L.maine }));
