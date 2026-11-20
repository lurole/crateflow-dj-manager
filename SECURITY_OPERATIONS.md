# CRATEFLOW 2.0 — Security, operations and integration runbook

**Status:** Target controls and documented MVP risks. Do not interpret proposed controls as already deployed.

## 1. Observed current security posture (from code)
- No CRATEFLOW user authentication or persistent multi-tenant database in the MVP. Library is browser-local `crateflow_v1`.
- Beatport connection uses MusicAPI verified integration and a signed, one-hour, HttpOnly, Secure SameSite=Lax cookie `cf_bp` scoped to `/api`; verified session is not equivalent to a CRATEFLOW user account.
- Many provider routes verify same-origin and use instance-local IP throttling, not durable per-user quotas. Origin checks alone are not a general authorization boundary and are not a complete CSRF defense in every deployment.
- MusicAPI, Musiclink and API.SH keys are configured server-side via Vercel environment variables.
- API.SH matching and fallback are browser-driven; repeated lookups may consume provider credits.
- Playlist export submits selected IDs after validation and reads back results. It can still leave partial remote playlists if provider/timeouts occur.
- Production app on Vercel; Node ESM, vanilla JS, `npm test` and `npm run build`.
- Provider contract/price/license terms and real-world end-to-end export accuracy need independent validation.

## 2. Threat model
**Assets:** private library/playlists, Spotify/Beatport source identities, credentials and OAuth sessions, paid API budget, billing entitlements, import/export history, personal file paths.

**Attackers/failures:** unauthorized user attempting cross-account reads, browser-provided false owner IDs, stolen account sessions, replay of webhook/provider callbacks, automation draining API credits, malicious CSV/data injection, mis-specified provider track ID, inaccurate/ambiguous release selection, duplicate export after timeout, data migration error.

**Controls:**
- Supabase Auth JWT verified server-side, refresh/revoke appropriately, Google OAuth configured with correct redirect origins, secure session handling.
- RLS enabled on every private table and tested against direct client queries; constrain child-parent relationships to same tenant.
- Credentials in Vercel secret env or an authenticated encrypted server-side token store; **service-role secret never client-side**.
- Server-side quota/rate limiting at user/account/project and provider levels; daily budget + circuit breaker, not just IP.
- Validate input size/type, Spotify IDs, ISRC, BPM, key, provider IDs, file paths, payload schema; only parameterized queries.
- Content Security Policy / headers and HTML escaping; ensure no stored XSS through artist/title/genre notes.
- Verify MusicAPI auth callbacks against provider, bind provider account connection to specific authenticated CRATEFLOW owner; prevent user/account swapping.
- Beatport playlist mutation requires explicit user action; use expiring idempotency key, external playlist-ID reconciliation, state machine and read-back before claiming success.
- Verify Stripe webhook signatures and event identity; never honor client-supplied paid tier.
- Minimal sanitized logs; redact cookies, bearer keys, passwords, raw user playlists and payment details.
- HTTPS, restrictive CORS, CSRF review for cookie-authenticated endpoints, strict cookie scoping and session rotation.
- Privacy workflows for user export, deletion and retained billing records.

## 3. Provider keys and environment variables (names only)
Existing observed:
- `MUSICLINK_API_KEY`
- `SPOTIFY_LINK_LOOKUP_ENABLED` (string `true` to enable)
- `MUSICAPI_CLIENT_ID`
- `MUSICAPI_CLIENT_SECRET`
- `MUSICAPI_ENABLE_VERIFICATION` (string `true` to enable)
- `APISH_API_KEY`

Target (names proposed, not necessarily in current code):
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` or appropriately named public key for RLS clients
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; subject to provider current terminology)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (server-only when billing implemented)
- Queue/worker secrets and optional `CRATEFLOW_CLOUD_ENABLED` feature flag

**Do not write secret values in docs, issues, PRs, screenshots or test output.**

## 4. Operational processes
### Deployment
- Protected main branch with PR review, CI `npm test` and `npm run build`, database migrations tested in staging before production.
- Preview Vercel deployments pointed to separate nonproduction Supabase credentials/tenant. Never point arbitrary preview branches at production service-role credentials.
- Migration deploy separate from data backfill and feature rollout; rollback application separately from database.

### Backups
- Enable documented Supabase recovery/PITR capabilities consistent with chosen plan.
- User JSON export with schema version and integrity checks.
- Regular restore drills to nonproduction project; monitor backup success.
- Never assume that an old DB backup automatically restores Beatport side effects.

### Monitoring
- Job queue age, attempts, failure rates, user-facing pending count.
- Provider response latency/status and budget spent per provider; cache hit rate and shared-cache eviction.
- Export verified/partial/unverified rates and mismatched track count.
- Auth and RLS denial anomalies, excessive requests, unexpected billing usage.
- Sanitized correlation IDs to trace per job/request without exposing raw credentials.

### Incident actions
- **API credit spike:** disable paid provider lookup flag, rate limit, inspect sanitized job logs.
- **Wrong Beatport tracks:** stop export, preserve affected source IDs and candidate evidence, avoid re-export until identities reviewed.
- **Cross-user data leak:** disable affected routes, revoke keys/sessions, investigate RLS and report under applicable law/policy.
- **Partial export:** keep remote playlist ID, read back, reconcile existing playlist; no blind duplicate creation.
- **Data loss:** disable writes, restore from verified DB/user backup, correlate migration map and reconcile duplicates.

## 5. Auth/RLS adversarial test matrix
| Attempt | Expected behavior |
| --- | --- |
| Anonymous SELECT private library | Denied |
| User A SELECT/UPDATE User B song | Denied |
| User A insert own row referencing User B playlist | Denied |
| User A move folder under User B folder | Denied |
| User A read other user's provider connection token | Denied, token not queryable |
| User A call export for User B playlist | Denied |
| Browser forges `user_id=B` with A session | Server uses A, rejects foreign target |
| User A requests elevated billing tier | Ignored unless verified payment state |
| Expired JWT / invalid OAuth state | Rejected |
| Replayed provider callback / export job idempotency | No duplicate effect |
| Import 10,000 oversized or malicious rows | Bounded/rejected safely |
| RLS bypass via unprotected service-role endpoint | No public route with unvalidated ownership |

## 6. Privacy and provider licenses
- Confirm whether MusicLink, MusicAPI, API.SH and platforms permit a **cross-user shared** metadata cache; terms may differ from local personal use. If not, limit cache to per-user or temporary server operation.
- Do not store audio, scrape providers, or imply track ownership from being present in a playlist.
- Classify personal file paths and activity history as private user data.
- Document data processor region, lawful basis, deletion, international transfers and billing retention before commercial launch. Seek appropriate legal review for launch.
- Retain only needed account/usage data; provider credentials disconnected on request.

## 7. Service-level targets (initial, to validate)
- No unauthorized cross-tenant access in automated negative tests.
- Zero silent overwrites or merges of different remixes.
- Zero falsely claimed verified exports absent read-back evidence.
- Recoverable processing after browser closes for the future queue.
- Track API call cost per successful match and make cost budgets configurable.
- Do not promise specific uptime, matching percentage or processing minutes without measurements.
