import { createHmac, randomUUID } from 'node:crypto';
import handler from '../../api/export-beatport-playlist.js';
import { connectionKey, signTrackProof } from '../../lib/beatport-export.js';

export const uid = '00000000-0000-4000-8000-000000000001';
const secret = 'fixture-secret';
export const remoteId = 'playlist-123';
export const source = { title: 'Doa', artist: 'Traumer', remix: '', isrc: '' };
export const matchedTrack = { id: '101', name: 'Doa', artists: [{ name: 'Traumer' }], isAvailable: true };
export const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
export const playlistPage = (...results) => response(200, { results, nextParam: null });
const versionKey = JSON.stringify([[], ['original'], '']);

function cookie(user) {
  const encoded = Buffer.from(JSON.stringify({ uid: user, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const signature = createHmac('sha256', secret).update('crateflow-beatport-v1.' + encoded).digest('base64url');
  return 'cf_bp=' + encoded + '.' + signature;
}

export function exportRequest(tracks = [{ id: '101' }]) {
  const exportId = randomUUID();
  const context = { connection: connectionKey({ uid }, secret, 'crateflow.test'), secret };
  const proofs = tracks.map(track => signTrackProof(context, exportId, {
    source, identity: { ...source, remix: 'Original Mix' }, versionKey, ...track,
  }));
  return { exportId, operation: 'create', name: 'Export Fixture', proofs };
}

export async function callRoute(body, { user = uid, route = handler } = {}) {
  const res = { setHeader() {}, status(code) { this.code = code; return this; },
    json(data) { return { code: this.code, data }; } };
  return route({
    method: 'POST', headers: { host: 'crateflow.test', origin: 'https://crateflow.test', cookie: cookie(user) }, body,
  }, res);
}

export async function withProvider(t, respond, run) {
  const env = {
    MUSICAPI_ENABLE_VERIFICATION: 'true', MUSICAPI_CLIENT_ID: 'fixture-client', MUSICAPI_CLIENT_SECRET: secret,
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const calls = [], originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    originalTimer(callback, delay === 24_000 ? 24 : Math.min(delay, 2), ...args));
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const endpoint = new URL(url), method = options.method || 'GET';
    assertProvider(endpoint);
    const action = method === 'GET' ? 'read' :
      endpoint.pathname.endsWith('/search') ? 'search' :
        endpoint.pathname.endsWith('/items') ? 'append' : 'create';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ action, body });
    return respond(action, options.signal, body);
  });
  await run(calls);
}

function assertProvider(endpoint) {
  if (endpoint.origin !== 'https://api.musicapi.com') throw Error('Unexpected provider request in fixture');
}

export function waitForAbort(signal) {
  return new Promise((_, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function operations(payload, created) {
  const base = { exportId: payload.exportId, receipt: created.data.receipt };
  return { append: { ...base, operation: 'append' }, verify: { ...base, operation: 'verify' } };
}
