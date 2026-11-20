import assert from 'node:assert/strict';
import test from 'node:test';
import '../lib/playlist-model.js';
import { createImportBrowser } from './fixtures/browser-import.js';

const { readLocalPlaylistModel } = globalThis.CrateflowPlaylistModel;

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
  assert.deepEqual(model.memberships.map(({ key, ...row }) => row), [
    { playlistId: 'first', libraryTrackId: 'b', position: 0 },
    { playlistId: 'first', libraryTrackId: 'a', position: 1 },
    { playlistId: 'first', libraryTrackId: 'b', position: 2 },
    { playlistId: 'second', libraryTrackId: 'b', position: 0 },
  ]);
  assert.equal(new Set(model.memberships.map(row => row.key)).size, 4);
  assert.deepEqual(readLocalPlaylistModel(snapshot), model);
  assert.deepEqual(model.issues, []);
  assert.deepEqual(snapshot, original);

  const reordered = structuredClone(snapshot);
  reordered.playlists[0].trackIds = ['b', 'b', 'a'];
  assert.deepEqual(readLocalPlaylistModel(reordered).memberships.map(row => row.key),
    [0, 2, 1, 3].map(index => model.memberships[index].key));
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
  assert.deepEqual(model.memberships.map(({ key, ...row }) => row), [
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
