// Can it be won, by every layer? Skilled pilots fly the whole route from the tree to Sheep Meadow:
//   roof    holds ~12 m over the rooftops
//   street  flies low (5 m) among the traffic, climbing over the closed streets
//   subway  dives into the next way in ahead, rides the tunnel uptown over the trains, climbs out
//           before the flood and the end of the line, then on over the roofs
//   mixed   subway where it runs, rooftops in between
// Several runs each (the wind and the trains change with time). Reports how far each gets, how long it
// took and what stopped it, at low priority.
//   npx tsx tools/pilots.ts [runs=3] [minutes=25] [layers=roof,street,subway,mixed]
import fs from "node:fs";
import os from "node:os";
import { CityData, nearestEdge } from "../src/world/data";
import { AIR, Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
import { makeCourse } from "../src/world/course";
import { TUNNEL, type Shaft } from "../src/world/underground";

try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ }
const runs = Number(process.argv[2] ?? 3), minutes = Number(process.argv[3] ?? 25);
const layers = (process.argv[4] ?? "west,east,roofs,subway").split(",");
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);
const u = flow.under, sub = city.subway;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ins = u.shafts.filter((s) => s.entryPath && !s.out);
const outs = u.shafts.filter((s) => s.out && (s.exitPath || s.kind === "vent") && !u.isBlocked(s.ss));
const stopAt = Math.min(u.blocked[0].ss0 - 120, u.end - 120); // leave before the flood / end of the line
const lastIn = Math.min(stopAt - 400, u.end);

type Mode = "roof" | "street" | "toEntry" | "tunnel" | "toExit";

function fly(layer: string, run: number) {
  // START=metres: begin part-way along the way being flown (to re-fly one stretch quickly)
  if (process.env.CROSSBURST) AIR.crossBurst = Number(process.env.CROSSBURST); // (A/B the junction bursts)
  if (process.env.NOWAY) (globalThis as { __fftt_noWay?: boolean }).__fftt_noWay = true;
  const startS = Number(process.env.START ?? 0);
  const way0 = flow.features.routes.find((q) => q.id === layer);
  const st0 = startS > 0 ? (way0 ? way0.line : course.path).at(startS) : null;
  const g = new Glider(city, flow, st0 ? { x: st0.x, y: way0 ? way0.y(startS) : 20, z: st0.z, heading: Math.atan2(st0.tx, st0.tz) } : course.start);
  g.detach();
  g.clock = run * 41 + layer.length * 7;
  const dt = 1 / 120;
  // following one of the ways through (world/windFeatures.ts routes): its line, at its height
  const way = flow.features.routes.find((q) => q.id === layer) ?? null;
  let mode: Mode = layer === "street" ? "street" : layer === "roof" || way ? "roof" : "toEntry";
  let bestWay = -1, bestWayT = 0;
  let target: Shaft | null = null, maxS = 0, lastS = -1, stuck = 0, subwayUsed = false;
  const log: string[] = [];
  for (let i = 0; i < (minutes * 60) / dt && g.state === "flying"; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    const p = g.pos, n = city.route.nearest(p.x, p.z), endNear = course.path.nearest(p.x, p.z).s > course.path.length - 150 || course.inMeadow(p.x, p.z);
    // where to steer, and at what height
    let tx: number, tz: number, want: number, braking = false;
    if (mode === "toEntry") {
      if (!target) target = ins.filter((s) => s.ss > sub.nearest(p.x, p.z).s + 20 && s.ss < lastIn).sort((a, b) => a.ss - b.ss)[0] ?? null;
      if (!target || (layer === "subway" && subwayUsed && sub.nearest(p.x, p.z).s > lastIn)) mode = "roof";
      else if (g.lane === "subway") { mode = "tunnel"; subwayUsed = true; target = null; }
    }
    if (mode === "tunnel" && g.lane === "subway") {
      const q = sub.nearest(p.x, p.z);
      if (q.s > stopAt - 250) { mode = "toExit"; target = outs.filter((s) => s.ss > q.s - 40).sort((a, b) => a.ss - b.ss)[0] ?? null; }
    }
    if (mode === "toExit" && p.y > 1) { mode = layer === "subway" ? "roof" : "roof"; target = null; }
    if (mode === "tunnel" && g.lane !== "subway") mode = "roof";
    if (mode === "toEntry" && target) {
      const m = target.entryPath!;
      tx = m[0]; tz = m[2]; want = Math.hypot(m[0] - p.x, m[2] - p.z) < 14 ? 0 : 6;
    } else if (mode === "tunnel") {
      // over the uptown track (the downtown trains come at you on the other)
      const q = sub.nearest(p.x, p.z), a = sub.at(q.s + 25);
      tx = a.x + a.tz * 3.3; tz = a.z - a.tx * 3.3; want = TUNNEL.ceiling - 1.4 + city.subwayDip(q.s + 10);
    } else if (mode === "toExit" && target) {
      const e = target.exitPath;
      tx = e ? e[0] : target.x; tz = e ? e[2] : target.z; want = 5; // climb at it: the way out's air does the rest
    } else if (way) {
      const wn = way.line.nearest(p.x, p.z);
      // look further ahead the faster you go, and flare into a sharp turn coming up (a player brakes
      // into the corner; carrying 15 m/s straight on past it loses the line)
      const sp = Math.hypot(g.vel.x, g.vel.z), look = wn.d > 10 ? 6 : Math.max(12, Math.min(34, sp * 1.4));
      const a = way.line.at(Math.min(way.line.length, wn.s + look));
      const h0 = way.line.at(wn.s), h1 = way.line.at(wn.s + 30);
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(h1.tx, h1.tz) - Math.atan2(h0.tx, h0.tz)), Math.cos(Math.atan2(h1.tx, h1.tz) - Math.atan2(h0.tx, h0.tz))));
      braking = turn > 0.8 && sp > 8;
      tx = a.x; tz = a.z;
      want = way.line.length - wn.s < 150 ? 0 : way.y(wn.s);
      // getting nowhere (pinned by a headwind, or lost off the line): climb out over the roofs and come
      // back at it from above, as a player would
      if (wn.s > bestWay + 3) { bestWay = wn.s; bestWayT = g.time; }
      if (g.time - bestWayT > 6 && g.time - bestWayT < 30) {
        want = Math.max(want, city.canopy(p.x, p.z, 30) + 12);
        const far = way.line.at(Math.min(way.line.length, bestWay + 60));
        if (p.y > city.canopy(p.x, p.z, 20) + 4) { tx = far.x; tz = far.z; }
      } else if (g.time - bestWayT >= 30) bestWayT = g.time;
      const closed = flow.blockers.barriers.some((b) => Math.hypot(b.x - a.x, b.z - a.z) < b.half + 25);
      if (closed) want = Math.max(want, 14);
    } else {
      const pn = course.path.nearest(p.x, p.z);
      // drifted off down a side street: back to the path first (aiming far ahead steers you into the corner)
      const a = course.path.at(Math.min(course.path.length, pn.s + (pn.d > 10 ? 6 : 40)));
      tx = a.x; tz = a.z;
      const H = Math.max(city.canopy(p.x, p.z, 25), city.canopy(a.x, a.z, 25));
      // the street pilot climbs over a closed street ahead (its air lifts you)
      const closed = flow.blockers.barriers.some((b) => Math.hypot(b.x - a.x, b.z - a.z) < b.half + 25);
      // over the roofs where they're low; between tall towers, down the street canyon at ~16 m (like a player)
      want = endNear ? 0 : mode === "street" && !closed ? 5 : H > 42 ? 16 : H + 12;
      // a closure ahead shuts the street up to its top: climb over it in good time, as a player would
      for (const b of flow.blockers.barriers) if (!endNear && Math.hypot(b.x - p.x, b.z - p.z) < b.half + 70) want = Math.max(want, b.height + 6);
      for (const b of flow.blockers.list) if (!endNear && b.shape === "stretch" && Math.hypot(b.x - p.x, b.z - p.z) < b.r + 70) want = Math.max(want, b.height + 6);
    }
    // a building in the way (above ground): over it if it's low, else round it, along its wall toward the target
    if (p.y > -0.4) {
      const L = Math.hypot(tx - p.x, tz - p.z) || 1, ux = (tx - p.x) / L, uz = (tz - p.z) / L;
      for (let r = 2; r < Math.min(14, L); r += 2) {
        const b = city.buildingAt(p.x + ux * r, p.z + uz * r);
        if (!b || b.h < p.y - 1) continue;
        if (b.h < 32) { want = Math.max(want, b.h + 6); break; }
        const e = nearestEdge(b.poly, p.x + ux * r, p.z + uz * r);
        const t1x = -e.nz, t1z = e.nx, side = t1x * ux + t1z * uz >= 0 ? 1 : -1;
        tx = p.x + (t1x * side + e.nx * 0.4) * 20; tz = p.z + (t1z * side + e.nz * 0.4) * 20;
        break;
      }
    }
    let d = Math.atan2(tx - p.x, tz - p.z) - g.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    // never aim below the roof you're over (between the towers it aims for the street canyon, but up on a
    // lower roof beside a tower that meant diving into the roof)
    { const under = city.buildingAt(p.x, p.z); if (under && p.y > under.h - 1 && want < under.h + 4 && !endNear) want = under.h + 6; }
    // sitting on something (a roof, a ledge) away from the meadow: flare and hop off it, as a player would
    const pitch = g.grounded && !course.inMeadow(p.x, p.z) ? -1 : braking ? -0.7 : clamp((p.y - want) * 0.15 - g.vel.y * 0.12, -1, 1);
    g.step(dt, { pitch, roll: clamp(-d * 2, -1, 1), spread: p.y < want - 4, curl: false, corkscrew: 0, loop: false });
    if (g.grounded && course.inMeadow(p.x, p.z) && Math.hypot(g.vel.x, g.vel.z) < 2.5) g.plant();
    if (process.env.TRACE && i % 60 === 0 && !way) {
      const q = sub.nearest(p.x, p.z);
      console.log(`t${g.time.toFixed(1)} ${mode} sub s${q.s.toFixed(0)} off ${q.off.toFixed(1)} y ${p.y.toFixed(1)} v ${g.vel.length().toFixed(1)} guide ${(g.air.guide ?? 0).toFixed(2)} ${g.lane} ${target ? target.name + "@" + target.ss.toFixed(0) : ""}`);
    }
    if (process.env.TRACE && i % 60 === 0 && way) {
      const wn = way.line.nearest(p.x, p.z), b = city.buildingAt(p.x, p.z);
      console.log(`t${g.time.toFixed(1)} way s${wn.s.toFixed(0)} off ${wn.d.toFixed(1)} (${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)}) v ${Math.hypot(g.vel.x, g.vel.z).toFixed(1)}/${g.vel.y.toFixed(1)} want ${want.toFixed(0)} aim (${tx.toFixed(0)},${tz.toFixed(0)}) ${g.lane}${b ? " over h" + b.h.toFixed(0) : ""}${g.grounded ? " GROUNDED" : ""} ${g.events.length ? g.events[g.events.length - 1] : ""}`);
    }
    if (i % 1200 === 0) {
      maxS = Math.max(maxS, n.s);
      stuck = Math.abs(n.s - lastS) < 5 ? stuck + 10 : 0;
      lastS = n.s;
      log.push(`${Math.round(g.time)}s s${n.s.toFixed(0)} (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) ${mode}`);
      if (stuck > 90) break;
    }
  }
  return { state: g.state, failure: g.failure ?? (stuck > 90 ? "stuck" : g.state === "flying" ? "out of time" : ""), km: maxS / 1000, min: g.time / 60, subwayUsed, log, events: g.events.slice(-2) };
}

for (const layer of layers) {
  const res = Array.from({ length: runs }, (_, r) => fly(layer, r));
  const won = res.filter((r) => r.state === "planted");
  console.log(`\n== ${layer}: ${won.length}/${runs} planted${won.length ? `, best ${Math.min(...won.map((r) => r.min)).toFixed(1)} min` : ""}`);
  for (const r of res) {
    console.log(`  ${r.state.padEnd(8)} ${r.km.toFixed(2)} km in ${r.min.toFixed(1)} min${r.subwayUsed ? " (used the subway)" : ""} ${r.state === "planted" ? "" : "- " + r.failure}`);
    if (r.state !== "planted") console.log(`     ${r.log.slice(-4).join(" | ")}${r.events.length ? "  ::  " + r.events.join(" | ") : ""}`);
  }
}
