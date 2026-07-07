# AZURE CHUNK 8 — Ledger archival / balance snapshots (SCOPE)

**Date:** 2026-07-05 · **Status:** SCOPING — no build started. Chunks 4+5+6+7 on HOLD.
**Sources:** `AZURE-PHASE-SCOPE.md` Chunk 8, memory (SCALE tracking), current-code discovery (`Stock._buildCache`
sums the WHOLE ledger; `DB._loadFromDexie` loads all transactions).
**Process:** `AZURE-CHUNK-PROCESS.md`. This is a DESIGN-heavy chunk → gets its own GPT+AGY design review (like D1).

---

## 1. The problem
The ledger is **append-only**: `Stock.qty(product, store) = SUM(IN types) − SUM(OUT types)` over EVERY
movement ever made. `Stock._buildCache()` (index.html:1065) iterates ALL of `DB.get().transactions` in memory
on every load. Two growth ceilings:
- **SharePoint 5,000-item view threshold** — mitigated by the indexed columns (Chunk 1) for a long way (tens of
  thousands of rows).
- **Device memory — the TIGHTER ceiling.** Every device downloads the WHOLE ledger into IndexedDB and sums it
  in memory. Low-end store phones will struggle at tens of thousands of rows (old OOM ref G1-19).

**Current runway:** live ledger ≈1,788 rows (2026-06-23), growing ~25–30 rows/day at alpha pace → ~5k in ~4
months, faster at beta/multi-store scale. **NOT urgent** — months of headroom, and ZERO growth during the
locked build phase (rollout gate: nobody uses it until all chunks ship).

## 2. THE STRATEGIC DECISION FIRST (D8-0) — build now, or design-now-defer-build?
Chunk 8 is a **SCALE** concern, NOT a pre-beta blocker: a fresh beta starts with a small ledger, and the app
runs fine at a few thousand rows. Chunks 9 (per-user auth) + 10 (store read-scoping) ARE the real pre-beta
blockers. So:
- **Option A — build Chunk 8 now** (design + build + audit), ships with the single cutover. Pro: everything
  done + audited before launch, one deploy. Con: adds real complexity (bulk snapshot/archive migration,
  client fold rework, reports-over-archive) to the critical path for a ceiling that's months away.
- **Option B — design now, defer the build** (Claude's lean). Do the full design + the GPT+AGY design review
  now (so the approach is validated and ready), then PRIORITISE building 9 + 10 (the actual pre-beta
  blockers). Build Chunk 8 as a later additive enhancement when the ledger approaches the ceiling (likely
  post-launch — archival is additive and doesn't need to be in the first cutover). Pro: keeps the critical
  path focused on real blockers; the design is still locked in. Con: Chunk 8 becomes a separate future deploy
  (not the single cutover), and "all chunks done" for the rollout gate would mean 4–7,9,10 + the DESIGN of 8.
*Recommendation was B; **KUNAL CHOSE A (build now, 2026-07-05)** — design + build + audit Chunk 8 now so
everything ships in the single cutover. The rest of this doc is the DESIGN → full GPT+AGY design review → build.*

## 3. Design — the "snapshot + archive" model
The invariant: you can NEVER just delete old movements (stock = their sum). You must **snapshot the balance
first, then archive** the movements it represents.
1. **Opening-balance snapshot.** At a cutoff date, compute a balance per `(storeId, productId)` = the stock as
   of that cutoff (from the movements up to it). Store these as immutable snapshot rows (versioned, like
   master_data): `{cutoffDate, storeId, productId, balance, snapshotVersion}`.
2. **Archive the represented movements.** Movements dated on/before the cutoff move to a separate ARCHIVE list
   (`StockTransactions_Archive`) and drop out of the DEVICE's active working set. They are RETAINED (audit +
   historical reports), just not pulled to devices by default.
3. **Client fold.** `_buildCache` seeds from the snapshot balances for the latest cutoff, then applies only the
   post-cutoff movements. Same total, bounded working set (snapshot rows ≈ product×store count, tiny; live
   movements = only the recent window).

## 4. Design decisions (D8-1..6) — for the auditor review + Kunal
- **D8-1 Snapshot cadence/trigger.** Rolling (keep last ~N months of movements live, snapshot+archive older) vs
  annual (year-end) vs size-triggered (when the ledger crosses X rows) vs manual (Director button). *Lean:
  ROLLING (e.g. keep 12 months live) — predictable, bounded device footprint regardless of volume.*
- **D8-2 Archive storage.** A separate `StockTransactions_Archive` SharePoint list (live pull list stays small;
  archive kept for audit/reports, pulled only on demand) vs a flag on the same list. *Lean: separate list.*
- **D8-3 Snapshot distribution.** The snapshot balances must reach every device (like the versioned
  master_data): a `stock_snapshot` payload (versioned, per cutoff) the client merges + folds from. Devices with
  an older snapshot version re-pull. *Design at build.*
- **D8-4 Who computes + archives.** A server-side operation (scheduled Logic App / Function, or a Director-gated
  flow) does the bulk: compute balances, write snapshot rows, move movements to the archive list, then publish
  the new snapshot version. Client can't do the bulk cloud move. *Lean: Director-gated server flow
  (+ optionally scheduled). Reuses the Chunk-5 Director auth.*
- **D8-5 Migration (first snapshot).** Introduce the first snapshot from the CURRENT live ledger: compute
  balances at the cutoff, verify device stock totals are IDENTICAL before/after (snapshot+recent == full sum),
  THEN archive. A verification gate (totals must match) before any archive write. *Critical — must be provably
  stock-neutral.*
- **D8-6 Reports over archived data.** Historical reports (e.g. the 24-month store comparison) need archived
  movements. Option: reports that reach past the live window pull from the archive list on demand (Director/HO
  only, not a device default). *Lean: on-demand archive pull for long-range reports.*
- **D8-7 Interaction with tombstones + record-steps (Chunk 4).** Archiving must not break tombstone semantics
  or the record-steps fold (a transfer/delivery/stock-take whose ledger rows get archived). The record-steps
  are separate from the ledger; archival is ledger-only, but the fold's `expectedLedgerKeys` must still resolve
  (a resolved/old record's ledger rows may be archived). *Flag for the auditors.*

## 5. Build shape (IF/when built) — staging first
Snapshot-compute + archive-move server flow (Director-gated, verification gate D8-5) → `stock_snapshot`
versioned payload + client fold in `_buildCache` (seed from snapshot, apply post-cutoff) → archive list +
on-demand report pull → sentinels (fold == full-sum equivalence; snapshot-neutral migration; bounded working
set) + saboteurs + staging cloud probes (snapshot→archive→pull→fold round-trip, totals identical) → full sweep
→ wave review → GPT+AGY code audit.

## 7. Design review round 1 (2026-07-06) — GPT + AGY CONVERGED on the model; required changes ADOPTED
Both AGREE the snapshot+archive model, separate archive list (D8-2), and Director-gated server flow (D8-4).
Required changes (both raised the crux; GPT COUNTERed D8-5 as "too thin"):
1. **CUTOFF = MONOTONIC SYNC ID CURSOR, NOT BUSINESS DATE (both — the crux data-loss fix). ADOPTED.**
   Snapshot balance = stock as of `ID <= cutoffId`; archive = rows with `ID <= cutoffId`; the client folds by
   ID (post-cutoff = `ID > cutoffId`). A late/offline backdated movement gets a NEW higher SharePoint ID → it
   naturally folds as post-cutoff and is counted, instead of being silently lost. (Business `Date` is retained
   on the row for reporting, but the archival boundary is the ID.)
2. **Late pre-cutoff-DATE handling for REPORTING (GPT P0). ADOPTED.** A movement whose business Date ≤ cutoff
   arriving after cutover: stock is already correct (it folds post-cutoff by ID), but for period reporting the
   server must handle it — duplicate vs live/archive → idempotent dup; otherwise reject/quarantine
   `ARCHIVE_WINDOW_CLOSED`, or convert to a Director-approved CURRENT-dated correction carrying the original
   date as metadata. (No silent split of an archived period.)
3. **NO VISIBLE PARTIAL STATE during an archive run (both P0). ADOPTED.** A device must NEVER see "old snapshot
   + shrunk live ledger." A run-lock / maintenance state / version-flip so clients use EITHER the old full
   ledger OR the new snapshot model — never a half state. Publish the snapshot version LAST.
4. **ARCHIVED-KEY RESOLVER for the Chunk-4 record-steps fold (both P1). ADOPTED.** expectedLedgerKeys pointing
   at archived rows must fold as CONFIRMED, not stock_pending — a completed old transfer must not regress. With
   the ID cutoff this is clean: a key whose ledger ID ≤ cutoffId = archived+snapshotted = confirmed (server
   provides a compact archived-confirmation/index path).
5. **DEDUP + TOMBSTONES SPAN LIVE + ARCHIVE (both P1). ADOPTED.** TransactionId + IdempotencyKey uniqueness must
   query BOTH lists. A tombstone/delete targeting an ARCHIVED row can't just write a live tombstone → reject
   for Director correction, or apply as a snapshot/archive correction.
6. **REPORTS FAIL-CLOSED on archive-required (both P1). ADOPTED.** Any transaction-derived report whose range
   crosses the cutoff (sales/gross, wastage, store-comparison, sell-through, franchise invoice, movement
   history, historical stock/value) must load archive rows OR refuse with a clear "archive required" state —
   never a silent under-count. Current-stock views use snapshot+recent. Archive pulls Director/HO-scoped now,
   Chunk-10 row-scoped later.
7. **BEEFED MIGRATION GATE (GPT COUNTER on D8-5). ADOPTED.** Not just balance-neutrality: (a) FREEZE/gate
   ingestion during the run; (b) per-(store,product) full-sum == snapshot + post-cutoff live for ALL pairs
   (incl. products with NO movement in the window — their balance still carries); (c) source row count + hash
   AND archive-copy count + hash must match; (d) idempotent archive copy; (e) on ANY mismatch → publish
   nothing, archive nothing, live ledger untouched; (f) device with unsynced local movements does NOT
   activate/prune against the snapshot until its pending pushes drain or are rejected.
8. **Order of operations (GPT, precise):** acquire run-lock → freeze cutoff writes → compute candidate → verify
   neutrality + hashes → write snapshot rows → copy archive rows → verify archive copy → remove/archive live
   rows → publish snapshot version LAST (clients in maintenance until publish completes).
9. **Snapshot payload metadata:** `{version, cutoffId, cutoffDate, runId, integrityHashes, balances[]}`. Archive
   rows preserve all original fields + source ID + TransactionId + IdempotencyKey + SyncTimestamp + ArchiveRunId
   + hashes.

**D8-1 cadence — DECIDED (Kunal 2026-07-06): HYBRID — archive when the LIVE ledger reaches ~5,000 rows OR 6
months elapse since the last run, WHICHEVER COMES FIRST.** Rationale (better than either auditor's split pick):
the 5,000 trigger is the SharePoint 5k-view-threshold itself → a real safety valve that self-paces to volume
(quiet → rarely fires; busy multi-store beta → fires as needed), guaranteeing the live pull list stays
threshold-safe; the 6-month cap gives a predictable rhythm aligned with Kunal's end-of-financial-year reporting.
Retention window (how much recent history stays live after a run) = engineering detail: keep a SHORT recent
window (lean ~last 4–8 weeks) live for movement-history UX continuity, archive older; the snapshot carries the
full balance so stock is correct regardless. (AGY leaned annual, GPT rolling-12mo-lag; the size-triggered hybrid
supersedes both and is MORE threshold-protective — note for the auditors at the code audit, not a re-review.)
**Kunal's reports requirement (confirmed satisfied by D8-6): reports + charts remain available over archived
data (on-demand archive pull, fail-closed), incl. the end-of-financial-year report spanning the archive boundary.**

## 6. Decisions summary
| # | Question | Lean |
|---|---|---|
| D8-0 | Build now vs design-now-defer-build | **A — BUILD NOW (Kunal 2026-07-05); ships in the single cutover** |
| D8-1 | Snapshot cadence | **HYBRID: ~5,000 live rows OR 6 months, whichever first (Kunal)** |
| D8-2 | Archive storage | separate StockTransactions_Archive list |
| D8-3 | Snapshot distribution | versioned stock_snapshot payload (like master_data) |
| D8-4 | Who computes/archives | Director-gated server flow (+ optional schedule) |
| D8-5 | Migration | stock-neutral verification gate before any archive write |
| D8-6 | Reports over archive | on-demand archive pull for long-range reports |
| D8-7 | Chunk-4 interaction | archival is ledger-only; expectedLedgerKeys must still resolve (audit) |
