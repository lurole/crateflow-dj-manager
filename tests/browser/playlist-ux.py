"""Offline browser regressions. Serve dist locally and pass its origin as the first argument."""

import json
import os
import shutil
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = sys.argv[1].rstrip("/")
TARGET = urlsplit(ORIGIN)
assert TARGET.scheme == "http" and TARGET.hostname == "127.0.0.1"

CANDIDATE = {
    "name": "Fixture Track (Extended Mix)", "artist": "Fixture Artist", "mixHint": "Extended Mix",
    "provider": "api.sh", "externalId": "501", "url": "https://www.beatport.com/track/fixture/501",
}
TRACK = {
    "id": "a", "title": CANDIDATE["name"], "artist": CANDIDATE["artist"], "remix": "Extended Mix",
    "status": "pending", "playlistId": "legacy", "studioResult": "exact", "studioCandidate": CANDIDATE,
    "catalog": {"provider": "api.sh", "candidates": [CANDIDATE]},
}
BACKUP = {
    "tracks": [TRACK, {"id": "b", "title": "Second Track", "artist": "Fixture Artist", "status": "downloaded"}],
    "playlists": [
        {"id": "legacy", "name": "Legacy list"},
        {"id": "ordered", "name": "Spotify Playlist · " + "W" * 22, "trackIds": ["b", "a", "b"]},
    ],
    "settings": {},
}


def snapshot(page):
    return page.evaluate("JSON.parse(localStorage.getItem('crateflow_v1'))")


def nav(page, name):
    page.locator(f'#navigation button[data-page="{name}"]').click()


def seed(page, backup):
    page.goto(ORIGIN + "/?app=1", wait_until="domcontentloaded")
    page.evaluate("""backup => {
      localStorage.setItem('crateflow_v1', JSON.stringify(backup));
      sessionStorage.setItem('beatport_server_verified', 'yes');
    }""", backup)
    page.reload(wait_until="domcontentloaded")


def block_unmocked(context, api_handler=None):
    def route_all(route):
        request = route.request
        parts = urlsplit(request.url)
        if (parts.scheme, parts.netloc) != (TARGET.scheme, TARGET.netloc):
            return route.abort()
        if not parts.path.startswith("/api/"):
            return route.continue_()
        if api_handler:
            return api_handler(route, parts.path)
        return route.abort()

    context.route("**/*", route_all)


def check_library(browser):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    block_unmocked(context)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    seed(page, {"tracks": BACKUP["tracks"], "playlists": [{"id": "old", "name": "Old", "trackIds": ["a"]}]})
    nav(page, "library")
    page.locator("#search").fill("no matching tracks")
    page.locator("#filter").select_option("owned")
    page.locator("#playlistFilter").select_option("old")
    page.locator("#restore").set_input_files({
        "name": "legacy.json", "mimeType": "application/json", "buffer": json.dumps(BACKUP).encode("utf-8")
    })
    expect(page.locator("#toast")).to_have_text("Backup restored")
    expect(page.locator("#playlistFilter")).to_have_value("all")
    expect(page.locator("#search")).to_have_value("")
    expect(page.locator("#filter")).to_have_value("all")
    expect(page.locator("#view tbody tr")).to_have_count(2)
    assert snapshot(page)["tracks"] == BACKUP["tracks"]
    assert snapshot(page)["playlists"] == BACKUP["playlists"]

    manager = page.locator("#playlistManager")
    page.locator("#newPlaylist").click()
    name = manager.get_by_role("textbox", name="Playlist name")
    expect(name).to_be_focused()
    manager.locator("#playlistManagerSubmit").click()
    expect(manager.get_by_role("alert")).to_contain_text("Enter a playlist name")
    name.fill(" legacy LIST ")
    manager.locator("#playlistManagerSubmit").click()
    expect(manager.get_by_role("alert")).to_have_text("A playlist with this name already exists.")
    name.fill(" Warm-up 🎵 ")
    manager.locator("#playlistManagerSubmit").click()
    expect(manager).not_to_be_visible()
    new_playlist = snapshot(page)["playlists"][-1]
    assert new_playlist["name"] == "Warm-up 🎵" and new_playlist["trackIds"] == []
    expect(page.locator("#playlistFilter")).to_be_focused()

    page.locator("#playlistFilter").select_option("ordered")
    page.locator("#renamePlaylist").click()
    name.fill("Warm-up 🎵")
    manager.locator("#playlistManagerSubmit").click()
    expect(manager.get_by_role("alert")).to_have_text("A playlist with this name already exists.")
    name.fill("Ordered set")
    manager.locator("#playlistManagerSubmit").click()
    expect(manager).not_to_be_visible()
    renamed = snapshot(page)["playlists"][1]
    assert renamed == {**BACKUP["playlists"][1], "name": "Ordered set"}
    page.locator("#playlistFilter").select_option("legacy")
    page.locator("#deletePlaylist").click()
    expect(manager.get_by_role("button", name="Cancel")).to_be_focused()
    page.keyboard.press("Escape")
    expect(manager).not_to_be_visible()
    assert snapshot(page)["playlists"][0] == BACKUP["playlists"][0]
    page.locator("#deletePlaylist").click()
    manager.locator("#playlistManagerSubmit").click()
    expect(manager).not_to_be_visible()
    saved = snapshot(page)
    assert saved["playlists"] == [renamed, new_playlist]
    assert saved["tracks"] == [{key: value for key, value in TRACK.items() if key != "playlistId"}, BACKUP["tracks"][1]]
    page.reload(wait_until="domcontentloaded")
    nav(page, "library")
    page.locator("#playlistFilter").select_option("ordered")
    expect(page.locator("#view tbody tr")).to_have_count(3)
    assert saved == snapshot(page) and not errors, errors
    context.close()
    print("Browser: legacy restore, empty playlist, duplicate validation, rename, delete confirmation and reload passed.")


def check_export(browser):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    held = []
    operations = []
    unexpected = []
    errors = []

    def simulate(route, path):
        body = route.request.post_data_json
        if route.request.method == "POST" and path == "/api/search-beatport" and "exportCheck" in body:
            held.append(route)
            return
        if route.request.method == "POST" and path == "/api/export-beatport-playlist":
            operation = body["operation"]
            operations.append(operation)
            response = {"exportId": body["exportId"], "playlistId": "mock-playlist"}
            if operation == "create":
                response.update(status="created", stage="create", receipt="mock-receipt")
            elif operation == "append":
                response.update(status="appended", stage="add")
            elif operation == "verify":
                response.update(status="verified", stage="verify", added=1, verified=True, confirmed=["mock-track"])
            return route.fulfill(status=200, json=response)
        unexpected.append(path)
        return route.abort()

    block_unmocked(context, simulate)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    seed(page, BACKUP)
    nav(page, "import")
    trigger = page.locator("#studioExport")
    dialog = page.locator("#studioPlaylistDialog")
    title = dialog.get_by_role("textbox", name="Playlist title")
    trigger.click()
    expect(title).to_be_focused()
    page.keyboard.press("Escape")
    expect(dialog).not_to_be_visible()
    expect(trigger).to_be_focused()
    trigger.press("Enter")
    dialog.get_by_role("button", name="Cancel").click()
    expect(dialog).not_to_be_visible()
    expect(trigger).to_be_focused()

    trigger.click()
    with page.expect_request(lambda request: request.url == ORIGIN + "/api/search-beatport"):
        dialog.get_by_role("button", name="Create Playlist").click()
    expect(dialog.get_by_role("status")).to_contain_text("Verifying track")
    expect(dialog.get_by_role("button", name="Cancel")).to_be_disabled()
    expect(dialog.get_by_role("button", name="Close")).to_be_disabled()
    page.keyboard.press("Escape")
    page.mouse.click(4, 4)
    expect(dialog).to_be_visible()
    assert len(held) == 1
    held[0].fulfill(status=200, json={"ok": True, "id": "mock-track", "proof": "mock-proof"})
    expect(dialog).not_to_be_visible()
    expect(trigger).to_be_focused()
    expect(page.locator(".studio-transfer")).to_contain_text("Playlist fully verified")
    assert operations == ["create", "append", "verify"]
    assert not unexpected and not errors, (unexpected, errors)
    context.close()
    print("Browser: Beatport opening, Escape, restored focus and blocked dismissal during a mocked export passed.")


def check_width(browser, width):
    phone = width < 768
    context = browser.new_context(viewport={"width": width, "height": 900}, is_mobile=phone, has_touch=phone)
    block_unmocked(context)
    page = context.new_page()
    seed(page, BACKUP)
    nav(page, "library")
    page.locator("#playlistFilter").select_option("ordered")
    page.get_by_role("button", name="Edit playlist").click()
    heading = page.locator("#playlist-editor-title")
    expect(heading).to_be_visible()
    assert heading.evaluate("(element) => element.scrollWidth <= element.clientWidth")
    assert page.evaluate("document.documentElement.scrollWidth") <= width
    context.close()
    print(f"Browser: long Spotify title fits a {width}px viewport.")


with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(executable_path=executable, args=["--disable-background-networking"])
    check_library(browser)
    check_export(browser)
    for width in (320, 375, 390, 768, 1280):
        check_width(browser, width)
    browser.close()
