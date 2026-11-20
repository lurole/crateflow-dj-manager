import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudAuthHandler } from '../api/cloud-auth.js';

const origin = 'https://preview.crateflow.test';
const project = 'https://project.supabase.test';
const env = {
  CRATEFLOW_CLOUD_AUTH_ENABLED: 'true',
  CRATEFLOW_CLOUD_GOOGLE_ENABLED: 'true',
  CRATEFLOW_CLOUD_AUTH_ORIGIN: origin,
  SUPABASE_URL: project,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_offline_fixture',
  VERCEL_ENV: 'preview',
};
const user = { id: '10000000-0000-0000-0000-000000000001', email: 'artist@crateflow.test' };
const cookieName = '__Host-cf-cloud-session';

function fixture(replies = {}, config = env) {
  const calls = [];
  const fetch = async (uri, options = {}) => {
    const url = new URL(uri);
    assert.equal(url.origin, project);
    const path = url.pathname + url.search;
    const request = {
      path, method: options.method, headers: new Headers(options.headers),
      body: options.body && JSON.parse(options.body),
    };
    calls.push(request);
    assert.ok(replies[path], 'Unexpected Supabase Auth call ' + path);
    const { body, status = 200 } = replies[path](request);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = createCloudAuthHandler({ env: config, fetch });
  async function request({ method = 'GET', path = '/api/cloud-auth', body, cookie, headers = {} } = {}) {
    const res = {
      headers: {}, statusCode: null, body: '',
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      end() {},
      send(value) { this.body = value; },
    };
    await handler({
      url: path, method, body,
      headers: { host: new URL(origin).host, origin, 'content-type': 'application/x-www-form-urlencoded', cookie, ...headers },
    }, res);
    return res;
  }

  return { request, calls };
}

function tokenSession() {
  const session = { sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: encoded({ alg: 'HS256' }) + '.' + encoded(session) + '.offline', token_type: 'bearer',
    expires_in: 3600, refresh_token: 'offline-refresh-token', user };
}

const cookieHeader = response => response.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');

test('cloud account stays disabled by default and when the target is production', async () => {
  for (const config of [{}, { ...env, VERCEL_ENV: 'production' }, { ...env, VERCEL_TARGET_ENV: 'production' }]) {
    const api = fixture({}, config);
    const result = await api.request();
    assert.equal(result.statusCode, 404);
    assert.equal(api.calls.length, 0);
  }
});

test('a privileged key and a non-loopback HTTP origin fail closed', async () => {
  for (const config of [
    { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_offline_fixture' },
    { ...env, CRATEFLOW_CLOUD_AUTH_ORIGIN: 'http://preview.crateflow.test' },
    { ...env, SUPABASE_URL: 'https://user:password@project.supabase.test' },
  ]) {
    const api = fixture({}, config);
    const result = await api.request();
    assert.equal(result.statusCode, 503);
    assert.doesNotMatch(result.body, /password|secret_offline/);
    assert.equal(api.calls.length, 0);
  }
});

test('mutating auth requests require the configured host and exact origin', async () => {
  const api = fixture();
  for (const headers of [
    { 'x-forwarded-host': 'different.crateflow.test' },
    { origin: 'https://attacker.test' },
    { origin: undefined },
  ]) {
    const result = await api.request({ method: 'POST', body: { action: 'logout' }, headers });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(api.calls.length, 0);
});

test('the isolated account page is uncacheable and does not expose keys or legacy storage', async () => {
  const api = fixture();
  const result = await api.request();
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /Send a sign-in code/);
  assert.match(result.body, /Continue with Google/);
  assert.match(result.headers['cache-control'], /no-store/);
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(result.body, /sb_publishable|localStorage|crateflow_v1/);
  assert.equal(api.calls.length, 0);
});

test('email code delivery uses Supabase Auth and shows a generic acknowledgement', async () => {
  const api = fixture({
    '/auth/v1/otp': ({ body, headers, method }) => {
      assert.equal(method, 'POST');
      assert.equal(body.email, user.email);
      assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
      return { body: {} };
    },
  });
  const result = await api.request({ method: 'POST', body: 'action=email-start&email=artist%40crateflow.test' });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /If this address can sign in/);
  assert.doesNotMatch(result.body, /artist@crateflow.test/);
  assert.equal(api.calls.length, 1);
});

test('email verification creates secure cookies and server verifies identity before rendering', async () => {
  const session = tokenSession();
  const api = fixture({
    '/auth/v1/verify': ({ body }) => {
      assert.deepEqual({ email: body.email, token: body.token, type: body.type }, {
        email: user.email, token: '123456', type: 'email',
      });
      return { body: session };
    },
    '/auth/v1/user': ({ headers }) => {
      assert.equal(headers.get('authorization'), 'Bearer ' + session.access_token);
      return { body: user };
    },
  });
  const signedIn = await api.request({ method: 'POST', body: { action: 'email-verify', email: user.email, code: '123456' } });
  assert.equal(signedIn.statusCode, 303);
  assert.equal(signedIn.headers.location, '/api/cloud-auth');
  assert.ok(signedIn.headers['set-cookie'].some(cookie => cookie.startsWith(cookieName + '=')));
  for (const cookie of signedIn.headers['set-cookie']) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
  }
  const result = await api.request({ cookie: cookieHeader(signedIn) });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /Signed in as artist@crateflow.test/);
  assert.doesNotMatch(result.body, /offline-refresh-token/);
  assert.deepEqual(api.calls.map(call => call.path), ['/auth/v1/verify', '/auth/v1/user']);
});

test('a session cookie with a rejected identity cannot render a signed-in account', async () => {
  const api = fixture({
    '/auth/v1/verify': () => ({ body: tokenSession() }),
    '/auth/v1/user': () => ({ status: 401, body: { code: 'bad_jwt', message: 'Rejected' } }),
  });
  const signedIn = await api.request({ method: 'POST', body: { action: 'email-verify', email: user.email, code: '123456' } });
  const result = await api.request({ cookie: cookieHeader(signedIn) });
  assert.doesNotMatch(result.body, /Signed in as/);
  assert.match(result.body, /Send a sign-in code/);
});

test('Google start and callback use PKCE and a fixed callback destination', async () => {
  const api = fixture({
    '/auth/v1/token?grant_type=pkce': ({ body }) => {
      assert.equal(body.auth_code, 'fixture-code');
      assert.match(body.code_verifier, /^[A-Za-z0-9._~-]{43,128}$/);
      return { body: tokenSession() };
    },
  });

  const start = await api.request({ method: 'POST', body: { action: 'google', next: 'https://attacker.test/' } });
  const authorization = new URL(start.headers.location);
  assert.equal(start.statusCode, 303);
  assert.equal(authorization.origin, project);
  assert.equal(authorization.pathname, '/auth/v1/authorize');
  assert.equal(authorization.searchParams.get('provider'), 'google');
  assert.equal(authorization.searchParams.get('redirect_to'), origin + '/api/cloud-auth?callback=1');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 's256');
  assert.ok(authorization.searchParams.get('code_challenge'));
  assert.ok(start.headers['set-cookie'].some(cookie => cookie.includes('-code-verifier') && cookie.includes('HttpOnly')));

  const finished = await api.request({
    path: '/api/cloud-auth?callback=1&code=fixture-code&next=https://attacker.test/',
    cookie: cookieHeader(start),
  });
  assert.equal(finished.statusCode, 303);
  assert.equal(finished.headers.location, '/api/cloud-auth');
});

test('an unsolicited Google callback fails without a PKCE verifier', async () => {
  const api = fixture();
  const result = await api.request({ path: '/api/cloud-auth?callback=1&code=orphan-code' });
  assert.equal(result.statusCode, 400);
  assert.equal(api.calls.length, 0);
});

test('logout revokes the current session and clears only cloud cookies', async () => {
  const api = fixture({
    '/auth/v1/verify': () => ({ body: tokenSession() }),
    '/auth/v1/logout?scope=local': () => ({ status: 204 }),
  });
  const signedIn = await api.request({ method: 'POST', body: { action: 'email-verify', email: user.email, code: '123456' } });
  const result = await api.request({
    method: 'POST', body: { action: 'logout' }, cookie: cookieHeader(signedIn) + '; cf_bp=untouched',
  });
  assert.equal(result.statusCode, 303);
  assert.ok(result.headers['set-cookie'].every(cookie => cookie.startsWith(cookieName) && cookie.includes('Max-Age=0')));
  assert.deepEqual(api.calls.map(call => call.path), ['/auth/v1/verify', '/auth/v1/logout?scope=local']);
});

test('Google is unavailable until explicitly enabled for this environment', async () => {
  const api = fixture({}, { ...env, CRATEFLOW_CLOUD_GOOGLE_ENABLED: undefined });
  const page = await api.request();
  assert.doesNotMatch(page.body, /Continue with Google/);
  const request = await api.request({ method: 'POST', body: { action: 'google' } });
  assert.equal(request.statusCode, 400);
  assert.equal(api.calls.length, 0);
});

test('email verification rejects malformed codes before asking Supabase', async () => {
  const api = fixture();
  const result = await api.request({ method: 'POST', body: { action: 'email-verify', email: user.email, code: 'not-a-code' } });
  assert.equal(result.statusCode, 400);
  assert.equal(api.calls.length, 0);
});
