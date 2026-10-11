// In, fly a while, out: for EVERY way in to the subway, a skilled pilot starts out in the street,
// approaches it as a player would and dives for it; the stream should draw it down and deliver it
// onto the uptown track. It then rides the tunnel uptown over the uptown track (up near the ceiling,
// over the trains) past at least one station, makes for the next way out and should be carried up and
// out into the street alive. Several approach angles and train timings per way in.
//
//   npx tsx tools/subway-loop.ts [variants=6] [shard=0] [shards=1] [--json out.json]
//   npx tsx tools/subway-loop.ts --merge a.json b.json ...      (combine shard results into the report)
//   ONLY=<name regex>  just those ways in;  TRACE=1  log every half second
//
// Failures: never drawn in | not onto the uptown track (counted, not fatal) | wall | train | rat |
// stuck | missed the way out (flew past it) | never carried out.
import fs from "node:fs";
import os from "node:os";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { TRAIN, TUNNEL, VENT, type Shaft } from "../src/world/underground";

try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* ignore */ }

interface Run { entry: string; exit: string; ok: boolean; stage: string; cause: string; where: string; drawn: boolean; uptown: boolean; secs: number }

function report(rows: Run[]) {
  const by = (key: (r: Run) => string) => {
    const m = new Map<string, Run[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };
  const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "-");
  const ok = rows.filter((r) => r.ok).length;
  console.log(`\n== in, fly, out: ${pct(ok, rows.length)} carried out alive`);
  console.log(`   drawn in ${pct(rows.filter((r) => r.drawn).length, rows.length)}, delivered onto the uptown track ${pct(rows.filter((r) => r.uptown).length, rows.filter((r) => r.drawn).length)}`);
  const causes = by((r) => (r.ok ? "ok" : r.cause));
  console.log("   causes: " + [...causes].filter(([k]) => k !== "ok").sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(", "));
  console.log("\n-- per way in (drawn in / onto uptown track / out alive)");
  for (const [k, v] of by((r) => r.entry)) {
    const fails = v.filter((r) => !r.ok).map((r) => `${r.cause}@${r.where}`);
    console.log(`  ${k.padEnd(34)} ${String(v.filter((r) => r.drawn).length).padStart(2)}/${v.length} ${String(v.filter((r) => r.uptown).length).padStart(2)} ${String(v.filter((r) => r.ok).length).padStart(2)}/${v.length}  ${fails.slice(0, 3).join("; ")}`);
  }
  console.log("\n-- per way out (runs that reached the exit stage: carried out alive)");
  for (const [k, v] of by((r) => r.exit)) {
    if (k === "-") continue;
    const tried = v.filter((r) => r.stage === "exit" || r.ok);
    const fails = tried.filter((r) => !r.ok).map((r) => `${r.cause}@${r.where}`);
    console.log(`  ${k.padEnd(34)} ${pct(tried.filter((r) => r.ok).length, tried.length).padEnd(12)} ${fails.slice(0, 3).join("; ")}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--merge") {
  report(args.slice(1).flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Run[]));
  process.exit(0);
}
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const variants = Number(args[0] ?? 6), shard = Number(args[1] ?? 0), shards = Number(args[2] ?? 1);

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const u = flow.under, sub = city.subway;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const label = (s: Shaft) => `${s.name}${s.kind === "vent" ? "" : ` ${s.out ? "out" : "in"}`} @${s.ss.toFixed(0)}`;
const dip = (s: number) => (u as unknown as { dip?: (s: number) => number }).dip?.(s) ?? 0;
const ins = u.shafts.filter((s) => !s.out && !u.isBlocked(s.ss) && (s.kind === "stairs" ? !!s.entryPath : s.kind === "vent"));
const outs = u.shafts.filter((s) => s.out && !u.isBlocked(s.ss) && (s.kind === "stairs" ? !!s.exitPath : s.kind === "vent"))
  .concat(u.shafts.filter((s) => s.relief)).sort((a, b) => a.ss - b.ss);
const stations = u.stations.filter((s) => !u.isBlocked(s.ss));
const blockAfter = (s: number) => Math.min(...u.blocked.map((b) => (b.ss0 > s ? b.ss0 : Infinity)));

/** where a player would come at it from: out in the open street in front of the open side, with a clear
 *  line to the opening (tries the variant's angle first, then others, then nearer) */
function startFor(entry: Shaft, v: number) {
  const angs = [0, -35, 35, -15, 15, 0];
  const order = [angs[v % 6], ...[0, -20, 20, -40, 40, -60, 60].filter((a) => a !== angs[v % 6])];
  const h0 = [4, 5, 5, 3, 3, 6][v % 6];
  for (const dist of [22, 18, 14, 10]) for (const deg of order) {
    const ang = (deg * Math.PI) / 180, ax = -entry.ux, az = -entry.uz;
    const dx = ax * Math.cos(ang) - az * Math.sin(ang), dz = az * Math.cos(ang) + ax * Math.sin(ang);
    let clear = true;
    for (let r = 2.5; r <= dist + 0.01 && clear; r += 1) if (city.buildingAt(entry.x + dx * r, entry.z + dz * r)) clear = false;
    if (clear) return { dx, dz, dist, h0 };
  }
  return { dx: -entry.ux, dz: -entry.uz, dist: 10, h0 };
}

function fly(entry: Shaft, v: number): Run {
  const { dx, dz, dist: start, h0 } = startFor(entry, v);
  const g = new Glider(city, flow, { x: entry.x + dx * start, y: h0, z: entry.z + dz * start, heading: Math.atan2(-dx, -dz) });
  g.detach();
  g.clock = 7 + v * 23.7 + (entry.ss % 37); // the trains' timing differs run to run
  g.vel.set(-dx * 8, -0.3, -dz * 8);
  const dt = 1 / 120;
  let stage: "approach" | "tunnel" | "exit" = "approach";
  let drawn = false, uptown = false, deliveredS = -1, target: Shaft | null = null, flyUntil = 0;
  let bestS = -1e9, bestT = 0, outAt = -1, deliverT = -1;
  const T = { approach: 25, total: 240 };
  const res = (ok: boolean, cause: string): Run => {
    const q = sub.nearest(g.pos.x, g.pos.z);
    return { entry: label(entry), exit: target ? label(target) : "-", ok, stage, cause, where: `${stage} s${q.s.toFixed(0)} off${q.off.toFixed(1)} y${g.pos.y.toFixed(1)}`, drawn, uptown, secs: g.time };
  };
  const nearestOnPath = (p: Float32Array) => {
    let bi = 0, bd = Infinity;
    for (let k = 0; k < p.length; k += 3) { const d = Math.hypot(p[k] - g.pos.x, p[k + 1] - g.pos.y, p[k + 2] - g.pos.z); if (d < bd) { bd = d; bi = k; } }
    return { i: bi, d: bd };
  };
  for (let i = 0; i < T.total / dt; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    const p = g.pos;
    let tx = p.x, tz = p.z, wantY = p.y, spread = false, brake = false;
    const q = sub.nearest(p.x, p.z);
    if (stage === "approach") {
      if (g.lane === "subway") drawn = true;
      if (g.time > T.approach) return res(false, drawn ? "stuck in the way in" : "never drawn in");
      if (drawn && p.y < -0.6 && !u.openingAt(p.x, p.z)) {
        const info = { ss: 0, off: 0, inShaft: null as Shaft | null };
        u.sdf(p.x, p.y, p.z, info);
        // out of the stairs / vent, in the hall or tunnel
        if (!info.inShaft && u.hallAt(p.x, p.z)) {
          if (deliverT < 0) deliverT = g.time;
          if (Math.abs(q.off - TRAIN.track) < 2.2) uptown = true;
          if (g.time - deliverT > 3 || uptown) {
            stage = "tunnel"; deliveredS = q.s;
            // past at least one station: the next one beyond the one you dropped into
            const next = stations.find((st) => st.ss > deliveredS + TUNNEL.stationHalfLength + 20 && st.ss < blockAfter(deliveredS));
            const passBy = next ? next.ss - 70 : deliveredS + 100;
            // (before the flood or the end of the line there may be no station ahead: then the next way out)
            target = outs.find((o) => o.ss > Math.max(passBy, deliveredS + 100) && o.ss < blockAfter(deliveredS))
              ?? outs.find((o) => o.ss > deliveredS + 15 && o.ss < blockAfter(deliveredS)) ?? null;
            if (!target) return res(false, "no way out ahead");
            flyUntil = target.ss - 45;
          }
        }
      }
      if (stage === "approach") {
        if (!drawn && g.air.guide! < 0.4) {
          // steer at the opening, nose down once close (aim a little short, at the stream's mouth)
          const d = Math.hypot(entry.x - p.x, entry.z - p.z);
          tx = entry.x; tz = entry.z; wantY = d < 7 ? -3 : 2.5;
        } else {
          // in the stream: let it carry you, nose along it
          const ep = entry.entryPath;
          if (ep) { const n = nearestOnPath(ep), k = Math.min(ep.length - 3, n.i + 9); tx = ep[k]; tz = ep[k + 2]; wantY = ep[k + 1]; }
          else { tx = entry.x + entry.ux * 3; tz = entry.z + entry.uz * 3; wantY = -5; }
        }
      }
    }
    if (stage === "tunnel") {
      if (p.y > 0.5) return res(false, "blown out early");
      if (q.s > flyUntil) stage = "exit";
      else {
        const a = sub.at(q.s + 25);
        tx = a.x + a.tz * TRAIN.track; tz = a.z - a.tx * TRAIN.track;
        wantY = u.shape(q.s).ceil + dip(q.s) - 1.4;
      }
    }
    if (stage === "exit" && target) {
      if (p.y > 1) {
        if (outAt < 0) outAt = g.time;
        if (g.time - outAt > 2) return res(true, "");
      } else if (q.s > target.ss + 30) return res(false, "missed the way out");
      if (target.kind === "stairs") {
        const ep = target.exitPath!;
        const n = nearestOnPath(ep);
        if (n.d < 3.5 || g.air.guide! > 0.6) { const k = Math.min(ep.length - 3, n.i + 9); tx = ep[k]; tz = ep[k + 2]; wantY = ep[k + 1] + 0.5; }
        else {
          tx = ep[0]; tz = ep[2];
          const d = Math.hypot(ep[0] - p.x, ep[2] - p.z);
          wantY = d < 25 ? ep[1] : u.shape(q.s).ceil + dip(q.s) - 1.4;
          // coming up on it: flare off the speed and turn in (a player brakes for the turn off the line)
          brake = !process.env.NOBRAKE && d < 30 && Math.hypot(g.vel.x, g.vel.z) > 9;
        }
      } else {
        // a vent (or the relief grate): get under it and let it take you
        tx = target.x; tz = target.z;
        const d = Math.hypot(target.x - p.x, target.z - p.z);
        wantY = d < 8 ? 10 : u.shape(q.s).ceil + dip(q.s) - 1.6;
        spread = d < VENT.halfLength + 2;
      }
      if (outAt >= 0) { tx = p.x + g.vel.x; tz = p.z + g.vel.z; wantY = 6; }
    }
    if (q.s > bestS + 2) { bestS = q.s; bestT = g.time; }
    if (stage !== "approach" && g.time - bestT > 15 && outAt < 0) return res(false, "stuck");
    let d = Math.atan2(tx - p.x, tz - p.z) - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    const pitch = brake ? -0.7 : clamp((p.y - wantY) * 0.15 - g.vel.y * 0.12, -1, 1);
    g.step(dt, { pitch, roll: clamp(-d * 2, -1, 1), spread, curl: false, corkscrew: 0, loop: false });
    if (process.env.TRACE && i % 60 === 0) console.log(`t${g.time.toFixed(1)} ${stage} s${q.s.toFixed(0)} off${q.off.toFixed(1)} (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) v${g.vel.length().toFixed(1)} guide ${(g.air.guide ?? 0).toFixed(2)} ${g.lane} int ${g.integrity.toFixed(2)} ${g.events.length ? g.events[g.events.length - 1] : ""}`);
    if (g.state !== "flying") {
      const f = g.failure;
      const cause = /train/.test(f) ? (/downtown/.test(f) ? "train (downtown)" : "train (uptown)") : /rat/.test(f) ? "rat" : /tunnel|wall|pavement|Buried/.test(f) ? "wall" : f;
      return res(false, cause);
    }
  }
  return res(false, stage === "exit" ? "never carried out" : stage === "tunnel" ? "stuck" : "never drawn in");
}

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const list = ins.filter((s, i) => i % shards === shard && (!only || only.test(label(s))));
const rows: Run[] = [];
const t0 = Date.now();
for (const e of list) for (let v = 0; v < variants; v++) {
  const r = fly(e, v);
  rows.push(r);
  if (process.env.VERBOSE) console.log(`${r.entry} v${v} -> ${r.exit}: ${r.ok ? "OUT ALIVE" : r.cause + " @ " + r.where} (${r.secs.toFixed(0)} s)`);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows));
else report(rows);
console.error(`(${rows.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
