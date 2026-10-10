// Put a leaf at the start of each kind of hidden current and see how far it carries you,
// and drop one into each dust devil and see how high it goes.
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const f = flow.features;
const spread = { pitch: 0, roll: 0, spread: true, curl: false, corkscrew: 0 as const, loop: false };
const seen = new Set<string>();
for (const j of f.jets) {
  if ([...seen].filter((k) => k === j.kind).length >= 3) continue;
  seen.add(j.kind + Math.random()); seen.add(j.kind);
  const p = j.pts, n = p.length / 3;
  const x0 = p[6], y0 = p[7], z0 = p[8];
  const g = new Glider(city, flow, { x: x0, y: y0, z: z0, heading: Math.atan2(p[9] - p[6], p[11] - p[8]) });
  g.detach();
  let inside = 0, maxAlong = 0, t = 0;
  for (let i = 0; i < 60 * 120 && g.state === "flying"; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    g.step(1 / 120, spread);
    if ((g.air.jet ?? -1) === j.id) { inside += 1 / 120; t = g.clock; }
    // how far along the jet's polyline are we?
    let best = 1e9, bk = 0;
    for (let k = 0; k < n; k += 2) { const d = (p[k * 3] - g.pos.x) ** 2 + (p[k * 3 + 2] - g.pos.z) ** 2; if (d < best) { best = d; bk = k; } }
    if ((g.air.jet ?? -1) === j.id) maxAlong = Math.max(maxAlong, bk * 6);
  }
  console.log(`${j.kind.padEnd(6)} ${j.name.slice(0, 28).padEnd(28)} len ${j.length.toFixed(0).padStart(4)}: rode ${inside.toFixed(1)}s, reached ${maxAlong.toFixed(0)} m (${(maxAlong / Math.max(0.1, t)).toFixed(1)} m/s) ${g.state} ${g.failure ?? ""}`);
}
for (const d of f.devils.slice(0, 5)) {
  const [cx, cz] = f.devilAt(d, 10);
  const g = new Glider(city, flow, { x: cx + 2, y: 2, z: cz, heading: 0 });
  g.detach();
  for (let i = 0; i < 20; i++) g.step(1 / 120, spread); // settle the clock
  let maxY = 0;
  for (let i = 0; i < 20 * 120 && g.state === "flying"; i++) { g.step(1 / 120, spread); maxY = Math.max(maxY, g.pos.y); }
  console.log(`devil ${d.name.padEnd(16)} rose to ${maxY.toFixed(1)} m`);
}
