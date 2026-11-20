import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../beatport-export.js';

const { create, storageKey } = globalThis.CrateflowBeatportExports;
const tracks = [{
  localId: 'local-track-1', label: 'Fixture Artist – Fixture Track',
  source: { title: 'Fixture Track', artist: 'Fixture Artist' }, selection: { provider: 'musicapi' },
}];
const success = value => ({ json: async () => value });

function browser(provider) {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const exportJob = () => JSON.parse(values.get(storageKey) || '[]')[0];
  let locked = false;
  const locks = { async request(_, { ifAvailable }, action) {
    assert.equal(ifAvailable, true);
    if (locked) return action(null);
    locked = true;
    try { return await action({}); } finally { locked = false; }
  } };
  const calls = [];
  const fetch = async (path, request) => {
    const body = JSON.parse(request.body);
    const operation = body.operation || 'preflight';
    calls.push(operation);
    if (operation === 'preflight') return success({ ok: true, id: '101', proof: 'fixture-proof' });
    return provider(operation, body, exportJob());
  };
  const reload = () => create({ storage, locks, fetch, newId: randomUUID, wait: async () => {} });
  return { reload, calls, values, exportJob, storage };
}

test('a browser reload after an unknown create response offers only a read-only check', async () => {
  const web = browser((operation, request, job) => {
    if (operation === 'create') {
      assert.equal(job.exportId, request.exportId);
      assert.equal(job.stage, 'create');
      assert.equal(job.status, 'pending');
      throw Error('page lost the response');
    }
    assert.equal(operation, 'verify');
    assert.equal(request.receipt, undefined);
    return success({ exportId: request.exportId, status: 'unverified', stage: 'create', reason: 'unknown_playlist' });
  });
  const created = await web.reload().start('Fixture', tracks);
  assert.equal(created.status, 'unverified');
  assert.equal(created.reason, 'lost_response');
  const restarted = web.reload();
  await assert.rejects(restarted.start('Fixture', tracks), /previous export/);
  const checked = await restarted.check(created.exportId);
  assert.equal(checked.status, 'unverified');
  assert.deepEqual(web.calls, ['preflight', 'create', 'verify']);
});

test('receipt and ID are durable before append, and append recovery never repeats writes', async () => {
  const web = browser((operation, request, job) => {
    const result = { exportId: request.exportId, playlistId: 'fixture-playlist', receipt: 'fixture-receipt' };
    if (operation === 'create') return success({ ...result, status: 'created' });
    assert.equal(job.playlistId, 'fixture-playlist');
    assert.equal(request.receipt, 'fixture-receipt');
    if (operation === 'append') {
      assert.equal(job.stage, 'add');
      assert.equal(job.status, 'pending');
      throw Error('response lost after append');
    }
    return success({ ...result, status: 'verified', stage: 'verify', added: 1, confirmed: ['101'] });
  });
  const job = await web.reload().start('Fixture', tracks);
  assert.equal(job.status, 'unverified');
  assert.equal(job.writeIssue.stage, 'add');
  const recovered = await web.reload().check(job.exportId);
  assert.equal(recovered.status, 'verified');
  assert.equal(recovered.playlistId, 'fixture-playlist');
  await assert.rejects(web.reload().start('fixture', tracks), /already exported/);
  assert.deepEqual(web.calls, ['preflight', 'create', 'append', 'verify']);
});

test('outstanding exports and concurrent tabs do not start an additional write', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const web = browser(async (operation, request) => {
    assert.equal(operation, 'create');
    entered();
    await hold;
    return success({ exportId: request.exportId, status: 'unverified', stage: 'create' });
  });
  const first = web.reload().start('Fixture', tracks);
  await started;
  try {
    await assert.rejects(web.reload().start('Other fixture', tracks), /another tab/);
  } finally {
    release();
  }
  const job = await first;
  await assert.rejects(web.reload().start('Other fixture', tracks), /previous export/);
  await web.reload().acknowledge(job.exportId);
  assert.equal(web.exportJob().reviewed, true);
  assert.deepEqual(web.calls, ['preflight', 'create']);
});

test('a failed durable checkpoint prevents the append even after a successful create', async () => {
  const web = browser((operation, request) => {
    assert.equal(operation, 'create');
    const save = web.storage.setItem;
    web.storage.setItem = (key, value) => {
      if (JSON.parse(value)[0].status === 'created') throw Error('storage full');
      return save(key, value);
    };
    return success({ exportId: request.exportId, playlistId: 'fixture-playlist', receipt: 'receipt', status: 'created' });
  });
  await assert.rejects(web.reload().start('Fixture', tracks), /storage full/);
  assert.equal(web.exportJob().stage, 'create');
  assert.equal(web.exportJob().status, 'pending');
  assert.deepEqual(web.calls, ['preflight', 'create']);
});
