import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createImportBrowser } from './fixtures/browser-import.js';

const editorSource = readFileSync(new URL('../lib/playlist-editor.js', import.meta.url), 'utf8');

test('native drag events use the dragged occurrence and the target row’s drop side', () => {
  const listeners = new Map();
  const received = [];
  const row = id => ({
    dataset: { membershipId: id },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ top: 20, height: 40 }),
  });
  const source = row('first-occurrence');
  const target = row('second-occurrence');
  const context = createContext({});
  runInContext(editorSource, context);
  context.CrateflowPlaylistEditor.bind({ addEventListener: (type, listener) => listeners.set(type, listener) },
    edit => { received.push({ ...edit }); return null; });

  const transfer = { setData() {} };
  const dragFrom = () => listeners.get('dragstart')({
    target: { closest: selector => selector === '.playlist-grip' ? {} : source }, dataTransfer: transfer,
  });
  const eventAt = clientY => ({
    target: { closest: () => target }, dataTransfer: transfer, clientY, prevented: false,
    preventDefault() { this.prevented = true; },
  });
  const outsideDrop = eventAt(25);
  listeners.get('drop')(outsideDrop);
  assert.equal(outsideDrop.prevented, false);

  dragFrom();
  const over = eventAt(25);
  listeners.get('dragover')(over);
  assert.equal(over.prevented, true);
  assert.equal(transfer.dropEffect, 'move');
  listeners.get('drop')(eventAt(25));
  dragFrom();
  listeners.get('drop')(eventAt(55));
  listeners.get('drop')(eventAt(55));
  assert.deepEqual(received, [
    { type: 'move', entryId: 'first-occurrence', targetId: 'second-occurrence', side: 'before' },
    { type: 'move', entryId: 'first-occurrence', targetId: 'second-occurrence', side: 'after' },
  ]);
});

const legacySnapshot = () => ({
  tracks: [
    { id: 'a', title: 'First', artist: 'Fixture', status: 'pending', playlistId: 'first' },
    { id: 'b', title: 'Second', artist: 'Fixture', status: 'pending', playlistId: 'first' },
  ],
  playlists: [{ id: 'first', name: 'First list' }, { id: 'elsewhere', name: 'Elsewhere', trackIds: ['a'] }],
  settings: {},
});

test('editing a restored legacy playlist persists order and just one repeated occurrence is removed', async () => {
  const saved = legacySnapshot();
  const browser = createImportBrowser(undefined);
  await browser.restoreBackup(saved);
  assert.deepEqual(browser.snapshot().playlists, saved.playlists);
  const added = browser.savePlaylistEdit('first', { type: 'add', trackId: 'a' });
  const ids = browser.snapshot().playlists[0].memberships.map(row => row.id);
  assert.deepEqual(browser.snapshot().playlists[0].trackIds, ['a', 'b', 'a']);
  browser.savePlaylistEdit('first', { type: 'move', entryId: added.entryId, targetId: ids[0], side: 'before' });

  const reloaded = createImportBrowser(undefined, browser.snapshot());
  assert.deepEqual(Array.from(reloaded.visiblePlaylist('first'), track => track.id), ['a', 'a', 'b']);
  assert.deepEqual(reloaded.snapshot().playlists[0].memberships.map(row => row.id), [ids[2], ids[0], ids[1]]);
  reloaded.savePlaylistEdit('first', { type: 'remove', entryId: ids[0] });

  const snapshot = reloaded.snapshot();
  assert.deepEqual(snapshot.playlists[0].trackIds, ['a', 'b']);
  assert.deepEqual(snapshot.playlists[0].memberships.map(row => row.id), [ids[2], ids[1]]);
  assert.deepEqual(snapshot.playlists[1], saved.playlists[1]);
  assert.deepEqual(snapshot.tracks, saved.tracks);
});

test('a library change from another tab blocks a stale playlist edit', () => {
  const saved = legacySnapshot();
  const browser = createImportBrowser(undefined, saved);
  const newer = structuredClone(saved);
  newer.playlists[1].trackIds.push('b');
  browser.replaceStorage(newer);

  assert.equal(browser.savePlaylistEdit('first', { type: 'add', trackId: 'a' }), null);
  assert.deepEqual(browser.snapshot(), newer);
});

test('a failed local save leaves the stored order and the visible playlist intact', () => {
  const saved = legacySnapshot();
  const browser = createImportBrowser(undefined, saved);
  browser.failStorageWrites();

  assert.equal(browser.savePlaylistEdit('first', { type: 'add', trackId: 'a' }), null);
  assert.deepEqual(browser.snapshot(), saved);
  assert.deepEqual(Array.from(browser.visiblePlaylist('first'), track => track.id), ['a', 'b']);
});
