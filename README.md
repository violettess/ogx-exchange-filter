# AIESEC Slot Finder

Finds AIESEC projects with at least one slot that starts on/after your start date AND ends on/before your finish date,
laid out like aiesec.org's search. Local filters: slot length, SDG (Volunteer), country. Click a card to open it on aiesec.org.

## Run locally (Node 18+, nothing to install)
    node server.js --demo     # fake data, to try the interface
    node server.js            # real data; open http://127.0.0.1:3000 and click "Connect to AIESEC"

## Connecting (no login needed)
1. Open aiesec.org/search, press F12 > Network, reload.
2. Click any `graphql` request > Request Headers > copy the `authorization` value.
3. In the app click "Connect to AIESEC" and paste it. It is saved in your browser only and sent with each search.
Optional: set `AIESEC_TOKEN` (in `.env` locally, or in Vercel's environment variables) so visitors never need to paste one.

## Deploy to Vercel
Project layout: `public/` (the page) + `api/` (two serverless functions) + `lib/core.js`. `server.js` is only for local use.

Option A - GitHub (easiest to update later)
1. Create a GitHub repo and push this folder (`.env` is git-ignored).
2. vercel.com > Add New > Project > import the repo.
3. Framework Preset: "Other". Leave Build Command and Output Directory empty (vercel.json already sets them). Deploy.

Option B - CLI
    npm i -g vercel
    vercel          # first run: log in, accept defaults
    vercel --prod

Environment variables (Project > Settings > Environment Variables, all optional):
`AIESEC_TOKEN` (shared default token), `EXCLUDE_HOME_MC`, `PER_PAGE`, `LIST_CONCURRENCY`, `CONCURRENCY`,
`IMAGE_HOSTS` (optional: comma-separated domains the photo proxy may fetch, e.g. `aiesec.org,cloudfront.net`).

Notes
- A search streams for up to ~1-2 minutes. Vercel allows up to 300 s per function on the Hobby plan (vercel.json sets this).
  Fluid compute should be on (default for new projects): Project > Settings > Functions.
- The deployed URL is public. Anyone with the link can run searches (using their own token, or yours if you set AIESEC_TOKEN)
  and that uses your Vercel function time. Turn on Deployment Protection if you want it private.
- This app calls AIESEC's API on behalf of visitors, from Vercel's servers. If AIESEC starts blocking those requests, lower
  `LIST_CONCURRENCY`/`CONCURRENCY` or tell me what the error says.

## Photos
Photos load straight from AIESEC's CDN first. If the CDN refuses (hotlink protection), the page retries through `/api/img`,
which fetches the picture server-side with aiesec.org as the referrer. If that also fails the card shows "Photo unavailable",
and the "Search details" box under the status line shows the first failing URL.
