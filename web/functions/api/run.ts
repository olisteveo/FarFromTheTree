// POST /api/run: a run has started (the leaf let go of the tree). Returns a run id. The
// server notes when, so a finish time can't be faster than the real time that passed.

import { db, ipOf, json, type Ctx } from "./_db";

export async function onRequestPost({ request, env }: Ctx) {
  const d = await db(env);
  const ip = ipOf(request), now = Date.now();
  const recent = await d.prepare("SELECT COUNT(*) AS n FROM runs WHERE ip = ? AND started > ?").bind(ip, now - 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) > 20) return json({ error: "slow down" }, 429);
  const id = crypto.randomUUID();
  await d.prepare("INSERT INTO runs (id, started, ip) VALUES (?, ?, ?)").bind(id, now, ip).run();
  // tidy away old runs now and then
  if (Math.random() < 0.02) await d.prepare("DELETE FROM runs WHERE started < ?").bind(now - 2 * 86_400_000).run();
  return json({ id });
}
