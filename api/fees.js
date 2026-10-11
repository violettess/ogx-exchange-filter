// POST /api/fees  {ids: [...], mcId: 1539}  -> { fees: {id: value}, errors: [...], requested }
// Header: x-aiesec-token (falls back to AIESEC_TOKEN). Fee depends on the applicant's home MC.
import { fetchFees, serverToken } from '../lib/core.js';
import { sendJson as send, readJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  const body = await readJson(req, 300_000);
  if (!Array.isArray(body.ids) || body.ids.length > 3000) return send(res, 400, { error: 'Send up to 3000 project ids.' });
  const token = String(req.headers['x-aiesec-token'] || '').trim() || serverToken();
  try { send(res, 200, await fetchFees(token, body.ids, body.mcId)); }
  catch (e) { send(res, 400, { error: e.message }); }
}
