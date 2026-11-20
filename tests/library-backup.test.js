import assert from 'node:assert/strict';
import test from 'node:test';
import '../lib/library-backup.js';
import { createImportBrowser } from './fixtures/browser-import.js';

const { parse } = globalThis.CrateflowLibraryBackup;
const track = { id: 'track', title: 'Stored track', status: 'pending', playlistId: 'old' };
const backup = { tracks: [track], playlists: [{ id: 'old', name: 'Old set' }] };
const read = value => parse(JSON.stringify(value));

test('invalid track status and missing or malformed required fields are rejected with a field-specific message', () => {
  for (const [field, value] of [['status', undefined], ['status', 'unknown'], ['status', null], ['status', 2],
    ['title', '   '], ['title', undefined], ['title', {}], ['id', undefined], ['id', 'x\u0000y'], ['id', 123]]) {
    assert.throws(() => read({ ...backup, tracks: [{ ...track, [field]: value }] }),
      new RegExp('Track 1 ' + field, 'i'));
  }
  assert.throws(() => read({ ...backup, tracks: [null] }), /Track 1 must be an object/);
  assert.throws(() => read({ ...backup, playlists: [{ id: 'old' }] }), /Playlist 1 name/);
  assert.throws(() => read({ ...backup, playlists: [{ name: 'Missing ID' }] }), /Playlist 1 ID/);
  assert.throws(() => read({ ...backup, tracks: [track, track] }), /Track IDs must be unique/);
  assert.throws(() => read({ ...backup, playlists: [backup.playlists[0], backup.playlists[0]] }), /Playlist IDs must be unique/);
});

test('wrong container and metadata types are rejected before any restore', () => {
  for (const [candidate, expected] of [
    [null, /JSON object/], [{ tracks: [], playlists: {} }, /Playlist must be a list/],
    [{ ...backup, settings: [] }, /Settings must be an object/],
    [{ ...backup, syncHistory: {} }, /History entry must be a list/],
    [{ ...backup, tracks: [{ ...track, genre: { toString: 'not a string' } }] }, /Track 1 genre/],
    [{ ...backup, tracks: [{ ...track, catalog: { candidates: [null] } }] }, /Track 1 catalog candidate 1/],
    [{ ...backup, playlists: [{ ...backup.playlists[0], trackIds: [1] }] }, /Playlist 1 track IDs/],
    [{ ...backup, playlists: [{ ...backup.playlists[0], memberships: [{ id: 'only-id' }] }] }, /Playlist 1 membership 1/],
  ]) assert.throws(() => read(candidate), expected);
});

test('older playlists, missing optional fields, explicit repetitions and unrelated backup fields survive', () => {
  const input = {
    tracks: [track, { ...track, id: 'other', bpm: null, artist: null }],
    playlists: [...backup.playlists, { id: 'ordered', name: 'Ordered set', trackIds: ['other', 'track', 'other', 'missing'] }],
    note: { future: true },
  };
  assert.deepEqual(read(input), { ...input, settings: {}, syncHistory: [] });
});

test('malformed backups, file errors and a render failure preserve the saved library and active filters', async () => {
  const browser = createImportBrowser(undefined, backup);
  browser.setLibraryView('old', 'stored', 'pending');
  const before = JSON.stringify(browser.libraryViewState());
  for (const [source, message] of [
    [async () => '{', /Choose a CRATEFLOW JSON backup/],
    [async () => { throw Error('Fixture I/O error'); }, /Could not read/],
    [async () => JSON.stringify({ ...backup, tracks: [{ id: 'new', title: 'Missing status' }] }), /Track 1 status/],
  ]) {
    await browser.restoreFile(source);
    assert.match(browser.toastMessage(), message);
    assert.deepEqual(browser.snapshot(), backup);
    assert.equal(JSON.stringify(browser.libraryViewState()), before);
  }

  browser.failNextRender();
  await browser.restoreBackup({ tracks: [], playlists: [] });
  assert.match(browser.toastMessage(), /existing library was kept/);
  assert.deepEqual(browser.snapshot(), backup);
  assert.equal(JSON.stringify(browser.libraryViewState()), before);
});

test('a backup read in progress cannot overwrite a newer saved library', async () => {
  const browser = createImportBrowser(undefined, backup);
  const newer = { ...backup, tracks: [{ ...track, title: 'Edited in another tab' }] };
  await browser.restoreFile(async () => {
    browser.replaceStorage(newer);
    return JSON.stringify({ tracks: [], playlists: [] });
  });
  assert.match(browser.toastMessage(), /library changed while reading/);
  assert.deepEqual(browser.snapshot(), newer);
});
