# CRATEFLOW — Agent instructions

These instructions apply to the entire repository. Read `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `MIGRATION_PLAN.md`, `SECURITY_OPERATIONS.md`, and `ROADMAP.md` before implementing CRATEFLOW 2.0.

## Mission
Build a secure, reliable, economical cloud music workflow for DJs: import tracks; identify the **correct recording and mix/version**; enrich metadata; organize private libraries, playlists and sets; export to Beatport/Rekordbox. Minimize UI friction without hiding failed matches or export errors. Do not introduce independent music discovery.

## Operating rules
1. **Audit before changes.** Trace the concrete code paths and tests. Clearly distinguish current code from target design. No unsupported API assumptions.
2. **Start with read-only repository audit and an implementation plan.** For the first Codex task, make no production-facing code changes, migrations, external writes, purchases, or deployments unless explicitly authorized.
3. **Never commit straight to production by default.** Use a feature branch, small atomic commits and a Pull Request. Respect the existing working Vercel deployment.
4. **Never expose secrets** or add keys to browser code, logs, fixtures, or Git. Environment variable names may be documented, not values.
5. **Preserve user data.** Existing state lives in browser `localStorage` key `crateflow_v1`. Back up first; migration must be idempotent, reversible during rollout, non-destructive and explicitly opt-in until validated.
6. **Never conflate IDs.** Spotify track ID, ISRC, API.SH Beatport catalog ID and MusicAPI connected-service item ID identify different entities/namespaces. A title/artist match alone does not prove recording identity. Never export an unverified cross-provider ID.
7. **Matching is conservative.** Exact normalized title and artist identities, compatible version, no ISRC conflict, and unambiguous candidate. Wrong remixes must not auto-select. Preserve original imported identity separately from display title.
8. **External actions require clear intent.** Importing does not buy audio, add to cart or export a playlist. Do not add checkout/purchase automation without a distinct decision and authorized API.
9. **Manage API budgets.** Avoid duplicate paid lookups; employ bounded caching only when provider terms allow; authenticated per-user rate limits and idempotent job execution are required before public scaling.
10. **Secure by default.** Supabase Auth, deny-by-default RLS, server-side authorization, protected provider connections, validated webhooks, no service-role key in client. Add migration/RLS tests for cross-user access.
11. **Keep the product scope disciplined.** User-approved requirements are in `PRODUCT_REQUIREMENTS.md`; do not silently reintroduce excluded features.
12. **Record evidence.** Run `npm test`, `npm run build`, syntax/security checks and targeted negative tests; report any tool/environment limitations. No claim of production readiness without live integration verification.
13. **Update documentation** when schema, APIs, data flows, or decisions change. Document operational runbooks and the rollback procedure before rollout.
14. **Follow the repo conventions**, initially vanilla JS + Node ESM + Vercel functions. Recommend modularization before introducing a new SPA framework; do not rewrite everything without evidence.

## First task — mandatory sequence
- Inspect repository, scripts, API routes, imports, schemas, tests and active deployment assumptions.
- Run tests/build and identify reproducible failures; check integration contracts against official provider docs where necessary.
- Assess authentication, localStorage data preservation, cross-provider matching/export-ID safety, billing/credits and API limits.
- Produce a prioritized technical-audit report, specific file-level refactoring sequence, Supabase migration design, RLS test matrix, risk register, cost assumptions, and PR breakdown.
- **Stop before modifying functionality**. Request the next authorized implementation scope.

## Acceptance bar for future implementation
- No silent data loss or unintended merge of different versions.
- Public endpoints use authenticated, server-enforced authorization/quotas where relevant.
- Tests cover duplicate prevention, ISRC conflict, ambiguous versions, idempotent jobs, export read-back and isolation between users.
- Every schema change has migration, indexes, RLS, backfill strategy, and rollback approach.
- Frontend can clearly distinguish found, review, pending, failed, and verified-export outcomes.
