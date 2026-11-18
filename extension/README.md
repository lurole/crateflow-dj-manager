# CRATEFLOW Browser Cart Companion — developer beta

## Current handoff

1. In the CRATEFLOW web app, match and select tracks, then click **Send to Cart in Beatport** and **Prepare Beatport Cart**. MusicAPI creates a Beatport playlist.
2. When the success panel appears, click **Open Beatport & Continue to Cart**. The CRATEFLOW content script receives the exact playlist name, provider playlist ID, count and a one-time random nonce, then stores a temporary job in extension-local storage (20-minute expiry). No passwords, account tokens or cookies are transferred.
3. Beatport opens in a new tab. The Beatport content script shows a small CRATEFLOW assistant with the playlist name. Open the playlist yourself or use **Open playlist** if Beatport exposes a *unique, exact-title* playlist link in the visible page.
4. On the matching playlist detail page, the assistant enables **Confirm Buy All** only if a visible page heading exactly equals the transferred playlist title.
5. The assistant checks that there is **exactly one visible “Buy All” / “Add all to cart” button**, asks you to confirm, then clicks that Beatport UI button. The session is marked **click_sent**, not **cart_confirmed**.
6. **Verify the actual Beatport cart**. The companion cannot certify that the click was accepted; it does not purchase anything.

The standalone extension toolbar popup can open Beatport and inspect pending handoff state, but never generically clicks unverified cart controls.

## Install for a development test (not store-published)

- Download the GitHub repository as ZIP, extract it, and locate the `extension` folder.
- Chrome/Edge: Extensions → Developer mode → Load unpacked → choose `extension`.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension/manifest.json`.
- Safari: requires Xcode packaging as a Safari Web Extension, **not yet prepared or tested**.

After enabling the extension, reload CRATEFLOW and Beatport. The app runs at `https://crateflow-dj-manager.vercel.app/`; the bridge intentionally rejects all other origins.

## Security and known limitations

- Browser extension installation is optional; web-only users can still create a playlist and click Buy All manually.
- Only the explicitly queued playlist title is accepted; never act on a generic unknown page. The companion checks the title *again* immediately before clicking.
- No undocumented private Beatport endpoints are called. No payment or checkout flows are automated.
- A queued action lasts 20 minutes; the browser stores only playlist name, provider ID, count, nonce, creation time and status.
- The job does not cross browser profiles or browsers. A user must use the web app and Beatport **in the same browser profile**.
- Provider playlist ID cannot be assumed to be a website ID. Because MusicAPI's documented playlist schema does **not** provide a Beatport website URL, the assistant finds the target via an exact visible Beatport playlist link or asks the user to open it.
- The selector and title check require **live testing on an authenticated Beatport account**; Beatport may use different copy or structure. This is a prototype, not a verified one-click cart integration.
- Browser compatibility: Chromium/Edge and Firefox are implementation targets; Safari requires packaging. No supported browser has yet been end-to-end verified.
- Caution: repeated Buy All can duplicate cart items. Check cart state before retrying.

## Authoritative docs

- Beatport playlist Buy All: https://support.beatport.com/hc/en-us/articles/12129947455764-Playlist-Purchasing
- MusicAPI playlist creation: https://musicapi.com/docs/endpoints/create-playlist
- MusicAPI playlist lookup: https://musicapi.com/docs/endpoints/get-playlist
- WebExtensions cross-browser messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
