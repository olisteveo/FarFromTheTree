// The city, as data. Everything the generator builds comes from this file, so
// growing the map means adding a district here, not placing things by hand.
//
// Units are metres. +x is east (cross-town), +z is north (uptown), +y is up.
// The route runs south to north: Columbus Park in Chinatown to Central Park.

export type Hex = string;

export interface DistrictSpec {
  id: string;
  name: string;
  subtitle: string;
  /** South and north edge of the district. */
  z0: number;
  z1: number;
  /** E-W streets: spacing between centre lines and road width. */
  street: { spacing: [number, number]; width: number };
  /** Extra narrow N-S lanes between each pair of avenues (Chinatown is a warren). */
  alleys: number;
  alleyWidth: number;
  /** Building heights in metres. */
  height: { min: number; max: number; tallChance: number; tallMax: number };
  /** Facade widths of individual buildings along a block. */
  lot: [number, number];
  /** Depth of perimeter buildings (the rest of the block is a courtyard). */
  depth: [number, number];
  walls: Hex[];
  roof: Hex;
  trim: Hex;
  /** Fraction of windows lit. */
  lit: number;
  floor: number;
  /** Per-building chances / per-block counts of the props that make the place. */
  props: {
    fireEscape: number;
    ac: number;
    waterTower: number;
    lanterns: number;
    neon: number;
    steam: number;
    thermal: number;
  };
  /** Look: tint of the light, fog and the grade. */
  look: { sun: Hex; sky: Hex; fog: Hex; fogDensity: number; grade: [number, number, number]; neon: Hex[] };
  park?: boolean;
}

export const AVENUES: { x: number; width: number; name: string; flow: 1 | -1 }[] = [
  // flow: +1 the canyon wind runs uptown (north), -1 downtown. Like the traffic, they alternate.
  { x: -720, width: 30, name: "Tenth Ave", flow: 1 },
  { x: -480, width: 30, name: "Eighth Ave", flow: 1 },
  { x: -240, width: 30, name: "Seventh Ave", flow: -1 },
  { x: 0, width: 34, name: "Broadway", flow: 1 },
  { x: 240, width: 30, name: "Fifth Ave", flow: -1 },
  { x: 480, width: 30, name: "Park Ave", flow: 1 },
  { x: 720, width: 30, name: "Lexington", flow: -1 },
];

export const WORLD = {
  seed: 20261009,
  xMin: -840,
  xMax: 840,
  zMin: -120,
  zMax: 4400,
  /** Subway line runs under Broadway. */
  subway: { x: 0, halfWidth: 6, floor: -11, ceiling: -3.5, openingEvery: 3 },
  start: { x: -112, y: 12.5, z: 132 },
  /** Plant the seed here to win. */
  goal: { x: -60, z: 3980, radius: 26 },
  pond: { x0: -260, x1: -60, z0: 3420, z1: 3560 },
  /** Wind, before streets and buildings shape it. */
  prevailing: { dirDeg: 8, speed: 7, roofSpeed: 12, gradientHeight: 160 },
};

const CHINATOWN: DistrictSpec = {
  id: "chinatown",
  name: "Chinatown",
  subtitle: "Mott Street, Columbus Park",
  z0: WORLD.zMin,
  z1: 900,
  street: { spacing: [58, 96], width: 13 },
  alleys: 2,
  alleyWidth: 9,
  height: { min: 12, max: 26, tallChance: 0.04, tallMax: 48 },
  lot: [7, 13],
  depth: [14, 22],
  walls: ["#8a4a3a", "#9b5b44", "#7b3f33", "#a87a5c", "#6f5a4c", "#b6906a", "#8c6d5a", "#5f4b42"],
  roof: "#3a3431",
  trim: "#d9c7a8",
  lit: 0.42,
  floor: 3.3,
  props: { fireEscape: 0.7, ac: 0.85, waterTower: 0.18, lanterns: 3, neon: 0.55, steam: 1.2, thermal: 0.04 },
  look: { sun: "#ffb27a", sky: "#f2a27e", fog: "#e7a88a", fogDensity: 0.0026, grade: [1.08, 0.97, 0.9], neon: ["#ff3b3b", "#ffcf3b", "#ff6a2a", "#ff3b8a"] },
};

const FLATIRON: DistrictSpec = {
  id: "flatiron",
  name: "The Flatiron Mile",
  subtitle: "Union Square, Broadway",
  z0: 900,
  z1: 1500,
  street: { spacing: [70, 84], width: 17 },
  alleys: 1,
  alleyWidth: 11,
  height: { min: 24, max: 62, tallChance: 0.08, tallMax: 110 },
  lot: [12, 26],
  depth: [20, 32],
  walls: ["#c9b79c", "#b59f84", "#a3907c", "#d4c4ab", "#8f8277", "#b8a48d"],
  roof: "#4b4744",
  trim: "#efe6d4",
  lit: 0.35,
  floor: 3.8,
  props: { fireEscape: 0.25, ac: 0.6, waterTower: 0.35, lanterns: 0, neon: 0.2, steam: 1.0, thermal: 0.08 },
  look: { sun: "#ffc890", sky: "#f4b892", fog: "#e8b89a", fogDensity: 0.0022, grade: [1.04, 1.0, 0.95], neon: ["#ffd25a", "#7ad7ff"] },
};

const MIDTOWN: DistrictSpec = {
  id: "midtown",
  name: "Midtown",
  subtitle: "Glass canyons, Times Square",
  z0: 1500,
  z1: 3250,
  street: { spacing: [78, 82], width: 18 },
  alleys: 0,
  alleyWidth: 0,
  height: { min: 45, max: 170, tallChance: 0.16, tallMax: 330 },
  lot: [20, 44],
  depth: [28, 40],
  walls: ["#7f8ea0", "#5f6f82", "#9aa7b4", "#4f5a68", "#a59b8e", "#6e7c8c", "#88939c"],
  roof: "#3d434b",
  trim: "#dfe6ee",
  lit: 0.5,
  floor: 4.0,
  props: { fireEscape: 0.02, ac: 0.4, waterTower: 0.12, lanterns: 0, neon: 0.25, steam: 1.4, thermal: 0.14 },
  look: { sun: "#ffd2a6", sky: "#d8a8a0", fog: "#c9a2a4", fogDensity: 0.0018, grade: [0.98, 0.99, 1.06], neon: ["#ff2bd6", "#2bf0ff", "#ffe02b", "#7a5bff", "#ff5a2b"] },
};

const PARK: DistrictSpec = {
  id: "park",
  name: "Central Park",
  subtitle: "Plant the seed",
  z0: 3250,
  z1: WORLD.zMax,
  street: { spacing: [9999, 9999], width: 0 },
  alleys: 0,
  alleyWidth: 0,
  height: { min: 60, max: 160, tallChance: 0.3, tallMax: 300 },
  lot: [24, 40],
  depth: [24, 34],
  walls: ["#b9a68e", "#8f8679", "#cbbca6"],
  roof: "#4a4642",
  trim: "#efe6d4",
  lit: 0.45,
  floor: 3.8,
  props: { fireEscape: 0, ac: 0.3, waterTower: 0.2, lanterns: 0, neon: 0, steam: 0, thermal: 0.5 },
  look: { sun: "#ffc06a", sky: "#f7c27f", fog: "#eec08c", fogDensity: 0.0016, grade: [1.08, 1.03, 0.88], neon: [] },
  park: true,
};

export const DISTRICTS: DistrictSpec[] = [CHINATOWN, FLATIRON, MIDTOWN, PARK];

export function districtAt(z: number): DistrictSpec {
  for (const d of DISTRICTS) if (z < d.z1) return d;
  return DISTRICTS[DISTRICTS.length - 1];
}

/** Hand-authored landmarks, layered on top of the generated city. */
export const LANDMARKS = {
  columbusPark: { x0: -205, x1: -20, z0: 70, z1: 185 },
  timesSquare: { x0: -240, x1: 0, z0: 2520, z1: 2760 },
  /** Billionaires' Row: a wall of needle towers along the south edge of the park. */
  billionairesRow: { z0: 3175, z1: 3240 },
  spire: { x: 250, z: 1980, w: 52, d: 46, h: 380 },
  /** Central Park spans these avenues; west and east of it the city goes on. */
  parkX: [-480, 480] as [number, number],
};
