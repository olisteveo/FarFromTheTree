import fs from "node:fs";
const wkt = fs.readFileSync(process.env.WKT ?? "corridor_wkt.txt", "utf8");
let out = [], off = 0;
for (;;) {
  const q = new URLSearchParams({ $where: `within_polygon(the_geom, '${wkt}')`, $limit: "50000", $offset: String(off),
    $select: "the_geom,bin,height_roof,ground_elevation,construction_year,feature_code" });
  const d = await (await fetch(`https://data.cityofnewyork.us/resource/5zhs-2jue.json?${q}`, { headers: { "User-Agent": "FarFromTheTree/0.1" } })).json();
  if (!Array.isArray(d)) { console.log(d); break; }
  out = out.concat(d); off += d.length;
  if (d.length < 50000) break;
}
fs.writeFileSync(`../../data/${process.env.PFX ?? "nyc_"}buildings.json`, JSON.stringify(out));
console.log("buildings", out.length);
