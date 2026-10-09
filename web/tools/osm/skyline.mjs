// Tall buildings across lower and midtown Manhattan, for the distant skyline.
import fs from "node:fs";
let out = [], off = 0;
for (;;) {
  const q = new URLSearchParams({
    $where: "within_box(the_geom, 40.80, -74.03, 40.695, -73.925) and height_roof > 110",
    $select: "the_geom,bin,height_roof,construction_year", $limit: "50000", $offset: String(off) });
  const d = await (await fetch(`https://data.cityofnewyork.us/resource/5zhs-2jue.json?${q}`, { headers: { "User-Agent": "FarFromTheTree/0.1" } })).json();
  if (!Array.isArray(d)) { console.log(d); break; }
  out = out.concat(d); off += d.length;
  if (d.length < 50000) break;
}
fs.writeFileSync("../../data/nyc_skyline.json", JSON.stringify(out));
console.log("skyline", out.length);
