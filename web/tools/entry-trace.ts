import fs from "node:fs";
import { CityData } from "../src/world/data";
import { Airflow } from "../src/world/airflow";
import { Glider } from "../src/sim/glider";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const none = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0 as const, loop: false };
const s = flow.under.shafts.filter((q) => q.kind === "stairs" && !q.out)[Number(process.argv[2] ?? 2)];
const g = new Glider(city, flow, { x: s.x - s.ux * 4, y: 0.5, z: s.z - s.uz * 4, heading: Math.atan2(s.ux, s.uz) });
g.detach();
console.log(s.name);
for (let i = 0; i < 3 * 120; i++) {
  g.step(1 / 120, none);
  if (i % 30 === 0) {
    const a = (g.pos.x - s.x) * s.ux + (g.pos.z - s.z) * s.uz, b = (g.pos.x - s.x) * s.uz - (g.pos.z - s.z) * s.ux;
    console.log(`t${g.clock.toFixed(2)} a${a.toFixed(2)} b${b.toFixed(2)} y${g.pos.y.toFixed(2)} v(${g.vel.x.toFixed(1)},${g.vel.y.toFixed(1)},${g.vel.z.toFixed(1)}) air(${g.air.x.toFixed(1)},${g.air.y.toFixed(1)},${g.air.z.toFixed(1)}) gr ${g.grounded}`);
  }
}
console.log(g.events.slice(-4));
{
  const x = s.x - s.ux * 4, z = s.z - s.uz * 4;
  const near = flow.streetLayout.colliders.filter((c: { x: number; z: number }) => Math.hypot(c.x - x, c.z - z) < 3);
  console.log("street colliders within 3 m:", near.map((c: { kind: string; name?: string; x: number; z: number }) => `${c.kind} ${c.name} @${Math.hypot(c.x - x, c.z - z).toFixed(1)}`));
  const pk = flow.parkLayout.colliders.filter((c: { x: number; z: number }) => Math.hypot(c.x - x, c.z - z) < 3);
  console.log("park colliders:", pk.length, "facade props near:", flow.facades.grid.at(x, z).length, "building:", !!city.buildingAt(x, z));
}
