# CRATEFLOW — DJ Music Workflow

> **CRATEFLOW 2.0 planning & Codex handoff (2026-11-20)**
> The current MVP is described below; the future features and database are **not yet implemented**.
> Start with the [German project overview](PROJEKTUEBERSICHT_DE.md), [current-state inventory](CURRENT_SYSTEM.md), [product requirements](PRODUCT_REQUIREMENTS.md), [target architecture](ARCHITECTURE.md), [data model](DATA_MODEL.md), [migration plan](MIGRATION_PLAN.md), [security and operations](SECURITY_OPERATIONS.md), and [roadmap](ROADMAP.md).
> Codex must read [AGENTS.md](AGENTS.md) and begin with the [first audit prompt](CODEX_START_PROMPT.md) before changing production functionality.

A lightweight web workspace for DJs to bring their own track lists into a Beatport matching and playlist workflow.

## Spotify links without login (MusicLink adapter)

The app accepts Spotify **track URLs** copied from the Spotify desktop client with Ctrl+A/Ctrl+C/Ctrl+V, including URLs with `?si=`, `rowId=` or `context=` query parameters, as well as `spotify:track:ID` URIs. A batch of up to ten unique links is resolved per explicit user import action. Spotify login is not required. **Spotify playlist URLs** use the separate MusicAPI import described below.

CRATEFLOW sends each normalized 22-character track ID from the browser to `POST /api/resolve-spotify-track`. The Vercel function uses the documented `GET https://api.ml.jadquir.com/v1/lookup/spotify/:id` endpoint with a MusicLink bearer API key stored **only on the server**. A result is imported only if the provider returns exactly one record whose Spotify link points to the **same track ID**, and it contains nonempty title and artist. ISRC is retained for subsequent Beatport matching if valid. Missing, ambiguous or provider-failed results are reported to the user, never silently assigned.

**Deployment setup (required for the link lookup):**

1. Obtain a MusicLink API key in the provider dashboard: https://ml.jadquir.com/docs. Choose a provider plan that explicitly permits CRATEFLOW's intended use. The Free tier is **personal-only**; current Hobby and Pro plans allow commercial use, subject to provider terms.
2. In Vercel project `crateflow-dj-manager` → Settings → Environment Variables, set `MUSICLINK_API_KEY` to the key (server-side secret) and `SPOTIFY_LINK_LOOKUP_ENABLED` to the string `true`, targeting Production (and Preview if needed).
3. Redeploy after saving the variables. Test a real Spotify track link (for example `https://open.spotify.com/track/5KBUE75BEZMGmDnfW8y2gd`) on `/ ?app=1` (without the space).
4. `GET /api/resolve-spotify-track` returns only whether the provider is configured; it never reveals the key.

Without this configuration, the app continues to support text and CSV imports; Spotify track links return a clear `not_configured` message. The public Vercel endpoint is **beta-only**, with per-instance best-effort IP throttling (10 requests/minute and 100/day). Before enabling it for public mass-market usage, implement durable per-user quotas, proper user login and provider usage budgets. Each first uncached MusicLink lookup can take around 10–15 seconds; requests are processed sequentially in the browser with progress feedback.

Attribution: the importer links to MusicLink. Verify **MusicLink licensing**, **Spotify's applicable metadata, linking and commercial terms**, and the overall CRATEFLOW business use case before a commercial launch. Using a third-party provider does not automatically grant unrestricted rights to Spotify metadata.

The text/CSV import remains independent of MusicLink:
- `Artist – Title` (one song per line)
- Spreadsheet columns: `Title<TAB>Artist`
- CSV text/file: `title,artist`

Unsupported URLs and missing-artist lines are not silently imported.

## Whole Spotify playlist URLs (MusicAPI)

Spotify **playlist** URLs and `spotify:playlist:ID` URIs now resolve via the independent server-side `POST /api/resolve-spotify-playlist` endpoint. The MusicAPI Core public inspection endpoint `POST https://api.musicapi.com/public/inspect/playlistItems` accepts a Spotify playlist ID and retrieves up to 50 items per page, using `nextParam` pagination. No Spotify user login is required for supported public playlists. It does not guarantee access to private, restricted, unavailable, or provider-blocked playlists.

MusicAPI credentials `MUSICAPI_CLIENT_ID` and `MUSICAPI_CLIENT_SECRET` are required as Production environment variables on Vercel; the browser never receives them. The UI handles up to three playlist URLs per import and at most ten pages (500 entries) per playlist. More pages, unavailable tracks, failed pages, and provider errors are explicitly reported. Track IDs, titles, artists, albums and valid ISRCs are preserved for matching. Duplicate tracks already in the library are skipped.

Single Spotify **track** URLs continue to use MusicLink, independently of MusicAPI. The playlist endpoint uses only per-instance best-effort IP limits (12 requests/minute, 120/day); use durable authenticated quotas and a provider-usage budget before opening broad public access.

## Optimized API.SH-first catalog pipeline (2026-11-20)

The import UI stays the same. For a new Spotify song the browser resolves the original title/artist via MusicLink (single link) or MusicAPI Core (playlist), then tries the **API.SH Beatport catalog** via `POST /api/search-beatport-primary`. That one response may contain title, artists, mix, ISRC, BPM, Camelot key and genre; no second API.SH call is made for a successful API.SH primary lookup. MusicAPI connected-Beatport search remains the fallback when the primary result is unavailable, non-unique, or not safely matched. Matching uses the original Spotify/import identity and refuses indistinguishable releases, other artists, mix conflicts or conflicting ISRCs.

Successful catalog results are cached locally per original song identity for up to 30 days, capped at 250 entries. This browser-local cache is a pragmatic MVP measure, not a central or cross-device cache. API.SH search currently has a best-effort quota of 10 calls/minute and 40/day per IP/server instance; paid lookups are throttled. The old MusicAPI matching and API.SH enrichment routes remain as fallbacks. Existing MusicAPI-matched library entries need not be re-imported.

**Critical ID boundary:** API.SH returns numeric Beatport public catalog IDs but MusicAPI playlist calls require connected-service item IDs, which must not be presumed identical. The API.SH result is marked `exportIdVerified:false`. Only when the user clicks Create Beatport Playlist does CRATEFLOW retrieve MusicAPI candidates, compare original title/artist/version/ISRC to both providers, and cache a verified mapping against the original source fingerprint. If any selected song cannot be mapped uniquely, playlist creation stops **before** any write. The export then retains its server-side playlist read-back verification. This is the basis for reducing duplicate search/API credits without risking a provider-ID mix-up.

This client-driven optimization is not a persistent background queue; keep the browser tab open for large jobs. Catalog/playlist accuracy and provider mapping still require live validation on representative real tracks.

## One-click import and automatic DJ enrichment

Import & Match now runs in this order: user-pasted Spotify track or public playlist URL → existing MusicLink (single track) or MusicAPI (playlist) import → connected Beatport/MusicAPI title, artist and version matching → verified API.SH Beatport lookup for optional BPM, Camelot key and genre. Each successfully retrieved field is recorded with an API.SH source marker, and existing metadata is never overwritten. Ambiguous/wrong-version matches are left for review, not silently assigned.

Automatic runs are browser-side and must remain in an open tab; they are not background jobs. The MVP limits automatic processing to **40 newly imported tracks per click**, because each API.SH lookup can consume a credit and the API.SH endpoint currently has a best-effort 40/day limit per IP/server instance. A queued remainder can be resumed with **CONTINUE NEXT 10** on the import screen, subject to provider and daily rate limits. Catalog and metadata calls are spaced out. No second button or permission prompt is needed within a normal <=40-track import once Beatport has been connected. For large playlists, a durable server-side job queue, account-scoped quotas, credit budgets, and resumable jobs are needed before promising unattended end-to-end processing.

## Matching and Beatport playlist export

Connect a Beatport account via MusicAPI when ready to match songs. `MUSICAPI_ENABLE_VERIFICATION=true` and valid server-side `MUSICAPI_CLIENT_ID`/`MUSICAPI_CLIENT_SECRET` are required. Provider account lookups are gated; there is basic per-instance throttling that is not sufficient for unrestricted public access.

The local `matching.js` engine ranks candidates by track title, artist, mix/version and optional ISRC. Remixes and versions are not interchangeable. Ambiguous or incomplete matches require explicit review. Metadata percentages are heuristic, not guarantees of the exact recording or purchase availability.

Creating a Beatport playlist is an explicit user action that submits selected MusicAPI track identifiers. It does **not** buy music, add to a cart or automatically download audio files.

## Storage and data protection

Tracks, playlists, status, matching history and file paths are currently saved in this browser's `localStorage` under `crateflow_v1`. They do not sync across devices. Export JSON backups regularly. Audio files are never collected or hosted. Beatport verification uses an expiring signed HttpOnly cookie; this is not a production multi-user login or account system.

Before public launch: provision dedicated user authentication, cloud database with row-level access control, durable quotas/rate limiting, secure per-user account binding, terms/privacy disclosures, and commercial integration rights.

## Local development

Requires Node 18+:

```bash
npm start
npm test
npm run build
```

Local server: http://127.0.0.1:5173/. No Spotify Developer Dashboard or redirect URI configuration is needed for the current MVP.

Deploy with Vercel using the Git-linked repository. `build.js` bundles the static frontend to `dist/`; backend API routes are deployed as functions. The source files `clipboard-import.js`, `matching.js` and their suites are dependency-free.

## External platform compliance

There is no Spotify OAuth or Spotify Web API call. Spotify track links are resolved via the separately authenticated MusicLink developer API when configured. No Spotify scraping, oEmbed extraction or playlist scraping is used. Use of Spotify-derived metadata is still subject to applicable rights and provider terms.

Beatport/MusicAPI external use and payment terms must be checked before mass-market commercialization.
