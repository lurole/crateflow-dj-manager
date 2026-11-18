# Beatport account connection — integration decision

Date: 2026-11-18

## Verified facts
- Beatport API access is controlled by Beatport and requires authorization/licensing. See https://support.beatport.com/hc/en-us/articles/4414997837716-Terms-and-Conditions
- Beatport DJ App itself can add individual tracks or a playlist of tracks to the default Beatport cart, with checkout on Beatport.com. This does not establish that third-party apps can access that cart-write operation. See https://support.beatport.com/hc/en-us/articles/30542592676500-Can-I-purchase-tracks-using-the-DJ-App
- MusicAPI describes Beatport sign-in, catalog search, playlists, and library APIs. Its public documentation does not establish that it can add tracks to the Beatport *store checkout cart*. See https://www.musicapi.com/docs/connect-users/configure-beatport and https://musicapi.com/beatport-api

## Connection architecture (pending approval)
1. The user clicks Connect Beatport.
2. The browser is redirected to the provider's hosted authorization screen, NOT an app-owned password form.
3. The authorization callback is received on a secure backend endpoint; CSRF state and OAuth PKCE should be used when supported by the provider.
4. Backend stores provider access/refresh tokens encrypted and associated with an authenticated app user.
5. Backend searches catalog, applies matching rules, and returns reviewable candidates; all writes require explicit user action.
6. Backend submits selected Beatport track IDs to an officially supported cart-write endpoint **only if authorized and documented**; then verifies response and logs outcome.
7. User reviews the real cart and completes purchase on Beatport.com.

## Blockers
- Provider credentials / approved integration account.
- Confirmation that OAuth and cart-write scopes or endpoint are supported for a third-party DJ manager.
- Secure authenticated backend and database; current CRATEFLOW is a static SPA with localStorage, not a suitable place for provider secrets.

## Temporary functionality
The web app can import Spotify track metadata, open Beatport searches, save reviewed Beatport URLs, and record manual cart confirmations. It cannot log in to Beatport or automate cart operations at this time.

## Next action
Request official partner/API authorization from Beatport or written documentation from MusicAPI confirming whether cart additions are available for connected Beatport accounts. Do not implement password collection, undocumented Beatport endpoints, or unsupported claims of successful cart sync.
