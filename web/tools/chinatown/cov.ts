import fs from "node:fs";
import { projLL } from "../../src/render/farData";
for (const f of ["nyc_centerline", "nyc2_centerline", "nyc_roadbed", "nyc2_roadbed", "nyc_sidewalk", "nyc2_sidewalk", "nyc_parks", "nyc2_parks"]) {
  const d = JSON.parse(fs.readFileSync(`data/${f}.json`, "utf8"));
  let n = 0; const names = new Set<string>();
  for (const r of d) {
    const g = r.the_geom ?? r.geometry ?? Object.values(r).find((v: any) => v && v.type && v.coordinates);
    if (!g) continue;
    const c = JSON.stringify(g.coordinates).match(/-?\d+\.\d+,-?\d+\.\d+/);
    if (!c) continue;
    const [lon, lat] = c[0].split(",").map(Number);
    const [x, z] = projLL(lat, lon);
    if (x < -950 && x > -1700 && z > 1500 && z < 2400) { n++; names.add(r.full_stree ?? r.stname_lab ?? r.street_nam ?? r.signname ?? ""); }
  }
  console.log(f, d.length, "in zone", n, [...names].slice(0, 30).join("|"));
}
