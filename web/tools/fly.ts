// Headless test flight: generates the city, lets a simple bot fly the leaf for a
// while and reports how far it got and what happened. The TD2099 balance sim idea,
// for flight feel: a regression check that the world is flyable after changes.
//
//   npx tsx tools/fly.ts [seconds] [style]
//   style: north (default) | still (no input) | dive | float

import { performance } from "node:perf_hooks";
import { Leaf, type LeafInput } from "../src/sim/leaf";
import { generateCity } from "../src/world/city";
import { WORLD } from "../src/world/spec";

const seconds = Number(process.argv[2] ?? 180);
const style = process.argv[3] ?? "north";

let t0 = performance.now();
const city = generateCity();
console.log(`city: ${city.buildings.length} buildings, ${city.props.length} props, ${city.wind.length} wind sources, ${city.roads.length} roads in ${(performance.now() - t0).toFixed(0)} ms`);

const leaf = new Leaf(city);
leaf.detach();
const dt = 1 / 240;
const input: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false };
const layers: Record<string, number> = {};
let maxZ = leaf.pos.z, maxY = leaf.pos.y, maxSpeed = 0, grounded = 0;
t0 = performance.now();
let lastLog = 0;
for (let i = 0; i < seconds / dt; i++) {
  if (style !== "still") {
    // aim north: bank toward heading 0
    let d = -leaf.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    input.roll = Math.max(-1, Math.min(1, -d * 1.5));
    const low = leaf.pos.y < 6;
    input.pitch = style === "dive" ? 0.6 : style === "float" ? -0.3 : low ? -0.7 : 0.15;
    input.spread = low || style === "float";
  }
  leaf.step(dt, input);
  const tm = leaf.telemetry();
  layers[tm.layer] = (layers[tm.layer] ?? 0) + dt;
  if (leaf.grounded) grounded += dt;
  maxZ = Math.max(maxZ, leaf.pos.z);
  maxY = Math.max(maxY, leaf.pos.y);
  maxSpeed = Math.max(maxSpeed, tm.speed);
  if (leaf.time - lastLog >= 10) {
    lastLog = leaf.time;
    const p = leaf.pos;
    console.log(`t=${leaf.time.toFixed(0).padStart(4)}s pos=(${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}) speed=${tm.speed.toFixed(1)} air=${tm.airspeed.toFixed(1)} ${tm.layer} ${tm.district} integrity=${leaf.integrity.toFixed(2)}`);
  }
  if (leaf.state !== "flying") break;
}
const ms = performance.now() - t0;
console.log(`\nstate: ${leaf.state}${leaf.failure ? ` (${leaf.failure})` : ""} after ${leaf.time.toFixed(1)}s`);
console.log(`north progress: ${(maxZ - WORLD.start.z).toFixed(0)} m of ${WORLD.goal.z - WORLD.start.z} m, max height ${maxY.toFixed(0)} m, max speed ${maxSpeed.toFixed(1)} m/s, grounded ${grounded.toFixed(0)}s`);
console.log(`layers: ${Object.entries(layers).map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(", ")}`);
console.log(`sim speed: ${((leaf.time / ms) * 1000).toFixed(0)}x real time`);
