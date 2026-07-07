# Azure Pull-Hardening — Wave Review (ID-cursor)

**Date:** 2026-06-23 · **Status:** built + self-proven on staging; NOT committed, NOT ported to live. For Kunal review → GPT+AGY implementation audit → live port.

Design approved by both auditors (see `AZURE-PULL-HARDENING-SPEC.md`). This wave implements it: the server-side staging pull workflow + the client-side `sync.js` migration + harness coverage.

## What changed

### Server (Azure, staging only)
- New Logic App **`bob-stock-pull-v2-idcursor-staging`** — uses the SAME managed `Get items` connector action the live pull-v2 uses (so returned field formats are identical to what `sync.js._fromSharePoint` already parses — no ingest-format change). Logic: `Get_maxid` (orderby ID desc, top 1) → `EffectiveMax` = client `maxId` or current max → `Get_page` filter `ID gt {lastId} and ID le {EffectiveMax}`, orderby ID asc, `$top`. Returns `{items, maxId, count, lastId}`.

### Client (`sync.js`) — `pull()` migrated from SyncTimestamp watermark to ID-cursor
- New cursor `_lastSyncId` ↔ `localStorage['bob_last_sp_id']` (replaces the `bob_last_sync` SyncTimestamp watermark as the pull cursor).
- Request body now `{lastId, maxId, $top}` (was `{since, watermark, $top, $skip}`).
- **C1 freeze:** first page lets the server freeze `maxId`; echoed on later pages → concurrent inserts can't extend the cycle.
- **C2 lookback:** start each cycle from `max(0, _lastSyncId - PULL_ID_LOOKBACK)` (100) → async-committed rows re-seen; deduped by TransactionId.
- **C3:** cursor advances to the frozen `maxId` ONLY after every page merged durably (existing durable-merge gate reused); `Math.max` clamp prevents rewind.
- **C6 migration:** first-run detection now `_lastSyncId === 0` → every device replays once from ID 0 on first post-deploy run (cheap while live <5k; threshold-safe regardless; deduped).
- `_lastSyncAt` repurposed as a pure UI-freshness wall-clock (staleness banner), no longer the cursor.
- Merge / tombstone / quarantine logic UNCHANGED (C5: tombstones already append new rows with new IDs — Codex-confirmed `db.js:551/794`, `sync.js:582`, push-v2 POST-create).

## Evidence (staging, live untouched)
- **Crosses 5k:** full ID-cursor walk on `StockTransactions_Staging` (5,500 rows) = 6 data pages + empty page, status 200 every page; on `StockTransactions_IdxTest` (6,000) = 6×1000 clean.
- **C1 under concurrency:** froze max=5502 → inserted a row mid-walk (ID 5504) → frozen cycle EXCLUDED it (walked 5,500) → next cycle (max 5504) INCLUDED it.
- **C4 raw values:** managed `Get items` returns machine-parseable values (Qty numeric, SyncTimestamp 1000020) — identical to today's pull.
- **Index reality (root cause):** a selective `SyncTimestamp gt 1005000` (1000 matches) returned 200/ordered → the index built-while-empty IS real; the throttle is purely matched-set >5k; only the ID-cursor (primary key) crosses it. Full detail in `AZURE-CONTRACT-PROBES.md` → "RESOLUTION (2026-06-23)".

## Harness
- Updated 3 cursor-asserting sentinels to the ID-cursor contract: **S-04** (clamp prevents rewind on a lower frozen maxId), **S-20** (empty pull advances ID cursor to frozen maxId), **S-152** (never-synced first-run gated on `_lastSyncId`).
- Added 3 sentinels: **S-159** (request carries `lastId`, not `since/$skip`; advances `bob_last_sp_id`), **S-160** (C2 lookback: requests `lastId = cursor - 100`), **S-161** (C1 freeze: page 1 omits maxId, page 2 echoes the frozen maxId + advances lastId to page max).
- **Smoke: 153/153 PASS, zero regressions** (S-162 added post-audit). Targeted saboteur on the 7 affected sentinels (S-04/20/152/159/160/161/162): **7 CAUGHT / 0 BLIND / 0 INFRA-FAIL** (baseline 153/153 green). Each mutation flips exactly its sentinel red.

## Pre-port validation probes — DONE (staging seeded to 20,048 rows, via `bob-stock-pull-v2-idcursor-staging`)
| Probe | Result |
|---|---|
| P1 full walk, $top=1000 | ✅ 21 pages, all 20,048 rows, IDs strictly increasing, every page 200 — crosses 20k cleanly |
| P2 full walk, $top=100 | ✅ 201 pages, all 20,048, clean — small page size still crosses the threshold |
| P2b tiny pages, $top=2 | ✅ pages of 2 advance correctly |
| P3 mid-pull fail/resume | ✅ stopped after 3 pages, resumed from saved cursor → full set, **0 rows missing** (idempotent) |
| P5 ID-gap tolerance | ✅ deleted a middle row → walk completes cleanly, total −1, gap skipped, no break |
| C1 concurrent insert (earlier) | ✅ row inserted mid-walk excluded by the frozen cycle; next cycle includes it |
(Note: 48-row gap between total rows [20,048] and unique TransactionIds [20,000] = pre-existing staging test-data noise — incidentally confirms client dedup-by-TransactionId collapses duplicates.)

## Implementation audit (2026-06-23): Codex + AGY both APPROVE-WITH-CHANGES — all addressed
Both converged on the cutover risk; Codex added the fail-closed + $top items. Fixes applied:
- **Dual-contract pull (Codex P1 + AGY critical — the #1 blocker):** an atomic same-URL swap would trap old/cached clients (no `lastId` → server defaults to ID>0 → infinite page-1 loop, battery + Azure cost). FIX: the ported pull-v2 routes on `lastId` — present → ID-cursor; absent → legacy `since/$skip`. Built + PROVEN on staging as `bob-stock-pull-v2-dual-staging`: new path → mode=idcursor (count 1000, maxId frozen); legacy path → mode=legacy returning the correct old-contract rows (verified: `since=1015500` returns the full 2000-row SyncTimestamp window). Old clients keep working through cutover (and on live <5k the legacy branch == today's pull exactly). `audit-artifacts/pull-v2-dual-staging-props.json`.
- **Fail closed on no-forward-progress (Codex P2):** a full page whose max ID doesn't advance is now treated as a malformed page → abort the cycle WITHOUT merging or advancing the cursor (was: stop-and-advance). `sync.js` pull loop. Covered by new sentinel **S-162** (+ saboteur).
- **Clamp server `$top` (Codex Q6):** the dual workflow clamps `$top` to [1, 2000] both paths (was: trusts the request). Proven: request 99999 → returns 2000.
- **C2 lookback margin (Codex vs AGY split — resolved with reasoning):** kept at **100**. The out-of-order *visibility* window is bounded by push-v2's writer concurrency (50); 100 = 2× that floor. AGY's 20 < 50 = unsafe; Codex's ≥1000 unnecessary given the cap; ~30KB/poll re-read is negligible on store wifi. Documented in `sync.js` + flagged for auditor ratification.
- **C5 confirmed by Codex** (tombstones append new rows: `db.js:551/794`, `sync.js:582`, push-v2 POST-create) — no in-place edits. C6 migration APPROVED. C3 durable gate + clamp confirmed present.

## NOT done yet (remaining for this wave)
1. **Auditor ratification** of the post-audit fixes (dual-contract + fail-closed + margin reasoning) — second pass.
2. **Port to live** (now SAFER via dual-contract): deploy the dual-contract pull-v2 to live + ship `sync.js` together. Live-cutover smoke (Codex): first pull, empty pull, one new row, one tombstone, **one old-client (legacy since/$skip) compatibility call**. Operational rule (C7): no manual edits/deletes directly on the SharePoint list.

## Files
- `sync.js` (uncommitted) — `pull()` + cursor fields.
- `test/smoke-test.js`, `test/saboteur-runner.js` (uncommitted) — sentinels + mutations.
- `audit-artifacts/pull-v2-idcursor-staging-props.json` — the staging workflow.
- `AZURE-PULL-HARDENING-SPEC.md`, `AZURE-CONTRACT-PROBES.md`, `AZURE-INDEX-MANIFEST.md`.
