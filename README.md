# CRATEFLOW — DJ Music Workflow

A lightweight web workspace for DJs to bring their own track lists into a Beatport matching and playlist workflow.

## Current MVP — no Spotify login

The user-facing Spotify OAuth login and Spotify Web API import have been **removed** from the MVP to avoid depending on restricted Spotify user authorization. The app **does not** fetch the tracks behind Spotify track/playlist URLs.

Supported input:

1. Paste one song per line: `Artist – Title` (example: `Adriatique – Closer (Extended Mix)`).
2. Paste spreadsheet columns separated by tabs: `Title<TAB>Artist`.
3. Paste CSV text with a `title,artist` header or use **UPLOAD CSV** (case-insensitive CSV file headers: title/track/track name and artist/artists/artist name).

Unresolvable Spotify links, unsupported URLs and lines without an artist are **not** silently imported. The workspace shows a warning. In the Spotify desktop app, `Ctrl+A` and `Ctrl+C` can copy track links rather than artist/title text: that clipboard format cannot yet be processed without a separate authorized metadata integration or an exported table. The app must not claim to support URL-only imports.

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

No Spotify Web API, oEmbed fallback, web scraping or unauthenticated Spotify metadata lookups are used in this MVP. This avoids pretending that URL parsing can replace authorized track metadata access. Any future automated interpretation of Spotify links requires validating the applicable API and commercial terms.

Beatport/MusicAPI external use and payment terms must be checked before mass-market commercialization.
