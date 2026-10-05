// Cloudflare Pages Function: /api/progress
// Stores one JSON progress blob per save key. The key itself is never stored,
// only a SHA-256 hash of it. No names, emails or passwords are collected.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BYTES = 200000;
const FIELDS = ['revised', 'cards', 'quiz', 'essay', 'past', 'drafts'];
let ready = null;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
function norm(k) { return String(k || '').toUpperCase().replace(/[\s-]/g, ''); }
function valid(k) { return k.length === 16 && [...k].every((c) => ALPHA.includes(c)); }
async function hashKey(k) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('psy-hub:' + k));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function start(request, env) {
  if (!env.DB) return { err: json({ error: 'nodb' }, 503) };
  if (!ready) {
    ready = env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, created INTEGER NOT NULL)'
    ).run().catch((e) => { ready = null; throw e; });
  }
  await ready;
  const k = norm(request.headers.get('x-save-key'));
  if (!valid(k)) return { err: json({ error: 'badkey' }, 400) };
  return { id: await hashKey(k) };
}
function clean(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  for (const f of FIELDS) {
    const v = data[f];
    out[f] = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  const w = await start(request, env); if (w.err) return w.err;
  const r = await env.DB.prepare('SELECT data, updated FROM accounts WHERE id = ?').bind(w.id).first();
  if (!r) return json({ error: 'notfound' }, 404);
  return json({ data: JSON.parse(r.data), updated: r.updated });
}
export async function onRequestPost({ request, env }) {
  const w = await start(request, env); if (w.err) return w.err;
  const now = Date.now();
  const r = await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, data, updated, created) VALUES (?, ?, ?, ?)')
    .bind(w.id, '{}', 0, now).run();
  if (!r.meta || r.meta.changes === 0) return json({ error: 'exists' }, 409);
  return json({ ok: true });
}
export async function onRequestPut({ request, env }) {
  const w = await start(request, env); if (w.err) return w.err;
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: 'toobig' }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'badjson' }, 400); }
  const data = clean(body && body.data);
  if (!data) return json({ error: 'baddata' }, 400);
  const now = Date.now();
  const r = await env.DB.prepare('UPDATE accounts SET data = ?, updated = ? WHERE id = ?')
    .bind(JSON.stringify(data), now, w.id).run();
  if (!r.meta || r.meta.changes === 0) return json({ error: 'notfound' }, 404);
  return json({ ok: true, updated: now });
}
export async function onRequestDelete({ request, env }) {
  const w = await start(request, env); if (w.err) return w.err;
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(w.id).run();
  return json({ ok: true });
}
