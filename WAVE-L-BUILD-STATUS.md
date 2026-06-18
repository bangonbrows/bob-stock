# Wave L (Tier 5 — Transfer subsystem) — BUILD STATUS

Branch `fix/cli-tri-audit-2026-05`. Tier 5 = the transfer subsystem cluster (phase2.js), the 2nd-biggest weak area in the 6-way blind audit. Sole engineer: Claude. GPT + Gemini audit (run-the-code, report-only). Commit only on Kunal's explicit OK after both auditors PASS. Harness baseline at Tier-5 start: 109 sentinels / 116 mutations (after K4 `ebbfa79`).

## Discovery triage (2026-06-18, verified against CURRENT code — not the audit snapshot)
Several audit-doc findings were already remediated in Waves A–K. Verified per-finding:

| # | Finding | Verdict | Where | Note |
|---|---------|---------|-------|------|
| 1 | GPT-15 completeFlags partial resolution | **FIXED** | phase2.js:1583/306-324 | now one atomic `resolveAllFlags` → single durable write |
| 2 | GPT-12 confirmDraftItem fire-and-forget | **LIVE** | phase2.js:122-130 | non-durable `updateTransfer`+`commit`, no await/confirm |
| 3 | GPT-14 invalid qty coerced to 0 | **PARTIAL** | phase2.js:80,148 | domain coerces blank→0-unit line; only UI rejects |
| 4 | GPTa-22 create can drive origin negative | **LIVE** | phase2.js:62-106/132-170 | no `Stock.qty(pid,fromStoreId)` source check in domain |
| 5 | GPTa-23 receive stores raw receivedQty | **PARTIAL** | phase2.js:211-212 | over-receipt rejection fixed (191-201); stored value still raw |
| 6 | GPTa-26 franchisee multi-store visibility | **PARTIAL** | phase2.js:350 | `Transfer.list` uses single-store `Auth.storeId()`; hub UI already uses `storeIds()` |
| 7 | GPTa-27 return transfers lose type | **LIVE** | phase2.js:72-86 | never sets `type:'return'`; hub always renders "Standard" |
| 8 | GPTa-29 atomic writes don't schedule sync | **LIVE** | db.js:816/853 | `atomicTransferWriteDurable`/`atomicDeliveryWrite` omit `scheduleSync` → stranded stock |
| 9 | GPTa-21 stale cancel double-counts | **LIVE** | phase2.js:360-381 | cancel reverses stock with only local status check; no transfer_in-exists guard |
| 10 | Ca-role _canViewHistory isAtLeast bug | **LIVE** | phase2.js:48 | `isAtLeast('store_manager')` denies franchisee (ranks below); file warns about this exact trap at index.html:918 |
| 11 | Ca-M10 negative stock never floored/flagged | **LIVE** | index.html:1071/1086 | computed sum can go negative; no display floor, no alert |
| 12 | W8 logout doesn't clear transfer draft | **PARTIAL** | index.html:5187 vs phase2.js:1642 | logout calls `TransferUI.resetState` but resetState lives on `Transfer` → undefined, short-circuits; transfer `_txState` leaks |
| 13 | G1-15 multi-table sync gap | **LIVE (by design)** | sync.js | transfers/deliveries/stockTakes records still don't sync — **AZURE-DEFERRED** (needs Logic App endpoints + SharePoint lists) |

## Client-fixable now (this tier) — 11 items
#2, #3, #4, #5, #6, #7, #8, #9 (interim client guard only), #10, #11, #12.

## Inherently server/Azure (deferred, banked)
- #9 full cross-device cancel idempotency (client gets an interim transfer_in-exists guard now; authoritative = server `(TransferId,Type)` idempotency).
- #13 multi-table sync of transfer/delivery/stocktake records.

## Kunal decisions (locked 2026-06-18)
- **Over-send (#4): HARD-BLOCK.** The domain `create`/`submitDraft` must refuse a line whose qty exceeds `Stock.qty(pid, fromStoreId)` (transfers are infrequent; screen already caps it; this closes the back-door for stale/console/regression). Error tells the user to sync / stock-take.
- **Negative stock (#11): show 0 to staff + flag to director.** Floor the DISPLAYED qty at 0 everywhere staff see it (never a negative number); surface a ⚠ negative-stock alert to the director only; do NOT rewrite the underlying ledger value.
- **NEW — manual Sync + visibility (approved):** add a "Sync now" button + a "Last synced … / Syncing…" status indicator to BOTH the sidebar nav and the mobile top bar; also AUTO-SYNC on reconnect (the `online` event currently only hides the offline bar — make it trigger a sync/push+poll). Honest caveat recorded: this refreshes what already syncs (stock levels, catalogue); it will NOT surface transfer/delivery/stocktake RECORDS cross-device until the Azure multi-table sync (#13).

## Current sync behaviour (verified 2026-06-18)
Auto-PUSH on every local write (DB.commit → scheduleSync → 800ms debounce → push). Auto-PULL poll every 30s (`POLL_INTERVAL:30000`). Multi-tab leader election (only leader syncs). Offline bar on disconnect. Sync-status toast bottom-left (transient). "Last sync" shown only in Settings → Cloud Sync. GAPS: reconnect does NOT trigger sync; no persistent nav sync control/status; transfer/delivery durable writes don't scheduleSync (#8).

## Proposed sub-waves
- **L1 — Transfer domain integrity** (ledger/stock correctness): #3 reject invalid qty, #4 source-stock HARD-BLOCK, #5 validate stored receivedQty, #7 return type, #9 cancel transfer_in-exists guard.
- **L2 — Sync reliability + visibility**: #2 confirmDraftItem durable, #8 `scheduleSync` on all durable ledger writes (shared `_afterLedgerWrite` hook), + auto-sync-on-reconnect + "Sync now" button + "last synced/syncing" status (sidebar nav + mobile top bar).
- **L3 — Access / visibility / UX safety**: #6 `Transfer.list` → `storeIds`, #10 `_canViewHistory` explicit role set, #11 negative-stock display floor + director alert, #12 logout transfer-draft reset.

Each sub-wave: discover → build → sentinels → saboteur (targeted + full sweep 0-blind) → GPT+Gemini audit → commit on Kunal OK.

## WAVE L1 BUILT (2026-06-18, NOT committed)
phase2.js — Transfer domain integrity:
- #3 (GPT-14): `create` validates each line qty via `Validate.qty` and rejects ≤0/blank/fractional (was `Math.max(0,safeInt||0)` → 0-unit lines); `submitDraft` re-validates edited qtys (restores snapshot on reject).
- #4 (GPTa-22, HARD-BLOCK): `create` (non-draft) + `submitDraft` refuse any line qty > `Stock.qty(pid, fromStoreId)` — origin can't be driven negative; draft restored on reject. Client guard only (P-13); server idempotency = the authoritative fix.
- #5 (GPTa-23): `receive` stores `Math.max(0, Math.trunc(Number(receivedQty))||0)` (was raw — string/fraction/negative persisted).
- #7 (GPTa-27): transfer object now carries `type: opt.type || (returnReason ? 'return' : 'standard')` so the hub stops rendering returns as Standard.
- #9 (GPTa-21, interim client guard): `cancel` refuses if any `transfer_in` ledger row exists for the transfer (another device received it) — prevents phantom-stock reversal. Full cross-device fix = server `(TransferId,Type)` idempotency (Azure).
Sentinels S-117 (qty reject), S-118 (over-send block, create+submitDraft), S-119 (receivedQty validated), S-120 (return type), S-121 (cancel guard). Mutations S-117/118/119/120/121 + S-122 (sentinel:S-118, submitDraft branch). Smoke 114/114; targeted 6 CAUGHT/0 BLIND/0 INFRA. Full sweep → audit-artifacts/WAVE-L1-SWEEP.log.

## WAVE L1 — internal gate MET (2026-06-18)
Smoke 114/114. Full sweep = baseline 114/114, **122 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL** (confirmed stable across 2 consecutive clean-capture runs). Harness now 114 sentinels / 122 mutations.
Harness incidents (banked, P-12 change-safety): my new create/submitDraft over-send + qty guards MASKED two existing transfer sentinels — **S-03** (submitDraft email-on-failed-write: the test store had no stock → guard rejected before the notify/write path; fixed by seeding stock + driving `Transfer.submitDraft(id,{pid:2})` directly instead of the DOM-reading `TransferUI.submitDraft`) and **S-15** (create actor-slim: no stock → over-send guard blocked the transfer → no transfer_out row → actor-leak mutation couldn't manifest; fixed by seeding origin stock). One additional transient false-blind appeared once under peak parallel load with NO printed verdict line (a complete-but-flaky-green pass; the determinism retry only covers PARTIAL runs) — did not reproduce across two subsequent full sweeps. LESSON: adding a domain precondition guard can silently mask any existing sentinel whose setup didn't satisfy the new precondition — the FULL sweep catches it (targeted runs don't); seed the precondition in those sentinels.

### L1 code-audit brief — GPT (paste as-is)
> BOB Stock App — Wave L1 (Tier 5: transfer domain integrity) CODE audit. AUDIT ONLY — report findings, do NOT edit. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`, file `phase2.js` (Transfer module). RUN the code (browser/Node vm), don't review statically. Five domain fixes to verify, adversarially:
> 1. **Invalid qty (GPT-14)** — `create` + `submitDraft` must reject a line whose qty isn't a positive whole number (was `Math.max(0,safeInt||0)` → 0-unit lines + 0-qty ledger rows). Check via `Validate.qty`; confirm no 0/blank/fractional/negative line can create a transfer or a transfer_out row. `submitDraft` must restore the pre-mutation snapshot on reject (it mutates `t` in place).
> 2. **Over-send HARD-BLOCK (GPTa-22, Kunal decision)** — `create` (non-draft) + `submitDraft` must refuse any line qty > `Stock.qty(pid, fromStoreId)`; origin stock can't be driven negative; draft restored on reject. A DRAFT create must NOT apply the source check (no ledger rows yet). Confirm both branches enforce it and there's no path that writes transfer_out without the check.
> 3. **receivedQty validation (GPTa-23)** — `receive` must store a validated whole non-negative `item.receivedQty` (was raw — string/fraction/negative persisted); confirm the stored value and the credit are consistent, and over-receipt is still rejected.
> 4. **Return type (GPTa-27)** — the transfer object carries `type` = 'return' when `returnReason` set, else 'standard'; confirm the hub renders it and nothing else depends on the missing field.
> 5. **Cancel guard (GPTa-21, interim)** — `cancel` must refuse if any `transfer_in` ledger row exists for the transfer (another device received it), preventing phantom-stock reversal. Confirm it doesn't false-block a legitimate cancel of a never-received in_transit transfer, and that the guard is correctly scoped to in_transit. Note this is an interim client guard; the authoritative fix is server idempotency (Azure) — confirm that's the right boundary.
> Also: do these guards introduce any regression in the create/submitDraft/receive/cancel happy paths? Report P0–P3 with file:line. Verdict: PASS / sound-with-changes / BLOCK.

### L1 code-audit brief — Gemini (paste as-is; CLI, report-only)
> BOB Stock App — Wave L1 (Tier 5: transfer domain integrity) CODE audit. AUDIT ONLY — report findings, do NOT edit any file (reviewer, not engineer). Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`, file `phase2.js`. RUN the code (browser/Node vm), don't review statically. Verify these five Transfer domain fixes and check for regressions in the happy paths:
> 1. `create`/`submitDraft` reject non-positive/blank/fractional qty (no 0-unit lines or 0-qty ledger rows); submitDraft restores its snapshot on reject.
> 2. `create` (non-draft) + `submitDraft` HARD-BLOCK sending more than `Stock.qty(pid, fromStoreId)` (origin never negative; draft restored); a DRAFT create does not apply the source check.
> 3. `receive` stores a validated whole `receivedQty` (not raw string/fraction/negative); over-receipt still rejected.
> 4. transfer `type` = return|standard so the hub stops showing every transfer as "Standard".
> 5. `cancel` refuses when a `transfer_in` already exists (another device received) and does not false-block a legitimate cancel.
> Report issues with file:line and severity. Verdict: PASS / approve-with-changes / BLOCK.

## WAVE L1 CODE AUDIT R1 (2026-06-18): GPT sound-with-changes (1 P2) — FIXED; Gemini PASS (missed it)
**GPT P2 (real):** the receivedQty fix used `Math.trunc(Number(...))||0` which COERCED instead of validating — `'2.9'`→2 silently completed a transfer on garbage input; `-1`→0; contradicts Validate.qty's no-truncation contract. **FIXED:** `receive` now runs a Validate.qty pre-pass over every received line BEFORE any mutation — rejects fractions/negative/garbage (whole non-negative incl 0 allowed), then rejects over-receipt, building a validated `_rq` map the credit loop uses. S-119 reworked: a fractional receivedQty is now REJECTED (nothing stored, transfer untouched) + a valid whole accepted; mutation reverts to truncation → CAUGHT. S-69 (over-receive) still passes (12>10 rejected as a valid whole).
**Gemini R1:** PASS — but explicitly "VERIFIED" the truncation line (phase2.js:250 `Math.trunc`) as correct, i.e. waved through the exact P2 GPT caught (recurring: GPT is the edge-case gate). All five fixes otherwise independently confirmed by Gemini incl. a Create→Receive happy-path regression script.
Smoke 114/114; targeted S-119 CAUGHT. Full sweep after the P2 fix → audit-artifacts/WAVE-L1-SWEEP.log.

### L1 re-audit brief — GPT (paste as-is; confirm the receivedQty P2 fix)
> BOB Stock App — Wave L1 RE-AUDIT (your receivedQty P2 fix). AUDIT ONLY, report only. Repo `C:\Users\joshi\repos\bob-stock`, branch `fix/cli-tri-audit-2026-05`, file `phase2.js`. RUN the code. Your P2 (Transfer.receive truncated received qty via Math.trunc instead of validating — '2.9'→2 silently completed a transfer, -1→0) is fixed: `receive` now runs a `Validate.qty` pre-pass over EVERY received line BEFORE any mutation, rejecting fractions/negative/garbage (whole non-negative incl 0 allowed) and rejecting over-receipt, then uses a validated qty map for crediting. Re-confirm: (1) a fractional/negative/garbage receivedQty is rejected with nothing stored and the transfer untouched (still in_transit); (2) a valid whole receive (incl exact-match and short receipt) still works and credits correctly; (3) over-receipt still rejected; (4) no path stores/credits an unvalidated qty; (5) no regression in the receive happy path or flag/credit logic. Verdict: PASS / sound-with-changes / BLOCK, file:line.

## WAVE L2 SCOPE (discovery done 2026-06-18) — sync reliability + manual Sync
Targets (file:line from L2 discovery):
- **#2 confirmDraftItem durable** — phase2.js:143-151 is non-durable (`DB.updateTransfer(t); DB.commit()`, sync, returns ok unconditionally). Fix: make async, snapshot t, `await DB.updateTransferDurable(t, snap)` (db.js:770, returns Promise<bool>, restores snapshot on fail), gate success. No scheduleSync needed (status-only edit, no ledger rows).
- **#8 scheduleSync on durable writes** — db.js `addTransactionDurable` (~707/720), `atomicTransferWriteDurable` (~816/850), `atomicDeliveryWrite` (~853/883) none call scheduleSync. Fix: shared `DB._afterLedgerWrite()` = guarded `Sync.scheduleSync()`, call `if(ok) this._afterLedgerWrite();` before each `return ok` (matches commitDurable success-gated pattern at db.js:754). Also addTransactionsDurable (~738) if present.
- **NEW Sync.syncNow()** — sync.js has push(663, local→server), pull(880, server→local), poll(1172, leader: pull+push), scheduleSync(1139, LEADER-GATED: a follower only postMessages the leader + 800ms debounce — WRONG for a manual button). Add `async syncNow(){ await push(); await pull(); }` ignoring _isLeader (relies on _syncLock for mutual exclusion); progress shows via existing _showStatus toast (#sync-status).
- **NEW auto-sync-on-reconnect** — index.html:5470-5477 `online` handler only toggles #offline-bar. Add `Sync.syncNow()` on the ONLINE event only (not the shared updateOnlineStatus initial call).
- **NEW Sync-now button + "last synced" status** — desktop sidebar is JS-built by buildSidebar() (index.html:4896-5044; static #sidebar 321-335 is overwritten); add a `sidebar-footer-btn` "Sync now" + a persistent "Last synced …" line in the footer (5036-5039). Mobile top bar is static (index.html:337-341); add a `btn btn-sm` Sync button next to #mobile-logout. "Last synced" reads `bob_last_sync` (epoch ms, written by pull at sync.js:1084; format via `new Date(x).toLocaleString()` / 'Never', per index.html:3411-3412). Keep transient #sync-status (283) for progress only; add a SEPARATE persistent indicator.
NOTE: bob_last_sync advances on PULL only — consider stamping it on push success too so "last synced" reflects both directions (decide at build). Honest caveat (already told Kunal): syncNow refreshes stock/catalogue; transfer/delivery/stocktake RECORDS still don't sync till Azure (#13).
Sub-wave order within L2: (a) #8 _afterLedgerWrite + #2 durable (phase2/db, pure reliability), (b) Sync.syncNow + reconnect (sync.js + online handler), (c) nav UI (button + status, both bars). Sentinels: confirmDraftItem-durable, atomic-writes-schedule-sync (transfer + delivery), syncNow-pushes-and-pulls, reconnect-triggers-sync. UI button = lighter sentinel (presence/onclick wiring).

## WAVE L2 DESIGN REVIEW (2026-06-18): GPT REWORK + Gemini REWORK — STRONGLY CONVERGED. Plan revised.
Both auditors independently flagged the same 3 substantive design flaws (no conflicts). Adopted:
- **(P0, both) bob_last_sync is the PULL CURSOR, not a display field** — verified: loaded into `_lastSyncAt` at sync.js:83/151; advanced only by pull (1084/946). Stamping it on push with the device clock would skip server rows newer than the local clock = silent data loss. → NEVER touch bob_last_sync for UI. Add a SEPARATE display-only key `bob_ui_last_sync` for the nav indicator (stamp on any sync activity). bob_last_sync stays pull-only.
- **(P1, both) syncNow ignoring _isLeader breaks the single-syncer invariant** — `_syncLock` is per-tab/in-memory, NOT cross-tab; a follower running push/pull while the leader polls → duplicate pushes, concurrent pulls, cursor/status regression. → Manual button + reconnect call a LEADER-OWNED QUEUED cycle: if this tab is leader, run push→pull under _syncLock (queue ONE follow-up if already syncing); if follower, BroadcastChannel-message the leader to run it; if NO leader responds within a short timeout, claim leadership via the existing election then run. Reuse/extend the existing 'local-write' BroadcastChannel handler.
- **(P1, both) confirmDraftItem async-in-loop race** — verified called inside a loop at phase2.js:1532-1534 (submit path). Making it async naively → concurrent unawaited durable writes on the same transfer row, racing submitDraft's atomic write. → interactive single-toggle becomes async+durable (await updateTransferDurable); the SUBMIT path stops per-item confirmDraftItem and instead marks items confirmed in memory + lets submitDraft do its ONE atomic durable write (or for...of await). 
- **(P2) _afterLedgerWrite** must run only AFTER the Dexie transaction completes, only on ok===true, wrapped in try/catch (a sync-schedule failure must not make a successful local write look failed). Apply to atomicTransferWriteDurable + atomicDeliveryWrite + bulk addTransactionsDurable. NOTE single addTransactionDurable is already followed by DB.commit() (schedules) in the movement path (index.html:1795) → hooking it double-schedules (harmless via 800ms debounce, but noisy); decide at build (lean: hook the stranded writers only).
- **(P2) reconnect** debounced (2–3s), routed through the same queued leader path, NOT fired from the initial updateOnlineStatus() call.
- **(P3) order + wording** — push-then-pull for the button ("send my work, then catch up"); UI label "Stock last synced" (NOT generic "Last synced") so it doesn't imply transfer/delivery/stocktake RECORDS sync cross-device (still Azure #13).
REVISED L2 = bigger/more careful than the naive plan. Build to this shape, then code-audit. Design-review briefs + verdicts archived above.
