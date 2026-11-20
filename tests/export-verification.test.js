import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixture from './fixtures/beatport-export.js';

const { callRoute, exportRequest, matchedTrack, operations, playlistPage, remoteId, response, waitForAbort, withProvider } = fixture;
const foreignUser = '00000000-0000-4000-8000-000000000009';
const actions = calls => calls.map(call => call.action);

function normalExport(t, items, check, request = exportRequest()) {
  let appended = false;
  return withProvider(t, action => {
    if (action === 'create') return response(200, { id: remoteId });
    if (action === 'append') { appended = true; return response(200); }
    return appended ? playlistPage(...items) : playlistPage();
  }, async calls => {
    const created = await callRoute(request);
    assert.equal(created.data.status, 'created');
    const { append, verify } = operations(request, created);
    assert.equal((await callRoute(append)).data.status, 'appended');
    await check(await callRoute(verify), calls);
  });
}

test('all matching read-back items produce a fully verified export', async t => {
  await normalExport(t, [matchedTrack], (result, calls) => {
    assert.equal(result.code, 200);
    assert.equal(result.data.status, 'verified');
    assert.equal(result.data.verified, true);
    assert.deepEqual(result.data.confirmed, ['101']);
    assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read']);
    assert.deepEqual(calls[2].body.itemIds, ['101']);
  });
});

test('a successful append does not hide an incorrect title on a matching ID', async t => {
  await normalExport(t, [{ ...matchedTrack, name: 'Different track' }], result => {
    assert.deepEqual(result.data.mismatched, ['101']);
    assert.equal(result.data.verified, false);
  });
});

test('an unavailable item is not confirmed', async t => {
  await normalExport(t, [{ ...matchedTrack, isAvailable: false }], result => {
    assert.equal(result.data.added, 0);
    assert.deepEqual(result.data.unavailable, ['101']);
  });
});

test('partial read-back distinguishes confirmed, missing, mismatched and unverified items', async t => {
  const request = exportRequest(['101', '102', '103', '104'].map(id => ({ id })));
  await normalExport(t, [
    matchedTrack,
    { ...matchedTrack, id: '103', name: 'Wrong release' },
    { ...matchedTrack, id: '104', artists: [] },
  ], (result, calls) => {
    assert.equal(result.data.status, 'partial');
    assert.equal(result.data.verified, false);
    assert.deepEqual(result.data.confirmed, ['101']);
    assert.deepEqual(result.data.missing, ['102']);
    assert.deepEqual(result.data.mismatched, ['103']);
    assert.deepEqual(result.data.unverified, ['104']);
    assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read', 'read']);
  }, request);
});

test('title and artist resemblance cannot substitute a different read-back ID', async t => {
  await normalExport(t, [{ ...matchedTrack, id: '999' }], result => {
    assert.deepEqual(result.data.missing, ['101']);
    assert.equal(result.data.unexpected, 1);
    assert.equal(result.data.verified, false);
  });
});

test('unsigned, altered, and cross-account proofs stop before any provider write', async t => {
  await withProvider(t, () => { throw Error('No provider call expected'); }, async calls => {
    const request = exportRequest();
    for (const [body, options] of [
      [{ ...request, proofs: [], trackIds: ['101'] }],
      [{ ...request, proofs: [request.proofs[0] + 'x'] }],
      [{ ...request, proofs: [request.proofs[0], request.proofs[0]] }],
      [request, { user: foreignUser }],
      [{ ...request, exportId: exportRequest().exportId }],
    ]) {
      const result = await callRoute(body, options);
      assert.equal(result.data.status, 'failed');
      assert.equal(result.data.stage, 'preflight');
    }
    assert.equal(calls.length, 0);
  });
});

test('a provider error during creation leaves the write outcome unverified', async t => {
  await withProvider(t, () => response(503), async calls => {
    const result = await callRoute(exportRequest());
    assert.equal(result.code, 502);
    assert.equal(result.data.stage, 'create');
    assert.equal(result.data.status, 'unverified');
    assert.equal(result.data.reason, 'provider_error');
    assert.equal(result.data.playlistId, undefined);
    assert.deepEqual(actions(calls), ['create']);
  });
});

test('a create timeout explicitly identifies an unverified write outcome and duplicate requests do not rewrite', async t => {
  await withProvider(t, (_, signal) => waitForAbort(signal), async calls => {
    const request = exportRequest();
    const result = await callRoute(request);
    assert.equal(result.code, 502);
    assert.equal(result.data.stage, 'create');
    assert.equal(result.data.status, 'unverified');
    assert.equal(result.data.reason, 'timeout');
    assert.equal(result.data.playlistId, undefined);
    assert.deepEqual(await callRoute(request), result);
    assert.deepEqual(await callRoute({ exportId: request.exportId, operation: 'verify' }), result);
    assert.deepEqual(actions(calls), ['create']);
  });
});

test('connection loss during create cannot safely be retried on a fresh instance', async t => {
  const coldRoute = (await import('../api/export-beatport-playlist.js?unknown-create')).default;
  await withProvider(t, () => { throw Error('lost connection'); }, async calls => {
    const request = exportRequest();
    const result = await callRoute(request);
    assert.equal(result.data.reason, 'network_error');
    const check = await callRoute({ exportId: request.exportId, operation: 'verify' }, { route: coldRoute });
    assert.equal(check.data.reason, 'unknown_playlist');
    assert.equal(check.data.status, 'unverified');
    assert.deepEqual(actions(calls), ['create']);
  });
});

test('an append timeout identifies the append stage and the known playlist', async t => {
  await withProvider(t, (action, signal) => {
    if (action === 'create') return response(200, { id: remoteId });
    if (action === 'read') return playlistPage();
    return waitForAbort(signal);
  }, async calls => {
    const request = exportRequest(), created = await callRoute(request);
    const { append } = operations(request, created);
    const result = await callRoute(append);
    assert.equal(result.code, 502);
    assert.equal(result.data.stage, 'add');
    assert.equal(result.data.status, 'unverified');
    assert.equal(result.data.reason, 'timeout');
    assert.equal(result.data.playlistId, remoteId);
    assert.equal(result.data.receipt, created.data.receipt);
    assert.deepEqual(await callRoute(append), result);
    assert.deepEqual(actions(calls), ['create', 'read', 'append']);
  });
});

for (const failure of ['provider_error', 'network_error']) {
  test('append ' + failure + ' keeps the playlist ID and recovery is read-only', async t => {
    let attempted = false;
    await withProvider(t, action => {
      if (action === 'create') return response(200, { id: remoteId });
      if (action === 'read') return attempted ? playlistPage(matchedTrack) : playlistPage();
      attempted = true;
      if (failure === 'network_error') throw Error('lost response after write');
      return response(503);
    }, async calls => {
      const request = exportRequest(), created = await callRoute(request);
      const { append, verify } = operations(request, created);
      const result = await callRoute(append);
      assert.equal(result.data.stage, 'add');
      assert.equal(result.data.reason, failure);
      assert.equal(result.data.playlistId, remoteId);
      assert.equal((await callRoute(verify)).data.status, 'verified');
      assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read']);
    });
  });
}

test('read-back timeout keeps the playlist ID and never reports confirmed success', async t => {
  let readings = 0;
  await withProvider(t, (action, signal) => {
    if (action === 'create') return response(200, { id: remoteId });
    if (action === 'append') return response(200);
    return readings++ ? waitForAbort(signal) : playlistPage();
  }, async calls => {
    const request = exportRequest();
    const { append, verify } = operations(request, await callRoute(request));
    await callRoute(append);
    const result = await callRoute(verify);
    assert.equal(result.data.stage, 'verify');
    assert.equal(result.data.status, 'unverified');
    assert.equal(result.data.reason, 'timeout');
    assert.equal(result.data.playlistId, remoteId);
    assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read']);
  });
});

test('unreadable read-back retries only reading and reports unverified tracks', async t => {
  let appended = false;
  await withProvider(t, action => {
    if (action === 'create') return response(200, { id: remoteId });
    if (action === 'append') { appended = true; return response(200); }
    return appended ? response(503) : playlistPage();
  }, async calls => {
    const request = exportRequest();
    const { append, verify } = operations(request, await callRoute(request));
    await callRoute(append);
    const result = await callRoute(verify);
    assert.equal(result.data.stage, 'verify');
    assert.equal(result.data.verified, false);
    assert.deepEqual(result.data.unverified, ['101']);
    assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read', 'read']);
  });
});

test('a repeated append on a fresh instance reads existing content and never appends it again', async t => {
  const coldRoute = (await import('../api/export-beatport-playlist.js?already-appended')).default;
  let appended = false;
  await withProvider(t, action => {
    if (action === 'create') return response(200, { id: remoteId });
    if (action === 'append') { appended = true; return response(200); }
    return appended ? playlistPage(matchedTrack) : playlistPage();
  }, async calls => {
    const request = exportRequest();
    const { append, verify } = operations(request, await callRoute(request));
    await callRoute(append);
    assert.equal((await callRoute(append, { route: coldRoute })).data.status, 'verified');
    assert.equal((await callRoute(verify, { user: foreignUser })).code, 403);
    assert.deepEqual(actions(calls), ['create', 'read', 'append', 'read']);
  });
});

test('in-flight duplicate create requests and changed selections cannot write a second playlist', async t => {
  let finish, started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const upstream = new Promise(resolve => { finish = resolve; });
  await withProvider(t, () => { started(); return upstream; }, async calls => {
    const request = exportRequest();
    const first = callRoute(request);
    await startedPromise;
    try {
      const duplicate = await callRoute(request);
      assert.equal(duplicate.data.status, 'pending');
      assert.equal((await callRoute({ ...request, name: 'Changed selection' })).code, 409);
    } finally {
      finish(response(200, { id: remoteId }));
    }
    const completed = await first;
    assert.deepEqual(await callRoute(request), completed);
    assert.deepEqual(actions(calls), ['create']);
  });
});

test('an unreadable pre-append check never dispatches a write to the playlist', async t => {
  await withProvider(t, action => action === 'create' ? response(200, { id: remoteId }) : response(503), async calls => {
    const request = exportRequest();
    const { append } = operations(request, await callRoute(request));
    const result = await callRoute(append);
    assert.equal(result.data.reason, 'precheck_failed');
    assert.equal(result.data.playlistId, remoteId);
    assert.deepEqual(actions(calls), ['create', 'read']);
  });
});
