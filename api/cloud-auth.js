import { accountPath, cloudAuthClient, cloudAuthConfig } from '../lib/cloud-auth.js';

const formType = 'application/x-www-form-urlencoded';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function accountPage(res, status, { message = '', user = null, google }) {
  const content = user
    ? `<p>Signed in as ${htmlEscape(user.email || 'CRATEFLOW account')}</p>
<form method="post"><button name="action" value="logout">Sign out</button></form>`
    : `<form method="post">
<label>Email <input name="email" type="email" maxlength="254" autocomplete="email" required></label>
<button name="action" value="email-start">Send a sign-in code</button>
</form>
<form method="post">
<label>Email <input name="email" type="email" maxlength="254" autocomplete="email" required></label>
<label>Code <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
<button name="action" value="email-verify">Sign in</button>
</form>
${google ? '<form method="post"><button name="action" value="google">Continue with Google</button></form>' : ''}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>CRATEFLOW Cloud Account</title></head><body><main>
<h1>CRATEFLOW Cloud Account</h1>
${message ? '<p role="status">' + htmlEscape(message) + '</p>' : ''}
${content}</main></body></html>`);
}

function redirect(res, location) {
  res.setHeader('Location', location);
  return res.status(303).end();
}

function formBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== formType) return null;
  if (typeof req.body === 'string' && req.body.length <= 4096) {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
}

export function createCloudAuthHandler({ env = process.env, fetch = globalThis.fetch } = {}) {
  return async function cloudAuth(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    let config;
    try {
      config = cloudAuthConfig(env);
    } catch {
      return res.status(503).send('Cloud authentication is not configured.');
    }
    if (!config) return res.status(404).end();

    // The browser may apply form-action to the OAuth redirect chain as well.
    const formTargets = config.google ? "'self' " + config.project + ' https://accounts.google.com' : "'self'";
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action " + formTargets +
      "; base-uri 'none'; frame-ancestors 'none'");

    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host !== config.host) return res.status(403).end();
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).end();
    }
    if (req.method === 'POST' && req.headers.origin !== config.origin) return res.status(403).end();

    const page = (status, message = '', user = null) => accountPage(res, status, { message, user, google: config.google });
    const { auth, clearSession } = cloudAuthClient(req, res, config, fetch);
    const callback = config.origin + accountPath + '?callback=1';

    try {
      if (req.method === 'GET') {
        const query = new URL(req.url, config.origin).searchParams;
        if (query.get('callback') === '1') {
          const code = query.get('code');
          if (!config.google || !code || !/^[A-Za-z0-9._~-]{1,512}$/.test(code)) return page(400, 'Google sign-in could not be completed.');
          const { error } = await auth.exchangeCodeForSession(code);
          return error ? page(400, 'Google sign-in could not be completed.') : redirect(res, accountPath);
        }
        const { data, error } = await auth.getUser();
        return page(200, '', error ? null : data.user);
      }

      const input = formBody(req);
      if (!input) return page(400, 'Invalid request.');
      if (input.action === 'logout') {
        let result;
        try { result = await auth.signOut({ scope: 'local' }); }
        finally { clearSession(); }
        return result.error ? page(503, 'Signed out in this browser. Supabase did not confirm remote revocation.') : redirect(res, accountPath);
      }
      if (input.action === 'google') {
        if (!config.google) return page(400, 'Google sign-in is unavailable.');
        const { data, error } = await auth.signInWithOAuth({
          provider: 'google', options: { redirectTo: callback, skipBrowserRedirect: true },
        });
        if (error || !data.url) return page(503, 'Google sign-in is unavailable.');
        const authorization = new URL(data.url);
        if (authorization.origin !== config.project || authorization.pathname !== '/auth/v1/authorize')
          return page(503, 'Google sign-in is unavailable.');
        return redirect(res, authorization.href);
      }

      const email = typeof input.email === 'string' ? input.email.trim() : '';
      if (email.length > 254 || !emailPattern.test(email)) return page(400, 'Enter a valid email address.');
      if (input.action === 'email-start') {
        const { error } = await auth.signInWithOtp({ email });
        if (error?.status === 429) return page(429, 'Try again later.');
        if (error && (!error.status || error.status >= 500)) return page(503, 'Email sign-in is temporarily unavailable.');
        return page(200, 'If this address can sign in, a code will arrive by email.');
      }
      if (input.action === 'email-verify') {
        if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code))
          return page(400, 'Enter the six-digit code from your email.');
        const { error } = await auth.verifyOtp({ email, token: input.code, type: 'email' });
        return error ? page(400, 'The sign-in code could not be verified.') : redirect(res, accountPath);
      }
      return page(400, 'Unsupported action.');
    } catch {
      return page(503, 'Cloud authentication is temporarily unavailable.');
    }
  };
}

export default createCloudAuthHandler();
