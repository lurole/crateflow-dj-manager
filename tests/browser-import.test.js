import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportBrowser } from './fixtures/browser-import.js';
import { assertRegression } from './fixtures/known-regression.js';

const firstTrackId = 'A'.repeat(22);
const secondTrackId = 'B'.repeat(22);
const firstPlaylistId = 'C'.repeat(22);
const secondPlaylistId = 'D'.repeat(22);
const sharedTrackId = 'E'.repeat(22);

function mockSpotify(responses) {
  const calls = [];
  const browser = createImportBrowser(async (path, { body }) => {
    const { id } = JSON.parse(body);
    calls.push({ path, id });
    const response = responses.get(id);
    if (!response) throw new Error('No Spotify fixture for ' + id);
    return { ok: true, json: async () => ({ ok: true, ...response }) };
  });
  return { ...browser, calls };
}

function spotifyLinks(kind, ...ids) {
  return ids.map(id => 'https://open.spotify.com/' + kind + '/' + id).join('\n');
}

function playlistMemberships(snapshot) {
  return snapshot.playlists.map(playlist =>
    snapshot.tracks.filter(track => track.playlistId === playlist.id).map(track => track.spotifyId).sort()
  );
}

test('Spotify track IDs distinguish versions with the same title and artist', async t => {
  const track = { title: 'Fixture Track', artist: 'Fixture Artist' };
  const browser = mockSpotify(new Map([
    [firstTrackId, { track: { ...track, spotifyId: firstTrackId } }],
    [secondTrackId, { track: { ...track, spotifyId: secondTrackId } }],
  ]));

  const result = await browser.importText(spotifyLinks('track', firstTrackId, secondTrackId));
  assert.equal(result.resolved, 2);
  assert.deepEqual(browser.calls, [
    { path: '/api/resolve-spotify-track', id: firstTrackId },
    { path: '/api/resolve-spotify-track', id: secondTrackId },
  ]);

  const importedIds = browser.snapshot().tracks.map(item => item.spotifyId).sort();
  assertRegression(t, importedIds, [firstTrackId, secondTrackId], {
    knownResult: [firstTrackId],
    reason: 'The title and artist fallback discards a different Spotify ID.',
  });
});

test('two Spotify playlists imported together retain their own track membership', async t => {
  const artist = 'Fixture Artist';
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [{ title: 'First Track', artist, spotifyId: firstTrackId }] }],
    [secondPlaylistId, { tracks: [{ title: 'Second Track', artist, spotifyId: secondTrackId }] }],
  ]));

  const result = await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  assert.equal(result.added, 2);
  assert.equal(result.hasUnresolved, false);
  assert.deepEqual(browser.calls, [
    { path: '/api/resolve-spotify-playlist', id: firstPlaylistId },
    { path: '/api/resolve-spotify-playlist', id: secondPlaylistId },
  ]);

  assertRegression(t, playlistMemberships(browser.snapshot()), [[firstTrackId], [secondTrackId]], {
    knownResult: [[firstTrackId, secondTrackId]],
    reason: 'The browser puts both Spotify playlists in a single Quick Import playlist.',
  });
});

test('a shared Spotify track retains membership in both imported playlists', async t => {
  const artist = 'Fixture Artist';
  const shared = { title: 'Shared Track', artist, spotifyId: sharedTrackId };
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [{ title: 'First Track', artist, spotifyId: firstTrackId }, shared] }],
    [secondPlaylistId, { tracks: [{ title: 'Second Track', artist, spotifyId: secondTrackId }, shared] }],
  ]));

  const result = await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  assert.equal(result.hasUnresolved, false);
  assert.equal(browser.calls.length, 2);

  assertRegression(t, playlistMemberships(browser.snapshot()), [
    [firstTrackId, sharedTrackId],
    [secondTrackId, sharedTrackId],
  ], {
    knownResult: [[firstTrackId, secondTrackId, sharedTrackId]],
    reason: 'The browser collapses playlists and only stores one playlistId per track.',
  });
});
