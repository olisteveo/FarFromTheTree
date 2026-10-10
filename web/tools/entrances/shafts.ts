// Lists the subway shafts and where each stair passage meets the tunnel / station wall.
//   npx tsx tools/entrances/shafts.ts
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { Underground, TUNNEL, STAIRS_FOOT } from "../../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
const sub = city.subway;
const width = (s: number) => {
  let k = 0;
  for (const st of u.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
  return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, k };
};
const counts: Record<string, number> = {};
const rows: string[] = [];
for (const s of u.shafts) {
  counts[s.kind + (s.out ? "_out" : "")] = (counts[s.kind + (s.out ? "_out" : "")] ?? 0) + 1;
  if (s.kind !== "stairs") continue;
  const L = Math.hypot(s.tx, s.tz);
  let hit = L;
  for (let t = -2.1; t <= L; t += 0.1) { const n = sub.nearest(s.x + s.ux * t, s.z + s.uz * t); if (Math.abs(n.off) < width(n.s).hw + 0.1) { hit = t; break; } }
  const dot = (s.ux * s.tx + s.uz * s.tz) / (L || 1);
  rows.push(`${s.name.padEnd(28)} ss=${s.ss.toFixed(0).padStart(5)} out=${s.out ? 1 : 0} L=${L.toFixed(1).padStart(5)} wallAt=${hit.toFixed(1).padStart(5)} foot=${STAIRS_FOOT.toFixed(2)} dirdot=${dot.toFixed(3)} x=${s.x.toFixed(1)} z=${s.z.toFixed(1)}`);
}
console.log(counts);
console.log(rows.join("\n"));
console.log("route at 180:", city.route.at(180));
