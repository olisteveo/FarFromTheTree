// Top-down map of public/city.json for sanity checks: npx tsx tools/map-svg.ts [s0] [s1]
import fs from "node:fs";
const c = JSON.parse(fs.readFileSync("public/city.json", "utf8"));
const s0 = Number(process.argv[2] ?? 0), s1 = Number(process.argv[3] ?? 1e9);
const route: number[] = c.route;
const rp: [number, number][] = [];
for (let i = 0; i < route.length; i += 2) if (i / 2 * 4 >= s0 && i / 2 * 4 <= s1) rp.push([route[i], route[i + 1]]);
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const [x, z] of rp) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
const pad = 450; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
const W = 1400, k = W / (x1 - x0), H = Math.round((z1 - z0) * k);
const X = (x: number) => ((x - x0) * k).toFixed(1), Z = (z: number) => ((z1 - z) * k).toFixed(1);
const path = (f: number[]) => { let d = ""; for (let i = 0; i < f.length; i += 2) d += (i ? "L" : "M") + X(f[i]) + " " + Z(f[i + 1]); return d + "Z"; };
const P = (poly: number[][], fill: string, op = 1) => `<path d="${poly.map(path).join(" ")}" fill="${fill}" fill-rule="evenodd" opacity="${op}"/>`;
const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#2a4a5c"/>`];
for (const p of c.land) out.push(P(p, "#3a3a38"));
for (const p of c.roadbed) out.push(P(p, "#222"));
for (const p of c.sidewalk) out.push(P(p, "#777"));
for (const p of c.parks) out.push(P(p.p, "#4f6b33"));
const col: Record<string, string> = { tenement: "#a0523d", castiron: "#d9cbb0", prewar: "#c8a982", deco: "#e6c46a", modern: "#7d94a8", glass: "#5fa8d3", brick: "#8a5a44" };
for (const b of c.buildings) out.push(P(b.p, col[b.st] ?? "#f0f", Math.min(1, 0.4 + b.h / 150)));
for (const b of c.skyline) out.push(P(b.p, "#555"));
out.push(`<path d="${rp.map((p, i) => (i ? "L" : "M") + X(p[0]) + " " + Z(p[1])).join("")}" stroke="#ffb04a" stroke-width="3" fill="none"/>`);
for (const s of c.stations) out.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="6" fill="#4dff8a"/><text x="${+X(s.x) + 8}" y="${Z(s.z)}" fill="#fff" font-size="12">${s.n}</text>`);
for (const d of c.districts) { const i = Math.min(route.length / 2 - 1, Math.round(d.s0 / 4)); out.push(`<text x="${+X(route[i * 2]) + 30}" y="${Z(route[i * 2 + 1])}" fill="#ffd38a" font-size="22" font-weight="bold">${d.name}</text>`); }
out.push("</svg>");
fs.writeFileSync("data/map.svg", out.join("\n"));
console.log("data/map.svg", W, "x", H);
