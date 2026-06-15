# Wave H — Harness Results (2026-06-14)

## Regression (existing sentinels after the 6 fixes)
- **64/64** pre-Wave-H sentinels still PASS — zero behaviour regressions from H1–H6.

## Smoke (clean code, with 6 new sentinels)
- **70/70 sentinels CLEAN-PASS.** New ones with their discriminating values:
  - S-65 (H1 tombstone egress): a queued `type:'deleted'` row with `targetTransactionId` IS in the push payload; a malformed one (no target) excluded.
  - S-66 (H2 master-data durability): forced persist failure → `bob_catalogue_version` held at 1 (bug: advanced to 9).
  - S-67 (H3 false-Synced): markSynced→false → status "Saving sync state… will retry", pending=true (bug: "Synced ✓" + pending cleared).
  - S-68 (H4 backup detach): bad category id rejected + dangling `catId` rejected + clean backup accepted.
  - S-69 (H5 over-receipt): receive 12-of-10 rejected; short receipt 8-of-10 accepted.
  - S-70 (H5 atomicity): forced mid-batch write failure → `resolveAllFlags` returns false, zero committed rows, transfer rolled back to `received` (in-memory snapshot restore).

## Saboteur mutations (each fix reverted in isolation)
```
S-65  egress drops all tombstones        -> CAUGHT
S-66  fire-and-forget commit + version    -> CAUGHT
S-67  show "Synced ✓" on markSynced-fail  -> CAUGHT
S-68  id-charset check products+stores only-> CAUGHT
S-69  receive accepts over-receipt        -> CAUGHT
S-70  resolveAllFlags drops snapshot       -> CAUGHT (after fix; see below)
==== 6 CAUGHT, 0 BLIND ====   (baseline 70/70 green both runs)
```

## Self-caught blind-sentinel correction (the saboteur did its job again)
S-70's first cut called `DB.refresh()` before asserting — which reloads the (already-correct) durable state from Dexie and masked the in-memory snapshot rollback the fix actually controls. Saboteur flagged it **BLIND**. Removed the refresh so the assertion observes the in-memory cache the snapshot restores (db.js:736). Re-run: **CAUGHT**.

## Harness totals after Wave H
- **70 sentinels / 70 mutations** (S-01..S-70). Smoke 70/70; targeted saboteur S-65..S-70 = 6 CAUGHT / 0 BLIND.
- Logs: `audit-artifacts/WAVE-H-*.log`.

## Follow-up round 1 (2026-06-14) — GPT BLOCK P2 (H2 cache-rollback sibling)
GPT ran the harness (70/70, 6 CAUGHT/0 BLIND) + runtime probes (H1–H6 all pass) and found an incomplete sweep of my own H2: `_applyMasterData` mutated the live cache before `commitDurable()` and didn't roll it back on failure → a cache-only product/price could orphan a later-saved transaction. Fixed (snapshot + restore the 4 catalogue collections on failure). New sentinel **S-71** + mutation.
- Re-run: **baseline 71/71 green; S-66 (version held) + S-71 (cache rolled back) both CAUGHT, 0 BLIND.**

## Harness totals after follow-up 1
- **71 sentinels / 71 mutations** (S-01..S-71).

## Follow-up round 2 (2026-06-15) — Gemini BLOCK (fatal-gate hardening + reference-drift)
Gemini BLOCK (2 P2; H1–H6 all PASS). Both adopted:
- **Fatal-save overlay Dismiss → Reload App** (index.html) — the durable-failure gate is now a true hard stop. **S-72.**
- **Master-data rollback made IN-PLACE** (sync.js) — restores each row's fields + drops inserted rows, so a captured product reference isn't left mutated (Gemini reference-drift). **S-71 upgraded** (captures a live ref, asserts it's restored).
- **Master-data fatal message** — Gemini's "no fatal shown" was a FALSE POSITIVE: `_retryWrite` (db.js:185, used by commitDurable) already trips a generic fatal on any exhausted durable write. Added a catalogue-specific message (matching the per-call-site pattern). **S-73** asserts the specific message text (the generic gate is over-determined → first cut was BLIND; rewritten to assert the catalogue-specific wording).
- Re-run: **baseline 73/73 green; S-71 + S-72 + S-73 all CAUGHT, 0 BLIND.**

## Harness totals after follow-up 2
- **73 sentinels / 73 mutations** (S-01..S-73). S-73 self-caught BLIND (over-determined by _retryWrite) → rewritten to the specific-message assertion → CAUGHT.

## Outstanding before commit
- Full 70-mutation saboteur sweep (pre-commit gate; the targeted runs covered the 6 new + the 64 regression-passed) — run as overnight gate.
- Gemini + GPT audit of Wave H (run it, don't just read).
- Kunal authorises commit.
