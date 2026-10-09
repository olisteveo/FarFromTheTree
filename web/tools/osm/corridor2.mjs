// Second download area: a buffer around the spine route (city.json) so Chinatown / Little Italy
// east of Broadway are complete. Writes corridor2_wkt.txt.
import fs from "node:fs";
const c = JSON.parse(fs.readFileSync("../../public/city.json", "utf8"));
const rad = (d) => (d * Math.PI) / 180;
const KY = 111132.954 - 559.822 * Math.cos(2 * rad(40.74)) + 1.175 * Math.cos(4 * rad(40.74));
const KX = 111412.84 * Math.cos(rad(40.74)) - 93.5 * Math.cos(3 * rad(40.74));
const G = rad(28.9), O = { lat: 40.7033, lon: -74.017 };
const inv = (xg, z) => { const x = -xg; const e = x * Math.cos(G) + z * Math.sin(G), n = -x * Math.sin(G) + z * Math.cos(G); return [O.lon + e / KX, O.lat + n / KY]; };
const r = c.route, pts = [];
for (let i = 0; i < r.length; i += 2 * 25) pts.push([r[i], r[i + 1]]);
pts.push([r[r.length - 2], r[r.length - 1]]);
const BUF = 420, L = [], R = [];
for (let i = 0; i < pts.length; i++) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
  L.push([pts[i][0] + nx * BUF, pts[i][1] + nz * BUF]); R.push([pts[i][0] - nx * BUF, pts[i][1] - nz * BUF]);
}
const ring = [...L, ...R.reverse()].map(([x, z]) => inv(x, z));
ring.push(ring[0]);
fs.writeFileSync("corridor2_wkt.txt", "MULTIPOLYGON(((" + ring.map(([lon, lat]) => `${lon.toFixed(6)} ${lat.toFixed(6)}`).join(",") + ")))");
console.log("corridor2", ring.length, "points");
