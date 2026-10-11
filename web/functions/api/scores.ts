// GET  /api/scores          the fastest seeds: each name's best time, top 20
// POST /api/scores {run, name, ms, durability?}   enter a finish time for a run started with
//      /api/run; durability is how much of the leaf was left (0 to 100). Time is the ranking.
// Works whether or not the scores table has its durability column yet (see _db.ts).

import { db, json, type Ctx } from "./_db";

/** The quickest finish we believe (the route is 8.8 km). */
const MIN_MS = 150_000;
/** A run's ticket lasts this long. */
const MAX_AGE = 3 * 3_600_000;
const BLOCK = ["fuck", "shit", "cunt", "nigg", "fag", "rape", "nazi", "hitler", "whore", "slut", "bitch", "dick", "cock", "pussy", "retard", "kike", "spic", "chink", "twat", "wank"];

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 16 || !/^[\p{L}\p{N} _.'-]+$/u.test(name)) return null;
  const flat = name.toLowerCase().replace(/[^a-z]/g, "").replace(/0/g, "o");
  if (BLOCK.some((w) => flat.includes(w))) return null;
  return name;
}

/** Durability as sent: missing is fine (null), a number is clamped to 0..100, anything else is refused. */
function cleanDurability(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

interface Row { name: string; ms: number; at: number; durability?: number | null }

export async function onRequestGet({ env }: Ctx) {
  const d = await db(env);
  try {
    // each name's best run, with that run's durability
    const top = await d.prepare(
      "SELECT name, ms, at, durability FROM (SELECT name, ms, at, durability, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY ms ASC, at ASC) AS k FROM scores) WHERE k = 1 ORDER BY ms ASC, at ASC LIMIT 20",
    ).all<Row>();
    return json({ top: top.results });
  } catch {
    // no durability column yet
    const top = await d.prepare(
      "SELECT name, MIN(ms) AS ms, MIN(at) AS at FROM scores GROUP BY lower(name) ORDER BY ms ASC, at ASC LIMIT 20",
    ).all<Row>();
    return json({ top: top.results });
  }
}

export async function onRequestPost({ request, env }: Ctx) {
  let body: { run?: unknown; name?: unknown; ms?: unknown; durability?: unknown };
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = cleanName(body.name);
  if (!name) return json({ error: "Pick a name: 2 to 16 letters or numbers, nothing rude." }, 400);
  const ms = Number(body.ms);
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_AGE) return json({ error: "That time doesn't look right." }, 400);
  if (typeof body.run !== "string") return json({ error: "No run to enter." }, 400);
  const durability = cleanDurability(body.durability);
  if (durability === undefined) return json({ error: "That leaf doesn't look right." }, 400);
  const d = await db(env);
  const run = await d.prepare("SELECT started, used FROM runs WHERE id = ?").bind(body.run).first<{ started: number; used: number }>();
  const now = Date.now();
  if (!run || run.used) return json({ error: "That run's already been entered." }, 400);
  // the game clock can't run faster than the real one (a little slack for timers)
  if (now - run.started < ms * 0.97 - 2000 || now - run.started > MAX_AGE) return json({ error: "That time doesn't look right." }, 400);
  // (a batch is one transaction, so if the durability column isn't there yet nothing's
  // written and the plain insert runs instead)
  try {
    await d.batch([
      d.prepare("UPDATE runs SET used = 1 WHERE id = ?").bind(body.run),
      d.prepare("INSERT INTO scores (name, ms, at, run, durability) VALUES (?, ?, ?, ?, ?)").bind(name, Math.round(ms), now, body.run, durability),
    ]);
  } catch {
    await d.batch([
      d.prepare("UPDATE runs SET used = 1 WHERE id = ?").bind(body.run),
      d.prepare("INSERT INTO scores (name, ms, at, run) VALUES (?, ?, ?, ?)").bind(name, Math.round(ms), now, body.run),
    ]);
  }
  const better = await d.prepare("SELECT COUNT(*) AS n FROM (SELECT MIN(ms) AS ms FROM scores GROUP BY lower(name)) WHERE ms < ?").bind(Math.round(ms)).first<{ n: number }>();
  return json({ ok: true, name, rank: (better?.n ?? 0) + 1, durability });
}
