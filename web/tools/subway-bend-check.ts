// The bent tunnels (world/subwayBend.ts): how far they swing and dip, how tight the bends are, and
// that nothing that meets the tunnel moved or lost it: the stations, the stairs and their air paths,
// the vents and grates (which must still open into the tunnel roof), the train track (clear air all
// along both tracks at train height).
//   npx tsx tools/subway-bend-check.ts
import fs from "node:fs";
import { CityData, Polyline } from "../src/world/data";
import { Underground, TUNNEL, TRAIN, VENT } from "../src/world/underground";

const raw = JSON.parse(fs.readFileSync("public/city.json", "utf8"));
const city = new CityData(raw);
const flat = new CityData(raw);
(flat as unknown as { subway: Polyline }).subway = new Polyline(raw.subway);
(flat as unknown as { subwayDy: Float32Array }).subwayDy = new Float32Array(flat.subway.x.length);
const u = new Underground(city), u0 = new Underground(flat);
const sub = city.subway, sub0 = flat.subway;

// how far it swings and dips, and the tightest bend
let maxSide = 0, minDip = 0, maxDip = 0, maxGrade = 0, minR = Infinity, minRAt = 0;
for (let i = 1; i < sub.x.length - 1; i++) {
  const s = i * sub.step;
  if (s > u.end) break;
  maxSide = Math.max(maxSide, Math.hypot(sub.x[i] - sub0.x[i], sub.z[i] - sub0.z[i]));
  const d = city.subwayDy[i];
  minDip = Math.min(minDip, d); maxDip = Math.max(maxDip, d);
  maxGrade = Math.max(maxGrade, Math.abs(city.subwayDy[i + 1] - d) / sub.step);
}
// curvature over 12 m chords (the polyline's own 4 m kinks are the survey's, not the bend's)
for (let s = 12; s < u.end - 12; s += 4) {
  const a = sub.at(s - 12), b = sub.at(s), c = sub.at(s + 12);
  const A = Math.hypot(b.x - a.x, b.z - a.z), B = Math.hypot(c.x - b.x, c.z - b.z), C = Math.hypot(c.x - a.x, c.z - a.z);
  const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  const R = area2 > 1e-6 ? (A * B * C) / (2 * area2) : Infinity;
  const a0 = sub0.at(s - 12), b0 = sub0.at(s), c0 = sub0.at(s + 12);
  const area0 = Math.abs((b0.x - a0.x) * (c0.z - a0.z) - (b0.z - a0.z) * (c0.x - a0.x));
  // only the bend's own curvature: where the surveyed line was straight here
  if (area0 < 0.5 && R < minR) { minR = R; minRAt = s; }
}
console.log(`swing up to ${maxSide.toFixed(1)} m; floor from ${minDip.toFixed(2)} to +${maxDip.toFixed(2)} m; steepest grade ${(maxGrade * 100).toFixed(1)}%; tightest bend (where the survey was straight) R ${minR.toFixed(0)} m at s${minRAt}`);
console.log(`  (at 20 m/s that's ${((20 * 20) / minR).toFixed(1)} m/s^2 sideways)`);

// stations exactly where they were
let stMoved = 0;
for (const st of u.stations) for (let ds = -105; ds <= 105; ds += 4) {
  const a = sub.at(st.ss + ds), b = sub0.at(st.ss + ds);
  if (Math.hypot(a.x - b.x, a.z - b.z) > 0.01 || Math.abs(city.subwayDip(st.ss + ds)) > 0.001) stMoved++;
}
console.log(`station samples moved: ${stMoved}`);

// shafts: the same, with the same air paths
let shaftDiff = 0;
u.shafts.forEach((s, i) => {
  const t = u0.shafts[i];
  if (!t || t.kind !== s.kind) { shaftDiff++; console.log("  shaft list differs at", i); return; }
  if (s.kind !== "stairs") return;
  const same = (a?: Float32Array, b?: Float32Array) => (!a && !b) || (!!a && !!b && a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < 0.05));
  if (Math.hypot(s.x - t.x, s.z - t.z) > 0.01 || s.aw !== t.aw || s.aCut !== t.aCut || !same(s.entryPath, t.entryPath) || !same(s.exitPath, t.exitPath)) {
    shaftDiff++; console.log(`  stairs changed: ${s.name} ${s.out ? "out" : "in"} @${s.ss.toFixed(0)}`);
  }
});
console.log(`stairs changed by the bend: ${shaftDiff}`);

// vents and grates still open into the tunnel roof: clear air from just under the street down into the tunnel
let lost = 0;
for (const s of u.shafts) {
  if (s.kind === "stairs") continue;
  const c = TUNNEL.ceiling + u.dip(s.ss);
  for (const y of [-0.8, c + 0.2, c - 0.5, c - 1.5]) {
    const pts = s.kind === "vent" ? [[0, 0], [VENT.halfLength - 0.8, 0], [-(VENT.halfLength - 0.8), 0]] : [[0, 0]];
    for (const [a, b] of pts) {
      const x = s.x + s.ux * a + s.uz * b, z = s.z + s.uz * a - s.ux * b;
      if (u.sdf(x, y, z) < 0.2) { lost++; console.log(`  ${s.kind} ${s.name} @${s.ss.toFixed(0)}: blocked at y ${y.toFixed(1)} (sdf ${u.sdf(x, y, z).toFixed(2)})`); }
    }
  }
}
console.log(`vents/grates not open to the tunnel: ${lost}`);

// both tracks clear at train height all the way (no wall, no ghost of the old line poking in)
let blocked = 0;
for (let s = 2; s < u.end - 2; s += 1) {
  if (u.isBlocked(s) || u.blocked.some((b) => Math.abs(s - b.ss0) < 1.5 || Math.abs(s - b.ss1) < 1.5)) continue;
  const a = sub.at(s), dy = u.dip(s);
  for (const off of [TRAIN.track, -TRAIN.track]) for (const y of [TUNNEL.floor + 0.6, TUNNEL.floor + 2.5, TUNNEL.floor + 0.35 + TRAIN.height]) {
    const x = a.x + a.tz * off, z = a.z - a.tx * off;
    if (u.sdf(x, y + dy, z) < 0.25) { blocked++; if (blocked < 10) console.log(`  track blocked at s${s} off ${off} y ${(y + dy).toFixed(1)}: sdf ${u.sdf(x, y + dy, z).toFixed(2)}`); }
  }
}
console.log(`track samples not clear: ${blocked}`);
// and the old line, where the new one has swung away from it, is rock now
let ghosts = 0, checked = 0;
for (let s = 2; s < u.end - 2; s += 2) {
  if (u.isBlocked(s)) continue;
  const a = sub0.at(s), q = sub.nearest(a.x, a.z);
  if (q.d < TUNNEL.halfWidth + 1.5) continue;
  checked++;
  if (u.sdf(a.x, TUNNEL.floor + 3, a.z) > 0) ghosts++;
}
console.log(`old-line samples outside the new tunnel: ${checked}, of which still air: ${ghosts}`);

// the street openings over the tunnel (vents, grates) must be out in the open, not under a building
const inBuilding = (uu: Underground, cc: CityData) => {
  const out: string[] = [];
  for (const s of uu.shafts) {
    if (s.kind === "stairs") continue;
    const ha = s.kind === "vent" ? VENT.halfLength : s.r, hb = s.kind === "vent" ? VENT.halfWidth : s.r;
    let hit = false;
    for (const a of [-ha, 0, ha]) for (const b of [-hb, 0, hb]) if (cc.buildingAt(s.x + s.ux * a + s.uz * b, s.z + s.uz * a - s.ux * b)) hit = true;
    if (hit) out.push(`${s.kind}${s.out ? " out" : ""} @${s.ss.toFixed(0)}`);
  }
  return out;
};
const nowIn = inBuilding(u, city), wasIn = inBuilding(u0, flat);
console.log(`vents/grates under a building: bent ${nowIn.length} (${nowIn.filter((x) => x.startsWith("vent")).join(", ")}), straight ${wasIn.length} (${wasIn.filter((x) => x.startsWith("vent")).join(", ")})`);
