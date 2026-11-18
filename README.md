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

## First-time onboarding (v0.3)
New browser users are shown **Get Started**, a simplified Spotify and Beatport connection screen, with direct progression to **Import Music**. Advanced developer settings (Spotify Client ID, MusicAPI account slug) are inside a collapsible advanced section, not part of the primary user journey. The shared MusicAPI account slug is initialized to the application's developer slug; users do **not** need MusicAPI accounts or keys.

Beatport login is initiated by a hosted MusicAPI page, and the optional verification API remains cost-gated using `MUSICAPI_ENABLE_VERIFICATION`. This beta only stores a session-level verified indicator and does not support real multi-user accounts, durable OAuth connections, cloud sync, or automatic Beatport cart mutations. Spotify API app development restrictions still apply.

Before public launch: implement user authentication and secure session binding for MusicAPI auth attempts, durable per-user connections and catalog data, billing controls, and authorized Beatport cart access. Never store a MusicAPI secret or Beatport password in browser-accessible code.

## Automatic Beatport sign-in verification (v0.3.1)
The MusicAPI sign-in callback now automatically invokes `/api/verify-beatport` when it contains a valid Beatport success response and expected identifiers. During verification the onboarding screen shows a pending state. A verified response with `service: 'beatport'` marks the current browser session as connected; failures show a retry button, without falsely claiming a connection. No second user confirmation click is required for a successful return. The existing server-side feature flag `MUSICAPI_ENABLE_VERIFICATION=true` must remain enabled for this beta feature to operate, and any API charge must be considered.

This connection status is limited to the current browser session. Production-grade multi-user identity binding, durable account sessions, and Beatport cart write operations remain unimplemented.
