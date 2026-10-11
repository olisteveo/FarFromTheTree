// Frame-time profiler: drives the game in headless Edge/Chrome (GPU on) over CDP, with tools/perf/inject.js
// timing every frame, WebGL upload/compile calls, long tasks, the heap and each view's update().
//   node tools/perf/prof.mjs <port> <out.json> [q=high] [secs=40] [scenario names...]
// q=low runs a 390x844 phone viewport. Runs the browser at below-normal priority. Needs a server on <port>
// (e.g. npx vite preview --port 5260).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [port = "5260", out = "perf.json", q = "high", secsArg = "40", ...only] = process.argv.slice(2);
const secs = Number(secsArg);
const SCEN = {
  battery: "?nointro&fly=1&at=60,8",
  fidi: "?nointro&fly=1&at=700,8",
  chinatown: "?nointro&fly=1&at=1700,8",
  unionsq: "?nointro&fly=1&at=4500,8",
  timessq: "?nointro&fly=1&at=6700,8",
  columbus: "?nointro&fly=1&at=7400,8",
  park: "?nointro&fly=1&at=8300,10",
  subway: "?nointro&fly=1&sub=2500",
  roofs: "?nointro&fly=1&at=3000,45",
  title: "?nointro&showcase=1",
};
const names = only.length ? only : Object.keys(SCEN);
const exe = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
const inject = fs.readFileSync(new URL("./inject.js", import.meta.url), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const low = q === "low";
const W = low ? 390 : 1280, H = low ? 844 : 720;

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function stats(frames) {
  const dts = frames.map((f) => f.dt).filter((d) => d > 0);
  const cpu = frames.map((f) => f.cpu);
  const avg = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
  return {
    n: dts.length, avg: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), p95: +pct(dts, 0.95).toFixed(1), p99: +pct(dts, 0.99).toFixed(1), max: +Math.max(0, ...dts).toFixed(1),
    over33: dts.filter((d) => d > 33.4).length, over50: dts.filter((d) => d > 50).length,
    cpuAvg: +(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)).toFixed(2), cpuP99: +pct(cpu, 0.99).toFixed(1),
  };
}
function summarize(name, P, extra) {
  const fr = P.frames;
  const t0 = fr.length ? fr[0].t : 0;
  const start = fr.filter((f) => f.t - t0 < 10000), steady = fr.filter((f) => f.t - t0 >= 10000);
  // heap: allocation rate (sum of rises) and GCs (drops > 1 MB)
  let rise = 0, gcs = 0, gcMB = 0;
  for (let i = 1; i < steady.length; i++) { const d = steady[i].heap - steady[i - 1].heap; if (d > 0) rise += d; else if (d < -1e6) { gcs++; gcMB += -d / 1e6; } }
  const span = steady.length > 1 ? (steady.at(-1).t - steady[0].t) / 1000 : 1;
  const sec = {}, gl = {};
  for (const f of steady) { for (const [k, v] of Object.entries(f.sec)) sec[k] = (sec[k] || 0) + v.ms; for (const [k, v] of Object.entries(f.gl)) { const o = gl[k] || (gl[k] = { n: 0, ms: 0, mb: 0 }); o.n += v.n; o.ms += v.ms; o.mb += v.bytes / 1e6; } }
  for (const k in sec) sec[k] = +(sec[k] / Math.max(1, steady.length)).toFixed(3);
  for (const k in gl) { gl[k].ms = +gl[k].ms.toFixed(1); gl[k].mb = +gl[k].mb.toFixed(1); }
  const worst = [...fr].filter((f) => f.dt > 0).sort((a, b) => b.dt - a.dt).slice(0, 12).map((f) => ({
    t: +((f.t - t0) / 1000).toFixed(2), dt: +f.dt.toFixed(1), cpu: +f.cpu.toFixed(1),
    sec: Object.fromEntries(Object.entries(f.sec).filter(([, v]) => v.ms > 1).map(([k, v]) => [k, +v.ms.toFixed(1)])),
    gl: Object.fromEntries(Object.entries(f.gl).filter(([, v]) => v.ms > 0.5).map(([k, v]) => [k, `${v.n}x ${v.ms.toFixed(1)}ms ${(v.bytes / 1e6).toFixed(1)}MB`])),
  }));
  // programs compiled after the first 10 s (first-use hitches)
  const progLate = steady.length ? (steady.at(-1).progs - steady[0].progs) : 0;
  const linksLate = steady.reduce((a, f) => a + (f.gl.linkProgram?.n || 0), 0);
  // where the shader links and texture uploads happened (after the first 3 s): in the warm-up, or inside the render
  const glWhere = {};
  for (const f of fr.filter((f) => f.t - t0 > 3000)) for (const [k, v] of Object.entries(f.glsec || {})) { if (!/linkProgram|texSubImage2D|texImage2D|texSubImage3D/.test(k)) continue; const o = glWhere[k] || (glWhere[k] = { n: 0, ms: 0, mb: 0 }); o.n += v.n; o.ms = +(o.ms + v.ms).toFixed(1); o.mb = +(o.mb + v.bytes / 1e6).toFixed(1); }
  const last = fr.at(-1) || {};
  return {
    name, start: stats(start), steady: stats(steady), allocMBps: +(rise / 1e6 / span).toFixed(2), gcs, gcMB: +gcMB.toFixed(1),
    heapMB: +((last.heap || 0) / 1e6).toFixed(0), calls: last.calls, tris: last.tris, textures: last.tex, geometries: last.geo, programs: last.progs, progLate, linksLate, glWhere,
    longtasks: P.longtasks.length, longtaskMs: +P.longtasks.reduce((a, l) => a + l.d, 0).toFixed(0), longtasksSteady: P.longtasks.filter((l) => l.t - t0 >= 10000).map((l) => +l.d.toFixed(0)),
    secAvgMs: sec, glSteady: gl, worst, big: P.big.map((b) => ({ ...b, t: +((b.t - t0) / 1000).toFixed(2) })), progs: P.progs.map((p) => ({ ...p, t: +((p.t - t0) / 1000).toFixed(2) })), ...extra,
  };
}

const results = [];
for (const name of names) {
  const prof = path.join(os.tmpdir(), "fftt-perf-" + Math.random().toString(36).slice(2));
  const dbg = 9700 + Math.floor(Math.random() * 200);
  const proc = spawn(exe, ["--headless=new", `--user-data-dir=${prof}`, "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist",
    "--enable-precise-memory-info", "--disable-gpu-shader-disk-cache", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    `--window-size=${W},${H}`, `--remote-debugging-port=${dbg}`, "about:blank"], { stdio: "ignore" });
  try { spawn("powershell", ["-c", `(Get-Process -Id ${proc.pid}).PriorityClass = 'BelowNormal'`], { stdio: "ignore" }); } catch {}
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) { console.log(name, "no page"); proc.kill(); continue; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") console.log("  exception:", d.params.exceptionDetails.exception?.description?.slice(0, 200)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (js) => (await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Runtime.enable"); await send("Page.enable");
  if (low) await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
  const url = `http://localhost:${port}/${SCEN[name]}&q=${q}`;
  const tNav = Date.now();
  await send("Page.navigate", { url });
  let loaded = false;
  for (let i = 0; i < 240 && !loaded; i++) { await sleep(250); loaded = !!(await ev("return !!(window.fftt && window.__perf && window.__perf.wrapped)")); }
  const loadS = (Date.now() - tNav) / 1000;
  if (process.env.PERF_PRE) await ev(process.env.PERF_PRE);
  if (process.env.PERF_HEAP) {
    // sample allocations for a few seconds after the start-up window: which functions allocate per frame
    await sleep(10000);
    await send("HeapProfiler.enable");
    await send("HeapProfiler.startSampling", { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await sleep(6000);
    const prof = (await send("HeapProfiler.stopSampling")).result.profile;
    const self = new Map();
    const walk = (n, stack) => {
      const f = n.callFrame, here = `${f.functionName || "(anon)"} ${f.url.replace(/^.*\//, "")}:${f.lineNumber + 1}`;
      const sz = n.selfSize;
      if (sz) { const k = here + "  <  " + stack.slice(-2).reverse().join(" < "); self.set(k, (self.get(k) || 0) + sz); }
      for (const c of n.children) walk(c, [...stack, here]);
    };
    walk(prof.head, []);
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${(v / 6 / 1e6).toFixed(2)} MB/s  ${k}`);
    fs.writeFileSync(out.replace(/[.]json$/, "") + "." + name + ".heap.txt", top.join("\n"));
  }
  await sleep(secs * 1000);
  if (process.env.PERF_POST) fs.writeFileSync(out.replace(/.json$/, "") + "." + name + ".post.json", JSON.stringify(await ev(process.env.PERF_POST), null, 1));
  if (process.env.PERF_SHOT) { const r = await send("Page.captureScreenshot", { format: "png" }); const f = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^[/]([A-Z]:)/, "$1")), "..", "shots", process.env.PERF_SHOT + "_" + name + ".png"); fs.writeFileSync(f, Buffer.from(r.result.data, "base64")); console.log(f); }
  const P = await ev("const P = window.__perf; return { frames: P.frames, longtasks: P.longtasks, big: P.big, progs: P.progs }");
  const gpu = await ev("const gl = fftt.stage.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'");
  const leaf = await ev("const l = fftt.leaf; return l.state + ' ' + l.lane + ' s=' + fftt.city.route.nearest(l.pos.x, l.pos.z).s.toFixed(0)");
  if (P) {
    const r = summarize(name, P, { q, loadS, gpu, leaf });
    results.push(r);
    const s = r.steady, a = r.start;
    console.log(`${name.padEnd(10)} q=${q} load ${loadS.toFixed(1)}s | start avg ${a.avg} p99 ${a.p99} max ${a.max} >33:${a.over33} >50:${a.over50} | steady avg ${s.avg} p95 ${s.p95} p99 ${s.p99} max ${s.max} >33:${s.over33} >50:${s.over50} cpu ${s.cpuAvg}/${s.cpuP99} | alloc ${r.allocMBps}MB/s gc ${r.gcs} | calls ${r.calls} tris ${r.tris} tex ${r.textures} geo ${r.geometries} progs ${r.programs} (+${r.progLate} late) | ${leaf}`);
  } else console.log(name, "no data");
  ws.close(); proc.kill();
  await sleep(1500);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));
