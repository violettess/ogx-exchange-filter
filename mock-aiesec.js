// Fake AIESEC GraphQL API for demo mode (ids and links are NOT real).
import http from 'node:http';

const countries = ['Indonesia', 'Vietnam', 'Kenya', 'Egypt', 'Brazil', 'Turkey', 'India', 'Sri Lanka', 'Morocco', 'Poland'];
const lcs = ['Hanoi', 'Ho Chi Minh', 'Nairobi', 'Cairo', 'Sao Paulo', 'Istanbul', 'Delhi', 'Colombo', 'Rabat', 'Warsaw'];
const sdgs = [[3, 'Good Health And Well Being', '3.4'], [4, 'Quality Education', '4.7'], [8, 'Decent Work And Economic Growth', '8.9'], [13, 'Climate Action', '13.3']];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const art = (i) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="552" height="312"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${(i * 47) % 360},55%,55%)"/><stop offset="1" stop-color="hsl(${(i * 47 + 60) % 360},60%,35%)"/></linearGradient></defs><rect width="552" height="312" fill="url(#g)"/></svg>`);

const projects = Array.from({ length: 140 }, (_, i) => {
  const id = 1340000 + i * 31;
  const prog = i % 4 === 3 ? 8 : 7;
  const slots = Array.from({ length: 1 + Math.floor(rnd() * 7) }, (_, j) => {
    const start = addDays('2026-09-15', Math.floor(rnd() * 150));
    const len = [14, 28, 42, 42, 56, 84, 120][Math.floor(rnd() * 7)];
    return { id: id * 100 + j, start_date: start, end_date: addDays(start, len),
      applications_close_date: addDays(start, -10), available_openings: Math.floor(rnd() * 5), status: 'open' };
  });
  const s = sdgs[i % sdgs.length];
  return {
    id: String(id),
    title: ['Heartbeat', 'On the Map', 'Global Classroom', 'Coastal Cleanup', 'Digital Literacy', 'Wildlife Care', 'Refugee Support'][i % 7] + ` [${[4, 6, 8][i % 3]} weeks]`,
    location: 'Demo City, ' + countries[i % countries.length],
    description: 'Global Volunteers will be involved in community outreach by creating and running activities that raise awareness and build the capacity of the local community. This is demo text.',
    applicants_count: Math.floor(rnd() * 12), cover_photo: process.env.MOCK_OBJECT_COVERS === '1' ? { url: art(i), width: 552, height: 312 } : process.env.MOCK_PROTECTED_IMAGES === '1' ? `http://127.0.0.1:4012/img/${i}.svg` : art(i),
    programme: { id: String(prog), short_name_display: prog === 7 ? 'Global Volunteer' : 'Global Talent' },
    branch: { company: { name: 'Partner Organisation ' + (i % 11) } },
    host_lc: { id: String(500 + (i % 10)), name: lcs[i % 10].toUpperCase(), full_name: 'AIESEC in ' + lcs[i % 10], address_detail: { country: countries[i % countries.length] } },
    fee: { fee: 100 + (i % 5) * 50, currency: 'USD', health_insurance: i % 2 ? 'Included' : 'Not included' },
    opportunity_duration_type: { id: '1', duration_type: [4, 6, 8][i % 3] + ' Weeks' },
    sdg_info: { id: '1', sdg_target: { description: '', goal_index: s[0], id: '1', target_id: s[2], parent: { id: '1', name: s[1], short_name: s[1] } } },
    slots, prog,
  };
});

import http2 from 'node:http';
const protectedImages = process.env.MOCK_PROTECTED_IMAGES === '1';
if (protectedImages) {
  http2.createServer((req, res) => {
    if (req.headers.referer !== 'https://aiesec.org/') { res.writeHead(403); return res.end('hotlink blocked'); }
    const i = Number((req.url.match(/(\d+)/) || [0, 1])[1]);
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end(decodeURIComponent(art(i).split(',')[1]));
  }).listen(4012);
}
export function startMock(port) {
  return new Promise(resolve => {
    http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const { variables, query } = JSON.parse(body); const bad = String(req.headers.authorization).startsWith('bad');
        res.setHeader('content-type', 'application/json');
        const prog = variables.filters?.programmes?.[0] ?? 7;
        if (query.includes('SlotFinderList')) {
          const { page, per_page } = variables;
          const from = variables.filters.earliest_start_date?.from || '0000';
          const pool = bad ? [] : projects.filter(p => p.prog === prog && p.slots.some(s => s.start_date >= from));
          const hostBlock = (query.match(/host_lc \{([^}]*)address_detail/) || [, ''])[1];
          const errs = [];
          if (process.env.MOCK_NO_FULLNAME && /full_name/.test(hostBlock)) errs.push({ message: "Field 'full_name' doesn't exist on type 'Committee'" });
          if (process.env.MOCK_NO_LCNAMES && /\bname\b/.test(hostBlock)) errs.push({ message: "Field 'name' doesn't exist on type 'Committee'" });
          if (process.env.MOCK_NO_LCNAMES && /full_name/.test(hostBlock)) errs.push({ message: "Field 'full_name' doesn't exist on type 'Committee'" });
          if (errs.length) return res.end(JSON.stringify({ errors: errs }));
          if (query.includes('available_slots') && process.env.MOCK_REJECT_SLOTS_IN_LIST) return res.end(JSON.stringify({ errors: [{ message: 'Field available_slots not allowed here' }] }));
          const wantSlots = query.includes('available_slots');
          const pageData = pool.slice((page - 1) * per_page, page * per_page).map(p => {
            const o = { ...p }; delete o.fee;
            o.host_lc = { id: p.host_lc.id, address_detail: p.host_lc.address_detail };
            if (/host_lc \{[^}]*full_name/.test(query)) o.host_lc.full_name = p.host_lc.full_name;
            if (/host_lc \{[^}]*\bname\b/.test(query)) o.host_lc.name = p.host_lc.name;
            if (wantSlots) o.available_slots = process.env.MOCK_EMPTY_LIST_SLOTS ? [] : p.slots;
            return o;
          });
          res.end(JSON.stringify({ data: { opportunities: { data: pageData,
            paging: { total_items: pool.length, total_pages: Math.ceil(pool.length / per_page), current_page: page } } } }));
        } else if (query.includes('SlotFinderPing')) {
          res.end(JSON.stringify({ data: { opportunities: { paging: { total_items: bad ? 0 : projects.length } } } }));
        } else if (query.includes('SlotFinderFees')) {
          if (process.env.MOCK_NO_FEES) return res.end(JSON.stringify({ errors: [{ message: "Field 'fee_and_health_insurance' doesn't exist on type 'Opportunity'" }] }));
          const data = {};
          for (const [, id] of query.matchAll(/o(\d+): opportunity\(id: "(\d+)"\)/g)) { const p = projects.find(x => x.id === id); data['o' + id] = p ? { id, fee_and_health_insurance: p.fee } : null; }
          res.end(JSON.stringify({ data }));
        } else if (!query.includes('SlotFinderDetail')) {
          res.end(JSON.stringify({ errors: [{ message: 'unsupported in mock' }] }));
        } else {
          const p = projects.find(x => x.id === variables.id);
          setTimeout(() => res.end(JSON.stringify({ data: { opportunity: { id: p.id, available_slots: p.slots } } })), 40);
        }
      });
    }).listen(port, () => resolve(`http://localhost:${port}/graphql`));
  });
}
