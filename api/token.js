// GET  /api/token            -> { hasServerToken, demo }
// POST /api/token {token}    -> checks the token against AIESEC and says how much it can see
import { countVisible, serverToken, TOKEN_RE } from '../lib/core.js';

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let b = ''; for await (const c of req) { b += c; if (b.length > 10_000) return {}; }
  try { return JSON.parse(b); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { hasServerToken: !!serverToken(), demo: process.env.DEMO === '1' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  const token = String((await readJson(req)).token || '').trim().replace(/^Bearer\s+/i, '');
  if (!TOKEN_RE.test(token)) return send(res, 400, { error: 'That does not look like a token.' });
  let total;
  try { total = await countVisible(token); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!total) return send(res, 400, { error: 'AIESEC accepted this token but reports 0 opportunities, so it is probably not the token the search API uses. Paste the value of the "authorization" header from a gis-api.aiesec.org/graphql request on aiesec.org/search instead.' });
  send(res, 200, { ok: true, total });
}
