// Free-cam URLs looking up at stairs that open into a hall (STATION env filters by name).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Underground } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
const re = new RegExp(process.env.STATION ?? ".");
for (const s of u.shafts.filter((q) => q.kind === "stairs" && q.aCut !== undefined && re.test(q.name)).slice(0, 4)) {
  const m = city.subway.nearest(s.x, s.z), p = city.subway.at(m.s);
  // stand on the far platform side, back along the line, looking at the opening
  const cx = p.x - p.tx * 10 + (s.x - p.x) * -0.2, cz = p.z - p.tz * 10 + (s.z - p.z) * -0.2;
  const yaw = (Math.atan2(s.x + s.ux * 3 - cx, s.z + s.uz * 3 - cz) * 180) / Math.PI;
  console.log(s.name, s.out ? "out" : "in", `?nointro&cam=${cx.toFixed(1)},-6.5,${cz.toFixed(1)},${yaw.toFixed(0)},25`);
}
