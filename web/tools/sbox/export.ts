// Export what the s&box rebuild needs from the web game (docs/SBOX_MIGRATION.md): the tuning tables, the
// derived world (ways through, currents, closures, subway shafts), and parity samples, which are the web
// simulation's own answers at fixed points, so the C# port can be tested until it gives the same ones.
//   npx tsx tools/sbox/export.ts            -> export/sbox/*.json
// Re-run after any gameplay change; the files are committed so the port always has a current reference.
import fs from "node:fs";
import { CityData } from "../../src/world/data";
import { Airflow, AIR, type AirSample } from "../../src/world/airflow";
import { Glider, FLIGHT } from "../../src/sim/glider";
import { JET_GRADE } from "../../src/world/windFeatures";
import { RAIN } from "../../src/world/rain";
import { TUNNEL, TRAIN, STAIRS, VENT, PLATFORM } from "../../src/world/underground";
import { CAP, LANE } from "../../src/world/blockers";
import { PARK } from "../../src/world/park";
import { makeCourse } from "../../src/world/course";

const OUT = "export/sbox";
fs.mkdirSync(OUT, { recursive: true });
const r2 = (v: number) => Math.round(v * 100) / 100, r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const write = (name: string, data: unknown) => {
  const s = JSON.stringify(data);
  fs.writeFileSync(`${OUT}/${name}.json`, s);
  console.log(`${OUT}/${name}.json  ${(s.length / 1024).toFixed(0)} KB`);
};

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const flow = new Airflow(city);
const course = makeCourse(city);

// ---- conventions and tuning
write("tuning", {
  conventions: {
    units: "metres; seconds; speeds in m/s",
    axes: "web is three.js right-handed Y-up: x east-ish, y up, z along the island (uptown is +z in the rotated grid). s&box is Z-up in inches: S = (x, -z, y) * 39.3701",
    heading: "radians, atan2(dx, dz): 0 faces +z",
    grid: city.raw.meta,
  },
  FLIGHT, AIR, JET_GRADE, RAIN, TUNNEL, TRAIN, STAIRS, VENT, PLATFORM, CAP, LANE, PARK,
});

// ---- the derived world
const line = (l: { x: Float32Array; z: Float32Array }, every = 2) => {
  const out: number[] = [];
  for (let i = 0; i < l.x.length; i += every) out.push(r2(l.x[i]), r2(l.z[i]));
  return out;
};
write("ways", {
  course: { tree: course.tree, start: course.start, meadow: { x0: 430, x1: 730, z0: 8290, z1: 8565 }, path: line(course.path) },
  ways: flow.features.routes.map((w) => ({ id: w.id, name: w.name, step: 8, line: line(w.line), y: Array.from({ length: Math.ceil(w.line.length / 8) + 1 }, (_, k) => r2(w.y(k * 8))) })),
});
write("currents", flow.features.jets.map((j) => ({
  id: j.id, name: j.name, kind: j.kind, route: j.route ?? null, decoy: j.decoy ?? null, grade: j.grade,
  r: j.r, speed: r2(j.speed), pts: Array.from(j.pts, r2),
})));
write("closures", { blockers: flow.blockers.list, barriers: flow.blockers.barriers, balloons: flow.blockers.balloons });
write("subway", {
  line: line(city.subway),
  shafts: flow.under.shafts.map((s) => ({ ...s, entryPath: s.entryPath ? Array.from(s.entryPath, r2) : null, exitPath: s.exitPath ? Array.from(s.exitPath, r2) : null })),
});

// ---- parity: the wind at fixed points and times (street, roofs, subway, off the ways, at closures)
const o: AirSample = { x: 0, y: 0, z: 0, lane: "street", vehicle: false, train: false };
const samples: number[][] = [];
for (let s = 100; s < course.path.length - 100; s += 150) {
  const a = course.path.at(s);
  for (const [dx, y] of [[0, 4], [0, 16], [0, 60], [30, 10], [-30, 10], [0, -6]] as const) {
    const t = (s * 0.37) % 120;
    flow.sample(a.x + dx * a.tz, y, a.z - dx * a.tx, t, o);
    samples.push([r2(a.x + dx * a.tz), y, r2(a.z - dx * a.tx), r2(t), r4(o.x), r4(o.y), r4(o.z), o.jet ?? -1, r4(o.guide ?? 0)]);
  }
}
// ---- parity: one flight from the tree with scripted input (the leaf's position every half second)
const g = new Glider(city, flow, course.start);
g.detach();
const flight: number[][] = [];
const dt = 1 / 120;
for (let i = 0; i < 120 * 90 && g.state === "flying"; i++) {
  const t = i * dt;
  if (i % 6 === 0) flow.traffic.update(g.clock);
  g.step(dt, { pitch: Math.sin(t * 0.7) * 0.4, roll: Math.sin(t * 0.31) * 0.5, spread: t % 20 < 6, curl: false, corkscrew: 0, loop: false });
  if (i % 60 === 0) flight.push([r2(t), r4(g.pos.x), r4(g.pos.y), r4(g.pos.z), r4(g.vel.x), r4(g.vel.y), r4(g.vel.z), r4(g.integrity)]);
}
write("parity", {
  note: "Run the same inputs through the C# port and compare. Wind: [x,y,z,t, wx,wy,wz, jet, guide]. Flight: [t, x,y,z, vx,vy,vz, integrity] every 0.5 s, input pitch=sin(0.7t)*0.4, roll=sin(0.31t)*0.5, spread while t%20<6, 120 Hz steps, traffic updated every 6 steps.",
  wind: samples, flight, flightEnd: { state: g.state, failure: g.failure ?? null },
});
