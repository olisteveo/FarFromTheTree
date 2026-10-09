// How many kids are in Central Park, and where (a quick sanity check).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Park } from "../src/world/park";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const s0 = city.raw.districts.find((d) => d.id === "park")!.s0;
const p = new Park(city, s0);
console.log(`${p.kids.length} kids from s ${s0} to ${city.route.length.toFixed(0)}`);
