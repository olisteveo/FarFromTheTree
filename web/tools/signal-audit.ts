// Can every driver see the light they're obeying, and does it show what they're obeying?
//   npx tsx tools/signal-audit.ts
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { SIGNAL, signalState } from "../src/world/signals";

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow: any = new Airflow(city), tr: any = flow.traffic;
tr.update(1);
const net = tr.net, lanes = net.lanes, L = flow.streetLayout;
const heads = L.lenses.filter((l: any) => l.kind === 0);
let ok = 0, none = 0, wrong = 0;
const noHead: string[] = [];
for (const l of net.blockLanes) {
  const a = lanes[l];
  if (a.group < 0 || !a.out.length) continue;
  const m = a.x.length - 1, x = a.x[m], z = a.z[m], d = Math.hypot(x - a.x[m - 1], z - a.z[m - 1]) || 1, tx = (x - a.x[m - 1]) / d, tz = (z - a.z[m - 1]) / d;
  const sig = tr.signals[net.nodes[lanes[a.out[0]].node].signal];
  // a head of this junction, ahead of the stop line, turned toward the driver
  const mine = heads.filter((h: any) => Math.abs(h.offset - sig.offset) < 1e-6 && Math.hypot(h.x - sig.x, h.z - sig.z) < 60 && (h.x - x) * tx + (h.z - z) * tz > -2 && Math.sin(h.rot) * tx + Math.cos(h.rot) * tz < -0.55);
  if (!mine.length) { none++; if (noHead.length < 10) noHead.push(`${Math.round(x)},${Math.round(z)}`); continue; }
  mine.every((h: any) => h.group === a.group) ? ok++ : wrong++;
}
console.log(`junctions ${L.signals.length}, heads ${heads.length}; arriving lanes: head facing them on their phase ${ok}, wrong phase ${wrong}, none ${none}`, noHead.join(" "));
// the plan itself: never two greens at once, and a full cycle adds up
let bad = 0, allRed = 0;
for (let q = 0; q < SIGNAL.cycle; q += 0.05) { const a = signalState(q, 0, 0).vehicle, b = signalState(q, 1, 0).vehicle; if (a > 0 && b > 0) bad++; if (a === 0 && b === 0) allRed += 0.05; }
console.log(`conflicting phases ${bad}; all-red per cycle ${allRed.toFixed(1)} s (should be ${SIGNAL.allRed * 2})`);
// nobody walks across moving traffic
let unsafe = 0;
for (let q = 0; q < SIGNAL.cycle; q += 0.05) for (const g of [0, 1]) if (signalState(q, g, 0).walk === 2 && signalState(q, g, 0).vehicle !== 0) unsafe++;
console.log(`WALK shown across a green or amber street: ${unsafe}`);
