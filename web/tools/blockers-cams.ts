// Free-camera URLs looking at one barrier of each blocker (for screenshots).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Blockers } from "../src/world/blockers";
const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const b = new Blockers(c);
for (const k of ["water", "festival", "market", "crowd", "parade"]) {
  const x = b.barriers.find((q) => q.kind === k)!;
  const px = x.x + x.nx * 24, pz = x.z + x.nz * 24, yaw = (Math.atan2(-x.nx, -x.nz) * 180) / Math.PI;
  console.log(k, `?nointro&cam=${px.toFixed(0)},7,${pz.toFixed(0)},${yaw.toFixed(0)},-5`);
}
