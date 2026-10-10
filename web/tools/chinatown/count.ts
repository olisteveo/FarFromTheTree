// How many of each Chinatown part the layout places, per quality (dev check): npx tsx tools/chinatown/count.ts
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { Blockers } from "../../src/world/blockers";
import { chinatownLayout } from "../../src/render/chinatown";
const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const b = new Blockers(c);
for (const q of ["high", "medium", "low"] as const) {
  const L = chinatownLayout(c, b, q);
  console.log(q, { gates: L.gates.length, curtain: L.curtain.length, strings: L.strings.length, awning: L.awning.length, neon: L.neon.map((n) => n.length), stalls: L.stalls.length, lions: L.lions.length, barricades: L.barricades.length, wireSegs: L.wires.length / 6 });
}
