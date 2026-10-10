// Drop a leaf over the ways in and out and see where it ends up (stairs, vents).
import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const none = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0 as const, loop: false };
const curl = { ...none, curl: true };
const res: Record<string, string[]> = {};
for (const s of flow.under.shafts.filter((q) => q.kind !== "grate").slice(0, 400)) {
  const key = s.kind + (s.out ? "-out" : "-in");
  if ((res[key]?.length ?? 0) >= 8) continue;
  const back = Number(process.env.BACK ?? 3), h0 = Number(process.env.H ?? 4);
  const g = new Glider(city, flow, { x: s.x - s.ux * back, y: h0, z: s.z - s.uz * back, heading: Math.atan2(s.ux, s.uz) });
  if (process.env.GLIDE) g.vel.set(s.ux * 6, -1, s.uz * 6);
  g.detach();
  let minY = 99, maxY = -99, sub = 0;
  for (let i = 0; i < 6 * 120 && g.state === "flying"; i++) {
    if (i % 6 === 0) flow.traffic.update(g.clock);
    g.step(1 / 120, s.out || process.env.GLIDE || process.env.NOCURL ? none : curl);
    minY = Math.min(minY, g.pos.y); maxY = Math.max(maxY, g.pos.y);
    if (g.lane === "subway") sub++;
  }
  (res[key] ??= []).push(`${s.name.slice(0, 14).padEnd(14)} ${g.state.padEnd(6)} y ${minY.toFixed(1)}..${maxY.toFixed(1)} sub ${(sub / 120).toFixed(1)}s int ${g.integrity.toFixed(2)} ${g.failure ?? ""}`);
}
for (const [k, v] of Object.entries(res)) console.log(`== ${k}\n` + v.join("\n"));
