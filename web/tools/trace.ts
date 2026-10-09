// Trace one bot flight second by second: npx tsx tools/trace.ts street|roof|subway s0 seconds
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider, type LeafInput } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";
const [bot, s0a, secA] = process.argv.slice(2);
const s0 = Number(s0a ?? 1800), seconds = Number(secA ?? 20);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const line = bot === "subway" ? city.subway : city.route;
const p = line.at(s0);
const H = city.canopy(p.x, p.z, 14);
const y0 = bot === "roof" ? H + 18 : bot === "street" ? 6 : (TUNNEL.floor + TUNNEL.ceiling) / 2;
const g = new Glider(city, flow, { x: p.x, y: y0, z: p.z, heading: Math.atan2(p.tx, p.tz) });
g.detach();
const input: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false };
const dt = 1 / 120;
for (let i = 0; i < seconds / dt && g.state === "flying"; i++) {
  if (i % 4 === 0) {
    flow.traffic.update(g.clock);
    const n = line.nearest(g.pos.x, g.pos.z);
    const ahead = line.at(n.s + 25);
    const want = Math.atan2(ahead.x - g.pos.x, ahead.z - g.pos.z);
    let d = want - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    input.roll = Math.max(-1, Math.min(1, -d * 2.2));
    const Hh = city.canopy(g.pos.x, g.pos.z, 14);
    const target = bot === "roof" ? Hh + 15 : bot === "street" ? 5 : (TUNNEL.floor + TUNNEL.ceiling) / 2;
    const err = g.pos.y - target;
    input.pitch = Math.max(-1, Math.min(1, err * 0.25 - g.vel.y * 0.15));
    input.spread = err < -3; input.curl = err > 6 && bot !== "roof";
  }
  g.step(dt, input);
  if (i % 60 === 0) {
    const n = line.nearest(g.pos.x, g.pos.z);
    const a = g.air;
    console.log(`t=${g.time.toFixed(1)} s=${n.s.toFixed(0)} off=${n.off.toFixed(1)} pos=(${g.pos.x.toFixed(1)},${g.pos.y.toFixed(1)},${g.pos.z.toFixed(1)}) v=(${g.vel.x.toFixed(1)},${g.vel.y.toFixed(1)},${g.vel.z.toFixed(1)}) wind=(${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}) ${a.lane} air=${g.airspeed.toFixed(1)} hd=${(g.heading*57.3).toFixed(0)} bank=${g.bank.toFixed(2)} a=${g.alpha.toFixed(2)} int=${g.integrity.toFixed(2)} gr=${g.grounded}`);
  }
}
console.log(g.state, g.failure);
