import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import '../lib/playlist-model.js';
import { createImportBrowser } from './fixtures/browser-import.js';

const { readLocalPlaylistModel, editorPlaylist, editPlaylist } = globalThis.CrateflowPlaylistModel;

test('membership rows reference the library and preserve order, repeated entries and shared tracks', () => {
  const snapshot = {
    tracks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    playlists: [
      { id: 'first', name: 'Same name', spotifyPlaylistId: 'S'.repeat(22), trackIds: ['b', 'a', 'b'] },
      { id: 'second', name: 'Same name', trackIds: ['b'] },
    ],
  };
  const original = structuredClone(snapshot);
  const model = readLocalPlaylistModel(snapshot);

  assert.deepEqual(model.playlists, [
    { id: 'first', name: 'Same name', folderId: null, spotifyPlaylistId: 'S'.repeat(22) },
    { id: 'second', name: 'Same name', folderId: null, spotifyPlaylistId: null },
  ]);
  assert.deepEqual(model.memberships.map(({ id, ...row }) => row), [
    { playlistId: 'first', libraryTrackId: 'b', position: 0 },
    { playlistId: 'first', libraryTrackId: 'a', position: 1 },
    { playlistId: 'first', libraryTrackId: 'b', position: 2 },
    { playlistId: 'second', libraryTrackId: 'b', position: 0 },
  ]);
  assert.equal(new Set(model.memberships.map(row => row.id)).size, 4);
  assert.deepEqual(readLocalPlaylistModel(snapshot), model);
  assert.deepEqual(model.issues, []);
  assert.deepEqual(snapshot, original);

});

test('the model reads old backups with the same membership and order as the running app', () => {
  const snapshot = {
    tracks: [
      { id: 'b', title: 'B', status: 'pending', playlistId: 'legacy' },
      { id: 'a', title: 'A', status: 'pending', playlistId: 'legacy' },
      { id: 'c', title: 'C', status: 'pending', playlistId: 'empty' },
    ],
    playlists: [
      { id: 'legacy', name: 'Legacy' },
      { id: 'empty', name: 'Empty', trackIds: [] },
      { id: 'explicit', name: 'Explicit', trackIds: ['a', 'b', 'a'] },
    ],
  };
  const model = readLocalPlaylistModel(snapshot);
  const browser = createImportBrowser(undefined, snapshot);
  const membershipsFor = id => model.memberships.filter(row => row.playlistId === id).map(row => row.libraryTrackId);

  assert.deepEqual(membershipsFor('legacy'), ['b', 'a']);
  assert.deepEqual(membershipsFor('empty'), []);
  assert.deepEqual(membershipsFor('explicit'), ['a', 'b', 'a']);
  for (const { id } of snapshot.playlists) {
    assert.deepEqual(membershipsFor(id), Array.from(browser.visiblePlaylist(id), track => track.id));
  }
  assert.deepEqual(model.issues, []);
  assert.deepEqual(browser.snapshot(), snapshot);
});

test('orphaned references and ambiguous IDs are reported without guessing or renumbering', () => {
  const model = readLocalPlaylistModel({
    tracks: [
      { id: 'shared-id', title: 'First record' },
      { id: 'shared-id', title: 'Second record' },
      { id: 'valid', playlistId: 'missing-list' },
    ],
    playlists: [
      { id: 'good', name: 'Good', trackIds: ['shared-id', 'missing-track', 'valid'] },
      { id: 'duplicate', name: 'First list', trackIds: ['valid'] },
      { id: 'duplicate', name: 'Second list' },
      { id: '', name: 'No stable ID' },
    ],
  });

  assert.deepEqual(model.playlists.map(row => row.id), ['good']);
  assert.deepEqual(model.memberships.map(({ id, ...row }) => row), [
    { playlistId: 'good', libraryTrackId: 'valid', position: 2 },
  ]);
  assert.deepEqual(model.issues, [
    { type: 'missing-playlist', playlistId: 'missing-list', libraryTrackId: 'valid' },
    { type: 'ambiguous-track', playlistId: 'good', libraryTrackId: 'shared-id', position: 0 },
    { type: 'missing-track', playlistId: 'good', libraryTrackId: 'missing-track', position: 1 },
    { type: 'ambiguous-playlist', playlistId: 'duplicate', index: 1 },
    { type: 'ambiguous-playlist', playlistId: 'duplicate', index: 2 },
    { type: 'invalid-playlist-id', playlistId: '', index: 3 },
  ]);
});

function editorSnapshot() {
  return {
    tracks: [{ id: 'same', title: 'Same' }, { id: 'other', title: 'Other' }],
    playlists: [
      { id: 'first', trackIds: ['same', 'other', 'same'] },
      { id: 'second', trackIds: ['same'] },
    ],
  };
}

test('editing assigns durable UUIDs, moves a specific repeated entry and keeps another playlist intact', () => {
  const original = editorSnapshot();
  const legacy = editorPlaylist(original, 'first').entries;
  const added = editPlaylist(original, 'first', { type: 'add', trackId: 'same' }, randomUUID);
  const saved = { ...original, playlists: added.playlists };
  const initial = editorPlaylist(saved, 'first').entries;
  const ids = initial.map(row => row.id);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every(id => /^[0-9a-f-]{36}$/.test(id)));
  assert.equal(added.entryId, ids[3]);

  const moved = editPlaylist(saved, 'first', { type: 'move', entryId: ids[2], targetId: ids[0], side: 'before' }, randomUUID);
  const reloaded = JSON.parse(JSON.stringify({ ...saved, playlists: moved.playlists }));
  assert.deepEqual(editorPlaylist(reloaded, 'first').entries.map(row => row.id), [ids[2], ids[0], ids[1], ids[3]]);
  assert.deepEqual(reloaded.playlists[0].trackIds, ['same', 'same', 'other', 'same']);
  assert.deepEqual(reloaded.playlists[1], original.playlists[1]);
  assert.deepEqual(editorPlaylist(original, 'first').entries, legacy);
  assert.deepEqual(original, editorSnapshot());
});

test('removing one legacy occurrence leaves the other occurrence and both library records', () => {
  const original = editorSnapshot();
  const { entries } = editorPlaylist(original, 'first');
  const result = editPlaylist(original, 'first', { type: 'remove', entryId: entries[2].id }, randomUUID);
  assert.deepEqual(result.playlists[0].trackIds, ['same', 'other']);
  assert.strictEqual(result.playlists[1], original.playlists[1]);
  assert.equal(original.tracks.length, 2);
  assert.deepEqual(original.playlists[0].trackIds, ['same', 'other', 'same']);
});

test('the editor rejects cross-playlist targets, foreign entry IDs, and absent library tracks', () => {
  const snapshot = editorSnapshot();
  const first = editorPlaylist(snapshot, 'first').entries[0].id;
  const second = editorPlaylist(snapshot, 'second').entries[0].id;
  assert.equal(editPlaylist(snapshot, 'first', { type: 'move', entryId: first, targetId: second, side: 'after' }, randomUUID), null);
  assert.equal(editPlaylist(snapshot, 'first', { type: 'remove', entryId: second }, randomUUID), null);
  assert.equal(editPlaylist(snapshot, 'first', { type: 'add', trackId: 'unknown' }, randomUUID), null);
  assert.equal(editPlaylist(snapshot, 'first', { type: 'move', entryId: first, targetId: first, side: 'after' }, randomUUID), null);
});

test('an older app’s trackIds edit takes priority over mismatched UUID metadata', () => {
  const original = editorSnapshot();
  const added = editPlaylist(original, 'first', { type: 'add', trackId: 'same' }, randomUUID);
  const playlist = { ...added.playlists[0], trackIds: ['other', 'same', 'same', 'same'] };
  const snapshot = { ...original, playlists: [playlist] };
  const { entries } = editorPlaylist(snapshot, 'first');
  assert.deepEqual(entries.map(entry => entry.libraryTrackId), playlist.trackIds);
  assert.ok(entries.every(entry => entry.id.startsWith('legacy:')));
  assert.equal(playlist.memberships[0].libraryTrackId, 'same');
});
