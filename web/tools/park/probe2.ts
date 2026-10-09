// Projects reference lat/lons in the south of Central Park to game metres (dev aid).
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { project } from "../../src/world/landmarks";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const F: Record<string, [number, number]> = { mallS: [40.7700, -73.9733], mallN: [40.7735, -73.9712], bethesda: [40.7740, -73.9708],
  smSW: [40.7703, -73.9770], smNW: [40.7735, -73.9772], smNE: [40.7744, -73.9745], smSE: [40.7713, -73.9745], tavern: [40.7723, -73.9779] };
for (const k in F) { const p = project(city, F[k][0], F[k][1]); console.log(k.padEnd(10), p[0].toFixed(0), p[1].toFixed(0)); }
