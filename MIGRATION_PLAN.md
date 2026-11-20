# CRATEFLOW 2.0 — Incremental migration and rollback plan

**Status:** Proposal; no database configured, schema applied, or user data migrated by this document.

## 1. Non-negotiable goals
- Existing Vercel production site continues working until cloud version is verified.
- The browser library under `localStorage['crateflow_v1']` is never silently destroyed or overwritten.
- Source metadata, Beatport ID mappings, review states, playlist membership, manual statuses, history, and personal file paths are preserved or explicitly flagged as incompatible; never silently discarded.
- Migration is user-authorized, idempotent, visible, testable and recoverable.
- New account ownership is verified server-side. Never attach an unauthenticated browser's data to another user's account without explicit confirmation.

## 2. Observed legacy data shape
At startup `app.js` sets `defaults = {tracks:[],playlists:[],settings:{}}`, then merges the JSON stored in `crateflow_v1`. It also maintains `syncHistory` and a local catalog cache. Fields observed in source include:
- `tracks[]`: `id`, `title`, `artist`, `remix`, `album`, `genre`, `bpm`, `key`, `filePath`, `status`, `isrc`, `spotifyId`, `spotifyUrl`, `playlistId`, `source`, `date`, `importTitle`, `importArtist`, `importRemix`, `titleSource`, `studioResult`, `studioCandidate`, `catalog`, `djEnrichment`, `match`, `exportMapping`, `beatportPlaylistId`, `beatportPlaylistExported`, `beatportPlaylistVerified`, `beatportExportIssue`, `studioSelected`.
- `playlists[]` has `id` and `name`. Playlists written by the updated importer also have an ordered `trackIds[]` array referencing local library tracks. Spotify imports have a separate `spotifyPlaylistId` that identifies the source playlist.
- `settings`: `preferExtended`, potential other preferences, and legacy `musicApiSlug`.
- `syncHistory[]`: event records `id`, `trackId`, `title`, `artist`, `action`, `details`, `time`.
- `catalogCache`: browser-local provider candidates and lookup timestamps; not automatically eligible for global reuse.
- Separate onboarding/sessionStorage keys are not the user's library; never migrate ephemeral third-party cookies.

Note: actual legacy fields may vary across versions; do not assume all records contain the listed optional fields.

## 3. Suggested field mapping (validate first)
| Legacy field | Target | Rule |
| --- | --- | --- |
| `track.id` | `legacy_import_map.legacy_track_id` / target `library_tracks.id` | Preserve mapping and avoid collision; do not trust arbitrary supplied UUID owner |
| `title` | `library_tracks.display_title` | User-visible title |
| `importTitle || title` | `library_tracks.original_title` | Original source for rematching |
| `artist`, `importArtist` | `display_artist`, `original_artist` | Preserve both |
| `remix`, `importRemix` | `original_remix` | Keep version evidence |
| `spotifyId`, `isrc` | corresponding private fields | Validate format; preserve errors as review |
| `bpm`, `key`, `genre` | private fields | Type-check, provenance if known, do not invent |
| `status` | `ownership_status` | Separate matching/export from purchase status |
| `studioResult`, `studioCandidate` | `match_status`, optional private match evidence | Revalidate IDs before any export; never mark old heuristic match universally trusted |
| `exportMapping` | private per-user verified mapping | Validate fingerprint/ID/provider scope; expire or force recheck as needed |
| `beatportPlaylistId`, `beatportExportIssue` | export history / flags | Preserve remote ID and uncertain status; no automatic re-export |
| `filePath` | private track file-location metadata | Preserve locally or import only with clear privacy warning; paths are sensitive and not usable across devices |
| `playlists[].trackIds[]` or legacy `tracks[].playlistId` | `playlists`, `playlist_tracks` | Use the explicit ordered IDs when present, including an empty list. Fall back to legacy track membership and track-array order when absent. Map each occurrence to its own position and reuse the same library track across memberships. |
| `playlists[].spotifyPlaylistId` | Private Spotify playlist source reference | Validate and store separately from local playlist ID, Spotify track ID and Beatport export ID. |
| `syncHistory[]` | `library_track_events` | Sanitize sensitive payload; preserve timestamps |
| `catalogCache` | usually **do not migrate** to global cache | Re-verify licensing, provenance and freshness first |

## 4. Migration implementation workflow
1. **Schema & auth staging:** create separate Supabase development/staging project, versioned SQL, RLS, ownership and constraint tests. No production DB.
2. **Backup UX:** provide a clear JSON export, integrity summary (counts/hash), and documented restore instructions; prefer a user-held copy before any import.
3. **Read-only preview:** parse `crateflow_v1` in browser; validate structure/size/IDs; report counts, unsupported fields, conflicts and possible duplicates **before** writing.
4. **Identity binding:** sign in first; server verifies JWT and creates an immutable owner-scoped migration session/idempotency key.
5. **Batch upload:** send bounded chunks to authenticated migration endpoint; server validates and normalizes; use DB transaction per chunk and a unique `(user_id, source_instance_id, legacy_track_id)` mapping.
6. **Playlist relationships:** create folders/playlists, then link tracks using stable legacy-to-new ID map. Preserve order and prevent orphan references.
7. **Audit and compare:** source vs database track counts, status totals, playlist membership, BPM/key, original/Beatport title, matched/unmatched, histories. Generate downloadable differences; do not call all imports successful if partial.
8. **Dual-read / feature flag (optional):** cloud is the primary view for migrated users; retain local backup for rollback. Avoid unsafe unsynchronized dual writes if no conflict-resolution policy.
9. **Controlled cutover:** enable for test users, verify on two browsers, run regressions including offline reload and conflicting simultaneous edits, then staged public rollout.
10. **Legacy retirement:** only after explicit successful acknowledgment and backup. Never automatically delete `crateflow_v1` during initial migration.

## 5. Duplicates and conflicts
- Exact same verified Spotify ID for one user: offer dedupe only after preserving differences in status, file paths and history.
- Same artist/title but different mix/version, ISRC or catalog ID: keep distinct until reviewed.
- Same local `id` across two different browsers: use a migration source instance key and deterministic mapping, not global UUID assumption.
- Conflicting user edits across devices: choose an explicit optimistic concurrency policy (`updated_at`/revision) and show conflict where necessary, rather than silently last-write-wins for playlist ordering.
- Multiple legacy playlists with same name: do not merge by name alone.
- Missing metadata: preserve as unknown. Never backfill fictitious BPM/key.
- Unverified export result: preserve remote playlist ID; do not attempt duplicate Beatport write during migration.

## 6. Rollback playbook
- Production code remains on known-good commit; DB migrations tested separately.
- If cloud sync produces corruption or cross-user leakage: immediately disable feature flag / turn off cloud writes; revoke problematic credentials/sessions if warranted.
- Preserve source localStorage and user backup, snapshot staging/prod DB as applicable, reconcile by migration IDs, and restore app from prior deployment/PR.
- Rollback should not delete newly created cloud-only records without explicit user backup and reconciliation.
- Avoid destructive `DROP` migrations and irreversible legacy-to-cloud transformations in first release.

## 7. Required migration tests
- 0, 1, 10, 1,000+ tracks; huge and malformed input; Unicode; corrupt JSON; missing artists; repeated Spotify IDs.
- Different remixes same title; missing ISRC; conflicting key/BPM; mixed verification sources.
- Multiple playlists including empty and duplicates; unknown legacy playlist IDs.
- Manual purchased/downloaded statuses and file paths retained; no raw file upload.
- Cancel mid-import, restart/duplicate upload, cross-tenant tampering, expired token.
- Reconcile missing/partial batches; account deletion; backup/restore; two-device sync.
- No accidental network calls to paid providers during migration.

## 8. Rollout gates
- G0: audited schema/migration mapping.
- G1: full RLS isolation with negative tests.
- G2: staging migration counts equal verified source counts or explicitly documented exceptions.
- G3: one user can login on second device and see the same library after sync.
- G4: current Beatport matching/export remains equivalent or safer.
- G5: small authorized production cohort and verified recovery plan.
