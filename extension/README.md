# CRATEFLOW Beatport Cart Companion — experimental

This optional cross-browser WebExtensions prototype is **not** a browser-independent direct cart API. Its job is narrowly scoped: once the user has opened a **Beatport playlist detail page** in the same browser, click the visible **Buy All** button in response to a direct user action.

## How to test (development only)

1. In CRATEFLOW, select the matched tracks and use **Send to Cart in Beatport**. CRATEFLOW creates a Beatport playlist through MusicAPI.
2. Open Beatport in the same browser. Locate the newly created playlist and open its detail page.
3. Load the local `extension` folder as a temporary unpacked extension in a development browser:
   - Chromium / Edge: open the extensions management page, enable developer mode, choose **Load unpacked**, select this folder.
   - Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, select `manifest.json`.
   - Safari: Apple requires conversion and packaging as a Safari Web Extension using Xcode. This package is **not** yet ready for Safari distribution.
4. On the Beatport playlist page, open the extension popup and click **Add open playlist to cart**.
5. The extension locates exactly one visible playlist-wide **Buy All** / **Add all to cart** control and asks for confirmation. If no unique visible control exists, it stops without clicking anything.
6. **Verify the actual cart in Beatport**. The extension only confirms a click was sent; it cannot verify that the store added products.

## Status and limitations

- Prototype only; not tested against Beatport's live rendered DOM. The selector may need adjustment to Beatport's actual button roles/text and frontend state.
- This extension does not collect passwords, impersonate Beatport's OAuth or call undocumented checkout endpoints. It never submits a purchase.
- No direct CRATEFLOW-to-extension messaging is implemented yet. It doesn't know the created playlist URL because MusicAPI currently returns a service playlist ID, not a verified Beatport website URL.
- Platform support is **planned**, not verified: Manifest V3 is broadly supported in Chromium and modern Firefox, with differences; Safari requires Apple packaging.
- Do **not** distribute as a finished plugin or claim an added-to-cart success before live verification. Always inspect the Beatport cart and avoid duplicate additions.
- For full production: identify the exact playlist detail URL through a documented provider field, add a CRATEFLOW-to-extension handoff with origin validation, verify cart state after clicks, test Chrome/Edge/Firefox/Safari, protect against duplicate items, and obtain any necessary provider approval.

MusicAPI documents playlist creation and writes but not a shopping-cart mutation:
https://musicapi.com/docs/endpoints/create-playlist
https://musicapi.com/docs/endpoints/add-items-to-playlist

Beatport documents the playlist Buy All control:
https://support.beatport.com/hc/en-us/articles/12129947455764-Playlist-Purchasing
