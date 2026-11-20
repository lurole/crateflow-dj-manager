"""Backup and HTML regressions against an isolated local build, with blocked external requests."""

import json
import os
import shutil
import sys
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ORIGIN = sys.argv[1].rstrip("/")
LOCAL = urlsplit(ORIGIN)
assert LOCAL.scheme == "http" and LOCAL.hostname == "127.0.0.1"

# Inert probes detect HTML or attribute interpretation without running script.
MARKUP = """<img src="/__crateflow_probe" onerror="/* fixture */"><script>/* fixture */</script>javascript:fixture & "'"""
TRACK_ID = 'track" data-unsafe-fixture="unexpected" data-end="'
PROVIDER = {
    "externalId": "17", "provider": "api.sh", "name": "Provider " + MARKUP,
    "artist": "Provider artist " + MARKUP, "mixHint": "Radio Remix", "url": "javascript:fixture",
}
BACKUP = {
    "tracks": [
        {
            "id": TRACK_ID, "title": "Track " + MARKUP, "artist": "Artist " + MARKUP,
            "genre": "Genre " + MARKUP, "status": "pending", "key": "8A", "bpm": 126, "playlistId": "old",
            "studioResult": "review", "catalog": {"provider": "api.sh", "candidates": [PROVIDER]},
        },
        {"id": "second", "title": "Sparse optional metadata", "status": "owned", "playlistId": "old"},
    ],
    "playlists": [
        {"id": "old", "name": "Legacy " + MARKUP},
        {"id": "ordered", "name": "Ordered " + MARKUP, "trackIds": [TRACK_ID, "second", TRACK_ID]},
    ],
}


def nav(page, target):
    page.locator(f'#navigation button[data-page="{target}"]').click()


def restore(page, fixture):
    page.locator("#restore").set_input_files({
        "name": "synthetic.json", "mimeType": "application/json", "buffer": json.dumps(fixture).encode(),
    })


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"),
        args=["--disable-background-networking"],
    )
    context = browser.new_context()
    unexpected, errors, provider_calls = [], [], []

    def intercept(route):
        request = route.request
        target = urlsplit(request.url)
        if (target.scheme, target.netloc) != (LOCAL.scheme, LOCAL.netloc):
            return route.abort()
        if target.path == "/__crateflow_probe":
            unexpected.append(target.path)
            return route.abort()
        if request.method == "POST" and target.path == "/api/search-beatport-primary":
            provider_calls.append(target.path)
            return route.fulfill(status=200, json={"ok": True, "candidates": [PROVIDER]})
        if request.method == "POST" and target.path == "/api/search-beatport":
            provider_calls.append(target.path)
            return route.fulfill(status=200, json={"ok": True, "candidates": []})
        if target.path.startswith("/api/"):
            unexpected.append(target.path)
            return route.abort()
        return route.continue_()

    def check_plain_text(page):
        assert not page.locator("#view script, #view [onerror], #view [data-unsafe-fixture], #view [href^='javascript:']").count()
        assert not unexpected and not errors, (unexpected, errors)

    context.route("**/*", intercept)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    confirmations = []

    def accept(dialog):
        confirmations.append(dialog.message)
        dialog.accept()

    page.on("dialog", accept)
    page.goto(ORIGIN + "/?app=1", wait_until="domcontentloaded")
    page.evaluate("sessionStorage.setItem('beatport_server_verified','yes')")
    nav(page, "library")
    restore(page, BACKUP)
    expect(page.locator("#toast")).to_have_text("Backup restored")
    assert len(confirmations) == 1
    stored = page.evaluate("localStorage.getItem('crateflow_v1')")
    assert json.loads(stored)["tracks"] == BACKUP["tracks"]
    assert json.loads(stored)["playlists"] == BACKUP["playlists"]

    page.locator("#playlistFilter").select_option("ordered")
    rows = page.locator("#view tbody tr")
    expect(rows).to_have_count(3)
    expect(rows.nth(0).locator("strong")).to_have_text("Track " + MARKUP)
    expect(rows.nth(0).locator("small")).to_contain_text("Artist " + MARKUP)
    expect(rows.nth(0)).to_contain_text("Genre " + MARKUP)
    expect(rows.nth(0).locator("[data-act=edit]")).to_have_attribute("data-id", TRACK_ID)
    expect(rows.nth(1).locator("strong")).to_have_text("Sparse optional metadata")
    expect(rows.nth(2).locator("strong")).to_have_text("Track " + MARKUP)
    check_plain_text(page)
    page.get_by_role("button", name="Edit playlist").click()
    expect(page.locator("#playlist-editor-title")).to_have_text("Ordered " + MARKUP)
    expect(page.locator("#playlist-editor li")).to_have_count(3)
    check_plain_text(page)

    restore(page, {"tracks": [{"id": "missing-status", "title": "Rejected"}], "playlists": []})
    expect(page.locator("#toast")).to_contain_text("Track 1 status")
    assert len(confirmations) == 1, confirmations
    expect(page.locator("#playlist-editor-title")).to_have_text("Ordered " + MARKUP)
    assert page.evaluate("localStorage.getItem('crateflow_v1')") == stored

    page.reload(wait_until="domcontentloaded")
    nav(page, "library")
    page.locator("#playlistFilter").select_option("old")
    expect(rows).to_have_count(2)
    nav(page, "import")
    expect(page.locator(".compact-check")).to_have_attribute("data-id", TRACK_ID)
    expect(page.locator(".compact-option strong")).to_have_text(PROVIDER["name"])
    expect(page.locator("[data-act=studioChoose]")).to_have_attribute("data-id", TRACK_ID)
    check_plain_text(page)
    page.get_by_role("button", name="SEARCH AGAIN").click()
    expect(page.locator("#toast")).to_contain_text("1 review", timeout=12000)
    expect(page.locator(".compact-option strong")).to_have_text(PROVIDER["name"])
    assert provider_calls == ["/api/search-beatport-primary", "/api/search-beatport"]
    check_plain_text(page)
    print("Browser: invalid status rejected before confirmation, backup order retained, HTML and attributes remain inert in the Library, editor, and mocked provider results.")
    browser.close()
