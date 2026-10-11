// The false leads: where each peels off its way, which way it goes wrong, how long it runs
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const d = flow.features.jets.filter((j) => j.decoy);
for (const j of d) console.log(`${j.name.padEnd(36)} ${j.decoy!.padEnd(5)} ${j.length.toFixed(0)} m from (${j.pts[0].toFixed(0)},${j.pts[2].toFixed(0)}) to (${j.pts[j.pts.length - 3].toFixed(0)},${j.pts[j.pts.length - 1].toFixed(0)}) ${["breeze", "stream", "gale"][j.grade]}`);
console.log(d.length, "false leads;", flow.features.jets.length, "currents in all");
