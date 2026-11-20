import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import search from '../api/search-beatport.js';
import { callRoute, remoteId, response, withProvider } from './fixtures/beatport-export.js';

const source = { title: 'Fixture Tune (Alex Extended Remix)', artist: 'Fixture Artist', isrc: 'USABC1234567' };
const musicApiResult = {
  id: '900', name: source.title, artists: [{ name: source.artist }], isrc: source.isrc,
  url: 'https://www.beatport.com/track/fixture-tune/411',
};
const apiShSelection = {
  provider: 'api.sh', externalId: '411', beatportId: '411', name: source.title, artist: source.artist, isrc: source.isrc,
};
const musicApiSelection = { ...apiShSelection, provider: 'musicapi', externalId: '900' };
const lookup = (selection = apiShSelection, input = source) => ({
  exportCheck: { exportId: randomUUID(), source: input, selection },
});

test('a fresh connected search issues a proof for the connected ID, not the API.SH ID', async t => {
  await withProvider(t, action => action === 'search' ? response(200, [musicApiResult]) :
    response(200, { id: remoteId }), async calls => {
    const request = lookup();
    const checked = await callRoute(request, { route: search });
    assert.equal(checked.code, 200);
    assert.equal(checked.data.id, '900');
    const exportId = request.exportCheck.exportId;
    const created = await callRoute({ operation: 'create', exportId, name: 'Fixture', proofs: [checked.data.proof] });
    assert.equal(created.data.status, 'created');
    assert.deepEqual(calls.map(call => call.action), ['search', 'create']);
  });
});

test('numeric MusicAPI fields alone do not prove a Beatport catalog ID', async t => {
  const item = { ...musicApiResult, id: '411', url: undefined, isrc: undefined };
  const selection = { ...apiShSelection, isrc: '' };
  await withProvider(t, () => response(200, [item]), async calls => {
    const checked = await callRoute(lookup(selection, { ...source, isrc: '' }), { route: search });
    assert.equal(checked.code, 409);
    assert.equal(checked.data.proof, undefined);
    assert.deepEqual(calls.map(call => call.action), ['search']);
  });
});

for (const [description, candidates] of [
  ['wrong mix', [{ ...musicApiResult, name: 'Fixture Tune (Alex Radio Remix)' }]],
  ['wrong artist', [{ ...musicApiResult, artists: [{ name: 'Other Artist' }] }]],
  ['conflicting ISRC', [{ ...musicApiResult, isrc: 'USABC7654321' }]],
  ['two matching connected IDs', [musicApiResult, { ...musicApiResult, id: '901' }]],
  ['substituted connected ID', [{ ...musicApiResult, id: '901' }]],
]) {
  test('a connected lookup issues no proof for ' + description, async t => {
    await withProvider(t, () => response(200, candidates), async () => {
      const checked = await callRoute(lookup(musicApiSelection), { route: search });
      assert.equal(checked.code, 409);
      assert.equal(checked.data.proof, undefined);
    });
  });
}

test('MusicAPI original-mix naming can corroborate the explicit API.SH Original Mix', async t => {
  const original = { title: 'Fixture Tune', artist: source.artist, isrc: source.isrc };
  const selection = { ...apiShSelection, name: original.title, mixHint: 'Original Mix' };
  await withProvider(t, () => response(200, [{ ...musicApiResult, name: original.title }]), async () => {
    const checked = await callRoute(lookup(selection, original), { route: search });
    assert.equal(checked.code, 200);
    assert.equal(checked.data.id, '900');
  });
});

test('conflicting explicit Beatport IDs cannot be rescued by matching ISRC', async t => {
  await withProvider(t, () => response(200, [{ ...musicApiResult, beatportId: '412' }]), async () => {
    const checked = await callRoute(lookup(), { route: search });
    assert.equal(checked.code, 409);
    assert.equal(checked.data.proof, undefined);
  });
});

test('an unidentified competing track prevents proof issuance', async t => {
  await withProvider(t, () => response(200, [musicApiResult, { ...musicApiResult, id: null }]), async () => {
    const checked = await callRoute(lookup(), { route: search });
    assert.equal(checked.code, 409);
    assert.equal(checked.data.proof, undefined);
  });
});
