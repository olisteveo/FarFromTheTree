// Where the Manhattan Bridge comes down in Chinatown, relative to the route (for screenshots).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { projLL } from "../src/render/farData";
const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const [mx, mz] = projLL(40.7075, -73.9906);
const p2 = projLL(40.7075 + 40.7 - 40.7148, -73.9906 - 73.985 + 73.9958);
const L = Math.hypot(p2[0] - mx, p2[1] - mz), ux = (p2[0] - mx) / L, uz = (p2[1] - mz) / L;
for (const t of [-826, -600, -446, 446]) {
  const x = mx + ux * t, z = mz + uz * t, n = c.route.nearest(x, z);
  console.log(t, x.toFixed(0), z.toFixed(0), "route s", n.s.toFixed(0), "dist", Math.hypot(c.route.at(n.s).x - x, c.route.at(n.s).z - z).toFixed(0));
}
for (const s of [1800, 2000, 2200, 2400, 2600]) { const a = c.route.at(s); console.log("s", s, a.x.toFixed(0), a.z.toFixed(0)); }
