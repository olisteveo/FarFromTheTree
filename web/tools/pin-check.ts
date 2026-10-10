import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow, type AirSample } from "../src/world/airflow";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const sub = city.subway, a = sub.at(1935.3);
const x = a.x + a.tz * 12.4, z = a.z - a.tx * 12.4, y = -2.6;
const info = { ss: 0, off: 0, inShaft: null as unknown };
console.log("sdf", flow.under.sdf(x, y, z, info).toFixed(2), "inShaft", (info.inShaft as { name?: string; kind?: string } | null)?.kind, (info.inShaft as { out?: boolean } | null)?.out);
for (const s of flow.under.shafts) {
  if (!s.exitPath) continue;
  const p = s.exitPath;
  let best = 1e9;
  for (let i = 0; i < p.length; i += 3) best = Math.min(best, Math.hypot(p[i] - x, p[i + 1] - y, p[i + 2] - z));
  if (best < 6) console.log("near path of", s.name, "ss", s.ss.toFixed(0), "min dist", best.toFixed(2));
}
const smp: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
flow.sample(x, y, z, 10, smp);
console.log("air", smp.x.toFixed(1), smp.y.toFixed(1), smp.z.toFixed(1), "tangent", a.tx.toFixed(2), a.tz.toFixed(2));
{
  const s = flow.under.shafts.find((q) => q.exitPath && Math.abs(q.ss - 1933) < 2)!;
  const L = Math.hypot(s.tx, s.tz);
  console.log("exit L", L.toFixed(1), "station hw 12.5 -> aWall", (L - 12.5).toFixed(1));
  const p = s.exitPath!;
  for (let i = 0; i < Math.min(p.length, 30); i += 3) { const n = sub.nearest(p[i], p[i + 2]); console.log(`pt ss ${n.s.toFixed(1)} off ${n.off.toFixed(1)} y ${p[i + 1].toFixed(2)}`); }
}
