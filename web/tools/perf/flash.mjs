// Flash / flicker finder: drives the game in headless Edge (GPU on) and reads back every frame it draws,
// tracking each frame's mean brightness and how many pixels changed a lot since the frame before. A flash
// is a frame whose brightness jumps away from both neighbours; flicker is pixels toggling while the view
// barely moves. Frames around the worst events are saved as PNGs (tools/shots/flash/<name>_*.png).
//   node tools/perf/flash.mjs <port> <query> <name> [frames=600] [q=high]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [port = "5262", query = "?nointro&fly=1&at=700,8", name = "flash", framesArg = "600", q = "high"] = process.argv.slice(2);
const N = Number(framesArg);
const exe = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const low = q === "low";
const W = low ? 390 : 960, H = low ? 844 : 540;
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "shots", "flash");
fs.mkdirSync(outDir, { recursive: true });
const prof = path.join(os.tmpdir(), "fftt-flash-" + Math.random().toString(36).slice(2));
const dbg = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(exe, ["--headless=new", `--user-data-dir=${prof}`, "--no-first-run", "--hide-scrollbars", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--mute-audio",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  `--window-size=${W},${H}`, `--remote-debugging-port=${dbg}`, "about:blank"], { stdio: "ignore" });
try { spawn("powershell", ["-c", `(Get-Process -Id ${proc.pid}).PriorityClass = 'BelowNormal'`], { stdio: "ignore" }); } catch {}
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => { const r = await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log("JS error:", r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send("Runtime.enable");
if (low) await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: `http://localhost:${port}/${query}&q=${q}` });
for (let i = 0; i < 240; i++) { await sleep(250); if (await ev("return !!(window.fftt && fftt.stage)")) break; }
await sleep(12000); // past the loading
// per frame: mean luma, fraction of pixels that changed by > 0.2, and a 1/4-res copy kept for the last few frames
const res = await ev(`
  const st = fftt.stage, R = st.renderer, gl = R.getContext();
  const render = st.render.bind(st);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
  const sw = w >> 2, sh = h >> 2;
  let prev = null; const rows = []; const keep = []; let n = 0;
  await new Promise((done) => {
    st.render = function () {
      render();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const small = new Uint8ClampedArray(sw * sh * 4);
      let sum = 0, changed = 0, top = 0;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = ((h - 1 - y * 4) * w + x * 4) * 4, o = (y * sw + x) * 4;
        small[o] = buf[i]; small[o + 1] = buf[i + 1]; small[o + 2] = buf[i + 2]; small[o + 3] = 255;
        const l = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
        sum += l; if (y < sh / 2) top += l;
        if (prev) { const pl = (prev[o] * 0.2126 + prev[o + 1] * 0.7152 + prev[o + 2] * 0.0722) / 255; if (Math.abs(l - pl) > 0.2) changed++; }
      }
      const c = fftt.cam.position;
      rows.push({ i: n, t: +performance.now().toFixed(0), luma: +(sum / (sw * sh)).toFixed(4), tb: +((2 * top - sum) / (sw * sh / 2)).toFixed(3), changed: +(changed / (sw * sh)).toFixed(4), cam: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], s: fftt.leaf.lane, q: fftt.cam.quaternion.toArray().map((v) => +v.toFixed(2)), p5: +fftt.cam.projectionMatrix.elements[5].toFixed(2), fov: +fftt.cam.fov.toFixed(1), st: fftt.leaf.state, lt: +fftt.leaf.time.toFixed(2) });
      keep.push(small); if (keep.length > 3) keep.shift();
      // keep a copy of the frames around a big one-frame change, for looking at
      if (prev && rows.length > 2) {
        const a = rows[rows.length - 3], b = rows[rows.length - 2], cur = rows[rows.length - 1];
        const spike = Math.abs(b.luma - (a.luma + cur.luma) / 2) - Math.abs(a.luma - cur.luma) / 2;
        if (spike > 0.02 || b.changed > 0.25) {
          (window.__flashKeep = window.__flashKeep || []).length < 12 && window.__flashKeep.push({ at: b.i, spike: +spike.toFixed(3), changed: b.changed, frames: keep.map((k) => { const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh; cv.getContext("2d").putImageData(new ImageData(k, sw, sh), 0, 0); return cv.toDataURL("image/png"); }) });
        }
      }
      prev = small; n++;
      if (n >= ${N}) { st.render = render; done(); }
    };
  });
  return { rows, kept: (window.__flashKeep || []) };
`);
const rows = res.rows;
// events: one-frame luminance spikes, and frames where many pixels changed though the camera barely moved
const ev1 = [];
for (let i = 1; i < rows.length - 1; i++) {
  const a = rows[i - 1], b = rows[i], c = rows[i + 1];
  const spike = Math.abs(b.luma - (a.luma + c.luma) / 2) - Math.abs(a.luma - c.luma) / 2;
  const move = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2]);
  if (spike > 0.01 || (b.changed > 0.08 && move < 0.5)) ev1.push({ i, spike: +spike.toFixed(3), changed: b.changed, move: +move.toFixed(2), luma: b.luma, cam: b.cam, lane: b.s });
}
const lum = rows.map((r) => r.luma), ch = rows.map((r) => r.changed);
console.log(`${name}: ${rows.length} frames, luma ${Math.min(...lum).toFixed(3)}..${Math.max(...lum).toFixed(3)}, changed avg ${(ch.reduce((a, b) => a + b, 0) / ch.length).toFixed(4)} max ${Math.max(...ch).toFixed(3)}, events ${ev1.length}`);
for (const e of ev1.slice(0, 20)) console.log("  ", JSON.stringify(e));
res.kept.forEach((k, j) => k.frames.forEach((d, f) => fs.writeFileSync(path.join(outDir, `${name}_${j}_${k.at}_${f}.png`), Buffer.from(d.split(",")[1], "base64"))));
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ rows, events: ev1 }, null, 0));
ws.close(); proc.kill();
await sleep(1000);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
process.exit(0);
