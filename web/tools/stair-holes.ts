// How many subway stair openings (4.2 m squares) sit fully inside one sidewalk polygon?
import fs from "node:fs";
import { CityData, inRing } from "../src/world/data";
import { Underground } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
let inside = 0, partial = 0, none = 0;
for (const s of u.shafts) {
  if (s.kind !== "stairs") continue;
  const L = Math.hypot(s.tx, s.tz) || 1, ux = s.tx / L, uz = s.tz / L;
  const corners = [[-2.1, -1.95], [-2.1, 1.95], [2.1, 1.95], [2.1, -1.95]].map(([a, b]) => [s.x + ux * a + uz * b, s.z + uz * a - ux * b]);
  let best = 0;
  for (const p of city.raw.sidewalk) { const c = corners.filter(([x, z]) => inRing(p[0], x, z)).length; best = Math.max(best, c); }
  if (best === 4) inside++; else if (best > 0) partial++; else none++;
}
console.log({ inside, partial, none });
