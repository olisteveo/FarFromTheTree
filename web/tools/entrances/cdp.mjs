// Drive the game in headless Edge over the DevTools protocol: run JS steps and take screenshots.
//   node tools/entrances/cdp.mjs "<query>" <steps.js> [port=5181]
// steps.js is evaluated in Node; it gets `ev(js)` (evaluate in the page, awaits promises, returns the value),
// `shot(name)` (writes tools/shots/<name>.png), `nav(query)` (load another game URL) and `sleep(ms)`. Runs Edge at below-normal priority.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [query = "?nointro", stepsFile, port = "5181"] = process.argv.slice(2);
const exe = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
const dbg = 9300 + Math.floor(Math.random() * 400);
const prof = path.join(os.tmpdir(), "fftt-entr-cdp");
const proc = spawn(exe, ["--headless=new", `--user-data-dir=${prof}`, "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11",
  "--window-size=1280,720", `--remote-debugging-port=${dbg}`, `http://localhost:${port}/${query}`], { stdio: "ignore" });
try { spawn("powershell", ["-c", `(Get-Process -Id ${proc.pid}).PriorityClass = 'BelowNormal'`], { stdio: "ignore" }); } catch {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.log("no page"); proc.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log("JS error:", r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const shotsDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "shots");
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const f = path.join(shotsDir, name + ".png");
  fs.writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log(f);
};
// print the page's console errors and uncaught exceptions
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) console.log("console." + d.params.type + ":", d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  if (d.method === "Runtime.exceptionThrown") console.log("exception:", d.params.exceptionDetails.exception?.description?.slice(0, 300) ?? d.params.exceptionDetails.text);
});
await send("Runtime.enable");
const nav = async (q) => { await send("Page.navigate", { url: `http://localhost:${port}/${q}` }); await sleep(1500); };
const ready = async () => { for (let i = 0; i < 80; i++) { if (await ev("return !!(window.fftt && fftt.entrances && fftt.entrances.ready)")) return true; await sleep(500); } return false; };
try {
  const steps = fs.readFileSync(stepsFile, "utf8");
  await new Function("ev", "shot", "sleep", "nav", "ready", `return (async () => { ${steps} })();`)(ev, shot, sleep, nav, ready);
} catch (e) { console.log("steps failed:", e); }
ws.close();
proc.kill();
process.exit(0);
