# First Codex prompt — CRATEFLOW 2.0

Copy the following task into Codex after selecting the existing GitHub repository `lurole/crateflow-dj-manager`.

---

You are the lead software architect and senior full-stack engineer for **CRATEFLOW 2.0**, an existing Vercel-hosted DJ web application. The application is already deployed; your first task is **read-only technical discovery and a safe migration proposal**. Do not implement new product features, deploy, connect paid APIs, write provider data, or modify production state in this first task.

**Repository:** `lurole/crateflow-dj-manager`
**Existing production entry:** `https://crateflow-dj-manager.vercel.app/?app=1`
**Product goal:** DJ music import → precise Beatport recording/version matching → BPM/key/genre → private cloud library → playlists, smart playlists and DJ sets → verified Beatport or Rekordbox export. Music Discovery is intentionally excluded.

### Mandatory reading
1. `AGENTS.md`
2. `PRODUCT_REQUIREMENTS.md`
3. `ARCHITECTURE.md`
4. `DATA_MODEL.md`
5. `MIGRATION_PLAN.md`
6. `SECURITY_OPERATIONS.md`
7. `ROADMAP.md`
8. `README.md`, source in `app.js`, `matching.js`, API routes, `build.js`, `server.js`, tests.

Treat all target documents as a **design** until verified against source code. Inventory what exists and what is missing.

### Audit tasks
A. Map imports, MusicLink/MusicAPI/API.SH calls, library state, matching engine, Beatport auth, lazy ID conversion, read-back verification, XML export and localStorage persistence. Record actual files/functions and state transitions.
B. Run `npm test` and `npm run build`. Report failures with reproducible commands; separate test failures from missing live credentials.
C. Examine security: origin-only checks, unauthenticated public routes, instance-local limits, HttpOnly Beatport session, absence of per-user auth/RLS; identify attack/fraud/cost risks.
D. Validate correctness: original title preservation, multi-artist names, mix/remix version discrimination, ISRC conflicts, ambiguous releases, duplicate imports, wrong-provider ID mapping, export read-back, missing/unavailable tracks and re-export behavior.
E. Evaluate frontend modularization and test seams, preserving the existing UI and user-visible flow.
F. Propose Supabase Auth (email/Google), normalized PostgreSQL schema with deny-by-default RLS, cloud library CRUD and incremental migration of localStorage key `crateflow_v1`.
G. Propose *permitted* shared metadata caching only; track identifiers must be namespaced and verified, and license/TTL restrictions recorded.
H. Propose durable queue/worker and per-user rate limits/budgets/idempotency; avoid premature microservices.
I. Compare proposed technologies and costs where evidence is available. Label all estimates and assumptions.

### Deliverables of this first task
1. **CURRENT_STATE_AUDIT.md**: source-grounded current-state architecture, feature parity, technical debt and severity.
2. **MIGRATION_IMPLEMENTATION_PLAN.md**: sequenced PRs (small reviewable changes), dependencies, tests, acceptance criteria, and a conservative rollback plan.
3. **SECURITY_REVIEW.md**: threat model, exposed endpoints, multi-tenant boundaries, secrets/quotas and urgent fixes.
4. **DATA_MIGRATION_MAPPING.md**: actual browser-state fields and mapping to proposed schema, idempotent import/merge policy and edge cases.
5. Summary in chat with critical/high/medium issues, steps to implement next, what was actually tested, what needs credentials/provider validation.

### Guardrails
- First task is **audit and documentation only**. Do not change existing application source files or migrate data.
- Do not run or bill live provider APIs unless explicitly authorized.
- Do not assume API.SH catalog ID equals MusicAPI playlist-item ID. Avoid writing unverified IDs.
- Do not modify `main`, production deployment, Supabase production, or any user's `localStorage`. Work on an isolated branch/PR for documents, or only report if the workspace is read-only.
- Never log, echo, or commit API keys, OAuth tokens, cookies, or user library contents.
- Do not invent provider contracts. Mark uncertain details for integration testing.
- Preserve current behavior until an alternative passes tests.
- Use German for the final audit summary; code and technical documents may use English for consistency with repository.

**Stop after delivering the audit and migration proposal.** The next implementation step will be authorized separately.

---
