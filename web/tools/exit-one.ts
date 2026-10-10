// Trace one way out (index from env I) with the exit-test steering.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const none = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0 as const, loop: false };
const s = flow.under.shafts.filter((q) => q.out && q.kind === "stairs" && !flow.under.isBlocked(q.ss))[Number(process.env.I ?? 0)];
const sub = city.subway;
const p = sub.at(s.ss - 30), side = Math.sign(sub.nearest(s.x, s.z).off) || 1;
const g = new Glider(city, flow, { x: p.x + p.tz * 3.3 * side, y: (TUNNEL.floor + TUNNEL.ceiling) / 2 + 1, z: p.z - p.tx * 3.3 * side, heading: Math.atan2(p.tx, p.tz) });
g.detach(); g.lane = "subway";
const ep = s.exitPath!;
console.log(s.name, "aw", s.aw?.toFixed(1), "aCut", s.aCut?.toFixed(1), "path start", ep[0].toFixed(1), ep[1].toFixed(1), ep[2].toFixed(1), "n", ep.length / 3, "shaft", s.x.toFixed(1), s.z.toFixed(1));
for (let i = 0; i < 12 * 120 && g.state === "flying"; i++) {
  const dx = s.x - g.pos.x, dz = s.z - g.pos.z, d = Math.hypot(dx, dz);
  let turn = Math.atan2(dx, dz) - g.heading; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  g.step(1 / 120, { ...none, roll: Math.max(-1, Math.min(1, -turn * 2)), pitch: d < 10 ? -1 : g.pos.y < -7 ? -0.6 : 0, spread: d < 10 });
  let md = 99; for (let k = 0; k < ep.length; k += 3) md = Math.min(md, Math.hypot(ep[k] - g.pos.x, ep[k + 1] - g.pos.y, ep[k + 2] - g.pos.z));
  if (i % 30 === 0) console.log(g.clock.toFixed(2), "pos", g.pos.x.toFixed(1), g.pos.y.toFixed(1), g.pos.z.toFixed(1), "d", d.toFixed(1), "toPath", md.toFixed(1), "guide", (g.air.guide ?? 0).toFixed(2), "air", g.air.x.toFixed(1), g.air.y.toFixed(1), g.air.z.toFixed(1), "v", g.vel.length().toFixed(1));
  if (g.pos.y > 0.5) { console.log("OUT", g.clock.toFixed(1)); break; }
}
console.log(g.state, g.failure ?? "", g.events.slice(-4).join(" | "));
