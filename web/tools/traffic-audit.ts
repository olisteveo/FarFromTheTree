// Does the traffic behave? Overlaps by kind, stops at red lights, and that the same time gives the same traffic.
//   npx tsx tools/traffic-audit.ts [seconds=240]
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { VEHICLE_SIZE } from "../src/world/traffic";

const seconds = Number(process.argv[2] ?? 240);
const t0 = Date.now();
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const tr = flow.traffic;
const t1 = Date.now();
tr.update(0);
console.log(`network + warm-up: ${Date.now() - t1} ms (city and wind load ${t1 - t0} ms), vehicles ${tr.vehicles.length}`);

const corners = (s: any, trim = 0.92) => { const z = VEHICLE_SIZE[s.v.kind as keyof typeof VEHICLE_SIZE], l = z.l * trim / 2, w = z.w * trim / 2, px = s.tz, pz = -s.tx; return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [s.x + s.tx * a * l + px * b * w, s.z + s.tz * a * l + pz * b * w]); };
const hit = (a: any, b: any) => { const A = corners(a), B = corners(b); for (const ax of [[a.tx, a.tz], [a.tz, -a.tx], [b.tx, b.tz], [b.tz, -b.tx]]) { const p = (P: number[][]) => P.map((c) => c[0] * ax[0] + c[1] * ax[1]); const pa = p(A), pb = p(B); if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false; } return true; };
const R = 14; let pairs = 0, cross = 0, para = 0, samples = 0, stopped = 0, seen = 0, moved = 0;
const worst = new Map<string, number>();
const t2 = Date.now();
for (let t = 1; t <= seconds; t += 3) {
  tr.update(t); samples++;
  const cell = new Map<string, any[]>();
  for (const s of tr.now as any[]) { (cell.get(Math.floor(s.x / R) + "," + Math.floor(s.z / R)) ?? cell.set(Math.floor(s.x / R) + "," + Math.floor(s.z / R), []).get(Math.floor(s.x / R) + "," + Math.floor(s.z / R))!).push(s); seen++; if (s.speed < 0.3) stopped++; else moved++; }
  for (const a of tr.now as any[]) { const cx = Math.floor(a.x / R), cz = Math.floor(a.z / R);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of cell.get(cx + i + "," + (cz + j)) ?? []) {
      if (a.v.colorSeed >= b.v.colorSeed || !hit(a, b)) continue;
      pairs++; if (Math.abs(a.tx * b.tx + a.tz * b.tz) < 0.5) cross++; else para++;
      const k = Math.round(a.x / 20) * 20 + "," + Math.round(a.z / 20) * 20; worst.set(k, (worst.get(k) ?? 0) + 1);
    } }
}
const simMs = Date.now() - t2;
console.log(`overlapping pairs at any moment: ${(pairs / samples).toFixed(1)} (crossing ${(cross / samples).toFixed(1)}, side by side or nose to tail ${(para / samples).toFixed(1)})`);
console.log(`stopped ${(100 * stopped / seen).toFixed(0)}%, moving ${(100 * moved / seen).toFixed(0)}%, on the road ${Math.round(seen / samples)}; ${(simMs / (seconds / 0.1)).toFixed(2)} ms per tick`);
console.log("worst spots", [...worst].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${(v / samples).toFixed(1)}`).join("  "));
// the same t must give the same traffic, however we got there
const sig = () => (tr.now as any[]).reduce((h, s) => (Math.imul(h, 31) + Math.round(s.x * 100) + Math.round(s.z * 100)) | 0, 7);
tr.update(30); const a = sig(); tr.update(100); tr.update(30.05); tr.update(30); const b = sig();
console.log(a === b ? "deterministic: yes" : `deterministic: NO ${a} ${b}`);
