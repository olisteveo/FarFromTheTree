// Can a leaf get out of the subway? Start one flying in the tunnel/station a little before
// each way out (on that side) and see if it reaches the street within 12 s, hands off.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { TUNNEL } from "../src/world/underground";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const none = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0 as const, loop: false };
const out: Record<string, number[]> = {};
for (const s of flow.under.shafts.filter((q) => q.out && !flow.under.isBlocked(q.ss))) {
  const key = s.kind;
  if ((out[key]?.length ?? 0) >= 12) continue;
  const sub = city.subway;
  const p = sub.at(s.ss - 30), side = Math.sign(sub.nearest(s.x, s.z).off) || 1;
  const g = new Glider(city, flow, { x: p.x + p.tz * 3.3 * side, y: (TUNNEL.floor + TUNNEL.ceiling) / 2 + 1, z: p.z - p.tx * 3.3 * side, heading: Math.atan2(p.tx, p.tz) });
  g.detach();
  g.lane = "subway";
  let t = -1;
  for (let i = 0; i < 12 * 120 && g.state === "flying"; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    // like a player following the EXIT pointer: steer for the way out, climb when close
    const dx = s.x - g.pos.x, dz = s.z - g.pos.z, d = Math.hypot(dx, dz);
    let turn = Math.atan2(dx, dz) - g.heading; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const steer = process.env.HANDS ? none : { ...none, roll: Math.max(-1, Math.min(1, -turn * 2)), pitch: d < 10 ? -1 : g.pos.y < -7 ? -0.6 : 0, spread: d < 10 };
    g.step(1 / 120, steer);
    if (g.pos.y > 0.5) { t = g.clock; break; }
  }
  (out[key] ??= []).push(t);
}
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(7), v.map((t) => (t < 0 ? "  -" : t.toFixed(1).padStart(4))).join(" "), ` -> ${v.filter((t) => t >= 0).length}/${v.length} got out`);
