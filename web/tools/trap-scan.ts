// Dead spots on the streets: a resting leaf is dropped every ~80 m along every street in the play
// corridor, and the game's skilled autopilot (src/sim/pilot.ts, "speedrunner") gets 30 s to get it going
// again. It escapes if it makes 60 m of progress uptown or gets up onto the roofs. Where it can't, that's a
// trap: the shards write results/traps_<k>.json, and --merge groups them into places.
//   npx tsx tools/trap-scan.ts <shard> <shards>      (run several at idle priority, at most 8)
//   npx tsx tools/trap-scan.ts --merge [shards]
import fs from "node:fs";
import os from "node:os";
import { CityData } from "../src/world/data";
import { AIR, Airflow } from "../src/world/airflow";
import { Glider, type LeafInput } from "../src/sim/glider";
import { makeCourse } from "../src/world/course";
import { Pilot, PROFILES } from "../src/sim/pilot";

const STEP = 80, TIME = 30, GAIN = 60;
// "escape" (default): what a stuck player does: climb (over the roofs where they're low, to canyon height
// between towers), head for the way through, and if it isn't getting anywhere, fight straight up.
// "pilot": the in-game autopilot's speedrunner (it keeps to the street, so it dives back down).
const MODE = process.env.SCAN_PILOT ? "pilot" : "escape";
if (process.env.CONVLIFT) AIR.convLift = Number(process.env.CONVLIFT); // (A/B the converging-air lift)
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));

if (process.argv[2] === "--merge") {
  const n = Number(process.argv[3] ?? 8);
  const all: { x: number; z: number; s: number; y: number; why: string; state: string }[] = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    const f = `results/${process.env.TRAPS_OUT ?? "traps"}_${k}.json`;
    if (!fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    total += d.tried;
    all.push(...d.traps);
  }
  // group traps within 40 m of each other into places
  const groups: { x: number; z: number; s: number; n: number; why: Set<string> }[] = [];
  for (const t of all) {
    const g = groups.find((q) => Math.hypot(q.x - t.x, q.z - t.z) < 40);
    if (g) { g.n++; g.why.add(t.why); } else groups.push({ x: t.x, z: t.z, s: t.s, n: 1, why: new Set([t.why]) });
  }
  groups.sort((a, b) => b.n - a.n);
  console.log(`${all.length} trapped of ${total} drops (${((all.length / Math.max(1, total)) * 100).toFixed(1)}%), in ${groups.length} places`);
  for (const g of groups.slice(0, 40)) console.log(`  s${g.s.toFixed(0).padStart(5)} (${g.x.toFixed(0)},${g.z.toFixed(0)})  x${g.n}  ${[...g.why].join(" / ")}`);
  fs.writeFileSync("results/traps_merged.json", JSON.stringify(groups.map((g) => ({ ...g, why: [...g.why] }))));
  process.exit(0);
}

try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* ignore */ }
const shard = Number(process.argv[2] ?? 0), shards = Number(process.argv[3] ?? 1);
const flow = new Airflow(city);
const pro = PROFILES.find((p) => p.name === "speedrunner")!;
const L = city.route.length;

// drop points: along every street (vehicle roads), every STEP m, inside the play corridor, not under buildings
const pts: { x: number; z: number; s: number }[] = [];
for (const st of city.raw.streets) {
  const p = st.p;
  let carry = 0;
  for (let k = 0; k < p.length - 2; k += 2) {
    const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, len = Math.hypot(dx, dz);
    for (let t = carry; t < len; t += STEP) {
      const x = ax + (dx / len) * t, z = az + (dz / len) * t;
      const n = city.route.nearest(x, z);
      if (n.d > 300 || n.s < 120 || n.s > L - 250) continue; // (the tutorial lawn and the park's end are their own thing)
      if (city.buildingAt(x, z)) continue;
      pts.push({ x, z, s: n.s });
    }
    carry = (carry + len) % STEP;
  }
}
const course = makeCourse(city);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function escape(g: Glider, _best: number, stuckFor: number): LeafInput {
  const p = g.pos, pn = course.path.nearest(p.x, p.z);
  const a = course.path.at(Math.min(course.path.length, pn.s + (pn.d > 12 ? 8 : 50)));
  const H = Math.max(city.canopy(p.x, p.z, 25), city.canopy(a.x, a.z, 25));
  let want = H > 40 ? 18 : H + 9;
  if (stuckFor > 6) want = Math.max(want, H + 9); // getting nowhere: up and over
  let tx = a.x, tz = a.z;
  if (stuckFor > 6 && p.y < H) { tx = p.x + Math.sin(g.heading) * 5; tz = p.z + Math.cos(g.heading) * 5; } // (just climb)
  let d = Math.atan2(tx - p.x, tz - p.z) - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
  const pitch = g.grounded ? -1 : clamp((p.y - want) * 0.15 - g.vel.y * 0.12, -1, 1);
  return { pitch, roll: clamp(-d * 2, -1, 1), spread: p.y < want - 3, curl: false, corkscrew: 0, loop: false };
}
const mine = pts.filter((_, i) => i % shards === shard);
const traps: { x: number; z: number; s: number; y: number; why: string; state: string }[] = [];
const dt = 1 / 120;
let done = 0;
for (const [i, pt] of mine.entries()) {
  const a = city.route.at(pt.s);
  const g = new Glider(city, flow, { x: pt.x, y: 2.5, z: pt.z, heading: Math.atan2(a.tx, a.tz) });
  g.detach();
  g.clock = 50 + i * 3.7 + shard;
  g.vel.set(0, 0, 0);
  const pilot = MODE === "pilot" ? new Pilot(city, flow, g, pro, i * 31 + shard) : null;
  let best = pt.s, maxY = 0, escaped = false, bestT = 0;
  for (let k = 0; k < TIME / dt && g.state === "flying"; k++) {
    if (k % 6 === 0) flow.traffic.update(g.clock);
    g.step(dt, pilot ? pilot.update(dt) : escape(g, best, k * dt - bestT));
    const p = g.pos;
    if (k % 30 === 0) {
      const ns = city.route.nearest(p.x, p.z).s;
      if (ns > best + 3) { best = ns; bestT = k * dt; }
      maxY = Math.max(maxY, p.y);
      if (best - pt.s > GAIN || p.y > city.canopy(p.x, p.z, 10) + 3) { escaped = true; break; }
    }
  }
  if (!escaped && g.state === "flying") {
    const p = g.pos;
    traps.push({ x: pt.x, z: pt.z, s: pt.s, y: maxY, state: g.state, why: `stuck near (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) +${(best - pt.s).toFixed(0)} m` });
  }
  done++;
  if (done % 25 === 0) process.stderr.write(`shard ${shard}: ${done}/${mine.length}, ${traps.length} traps\n`);
}
fs.writeFileSync(`results/${process.env.TRAPS_OUT ?? "traps"}_${shard}.json`, JSON.stringify({ tried: mine.length, traps }));
console.log(`shard ${shard}: ${traps.length} traps of ${mine.length}`);
