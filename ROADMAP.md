# CRATEFLOW 2.0 — Delivery roadmap, decisions and acceptance gates

**Status:** Proposed scope and estimates, not guaranteed delivery dates. **Date:** 2026-11-20. Implementation to start only after Codex read-only audit and explicit authorization.

## 1. Sequencing
| Phase | Priority | Indicative effort | Work | Acceptance gate |
| --- | --- | --- | --- | --- |
| 0 — Technical audit | P0 | 2–4 engineer-days | Codebase map, tests/build, provider-ID contracts, threats, schema/RLS design, rollout strategy | Written audit, no production changes |
| 1 — DB/auth foundation | P0 | 4–7 engineer-days | Supabase dev/staging, SQL migrations, secure Auth email/Google, profiles, RLS, CI checks | Authentication works; cross-user negative RLS tests pass |
| 2 — Cloud Library migration | P0 | 5–9 engineer-days | Library CRUD, pagination, backup/preview/mapping, idempotent migration, synced second browser | Source and target counts reconciled; no data loss; cloud available across devices |
| 3 — Catalog & durable jobs | P1 | 7–12 engineer-days | Provider adapters, licensed shared cache with TTL or private fallback, queue, worker, per-user quotas/retries, export-ID gates | Browser may close mid-job; job resumes; no double paid lookups/exports |
| 4 — Playlist Workspace | P1 | 7–12 engineer-days | Nested folders, smart rules, manual ordering, playlists, Beatport verified export, Rekordbox regression | Playlist operations persist with RLS; exported results reported accurately |
| 5 — DJ Intelligence | P1 | 7–12 engineer-days | Mix compatibility, metadata completion, set optimizer, duration/timeline, editable set | Testable deterministic ordering and honest missing-data handling |
| 6 — Accounts, billing & launch | P2 | 6–10 engineer-days | Provider management, billing if approved, deletion/export, monitoring, load/security/restore tests | Approved privacy, payments and operational go-live checklist |

Approximate implementation effort from phases 1–6: **36–62 engineer-days**, excluding audit, unplanned API constraints, legal/commercial agreements, additional QA and product iterations. Estimate is not a commitment.

## 2. Proposed PR breakdown (small and reviewable)
1. **Audit/docs only:** `CURRENT_STATE_AUDIT.md`, `SECURITY_REVIEW.md`, implementation PR plan.
2. **Domain layer extraction:** move matching and music metadata normalization behind tested adapters, without behavior change; add fixture-based tests.
3. **Schema migration v1:** users/profiles + library + playlist tables + indexes + RLS + tests, nonproduction only.
4. **Auth skeleton:** Supabase email/Google, secure session, private dashboard boundary and logout.
5. **Library API/read path:** user-scoped CRUD, pagination, optimistic concurrency; initially behind feature flag.
6. **Browser migration preview:** backup/restore, mapping and idempotent upload; no deletion of existing state.
7. **Cloud cutover:** compare source/target, enable for internal cohort, rollback.
8. **Provider auth refactor:** bind Beatport/MusicAPI connections to authenticated user.
9. **Catalog adapters/cache:** verify provider rights, cache provenance and TTL, negative matching tests.
10. **Jobs/worker:** durable queue, per-item statuses, budgets, replay and cancellation tests.
11. **Export reliability:** idempotent Beatport remote writes, ID mapping, per-track reconciliation and download XML tests.
12. **Playlist folders and ordering:** server-enforced ownership and no-cross-user-references tests.
13. **Smart rules / library filtering:** validated DSL and query indices.
14. **DJ sets:** compatibility, duration estimation and timeline tests.
15. **Account export/deletion and billing:** separate approval gate and payment integration if needed.
16. **Launch hardening:** performance/cost instrumentation, backup drill, load and abuse tests.

## 3. Dependency chain
- Auth + RLS -> private Library APIs -> cloud migration -> reliable user-owned jobs -> multi-device synchronization.
- Provider binding -> trusted connected Beatport export -> production-grade quotas and billing.
- Library + explicit ordered playlists -> smart playlists/set creation.
- Reliable track duration + BPM/key -> meaningful timeline.
- Shared cross-user catalog requires **provider license approval**; if not approved, ship per-user cache.

## 4. Cost control and metrics
Track and compare:
- Successful imports, exact/review/failed matches, verified exports, unverified reads and wrong-version corrections.
- API.SH credit spend per successfully completed track, MusicAPI calls per export, MusicLink resolution cost.
- Metadata cache hit-rate and avoided provider lookups; avoid aggressive TTL violating contracts.
- P50/P95 import duration and queue latency, job retries, stuck jobs, partial export rates.
- DB storage split between library rows, index size, cache and history; backup/network costs.
- Tenant-isolation negative tests and backup-restore drill completion.

## 5. Key risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mixed provider IDs | Wrong Beatport tracks | Verified per-provider mapping; stop before write if ambiguous |
| Invalid remix match | Bad library, wasted purchase | Conservative version and ISRC checks; review state |
| Cross-account data leak | Critical privacy issue | RLS and authenticated backend, adversarial tests |
| Legacy localStorage overwritten | Permanent loss | Opt-in migration, user backup and reconciled cutover |
| Provider cache restrictions | Licensing risk | Legal/license check, user-scoped fallback |
| API cost overruns | Unsustainable economics | Per-user quotas, cost budgets and retries |
| Provider timeout after write | Duplicate Beatport playlist | Remote ID reconciliation, idempotent export state |
| Queue complexity | Delivery delay | One worker + DB queue first, no microservices |
| Unsupported Rekordbox XML | Failed DJ workflow | Real-version compatibility testing |
| Premature billing | Financial/security complexity | Later phase after product and costs verified |

## 6. Explicitly deferred
No Music Discovery, automatic Spotify playlist synchronization, Beatport purchase/cart automation, collaborative playlists, ratings/tags, or generic notifications in current agreed scope.

## 7. Immediate next action
Open `CODEX_START_PROMPT.md` in Codex with this repository. Perform audit only, produce findings and PR sequence, then obtain approval for Phase 1. **No DB instance, migration or production feature flag should be assumed to exist.**
