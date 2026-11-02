// The buildings you'd know anywhere. The open data has each as one extruded block; here they get their real massing,
// fitted to the data's footprint in the game's grid (x across, east is -x; z up the avenues). These boxes are what the
// leaf hits and lands on, and render/iconicTowers.ts draws its detail on the same numbers.

export interface Tier { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; what?: string }

export interface Icon {
  id: string;
  name: string;
  /** the data footprints this replaces, by centroid: drawn by the model, and solid only as its tiers */
  replaces: [number, number][];
  tiers: Tier[];
  /** how many of the last tiers count as landing on it (the achievements) */
  land: number;
  /** top of everything, for the draught up its side */
  top: number;
  /** a draught you can ride up it, on the walls of the first tier */
  draught: boolean;
}

/** A box about a centre, half widths in x and z. */
const about = (x: number, z: number, hx: number, hz: number, y0: number, y1: number, what?: string): Tier => ({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0, y1, what });

// ---------------------------------------------------------------- the Empire State: setbacks and the mooring mast
const ES = { x: 115.5, z: 5668 };
const empire: Icon = {
  id: "empire", name: "the top of the Empire State", replaces: [[149, 5665]], top: 402, land: 3, draught: true,
  tiers: [
    about(ES.x, ES.z, 74, 29, 0, 26), about(ES.x, ES.z, 60, 27, 26, 74), about(ES.x, ES.z, 47, 25, 74, 102),
    about(ES.x, ES.z, 36, 23, 102, 268), about(ES.x, ES.z, 42, 13, 102, 232), // the shaft, and its stepped wings
    about(ES.x, ES.z, 27, 18, 268, 306), about(ES.x, ES.z, 20, 14, 306, 336), about(ES.x, ES.z, 14, 10.5, 336, 360),
    about(ES.x, ES.z, 10.5, 8, 360, 378), about(ES.x, ES.z, 5.5, 5.5, 378, 402, "the mooring mast"), about(ES.x, ES.z, 1, 1, 402, 445, "the Empire State's antenna"),
  ],
};

// ---------------------------------------------------------------- the Woolworth: a gothic tower on a broad base, in cream terracotta
const WW = { x: -149, z: 1244 };
const woolworth: Icon = {
  id: "woolworth", name: "the Woolworth Building", replaces: [[-141, 1245]], top: 241, land: 2, draught: true,
  tiers: [
    { x0: -179, x1: -119, z0: 1221, z1: 1267, y0: 0, y1: 112 },
    { x0: -152, x1: -122, z0: WW.z - 13, z1: WW.z + 13, y0: 112, y1: 176 }, { x0: -149.5, x1: -124.5, z0: WW.z - 11, z1: WW.z + 11, y0: 176, y1: 204 },
    { x0: -146.5, x1: -127.5, z0: WW.z - 8.5, z1: WW.z + 8.5, y0: 204, y1: 222 }, { x0: -143, x1: -131, z0: WW.z - 5.5, z1: WW.z + 5.5, y0: 222, y1: 236 },
    { x0: -138.5, x1: -135.5, z0: WW.z - 1.5, z1: WW.z + 1.5, y0: 236, y1: 241, what: "the Woolworth's lantern" },
  ],
};

// ---------------------------------------------------------------- the Municipal Building: the wedding cake over Centre St
const MU = { x: -467, z: 1486.5 };
const municipal: Icon = {
  id: "municipal", name: "the Municipal Building", replaces: [[-473, 1486]], top: 177, land: 3, draught: true,
  tiers: [
    about(MU.x, MU.z, 31, 60.5, 0, 118), about(MU.x, MU.z, 21, 21, 118, 136), about(MU.x, MU.z, 12, 12, 136, 154),
    about(MU.x, MU.z, 7, 7, 154, 166), about(MU.x, MU.z, 1.2, 1.2, 166, 177, "Civic Fame"),
  ],
};

// ---------------------------------------------------------------- the Met Life Tower: a Venetian campanile on Madison Square
const ML = { x: -154, z: 4902 };
const metlife: Icon = {
  id: "metlife", name: "the Met Life Tower", replaces: [[-154, 4902]], top: 213, land: 3, draught: true,
  tiers: [about(ML.x, ML.z, 13, 11, 0, 168), about(ML.x, ML.z, 11, 9, 168, 182), about(ML.x, ML.z, 7.5, 6, 182, 194), about(ML.x, ML.z, 4, 3.2, 194, 204), about(ML.x, ML.z, 1.8, 1.8, 204, 213, "the Met Life cupola")],
};

// ---------------------------------------------------------------- One Times Square: where the ball drops
const TS = { x: 584.5, z: 6390.5 };
const oneTimes: Icon = {
  id: "onetimes", name: "One Times Square", replaces: [[589, 6389]], top: 123, land: 2, draught: true,
  tiers: [about(TS.x, TS.z, 9.5, 21.5, 0, 106), about(TS.x, TS.z, 4, 4, 106, 111), about(TS.x, TS.z, 0.5, 0.5, 111, 123, "the ball's mast")],
};

// ---------------------------------------------------------------- Trinity Church: brownstone at the head of Wall St, the steeple to Broadway
const TR = { z: 654.5 };
const trinity: Icon = {
  id: "trinity", name: "Trinity Church", replaces: [[-99, 657]], top: 86, land: 2, draught: false,
  tiers: [
    { x0: -134, x1: -84, z0: TR.z - 13, z1: TR.z + 13, y0: 0, y1: 12, what: "Trinity Church" },
    { x0: -134, x1: -84, z0: TR.z - 8, z1: TR.z + 8, y0: 12, y1: 19, what: "Trinity Church" },
    { x0: -134, x1: -84, z0: TR.z - 4, z1: TR.z + 4, y0: 19, y1: 26, what: "Trinity Church" },
    { x0: -84, x1: -70, z0: TR.z - 7, z1: TR.z + 7, y0: 0, y1: 44, what: "Trinity's tower" },
    { x0: -80.5, x1: -73.5, z0: TR.z - 3.5, z1: TR.z + 3.5, y0: 44, y1: 62, what: "Trinity's steeple" }, { x0: -78.5, x1: -75.5, z0: TR.z - 1.5, z1: TR.z + 1.5, y0: 62, y1: 84, what: "Trinity's steeple" },
  ],
};

// ---------------------------------------------------------------- the Stock Exchange: a temple front to Broad St
const NY = { z: 587 };
const nyse: Icon = {
  id: "nyse", name: "the New York Stock Exchange", replaces: [[-229, 581]], top: 47, land: 2, draught: false,
  tiers: [
    { x0: -246, x1: -206, z0: 566, z1: 608, y0: 0, y1: 9 }, { x0: -252, x1: -246, z0: 566, z1: 608, y0: 0, y1: 5 },
    ...[-15, -9, -3, 3, 9, 15].map((o) => ({ x0: -251.2, x1: -248.8, z0: NY.z + o - 1.2, z1: NY.z + o + 1.2, y0: 5, y1: 28, what: "a Stock Exchange column" })),
    { x0: -246, x1: -206, z0: 566, z1: 608, y0: 9, y1: 28 }, { x0: -252, x1: -206, z0: 566, z1: 608, y0: 28, y1: 34 },
    { x0: -252, x1: -206, z0: NY.z - 11, z1: NY.z + 11, y0: 34, y1: 40 }, { x0: -252, x1: -206, z0: 566, z1: 608, y0: 34, y1: 36 },
  ],
};

// ---------------------------------------------------------------- the Hearst Tower: a glass diagrid out of a 1920s stone base
const HE = { x: 927.5, z: 7513.5 };
const hearst: Icon = {
  id: "hearst", name: "the Hearst Tower", replaces: [[920, 7506]], top: 182, land: 1, draught: true,
  tiers: [about(HE.x, HE.z, 29.5, 30.5, 0, 32), about(HE.x, HE.z, 20, 22, 32, 182)],
};

export const ICONS: Icon[] = [trinity, nyse, woolworth, municipal, metlife, empire, oneTimes, hearst];

/** Far off the corridor but on the skyline from everywhere. Nothing lands on these: no tiers. */
export const SKYLINE = { chrysler: { x: -477, z: 6390 }, oneWtc: { x: 238, z: 1061 } };

/** The Flatiron keeps its data footprint for a collider (it's the shape it should be); only its drawing is modelled. */
export const FLATIRON = { x: 5, z: 4792 };

const near = (x: number, z: number, p: [number, number]) => Math.hypot(x - p[0], z - p[1]) < 4;
/** Is the data's building with this centroid replaced by an icon's tiers? */
export function replacedByIcon(cx: number, cz: number): boolean {
  return ICONS.some((i) => i.replaces.some((p) => near(cx, cz, p)));
}
