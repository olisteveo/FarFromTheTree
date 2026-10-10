// Stairwells whose enclosure carries on inside the tunnel or a station hall (drawn, but air in the sdf).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Underground, STAIRS, STAIRS_FOOT } from "../src/world/underground";
import { stairCut, tunnelShape } from "../src/render/subwayEntrances";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(city);
let n = 0, tun = 0;
for (const s of u.shafts) {
  if (s.kind !== "stairs") continue;
  const c = stairCut(u, s);
  if (!isFinite(c.aw) && c.aw > 0) continue;
  const aStart = Math.max(c.aw, -STAIRS.half);
  const inLen = STAIRS_FOOT + 1.4 - aStart;
  if (inLen <= 0.3) continue;
  n++;
  const m = city.subway.nearest(s.x + s.ux * (STAIRS_FOOT), s.z + s.uz * STAIRS_FOOT);
  const k = tunnelShape(u, m.s).k;
  if (k < 0.95) tun++;
  if (s.ss < 900) console.log(s.name, "ss", s.ss.toFixed(0), "out", !!s.out, "inside-hall length", inLen.toFixed(1), "k", k.toFixed(2), "foot off", m.off.toFixed(1));
}
console.log({ intruding: n, inPlainTunnelOrStationEnd: tun, stairs: u.shafts.filter((s) => s.kind === "stairs").length });
// where the openings sit across the line (off from the centreline) for those that come down inside
const rows: string[] = [];
for (const s of u.shafts) {
  if (s.kind !== "stairs") continue;
  const c = stairCut(u, s);
  if (!(c.aw < STAIRS_FOOT + 1.4)) continue;
  const o = city.subway.nearest(s.x, s.z);
  const k = tunnelShape(u, o.s).k;
  const tdot = Math.abs(s.ux * city.subway.at(o.s).tx + s.uz * city.subway.at(o.s).tz);
  rows.push(`${s.name.padEnd(22)} off ${o.off.toFixed(1).padStart(6)} k ${k.toFixed(2)} along-axis ${tdot.toFixed(2)} aw ${c.aw.toFixed(1)}`);
}
console.log(rows.join("\n"));
