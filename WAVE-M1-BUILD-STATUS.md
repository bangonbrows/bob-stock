# WAVE M1 — BUILD STATUS (Group 1: permissions & safety)

**Branch:** `fix/cli-tri-audit-2026-05` · **File touched:** `index.html` (+ harness `test/smoke-test.js`, `test/saboteur-runner.js`) · **Status:** BUILT + self-proven; NOT committed, NOT deployed.

**Audit gate:** spec pre-approved before any code — AGY = APPROVE, GPT = APPROVE-WITH-CHANGES (`audit-artifacts/WAVE-M1-SCOPE.md` + `PASTE-TO-AUDITORS-WAVE-M1.txt`). GPT's refinements all folded in (see notes per fix).

---

## Fixes implemented

| # | Finding | What changed | Where |
|---|---------|--------------|-------|
| 1 | **GPTa-37** delete-movement had no role gate | New cap `deleteMovement` = store_manager & above; gated `_deleteLog` (entry) + `_confirmDelete` (defence-in-depth); Delete button hidden for staff | `Auth._caps`; `_renderTodayMovements`; `_deleteLog`; `_confirmDelete` |
| 1b | Deletion audit trail (Kunal req.) | Auto-stamp verified account `_deletedByUser:Auth.actor()` on every delete (typed name is fakeable); new **Account** column in the director-only Audit Log | `_confirmDelete`; `auditLog()` |
| 2 | **GPTa-36** edit can dup username / kill last Director | `_updateUser`: username-collision check + last-Director demote guard, all BEFORE any mutation (per GPT). `_deleteUser`: last-Director + self-delete guards, before confirm AND in callback | `_updateUser`; `_deleteUser` |
| 3 | **GPTa-42** rejected stock-take approvable | Added `status!=='pending'` guard after the existing approved-check | `_approveStockTake` |
| 4 | **GPTa-43** delete orphans products | Block-if-in-use: `_deletePT` blocked when a category uses it; `_deleteCat` blocked when a product uses it (counts shown in the message) | `_deletePT`; `_deleteCat` |
| 5 | **GPTa-45** multi-store user pinned to 1 store | `hasMultiLoc` now any user with >1 store; `buildLocOptions` branch for non-HO/non-fran multi-store users | `logMovement` |

## GPT change-requests — how each was handled
- **[1b] persist/sync the stamp:** `_deletedByUser` is stamped + durable locally and shown in the Audit Log on the device that performed the delete. Cross-device propagation of the *verified* account needs a server tombstone column → **deferred to the Azure phase** (documented here, not silently dropped). The deletion itself already syncs cross-device today.
- **[2] ordering:** all guards compute `newUsername`/`newRole` and run BEFORE any field assignment — confirmed.
- **[3] legacy status:** verified every stock-take is created with a status (`pending` clean→`clean`, line 2116/2145) and Approve only surfaces for `pending` takes — the strict guard cannot block a valid take.
- **[4] block vs cascade:** block-if-in-use (both auditors preferred this over auto-reassign).

## Post-implementation code review (GPT + AGY) — APPROVED
- **AGY = PASS (APPROVE)** all 6 items; ran the harness locally (139/139, 7/7).
- **GPT = APPROVE-WITH-CHANGES**, 3× P3 (defence-in-depth) — ALL APPLIED:
  - **P3 [4]** repeat the in-use check INSIDE the `_deletePT`/`_deleteCat` confirm callbacks (guards the stale-modal race, not just the click path).
  - **P3 [1b]** stamp `_deletedByUser:Auth.actor()` on the staff **Undo** path too (`_undoMovement`), so Undo audit rows aren't blank.
  - **P3 [2]** `_deleteUser` callback re-fetches the target user and tests its fresh role.

## Harness
- New sentinels **S-143…S-149** (7) → suite now **140 sentinels**, all CLEAN-PASS (`140/140 sentinels PASS on clean code`). S-147 retargeted to the authoritative in-callback re-check via a simulated stale-modal race; S-149 added for the verified-account stamp on both delete paths.
- New saboteur mutations (9): S-143, S-144, S-145, S-146, S-147, S-147b, S-148, S-149, S-149b.
- Targeted saboteur sweep result: **9 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA-FAIL of 9** (S-143…S-149 + S-147b + S-149b). Full-suite (140) sweep still owed pre-commit.
- Duplicate-def sweep on every edited method: clean (single definition each; `_undoMovement` confirmed single def before editing).

## Out of scope (later waves, agreed)
- Group 2 (money: GPTa-41, GPTa-38, GPTa-24) → Wave M2.
- Group 3 (backup/resilience: GPT-9/10, Ca-M17, GPT-5b/5c, GPT-18) → M2/M3.
- Server-side trio (W5, GCLI-2, Ca-M15) → Azure phase.

## Next
Targeted saboteur PASS → wave review pack to GPT + AGY (code review of the diff) → Kunal authorises → commit. No deploy without explicit OK + the milestone audit.
