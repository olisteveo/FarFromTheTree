// The simulation must stay portable (docs/SBOX_MIGRATION.md): src/world, src/sim and src/core are the
// game's rules, and they get rebuilt in C# for s&box. They may not reach into the renderer, the browser or
// three.js (except the leaf's vector maths, listed below), and may not use unseeded randomness.
//   npx tsx tools/sbox/portable-check.ts        (part of npm run build)
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src/world", "src/sim", "src/core"];
// known exceptions, each with its reason: shrink this list, never grow it casually
const ALLOW: Record<string, RegExp[]> = {
  "src/sim/glider.ts": [
    /from "three"/, // Vector3/Quaternion/Euler only: maps to s&box Vector3/Rotation
    /from "\.\.\/render\/centralPark"/, // TODO(port): park colliders are gameplay data living in a render file
  ],
  // TODO(port): these layouts (colliders, signal timing, facade tiles) are gameplay data that grew up in
  // render files. Move them to src/world before the port (see the migration doc), then delete these lines.
  "src/world/airflow.ts": [/from "\.\.\/render\/centralPark"/, /from "\.\.\/render\/streetLayout"/],
  "src/world/crowd.ts": [/from "\.\.\/render\/streetLayout"/],
  "src/world/facades.ts": [/from "\.\.\/render\/facades"/],
};
const RULES: [RegExp, string][] = [
  [/from ["']three["']/, "three.js (renderer maths) in the simulation"],
  [/from ["']\.\.\/render\//, "the simulation importing the renderer"],
  [/from ["']\.\.\/game\//, "the simulation importing UI/game shell code"],
  [/\b(document|window|localStorage|sessionStorage|navigator|requestAnimationFrame|performance\.now)\b/, "a browser API in the simulation"],
  [/Math\.random\s*\(/, "unseeded randomness (use core/rng.ts hashes: the run must be the same for everyone)"],
  [/Math\.sin\([^)]*\)\s*\*\s*43758/, "a float sin-hash (differs across engines in the last bits; use an integer hash)"],
];
let bad = 0;
for (const root of ROOTS) {
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith(".ts")) continue;
    const file = `${root}/${f}`;
    const lines = fs.readFileSync(path.join(root, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\*|\/\*\*?)/.test(line)) return; // (doc comments)
      const code = line.replace(/\/\/.*$/, "");
      for (const [re, why] of RULES) {
        if (!re.test(code)) continue;
        if (ALLOW[file]?.some((a) => a.test(code))) continue;
        console.log(`${file}:${i + 1}  ${why}\n    ${line.trim().slice(0, 140)}`);
        bad++;
      }
    });
  }
}
if (bad) { console.log(`\n${bad} portability problem(s). See docs/SBOX_MIGRATION.md, "Keeping the web code portable".`); process.exit(1); }
console.log("simulation is portable: no renderer, browser or unseeded randomness in src/world, src/sim, src/core");
