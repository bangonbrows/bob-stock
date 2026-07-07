# Azure Chunk 4 — Multi-table record sync (the big one) — SCOPE

**Date:** 2026-06-30 · **Status:** SCOPING for spec review. Nothing built. Build on staging only; live untouched; held for the end-of-phase 6-way blind audit + single live cutover.

**Folds in (Kunal, 2026-06-30):** the whole of the former Chunk 3 — transfer-receive idempotency + double-receive **conflict resolution** (see `AZURE-CHUNK3-SCOPE.md`). Conflict model is LOCKED: same-quantity double-receive → silent idempotent dedupe; different-quantity double-receive → **Director decides which count to keep**.

---

## 0. Plain-English problem (for Kunal)

Today, when a store sends a **transfer**, records a **delivery**, or does a **stock-take**, only the *stock numbers* travel to the cloud (as rows in the stock ledger). The **record itself** — the transfer with its line items / status / flag notes, the delivery with its costs, the stock-take with its counts and approval state — never leaves the device that created it. So another device sees the stock change but **cannot see or action the transfer/delivery/stock-take**. That is the #1 blocker for multi-store use.

Chunk 4 makes those three record types sync across devices. We do it the same proven way we already do stock: **every step of a record's life becomes its own permanent little entry** ("sent", "received", "flagged", "resolved", "counted", "approved" …) in a new cloud list, and each device replays those entries to rebuild the full record. We never edit an entry once written (append-only), so there's no "who-overwrote-whom" race.

Bolted on: stop a transfer being **received twice** by two offline devices (which would silently double the stock), and when those two receives **disagree on the count**, surface it to a Director to decide — reusing the same kind of "Director resolves" screen we already have for flagged transfers and stock-take discrepancies.

---

## 1. Current state (ground truth, from code recon 2026-06-30)

### 1.1 The three record types are mutate-in-place local objects
| Record | Dexie table (db.js) | Id format | Status field + values | Carries money? |
|---|---|---|---|---|
| **Transfer** | `transfers` `'id, date, _syncTs'` (db.js:37) | `tr_{Date.now()}{crypto suffix}` (phase2.js:70) | `status`: `draft → in_transit → received → completed` / `cancelled`; per-item `item.status`: `pending/confirmed/accepted/flagged/resolved` | no |
| **Delivery** | `deliveries` `'id, storeId, date, _syncTs'` (db.js:40) | `del_{Date.now()}` (index.html:4677) — **no crypto suffix** | none (immutable except a packaging edit) | **yes** (unitCost, headerCosts{freight,tax,shipping}, currency{code,rate,…}, landedCostPerUnit) |
| **Stock-take** | `stockTakes` `'id, storeId, date, _syncTs'` (db.js:39) | `st_{Date.now()}` (index.html:2116/2145) — **no crypto suffix** | `status`: `clean / pending / approved / rejected` | no |

> ⚠ **Cross-device id-collision risk (new requirement):** `del_`/`st_` ids are plain `Date.now()`. The moment these records sync, two devices can mint the same `RecordId`. **Every synced RecordId must be globally unique** (crypto suffix, like `tr_`). Fixing the id format is part of Chunk 4 (a one-time concern for new records; existing local records keep their ids — see migration D4-I).

### 1.2 Stock movements already sync; records don't
Only **StockTransactions** is pushed/pulled (sync.js:709 push filter; sync.js:1021 pull). Each record's stock effects are already ledger rows tagged with `TransferId` (transfer_in/out), `in` (delivery), `adjustment_in/out` (stock-take approval). `transfers`/`deliveries`/`stockTakes`/`costHistory` are **never** pushed (confirmed in sync.js). `_toSharePoint` field map = TransactionId/Date/StoreId/ProductId/Type/Qty/StaffName/Reason/DeviceId/Timestamp/TransferId (+ tombstone fields) (sync.js:560-595).

### 1.3 Every place a `transfer_in` ledger row is minted (the receive surface)
| Operation | phase2.js | Ledger Type |
|---|---|---|
| Initial receive (full) | :257 | transfer_in |
| Receive (partial → flagged; credits physical qty, F2-HIGH02) | :270 | transfer_in |
| Resolve accept-as-is (top-up / shortfall return) | :327 / :329 | transfer_in |
| Resolve adjust (delta-up / remainder return) | :333 / :336 | transfer_in (+ :334 adjustment_out for delta-down) |
| Resolve reject (reverse receive / full return) | :338 adjustment_out / :339 transfer_in | mixed |
| Cancel in_transit (reverse the transfer_out) | :422 | transfer_in |

Existing client double-receive guard (phase2.js:223-227): refuses a receive if **any** local `transfer_in` exists for that `transferId`. **Only sees its own device** → two offline devices both pass the guard → both mint `transfer_in` rows with different `TransactionId`s → server dedups by TransactionId only → **both insert → stock = 2n permanently.** (Gemini blind-audit CRIT-03, runtime-proven.)

### 1.4 Director-resolution UIs that already exist (patterns to mirror)
- **Stock-take discrepancy:** `_reviewStockTake`/`_approveStockTake`/`_rejectStockTake` (index.html:2177-2224) — review modal → Approve&Adjust (emits adjustment_in/out, idempotency-guarded on `stockTakeId`, single atomic durable write) or Reject (no ledger change).
- **Transfer flag:** `renderResolveFlags`/`setFlagAction`/`completeFlags`/`resolveAllFlags` (phase2.js:348/1242-1321) — per-item Accept-as-is / Adjust / Reject, batch atomic write with snapshot/restore.
These are the templates for the new **double-receive conflict** resolution screen.

### 1.5 The cloud lists that already exist
`StockTransactions` (live, indexed), `AppConfig` (catalogue: products/stores/etc. as ConfigType items). **`Transfers` and `StockTakes` lists exist but are EMPTY and were never wired** (a mutable-blob shape, unused). No `Deliveries` list at all. Stray `TargetTransactionId0` dup column on StockTransactions (cleanup later). Chunk-2 added `StockTransactions_Validate` + `StockTransactions_Quarantine` on staging.

---

## 2. Design — the append-only "record-steps" model (D1 locked)

### 2.1 Core principle: records and stock are TWO streams, never double-counted
- **StockTransactions ledger = source of truth for stock quantities** (unchanged; keeps syncing exactly as today, now via the Chunk-1.5 ID-cursor pull + Chunk-2 validated push).
- **New `RecordSteps` list = source of truth for record lifecycle + metadata** (who/when/status/line items/costs/reasons/flag notes/approval state). **A record step NEVER credits stock** — the stock effect rides the ledger as it does today. The two are linked by `RecordId`/`TransferId`.

This separation is the whole safety story: it means Chunk 4 reuses the proven ledger sync + Chunk-2 validation for stock, and adds a *parallel* metadata stream that can't corrupt stock counts.

### 2.2 The RecordSteps row (envelope) — one SharePoint list item per lifecycle step
Server-owned **outer columns, indexed AT CREATION** (per the index manifest; SharePoint can't index a list >5k):

| Column | Type | Purpose |
|---|---|---|
| `StepId` | text, **indexed + Enforce-Unique** | deterministic idempotency key (dedup) |
| `RecordType` | text, indexed | `transfer` / `delivery` / `stocktake` |
| `RecordId` | text, indexed | parent record id (globally-unique) |
| `StepType` | text | see taxonomy 2.3 |
| `Seq` | number | per-record monotonic order hint (fold tie-break) |
| `OwnerStoreId` | text, indexed | owning store (authz/scope hook for Chunk 5) |
| `FromStoreId` | text, indexed | transfer origin (blank otherwise) |
| `ToStoreId` | text, indexed | transfer destination (blank otherwise) |
| `Status` | text | record status this step sets (denormalized convenience) |
| `Payload` | note (JSON) | the step's data (line items, qtys, costs, reasons, actor snapshot) |
| `ActorId` / `ActorName` | text | `Auth.actor()` snapshot (hash-free, per Wave-16) |
| `DeviceId` | text | originating device |
| `Timestamp` | number | business event time (epoch ms) |
| `SyncTimestamp` | number, indexed | **server-set** pull cursor (never trust client) |
| `Deleted` | boolean | tombstone (record voided) |

Index budget = `StepId, RecordType, RecordId, OwnerStoreId, FromStoreId, ToStoreId, SyncTimestamp` = 7/20 (headroom kept). Pull paging uses the **ID-cursor** (primary key) proven in Chunk 1.5 — does NOT depend on these indexes crossing 5k; the indexes serve selective fetch + Chunk-5 store-scope.

### 2.3 Step taxonomy (one row per lifecycle transition)
- **transfer:** `create` (draft), `submit` (→in_transit), `receive` (→received/completed), `flag` (per-item, may piggyback on receive payload), `resolve` (→completed), `cancel`.
- **delivery:** `record` (the whole delivery + costs), `packaging_edit` (the post-hoc packaging/landed-cost change).
- **stocktake:** `count` (→clean or pending), `approve` (→approved), `reject` (→rejected).

Each step's `Payload` carries the full delta for that transition (e.g. a `receive` step carries per-line `receivedQty`; a `record` step carries the delivery lines + costs; an `approve` step carries the per-line reasons). The client **folds** all steps for a `RecordId` into the local Dexie record object it already uses (§2.4), so existing UI/read paths are unchanged.

### 2.4 Client refactor: emit-step + fold-on-pull (event sourcing)
- **On every lifecycle mutation** (the operations in §1.1/§1.3), in addition to today's local write, the client **emits a RecordStep to a new local outbox** (a new Dexie table, e.g. `recordSteps`, with `_synced` flags mirroring the ledger's pattern) → pushed by a new sync path.
- **On pull**, incoming steps are **folded** into the local `transfers`/`deliveries`/`stockTakes` tables (pure reduce over a record's steps, ordered by `Seq` then `Timestamp`, deterministic tie-break by `StepId`) → the local record object is reconstructed. Re-pull is idempotent (fold is a pure function of the step set; dedup by `StepId`).
- The fold is **order-independent** by construction (it sorts before reducing), so the ID-cursor + lookback (which can deliver out of order) is safe.

### 2.5 Receive idempotency (folded from Chunk 3) — TWO keys doing TWO jobs
**(a) Ledger key — keeps stock from doubling (the actual stock-safety fix).** On the StockTransactions push (the Chunk-2 validate workflow), compute a deterministic `IdempotencyKey` per receive row = **`transfer:{TransferId}:receive:{StoreId}:{ProductId}`** (per-product — a 3-product transfer makes 3 distinct keys; Chunk-3 Q1). Add an `IdempotencyKey` column with **Enforce-Unique** to StockTransactions(_Validate). A 2nd receive's `transfer_in` rows collide → unique-violation → the existing Chunk-2 **409→`duplicates`** path acks them WITHOUT inserting → **stock never doubles, regardless of whether the two receives agreed.** Non-receive rows fall back to `TransactionId` (already unique). Resolution-adjustment rows (top-up/adjust/return) are **distinct operations** keyed by `TransactionId`, NOT the receive key (Chunk-3 Q2, lean (b)) — so they never falsely collide with the receive or each other.

**(b) Step key — makes a quantity DISAGREEMENT visible (the conflict fix).** The `receive` RecordStep's `StepId` must let **both** offline devices' receive steps survive (so the fold can compare counts) → key includes a receive-instance discriminator (e.g. `{RecordId}:receive:{ToStoreId}:{DeviceId}`). Most other steps are deterministic (`{RecordId}:{StepType}` — only one create/submit/cancel/approve per record). See open decision **D4-E** (the trickiest one).

### 2.6 Double-receive conflict resolution (Kunal's locked model)
The fold, when reconstructing a transfer, sees the receive steps:
- **0 or 1 receive step** → normal.
- **2+ receive steps, all SAME per-line counts** → **silent idempotent dedupe** (benign duplicate; the ledger already deduped the stock; no Director, no UI noise).
- **2+ receive steps with DIFFERENT per-line counts** → transfer enters a **`conflict`** status → a **Director resolution screen** (mirroring `renderResolveFlags`) shows the disagreeing counts side by side → Director picks the correct count → emits a `resolve` step + the **adjustment_in/out ledger rows** needed to reconcile stock from the ledger's current (first-sync-wins) value to the chosen value. Idempotency-guarded like `_approveStockTake`.

Because stock is already pinned to the first-sync receive (via the ledger key), the Director's choice only ever emits the *delta* to correct it — never re-credits from zero. Conflict is **transfer-receive-specific**; deliveries (Director-only, single-device, immutable) and stock-takes (per-store, Director-approved) don't need conflict machinery, just sync.

### 2.7 Server validation of steps (Chunk-2 parity + money)
The RecordSteps push gets the **same honest-contract treatment as Chunk 2** (accepted/duplicates/rejected/failed buckets, terminal invariant, quarantine sink, per-row, fail-closed). Outer-envelope validation: safe `RecordId`/`StepId` charset + not-reserved (the no-regex `uriComponent` technique), known `RecordType`/`StepType`, bounded `Payload` size, sane `Seq`/`Timestamp`, ignore client `SyncTimestamp`. **NEW: money validation** — delivery `Payload` carries the first money to reach the cloud (unitCost, headerCosts, landedCost, currency.rate), so the server validates money fields finite/≥0/≤cap/2dp (mirror client `UI.money`) — this is the money-validation explicitly deferred from Chunk 2. Deep semantic validation of the Payload stays client-side (as today); the server enforces shape, ids, reserved keys, money, and size. Depth of Payload validation = open decision **D4-G**.

### 2.8 Infra (new, on staging first)
- New SharePoint list **`RecordSteps`** (indexes provisioned while empty, via SP REST MERGE per Chunk-1.5; Enforce-Unique on `StepId`). Staging clone `RecordSteps_Staging` first.
- New Logic Apps: **`recordsteps-push`** (clone the Chunk-2 validate workflow shape: validate → per-row result → buckets → Enforce-Unique insert → 409→duplicate → quarantine → honest response) and **`recordsteps-pull`** (clone the Chunk-1.5 ID-cursor dual-contract pull).
- Add the `IdempotencyKey` column + Enforce-Unique to `StockTransactions_Validate` (the Chunk-3 ledger key) + preflight existing-data check.
- The empty `Transfers`/`StockTakes` scaffolds + the V1 dead apps get deleted at phase cleanup; not reused.

---

## 3. Harness / self-prove plan (no build yet — this is the intended coverage)
New sentinels (each driving the LIVE code, mutation-proven, CRLF-safe — no blind sentinels):
- **Emit:** each lifecycle mutation emits exactly one correct step (transfer create/submit/receive/flag/resolve/cancel; delivery record/packaging; stocktake count/approve/reject).
- **Fold:** a pulled step set rebuilds the correct record object; fold is order-independent; re-pull doesn't duplicate; dedup by StepId.
- **Ledger idempotency:** a 2nd same-`(TransferId,StoreId,ProductId)` receive → server 409→duplicate, stock NOT doubled; multi-product receive NOT falsely deduped; resolution rows unaffected.
- **Conflict:** same-qty double-receive → silent dedupe (no conflict status); different-qty → conflict status + Director resolve emits the correct delta only; idempotency-guarded.
- **Server contract:** record-steps reject classes (bad id / reserved key / unknown RecordType / oversized Payload / bad money) → honest buckets + quarantine + invariant (real-cloud E2E, per the Chunk-2 lesson: mock shape == deployed response).
- **Id uniqueness:** new delivery/stocktake ids carry a crypto suffix.
Plus the cloud probes auditors run themselves (round-trip on RecordSteps_Staging, ID-cursor walk, dedup, conflict, money-reject).

---

## 4. OPEN DECISIONS (for GPT + AGY spec review, then Kunal — my recs in italics)

- **D4-A — Two-stream separation.** Record-steps carry lifecycle/metadata only; stock stays in StockTransactions; steps never credit stock. *Rec: YES — the core safety invariant; avoids double-counting + reuses proven ledger sync.*
- **D4-B — Step taxonomy (§2.3).** Confirm the step set + that each step's Payload carries that transition's full delta. *Rec: as listed; `flag` rides the `receive` payload (flags are decided at receive), not a separate step.*
- **D4-C — Fold target.** Fold pulled steps into the existing Dexie record tables (UI/read paths unchanged), steps are the wire format. *Rec: YES — minimises client churn; the local record object stays the cache.*
- **D4-D — Endpoints.** New `recordsteps-push` + `recordsteps-pull` Logic Apps + new `RecordSteps` list; StockTransactions sync untouched. *Rec: YES — clone the two proven workflows; don't overload the ledger path.*
- **D4-E — Idempotency key strategy (the hard one, §2.5).** Ledger receive key = `transfer:{TransferId}:receive:{StoreId}:{ProductId}` (deterministic, dedups stock). Receive *step* key includes a device/instance discriminator so BOTH receives survive for conflict detection; all other steps deterministic `{RecordId}:{StepType}`. *Rec: as stated. Risk to probe: a single device legitimately re-receiving (e.g. retry after a crash) must not create a phantom 2nd receive step — key the step on a stable receive-attempt id, not a fresh random each tap.*
- **D4-F — Conflict UX (§2.6).** Different-qty double-receive → `conflict` status → Director screen mirroring flag-resolution → emits delta adjustment only. Same-qty → silent. *Rec: as stated; matches the existing two resolution flows.*
- **D4-G — Depth of server Payload validation.** Server validates outer envelope + money + reserved-keys + size; deep semantic checks (e.g. line-item math) stay client-side. *Rec: YES — server is a shape/safety backstop, not a full domain re-implementation (no regex in WDL anyway); over-validating the Payload risks rejecting legitimate evolving shapes.*
- **D4-H — Authz boundary.** Chunk 4 = data-shape + idempotency + sync only. WHO may emit which step (role/store enforcement server-side) = Chunk 5. *Rec: YES — same as Chunk 2 Q6.*
- **D4-I — Migration / backfill of existing local records.** Devices hold historical transfers/deliveries/stockTakes that never synced. On first post-deploy run: (a) one-time backfill — emit a step set (or a single snapshot step) per existing local record so it propagates; (b) sync forward only (history stays an island). *Rec: (a) backfill — emit one `import`/snapshot step per existing local record (carrying its folded current state) so other devices gain visibility; keep existing local ids (don't rewrite keys — that orphans ledger TransferId links). Needs a sentinel + careful idempotency so backfill runs once.* **Kunal's call (business: how much does cross-device history matter at launch?).**
- **D4-J — Existing empty SP lists.** Create fresh `RecordSteps`; delete the empty `Transfers`/`StockTakes` scaffolds + dead V1 apps + stray `TargetTransactionId0` at phase cleanup. *Rec: YES.*
- **D4-K — Delivery money + currency to the cloud.** Server money validation (finite/≥0/≤cap/2dp) on the delivery Payload; currency{code,rate,foreign…} synced as-is in the Payload. *Rec: YES — this is the deferred Chunk-2 money validation; validate AUD-resolved fields, carry foreign values as audit metadata only.*
- **D4-L — Step order / Seq source.** Fold sorts by `Seq` then `Timestamp`, tie-break `StepId`. `Seq` = client monotonic per record. *Rec: YES — Seq makes intent explicit even when two steps share a ms; fold stays a pure reduce.*
- **D4-M — Record-id uniqueness.** New delivery/stocktake ids get a crypto suffix (transfer already has one). *Rec: YES — required for cross-device uniqueness; existing local ids unchanged (migration D4-I).*

---

## 5. Auditor flow (per the firm per-chunk process)
Scope (this doc) → **GPT + AGY spec review** (read-only, no code; weigh in on D4-A…M + the model) → Kunal's calls → build on staging (RecordSteps_Staging + recordsteps-push/pull + ledger IdempotencyKey + client emit/fold refactor + conflict UI) → **self-prove** (smoke all-green + saboteurs all-caught/0-blind + cloud probes) → **focused code audit** (GPT + AGY run the harness + drive the real staging cloud with the read credential; scoped SABOTEUR_ONLY to the new sentinels) → fix→re-run until both clean → **HOLD** for the end-of-phase 6-way + single cutover. Live untouched throughout.

---

## SPEC REVIEW RESOLVED (2026-06-30) — GPT-Codex + AGY both APPROVE-WITH-CHANGES, strongly converged. This section is the build-ready spec.

Both endorsed the two-stream append-only model as correct **and safer than putting lifecycle into the stock ledger**. AGY artifact: `azure_chunk4_design_review.md` (Kunal side). All auditor changes folded below; the single highest-risk gap both flagged (two-stream reconciliation) now has its own state machine (§R1).

### Kunal's calls
- **D4-B = flag RIDES the receive (bundled).** The flag is decided *during* the receive operation, so bundling makes receive+flags atomic on the wire (no partial-fold race where a device sees a receive as "clean" before a separate flag step arrives). Full audit detail (which lines flagged + notes) is recorded inside the receive payload. (GPT wanted a separate flag step for audit cleanliness; overruled for wire-atomicity — the audit is preserved in the payload.)
- **D4-I = backfill is AUTOMATIC + one-time, on first run of the new code** (never a manual button — "no one will remember"). **There is no real production data yet**, so at launch the backfill is effectively a no-op (= "start fresh"); the machinery exists as a **durability safety net** so no local record is ever stranded. **Ongoing durability = normal forward sync** (a record reaches the cloud within a sync cycle of creation → a dead device loses nothing created after launch). **Director cross-device visibility = the core forward sync, delivered regardless.**

### Per-decision (auditor changes folded in)
- **D4-A** APPROVE (both). Two streams; steps never credit stock.
- **D4-B** APPROVE — flag bundled into receive (Kunal + AGY).
- **D4-C** APPROVE (both). Fold into the existing Dexie tables.
- **D4-D** APPROVE (both). New recordsteps-push/pull + RecordSteps list; ledger path untouched.
- **D4-E** APPROVE-WITH-CHANGES (both): the receive STEP key uses a **stable persisted `receiveAttemptId`** — minted ONCE when a device commits a receive, stored on the local transfer, survives retries → key `{RecordId}:receive:{ToStoreId}:{receiveAttemptId}`. A crash-retry replays the same attemptId (dedupe); a genuinely different device/attempt gets a distinct one (both survive → conflict visible). **NOT a fresh random, NOT DeviceId-only.** The receive payload **carries the expected ledger TransactionIds/IdempotencyKeys** it generated (for §R1 reconciliation). Ledger receive key stays deterministic per-product `transfer:{TransferId}:receive:{StoreId}:{ProductId}`; resolution-adjustment rows keyed by `TransactionId` (un-collided — confirmed by both).
- **D4-F** APPROVE-WITH-CHANGES (both): the conflict carries a **generation**; the `resolve` step **names the `receiveAttemptId`s / conflict-generation it resolves**. A late 3rd receive arriving after a resolve **reopens/extends** the conflict (never silently covered). Same-qty → silent dedupe; different-qty → Director screen (mirrors flag/stock-take resolution) → **delta-only** adjustment.
- **D4-G** APPROVE-WITH-CHANGES (GPT): server validates outer envelope + safe ids + known RecordType + **RecordType×StepType compatibility** + **outer store columns (Owner/From/To) must match the payload's store ids** + bounded Payload size + Seq/Timestamp sanity + money + reserved keys. Deep semantic checks (line-item math) stay client-side. No regex in WDL → reuse the Chunk-2 `uriComponent` no-regex safe-id technique.
- **D4-H** APPROVE (both): authz = Chunk 5. The envelope already carries OwnerStoreId/FromStoreId/ToStoreId/ActorId/DeviceId = enough for Chunk-5 enforcement later (GPT's condition met).
- **D4-I** APPROVE-WITH-CHANGES (both) + Kunal: **automatic** one-time backfill; deterministic snapshot StepId `{RecordId}:backfill` + a content **hash** + source DeviceId; a duplicate backfill from another device → **409 collide** (converge); a **hash MISMATCH** (two devices hold genuinely-different records under the same id) → **backfill conflict/quarantine, NOT silent first-writer-wins** (GPT). Runs once, guarded by a local migration flag.
- **D4-J** APPROVE-WITH-CHANGES: delete the empty Transfers/StockTakes scaffolds + dead V1 apps + stray `TargetTransactionId0` **only at phase cleanup**, after cutover verification + zero live references (GPT).
- **D4-K** APPROVE-WITH-CHANGES: server money validation finite/≥0/≤cap/2dp on the **AUD-resolved** delivery fields; the **foreign-currency audit fields also get bounded/typed shape validation** (they render/export) — not carried blind (GPT).
- **D4-L** APPROVE-WITH-CHANGES (both): the fold is a **lifecycle-aware pure reducer**, sort **Seq ASC → Timestamp ASC → StepId ASC**; it **enforces invariants** (a `resolve` before its target stays pending/stale until dependencies arrive; a missing dependency is never treated as resolved), never blindly trusts the last sorted status, and never credits stock.
- **D4-M** APPROVE (both): new delivery/stocktake ids get a crypto suffix; existing local ids unchanged (backfill handles them).

### R1 — Two-stream reconciliation state machine (the #1 gap both flagged — NEW, mandatory)
A record step must never make the UI claim a stock effect that didn't actually land (e.g. a "received ✓" transfer whose ledger rows were rejected by Chunk-2 validation). Rules:
1. **Fail-closed push ordering (AGY):** for any stock-effecting step (receive, resolve, delivery `record`, stock-take `approve`, cancel) the **ledger rows push FIRST**; the matching RecordStep is enqueued for push **only after** those ledger rows are accepted/duplicated by the Chunk-2 validated push. A step never races ahead of its stock.
2. **Expected-ledger linkage (GPT):** each stock-effecting step's Payload carries the **expected ledger TransactionIds / IdempotencyKeys** it generated.
3. **Fold-time stock state (GPT):** when folding, a stock-effecting step renders **`stockPending`** until its expected ledger rows are observed locally (present + not rejected), and **`stockMismatch`** if any were rejected/quarantined. A receive shows as a clean completed receive **only** when its ledger rows are confirmed present. Fold-time healing flips `stockPending → confirmed` when the rows later arrive.
4. The reducer **never credits stock itself** — R1 governs *derived/display* state; the ledger stays the only stock source.

### Answers to the 6 extra questions (both auditors, converged)
1. Two-stream IS safer; the one divergence risk (step lands, its ledger rows don't) is handled by **§R1** (linkage + `stockPending`/`stockMismatch` + fail-closed push).
2. Partial fold → render **best-effort** intermediate state via a pure monotonic reducer that never treats a missing dependency as resolved and never credits stock; do NOT globally wait for a terminal step (the D4-L reducer rules cover it).
3. Conflict edges → **generation/attempt tracking** (D4-F): 3+ receivers fold into one conflict set; cancel-vs-receive → Director conflict (not last-writer-wins); a late receive after a resolve reopens the conflict unless explicitly covered by the resolve's named attempt set.
4. Backfill convergence → deterministic snapshot StepId + content hash; duplicates 409, mismatches quarantine (D4-I).
5. Scale → ID-cursor pull (primary key) is the right clone; provision indexes while empty; never add a server pull that returns a >5k matched set by store/status; Payload size caps matter (RecordSteps grows faster than the ledger — multiple steps per record).
6. No simpler correct conflict design exists: ledger-only dedupe hides disagreements; per-device steps alone can't protect stock; the two-key split is correct once receive attempts are stable.

### STATUS
**Design LOCKED + build-ready.** NEXT (on Kunal's go): build on staging — `RecordSteps_Staging` (indexes at creation + Enforce-Unique `StepId`) + `recordsteps-push` (clone Chunk-2 validate/quarantine/honest-contract, R1-aware) + `recordsteps-pull` (clone Chunk-1.5 ID-cursor dual-contract) + `StockTransactions_Validate` `IdempotencyKey` column + the client emit/fold/reconcile refactor + conflict UI + automatic backfill + sentinels. Self-prove (smoke + saboteurs 0-blind + cloud probes) → focused GPT+AGY code audit (they run the harness + drive the real staging cloud) → HOLD for the 6-way.
