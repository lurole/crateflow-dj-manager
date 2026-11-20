# Beatport playlist export

## Track verification

The browser asks the existing connected Beatport search route to verify each selected recording for a new export UUID. This uses one MusicAPI search per track and respects the route's existing pacing. The search checks original title and artist credits, the selected release, explicit versions and available ISRCs. The returned connected ID must be unique within the provider results. A MusicAPI selection must match its connected ID. An API.SH selection requires corroboration through an explicit Beatport catalog reference or a matching ISRC, in addition to matching metadata. Numeric MusicAPI IDs alone give no Beatport catalog evidence. Conflicting, incomplete or ambiguous evidence stops the export before playlist creation.

The server signs the result for the export UUID, current Beatport connection and request host. Proofs expire in 15 minutes. The create route derives item IDs from these proofs. Playlist creation returns a signed receipt with the remote ID and verified selection. A new append requires a receipt less than five minutes old and a readable, empty playlist. The MusicAPI naming convention for Beatport Original Mix is used when an otherwise versionless connected item is consistent with that version. Membership confirmation and purchase availability are reported separately. [Connected Beatport metadata](https://musicapi.com/docs/connect-users/configure-beatport) · [Connected search](https://musicapi.com/docs/endpoints/search-tracks-albums-and-artists)

## States and recovery

| State | Meaning and action |
| --- | --- |
| **Failed before create** | Validation, connection or track verification stopped the export before an external playlist write. Resolve the reported issue and initiate a new export. |
| **Create pending or unverified** | The create request may have reached Beatport. Timeout, network loss, provider error and an unusable create response leave an unknown outcome. **Check transfer** can read a known receipt from the same still-running server instance, if available. Without a confirmed remote ID, use the name and time to review the account manually. A matching name alone cannot confirm identity. |
| **Created, add pending or unverified** | The playlist ID is known. An append error, timeout or lost response may leave a partial playlist. **Check transfer** reads current contents and does not append again. A failed pre-append read can also stop dispatch before the add request. |
| **Read-back unverified** | The playlist exists and its contents or track identity could not be verified. **Check transfer** rereads the current contents. Repeated reads are bounded. |
| **Partially verified** | At least one item was confirmed. The report lists missing, mismatched, unavailable and unverified items separately. Unexpected or unidentified entries prevent full verification. |
| **Fully verified** | A complete read-back verified every requested connected track ID and its identity. Purchase availability is recorded separately when known. |

Open Beatport to resolve an unclear export or complete remaining changes manually. **Mark manually reviewed** acknowledges that check and releases the local block on further exports. It has no effect on the remote playlist. Repeated requests using the same action on an active browser export require a read-back or manual review. A previously verified export with the same name and selection remains visible in the recent history. Creating another playlist intentionally requires a different name while that export remains in the journal.

## Guarantees in this release

- Before calling create or append the browser saves the pending stage in a separate `crateflow_beatport_exports_v1` localStorage journal. It saves the remote ID and recovery receipt before calling append. A failed checkpoint prevents the next write. The journal retains up to 30 recent jobs and stays in the same browser profile. Clearing site storage, using a different browser or restoring the library JSON on another device does not restore this journal.
- Write dispatches use Web Locks across tabs of the same origin. Browsers without Web Locks need to handle the export manually in Beatport. The browser does not replay an uncertain write. A verification request never calls a provider write endpoint.
- On Vercel, a bounded in-memory record coalesces duplicate requests on the same warm instance for up to 30 minutes. Cold instances have no shared ledger. A signed receipt can still authorize read-back for 30 days on the same host and connected account, subject to the current signing secret. A lost create response without a recoverable ID may require manual review.
- The public MusicAPI endpoints describe create, append and read operations. Their documentation provides no atomic create-and-append or write-idempotency guarantee for this integration. An empty read-back can lag a write and the in-memory guard cannot serialize requests across instances, devices or browser profiles. This is a best-effort duplicate guard for the supported browser workflow. The integration has been exercised with offline fixtures. A representative live Beatport account and provider write permissions require separate validation. [Create](https://musicapi.com/docs/endpoints/create-playlist) · [Append](https://musicapi.com/docs/endpoints/add-items-to-playlist) · [Read](https://musicapi.com/docs/endpoints/get-playlist-items)

## Phase 1 prerequisites

Introduce a first-party authenticated account and bind each provider connection to its owner. Keep provider credentials and signing material server-side with a rotation strategy. Define private export job and item tables with RLS, account-scoped idempotency keys, immutable request fingerprints and persisted remote IDs, attempts and per-item outcomes. A durable export queue needs an atomic worker claim or lease, recorded write intent and a read-only reconciliation path for uncertain outcomes. Add account-level quotas, retention and bearer-secret handling. Verify account isolation and recovery across fresh instances before enabling automated resumption.

A persistent queue and database can coordinate internal processing and let another instance resume a known job. If a provider write succeeds and the response is lost before the remote ID can be stored, automatic reconciliation still depends on a verified provider correlation mechanism or write-idempotency support. Preserve the manual review state for any remaining uncertainty.
