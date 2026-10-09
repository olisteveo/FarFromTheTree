import fs from "node:fs";
const d = await (await fetch(`https://data.cityofnewyork.us/resource/gthc-hcne.json?boroname=Manhattan`, { headers: { "User-Agent": "FarFromTheTree/0.1" } })).json();
fs.writeFileSync("../../data/nyc_manhattan_land.json", JSON.stringify(d));
console.log(d.length, Object.keys(d[0]), d[0].the_geom?.coordinates?.length);
