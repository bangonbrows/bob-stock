# Wave G — Harness Results (2026-06-12)

## Smoke suite (clean code)
- **58/58 sentinels CLEAN-PASS** (full run + re-confirmed as the saboteur baseline: "58/58 green on clean code")
- Zero regressions across S-01..S-52 (all pre-Wave-G sentinels)
- New sentinels proved their fixes with exact expected values:
  - S-53: landed=15, storedShipping=100 (bug would be 5 + 0)
  - S-54: threw=true, sourceKept=true (bug: false+false = silent empty app)
  - S-55: staffBlocked=true, directorSees=true (bug: dead route)
  - S-56: leadDays=14 preserved, min=3 saved (bug: leadDays null)
  - S-57: all four draft holders cleared on logout
  - S-58: movements=1, deliveryTxns=1 on double-fire (bug: 2+2)

## Saboteur mutations (targeted: the 6 Wave G fixes reverted one at a time)
```
[CAUGHT] S-53  delivery save stops reading Shipping  -> sentinel RED
[CAUGHT] S-54  migration ignores persist result      -> sentinel RED
[CAUGHT] S-55  login-audit route deregistered        -> sentinel RED
[CAUGHT] S-56  Save All hard-codes leadDays:null     -> sentinel RED
[CAUGHT] S-57  logout stops clearing movement draft  -> sentinel RED
[CAUGHT] S-58  movement double-submit guard removed  -> sentinel RED
==== 6 CAUGHT, 0 BLIND, 0 skipped ====
```
**No blind sentinels.** Every Wave G fix is mutation-proven.

## Harness totals after Wave G
- **58 sentinels / 58 mutations** registered (S-01..S-58)
- Saboteur child-process timeout raised 180s → 360s (58 sentinels no longer fit the old budget)
- S-23/S-34 updated to mock `del-shipping` (was the removed `del-customs`)
- Raw logs: `audit-artifacts/WAVE-G-2026-06-12/`

## Follow-up round (2026-06-14) — auditor BLOCK findings resolved
GPT BLOCK + Gemini PASS-with-findings → 3 fixes (P2 convergence ×2 packaging-allocation; P3 optimum-levels guard; P3 delivery-guard mutation). Re-proof:
- **Smoke: 61/61 CLEAN-PASS** (S-59/S-60/S-61 added). S-60 proves the cost fix: edited landed=$25 (bug=$65), header share stays $10.
- **Targeted saboteur (S-53..S-61): baseline 61/61 green, 9 CAUGHT / 0 BLIND.** All 3 follow-up fixes mutation-proven (incl. the delivery `_delSaving` half GPT flagged as asserted-not-proven).
- Logs: `audit-artifacts/WAVE-G-2026-06-12/wave-g2-smoke.log`, `wave-g2-saboteur.log`

## Harness totals after follow-up
- **61 sentinels / 61 mutations** (S-01..S-61)

## Round 2 follow-up (2026-06-14) — double-tap write-path family + a self-caught blind-sentinel correction
Re-audit (both PASS-with-findings) → guarded 3 more record-creating handlers; investigated + reverted 1 redundant guard.
- Guards added: `_saveDeliveryPackaging` (`_pkgSaving`), `_saveCostEntry` (`_costSaving`), `_submitStockTake` clean-path (`_stCountSubmitting`). Sentinels S-62/S-63/S-64.
- `submitDraft` guard REVERTED — already idempotent via two synchronous status checks; a guard there is unprovable dead code. S-65 removed.
- **Saboteur first flagged S-62/S-63 BLIND** (row-count collided on identical `Date.now()` ids; S-64 passed by timing luck). Rewrote all three to count **commit invocations** (timing-independent). Re-run: **baseline 64/64 green, S-62/S-63/S-64 all CAUGHT, 0 BLIND.**
- Logs: `wave-g3-smoke.log`/`wave-g3-saboteur.log` (blind), `wave-g4-smoke.log`/`wave-g4-saboteur.log` (corrected).

## Harness totals after round 2 follow-up
- **64 sentinels / 64 mutations** (S-01..S-64; no S-65)

## Outstanding before commit
- Full 61-mutation saboteur sweep (the targeted runs covered the 9 Wave G sentinels; S-01..S-52 mutations last fully proven pre-Wave-G — re-run the full sweep as the pre-commit gate, ~3-4h, can run overnight)
- Gemini + GPT RE-AUDIT of the P2/P3 follow-up fixes (GPT was BLOCK → needs a clean pass)
- Kunal authorises commit
