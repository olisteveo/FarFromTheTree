import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const none = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0 as const, loop: false };
const kind = process.argv[2] ?? "vent";
const s = flow.under.shafts.filter((q) => q.out && q.kind === kind && !flow.under.isBlocked(q.ss))[Number(process.argv[3] ?? 0)];
const sub = city.subway;
const p = sub.at(s.ss - 30), side = Math.sign(sub.nearest(s.x, s.z).off) || 1;
console.log(kind, s.name, "ss", s.ss.toFixed(0), "shaft off", sub.nearest(s.x, s.z).off.toFixed(1), "passage len", Math.hypot(s.tx, s.tz).toFixed(1));
const g = new Glider(city, flow, { x: p.x + p.tz * 3.3 * side, y: (TUNNEL.floor + TUNNEL.ceiling) / 2 + 1, z: p.z - p.tx * 3.3 * side, heading: Math.atan2(p.tx, p.tz) });
g.detach(); g.lane = "subway";
for (let i = 0; i < 8 * 120 && g.state === "flying"; i++) {
  const dx = s.x - g.pos.x, dz = s.z - g.pos.z, d = Math.hypot(dx, dz);
  let turn = Math.atan2(dx, dz) - g.heading; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  g.step(1 / 120, { ...none, roll: Math.max(-1, Math.min(1, -turn * 2)), pitch: d < 10 ? -1 : g.pos.y < -7 ? -0.6 : 0, spread: d < 10 });
  if (i % 24 === 0) { const n = sub.nearest(g.pos.x, g.pos.z); console.log(`t${g.clock.toFixed(1)} ss${n.s.toFixed(1)} off${n.off.toFixed(1)} y${g.pos.y.toFixed(1)} v(${g.vel.x.toFixed(1)},${g.vel.y.toFixed(1)},${g.vel.z.toFixed(1)}) air(${g.air.x.toFixed(1)},${g.air.y.toFixed(1)},${g.air.z.toFixed(1)}) ${g.lane}`); }
}
console.log(g.state, g.failure ?? "", g.events.slice(-3));
