// Where a lat/lon falls on the route: node --import tsx tools/where.ts lat,lon ...
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { project } from "../src/world/landmarks";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
for (const a of process.argv.slice(2)) {
  const [lat, lon] = a.split(",").map(Number);
  const [x, z] = project(city, lat, lon);
  const n = city.route.nearest(x, z);
  const sub = city.subway.nearest(x, z);
  console.log(a, `x ${x.toFixed(0)} z ${z.toFixed(0)}  route s ${n.s.toFixed(0)} off ${n.d.toFixed(0)}  subway s ${sub.s.toFixed(0)} off ${sub.d.toFixed(0)}  ${city.district(n.s).name}`);
}
