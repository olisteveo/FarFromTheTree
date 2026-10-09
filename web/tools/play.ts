// Many full runs by human-like pilots (src/sim/pilot.ts), from the tree in Battery Park
// to Sheep Meadow, in parallel worker processes at low priority (max 8, like TD2099's
// balance sims: raising priority once crashed Oliver's PC).
//
//   npx tsx tools/play.ts [runsPerProfile=8] [maxMinutes=25] [out=results/play.md]
//
// Reports, per skill level: how many finish and in what time, how far the others get,
// what kills them and where, time spent stuck, time per layer, layer drops and tricks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

interface RunResult {
  profile: string; seed: number;
  state: string; failure: string; time: number; maxS: number; deathS: number;
  stuck: number; lanes: Record<string, number>; drops: number; tricks: number; hits: number;
  speedLane: Record<string, number>; log: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ worker
if (process.env.FFTT_WORKER) {
  const { CityData } = await import("../src/world/data");
  const { Airflow } = await import("../src/world/airflow");
  const { Glider } = await import("../src/sim/glider");
  const { Pilot, PROFILES } = await import("../src/sim/pilot");
  const { makeCourse } = await import("../src/world/course");
  const city = new CityData(JSON.parse(fs.readFileSync(path.join(here, "../public/city.json"), "utf8")));
  const flow = new Airflow(city);
  const course = makeCourse(city);
  process.on("message", (job: { profile: string; seed: number; maxMinutes: number }) => {
    const prof = PROFILES.find((p) => p.name === job.profile)!;
    const g = new Glider(city, flow, course.start);
    g.detach();
    const pilot = new Pilot(city, flow, g, prof, job.seed);
    const dt = 1 / 120;
    let maxS = 0, stuck = 0, slow = 0, drops = 0, lastBoost = -99, hits = 0, lastInt = 1;
    const lanes: Record<string, number> = {}, dist: Record<string, number> = {};
    let prevS = 0;
    for (let i = 0; i < (job.maxMinutes * 60) / dt && g.state === "flying"; i++) {
      if (i % 6 === 0) flow.traffic.update(g.clock);
      const input = pilot.update(dt);
      g.step(dt, input);
      if (g.grounded && course.inMeadow(g.pos.x, g.pos.z) && Math.hypot(g.vel.x, g.vel.z) < 2.5) g.plant();
      lanes[g.lane] = (lanes[g.lane] ?? 0) + dt;
      if (i % 12 === 0) {
        const s = city.route.nearest(g.pos.x, g.pos.z).s;
        if (s > maxS) { dist[g.lane] = (dist[g.lane] ?? 0) + (s - Math.max(prevS, maxS - 0)); maxS = s; }
        prevS = s;
      }
      if (g.vel.length() < 0.8) { slow += dt; if (slow > 2) stuck += dt; } else slow = 0;
      if (g.boost.t > lastBoost) { lastBoost = g.boost.t; drops++; }
      if (g.integrity < lastInt - 0.05) hits++;
      lastInt = g.integrity;
    }
    const speedLane: Record<string, number> = {};
    for (const k of Object.keys(dist)) speedLane[k] = dist[k] / Math.max(1, lanes[k] ?? 1);
    const r: RunResult = {
      profile: job.profile, seed: job.seed, state: g.state, failure: g.failure, time: g.time, maxS,
      deathS: g.state === "dead" ? city.route.nearest(g.pos.x, g.pos.z).s : -1,
      stuck, lanes, drops, tricks: g.tricks.corkscrew + g.tricks.loop, hits, speedLane, log: [...pilot.log.slice(0, 6), ...g.events.slice(-4)],
    };
    process.send!(r);
  });
  process.send!({ ready: true });
} else {
  // ------------------------------------------------------------------ main
  const runs = Number(process.argv[2] ?? 8), maxMinutes = Number(process.argv[3] ?? 25);
  const out = process.argv[4] ?? "results/play.md";
  const { PROFILES } = await import("../src/sim/pilot");
  const jobs = PROFILES.flatMap((p) => Array.from({ length: runs }, (_, i) => ({ profile: p.name, seed: i + 1, maxMinutes })));
  const results: RunResult[] = [];
  const n = Math.min(8, Math.max(1, os.cpus().length - 2), jobs.length);
  const t0 = Date.now();
  await new Promise<void>((done) => {
    let next = 0, running = 0;
    for (let w = 0; w < n; w++) {
      const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, FFTT_WORKER: "1" }, execArgv: ["--import", "tsx"] });
      try { os.setPriority(child.pid!, os.constants.priority.PRIORITY_LOW); } catch { /* not allowed */ }
      const feed = () => {
        if (next >= jobs.length) { child.kill(); if (--running === 0) done(); return; }
        child.send(jobs[next++]);
      };
      running++;
      child.on("message", (m: RunResult | { ready: true }) => {
        if ("ready" in m) { feed(); return; }
        results.push(m);
        process.stdout.write(`\r${results.length}/${jobs.length} runs  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
        feed();
      });
    }
  });
  console.log();
  // ------------------------------------------------------------------ report
  const L = 8830;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(0).padStart(2, "0")}`;
  const md: string[] = [`# Human-pilot playtest`, ``, `${results.length} runs, ${runs} per skill level, up to ${maxMinutes} min each. Route ${L / 1000} km.`, ``,
    `| Pilot | finished | median finish | furthest (median) | deaths | stuck (avg) | street / roof / subway time | uptown m/s: street / roof / subway | drops | tricks |`,
    `|---|---|---|---|---|---|---|---|---|---|`];
  const causes: string[] = [];
  for (const p of PROFILES) {
    const rs = results.filter((r) => r.profile === p.name);
    const fin = rs.filter((r) => r.state === "planted");
    const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
    const lane = (k: string) => rs.reduce((a, r) => a + (r.lanes[k] ?? 0), 0);
    const total = lane("street") + lane("roof") + lane("subway") || 1;
    const sp = (k: string) => { const v = rs.map((r) => r.speedLane[k]).filter((x) => x !== undefined); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "-"; };
    md.push(`| ${p.name} | ${fin.length}/${rs.length} | ${fin.length ? fmt(med(fin.map((r) => r.time))) : "-"} | ${(med(rs.map((r) => r.maxS)) / 1000).toFixed(2)} km | ${rs.filter((r) => r.state === "dead").length} | ${(rs.reduce((a, r) => a + r.stuck, 0) / rs.length).toFixed(0)}s | ${[lane("street"), lane("roof"), lane("subway")].map((v) => `${((v / total) * 100).toFixed(0)}%`).join(" / ")} | ${sp("street")} / ${sp("roof")} / ${sp("subway")} | ${(rs.reduce((a, r) => a + r.drops, 0) / rs.length).toFixed(1)} | ${(rs.reduce((a, r) => a + r.tricks, 0) / rs.length).toFixed(1)} |`);
    const c: Record<string, number[]> = {};
    for (const r of rs) if (r.state === "dead") (c[r.failure] ??= []).push(Math.round(r.deathS));
    causes.push(`- **${p.name}**: ${Object.entries(c).map(([k, v]) => `${k} ×${v.length} (at ${v.sort((a, b) => a - b).join(", ")} m)`).join("; ") || "none"}`);
  }
  md.push(``, `## What ended runs`, ``, ...causes, ``, `## Sample pilot logs`, ``);
  for (const r of results.filter((x) => x.state === "dead").slice(0, 10)) md.push(`- ${r.profile} #${r.seed}: ${r.state}${r.failure ? ` (${r.failure})` : ""} at ${(r.maxS / 1000).toFixed(2)} km after ${fmt(r.time)}. ${r.log.join("; ")}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md.join("\n") + "\n");
  console.log(md.slice(0, 10 + PROFILES.length).join("\n"));
  console.log(causes.join("\n"));
}
