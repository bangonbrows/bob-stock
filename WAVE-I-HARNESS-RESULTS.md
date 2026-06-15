# Wave I — Harness Results (2026-06-15)

## Regression (existing sentinels after the rework)
- **73/73** pre-Wave-I sentinels still PASS — zero behaviour regressions from the delete/tombstone rework. Incl. S-08 (delete reversal via the rewritten removeTransaction) and S-65 (tombstone egress).

## Smoke (clean code, with 7 new sentinels)
- **80/80 sentinels CLEAN-PASS.** New ones, with discriminating values:
  - S-74 atomic rollback: forced durable-delete failure → ok=false, original kept, no orphan tombstone.
  - S-75 no-URL durable tombstone: delete with `_pushUrl=null` → durable unsynced tombstone present, carrying DeletedBy/At/Reason.
  - S-76 ghost resurrection: a single pull batch [create X, delete X] → X NOT present (deleted, not resurrected).
  - S-77 TTL prune: old synced tombstone pruned; recent + unsynced kept.
  - S-78 metadata mapping: `_toSharePoint` emits DeletedBy/DeletedAt/DeleteReason.
  - S-79 poll-push: leader `poll()` with pending → `push()` invoked.
  - S-80 inertness: `type:'deleted'` → direction 'none', not active, zero stock effect.

## Saboteur mutations (each fix reverted in isolation)
```
S-74 tombstone rollback removed          -> CAUGHT
S-75 _makeTombstone returns null         -> CAUGHT (after fix; see below)
S-76 pull stops applying tombstones      -> CAUGHT
S-77 TTL prune selects nothing           -> CAUGHT
S-78 metadata mapping removed            -> CAUGHT
S-79 leader poll stops draining pending  -> CAUGHT
S-80 'deleted' given an OUT direction    -> CAUGHT
==== 7 CAUGHT, 0 BLIND, 0 skipped ====  (baseline 80/80 green)
```

## Self-caught harness issue (the saboteur did its job)
S-75's first mutation find was **multi-line with a Unicode arrow** and SKIPPED. Root cause: `db.js` is **CRLF** in the working tree (a `git checkout -- db.js` during the Wave-I design-review incident restored it via git+autocrlf), so a raw `\n` multi-line find can't match `\r\n`. Fix: single-line, ASCII-only find on the `_makeTombstone(...) {` definition (the `) {` distinguishes it from its call sites). Re-run: **CAUGHT**.
**Rule reinforced:** saboteur mutation find-strings should be SINGLE-LINE + ASCII + unique. (All other db.js mutations are already single-line; sync.js/index.html are LF so their multi-line finds are fine.)

## Harness totals after Wave I
- **80 sentinels / 80 mutations** (S-01..S-80).

## Follow-up: removeTransaction parity fix (GPT+Gemini convergent finding) → S-81
Both auditors flagged the non-durable `removeTransaction` missing a cache rollback on a failed background write (cache/disk tear). Fixed (rollback in the `.then`, parity with the durable path). **S-81** added (5s wait for the async rollback after the ~3.5s retry cycle). Smoke 81/81.

## Final pre-commit sweep (full 81 mutations)
- First full run: **80 CAUGHT, 1 BLIND (S-74), 0 skipped.** S-74 blind = a find-string COLLISION: the S-81 fix added a line identical to S-74's mutation target in an earlier function, so the saboteur's first-match replaced the wrong one (the durable rollback code is correct — S-74 was CAUGHT before S-81). Fixed: appended a unique comment to the durable rollback line + retargeted S-74's find.
- Re-run: **baseline 81/81 green, S-74 CAUGHT.** Combined with the full run's 80-CAUGHT/0-skipped (on behaviorally-identical code — the fix was a no-op comment + a test find-string), the harness is fully proven: **81 sentinels, 81 CAUGHT, 0 BLIND, 0 SKIPPED.**
- LESSON (bank): adding a new line identical to an existing mutation's find-string silently collides (first-match) → the older mutation goes BLIND. The full sweep is the safety net; keep mutation find-strings unique (add a distinguishing comment when two paths share a line).

## Status
- **81 sentinels / 81 mutations, all proven.** Regression clean. Both auditors PASS (code re-audit). → CLEARED FOR COMMIT.
