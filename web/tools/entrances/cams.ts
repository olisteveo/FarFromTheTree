// Camera URLs for looking at shafts:  npx tsx tools/entrances/cams.ts [nameRegex]
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { Underground } from "../../src/world/underground";
import { entranceStyle } from "../../src/render/subwayEntrances";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
const re = new RegExp(process.argv[2] ?? ".");
const deg = (r: number) => (r * 180 / Math.PI).toFixed(0);
for (const s of u.shafts) {
  if (s.kind === "grate" || !re.test(s.name)) continue;
  const yaw = Math.atan2(s.ux, s.uz);
  const st = s.kind === "stairs" ? entranceStyle(s, u) : "vent";
  const outside = `?nointro&cam=${(s.x - s.ux * 9).toFixed(1)},4,${(s.z - s.uz * 9).toFixed(1)},${deg(yaw)},-18`;
  const down = `?nointro&cam=${(s.x - s.ux * 1.6).toFixed(1)},1.2,${(s.z - s.uz * 1.6).toFixed(1)},${deg(yaw)},-30`;
  if (s.kind === "vent") {
    // from the side, up and back a bit, looking down at the grate
    const bx = s.uz, bz = -s.ux, cx = s.x + bx * 9 - s.ux * 4, cz = s.z + bz * 9 - s.uz * 4;
    const y2 = Math.atan2(s.x - cx, s.z - cz);
    console.log("  side:", `?nointro&at=600,30&cam=${cx.toFixed(1)},6,${cz.toFixed(1)},${deg(y2)},-30`);
    console.log("  below:", `?nointro&at=600,30&cam=${(s.x - s.ux * 7).toFixed(1)},-6.5,${(s.z - s.uz * 7).toFixed(1)},${deg(yaw)},35`);
  }
  console.log(s.kind, st, s.out ? "out" : "in", s.name, "L=" + Math.hypot(s.tx, s.tz).toFixed(1), "\n  ", outside, "\n  ", down);
}
