import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Facades } from "../src/world/facades";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const t = performance.now();
const f = new Facades(city);
const c: Record<string, number> = {};
for (const p of f.props) c[p.kind] = (c[p.kind] ?? 0) + 1;
console.log(c, (performance.now() - t).toFixed(0) + " ms");
