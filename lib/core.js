// Shared logic: talks to AIESEC's GraphQL API and finds slots that fit a date window.
// Used by both the Vercel functions (api/*.js) and the local server (server.js).

const cfg = () => ({
  PER_PAGE: Number(process.env.PER_PAGE || 50),
  CONCURRENCY: Number(process.env.CONCURRENCY || 6),
  LIST_CONCURRENCY: Number(process.env.LIST_CONCURRENCY || 4),
  CACHE_MS: Number(process.env.CACHE_MINUTES || 30) * 60_000,
  EXCLUDE_HOME_MC: Number(process.env.EXCLUDE_HOME_MC || 0),
  MAX_PAGES: Number(process.env.MAX_PAGES || 200),
});
export const endpoint = () => process.env.AIESEC_ENDPOINT || 'https://gis-api.aiesec.org/graphql';
export const serverToken = () => process.env.AIESEC_TOKEN || '';

// Programme ids as used by aiesec.org's own search (legacy EXPA used 1 / 2).
export const PROGRAMMES = {
  7: { name: 'Global Volunteer', slug: 'global-volunteer' },
  8: { name: 'Global Talent', slug: 'global-talent' },
};

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
export const TOKEN_RE = /^[A-Za-z0-9._~+\/=-]{16,300}$/;

const listQuery = withSlots => `
query SlotFinderList($page: Int, $per_page: Int, $filters: OpportunityFilter, $cdn_region: String, $cover_photo_size: String) {
  opportunities(filters: $filters, pagination: {page: $page, per_page: $per_page}) {
    data {
      id title project_name location description applicants_count
      cover_photo(cdn_region: $cdn_region, size: $cover_photo_size)
      programme { id short_name_display }
      branch { company { name } }
      host_lc { id address_detail { country } }
      opportunity_duration_type { id duration_type }
      sdg_info { id sdg_target { description goal_index id target_id parent { id name short_name } } }
      ${withSlots ? 'available_slots { id applications_close_date available_openings end_date start_date status }' : ''}
    }
    paging { total_items total_pages current_page }
  }
}`;
const DETAIL_QUERY = `
query SlotFinderDetail($id: ID) {
  opportunity(id: $id) {
    id
    available_slots { id applications_close_date available_openings end_date start_date status }
  }
}`;
const PING_QUERY = `
query SlotFinderPing($filters: OpportunityFilter) { opportunities(filters: $filters) { paging { total_items } } }`;

const REJECTED = 'AIESEC rejected the token (it may have expired). Click "Connect to AIESEC" to refresh it.';

export async function gql(token, operationName, query, variables) {
  if (!token) throw new Error('Not connected: click "Connect to AIESEC" and add your token.');
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: '*/*', authorization: token,
      origin: 'https://aiesec.org', referer: 'https://aiesec.org/', 'user-agent': UA,
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  if (res.status === 401 || res.status === 403) throw new Error(REJECTED);
  if (!res.ok) throw new Error(`AIESEC API returned HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors[0].message || '';
    if (/auth|token|unauthor|forbidden/i.test(msg)) throw new Error(REJECTED);
    throw new Error('AIESEC API: ' + msg);
  }
  return json.data;
}

async function retry(fn, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { err = e; if (/rejected the token|Not connected/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw err;
}

// Returns how many Global Volunteer opportunities this token can see.
export async function countVisible(token) {
  const d = await gql(token, 'SlotFinderPing', PING_QUERY, { filters: { programmes: [7] } });
  return d.opportunities.paging.total_items;
}

const slotCache = new Map(); // only used by the per-project fallback
async function getSlots(token, id, c) {
  const hit = slotCache.get(id);
  if (hit && Date.now() - hit.at < c.CACHE_MS) return hit.slots;
  const data = await retry(() => gql(token, 'SlotFinderDetail', DETAIL_QUERY, { id: String(id) }));
  const slots = data?.opportunity?.available_slots || [];
  slotCache.set(id, { at: Date.now(), slots });
  return slots;
}

const day = s => (s ? String(s).slice(0, 10) : null);

export function classifySlot(slot, from, to, openOnly, today) {
  const start = day(slot.start_date), end = day(slot.end_date), close = day(slot.applications_close_date);
  const closed = !!((close && close < today) || slot.available_openings === 0);
  const out = { id: slot.id, start, end, close, openings: slot.available_openings ?? null, closed, match: false, reason: null };
  if (!start || !end) out.reason = 'No dates';
  else if (start < from) out.reason = 'Starts before your start date';
  else if (end > to) out.reason = 'Ends after your deadline';
  else if (openOnly && closed) out.reason = 'Applications closed';
  else out.match = true;
  return out;
}

async function pool(items, n, isAborted, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !isAborted()) await fn(items[i++]);
  }));
}

// Streams events through send(): list, scan, project, done. Throws on fatal errors.
export async function search(token, params, send, isAborted) {
  const c = cfg();
  const { from, to, programme, openOnly } = params;
  const today = new Date().toISOString().slice(0, 10);
  const prog = PROGRAMMES[programme];
  const filters = {
    q: null, sort: 'created_at', sort_direction: 'desc', programmes: [programme],
    // Same default as aiesec.org ("starting from today"). Deliberately not the user's start date:
    // the site's filter looks at a project's earliest slot, which could hide a later slot that fits.
    earliest_start_date: { from: today },
  };
  if (c.EXCLUDE_HOME_MC) filters.exclude_home_mcs = [c.EXCLUDE_HOME_MC];

  const stats = { projects: 0, slots: 0, noSlotData: 0, failed: 0, firstError: null, sample: null,
    reasons: {}, minLen: null, slotsFromList: true, probe: null, dateFilterDropped: false, noCover: 0, coverSample: null,
    token: `${token.slice(0, 4)}…${token.slice(-4)} (${token.length} characters)` };
  const seen = new Set(), pending = [];
  let matched = 0, examined = 0, totalItems = 0, withSlots = true;

  const emit = (o, rawSlots, idx) => {
    const slots = rawSlots.map(sl => classifySlot(sl, from, to, openOnly, today));
    stats.slots += slots.length;
    if (!stats.sample && rawSlots.length) stats.sample = { project: o.id, slots: rawSlots.slice(0, 2) };
    for (const sl of slots) {
      const k = sl.match ? 'fit' : sl.reason; stats.reasons[k] = (stats.reasons[k] || 0) + 1;
      if (sl.start && sl.end) { const n = Math.round((Date.parse(sl.end) - Date.parse(sl.start)) / 864e5); if (stats.minLen == null || n < stats.minLen) stats.minLen = n; }
    }
    if (!rawSlots.length) stats.noSlotData++;
    const matchCount = slots.filter(x => x.match).length;
    if (!matchCount) return;
    matched++;
    slots.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const t = o.sdg_info?.sdg_target;
    send({ type: 'project', project: {
      id: o.id, order: idx,
      url: `https://aiesec.org/opportunity/${prog.slug}/${o.id}`,
      title: o.title, org: o.branch?.company?.name || null,
      location: o.location || null, country: o.host_lc?.address_detail?.country || null,
      programme: prog.name,
      description: String(o.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      cover: o.cover_photo || null, applicants: o.applicants_count ?? null,
      sdg: t ? { goal: Number(t.goal_index) || null, name: t.parent?.name || null, target: t.target_id || null } : null,
      slots, matchCount, totalSlots: slots.length,
    } });
  };

  const fetchPage = async page => {
    try {
      const d = await retry(() => gql(token, 'SlotFinderList', listQuery(withSlots),
        { page, per_page: c.PER_PAGE, filters, cdn_region: 'Global', cover_photo_size: '552x312' }));
      return d.opportunities;
    } catch (e) {
      if (withSlots && /^AIESEC API:/.test(e.message)) {
        withSlots = false; stats.slotsFromList = false;
        stats.firstError = 'List with slots failed (' + e.message + '); falling back to one request per project.';
        return fetchPage(page);
      }
      throw e;
    }
  };
  const processBlock = (block, page) => {
    block.data.forEach((o, i) => {
      if (seen.has(o.id)) return; seen.add(o.id); stats.projects++;
      if (!o.cover_photo) stats.noCover++; else if (!stats.coverSample) stats.coverSample = o.cover_photo;
      const idx = (page - 1) * c.PER_PAGE + i;
      if (withSlots && Array.isArray(o.available_slots) && o.available_slots.length) emit(o, o.available_slots, idx);
      else pending.push({ o, idx });   // empty/missing slots: ask the detail query too
    });
    examined += block.data.length;
    send({ type: 'list', fetched: seen.size, total: totalItems });
    send({ type: 'scan', done: examined, total: totalItems });
  };

  // first page (with a diagnosis if AIESEC returns nothing)
  let block = await fetchPage(1);
  if ((block.paging.total_items || 0) === 0) {
    const count = async f => (await gql(token, 'SlotFinderPing', PING_QUERY, { filters: f })).opportunities.paging.total_items;
    stats.probe = { noFilters: await count({}), programmeOnly: await count({ programmes: [programme] }) };
    if (stats.probe.programmeOnly > 0) { delete filters.earliest_start_date; stats.dateFilterDropped = true; block = await fetchPage(1); }
  }
  totalItems = block.paging.total_items || 0;
  const totalPages = Math.min(block.paging.total_pages || 1, c.MAX_PAGES);
  processBlock(block, 1);

  // remaining pages, a few in parallel
  const rest = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
  await pool(rest, c.LIST_CONCURRENCY, isAborted, async pg => processBlock(await fetchPage(pg), pg));

  // fallback: projects whose slots did not come with the list
  let done = 0;
  await pool(pending, c.CONCURRENCY, isAborted, async ({ o, idx }) => {
    try { emit(o, await getSlots(token, o.id, c), idx); }
    catch (e) {
      if (/rejected the token/.test(e.message)) throw e;
      stats.failed++; stats.firstError = stats.firstError || e.message;
    }
    send({ type: 'scan', done: ++done, total: pending.length });
  });

  send({ type: 'done', scanned: stats.projects, matched, failed: stats.failed, stats,
    windowDays: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) });
}
