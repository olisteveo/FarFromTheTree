// GET  /api/scores          the fastest seeds: each name's best time, top 20
// POST /api/scores {run, name, ms}   enter a finish time for a run started with /api/run

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

export async function onRequestGet({ env }: Ctx) {
  const d = await db(env);
  const top = await d.prepare(
    "SELECT name, MIN(ms) AS ms, MIN(at) AS at FROM scores GROUP BY lower(name) ORDER BY ms ASC, at ASC LIMIT 20",
  ).all<{ name: string; ms: number; at: number }>();
  return json({ top: top.results });
}

export async function onRequestPost({ request, env }: Ctx) {
  let body: { run?: unknown; name?: unknown; ms?: unknown };
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = cleanName(body.name);
  if (!name) return json({ error: "Pick a name: 2 to 16 letters or numbers, nothing rude." }, 400);
  const ms = Number(body.ms);
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_AGE) return json({ error: "That time doesn't look right." }, 400);
  if (typeof body.run !== "string") return json({ error: "No run to enter." }, 400);
  const d = await db(env);
  const run = await d.prepare("SELECT started, used FROM runs WHERE id = ?").bind(body.run).first<{ started: number; used: number }>();
  const now = Date.now();
  if (!run || run.used) return json({ error: "That run's already been entered." }, 400);
  // the game clock can't run faster than the real one (a little slack for timers)
  if (now - run.started < ms * 0.97 - 2000 || now - run.started > MAX_AGE) return json({ error: "That time doesn't look right." }, 400);
  await d.batch([
    d.prepare("UPDATE runs SET used = 1 WHERE id = ?").bind(body.run),
    d.prepare("INSERT INTO scores (name, ms, at, run) VALUES (?, ?, ?, ?)").bind(name, Math.round(ms), now, body.run),
  ]);
  const better = await d.prepare("SELECT COUNT(*) AS n FROM (SELECT MIN(ms) AS ms FROM scores GROUP BY lower(name)) WHERE ms < ?").bind(Math.round(ms)).first<{ n: number }>();
  return json({ ok: true, name, rank: (better?.n ?? 0) + 1 });
}
