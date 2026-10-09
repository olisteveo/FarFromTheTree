// Downloads NYC open data for the corridor around the route.
// Data: NYC OpenData (Office of Technology and Innovation, Parks, MTA via data.ny.gov). Free to use.
import fs from "node:fs";
const wkt = fs.readFileSync(process.env.WKT ?? "corridor_wkt.txt", "utf8");
const PFX = process.env.PFX ?? "nyc_";
const UA = { "User-Agent": "FarFromTheTree/0.1" };
const sets = {
  centerline: ["data.cityofnewyork.us", "inkn-q76z"],
  roadbed: ["data.cityofnewyork.us", "i36f-5ih7"],
  sidewalk: ["data.cityofnewyork.us", "52n9-sdep"],
  median: ["data.cityofnewyork.us", "ees7-4ufv"],
  plaza: ["data.cityofnewyork.us", "ue2e-9jm2"],
  pavement_edge: ["data.cityofnewyork.us", "vs44-rznx"],
  hydro: ["data.cityofnewyork.us", "pjs3-c3z5"],
  parks: ["data.cityofnewyork.us", "y6ja-fw4f"],
  openspace: ["data.cityofnewyork.us", "b7j8-z8a7"],
  trees: ["data.cityofnewyork.us", "uvpi-gqnh"],
  subway_stations: ["data.ny.gov", "39hk-dx4f"],
  subway_entrances: ["data.ny.gov", "i9wp-a4ja"],
};
const only = process.argv.slice(2);
for (const [name, [dom, id]] of Object.entries(sets)) {
  if (only.length && !only.includes(name)) continue;
  try {
    const meta = await (await fetch(`https://${dom}/api/views/${id}.json`, { headers: UA })).json();
    const geo = (meta.columns ?? []).find((c) => /point|polygon|line|location/i.test(c.dataTypeName));
    if (!geo) { console.log(name, "no geometry column", (meta.columns ?? []).map((c) => c.fieldName + ":" + c.dataTypeName).join(", ")); continue; }
    let out = [], off = 0;
    for (;;) {
      const q = new URLSearchParams({ $where: `within_polygon(${geo.fieldName}, '${wkt}')`, $limit: "50000", $offset: String(off) });
      const r = await fetch(`https://${dom}/resource/${id}.json?${q}`, { headers: UA });
      const d = await r.json();
      if (!Array.isArray(d)) { console.log(name, "error", JSON.stringify(d).slice(0, 300)); break; }
      out = out.concat(d); off += d.length;
      if (d.length < 50000) break;
    }
    fs.writeFileSync(`../../data/${PFX}${name}.json`, JSON.stringify(out));
    console.log(name, out.length, "rows, geometry", geo.fieldName, geo.dataTypeName);
  } catch (e) { console.log(name, "ERR", e.message); }
}
