# Live cutover runbook — ID-cursor pull (dual-contract)

**Status:** ready to execute on Kunal's explicit go-ahead. Both auditors GREEN to port (2nd-pass ratified 2026-06-23). NOT yet executed.

## Why this is low-risk
The ported pull-v2 is **dual-contract** (routes on `lastId`). So the order is forgiving — there is no fragile atomic window:
- Old/current clients send `since/$skip` → legacy branch → identical to today's pull (live is 1,788 rows, well under 5k, so no throttle).
- New clients (after `sync.js` ships) send `lastId` → ID-cursor branch.

## Steps (in order)

1. **Update the live `bob-stock-pull-v2` Logic App** to the dual-contract definition.
   - Source: `audit-artifacts/pull-v2-dual-LIVE-props.json` (verified: 0 `_Staging` refs, list = `StockTransactions`, reuses the live `sharepointonline` connection).
   - `az resource create` overwrites the definition in place → **the trigger callback URL is preserved** (AppConfig `sync_config.pullUrl` unchanged — no config edit needed).
   - After update, **current live clients are unaffected** (they send `since/$skip` → legacy branch).
   - VERIFY (GPT): the deployed definition has no lingering `StockTransactions_Staging` references before proceeding.

2. **Smoke the live workflow directly** (before shipping the client), via its callback URL:
   - Legacy page 1: `{since:'0',$skip:0,$top:1000}` → mode=legacy, returns rows (live <5k so since=0 is fine).
   - **Legacy paging (GPT): `{since:'0',$skip:1000,$top:1000}`** → mode=legacy, second page behaves (the compat risk lives in legacy paging, not just page 1).
   - New ID pull: `{lastId:'0',$top:1000}` → mode=idcursor, returns rows + frozen maxId.
   - Empty ID pull: `{lastId:'<currentMax>',$top:1000}` → mode=idcursor, count 0.

3. **Ship `sync.js` (+ test files)** — commit the branch, merge to `main` → GitHub Actions deploys to Azure SWA.
   - Clients pick up the new build (SW update toast) → start sending `lastId` → ID-cursor branch.
   - First run on each device: `bob_last_sp_id` unset → replay from ID 0 once (deduped by TransactionId) (C6).

4. **Live smoke (post-deploy)** — the full set:
   - first ID pull (new client), empty ID pull,
   - one new stock movement on device A → appears on device B,
   - one delete (tombstone) on A → removed on B,
   - **one old-client legacy call with `$skip>0`** (simulate a not-yet-updated device) → still works,
   - confirm `index.html`/`sync.js` live build is the new one, app assets 200, sensitive files still 404.

## Standing operational caveats (not blockers)
- **C7:** never edit/delete rows directly in the SharePoint `StockTransactions` list (an ID-cursor would miss in-place changes). All changes via the app.
- **Lookback coupling:** `PULL_ID_LOOKBACK = 100` is 2× push-v2's writer concurrency (50). If push-v2 concurrency is ever raised, or any new bulk/manual writer is added to the list, raise the lookback first (GPT).

## Rollback
- Re-apply the previous `bob-stock-pull-v2` definition (the original is in `audit-artifacts/azure-pullv2-def.json`) → reverts to legacy-only. New clients would then fall back... (note: new clients send `lastId`, which legacy-only ignores → would re-serve page-1-from-since; so rollback of the Logic App should pair with reverting the SWA deploy). Safer rollback = revert the SWA deploy (git revert + push) so clients send `since/$skip` again; leave the dual-contract Logic App in place (it serves legacy fine).

## Artifacts
- `audit-artifacts/pull-v2-dual-LIVE-props.json` — the live workflow definition (port target).
- `audit-artifacts/azure-pullv2-def.json` — the current/original live pull-v2 (rollback reference).
- `sync.js`, `test/smoke-test.js`, `test/saboteur-runner.js` — the client + harness changes.
