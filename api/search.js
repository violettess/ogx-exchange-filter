// GET /api/search?from=YYYY-MM-DD&to=YYYY-MM-DD&programme=7&openOnly=1
// Header: x-aiesec-token (falls back to the AIESEC_TOKEN environment variable)
// Streams newline-delimited JSON events.
import { search, PROGRAMMES, serverToken } from '../lib/core.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const from = q.get('from') || '', to = q.get('to') || '';
  const programme = Number(q.get('programme') || 7);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(from) || !iso.test(to) || from > to || !PROGRAMMES[programme]) {
    res.statusCode = 400; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Provide valid from/to dates (from <= to) and a supported programme.' }));
  }
  const token = String(req.headers['x-aiesec-token'] || '').trim() || serverToken();

  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-store, no-transform');
  res.setHeader('x-accel-buffering', 'no');
  let closed = false;
  res.on('close', () => { closed = true; });
  const send = obj => { if (!closed) res.write(JSON.stringify(obj) + '\n'); };
  try { await search(token, { from, to, programme, openOnly: q.get('openOnly') === '1' }, send, () => closed); }
  catch (e) { send({ type: 'error', message: e.message }); }
  closed = true;
  res.end();
}
