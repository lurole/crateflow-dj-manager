import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

export const accountPath = '/api/cloud-auth';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function configuredOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback.has(url.hostname)))) {
    throw new Error('Invalid cloud auth origin');
  }
  return url;
}

export function cloudAuthConfig(env = process.env) {
  if (env.CRATEFLOW_CLOUD_AUTH_ENABLED !== 'true' ||
      env.VERCEL_ENV === 'production' || env.VERCEL_TARGET_ENV === 'production') return null;
  const app = configuredOrigin(env.CRATEFLOW_CLOUD_AUTH_ORIGIN);
  const project = configuredOrigin(env.SUPABASE_URL);
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey || '')) {
    throw new Error('Missing Supabase publishable key');
  }
  return {
    origin: app.origin,
    host: app.host,
    secure: app.protocol === 'https:',
    project: project.origin,
    publishableKey,
    google: env.CRATEFLOW_CLOUD_GOOGLE_ENABLED === 'true',
  };
}

export function cloudAuthClient(req, res, config, fetch = globalThis.fetch) {
  const name = config.secure ? '__Host-cf-cloud-session' : 'cf-cloud-session';
  const current = new Map(parseCookieHeader(req.headers.cookie || '').map(({ name, value }) => [name, value]));
  const headers = new Map();

  function setCookie(cookieName, value, { maxAge } = {}) {
    const attributes = { path: '/', httpOnly: true, secure: config.secure, sameSite: 'lax' };
    const expiresIn = cookieName.startsWith(name + '-code-verifier') ? 600 : 7 * 24 * 60 * 60;
    headers.set(cookieName, serializeCookieHeader(cookieName, value, {
      ...attributes, maxAge: maxAge === 0 ? 0 : expiresIn,
    }));
    if (maxAge === 0) current.delete(cookieName);
    else current.set(cookieName, value);
    res.setHeader('Set-Cookie', [...headers.values()]);
  }

  const client = createServerClient(config.project, config.publishableKey, {
    global: { fetch },
    cookieOptions: { name },
    cookies: {
      encode: 'tokens-only',
      getAll: () => [...current].map(([name, value]) => ({ name, value })),
      setAll: cookies => {
        for (const { name, value, options } of cookies) setCookie(name, value, options);
      },
    },
  });

  function clearSession() {
    for (const key of current.keys()) {
      if (key === name || key.startsWith(name + '.') || key === name + '-code-verifier' ||
          key.startsWith(name + '-code-verifier.')) setCookie(key, '', { maxAge: 0 });
    }
  }

  return { auth: client.auth, clearSession };
}
