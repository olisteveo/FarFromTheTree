// The traffic lights' plan: one timing for the lamps (render/streetFurniture.ts, in a shader), the cars (world/traffic.ts)
// and the people crossing (world/crowd.ts). Every signalled junction has two phases: group 0 is the main street through
// it and gets the longer green, group 1 the side street. Between them, amber, then a moment of all-red to clear the box.

export const SIGNAL = {
  cycle: 64,
  /** green seconds for each group */
  green: [36, 18] as const,
  amber: 3,
  allRed: 2,
  /** WALK seconds while each group has its green: the people cross the *other* street */
  walk: [24, 9] as const,
  /** how long a driver at the front of the queue takes to get going */
  reaction: 1,
};
/** when in the cycle each group's green starts */
export const GREEN_AT = [0, SIGNAL.green[0] + SIGNAL.amber + SIGNAL.allRed] as const;

const inCycle = (t: number) => ((t % SIGNAL.cycle) + SIGNAL.cycle) % SIGNAL.cycle;

/** Seconds since this group's green started (runs on through amber and red until the next). */
export const sinceGreen = (t: number, group: number, offset: number) => inCycle(t + offset - GREEN_AT[group]);

/** What a signal shows at time t: 2 green, 1 amber, 0 red; for the people crossing a street of this group, 2 WALK, 1 flashing hand, 0 hand. */
export function signalState(t: number, group: number, offset: number): { vehicle: 0 | 1 | 2; walk: 0 | 1 | 2 } {
  const g = sinceGreen(t, group, offset), G = SIGNAL.green[group];
  const vehicle = g < G ? 2 : g < G + SIGNAL.amber ? 1 : 0;
  const other = 1 - group, o = sinceGreen(t, other, offset);
  const walk = o < SIGNAL.walk[other] ? 2 : o < SIGNAL.green[other] + SIGNAL.amber ? 1 : 0;
  return { vehicle: vehicle as 0 | 1 | 2, walk: walk as 0 | 1 | 2 };
}

/** Seconds until the WALK comes on across a street of this group (0 if it's on now). */
export function untilWalk(t: number, group: number, offset: number): number {
  const other = 1 - group, o = sinceGreen(t, other, offset);
  return o < SIGNAL.walk[other] ? 0 : SIGNAL.cycle - o;
}

/** A signalled junction: where it is, its timing, the main street's direction, and the approaches that have heads. */
export interface SignalNode { x: number; z: number; offset: number; refX: number; refZ: number; heads: { vx: number; vz: number; group: number }[] }
