import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import '../lib/playlist-model.js';
import { createImportBrowser } from './fixtures/browser-import.js';

const { managePlaylist, editorPlaylist } = globalThis.CrateflowPlaylistModel;

function library() {
  return {
    tracks: [
      { id: 'a', title: 'Old track', status: 'pending', playlistId: 'legacy' },
      { id: 'b', title: 'Another track', status: 'downloaded' },
    ],
    playlists: [
      { id: 'legacy', name: 'Café', spotifyPlaylistId: 'P'.repeat(22) },
      { id: 'ordered', name: 'Ordered', trackIds: ['b', 'a', 'b'], memberships: [
        { id: randomUUID(), libraryTrackId: 'b' },
        { id: randomUUID(), libraryTrackId: 'a' },
        { id: randomUUID(), libraryTrackId: 'b' },
      ] },
    ],
  };
}

test('creating an empty playlist validates and normalizes names without changing the library', () => {
  const original = library();
  const duplicate = managePlaylist(original, { type: 'create', name: '    CAFE\u0301   ' }, randomUUID);
  assert.match(duplicate.error, /already exists/);
  for (const name of ['', '   ', 'a\nb', 'a\u202Eb', 'a'.repeat(251)]) {
    assert.match(managePlaylist(original, { type: 'create', name }, randomUUID).error, /Enter a playlist name/);
  }

  const id = randomUUID();
  const result = managePlaylist(original, { type: 'create', name: '  Édit 🎵  ' }, () => id);
  assert.deepEqual(result.playlists.at(-1), { id, name: 'Édit 🎵', trackIds: [], memberships: [] });
  assert.deepEqual(result.playlists.slice(0, 2), original.playlists);
  assert.strictEqual(result.tracks, original.tracks);
  assert.deepEqual(editorPlaylist(result, id).entries, []);
});

test('renaming keeps source identity, legacy assignments and the order and IDs of repeated tracks', () => {
  const saved = library();
  const legacy = managePlaylist(saved, { type: 'rename', playlistId: 'legacy', name: 'Warmup' }, randomUUID);
  assert.equal(legacy.playlists[0].spotifyPlaylistId, saved.playlists[0].spotifyPlaylistId);
  assert.deepEqual(editorPlaylist(legacy, 'legacy').entries.map(row => row.libraryTrackId), ['a']);
  assert.match(managePlaylist(legacy, { type: 'rename', playlistId: 'legacy', name: ' ordered ' }, randomUUID).error, /already exists/);

  const ordered = managePlaylist(legacy, { type: 'rename', playlistId: 'ordered', name: 'Evening set' }, randomUUID);
  assert.deepEqual(ordered.playlists[1], { ...saved.playlists[1], name: 'Evening set' });
  assert.strictEqual(ordered.tracks, saved.tracks);
  assert.strictEqual(managePlaylist(ordered, { type: 'rename', playlistId: 'ordered', name: 'Evening set' }, randomUUID).playlists, ordered.playlists);
});

test('deleting a playlist clears only its legacy assignment and keeps other playlists intact', () => {
  const saved = library();
  const result = managePlaylist(saved, { type: 'delete', playlistId: 'legacy' }, randomUUID);
  assert.deepEqual(result.playlists, [saved.playlists[1]]);
  assert.deepEqual(result.tracks, [{ id: 'a', title: 'Old track', status: 'pending' }, saved.tracks[1]]);
  assert.equal(saved.tracks[0].playlistId, 'legacy');
  assert.equal(result.playlistId, null);
  assert.match(managePlaylist(saved, { type: 'delete', playlistId: 'missing' }, randomUUID).error, /unavailable/);
});

test('restoring an older backup resets a stale playlist, search, status and editor selection', async () => {
  const oldBackup = library();
  const browser = createImportBrowser(undefined, { tracks: [{ id: 'removed', title: 'Different', status: 'owned' }], playlists: [] });
  browser.setLibraryView('closed-playlist', 'missing search', 'owned');
  await browser.restoreBackup(oldBackup);

  const view = JSON.parse(JSON.stringify(browser.libraryViewState()));
  assert.deepEqual(view, { playlistFilter: 'all', search: '', filter: 'all', playlistEditorOpen: false, trackIds: ['a', 'b'] });
  assert.deepEqual(browser.snapshot().tracks, oldBackup.tracks);
  assert.deepEqual(browser.snapshot().playlists, oldBackup.playlists);
  assert.deepEqual(Array.from(browser.visiblePlaylist('legacy'), track => track.id), ['a']);
});

test('a failed backup save leaves the active library and its filters intact', async () => {
  const original = library();
  const browser = createImportBrowser(undefined, original);
  browser.setLibraryView('legacy', '', 'pending');
  browser.failStorageWrites();
  await browser.restoreBackup({ tracks: [], playlists: [] });

  assert.deepEqual(browser.snapshot(), original);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.libraryViewState())), {
    playlistFilter: 'legacy', search: '', filter: 'pending', playlistEditorOpen: true, trackIds: ['a'],
  });
});
