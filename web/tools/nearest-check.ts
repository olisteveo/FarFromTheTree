// The indexed Polyline.nearest must match a brute-force search.
import fs from "node:fs";
import { CityData } from "../src/world/data";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
for (const line of [city.route, city.subway]) {
  let bad = 0, n = 0;
  const brute = (x: number, z: number) => { let best = Infinity, bs = 0; for (let i = 0; i < line.x.length - 1; i++) { const ax = line.x[i], az = line.z[i], dx = line.x[i + 1] - ax, dz = line.z[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2; if (d2 < best) { best = d2; bs = (i + t) * line.step; } } return { s: bs, d: Math.sqrt(best) }; };
  const t0 = performance.now();
  for (let k = 0; k < 3000; k++) {
    const x = -2500 + Math.random() * 5000, z = -3000 + Math.random() * 13000;
    const a = line.nearest(x, z), b = brute(x, z);
    n++; if (Math.abs(a.d - b.d) > 1e-3) bad++;
  }
  console.log(`${n} checks, ${bad} mismatches, ${((performance.now() - t0) / n * 1000).toFixed(0)} us per check incl brute`);
}
