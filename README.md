# CRATEFLOW — DJ Music Manager

Browser-based DJ music management prototype. Live Spotify playlist metadata import via OAuth PKCE, CSV import, local music library, Beatport search queue, purchase/download status tracking, and Rekordbox XML export.

## Deployment
Import this repository into https://vercel.com/new as Framework Preset **Other**, root directory **.**, and no build command. The app is static HTML/CSS/JS. Every push to main will deploy automatically once linked.

In Spotify Developer Dashboard, add your **exact** Vercel URL including the final slash to Redirect URIs, e.g. https://crateflow-example.vercel.app/. Spotify requires an authorized app and may limit API access under Development Mode.

## Local
Run `npm start` with Node 18+ and visit http://127.0.0.1:5173/. Add that exact URL to Spotify Redirect URIs for local OAuth.

## Limitations
Track metadata are saved in browser localStorage, not synced across devices. Spotify tokens are in sessionStorage, no client secret is used. Beatport search opens manually and **does not** place items in the actual cart or automate purchases/downloads. Track statuses are local only. For Rekordbox XML, input **real absolute paths** for legally acquired local audio files; missing paths cannot be discovered by a browser. BPM and key are manual. Export JSON backups regularly.
