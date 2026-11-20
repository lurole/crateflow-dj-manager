import { createHash } from 'node:crypto';
import {
  appendLifetime, beatportSession, connectionKey, itemIdPattern, proofLifetime,
  readbackOutcomes, readReceipt, readTrackProof, signReceipt, trackProofLimit, uuidPattern,
} from '../lib/beatport-export.js';

export const maxDuration = 30;
const recent = new Map();
const retention = 2 * proofLifetime;

const reply = (code, data) => ({ code, data });
const failed = (code, error, reason = 'rejected') =>
  reply(code, { ok: false, status: 'failed', stage: 'preflight', reason, error });
const outcome = (job, fields, code = 200) => reply(code, {
  ok: code < 400,
  exportId: job.exportId,
  name: job.name,
  requested: job.tracks.length,
  ...(job.playlistId ? { playlistId: job.playlistId, receipt: job.receipt } : {}),
  ...fields,
});

function pending(job, stage) {
  return outcome(job, { status: 'pending', stage, warning: 'The write is still in progress. Check the export again.' }, 202);
}

function uncertain(job, stage, context, error, reason, providerStatus) {
  const timedOut = context.signal.aborted;
  return outcome(job, {
    status: 'unverified',
    stage,
    reason: timedOut ? 'timeout' : reason,
    error: timedOut ? 'Beatport did not respond before the deadline. The outcome is unknown.' : error,
    ...(providerStatus ? { providerStatus } : {}),
    verified: false,
    unverified: job.tracks.map(track => track.id),
  }, 502);
}

function remember(key, job) {
  const now = Date.now();
  for (const [id, entry] of recent) {
    if (!entry.busy && now - entry.recordedAt >= retention) recent.delete(id);
  }
  if (recent.size >= 512) return false;
  recent.set(key, job);
  return true;
}

function activeJob(key) {
  const job = recent.get(key);
  if (job && !job.busy && Date.now() - job.recordedAt >= retention) {
    recent.delete(key);
    return null;
  }
  return job;
}

async function createPlaylist(context, payload, exportId, key, previous) {
  const name = typeof payload.name === 'string' && payload.name.length <= 75 ? payload.name.trim() : '';
  if (!name || !Array.isArray(payload.proofs) || payload.proofs.length < 1 || payload.proofs.length > 20)
    return failed(400, 'Provide a playlist name and proofs for 1 to 20 tracks.');
  if (!payload.proofs.every(proof => typeof proof === 'string' && proof.length <= trackProofLimit))
    return failed(400, 'Invalid track verification proof.');
  const fingerprint = createHash('sha256').update(JSON.stringify([name, payload.proofs])).digest('hex');
  if (previous) {
    if (previous.fingerprint !== fingerprint) return failed(409, 'This export ID belongs to a different selection.');
    return previous.createResult || pending(previous, 'create');
  }
  const tracks = payload.proofs.map(proof => readTrackProof(context, exportId, proof));
  if (tracks.some(track => !track) || new Set(tracks.map(track => track.id)).size !== tracks.length)
    return failed(400, 'The track verification expired, is invalid, or identifies the same Beatport track more than once.');

  const job = { exportId, name, tracks, fingerprint, recordedAt: Date.now(), busy: 'create' };
  if (!remember(key, job)) return failed(503, 'The export service is busy. No playlist was created.');

  try {
    const created = await fetch(context.base, {
      method: 'POST', headers: context.headers, signal: context.signal, redirect: 'error',
      body: JSON.stringify({ name, visibility: 'private' }),
    });
    if (!created.ok) {
      job.createResult = uncertain(job, 'create', context,
        'Beatport returned an error while creating the playlist. Check Beatport before creating another.', 'provider_error', created.status);
      return job.createResult;
    }
    const value = await created.json().catch(() => null);
    const playlistId = typeof value?.id === 'string' || typeof value?.id === 'number' ? String(value.id) : '';
    if (!itemIdPattern.test(playlistId)) {
      job.createResult = uncertain(job, 'create', context,
        'Beatport did not return a usable playlist ID. Check Beatport before creating another.', 'invalid_response');
      return job.createResult;
    }
    job.playlistId = playlistId;
    job.createdAt = Date.now();
    job.receipt = signReceipt(context, { exportId, name, tracks, playlistId, createdAt: job.createdAt });
    job.createResult = outcome(job, { status: 'created', stage: 'create', verified: false });
    return job.createResult;
  } catch {
    job.createResult = uncertain(job, 'create', context,
      'The connection was lost while creating the playlist. Check Beatport before creating another.', 'network_error');
    return job.createResult;
  } finally {
    job.busy = null;
  }
}

async function readPlaylist(context, job) {
  const items = [], cursors = new Set();
  let cursor = null;
  for (let page = 0; page < 4; page++) {
    const url = new URL(context.base + '/' + encodeURIComponent(job.playlistId) + '/items');
    url.searchParams.set('limitParam', '100');
    if (cursor) url.searchParams.set('nextParam', cursor);
    const read = await fetch(url, {
      headers: { Authorization: context.headers.Authorization, Accept: 'application/json' },
      signal: context.signal, redirect: 'error',
    });
    if (!read.ok) throw Error('provider_error');
    const data = await read.json();
    if (!Array.isArray(data?.results) || data.results.length > 100) throw Error('invalid_response');
    items.push(...data.results);
    cursor = data.nextParam;
    if (cursor === null || cursor === undefined || cursor === '') return items;
    if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor)) throw Error('invalid_response');
    cursors.add(cursor);
  }
  throw Error('incomplete_read');
}

function verificationResult(job, items) {
  const outcomes = readbackOutcomes(job.tracks, items);
  const added = outcomes.confirmed.length;
  const verified = added === job.tracks.length && !outcomes.unexpected && !outcomes.unknownCount;
  return outcome(job, {
    status: verified ? 'verified' : added ? 'partial' : 'unverified',
    stage: 'verify', verified, added, ...outcomes,
  });
}

async function appendTracks(context, job) {
  if (job.appendResult) return job.appendResult;
  if (job.busy) return pending(job, job.busy);
  if (Date.now() - job.createdAt >= appendLifetime)
    return outcome(job, { status: 'unverified', stage: 'add', reason: 'append_expired',
      error: 'The append window expired. Read the playlist or review it in Beatport.', verified: false }, 409);
  job.busy = 'add';
  try {
    // A previous attempt may have run in a different Vercel instance. A
    // nonempty or unreadable playlist can never authorize another append.
    let current;
    try {
      current = await readPlaylist(context, job);
    } catch {
      job.appendResult = uncertain(job, 'add', context,
        'Beatport could not confirm an empty playlist. No tracks were sent in this attempt.', 'precheck_failed');
      return job.appendResult;
    }
    if (current.length) {
      job.appendResult = verificationResult(job, current);
      return job.appendResult;
    }
    const added = await fetch(context.base + '/' + encodeURIComponent(job.playlistId) + '/items', {
      method: 'POST', headers: context.headers, signal: context.signal, redirect: 'error',
      body: JSON.stringify({ itemIds: job.tracks.map(track => track.id) }),
    });
    job.appendResult = added.ok
      ? outcome(job, { status: 'appended', stage: 'add', verified: false })
      : uncertain(job, 'add', context,
        'The playlist was created, but Beatport returned an error while adding tracks. Check the playlist contents.', 'provider_error', added.status);
    return job.appendResult;
  } catch {
    job.appendResult = uncertain(job, 'add', context,
      'The playlist was created, but the connection was lost while adding tracks. Check the playlist contents.', 'network_error');
    return job.appendResult;
  } finally {
    job.busy = null;
  }
}

async function verifyPlaylist(context, job) {
  if (job.busy) return pending(job, job.busy);
  let latest = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 1200));
    try {
      const result = verificationResult(job, await readPlaylist(context, job));
      if (result.data.verified) return result;
      latest = result;
    } catch {
      if (context.signal.aborted) break;
    }
  }
  if (latest) return latest;
  return uncertain(job, 'verify', context,
    'The playlist exists, but Beatport did not return verifiable contents. Try checking the contents again.', 'read_failed');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = result => res.status(result.code).json(result.data);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(failed(405, 'Method not allowed'));
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || req.headers.origin !== 'https://' + host) return send(failed(403, 'Invalid origin'));
  const clientId = process.env.MUSICAPI_CLIENT_ID, secret = process.env.MUSICAPI_CLIENT_SECRET;
  if (process.env.MUSICAPI_ENABLE_VERIFICATION !== 'true' || !clientId || !secret)
    return send(failed(503, 'MusicAPI integration unavailable'));
  const session = beatportSession(req.headers, secret);
  if (!session) return send(failed(401, 'Connect Beatport first'));

  let payload;
  try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return send(failed(400, 'Invalid JSON request')); }
  const { exportId, operation, receipt } = payload || {};
  if (typeof exportId !== 'string' || !uuidPattern.test(exportId) || !['create', 'append', 'verify'].includes(operation))
    return send(failed(400, 'A valid export ID and operation are required.'));

  const connection = connectionKey(session, secret, host);
  const key = connection + ':' + exportId;
  const previous = activeJob(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 24_000);
  const context = {
    connection, secret, signal: controller.signal,
    base: 'https://api.musicapi.com/api/' + encodeURIComponent(session.uid) + '/playlists',
    headers: {
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
      'Content-Type': 'application/json', Accept: 'application/json',
    },
  };
  try {
    if (operation === 'create') return send(await createPlaylist(context, payload, exportId, key, previous));
    const signed = receipt && readReceipt(context, exportId, receipt);
    if ((receipt && !signed) || (operation === 'append' && !signed))
      return send(failed(403, 'This playlist receipt is invalid for the current Beatport connection.'));
    if (signed && previous && signed.playlistId !== previous.playlistId)
      return send(failed(409, 'The export ID is associated with a different playlist.'));
    const job = previous || (signed && { ...signed, receipt, recordedAt: Date.now() });
    if (operation === 'append') {
      if (!previous && !remember(key, job)) return send(failed(503, 'The export service is busy.'));
      return send(await appendTracks(context, job));
    }
    if (!job?.playlistId) {
      if (job?.busy) return send(pending(job, job.busy));
      return send(job?.createResult || reply(409, {
        ok: false, exportId, status: 'unverified', stage: 'create', reason: 'unknown_playlist',
        error: 'No confirmed playlist ID is available. Open Beatport and reconcile the export manually.',
      }));
    }
    return send(await verifyPlaylist(context, job));
  } finally {
    clearTimeout(timer);
  }
}
