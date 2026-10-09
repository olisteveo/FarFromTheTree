// Dumps the south end of Central Park (park polys, paths, route) as JSON for map_png.py (dev aid).
import fs from "node:fs";
import { CityData } from "../../src/world/data";
const city = new CityData(JSON.parse(fs.readFileSync("public/city.json", "utf8")));
const raw = city.raw;
const box = (x: number, z: number) => x > -150 && x < 1000 && z > 7600 && z < 8700;
const anyIn = (r: number[]) => { for (let i = 0; i < r.length; i += 2) if (box(r[i], r[i + 1])) return true; return false; };
const out = {
  parks: raw.parks.filter((p) => anyIn(p.p[0])).map((p) => ({ n: p.n, r: p.p[0] })),
  streets: raw.streets.filter((s) => anyIn(s.p)).map((s) => ({ n: s.n, rw: s.rw, w: s.w, p: s.p })),
  route: (() => { const a: number[] = []; for (let s = 7300; s < city.route.length; s += 8) { const p = city.route.at(s); a.push(p.x, p.z); } return a; })(),
  buildings: raw.buildings.filter((b) => anyIn(b.p[0])).map((b) => b.p[0]),
  sidewalk: raw.sidewalk.filter((p) => anyIn(p[0])).map((p) => p[0]),
  trees: (() => { const a: number[] = []; for (let i = 0; i < raw.trees.length; i += 3) if (box(raw.trees[i], raw.trees[i + 1])) a.push(raw.trees[i], raw.trees[i + 1]); return a; })(),
};
fs.writeFileSync(process.argv[2], JSON.stringify(out));
