# CRATEFLOW — DJ Music Manager

Browser-based DJ music management prototype. Live Spotify playlist metadata import via OAuth PKCE, CSV import, local music library, Beatport search queue, purchase/download status tracking, and Rekordbox XML export.

## Deployment
Import this repository into https://vercel.com/new as Framework Preset **Other**, root directory **.**, and no build command. The app is static HTML/CSS/JS. Every push to main will deploy automatically once linked.

In Spotify Developer Dashboard, add your **exact** Vercel URL including the final slash to Redirect URIs, e.g. https://crateflow-example.vercel.app/. Spotify requires an authorized app and may limit API access under Development Mode.

## Local
Run `npm start` with Node 18+ and visit http://127.0.0.1:5173/. Add that exact URL to Spotify Redirect URIs for local OAuth.

## Limitations
Track metadata are saved in browser localStorage, not synced across devices. Spotify tokens are in sessionStorage, no client secret is used. Beatport search opens manually and **does not** place items in the actual cart or automate purchases/downloads. Track statuses are local only. For Rekordbox XML, input **real absolute paths** for legally acquired local audio files; missing paths cannot be discovered by a browser. BPM and key are manual. Export JSON backups regularly.

## Match & Sync (phase 1)
Open **Match & Sync** in the left sidebar. For each imported track:
1. Open a Beatport search.
2. Verify the release and mix on Beatport.
3. Paste the exact `https://www.beatport.com/track/slug/12345` URL and candidate details.
4. Save and score the match. The displayed score is a locally computed heuristic only.
5. Add the track to your real Beatport cart yourself, then click **I ADDED TO BEATPORT CART** to record confirmation.

A local activity history records searches, confirmed matches, and cart acknowledgements. It can be exported as JSON. The **Prefer Extended Mix** setting influences search wording and candidate score. This phase does not scrape the Beatport catalog, log in to Beatport or add items to the Beatport cart automatically.

Planned phase 2: user-controlled Chrome extension for supported Beatport storefront actions, after validating live DOM and allowed permissions. Never treat local cart status as real-time confirmation of a remote cart.
