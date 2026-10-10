// How far is each way in by the stairs from the nearest way out (stairs) at its station?
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Underground } from "../src/world/underground";
const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const u = new Underground(c);
const st = u.shafts.filter((s) => s.kind === "stairs");
const ins = st.filter((s) => !s.out), outs = st.filter((s) => s.out);
const gaps = ins.map((i) => Math.min(...outs.filter((o) => o.name === i.name).map((o) => Math.hypot(o.x - i.x, o.z - i.z)), 999));
gaps.sort((a, b) => a - b);
console.log(`${ins.length} in, ${outs.length} out; nearest way out from each way in (m): min ${gaps[0].toFixed(0)}, median ${gaps[gaps.length >> 1].toFixed(0)}; under 20 m: ${gaps.filter((g) => g < 20).length}`);
