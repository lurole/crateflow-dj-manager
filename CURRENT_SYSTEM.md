# CRATEFLOW 1.x — Actual source-verified implementation inventory

**Checked against GitHub repository source on 2026-11-20.** This file is the **as-is** inventory, unlike `ARCHITECTURE.md` and `DATA_MODEL.md`, which describe proposed future behavior. This is not a live provider integration audit.

## 1. Runtime / project
- GitHub repository: `lurole/crateflow-dj-manager`.
- Existing UI: `https://crateflow-dj-manager.vercel.app/?app=1` (production availability must be verified independently).
- `package.json`: `type: module`, Node `>=18`, `npm start`, `npm run build`, `npm test`.
- `server.js`: minimal Node static file server on port 5173. It **does not implement** the Vercel `/api` functions locally.
- `build.js`: copies HTML, CSS and browser JS into `dist/` for Vercel static hosting.
- `index.html`: loads `clipboard-import.js`, `matching.js`, `mix-compatibility.js`, `app.js`. Some script version query parameters reflect older dates; inspect cache-busting behavior before releases.
- `app.js`: roughly 79 KB single-file browser state/UI/router/async workflow, significant refactoring opportunity.
- Source `README.md` documents current providers and setup; read alongside this file.

## 2. Storage
- All user library data resides in one browser localStorage JSON object under `crateflow_v1`.
- Initial `defaults`: `{tracks:[], playlists:[], settings:{}}`. Mutable `state` includes `syncHistory` and optional `catalogCache`.
- `persist()` writes the full `state` JSON back to localStorage; no distributed transaction, cross-device sync, server-side authenticated owner or backend DB.
- Browser supports JSON export/restore; XML export uses local file path metadata.
- Local catalog cache is per-browser, bounded to 250 entries with a 30-day freshness window for successful matched catalog results.
- Beatport session is separate, stored as a short-lived signed HttpOnly cookie; no CRATEFLOW multi-user accounts.

## 3. Import
- `clipboard-import.js`: parse pasted Spotify track/playlist links and Artist–Title / pasted CSV-like lines; block unsupported URLs and rows without artists.
- `api/resolve-spotify-track.js`: MusicLink external lookup for single Spotify ID, validates matching Spotify URL and required title/artist, accepts ISRC.
- `api/resolve-spotify-playlist.js`: MusicAPI public Spotify playlist inspection in pages of 50; max 10 pages/playlist and 3 playlist URLs per import from browser.
- `app.js` `importTextRows`: max 10 individual Spotify links per click; MusicLink calls spaced ~1.1 seconds; local duplicate skipping by Spotify ID or normalized title and artist.
- `studioImport`: new IDs only trigger `runAutoPipeline` with up to 40 items; follow-up processing via `studioSync` / next 10.

## 4. Matching and enrichment
- `matching.js`: deterministic title core, artist-credit identities, version discrimination, optional ISRC conflict/match, ranking and ambiguity refusal. `assess(...).autoEligible` does not prove recording audio identity.
- `api/search-beatport-primary.js`: primary API.SH Beatport catalog search, maps title/artists/mix/ISRC/BPM/Camelot/genre/public Beatport ID, marks `exportIdVerified:false`.
- `api/search-beatport.js`: connected-account MusicAPI search fallback; external IDs are in the MusicAPI connected-service namespace.
- `api/enrich-beatport-dj.js`: fallback verified API.SH lookup for missing DJ metadata when a qualifying MusicAPI match exists.
- `app.js`: client runs pipeline sequentially with throttling, applying title/match metadata then optionally filling BPM/key/genre. No dedicated queue worker.
- `mix-compatibility.js`: deterministic Camelot and BPM comparison. No waveform/audio analysis, energy analysis or set generator.

## 5. Beatport connection / export
- `api/verify-beatport.js`: verifies connected Beatport account via MusicAPI and sets signed HttpOnly cookie (one hour).
- `app.js` `resolveMusicApiExportId`: API.SH public catalog IDs are **not** passed directly as MusicAPI playlist item IDs; resolve lazily through connected account candidate comparison; cache mapping bound to source fingerprint.
- `api/export-beatport-playlist.js`: explicit POST creating private Beatport playlist (via MusicAPI), add up to 20 item IDs, then read-back, check title/artist/mix/ISRC and availability field where supplied. Identifies confirmed/missing/mismatched/unavailable/unverified.
- No automatic Beatport purchase, shopping-cart mutation or audio download.
- External provider integration and read-back semantics have not been independently verified against a representative real account in this inventory; contract tests and live validation remain necessary.

## 6. UI and exports
- `index.html` navigation includes overview, import, library, Beatport, Mix Compatibility, downloads, export, settings.
- `app.js` import UI uses FOUND, CHECK TRACK, SEARCH FAILED, SEARCHING; internal scores generally hidden.
- Selected Beatport display title may replace local title while original source identity is saved in `importTitle`/`importArtist`.
- Rekordbox XML export requires meaningful absolute local file paths; metadata or Beatport playlist membership is not a digital music purchase or local audio file.

## 7. Current API inventory
| Route | Function | Auth/current guard |
| --- | --- | --- |
| `POST /api/resolve-spotify-track` | MusicLink single track ID | Origin, configuration, instance-IP quota |
| `POST /api/resolve-spotify-playlist` | MusicAPI public playlist page | Origin, configuration, instance-IP quota |
| `POST /api/search-beatport-primary` | API.SH primary metadata/catalog | Origin, configuration, instance-IP quota |
| `POST /api/search-beatport` | MusicAPI connected Beatport candidate search | Origin + signed connected session cookie + instance-IP quota |
| `POST /api/enrich-beatport-dj` | API.SH enrichment fallback | Origin, API key/configuration, instance-IP quota |
| `POST /api/verify-beatport` | MusicAPI Beatport account verification | Origin, verified provider callback/user, sets cookie |
| `POST /api/export-beatport-playlist` | Create/append/read-back remote playlist | Origin + signed connected session cookie, max 20 tracks |

Check any other files in `api/` when running a complete repo-tree audit; inventory here includes all route names referenced by the current `app.js`, not an assertion that the list is exhaustive.

## 8. Known gaps to investigate (not claimed fixed)
- No cloud database or authenticated multi-user ownership.
- Browser-run long-running imports stop when tab closes; local quotas are per server instance.
- Conservative metadata matching can still confuse re-releases/master variants with same textual evidence.
- Client-side cache has no rights-aware global sharing across users and no network-wide invalidation.
- No durable per-user usage-budget enforcement or server-side job orchestration.
- Export can partially write a remote playlist before network failure; read-back does not provide distributed transaction guarantees.
- Code and test quality require Codex review: scripts may contain stale cache-busting querystrings; `app.js` monolith and provider response normalization paths need fixtures.
- Production auth, secrets, external licensing, data deletion, billing and secure provider linking are target features only.

## 9. Verification boundary
**Source-reviewed:** repository files and code paths described above. **Not verified in this document:** running `npm test` or `npm run build`, external API contract, user account export, live production availability, current Vercel environment settings, developer credentials, actual database setup. Codex must reproduce independently.
