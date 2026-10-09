// Headless test flights over the real city: one bot per layer, measuring how fast each
// layer actually carries you uptown (metres of route per second) and what kills it.
// The design wants: roofs slowest and safest, street in the middle, subway fastest and deadliest.
//
//   npx tsx tools/fly.ts [seconds=90] [runs=6]

import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider, type LeafInput } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";

const seconds = Number(process.argv[2] ?? 90), runs = Number(process.argv[3] ?? 6);
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const dt = 1 / 120;

type Bot = "roof" | "street" | "subway";
function fly(bot: Bot, s0: number, seed: number) {
  const p = bot === "subway" ? city.subway.at(s0) : city.route.at(s0);
  const H = city.canopy(p.x, p.z, 14);
  const y = bot === "roof" ? H + 18 : bot === "street" ? 6 : (TUNNEL.floor + TUNNEL.ceiling) / 2;
  const g = new Glider(city, flow, { x: p.x, y, z: p.z, heading: Math.atan2(p.tx, p.tz) });
  g.detach();
  g.clock = seed * 37;
  const input: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false };
  const startS = s0;
  let maxS = s0, laneTime: Record<string, number> = {};
  for (let i = 0; i < seconds / dt && g.state === "flying"; i++) {
    if (i % 4 === 0) {
      flow.traffic.update(g.clock);
      const n = (bot === "subway" ? city.subway : city.route).nearest(g.pos.x, g.pos.z);
      const ahead = (bot === "subway" ? city.subway : city.route).at(n.s + 25);
      // steer for a point 25 m up the route
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
    laneTime[g.lane] = (laneTime[g.lane] ?? 0) + dt;
    const s = (bot === "subway" ? city.subway : city.route).nearest(g.pos.x, g.pos.z).s;
    maxS = Math.max(maxS, s);
  }
  return { progress: maxS - startS, time: g.time, state: g.state, failure: g.failure, laneTime, integrity: g.integrity };
}

for (const bot of ["roof", "street", "subway"] as Bot[]) {
  const rows = [];
  for (let r = 0; r < runs; r++) {
    const s0 = bot === "subway" ? 200 + r * 900 : 600 + r * 1200;
    rows.push(fly(bot, s0, r));
  }
  const speed = rows.map((x) => x.progress / x.time);
  const avg = speed.reduce((a, b) => a + b, 0) / speed.length;
  const deaths = rows.filter((x) => x.state === "dead");
  console.log(`${bot.padEnd(7)} avg ${avg.toFixed(1)} m/s uptown  [${speed.map((v) => v.toFixed(1)).join(", ")}]  survived ${rows.length - deaths.length}/${rows.length}  avg ${(rows.reduce((a, b) => a + b.time, 0) / rows.length).toFixed(0)}s`);
  for (const d of deaths) console.log(`         died after ${d.time.toFixed(0)}s: ${d.failure}`);
  const lt: Record<string, number> = {};
  for (const x of rows) for (const [k, v] of Object.entries(x.laneTime)) lt[k] = (lt[k] ?? 0) + v;
  console.log(`         time by lane: ${Object.entries(lt).map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(", ")}`);
}
