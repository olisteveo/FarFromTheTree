// The hero block: Mulberry St from Spring to Prince, the first street dressed as somewhere people live,
// and the test of how the rest of the route should look. Each building gets a household, which decides
// its balconies, window boxes and AC units together, so a wall reads as neighbours rather than dice rolls.
// Deterministic, so every run is the same. Pure data and rules: render/ draws what this decides.

export type BalconyVariant = "cafe" | "juliet" | "jungle" | "junk" | "rack" | "lights" | "wreath" | "rust";
export type Household = "family" | "oldtimer" | "students" | "gardener" | "landlord";

export interface HouseholdRule {
  /** the share of these buildings that have balconies at all (the rest live on their fire escapes) */
  hasBalconies: number;
  /** per floor, in a bay that can take one */
  balcony: number;
  variants: BalconyVariant[];
  windowbox: number;
  /** dead window boxes: late November, and not everyone cleared them */
  deadBox: number;
  ac: number;
  cat: number;
  /** per landing: what's kept on the fire escape */
  landing: number;
  landingPieces: string[];
}

export const HOUSEHOLDS: Record<Household, HouseholdRule> = {
  family: { hasBalconies: 0.5, balcony: 0.35, variants: ["cafe", "rack", "rack", "wreath"], windowbox: 0.08, deadBox: 0.3, ac: 0.18, cat: 0.012, landing: 0.5, landingPieces: ["fe_bike", "fe_plants", "fe_boxes"] },
  oldtimer: { hasBalconies: 0.35, balcony: 0.3, variants: ["wreath", "cafe", "juliet"], windowbox: 0.22, deadBox: 0.15, ac: 0.08, cat: 0.03, landing: 0.3, landingPieces: ["fe_plants", "fe_chair"] },
  students: { hasBalconies: 0.5, balcony: 0.45, variants: ["lights", "junk", "lights", "rack"], windowbox: 0.02, deadBox: 0.8, ac: 0.24, cat: 0.006, landing: 0.65, landingPieces: ["fe_chair", "fe_bike", "fe_boxes"] },
  gardener: { hasBalconies: 0.7, balcony: 0.55, variants: ["jungle", "jungle", "juliet"], windowbox: 0.4, deadBox: 0.25, ac: 0.05, cat: 0.02, landing: 0.8, landingPieces: ["fe_plants", "fe_plants", "fe_canes"] },
  landlord: { hasBalconies: 0.2, balcony: 0.25, variants: ["rust", "rust", "junk"], windowbox: 0, deadBox: 1, ac: 0.3, cat: 0.004, landing: 0.12, landingPieces: ["fe_boxes"] },
};

const STREET = { ax: -531, az: 2660, bx: -497, bz: 2821, reach: 46 };

/** Is this point on the hero block (within a building's depth of Mulberry St, Spring to Prince)? */
export function inHeroBlock(x: number, z: number): boolean {
  const dx = STREET.bx - STREET.ax, dz = STREET.bz - STREET.az;
  const t = Math.max(0, Math.min(1, ((x - STREET.ax) * dx + (z - STREET.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(STREET.ax + dx * t - x, STREET.az + dz * t - z) < STREET.reach;
}

const h01 = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; return (x >>> 0) / 4294967296; };

const MIX: [Household, number][] = [["family", 0.32], ["oldtimer", 0.24], ["students", 0.2], ["gardener", 0.12], ["landlord", 0.12]];
const DRESSED = new Set(["tenement", "brick", "prewar", "castiron"]);

/** The household of a building on the hero block, or null for the styles that don't get one (glass, modern...). */
export function householdOf(seed: number, style: string): HouseholdRule | null {
  if (!DRESSED.has(style)) return null;
  let r = h01(seed, 7121);
  for (const [name, share] of MIX) if ((r -= share) < 0) return HOUSEHOLDS[name];
  return HOUSEHOLDS.family;
}

export const pick = <T>(list: T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))];

// ------------------------------------------------------------------ the skate spot
// The parking lot on the corner of Prince and Mulberry (models/buildings_gaps.json) is a skate spot instead:
// a long strip along Prince St, with a graffiti wall at its back facing the street.

const LOT = { x: -527, z: 2879 };
/** Is this lot's centre the one the skate spot took over? */
export const isSkateLot = (cx: number, cz: number) => Math.abs(cx - LOT.x) < 3 && Math.abs(cz - LOT.z) < 3;

export const SKATE = {
  /** the pad, in world metres; Prince St runs along x here */
  x0: -558, x1: -504, z0: 2832, z1: 2845,
  wall: { x0: -553, x1: -507, z: 2844.6, h: 3.4 },
  quarters: [
    { x: -558, dir: 1, z0: 2833, z1: 2843.5, h: 1.7 },
    { x: -504, dir: -1, z0: 2833, z1: 2843.5, h: 1.2 },
  ],
};

/** The solid parts, in world/facades.ts' oriented-box terms (axis-aligned here: the wall direction is +x). */
export const SKATE_SOLIDS: { x: number; y: number; z: number; hw: number; hh: number; hd: number; label: string }[] = [
  { x: (SKATE.wall.x0 + SKATE.wall.x1) / 2, y: SKATE.wall.h / 2, z: SKATE.wall.z, hw: (SKATE.wall.x1 - SKATE.wall.x0) / 2, hh: SKATE.wall.h / 2, hd: 0.2, label: "a graffiti wall" },
  ...SKATE.quarters.map((q) => ({ x: q.x + q.dir * 1, y: q.h / 2, z: (q.z0 + q.z1) / 2, hw: 1, hh: q.h / 2, hd: (q.z1 - q.z0) / 2, label: "a quarter pipe" })),
];
