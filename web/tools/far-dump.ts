// Dump far.dat footprints inside a box as JSON rings (for map checks): npx tsx tools/far-dump.ts x0 x1 z0 z1 out.json
import fs from "node:fs";
import zlib from "node:zlib";
import { decodeFar } from "../src/render/farData";
const [x0, x1, z0, z1] = process.argv.slice(2, 6).map(Number);
let b = fs.readFileSync("public/far.dat");
if (b[0] === 0x1f) b = zlib.gunzipSync(b);
const f = decodeFar(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const out: number[][] = [];
for (let i = 0; i < f.start.length; i++) {
  const s = f.start[i] * 2, n = f.count[i];
  const x = f.verts[s], z = f.verts[s + 1];
  if (x < x0 || x > x1 || z < z0 || z > z1) continue;
  out.push(Array.from(f.verts.slice(s, s + n * 2)));
}
fs.writeFileSync(process.argv[6], JSON.stringify(out));
console.log(out.length, "far footprints");
