# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 24 (paper review) — Codex + AGY

**You are re-verdicting ONE delta: W4-SR-170.** Everything else is settled: ✅ both W4.3 amendments are
CLOSED (W4.3 fully locked); AGY PASSED W4.4 at R23 ("ready to build"); Codex's single R23 finding — the
final input-completeness pin — is folded. If SR-170 holds, W4.4 freezes and the W4 scope review CLOSES.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` — P1 (the `badVersionEvidence` signature addition), the SR-168
queue block's engine-evaluation sentence, and the R23 fold record. `AZURE-CHUNK-ORG-LA-CHANGES.md` §6
(the route-side supply line). Nothing else changed.

## The delta (SR-170, your catch Codex)
The engine input gains `badVersionEvidence`: the store/window-scoped BAD_VERSION queue records + their
stored-terminal markers, with an ENUMERATION-COMPLETENESS watermark bound to the same lease/settled
horizon (completeness is not derivable from ledger rows — a rejected row never entered the ledger). The
ENGINE evaluates each entry: stored-terminal ⇒ unblocked; view-covered against the already-supplied
control heads ⇒ unblocked; otherwise the engine ITSELF refuses FINAL. This is the same attested-inputs
pattern as `drain`, `steps`, and `controls`.

## Final check
- Does the watermark's binding (lease + settled horizon) close the enumeration race the way the
  run/lease continuity check does for rows — or is there a residual window where an entry created DURING
  the export escapes both the watermark and the row set? (Note: such an entry's row was rejected, so it
  affects no economics in THIS window; state whether that makes the residual safe.)
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One line each: `W4.4: PASS | BLOCK (+ findings)`. When BOTH of you PASS, W4.4 freezes, all four parts are
locked, and the W4 scope review CLOSES — the build begins.
