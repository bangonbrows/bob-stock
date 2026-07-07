# Azure Chunk 4 — Wave Review

**Date:** 2026-07-01 · **Status:** client + cloud BUILT + self-proven on branch/staging; **NOT committed, NOT deployed, live untouched.** Held for the end-of-phase 6-way blind audit + single live cutover. For Kunal review → focused GPT + AGY code audit (auditors run the harness themselves + drive the real staging cloud) → hold.

**Harness:** smoke **173/173**; full saboteur sweep **189 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL** (all waves).

**Cloud (staging, via az + Graph Explorer — NO app secret):**
- `RecordSteps_Staging` list (16 cols, internal names == client wire contract); `StepId` Indexed + Enforce-Unique.
- `bob-stock-recordsteps-push-staging` (envelope validation + honest contract + StepId-unique dedup) — **PROVEN**: mixed batch → accepted/duplicate(409)/BAD_RECORDTYPE/BAD_STEPID/BAD_STEPTYPE, invariant held.
- `bob-stock-recordsteps-pull-staging` (ID-cursor) — **round-trip PROVEN**: pushed step pulled back with Payload byte-intact.
- **A6 ledger receive-idempotency**: `IdempotencyKey` Indexed+Enforce-Unique on `StockTransactions_Validate`; the validate push now inserts `IdempotencyKey=coalesce(row,TxnId)` — **PROVEN**: 2nd same-`(transfer,store,product)` receive (different TxnId) → duplicate → stock can't double; different-key receive not deduped.
- Props in `audit-artifacts/`: recordsteps-push/pull-staging-props.json, set-recordsteps-unique-props.json, set-validate-idem-unique-props.json, push-v2-validate-idem-props.json.

This is **the big one**: making transfers / deliveries / stock-takes sync across devices via the append-only **record-steps** model (D1), with the folded-in Chunk-3 receive idempotency + double-receive conflict resolution. The full locked design is `AZURE-CHUNK4-SCOPE.md` ("SPEC REVIEW RESOLVED" section). This doc is the **code review** of the client implementation.

## What "two streams" means (the core safety invariant)
- **StockTransactions ledger = sole source of truth for stock quantities** — UNCHANGED. It keeps syncing exactly as before (Chunk-1.5 ID-cursor pull + Chunk-2 validated push).
- **New `RecordSteps` stream = record lifecycle/metadata** (who/when/status/line-items/costs/reasons). **A record-step NEVER credits stock.** The two are linked by `recordId`/`transferId` + `expectedLedgerKeys`.

This separation is what lets Chunk 4 reuse all the proven ledger machinery and adds a parallel metadata stream that cannot corrupt stock counts.

## Design choices realised in code (flag for auditors)
1. **ADDITIVE emission.** The heavily-audited local write paths (phase2.js transfer lifecycle, index.html delivery/stock-take) are UNCHANGED. Each emits a record-step *after* its existing durable write succeeds (skipped on any failure path). → no behaviour change, minimal regression surface (proven: smoke 172/172, the 161 pre-existing sentinels all still green).
2. **Genesis = `submit`, not `create`.** A transfer **draft** is local WIP and is NOT synced; the first synced step is `submit` (transfer sent). Drafts stay private until sent (matches the Transit-Void "stock deducts on submit" model). `create`/draft has no step.
3. **Fold materialises INBOUND records.** On pull, `Records.applyFold()` upserts records this device did not originate; a record's own steps re-fold idempotently. `_mergeWorthwhile` is a status-rank gate (never regress a record; a `conflict` always surfaces and is never silently cleared).
4. **Two idempotency keys (D4-E).** (a) the *ledger* receive key `transfer:{TransferId}:receive:{StoreId}:{ProductId}` (Enforce-Unique, server side, Chunk-4 cloud) keeps stock from doubling; (b) the *step* receive key `tr:{id}:receive:{toStore}:{receiveAttemptId}` carries a **stable persisted `receiveAttemptId`** (minted once, BEFORE the snapshot so a failed-write rollback keeps it → a crash-retry replays the same step; a different device → a different key → both receives survive → the fold sees the conflict).
5. **R1 reconciliation.** A stock-effecting step carries its `expectedLedgerKeys`. `pushSteps` is **fail-closed**: such a step is held until ALL its ledger rows are durably `_synced` (so a record never claims a stock effect before the stock lands). The fold derives `stockPending`/`stockMismatch`/`confirmed` from those keys vs the local ledger.

## Files changed (client; all `node --check` clean)
| File | Change |
|---|---|
| **`records.js`** (NEW) | The `Records` module: model + wire-contract doc, deterministic step-ids, `emit`, `toSharePoint`/`fromSharePoint`, the lifecycle-aware **fold** (transfer/delivery/stocktake; sort Seq→Timestamp→StepId), **conflict detection** (`_detectReceiveConflict`), **R1 `stockStateFor`**, `applyFold`, automatic **`runBackfillOnce`**. |
| **`db.js`** | Dexie `version(2)` adds the `recordSteps` table; wired into load/full-persist/seed; new `addStepDurable`/`addStepsDurable`/`markStepsSynced`/`markStepsRejected` (exact mirrors of the audited transaction methods, same cache-rollback-on-failed-write contract). |
| **`sync.js`** | `_stepsPushUrl`/`_stepsPullUrl`/`_lastStepSyncId` config (steps sync OFF gracefully if absent); **`pushSteps`** (honest accept/dup/reject/failed contract + R1 fail-closed hold) + **`pullSteps`** (ID-cursor clone of the ledger pull → addStepsDurable → applyFold); hooked into `_runSyncCycle` (ledger first, then steps), `scheduleSync` debounce, `poll` (+pending drain), `init` (first-run pullSteps + `runBackfillOnce`). |
| **`phase2.js`** | ADDITIVE emit in create/submitDraft (`submit`), receive (`receive` + stable `_receiveAttemptId`), resolveFlag/resolveAllFlags (`resolve`), cancel (`cancel`, in-transit only); **`Transfer.resolveConflict`** (delta-only adjustment + bumped-generation resolve naming the settled attempts) + the **`renderResolveConflict`** Director screen + `TransferUI.submitConflict` + `openDetail` routing for status `conflict`. |
| **`index.html`** | ADDITIVE emit in `_saveDelivery` (`record`, full costed payload — D4-K money), `_saveDeliveryPackaging` (`packaging_edit`, only when changed), stock-take count/approve/reject; **D4-M** crypto-suffixed `del_`/`st_` ids; loads `records.js`. |
| **`sw.js`** | Precache `records.js`; `CACHE_NAME` → `v11`. |
| **`test/smoke-test.js`**, **`test/saboteur-runner.js`** | +11 sentinels S-171..181 + 11 saboteurs; `records.js` added to the runner's `SRC_FILES`. |

## The wire contract (client camelCase ↔ SharePoint PascalCase)
Documented at the top of `records.js` and MUST equal the (pending) `recordsteps-push`/`recordsteps-pull` Logic Apps — the [[feedback_mock_must_match_server]] lesson: a mock that drifts from the deployed contract passes the harness but breaks in reality. Envelope: `StepId`(unique) / `RecordType` / `RecordId` / `StepType` / `Seq` / `OwnerStoreId` / `FromStoreId` / `ToStoreId` / `Status` / `Payload`(JSON) / `ActorId` / `ActorName` / `DeviceId` / `Timestamp` / `SyncTimestamp`(server) / `Deleted` + `ID`(server). The honest push response = `{status, inputCount, accepted:[stepIds], duplicates:[stepIds], rejected:[{index,StepId,reasonCode,reason}], failed:[{index,StepId,reason,retryable}], serverTimestamp}` (same shape as the ledger; ids are stepIds).

## Harness (self-prove)
- **Smoke: 172/172 PASS** on clean code (161 pre-existing + 11 new), **zero regressions**.
- New sentinels S-171..181 cover: emit-submit, emit-receive (+stable attemptId), fold (order-independent rebuild), conflict detect (diff→conflict / same→silent), R1 stock-state (confirmed/mismatch/pending), pushSteps R1 fail-closed hold, pushSteps reject-quarantine, pullSteps fold-materialise, backfill-once (deterministic id), D4-M crypto-id (source check), resolveConflict delta+generation.
- **Scoped saboteur (S-171..181): 11 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL** (baseline 172/172). Every new sentinel is mutation-proven (drives LIVE code, not a re-derived copy).
- Full 172-sentinel saboteur sweep (all mutations, pre-handoff gate): run separately.

## Code audit round 1 (2026-07-01/02) — AGY PASS; GPT BLOCK (3 real fold bugs AGY missed), all FIXED + reproven
GPT-Codex found 3 runtime-proven blockers in the fold/reconciliation; all fixed (records.js/phase2.js), sentinels S-183/184/185 added, smoke **176/176**, scoped saboteur **6 CAUGHT/0 BLIND**, full sweep **194 CAUGHT / 0 BLIND**. Both auditors re-verified CLEAN (independent runs, incl. runtime details like generation→2 on reopen).
- **#1 R1 half-built** — fold computed `_stockState` but left status='completed' (UI routes by status). Fix: status → `stock_pending`/`stock_mismatch`, `_lifecycleStatus` retained, UI warning banners, `_mergeWorthwhile` updated.
- **#2 conflict never cleared** — `_detectReceiveConflict` flagged any qty disagreement even after a resolve covered it. Fix: disagreement evaluated only over UNCOVERED attempts; late uncovered receive reopens.
- **#3 backfill silent first-writer-wins** — server deduped on StepId, hash never compared. Fix: backfill stepId includes the content hash; `foldRecord` flags divergent snapshots as `conflict`/`backfill_divergence`.

## A7 (D4-K) server money validation — DONE (Kunal chose the Azure Function; GPT's pick)
`bob-stock-money-fn` (Azure Function, **Windows** consumption — Linux was undeployable; config-zip works on Windows) hosts `validateMoney` (anonymous; validates delivery Payload money/currency finite/≥0/rate>0/≤1e7/≤2dp incl foreign). `recordsteps-push` now calls it (`Call_money` → `MoneyBad` → Validate adds `BAD_MONEY`), fail-open if the Function is unreachable (client UI.money backstop). PROVEN E2E: a delivery step with `unitCost:-9` → rejected `BAD_MONEY`; clean delivery + transfer accepted. (Prod: gate the Function with a key/managed identity.) Quarantine sink for record-steps DONE (best-effort write to `StockTransactions_Quarantine`, Q_insert Succeeded in run history).

## Re-verification round (2026-07-03) — CONVERGED: GPT SCOPED PASS + AGY SCOPED PASS
GPT re-ran the re-verify note independently: smoke **176/176**, scoped saboteur S-173/174/179/183/184/185 = **6 CAUGHT / 0 BLIND**, all 3 cloud/fold scenarios re-driven on real staging (gpt_ namespaced) with correct outcomes (stock_pending/stock_mismatch, resolve-clears + late-receive-reopens with `_conflict.kind=reopened`, backfill divergence both-land+conflict / same-hash converge), and the A7 money probe held (BAD_MONEY rejected, invariant intact). Verdict: 3 blockers closed, no reproducible blocker.
- **GPT residual (transient 502) GROUND-TRUTHED by Claude via run history:** run `0858418592...CU26` (17:42:12Z) — the SharePoint `Insert` first attempt hung to the connector's 120s timeout ("server did not respond within the timeout limit"), the connector's built-in retry succeeded in ms, but the elapsed time blew the request-response window → caller saw 502 while the row landed exactly once (StepId unique). 1 occurrence in ~30 runs of this Logic App; the client contract absorbs it by design (client retry → server 409-dedup → duplicate → marked synced). **Benign transport noise, no action.**
- **AGY re-verify (initially incomplete, completed on request):** first report = smoke 176/176 + 17/17 real-cloud probes (agy_ namespaced; all 3 blockers + A7 money probe confirmed) but NO scoped saboteur run; on request AGY ran it — **6 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL** (baseline 176/176), matching GPT and Claude. Hygiene: AGY had saved the SAS callback URLs to plaintext files in its OWN workspace (never in this repo — verified by grep); deleted + confirmed on request. AGY's offer to wire stepsPushUrl/stepsPullUrl itself was declined per the standing rule (auditors report only).
- **CONVERGENCE MET (process step 10):** both auditors independently ran smoke + scoped saboteurs + real staging cloud E2E with matching clean numbers. Chunk 4 → HOLD on Kunal's authorisation.

## NOT done / open (gates before this chunk is complete)
1. **Wire `stepsPushUrl`/`stepsPullUrl` into staging AppConfig `sync_config`** for a full client-against-cloud E2E — OR auditors drive the staging endpoints directly (callback URLs Kunal supplies; `chunk4-cloud-probes.js`). Live config untouched.
2. **Auditors converge on the re-verification** (scoped — the 3 fixes) + the A7 money reject. Both PASS → done.
3. **Hold** for the end-of-phase 6-way + single live cutover.

## Scope boundary
Data-shape + idempotency + sync only. **No authz** (who may emit which step = Chunk 5; the envelope already carries OwnerStoreId/From/ToStoreId/ActorId/DeviceId for that later enforcement). Live untouched; nothing committed/deployed.
