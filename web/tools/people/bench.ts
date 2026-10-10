// Timed frames of the real game with and without the people (run headless by bench.ps1):
//   /tools/people/bench.html?g=<game query, url-encoded>&n=60&name=times
// Each frame is window.fftt.advance(0) + gl.finish(). Results (and a frame grab) are POSTed to
// /__rec/bench/<name>.json / .jpg (web/recordings/bench/).
export {};
const qs = new URLSearchParams(location.search);
const name = qs.get("name") ?? "bench";
const N = Number(qs.get("n") ?? 60);
const frame = document.createElement("iframe");
frame.src = "/?" + (qs.get("g") ?? "nointro&at=6500,2");
document.body.appendChild(frame);

type W = Window & { fftt?: any; ffttPeople?: any };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (file: string, body: string) => fetch(`/__rec/bench/${file}`, { method: "POST", body });

async function run() {
  const w = () => frame.contentWindow as W;
  const t0 = performance.now();
  // wait for the game and the people to load
  while (performance.now() - t0 < 240000) {
    const f = w()?.fftt, p = w()?.ffttPeople;
    if (f && p && p.variants.characters.length) break;
    // an older build without ffttPeople: wait for the people meshes to fill in
    const root = f?.stage?.scene?.getObjectByName("people");
    if (f && !p && root && root.children.length > 10 && performance.now() - t0 > 20000) break;
    await sleep(500);
  }
  const f = w().fftt;
  const people = w().ffttPeople ?? { root: f?.stage?.scene?.getObjectByName("people"), stats: {}, update: () => {} };
  if (!f || !people.root) { await post(`${name}.json`, JSON.stringify({ error: "didn't load" })); return; }
  // grab mode: just frame grabs, &grab=3 every &every seconds of game time
  if (qs.has("grab")) {
    const n = Number(qs.get("grab") || 1), every = Number(qs.get("every") ?? 1);
    f.advance(Number(qs.get("pre") ?? 0.5));
    for (let i = 0; i < n; i++) {
      if (i) f.advance(every);
      f.advance(0);
      await post(`${name}_${i}.jpg`, f.stage.renderer.domElement.toDataURL("image/jpeg", 0.88));
    }
    await post(`${name}.json`, JSON.stringify({ ok: true, stats: people.stats }));
    return;
  }
  const gl = f.stage.renderer.getContext();
  const crowd = f.flow.crowd;
  let cT = 0, pT = 0;
  const cu = crowd.update.bind(crowd);
  crowd.update = (...a: unknown[]) => { const s = performance.now(); cu(...a); cT += performance.now() - s; };
  const pu = people.update.bind(people);
  people.update = (...a: unknown[]) => { const s = performance.now(); pu(...a); pT += performance.now() - s; };
  const bench = async (n: number) => {
    cT = pT = 0;
    const ts: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = performance.now();
      f.advance(0);
      gl.finish();
      ts.push(performance.now() - s);
      await sleep(0);
    }
    ts.sort((a, b) => a - b);
    return { med: +ts[n >> 1].toFixed(2), p90: +ts[Math.floor(n * 0.9)].toFixed(2), crowdMs: +(cT / n).toFixed(2), peopleMs: +(pT / n).toFixed(2) };
  };
  await bench(20);
  // interleaved rounds (this machine is busy): on / off / on ...
  const ons: number[] = [], offs: number[] = [], cms: number[] = [], pms: number[] = [];
  for (let r = 0; r < 6; r++) {
    const a = await bench(Math.ceil(N / 6));
    people.root.visible = false;
    const b = await bench(Math.ceil(N / 6));
    people.root.visible = true;
    ons.push(a.med); offs.push(b.med); cms.push(a.crowdMs); pms.push(a.peopleMs);
  }
  const med = (x: number[]) => +[...x].sort((p, q) => p - q)[x.length >> 1].toFixed(2);
  const on = { med: med(ons), crowdMs: med(cms), peopleMs: med(pms) }, off = { med: med(offs) }, on2 = on;
  const st = { ...people.stats };
  f.advance(0);
  await post(`${name}.jpg`, f.stage.renderer.domElement.toDataURL("image/jpeg", 0.85));
  const res = { name, game: frame.src, size: [f.stage.renderer.domElement.width, f.stage.renderer.domElement.height], quality: f.stage.quality, on, off, on2,
    peopleGpuMs: +(on.med - off.med).toFixed(2), rounds: { ons, offs }, drawn: st, crowdNow: crowd.now.length, leaf: f.advance(0) };
  await post(`${name}.json`, JSON.stringify(res, null, 1));
}
run().catch((e) => post(`${name}.json`, JSON.stringify({ error: String(e) })));
