export const sendJson = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
export async function readJson(req, limit = 10_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  let b = ''; for await (const c of req) { b += c; if (b.length > limit) return {}; }
  try { return JSON.parse(b); } catch { return {}; }
}
