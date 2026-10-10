// Chinatown layout: the Manhattan Bridge's frame (arch centre, axis) from the plaza footprint in city.json,
// the colonnade footprint in the bridge's local frame, and a clearance check of the approach viaduct against
// building footprints. Writes tools/chinatown/bridge_layout.json for chinatown_blender.py.
//   npx tsx tools/chinatown/layout.ts
import fs from "node:fs";
import { CityData, inPoly } from "../../src/world/data";
import { projLL } from "../../src/render/farData";

const c = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
// the arch + colonnade footprint (OSM has them as one "building" at the Canal St / Bowery plaza)
const plaza = c.buildings.find((b) => Math.hypot(b.cx + 961.5, b.cz - 2069.6) < 12)!;
if (!plaza) throw new Error("plaza footprint not found");
const ring = plaza.poly[0];
// the arch: the thick end of the footprint, an edge ~23 m long; the roadway runs through it
// (its outer face runs from (-984.4, 2067.2) to (-969.9, 2048.7))
const e0 = [-984.4, 2067.2], e1 = [-969.9, 2048.7];
const ex = e1[0] - e0[0], ez = e1[1] - e0[1], el = Math.hypot(ex, ez);
// axis toward Brooklyn: perpendicular to the arch face, pointing away from the plaza (SE)
let ux = ez / el, uz = -ex / el;
if (ux * (plaza.cx - (e0[0] + e1[0]) / 2) + uz * (plaza.cz - (e0[1] + e1[1]) / 2) > 0) { ux = -ux; uz = -uz; }
const ax0 = (e0[0] + e1[0]) / 2 - ux * 3, az0 = (e0[1] + e1[1]) / 2 - uz * 3; // arch centre (3 m deep from the face)
// (the far city's box bridge, farCity.ts, runs ~90 m to the south-west of this: the plaza footprint is the better guide)
const farMid = projLL(40.7075, -73.9906);
console.log("far city's bridge middle", farMid[0].toFixed(0), farMid[1].toFixed(0));
console.log("arch", ax0.toFixed(1), az0.toFixed(1), "axis", ux.toFixed(3), uz.toFixed(3), "arch width", el.toFixed(1));
const local = (x: number, z: number) => { const dx = x - ax0, dz = z - az0; return [dx * ux + dz * uz, -dx * uz + dz * ux]; }; // t along, s to the left (+s = (−uz, ux))
const fp: number[][] = [];
for (let i = 0; i < ring.length; i += 2) fp.push(local(ring[i], ring[i + 1]).map((v) => +v.toFixed(2)));
console.log("footprint (t,s)", JSON.stringify(fp));
// where the axis meets the shore and the far city's bridge
const W = (t: number) => [ax0 + ux * t, az0 + uz * t];
for (const t of [0, 100, 200, 300, 400, 497, 600, 719, 900, 1167, 1389, 1600, 1800]) {
  const [x, z] = W(t);
  console.log("t", t, x.toFixed(0), z.toFixed(0), "land", c.onLand(x, z), "route", c.route.nearest(x, z).s.toFixed(0), Math.hypot(c.route.at(c.route.nearest(x, z).s).x - x, c.route.at(c.route.nearest(x, z).s).z - z).toFixed(0));
}
// clearance: any building footprint within the viaduct's width (deck below its roof) from t = 10 to 520
const deckY = (t: number) => (t < 40 ? 0 : t > 497 ? 38 : 38 * Math.pow((t - 40) / 457, 1.15));
const hits = new Map<string, string>();
for (let t = 6; t < 520; t += 2) for (let s = -18; s <= 18; s += 2) {
  const [x, z] = W(t);
  const px = x - uz * s, pz = z + ux * s;
  const b = c.buildingAt(px, pz);
  if (b && b.id !== plaza.id) hits.set("b" + b.id, `detailed ${b.id} h ${b.h} at t ${t} deck ${deckY(t).toFixed(1)}`);
  c.raw.skyline.forEach((sk, i) => { if (inPoly(sk.p, px, pz)) hits.set("s" + i, `skyline ${i} h ${sk.h} at t ${t}`); });
}
console.log("clearance hits:", [...hits.values()]);
const out = { arch: [+ax0.toFixed(2), +az0.toFixed(2)], axis: [+ux.toFixed(5), +uz.toFixed(5)], archWidth: +el.toFixed(2), footprint: fp, plazaBuilding: [+plaza.cx.toFixed(1), +plaza.cz.toFixed(1)] };
fs.writeFileSync("tools/chinatown/bridge_layout.json", JSON.stringify(out, null, 1));
// the shores along the axis
{
  let prev = true;
  for (let t = 0; t < 3000; t += 10) { const [x, z] = W(t); const l = c.onLand(x, z); if (l !== prev) console.log("shore t", t, l ? "land" : "water", x.toFixed(0), z.toFixed(0)); prev = l; }
}
