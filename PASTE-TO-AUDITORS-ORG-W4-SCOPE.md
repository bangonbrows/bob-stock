# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 25 (paper review) — Codex + AGY

**You are re-verdicting ONE delta: W4-SR-171.** R24 split (one PASS, one BLOCK on the planted residual);
the BLOCK was adjudicated CORRECT: a mid-export rejection escaped rows, badVersionEvidence, AND drain
simultaneously (written-only logging), and FINAL's permanence means a later Director re-attestation would
legitimize the quarantined row into a closed settlement — irrevocable loss to the store owner.
"No window economics NOW" was true but insufficient. Everything else is settled.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` — P5(c) (presented-identities drain) + the R24 fold record ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (the grace-record consumption line). Nothing else changed.

## The delta (SR-171)
Grace records log the FULL PRESENTED row manifest at consumption (the same binding moment and pattern as
the SR-122 expected stepIds — the device knows its flush set). The engine asserts every presented identity
reached an ACCOUNTED state in its attested inputs: PRESENT in rows | COVERED by an active control head |
QUEUED in badVersionEvidence (where SR-170 then holds FINAL until cleared). None of the three ⇒ refuse
FINAL. The mid-export escape is closed: a rejected row is presented-but-unaccounted until its queue entry
is enumerated, holding the settlement PROVISIONAL exactly as long as the loss risk exists.

## Final check
- The manifest is CLIENT-declared at consumption — a hostile device could OMIT an identity it intends to
  push (present-but-not-presented). Confirm that direction is harmless: an unpresented-but-present row is
  in `rows` and valued normally (or rejected into the queue and caught by SR-170's next enumeration); the
  manifest guards OMISSION FROM THE SETTLEMENT, not admission. State agreement or a counterexample.
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One line each: `W4.4: PASS | BLOCK (+ findings)`. When BOTH of you PASS, W4.4 freezes, all four parts are
locked, and the W4 scope review CLOSES — the build begins.
