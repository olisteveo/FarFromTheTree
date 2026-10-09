import fs from "node:fs";
const q = new URLSearchParams({ $where: "latitude between 40.698 and 40.778 and longitude between -74.024 and -73.966", $limit: "50000", $select: "tree_id,latitude,longitude,tree_dbh,spc_common,status" });
const d = await (await fetch(`https://data.cityofnewyork.us/resource/uvpi-gqnh.json?${q}`, { headers: { "User-Agent": "FarFromTheTree/0.1" } })).json();
fs.writeFileSync("../../data/nyc_trees.json", JSON.stringify(d));
console.log("trees", d.length);
