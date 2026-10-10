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

/** The bridge district: Manhattan east of the Bowery around the Manhattan Bridge, down to the East River.
 *  render/chinatownDistrict.ts draws the far city's buildings in here as textured blocks over a painted
 *  street plan; farCity.ts leaves the ones whose centre is inside out. A ring of x, z pairs. */
export const DISTRICT_ZONE: number[] = [
  -876, 2590, -876, 2120, -884, 2030, -896, 1885, -872, 1790, -852, 1700, -880, 1600, -925, 1495,
  -1900, 1495, -1900, 2590,
];
/** its bounding box, which the ground painting covers (square, so the texture's pixels are square) */
export const DISTRICT_BOX = { x0: -1900, x1: -805, z0: 1495, z1: 2590 };
