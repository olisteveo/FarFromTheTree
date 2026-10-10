// Footprints the open data has as ordinary buildings but that are modelled separately, so the building
// renderers (render/buildings.ts, the facade props, the far city) leave them out. They stay in
// city.buildings: the flight model still treats them as solid.
//   - the Manhattan Bridge's arch and colonnade at Canal St and the Bowery (render/chinatown.ts)

const MODELLED: { x: number; z: number; r: number }[] = [
  { x: -961.5, z: 2069.6, r: 12 },
];

/** Is the building with this centroid drawn by a model instead? */
export function isModelled(cx: number, cz: number): boolean {
  for (const m of MODELLED) if (Math.hypot(cx - m.x, cz - m.z) < m.r) return true;
  return false;
}
