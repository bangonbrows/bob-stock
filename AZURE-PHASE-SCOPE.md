# AZURE / SERVER PHASE — SCOPE (working draft)

**Date:** 2026-06-22 · **Status:** SCOPING — no work started. Sources: `SERVER-SIDE-REQUIREMENTS.md` (10-item punch list), `REMAINING-WORK.md` Bucket A, + client-code contract reconstruction (sync.js/db.js/index.html).

**Why this phase exists:** the backend already works, but it does no server-side **validation, authorization, idempotency**, and it only syncs the **stock ledger** — not the transfer/delivery/stock-take *records*. Every rule the client enforces is UX/data-hygiene only (framework P-13); a DevTools device or stale build can still send anything. None of this is fixable from the app repo — it needs Azure Logic App + SharePoint changes.

---

## 1. What exists today (reconstructed from the client contracts)

**Infra:** Azure Static Web App (`bob-stock`, now serving `main`/9ba9917) · 4 Logic Apps · 4 SharePoint lists · SAS-in-URL auth only.

**The 4 Logic Apps:**
- `config` — returns AppConfig items: `sync_config` (the push/pull/email SAS URLs) + `master_data` (versioned catalogue).
- `push-v2` — accepts `POST {data:{transactions:[…]}}`, writes rows to the **StockTransactions** list, server-dedups by `TransactionId`, returns `{status, processedCount, serverTimestamp}`. **Does NO validation/auth.**
- `pull-v2` — accepts a `{since}` cursor, returns `{items:[…], serverTimestamp}` filtered by server-set `SyncTimestamp`. Paginated.
- `email` — transfer + stock-take notifications.

**The StockTransaction row that syncs** (from `_toSharePoint`, sync.js:556): `TransactionId, Date, StoreId, ProductId, Type, Qty, StaffName, Reason, DeviceId, Timestamp, TransferId` (+ tombstone fields `TargetTransactionId/DeletedBy/DeletedAt/DeleteReason`). `SyncTimestamp` is set server-side as the pull cursor.

**What syncs vs what doesn't (the key gap):**
| Data | Syncs? | Notes |
|------|--------|-------|
| `transactions` (stock ledger) | ✅ push/pull | the only synced table |
| tombstones (deletes) | ✅ | as `Type:'deleted'` rows w/ TargetTransactionId |
| transfer/delivery **stock movements** | ✅ | they ARE ledger rows (carry TransferId) |
| `transfers` (lifecycle: draft→submit→receive→flag→resolve, items, flag notes, status) | ❌ **local-only** | device B sees stock move but can't see/action the transfer |
| `deliveries` (cost breakdown, landed-cost lines) | ❌ **local-only** | cost history is local per device |
| `stockTakes` (per-line counts, approval state) | ❌ **local-only** | |
| `costHistory` | ❌ **local-only** | rides on deliveries |
| catalogue writes (new product/price from a Director device) | ❌ | only flows DOWN via `master_data`; no upward path |

**Auth today:** SAS URL only. No actor/role/store check server-side. Anyone with a URL (extractable via DevTools) can push/pull/forge/delete any store's rows.

---

## 2. The work, in priority order (the "chunks")

**Chunk 0 — Staging environment** *(prerequisite for everything).* A disposable SharePoint site + Logic App set so we can test the real cloud path with write-isolation (no audit to date has touched live cloud). Nothing below can be safely validated without this.

**Chunk 1 — Indexed columns** *(cheap, do early).* Add indexed columns on StockTransactions: `SyncTimestamp` (pull cursor) + `TransactionId` (dedup). MUST happen before the ledger crosses ~5,000 rows or pull-v2 starts failing outright.

**Chunk 2 — Ingest validation + quarantine on push-v2** *(big safety win, no schema change).* Reject bad `Qty` (negative/non-safe-int), non-finite money, unknown Store/Product, reserved keys (`__proto__` etc.), hostile id chars, bad Date, invalid Type (whitelist). Log rejects to a quarantine list (device id + timestamp) — never silently drop.

**Chunk 3 — Transfer-receive idempotency on push-v2. → FOLDED INTO CHUNK 4 (Kunal, 2026-06-30).** Bug = a duplicate `(TransferId, transfer_in, StoreId, ProductId)` from a 2nd OFFLINE device (online is already blocked by the local guard + 30s poll; needs two devices both offline → low prob, but silent+permanent). **Decision:** a same-quantity duplicate → silent idempotent dedupe; a DIFFERENT-quantity double-receive → **conflict → Director decides which to keep** (resolution screen like flag/stock-take resolution). That "Director chooses" flow needs cross-device record visibility + a resolution UI = Chunk-4 machinery, so the receive-idempotency key + conflict resolution are built **as part of Chunk 4**, not standalone. Technical basis kept in `AZURE-CHUNK3-SCOPE.md` (per-product key, receive-vs-resolution discriminator).

**Chunk 4 — Multi-table record sync** *(THE #1 blocker — the big one).* Make transfers/deliveries/stock-takes (and catalogue edits) sync across devices. Needs new SharePoint storage + push/pull endpoints + client envelopes for these record types. **Design decision required (see §3, D1).** Also pulls in: cross-device category metadata + price-at-time snapshots (banked from M2). **NOW ALSO INCLUDES (folded from Chunk 3):** transfer-receive idempotency (per-product key `transfer:{TransferId}:receive:{StoreId}:{ProductId}`; receive-vs-resolution discriminator) + the double-receive **conflict resolution** — same-qty dup = silent dedupe, different-qty = **Director decides which to keep** (resolution screen like flag/stock-take). See `AZURE-CHUNK3-SCOPE.md`.

**Chunk 5 — Authorization at the cloud boundary.** Logic Apps validate actor/role/store-scope server-side before accepting writes (e.g. only Director devices may push `adjustment_*`). **Design decision required (D2).**

**Chunk 6 — Master-data publish path + catalogue write endpoint.** Keep AppConfig `master_data` current from the Products/Stores lists (bump version), and add an upward catalogue-write Logic App so Directors can push new products/prices. **Design decision required (D3).**

**Chunk 7 — Hardening / cleanup.** SAS key rotation policy (+ rotate the now-live plaintext deploy token & old SAS in git history), self-host Dexie/Chart.js/Fonts, confirm emailUrl only via config.

**Chunk 9 — Per-user server-side auth (ADDED 2026-07-04, PRE-BETA BLOCKER).** App-managed users exactly as today (NO M365 accounts / licences — Kunal's hard constraint); passwords salted + verified server-side via the existing Function + Logic App + SharePoint plumbing (no new cost); server-side lockout. Upgrades Chunk 5's key-class enforcement (store/HO/Director keys) to real per-PERSON enforcement of Director-only actions.

**Chunk 10 — Row-level read scoping (ADDED 2026-07-04, PRE-BETA BLOCKER).** Server sends each store device only its own rows + transfers touching it; HO/Director devices get everything; HO reporting adapts. Needed because franchisees exist BEFORE launch — a franchisee device must never even RECEIVE other stores' data (today the UI hides it but the full ledger syncs to every device by design). GPT's minimum-viable model (Chunk-5 spec audit, point 5) is the starting sketch.

**ROLLOUT GATE (Kunal, 2026-07-04): no store device — including franchisee stores — receives the app until ALL chunks are done and audited.**

**Chunk 8 — Ledger archival / balance-snapshot (SCALE — tracked, not yet designed).** The StockTransactions ledger is append-only and grows forever (stock = sum of ALL movements). Two growth pressures: (a) SharePoint 5k view threshold — handled by indexing (Chunk 1) for a long way (tens of thousands of rows); (b) **device memory — the tighter ceiling**: every device downloads the WHOLE ledger into IndexedDB + sums it in memory to compute stock (old audit ref G1-19 OOM); low-end phones will struggle at tens of thousands of rows. **Current state (2026-06-23): live ledger ≈1,788 rows, created 2026-04-19, growing ~25–30 rows/day at alpha pace → ~5k in roughly 4 months, faster at beta scale.** **Proposed approach (DESIGN LATER, gets its own auditor review like D1):** periodic "opening balance" snapshots per product+store (e.g. year-end or rolling), then archive movements older than the snapshot to an archive list — bounds BOTH the cloud list and device memory without breaking stock totals (you can't just delete rows; snapshot first). Decisions needed: snapshot cadence/trigger, where archived rows live, how the client folds snapshot+recent-movements, migration of existing rows. NOT urgent (runway of months); device-memory angle will likely force it before SharePoint does. Tackle before the ledger gets large (well under 100k).

---

## 3. Decisions only you can make (these gate the build)

- **D1 — Multi-table sync model. ✅ RESOLVED (2026-06-22, after GPT + AGY architectural review + Kunal):** **one generic, APPEND-ONLY "record steps" list.** Each lifecycle step (transfer sent/received/flagged/resolved; delivery recorded; stock-take counted/approved) is appended as its own immutable entry; the client folds the steps to rebuild record state (same pattern as the stock ledger). **Hardening (GPT, mandatory):** index server-owned outer columns from day 1 — `RecordType, RecordId, Version/Seq, SyncTimestamp, Status, OwnerStoreId, FromStoreId, ToStoreId, Deleted`; deterministic idempotency keys for irreversible ops (e.g. `transfer:{id}:receive:{toStoreId}`) so the Logic App dedups duplicate receives automatically; client-side reconcile/quarantine of any server-rejected op (a 2nd offline receiver must NOT treat its local credit as final). Both auditors converged on a generic list (NOT per-type); AGY picked append-only, GPT called it "more correct." Detailed envelope/schema = designed at Chunk 4 build.
  - *(Rejected: Option B per-type lists = ~3× build, nested line-items still need JSON. Rejected: naive last-writer-wins blob = unsafe for mutable transfers.)*
- **D2 — Authorization model.** Per-store **shared secret** (simple, one secret per store device) vs per-device **registration id** (stronger, more management). *My lean: per-store shared secret for alpha→beta, registration later.*
- **D3 — Master-data publish trigger.** Auto-publish on SharePoint list change (a Logic App trigger) vs a manual "Publish catalogue" button. *My lean: manual publish first (predictable), automate later.*

## 4. Who does the Azure work? (the real unblocker)

I can write code, specs, Logic App definitions (JSON), SharePoint schema specs, and client sync envelopes — but I **cannot click in the Azure portal or change SharePoint lists from here.** So we need an execution path for the cloud changes. Options:
- (a) **az CLI** — if you authenticate the Azure CLI on this machine, I can script + run the infra changes directly.
- (b) **You drive the portal** — I write exact click-by-click steps + the Logic App JSON, you apply them.
- (c) **An Azure dev** (e.g. Akbar) applies my specs.

**This is the first thing to settle — without it, the cloud chunks can't actually land.**

## 5. Recommended sequence
Staging env (0) → indexed columns (1) → ingest validation (2) → receive idempotency (3) → multi-table sync (4, the big one) → authz (5) + master-data publish (6) → hardening (7). Each chunk: spec → your decisions → GPT+AGY review → build → contract test on staging → your OK.
