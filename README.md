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

## MusicAPI Beatport Catalog Lookup (v0.4 prototype)
In **Match & Sync**, click **AUTO SEARCH** for one track or **SEARCH NEXT 5 VIA MUSICAPI** for a confirmed batch of up to five unchecked tracks. Browser calls `POST /api/search-beatport`; the server makes a single `POST https://api.musicapi.com/public/search` request per track with `type:track` and `sources:["beatport"]`, using the server's MusicAPI Client ID as a catalog token. No client secret, Beatport user token, cart operation or payment is required. Responses are sanitized before returning to the browser.
The provider can return a catalog candidate or a `not_found` or `error` status. The score shown is CRATEFLOW's *local heuristic*, not a provider confidence guarantee. Users must review and approve the correct mix and track; approval stores metadata locally, it does not add it to the actual Beatport cart.
The endpoint is enabled only if `MUSICAPI_ENABLE_VERIFICATION=true`. Search actions can consume API usage and are not called automatically on page load. There is a basic per-process rate limit (12 requests/minute/IP), which is **not sufficient** to protect a public paid API. For multi-user production, require user authentication, a server-side authorization check, durable distributed rate limiting, request quotas, billing safeguards and account isolation.
If MusicAPI responds with unsupported service or catalog errors, the user can continue with the existing manual Beatport search. The catalog response may contain only one result per source, so Extended/Original Mix variants are not comprehensively enumerated here.

## Unified Import & Match UX (v0.5)
The main navigation now uses **Import & Sync** as a single screen. Users paste Spotify track/playlist URLs or copied song lines; **IMPORT & MATCH** imports and immediately starts matching up to 10 pending tracks if Beatport is connected. Existing library tracks can also be matched from the same screen. Running progress, concise statuses and match results remain visible together, with no modal confirmation for every track.

Automatic candidate selection considers only **100% text-similarity heuristic** scores. A valid Beatport track URL is required to mark a track selected and linked. A candidate with a 100% score but no Beatport URL is shown as **100% · link needed** and cannot be sent to a cart; it is a *metadata match*, not a confirmed purchasable item. Lower-scoring results require user selection. Exact scores do not prove ISRC, release, version or ownership.

**No automatic Beatport cart operation is implemented.** The current workflow handles import, MusicAPI search and local match selection, not checkout sync. MusicAPI queries may count against API usage. Ten requests per explicit import/match action are capped to limit usage. Production-grade budgets and server rate limiting must be added before general public use.

## Beatport playlist handoff (v0.6)
CRATEFLOW now supports a **user-triggered** transfer to a real Beatport playlist using MusicAPI, as the nearest documented alternative to an unavailable public cart-write API. After matching, click **CREATE BEATPORT PLAYLIST** in Import & Sync. This sends up to 20 unique matched Beatport `externalId` track IDs to a server-side Vercel function. The function verifies the session cookie and creates a private playlist using `POST /api/{integrationUserUUID}/playlists`, then adds the tracks through `POST /api/{integrationUserUUID}/playlists/{playlistId}/items`, with the confidential MusicAPI client secret only on the server. On success the interface explicitly reports playlist creation, not cart success.

IMPORTANT: MusicAPI's playlist write does **not** update Beatport's checkout cart. A user must open Beatport, find the new playlist and click Beatport's **Add to Cart** / **Buy All** control themselves. The API response has not been tested against a live Beatport playlist in this release. A partial failure can leave a playlist created but empty; check Beatport before retrying to avoid duplicate playlists.

Beatport confirms that its DJ App has a playlist-level Add to Cart function with a 100-track cart limit: https://support.beatport.com/hc/en-us/articles/30542592676500-Can-I-purchase-tracks-using-the-DJ-App . The MusicAPI playlist endpoints are documented at https://musicapi.com/docs/endpoints/create-playlist and https://musicapi.com/docs/endpoints/add-items-to-playlist .

This remains a single-browser beta and is **not** ready for multi-user production writes until authenticated per-user sessions, distributed quotas, a durable export ledger, CSRF token management, and provider permission checks are implemented.

## Track list UI (v0.8)
- Track rows contain default-selected checkboxes, a select/deselect-all control, match status, and a cart icon. Selection persists in browser-local state.
- Review candidates show only the top-ranked MusicAPI candidate; the user must explicitly approve uncertain matches.
- **Add Playlist in Beatport** opens an in-app title dialog; the chosen title is sent through the existing MusicAPI playlist creation API.
- **Send to Cart in Beatport** and per-track cart icons open an explanatory handoff dialog. The provider has no verified direct cart-write API, so confirmation only transfers selected matched tracks to a Beatport playlist. The user must use **Buy All** on Beatport to add them to the actual cart. No false cart-success state is shown.
- The transfer-status panel appears only after the MusicAPI playlist API returned success. A status button reveals details.
- Up to 20 unique Beatport IDs per playlist transfer (provider calls must be covered by evaluation/billing limitations).

## Direct Beatport Cart (v0.9 — developer beta, not live verified)

The **Send to Cart in Beatport** button and each track's cart icon are now wired to a **direct cart job**, not to the playlist API.

- The optional CRATEFLOW Cart Companion queues 1–20 selected Beatport track IDs and uses the signed-in Beatport browser session to open track pages and attempt a uniquely identified **Add to Cart** button click.
- The browser extension is required for direct cart actions until an authorized Beatport cart API exists. The web app never receives Beatport cookies/passwords.
- The cart job reports **clicked_unverified**, **already_in_cart**, and **failed**. This is deliberately not a promise that Beatport accepted the cart change. A live test on Beatport is still required.
- **Add Playlist in Beatport** continues to use MusicAPI's playlist endpoint and is completely separate.
- The current Manifest V3 build targets Chromium browsers first; Firefox and Safari versions require compatibility and packaging work.
- The developer installation/test procedure is in [extension/README.md](extension/README.md).

Do not conflate direct cart jobs with the earlier playlist handoff prototype; that prototype has been removed from the active extension manifest.
