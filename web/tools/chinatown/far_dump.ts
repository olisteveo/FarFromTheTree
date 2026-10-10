// Dump the far city's buildings, the skyline and the corridor buildings in a box (dev check for the bridge-area art pass).
//   npx tsx tools/chinatown/far_dump.ts x0 x1 z0 z1 out.json
import fs from "node:fs";
import zlib from "node:zlib";
import { decodeFar } from "../../src/render/farData";
const [x0, x1, z0, z1] = process.argv.slice(2, 6).map(Number);
let buf: Buffer = fs.readFileSync("public/far.dat");
if (buf[0] === 0x1f) buf = zlib.gunzipSync(buf);
const f = decodeFar(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const out: { p: number[]; h: number; t: number }[] = [];
for (let i = 0; i < f.start.length; i++) {
  const s = f.start[i] * 2, n = f.count[i];
  const x = f.verts[s], z = f.verts[s + 1];
  if (x < x0 || x > x1 || z < z0 || z > z1) continue;
  out.push({ p: Array.from(f.verts.subarray(s, s + n * 2)).map((v) => +v.toFixed(1)), h: f.height[i], t: f.type[i] });
}
console.log("far buildings in box:", out.length, "of", f.start.length);
fs.writeFileSync(process.argv[6], JSON.stringify(out));
