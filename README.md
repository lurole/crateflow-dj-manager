# CRATEFLOW — DJ Music Workflow

A lightweight web workspace for DJs to bring their own track lists into a Beatport matching and playlist workflow.

## Spotify links without login (MusicLink adapter)

The app accepts Spotify **track URLs** copied from the Spotify desktop client with Ctrl+A/Ctrl+C/Ctrl+V, including URLs with `?si=`, `rowId=` or `context=` query parameters, as well as `spotify:track:ID` URIs. A batch of up to ten unique links is resolved per explicit user import action. Spotify login is not required. **Spotify playlist URLs** are not resolved: a copied playlist link alone is not a list of tracks.

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
