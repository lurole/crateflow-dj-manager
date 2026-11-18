# CRATEFLOW Direct Cart Companion — DEVELOPMENT BETA

## What it does

CRATEFLOW's **Send to Cart in Beatport** button now sends a list of matched Beatport track IDs and track-page URLs directly to the optional browser companion. **No playlists are created or used** in this path. The companion works through your already signed-in Beatport browser session and attempts to click the track-level **Add to Cart** button on each individual track page. Purchases and checkout are never automated.

**Important:** This is a prototype, not an end-to-end verified Beatport integration. Beatport's live UI markup and action behavior have not yet been checked with an authenticated Beatport account. The companion may fail to find the button. Clicking a button is NOT proof that Beatport actually added the track.

## Install and try in Chromium (Chrome or Edge)

1. Download the repo as ZIP (GitHub **Code → Download ZIP**) and extract it.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Turn on **Developer mode** and select **Load unpacked**. Select the repository's `extension` folder.
4. Open `https://www.beatport.com/`, sign in with your own Beatport account, and leave your browser logged in.
5. Reload `https://crateflow-dj-manager.vercel.app/` **after loading the extension**.
6. Import and match a Spotify song. It must have a numeric Beatport track ID or a valid Beatport store track URL.
7. Click the **shopping cart icon** next to the song (or select tracks and click **Send to Cart in Beatport**). No playlist is created. The companion opens track pages in background tabs and attempts a unique Add to Cart click per track.
8. Open the Beatport cart and inspect it to confirm the results; click outcomes are marked as `clicked_unverified` until reliable cart verification is implemented. Failures appear as `Cart failed` in CRATEFLOW.

## Cross-browser compatibility

- Chrome and Edge (Manifest V3 service worker): first development targets; **not live verified**.
- Firefox: the current Manifest V3 background worker requires compatibility adjustments / test builds.
- Safari: must be packaged as a Safari Web Extension with Xcode and tested on macOS.
- The web app works in regular browsers, but **direct cart control requires an extension or an authorized Beatport cart API**. A pure unrelated website cannot reliably control a user's Beatport session because of same-origin and session restrictions.

## Security and operational boundaries

- Only a direct action on CRATEFLOW's exact published origin can enqueue tracks.
- Every URL is validated against Beatport HTTPS track paths with numeric track IDs; IDs and visible titles are checked on the opened page. Uncertain page results fail closed.
- No Beatport credentials, session cookies, or tokens are transmitted through CRATEFLOW or copied by this extension.
- A maximum of 20 tracks per job, processed sequentially. No purchases or checkout.
- All results distinguish `clicked_unverified`, `already_in_cart`, and `failed`. CRATEFLOW does not yet independently verify the Beatport cart.
- Existing Beatport playlist creation remains a separate button powered by MusicAPI.

## What remains before shipping

Live test against the current Beatport track page and cart on a signed-in test account; adjust button discovery for Beatport's real DOM and event semantics; verify the cart contents rather than UI clicks; de-duplicate queued tracks; test and package Chrome/Edge, Firefox and Safari versions. Do not market the cart integration as fully operational until those tests pass.
