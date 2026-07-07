# Server-Side Requirements — cloud work the client cannot do

**Date:** 10 June 2026 · **Source:** GPT Final Audit + Gemini Final Audit (both 2026-06-10), tri-audit fix waves F1–F3
**Status:** OPEN — none of these are deployable from the client repo; all need Azure / SharePoint changes.

The client now enforces every rule below at its own boundary, but client-side checks are UX + data hygiene, **not security** (framework P-13). A device with DevTools — or a stale build — can still send anything. Each item below must be enforced in the Logic Apps / SharePoint before beta.

## P0 — before multi-store beta

1. **Transfer receive idempotency (Gemini CRIT-02).**
   `push-v2` must reject (or flag-and-quarantine) a `transfer_in` row when the
   `(TransferId, Type='transfer_in', StoreId)` combination already exists in
   StockTransactions from a different device. The client now blocks local
   replays via a ledger guard, but two offline devices can still both receive
   before either syncs. Server is the only place this can be closed.

2. **Ingest validation on push-v2 (GPT H-01 / M-02).** Reject rows with:
   - negative or non-safe-integer `Qty`
   - non-finite money fields
   - unknown `StoreId` / `ProductId` (validate against the Stores/Products lists)
   - reserved keys (`__proto__`, `constructor`, `prototype`) in any id
   - ids containing `< > " ' \`` (sanitizer-detach class, Gemini CRIT-04)
   - invalid/unparseable `Date`
   - invalid transaction `Type` (whitelist)
   Log rejected rows to a quarantine list with device id + timestamp so an
   admin can see what was refused (do NOT silently drop).

3. **Master-data publication (Gemini CRIT-01 — upstream half).**
   The client now PULLS a versioned `master_data` item from AppConfig
   (`ConfigType='master_data'`, `ConfigData={version, products[], stores[],
   categories[], productTypes[]}`) and merges it on every launch. Two pieces
   are needed server-side:
   - **Publish path:** keep the AppConfig `master_data` item up to date from the
     SharePoint Products/Stores lists (Logic App on list-change, or a manual
     "publish catalogue" flow). Bump `version` (integer, monotonic) on every publish.
   - **Catalogue write endpoint (new Logic App):** Director devices currently
     have NO way to push a new product/price upward — local additions stay
     local until this exists. Until then, catalogue changes must be made in
     SharePoint directly and published via `master_data`.

4. **Authorization at the cloud boundary (GPT M-02 / framework P-13).**
   Logic Apps must validate actor identity/role/store scope server-side before
   accepting writes. Client role gates are UX only. Minimum viable: per-store
   shared secrets or per-device registration ids checked by push-v2, plus role
   checks for transaction types (e.g. only Director devices may push
   `adjustment_*`).
   *(Progress: device layer = Chunk 5 DONE; person layer = Chunk 9 IN BUILD; row scoping = Chunk 10 next.)*

4b. **Stock-take approval + discrepancy resolution move fully server-side (KUNAL COMMITMENT, 2026-07-07 —
   deferred from Chunk 9 / D9-7).** Kunal: *"keep a note of this as I really do want it — I ultimately don't
   want anything in the browser that is not in the cloud."* Today these Director-only actions are enforced
   client-side and write ledger rows via the normal push; Chunk 9 adds the person re-prompt (sudo mode) at the
   UI, but a tampered device can still forge the underlying rows (P-13 residual; compensating controls =
   append-only ledger audit trail + Chunk 10 row scoping). The real fix is a Director-gated server endpoint
   (device key + person verify) that performs the approval/resolution write itself. Target: first post-launch
   server wave.

## P1 — before scale / before the ledger grows

5. **SharePoint 5,000-item view threshold (Gemini architectural).**
   Add indexed columns on StockTransactions for `SyncTimestamp` (pull cursor
   filter) and `TransactionId` (dedup lookup) BEFORE the list crosses ~5k rows,
   or pull-v2 queries will start failing outright.

6. **Staging environment for sync validation (GPT M-03).**
   A disposable SharePoint site + Logic App set so the full probe suite can run
   against real cloud plumbing with write isolation (live cloud was explicitly
   out of scope for all audits to date). Required before FULL SIGN-OFF can ever
   cover the cloud path.

7. **SAS rotation / expiry policy (GPT M-02).** Document and automate Logic App
   SAS key rotation; the client already keeps SAS URLs in sessionStorage only.

## P2 — hardening

8. **Email notification URLs → runtime config (existing backlog, MFL-010
   partially done):** confirm `emailUrl` is only served via AppConfig and remove
   any residual hardcoded fallback.
9. **iOS 7-day storage eviction (Gemini architectural):** the mitigation is a
   visible "last cloud sync" indicator (client backlog) + staff guidance to open
   the app weekly; nothing server-side beyond reliable pull.
10. **Self-hosted vendor assets (GPT M-01):** vendor Dexie/Chart.js into the
    repo + SWA so first install/update doesn't depend on jsdelivr/Google Fonts.
    (Build/deploy change, not a code fix — listed here so it isn't lost.)
