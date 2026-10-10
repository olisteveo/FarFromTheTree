// Downloads the distant city (everything outside the playable corridor) for public/far.bin:
//   node far.mjs            (run from tools/osm; writes ../../data/far_*.json)
// - every building footprint in Manhattan (NYC Open Data 5zhs-2jue, BIN 1xxxxxx)
// - Brooklyn / Queens / Bronx / Staten Island buildings near the rivers, taller than 3 storeys
// - the borough shorelines (gthc-hcne)
// - Jersey City / Hoboken / Weehawken buildings and the New Jersey coastline from OpenStreetMap
//   (Overpass; OSM data is ODbL, credited in game)
// Python urllib fails SSL on this machine: fetch with Node.
import fs from "node:fs";
const UA = { "User-Agent": "FarFromTheTree/0.1" };
const OUT = "../../data/";
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);

async function soda(where, select) {
  let out = [], off = 0;
  for (;;) {
    const q = new URLSearchParams({ $where: where, $select: select, $limit: "50000", $offset: String(off), $order: "bin" });
    const r = await fetch(`https://data.cityofnewyork.us/resource/5zhs-2jue.json?${q}`, { headers: UA });
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 400));
    out = out.concat(d); off += d.length;
    console.log("  ..", out.length);
    if (d.length < 50000) break;
  }
  return out;
}
const SEL = "the_geom,bin,height_roof,construction_year,feature_code";

if (want("manhattan")) {
  const d = await soda("bin >= 1000000 and bin < 2000000 and height_roof > 8", SEL);
  fs.writeFileSync(OUT + "far_manhattan.json", JSON.stringify(d));
  console.log("manhattan", d.length);
}
if (want("boroughs")) {
  // the waterfronts you can see across the rivers: Brooklyn Heights to Greenpoint, Long Island City,
  // the south Bronx, Red Hook; anything over ~3 storeys (smaller ones vanish in the haze)
  const d = await soda("within_box(the_geom, 40.86, -74.03, 40.63, -73.90) and (bin < 1000000 or bin >= 2000000) and height_roof > 38", SEL);
  fs.writeFileSync(OUT + "far_boroughs.json", JSON.stringify(d));
  console.log("boroughs", d.length);
}
if (want("boroughs_low")) {
  // the low-rise blocks right across the East River (Brooklyn Heights, DUMBO, Williamsburg, Greenpoint, LIC):
  // build-city keeps only those within ~1.3 km of Manhattan
  const d = await soda("within_box(the_geom, 40.79, -74.02, 40.67, -73.925) and (bin < 1000000 or bin >= 2000000) and height_roof > 14 and height_roof <= 38", SEL);
  fs.writeFileSync(OUT + "far_boroughs_low.json", JSON.stringify(d));
  console.log("boroughs low", d.length);
}
if (want("shore")) {
  const d = await (await fetch(`https://data.cityofnewyork.us/resource/gthc-hcne.json`, { headers: UA })).json();
  fs.writeFileSync(OUT + "far_shore.json", JSON.stringify(d));
  console.log("shore", d.length, d.map((r) => r.boroname).join(","));
}
async function overpass(ql) {
  for (let tryN = 0; tryN < 6; tryN++) {
    try { return await overpass1(ql); } catch (e) { console.log("  retry in", 20 * (tryN + 1), "s"); await new Promise((r) => setTimeout(r, 20000 * (tryN + 1))); }
  }
  throw new Error("overpass failed after retries");
}
async function overpass1(ql) {
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const r = await fetch(host, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(ql) });
      if (r.ok) return await r.json();
      console.log(host, r.status);
    } catch (e) { console.log(host, e.message); }
  }
  throw new Error("overpass failed");
}
if (want("nj")) {
  // the west bank of the Hudson, Bayonne to Fort Lee, in boxes that stop at the river (anything that
  // lands inside an NYC borough is dropped by build-city)
  const boxes = ["40.64,-74.12,40.69,-74.035", "40.69,-74.10,40.73,-74.022", "40.73,-74.08,40.76,-74.012", "40.76,-74.06,40.80,-73.995", "40.80,-74.03,40.87,-73.962"];
  const all = new Map();
  for (const bb of boxes) {
    const cache = OUT + "far_osm_" + bb.replace(/[^0-9]/g, "") + ".json";
    const d = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8")) : await overpass(`[out:json][timeout:120];way["building"](${bb});out tags geom;`);
    fs.writeFileSync(cache, JSON.stringify(d));
    for (const e of d.elements) if (e.geometry && e.geometry.length > 3) all.set(e.id, { t: e.tags, g: e.geometry.map((p) => [p.lon, p.lat]) });
    console.log("  ..", bb, d.elements.length);
    await new Promise((r) => setTimeout(r, 3000));
  }
  fs.writeFileSync(OUT + "far_osm_buildings.json", JSON.stringify([...all.values()]));
  console.log("osm buildings", all.size);
}
if (want("coast")) {
  const d = await overpass(`[out:json][timeout:120];way["natural"="coastline"](40.55,-74.30,40.95,-73.80);out geom;`);
  fs.writeFileSync(OUT + "far_coast.json", JSON.stringify(d.elements.map((e) => ({ id: e.id, n: e.nodes, g: e.geometry.map((p) => [p.lon, p.lat]) }))));
  console.log("coastline ways", d.elements.length);
}



