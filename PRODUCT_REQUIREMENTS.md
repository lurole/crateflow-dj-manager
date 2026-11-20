# CRATEFLOW 2.0 — Product requirements (PRD)

**Status:** Agreed feature scope / proposed technical implementation. **Date:** 2026-11-20. **Source of truth:** User decisions recorded in project planning. This file is a future specification, not a claim that all features already exist.

## 1. Vision and positioning
CRATEFLOW is a DJ-oriented music workflow product: collect tracks from Spotify and later additional platforms, find the *correct* Beatport version, enrich BPM/Camelot/genre, maintain a personal cross-device library, organize playlists and sets, and export with verification. **Not** a streaming, music-selling, or independent music-discovery product.

Primary users: DJs with large libraries, Spotify scouting habits, Beatport purchase workflows, and Rekordbox preparation. Primary outcome: reduce repetitive searching and bad version imports while preserving DJ control.

Product principles:
- Single clear import action, minimal matching jargon; show only useful state and interventions.
- Correct release/version > high numeric matching score. Never display confidence percentage in default DJ UI.
- The user owns their organization, history and playlists. Shared catalog data is only an optional permitted cache.
- Preserve original source track identity; display verified Beatport title when appropriate.
- Explain failures, partial completion, unavailable releases, and verification uncertainty.
- Separate import/matching from external account mutations and purchasing.
- Prefer incremental delivery, no breaking rewrite and no silent data loss.

## 2. Agreed functional scope
### 2.1 Music Library — approved (5)
- Intelligent combinations of filters (BPM, musical key, genre, artist, status; indexed DB queries at scale).
- Personal playlists and nested folders (also elaborated below).
- Automatic duplicate detection: distinguish duplicate import, same recording/release, distinct remix/master.
- Cloud library synchronized between devices for the same account.
- Import and purchase history: audit of source, timestamps, selection, manual purchase/ownership status. **Do not claim purchase was verified solely because a playlist contains a track.**

### 2.2 Playlist Management — approved (7)
- Create, edit, delete and manage playlists.
- Drag/drop manual track ordering with stable position and conflict handling.
- Playlist folders and nested subfolders.
- Dynamic rule-driven smart playlists, recalculated from private library without duplicating track data.
- Beatport playlist export with cross-provider ID mapping, post-write read-back, explicit partial-failure reporting.
- Rekordbox XML export. Path-based Rekordbox workflows require user-provided local files; cloud metadata alone cannot supply downloadable audio.
- Automatic DJ set track ordering; non-destructive editable suggestion.

**Not selected:** playlist merge/duplicate as a standalone feature; automatic Spotify playlist synchronization.

### 2.3 DJ Intelligence — approved (4)
- Harmonic mixing using BPM/Camelot with uncertainty where fields are missing.
- Automatic set creation from the user's selected library/playlist.
- BPM/key metadata enrichment and optional future authorized audio analysis only if separately approved. Current implementation **does not** analyze waveforms.
- Set timeline: order, estimated duration and user-editable choices; requires reliable track-duration data.

**Not selected:** separate energy curve, standalone automatic transition recommendations.

### 2.4 Integrations & Automation — approved (7)
- Spotify track and public playlist import; current providers: MusicLink for individual tracks, MusicAPI Core for public playlists.
- Automatic Beatport matching, preserving artist/version/ISRC safeguards.
- Automated metadata enrichment from provider data, currently API.SH primary, MusicAPI fallback.
- Beatport playlist export plus actual-content verification.
- Rekordbox XML export.
- Resumable background imports that continue when the browser is closed.
- Extensible connectors for additional music sources, **provider selection and rights to be decided later**.

**Not selected:** Beatport cart automation, automatic Spotify playlist sync, import completion notifications.

### 2.5 User Account — approved (8)
- Email and Google sign-in.
- Personal user profile.
- Cloud library and multi-device sync.
- Manage connected music services and disconnect connections.
- Import/export history.
- User data export and backup.
- Subscriptions and billing administration, with an external payment service considered for future implementation.
- Privacy, personal data deletion, account deletion and appropriate retention.

**Not selected:** personal DJ preference settings as a standalone user feature, collaborative playlists.

### 2.6 Explicit out-of-scope
- Music Discovery / recommendations / similar-track discovery.
- Hosting, streaming or downloading copyrighted audio; automated purchasing.
- Guaranteed audio-identical verification without audio fingerprinting/rights.
- Automatic Spotify tracking/sync or general notifications.
- User-defined ratings, favorites, custom tags and arbitrary custom track fields.
- Collaborative playlists and social features.

## 3. User journeys
**Import:** user pastes Spotify track/playlist URL or Artist–Title -> system parses/resolves -> dedupes -> checks permitted cache -> Beatport matching -> optional metadata -> saves library -> shows found/review/error. No Spotify account login currently needed for supported public data.

**Library:** signed-in user views their own tracks, filters/sorts, edits status, organizes playlists/folders; data survives browser replacement.

**Playlist/export:** user selects tracks -> app confirms qualified provider identity -> explicit Create Beatport Playlist action -> server writes -> reads back actual entries -> marks confirmed, missing, mismatched, unavailable or unverified; does not purchase.

**DJ set:** user selects playlist, requests automatic order, reviews harmonic suggestions and duration, edits manually, saves set, exports relevant Rekordbox XML when local file-location data is valid.

**Account:** user signs up, optionally migrates browser library with preview/checkpoint, connects Beatport, checks history, downloads data export, or deletes account.

## 4. UX states
Track-level: pending, resolving, searching, found, needs_review, enrichment_partial, failed, exported_verified; ownership/download statuses separate from matching and export statuses.
Job-level: queued, running, partial, completed, failed, canceled, needs_review.
Export-level: requested, validating, writing, verifying, verified, partial, unverified, failed.
Do not collapse distinct meanings of **found** vs **available to buy** vs **in playlist** vs **purchased**.

## 5. Nonfunctional requirements
- Tenant isolation: no cross-user read/write; least privilege and RLS.
- Data durability: migrations/backups and restoration; idempotent writes/retries.
- Security: no secrets client-side, verifiable OAuth/session binding, server-side API quotas and billing entitlements.
- Performance: bounded queries/indexes, pagination; avoid shipping whole library per request.
- Reliability: retries with backoff, dedupe keys, dead-letter handling, external API circuit breaking.
- Observability: job progress/errors, provider latency/cost, cache hit rate and audit-safe logs.
- Accessibility: keyboard navigation, statuses understandable without color.
- Compliance: respect licenses of MusicLink, MusicAPI, API.SH, Spotify metadata and Beatport.
- Privacy: export/delete, minimal retention, protect provider tokens.

## 6. Suggested phase priorities
- **P0:** audit, Supabase foundation, auth, RLS, migration of current library, safe import/matching/export parity, backups.
- **P1:** playlists/folders/smart rules, filters, drag/drop, reliable history, queue/background imports, DJ set and timeline.
- **P2:** additional providers, production billing/subscriptions and hardening for commercialization.

## 7. Definition of done
Each feature requires schema and permissions, API contract, user-flow tests, failure handling, migration compatibility, provider-rights review where relevant, docs and rollback. No success UI without verifying the operation's asserted meaning.

## 8. Open decisions (not yet approved)
Supabase project/region, login UX and email delivery provider; actual API contract/ID equivalence verification; caching permissions and TTL; global cache vs private-only fallback; track-duration provider; queue worker runtime; Free/Pro entitlements/prices; retention and legal jurisdiction review. Resolve with evidence before implementation.
