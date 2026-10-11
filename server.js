// Local server (Node 18+). On Vercel, public/ and api/ are deployed directly and this file is not used.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { // minimal .env loader
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

if (process.argv.includes('--demo')) {
  const { startMock } = await import('./mock-aiesec.js');
  process.env.AIESEC_ENDPOINT = await startMock(4010);
  process.env.AIESEC_TOKEN = process.env.DEMO_TOKEN || 'demo';
  process.env.DEMO = '1';
  console.log('DEMO MODE: fake data, links will not exist on aiesec.org');
}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const search = (await import('./api/search.js')).default;
const token = (await import('./api/token.js')).default;
const img = (await import('./api/img.js')).default;

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/search') return search(req, res);
  if (pathname === '/api/token') return token(req, res);
  if (pathname === '/api/img') return img(req, res);
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, HOST, () => console.log(`Slot Finder running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
