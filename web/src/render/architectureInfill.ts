// Infill: buildings for the gaps in the open data (vacant lots, missing footprints, slivers)
// inside the playable strip, found offline by tools/buildings/gaps.ts and stored with the lots in
// models/buildings_gaps.json. They are REAL buildings: addInfill() appends them to
// city.buildings (and its spatial grid), so the flight model, the wind, the facade props and the
// renderer all treat them like the rest. Call it once, right after CityData.load() and before
// anything else reads the buildings (main.ts wiring), or they're only drawn by nobody.

import type { Building, CityData, Poly, Style } from "../world/data";
import { ringArea, inPoly } from "../world/data";

export interface GapsFile {
  version: number;
  /** infill buildings in the city.json building format (+ why they're there) */
  buildings: { p: Poly; h: number; y: number; st: Style; k: number; s: number; d: number; why: string }[];
  /** lots that stay open: parking (asphalt, chain-link, cars) or construction (hoardings, scaffold, crane) */
  lots: { p: Poly; kind: "parking" | "construction"; k: number; front: number[] }[];
}

let file: Promise<GapsFile | null> | null = null;

export function loadGaps(): Promise<GapsFile | null> {
  if (!file) {
    const base = location.pathname.includes("/tools/") ? "/" : "./";
    file = fetch(`${base}models/buildings_gaps.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return file;
}

/** Append the infill buildings to the city (skipping any that now overlap a real footprint). Returns how many. */
export async function addInfill(city: CityData): Promise<number> {
  const g = await loadGaps();
  if (!g) return 0;
  let n = 0;
  for (const b of g.buildings) {
    const o = b.p[0];
    let cx = 0, cz = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      cx += o[i]; cz += o[i + 1];
      x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]); z0 = Math.min(z0, o[i + 1]); z1 = Math.max(z1, o[i + 1]);
    }
    cx /= o.length / 2; cz /= o.length / 2;
    const probe = inPoly(b.p, cx, cz) ? [cx, cz] : [o[0] * 0.5 + o[4] * 0.5, o[1] * 0.5 + o[5] * 0.5];
    if (city.buildingAt(probe[0], probe[1])) continue;
    const id = city.buildings.length;
    const nb: Building = { id, poly: b.p, h: b.h, year: b.y, style: b.st, seed: b.k, s: b.s, off: b.d, x0, z0, x1, z1, cx, cz, area: Math.abs(ringArea(o)) };
    city.buildings.push(nb);
    city.bgrid.add(nb, x0, z0, x1, z1);
    n++;
  }
  return n;
}
