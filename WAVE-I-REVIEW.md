# Wave I Review Pack — Tier 2: delete/tombstone holistic rework

**Date:** 2026-06-15 · **Branch:** `fix/cli-tri-audit-2026-05` (on commit `7b4027d`; Wave I NOT committed)
**Design:** pre-reviewed by GPT + Gemini (both read-only) BEFORE implementation — Gemini SOUND, GPT sound-with-changes. All their refinements are in. Scope/design: `audit-artifacts/WAVE-I-TIER2-SCOPE.md`.

---

## Plain-English summary (for Kunal)

The "delete" path had six separate weaknesses and a fragile bespoke code path. Instead of patching each, I changed the model: **when you delete something, the delete and its "tombstone" (the marker that tells other devices to delete it too) are now written together in one atomic save** — both happen or neither does. Then the tombstone rides the normal sync engine instead of its own hand-rolled path. The result fixes all six issues at once and is *less* code than before.

What you'd notice: deletes now reliably reach other devices (even if made offline or before the app finished connecting), carry the who/when/why, can't accidentally resurrect a row, and the old delete markers get cleaned up after 30 days instead of piling up forever.

## What each fix does
1. **Atomic delete+tombstone** — no more "deleted here but the marker never got created" divergence.
2. **One sync path** — deleted the separate tombstone-push; tombstones inherit the main engine's strict delivery-confirmation, retry, and offline queue.
3. **Audit metadata** — who/when/why now travels with the delete to every device (including the 5-min Undo, which was anonymous before).
4. **30-day cleanup** — synced tombstones older than 30 days are pruned on launch (the cloud keeps the record, so nothing's lost).
5. **No ghost resurrection** — a create+delete arriving together no longer leaves the row alive.
6. **Poll also pushes** (GPT's catch) — a delete can't get stranded if a backgrounded tab misses the hand-off signal.

---

## Technical changelog
| Issue | File · change |
|---|---|
| I-6 atomicity | db.js — `removeTransaction` + `removeTransactionDurable` write `delete(original)` + `put(tombstone)` in ONE `bobDB.transaction`; roll back BOTH on failure. Shared `_makeTombstone` (crypto id). |
| I-1 no-URL drop / I-3 weak ack | sync.js — DELETED `pushTombstone` + the `push-tombstone` BroadcastChannel msg/handler. Tombstone is now an unsynced row drained by `push()` (egress whitelists it) → strict `processedCount` ack + retry + offline-queue inherited; no early drop. |
| I-2 metadata | sync.js `_toSharePoint` maps DeletedBy/DeletedAt/DeleteReason; index.html `_undoMovement` passes metadata. |
| I-4 prune | db.js — `markTransactionsSynced` stamps `_syncedAt`; new `pruneSyncedTombstones(ttlDays=30)` prunes synced tombstones older than TTL; called on launch in `initDB`. |
| I-5 ordering | sync.js `pull()` — merge `newTransactions` FIRST, THEN apply tombstones against the post-merge ledger, by `TargetTransactionId` ONLY; a no-op tombstone (target absent) does NOT block the cursor. |
| GPT poll-push | sync.js `poll()` — leader also drains pending (`push()`), not just pull. |

## Design-review refinements adopted
- **TTL prune** (both auditors) over cursor-advance — robust to clock drift / iOS eviction; SharePoint is the persistent record. Prune by `_syncedAt` (GPT).
- **Drop the BroadcastChannel tombstone msg** (both) — durable row + `'local-write'` refresh + poll-push cover the follower→leader handoff.
- **Apply by TargetTransactionId only** (GPT) — dropped the `|| TransactionId` fallback.
- **No-op tombstone must not stall the cursor** (GPT).

## Harness
- New sentinels **S-74..S-80** (atomic rollback · no-URL durable tombstone+metadata · pull-ordering · TTL prune · _toSharePoint metadata · leader poll-push · tombstone inertness) + 7 saboteur mutations.
- Regression: existing 73 sentinels still **73/73** after the rework (incl. S-08 delete reversal, S-65 tombstone egress).
- Results: `WAVE-I-HARNESS-RESULTS.md` (filled after the runs).

## Risk notes for auditors
- Most delicate change in the project (live sync engine). Both auditors design-reviewed it before code.
- `removeTransaction` (non-durable, used only by the S-08 test + dead sync-v2.js) got the same atomic pattern for consistency; the real path is `removeTransactionDurable`.
- Tombstone inertness relies on `Txn.classify('deleted') → direction:'none'` (index.html:961) — S-80 pins it.
- Server-side idempotency remains the Azure backlog (`SERVER-SIDE-REQUIREMENTS.md`); this wave is client-side correctness.

## Code re-audit (2026-06-15) — both PASS, one convergent finding fixed
- **Gemini: PASS** (ready for commit). **GPT: PASS-with-one-finding.** Both flagged the SAME thing (convergence): the NON-durable `removeTransaction` didn't roll back its cache on a failed background write — a cache/disk tear (cache: deleted+tombstoned; disk: unchanged), introduced when Wave I made it write an optimistic tombstone. Not a live-path blocker (the UI + pull use `removeTransactionDurable`), but a parity gap.
- **Fixed:** `removeTransaction`'s background `_retryWrite` now rolls the cache back on failure (restore original, drop tombstone, rebuild stock) — parity with the durable path. **S-81** added (waits out the ~3.5s retry cycle, asserts the async rollback). GPT's runtime probes independently confirmed the rest solid (no-URL durable delete, forced-failure rollback, no-op cursor advance, strict ack on processedCount:0).
- Harness now **81 sentinels / 81 mutations**.

## Sign-off checklist
- [x] GPT + Gemini DESIGN review (pre-code) → SOUND / sound-with-changes → all refinements in
- [x] GPT + Gemini CODE re-audit → both PASS; one convergent parity finding fixed (S-81)
- [x] Full 81-mutation saboteur sweep → 81 CAUGHT / 0 BLIND / 0 SKIPPED (S-74 find-collision from the S-81 fix caught by the sweep + fixed; see harness doc)
- [x] Kunal authorised commit ("fix everything and after that commit")
