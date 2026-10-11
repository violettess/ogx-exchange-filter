// GET /api/img?u=<https image url>
// Fetches a project photo server-side with aiesec.org as the referrer, for CDNs that refuse other sites.
// Guards: https only, no private/internal hosts, redirects re-checked, images only, 5 MB cap,
// browser cross-site requests refused, optional IMAGE_HOSTS allow-list (comma separated domains).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MAX = 5_000_000;

export function checkTarget(raw) {
  let u; try { u = new URL(raw); } catch { return 'Not a valid URL'; }
  const unsafe = process.env.IMG_PROXY_UNSAFE_LOCAL === '1'; // for local tests only
  if (u.protocol !== 'https:' && !(unsafe && u.protocol === 'http:')) return 'Only https URLs are allowed';
  const h = u.hostname.toLowerCase();
  if (!unsafe) {
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return 'Host not allowed';
    if (h.includes(':') || h.startsWith('[')) return 'IP addresses are not allowed';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return 'IP addresses are not allowed';
  }
  const allow = (process.env.IMAGE_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some(a => h === a || h.endsWith('.' + a))) return 'Host not in IMAGE_HOSTS';
  return null;
}

export default async function handler(req, res) {
  const fail = (code, msg) => { res.statusCode = code; res.setHeader('content-type', 'text/plain'); res.end(msg); };
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) return fail(403, 'Cross-site use is not allowed');
  let target = new URL(req.url, 'http://x').searchParams.get('u') || '';
  try {
    for (let hop = 0; hop < 4; hop++) {
      const bad = checkTarget(target); if (bad) return fail(400, bad);
      const r = await fetch(target, {
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { referer: 'https://aiesec.org/', origin: 'https://aiesec.org', 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { target = new URL(r.headers.get('location'), target).href; continue; }
      if (!r.ok) return fail(502, `Image host answered HTTP ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return fail(415, 'Not an image');
      if (Number(r.headers.get('content-length') || 0) > MAX) return fail(413, 'Image too large');
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX) return fail(413, 'Image too large');
      res.statusCode = 200;
      res.setHeader('content-type', ct);
      res.setHeader('cache-control', 'public, max-age=86400, s-maxage=86400');
      return res.end(buf);
    }
    return fail(508, 'Too many redirects');
  } catch (e) { return fail(502, 'Could not fetch the image'); }
}
