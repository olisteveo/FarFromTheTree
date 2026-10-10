// The bridge district: Manhattan east of the Bowery around the Manhattan Bridge (Chinatown east, Two
// Bridges, the Lower East Side down to the East River). Pulls the far city's footprints there out of
// public/far.dat (render/chinatownDistrict.ts draws them as textured buildings; farCity.ts drops them),
// and writes the inputs for the ground painter (district_ground.py): land, buildings and the corridor's
// own ground polygons inside the box.
//   npx tsx tools/chinatown/district.ts
// Writes tools/chinatown/district_src.json (for district_ground.py) and public/models/ct_district.json
// (buildings; district_ground.py adds the street furniture points).
import fs from "node:fs";
import zlib from "node:zlib";
import { CityData, inRing } from "../../src/world/data";
import { decodeFar } from "../../src/render/farData";
import { DISTRICT_ZONE, DISTRICT_BOX } from "../../src/world/modelled";

const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
let buf: Buffer = fs.readFileSync("public/far.dat");
if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf);
const far = decodeFar(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const B = DISTRICT_BOX;
const inBox = (x: number, z: number, m = 0) => x > B.x0 - m && x < B.x1 + m && z > B.z0 - m && z < B.z1 + m;
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---- the far city's buildings with their centre in the zone
const buildings: { p: number[]; h: number; t: number; k: number }[] = [];
let nv = 0;
for (let i = 0; i < far.start.length; i++) {
  const s = far.start[i] * 2, n = far.count[i];
  let cx = 0, cz = 0;
  for (let k = 0; k < n; k++) { cx += far.verts[s + k * 2]; cz += far.verts[s + k * 2 + 1]; }
  cx /= n; cz /= n;
  if (!inRing(DISTRICT_ZONE, cx, cz)) continue;
  const p: number[] = [];
  for (let k = 0; k < n * 2; k++) p.push(r1(far.verts[s + k]));
  buildings.push({ p, h: r1(far.height[i]), t: far.type[i], k: far.seed[i] });
  nv += n;
}
console.log("district buildings", buildings.length, "vertices", nv, "tallest", Math.max(...buildings.map((b) => b.h)).toFixed(0));

// ---- the painter's inputs: everything that's already drawn (corridor ground, all buildings) and the land
const near = (ring: number[]) => { for (let k = 0; k < ring.length; k += 2) if (inBox(ring[k], ring[k + 1], 60)) return true; return false; };
const rings = (list: number[][][]) => list.filter((p) => near(p[0])).map((p) => p[0].map(r1));
const raw = city.raw;
const src = {
  box: B,
  zone: DISTRICT_ZONE,
  land: rings(raw.land),
  // the corridor's own ground: the painter leaves these alone (ground.ts draws them)
  covered: [...rings(raw.roadbed), ...rings(raw.sidewalk), ...rings(raw.median), ...rings(raw.plaza), ...rings(raw.parks.map((p) => p.p)), ...rings(raw.sites.map((p) => p.p)), ...rings(raw.open)],
  buildings: [
    ...buildings.map((b) => b.p),
    ...raw.buildings.filter((b) => near(b.p[0])).map((b) => b.p[0].map(r1)),
    ...raw.skyline.filter((b) => near(b.p[0])).map((b) => b.p[0].map(r1)),
  ],
  // the bridge approach's footprint (it stands on the ground: no streets painted under the arcade)
  route: raw.route.filter((_, i) => { const k = i - (i % 2); return inBox(raw.route[k], raw.route[k + 1], 400); }).map(r1),
};
fs.writeFileSync("tools/chinatown/district_src.json", JSON.stringify(src));
fs.writeFileSync("public/models/ct_district.json", JSON.stringify({ box: B, buildings }));
console.log("land", src.land.length, "covered", src.covered.length, "all buildings", src.buildings.length);
