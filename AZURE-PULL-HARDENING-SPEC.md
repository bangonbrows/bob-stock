# Azure — Pull hardening: ID-cursor pagination (build spec)

**Status:** DESIGN APPROVED by both auditors 2026-06-23 — Codex = APPROVE-WITH-CONDITIONS, AGY = APPROVE. Build on staging next (awaiting Kunal go-ahead). Evidence: `AZURE-CONTRACT-PROBES.md` → "RESOLUTION (2026-06-23)".

## Problem (precise)
SharePoint throttles any query whose **matched set exceeds ~5,000 items** — independent of indexing, and `RowLimit Paged` does NOT rescue a Where/OrderBy on a non-primary column. So the current pull (`$filter SyncTimestamp gt {since}` + `$orderby` + `$skip` offset) fails (502) when the delta is >5k: i.e. a **new device (`since=0`) or long-offline device** can't catch up once live `StockTransactions` passes 5k (~4 months out). Incremental steady-state (small delta) is fine today.

## Fix
Page the ledger by **list item ID** (primary key, always indexed, monotonic with insert). Proven to walk 6,000 rows cleanly in 6 pages (200 every page).

Pull query (per page):
```
RenderListDataAsStream / or REST /items  (see Q3 below)
Where:   ID > {lastId}  AND  ID <= {maxIdAtStart}
OrderBy: ID asc
RowLimit Paged = 1000   (or chosen page size)
```
Client cursor = highest ID merged so far (`bob_last_sp_id`). Loop pages until short/empty. Dedup by `TransactionId` (re-pull idempotent).

## MANDATORY CONDITIONS (from the audit — build these in, don't skip)

### C1 — Freeze a high-ID watermark per pull cycle (Codex Q1)
At cycle start capture `maxIdAtStart` (max ID currently in the list). Pull `ID > lastPulledId AND ID <= maxIdAtStart`. Without the upper bound, concurrent inserts keep extending the walk forever. Advance the durable cursor only after ALL pages of the cycle merge successfully.

### C2 — Phantom-read lookback margin (AGY #1)
SharePoint allocates IDs sequentially but **commits asynchronously**: a fast `ID=101` can become visible before a slow `ID=100`. A cursor that jumps to 101 would skip 100 permanently. Mitigation: start each pull from `ID > (lastPulledId - MARGIN)` (e.g. MARGIN=100) and rely on Dexie `put()` (keyed by TransactionId) to drop the re-seen rows. The margin re-pull is cheap and safe. Tune MARGIN with the concurrency probe (C-probe below).

### C3 — Cursor advances ONLY on full success (Codex Q4)
A failed durable merge / failed tombstone application must NOT advance `bob_last_sp_id`. Next cycle re-pulls the un-merged tail. (Same invariant as today's watermark-only-after-final-page rule.)

### C4 — Raw field values, never display-formatted (Codex Q3 + AGY #2)
`sync.js._fromSharePoint` (sync.js:600) expects machine-parseable qty/timestamp/id/type; comma-grouped numbers or locale dates ("1/1/2026 12:00 AM") would corrupt ingest.
- **Primary (Codex):** use SharePoint REST `/items?$filter=ID gt {lastId} and ID le {max}&$orderby=ID asc&$top=N&$select=<internal names>` — returns RAW values and (to confirm) the same ID-cursor threshold-safe behaviour.
- **Fallback (AGY):** if REST `/items` doesn't page cleanly at scale, use `RenderListDataAsStream` with **`RenderOptions: 257`** (`ListData`=1 + `RawFieldValue`=256) to get raw values.
- Avoid per-row follow-up fetches.
- **Probe both** for threshold-safety before choosing.

### C5 — Tombstone / edit safety (Codex Q2 — verify in code BEFORE porting)
ID-cursor never revisits low-ID rows, so correctness REQUIRES that edits/deletes are appended as NEW rows (new ID), never in-place mutations. Verify:
- no cloud path UPDATEs/DELETEs existing `StockTransactions` items in place (push-v2 is POST-create after a dup check — confirmed: `azure-pushv2-def.json:53`);
- no client path mutates a synced txn under the same `TransactionId` expecting it to sync;
- tombstones dedup by **their own** `TransactionId`, not by `TargetTransactionId`;
- remote tombstones still applied after same-batch creates are merged (current pull does — `sync.js:1051`).
(Codex confirmed current code already creates tombstones as new rows: `db.js:551`, durable tombstone in same local txn `db.js:794`, push serializes tombstone metadata into new rows `sync.js:582`.)

### C6 — Cursor migration (Codex Q4)
Migrate the client from the timestamp cursor (`bob_last_sync`) to an ID cursor (`bob_last_sp_id`). One-time: existing devices replay from `ID=0` (safe + cheap to do NOW while live is <5k), dedup by TransactionId. Keep the `since`/SyncTimestamp path only if needed for backward compat during rollout.

### C7 — Operational policy (AGY #3)
**No manual edits/deletes directly on the SharePoint `StockTransactions` list** — an ID-cursor will miss them. Document + align the team. (Belongs in the runbook / SERVER-SIDE-REQUIREMENTS.)

## Pre-port validation probes (staging) — run + record before porting to live
Base set: seed **20k+** rows; page sizes **100 / 1000 / small**; **concurrent inserts** mid-walk; **mid-pull fail/retry**.
Audit additions:
- **C1** high-ID watermark freeze holds under concurrent inserts (walk terminates at `maxIdAtStart`, doesn't chase new rows);
- **C2** phantom-read: force out-of-order commits, confirm no row permanently skipped with the lookback margin;
- **C4** raw field type check against `_fromSharePoint` (qty/timestamp/id/type parse correctly);
- **C5** tombstone-after-target + same-batch create+delete both converge;
- **C3** failed durable merge / tombstone application does NOT advance the ID cursor;
- **ID gaps** from deleted list items must not break paging (Gt/RowLimit handles holes — confirm).

## Sequencing
Do this **before Chunk 2** (push ingest validation) — both auditors agree it's the onboarding/backfill blocker. Build on staging → run probes above → audit the implementation → port to live `pull-v2` + `sync.js`.

## Live posture
Live = 1,788 rows (<5k) → every query works today regardless of index; throttle impossible until live crosses 5k. ID-cursor is index-independent, so it also removes reliance on live's (unverifiable-while-<5k) SyncTimestamp index.
