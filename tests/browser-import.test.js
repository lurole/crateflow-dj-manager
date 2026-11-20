import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportBrowser } from './fixtures/browser-import.js';

const firstTrackId = 'A'.repeat(22);
const secondTrackId = 'B'.repeat(22);
const firstPlaylistId = 'C'.repeat(22);
const secondPlaylistId = 'D'.repeat(22);
const sharedTrackId = 'E'.repeat(22);

function mockSpotify(responses, savedState) {
  const calls = [];
  const browser = createImportBrowser(async (path, { body }) => {
    const { id, nextParam } = JSON.parse(body);
    calls.push({ path, id, ...(nextParam ? { nextParam } : {}) });
    const response = responses.get(nextParam ? id + ':' + nextParam : id);
    if (!response) throw new Error('No Spotify fixture for ' + id);
    return { ok: true, json: async () => ({ ok: true, ...response }) };
  }, savedState);
  return { ...browser, calls };
}

function spotifyLinks(kind, ...ids) {
  return ids.map(id => 'https://open.spotify.com/' + kind + '/' + id).join('\n');
}

function playlistMemberships(snapshot) {
  const tracks = new Map(snapshot.tracks.map(track => [track.id, track.spotifyId]));
  return snapshot.playlists.map(playlist => playlist.trackIds.map(id => tracks.get(id)));
}

test('Spotify track IDs distinguish versions with the same title and artist', async () => {
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
  assert.deepEqual(importedIds, [firstTrackId, secondTrackId]);
});

test('two Spotify playlists imported together retain their own track membership', async () => {
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

  const snapshot = browser.snapshot();
  assert.deepEqual(snapshot.playlists.map(item => item.spotifyPlaylistId), [firstPlaylistId, secondPlaylistId]);
  assert.deepEqual(playlistMemberships(snapshot), [[firstTrackId], [secondTrackId]]);
});

test('a shared Spotify track retains membership in both imported playlists', async () => {
  const artist = 'Fixture Artist';
  const shared = { title: 'Shared Track', artist, spotifyId: sharedTrackId };
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [{ title: 'First Track', artist, spotifyId: firstTrackId }, shared] }],
    [secondPlaylistId, { tracks: [{ title: 'Second Track', artist, spotifyId: secondTrackId }, shared] }],
  ]));

  const result = await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  assert.equal(result.hasUnresolved, false);
  assert.equal(browser.calls.length, 2);

  const snapshot = browser.snapshot();
  assert.equal(snapshot.tracks.filter(track => track.spotifyId === sharedTrackId).length, 1);
  assert.ok(snapshot.tracks.every(track => !Object.hasOwn(track, 'playlistId')));
  assert.deepEqual(playlistMemberships(snapshot), [
    [firstTrackId, sharedTrackId],
    [secondTrackId, sharedTrackId],
  ]);
});

const fixtureTrack = (title, fields = {}) => ({ title, artist: 'Fixture Artist', ...fields });

test('playlist pages and intentional repetitions retain source order across reimport', async () => {
  const shared = fixtureTrack('Z Title', { spotifyId: sharedTrackId });
  const another = fixtureTrack('A Title', { spotifyId: firstTrackId });
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [shared], nextParam: 'page2' }],
    [firstPlaylistId + ':page2', { tracks: [another, shared] }],
  ]));

  const input = spotifyLinks('playlist', firstPlaylistId);
  const result = await browser.importText(input);
  assert.equal(result.added, 2);
  assert.equal(result.linked, 3);
  assert.equal(browser.calls[1].nextParam, 'page2');
  const previous = browser.snapshot();
  assert.deepEqual(playlistMemberships(previous), [[sharedTrackId, firstTrackId, sharedTrackId]]);
  assert.deepEqual(Array.from(browser.visiblePlaylist(previous.playlists[0].id), track => track.spotifyId),
    [sharedTrackId, firstTrackId, sharedTrackId]);
  const reloaded = createImportBrowser(undefined, previous);
  assert.deepEqual(Array.from(reloaded.visiblePlaylist(previous.playlists[0].id), track => track.spotifyId),
    [sharedTrackId, firstTrackId, sharedTrackId]);
  assert.deepEqual(reloaded.snapshot(), previous);
  assert.equal(browser.visiblePlaylist('all').length, 2);

  const repeat = await browser.importText(input);
  assert.equal(repeat.added, 0);
  assert.equal(repeat.linked, 0);
  assert.deepEqual(browser.snapshot(), previous);
});

test('a truncated playlist keeps its own entries and an empty playlist stays separate', async () => {
  const first = fixtureTrack('First', { spotifyId: firstTrackId });
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [first], nextParam: 'missing' }],
    [secondPlaylistId, { tracks: [] }],
  ]));

  const result = await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  assert.equal(result.hasUnresolved, true);
  assert.match(result.message, /only 1 accessible tracks/);
  assert.deepEqual(playlistMemberships(browser.snapshot()), [[firstTrackId], []]);
});

test('legacy membership and edited track data survive reimport using the same Spotify ID', async () => {
  const legacy = fixtureTrack('Edited title', {
    id: 'old-track', playlistId: 'legacy', spotifyId: firstTrackId,
    importTitle: 'First Track', status: 'downloaded', filePath: '/local/file.mp3', bpm: 125,
  });
  const legacyPlaylist = { id: 'legacy', name: 'Old Playlist' };
  const savedState = { tracks: [legacy], playlists: [legacyPlaylist], syncHistory: [], settings: { preferExtended: false } };
  const resolved = fixtureTrack('First Track', { spotifyId: firstTrackId });
  const browser = mockSpotify(new Map([[firstPlaylistId, { tracks: [resolved] }]]), savedState);

  assert.deepEqual(browser.snapshot(), savedState);
  assert.deepEqual(Array.from(browser.visiblePlaylist('legacy'), track => track.id), ['old-track']);
  const result = await browser.importText(spotifyLinks('playlist', firstPlaylistId));
  assert.equal(result.added, 0);
  assert.equal(result.linked, 1);
  const snapshot = browser.snapshot();
  assert.deepEqual(snapshot.tracks, [legacy]);
  assert.deepEqual(snapshot.playlists[0], legacyPlaylist);
  assert.deepEqual(snapshot.playlists[1].trackIds, ['old-track']);
});

test('restoring a legacy backup preserves its membership until an explicit import edits that playlist', async () => {
  const tracks = [
    fixtureTrack('Second', { id: 'second', playlistId: 'legacy', status: 'downloaded', filePath: '/music/second.mp3' }),
    fixtureTrack('First', { id: 'first', playlistId: 'legacy', status: 'pending' }),
    fixtureTrack('Unassigned', { id: 'hidden', playlistId: 'empty', status: 'pending' }),
  ];
  const playlists = [
    { id: 'legacy', name: 'Quick Import' },
    { id: 'empty', name: 'Empty', trackIds: [] },
  ];
  const browser = createImportBrowser(undefined);
  await browser.restoreBackup({ tracks, playlists });

  assert.deepEqual(Array.from(browser.visiblePlaylist('legacy'), track => track.id), ['second', 'first']);
  assert.equal(browser.visiblePlaylist('empty').length, 0);
  assert.deepEqual(browser.snapshot().tracks, tracks);
  assert.deepEqual(browser.snapshot().playlists, playlists);

  await browser.importText('Fixture Artist – New first\nFixture Artist – New second');
  const snapshot = browser.snapshot();
  assert.deepEqual(snapshot.tracks.slice(2), tracks);
  assert.deepEqual(snapshot.playlists[1], playlists[1]);
  assert.deepEqual(snapshot.playlists[0].trackIds, [snapshot.tracks[0].id, snapshot.tracks[1].id, 'second', 'first']);
  assert.deepEqual(Array.from(browser.visiblePlaylist('legacy'), track => track.title),
    ['New second', 'New first', 'Second', 'First']);
});

test('the playlist filter leaves damaged references and other saved records intact', async () => {
  const tracks = [
    fixtureTrack('Good', { id: 'good', status: 'pending' }),
    fixtureTrack('First duplicate', { id: 'duplicate', status: 'pending' }),
    fixtureTrack('Second duplicate', { id: 'duplicate', status: 'pending' }),
  ];
  const playlists = [{ id: 'playlist', name: 'Quick Import', trackIds: ['duplicate', 'missing', 'good'] }];
  const savedState = { tracks, playlists, settings: {} };
  const browser = createImportBrowser(undefined, savedState);

  assert.deepEqual(Array.from(browser.visiblePlaylist('playlist'), track => track.id), ['good']);
  assert.equal(browser.visiblePlaylist('all').length, 3);
  assert.deepEqual(browser.snapshot(), savedState);

  await browser.importText('Fixture Artist – New track');
  const snapshot = browser.snapshot();
  assert.deepEqual(snapshot.tracks.slice(1), tracks);
  assert.deepEqual(snapshot.playlists[0].trackIds, [snapshot.tracks[0].id, ...playlists[0].trackIds]);
});

test('confirmed library deletion cleans all of a track’s playlist occurrences and keeps the other entries ordered', () => {
  const shared = fixtureTrack('Shared', { id: 'shared', status: 'pending', playlistId: 'legacy' });
  const retained = fixtureTrack('Retained', { id: 'retained', status: 'pending', playlistId: 'legacy' });
  const other = fixtureTrack('Other', { id: 'other', status: 'pending' });
  const playlists = [
    { id: 'legacy', name: 'Legacy' },
    { id: 'first', name: 'First', trackIds: ['shared', 'retained', 'shared', 'other'] },
    { id: 'second', name: 'Second', trackIds: ['other', 'shared', 'retained'] },
  ];
  const browser = createImportBrowser(undefined, { tracks: [shared, retained, other], playlists, settings: {} });
  browser.deleteTrack('shared');

  const snapshot = browser.snapshot();
  assert.deepEqual(snapshot.tracks, [retained, other]);
  assert.deepEqual(snapshot.playlists.map(({ memberships, ...playlist }) => playlist), [
    playlists[0],
    { ...playlists[1], trackIds: ['retained', 'other'] },
    { ...playlists[2], trackIds: ['other', 'retained'] },
  ]);
  for (const playlist of snapshot.playlists.slice(1)) {
    assert.deepEqual(playlist.memberships.map(entry => entry.libraryTrackId), playlist.trackIds);
  }
  assert.deepEqual(Array.from(browser.visiblePlaylist('legacy'), track => track.id), ['retained']);
});

test('matching text without a Spotify ID cannot absorb a Spotify or unverified playlist entry', async () => {
  const metadata = fixtureTrack('Same track');
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [{ ...metadata, spotifyId: firstTrackId }, metadata] }],
    [secondPlaylistId, { tracks: [metadata] }],
  ]));
  await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  const snapshot = browser.snapshot();
  assert.equal(snapshot.tracks.length, 3);
  const [first, second] = snapshot.playlists;
  assert.equal(first.trackIds.length, 2);
  assert.equal(second.trackIds.length, 1);
  assert.ok(!first.trackIds.includes(second.trackIds[0]));
});

test('identical ISRC and complete metadata reuse an ID-less entry without merging different mixes', async () => {
  const identical = fixtureTrack('Same Title', { isrc: 'USABC1234567', remix: 'Original Mix' });
  const different = { ...identical, remix: 'Extended Mix' };
  const browser = mockSpotify(new Map([
    [firstPlaylistId, { tracks: [identical] }],
    [secondPlaylistId, { tracks: [identical, different] }],
  ]));
  await browser.importText(spotifyLinks('playlist', firstPlaylistId, secondPlaylistId));
  const snapshot = browser.snapshot();
  const [first, second] = snapshot.playlists;
  assert.equal(snapshot.tracks.length, 2);
  assert.equal(first.trackIds[0], second.trackIds[0]);
  assert.notEqual(first.trackIds[0], second.trackIds[1]);
});

test('conflicting versions under one Spotify ID are retained as distinct entries', async () => {
  const original = fixtureTrack('Same Title', { spotifyId: firstTrackId, remix: 'Original Mix' });
  const radio = { ...original, remix: 'Radio Edit' };
  const browser = mockSpotify(new Map([[firstPlaylistId, { tracks: [original, radio] }]]));
  const input = spotifyLinks('playlist', firstPlaylistId);
  await browser.importText(input);
  const snapshot = browser.snapshot();
  assert.equal(snapshot.tracks.length, 2);
  assert.notEqual(...snapshot.playlists[0].trackIds);
  const repeat = await browser.importText(input);
  assert.equal(repeat.added, 0);
  assert.equal(repeat.linked, 0);
});

test('old matches are rechecked without rewriting saved match evidence on load', () => {
  const candidate = { name: 'Fixture Track (Alex Extended Remix)', artist: 'Fixture Artist', externalId: '123' };
  const selected = fixtureTrack(candidate.name, {
    id: 'legacy-match', status: 'pending', studioResult: 'exact', studioCandidate: candidate,
    importTitle: 'Fixture Track (Alex Radio Remix)',
    catalog: { candidates: [candidate] },
  });
  const correct = { ...selected, id: 'correct-match', importTitle: candidate.name };
  const savedState = { tracks: [selected, correct], playlists: [], settings: {} };
  const browser = createImportBrowser(undefined, savedState);
  assert.equal(browser.checkMatch(selected), 'review');
  assert.equal(browser.checkMatch(correct), 'exact');
  assert.deepEqual(browser.snapshot(), savedState);
});

test('an ambiguous primary result does not auto-select a fallback candidate', async () => {
  const track = fixtureTrack('Fixture Track (Original Mix)', { id: 'fixture' });
  const calls = [];
  const candidates = ['101', '102'].map(externalId => ({
    name: track.title, artist: track.artist, externalId, provider: 'api.sh',
  }));
  const browser = createImportBrowser(async path => {
    calls.push(path);
    return { ok: true, json: async () => ({ ok: true, candidates }) };
  });
  assert.equal((await browser.searchCatalog(track)).length, 2);
  assert.deepEqual(calls, ['/api/search-beatport-primary']);
  assert.equal(browser.snapshot().catalogCache, undefined);
});
