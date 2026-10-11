// Shared bits for the leaderboard API (Cloudflare Pages Functions + a D1 database bound
// as DB). The tables make themselves on first use, so a fresh database needs no setup.

export interface D1Result<T> { results: T[] }
export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
export interface Env { DB: D1 }
export interface Ctx { request: Request; env: Env }

let ready = false;
export async function db(env: Env): Promise<D1> {
  if (!env.DB) throw new Error("no DB binding");
  if (!ready) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started INTEGER NOT NULL, ip TEXT, used INTEGER NOT NULL DEFAULT 0)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS runs_ip ON runs (ip, started)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ms INTEGER NOT NULL, at INTEGER NOT NULL, run TEXT UNIQUE)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS scores_ms ON scores (ms)"),
    ]);
    // durability (how much of the leaf was left at the finish, 0 to 100) came later: add the
    // column to databases made before it (migrations/0001_scores_durability.sql does the same).
    // It fails harmlessly when the column's already there.
    try { await env.DB.prepare("ALTER TABLE scores ADD COLUMN durability INTEGER").run(); } catch { /* already there */ }
    ready = true;
  }
  return env.DB;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const ipOf = (r: Request) => r.headers.get("cf-connecting-ip") ?? "?";
