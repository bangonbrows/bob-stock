# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 10 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 10.** R9's findings converged hard: 7 distinct (4 converged
pairs), ALL REAL, folded as **W4-SR-110..116**. One mechanism correction: AGY's hash-migration "re-hash
validation bricks the fold" mechanism doesn't exist in the code (nothing validates payload against the id
hash) — the REAL failure was Codex's cross-version false divergence; both are closed by the same fold
(SR-113, divergence decided on RECOMPUTED canonical content).

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
Status: AGY has passed W4.1 (R9) and W4.2 (R7, R8); Codex cleared W4.2's restore path explicitly. The R9
folds are narrow — this may be the freezing round for W4.1/W4.2. Fresh eyes, not rubber stamps.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6. History: frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md`.

## What R9 changed
- **W4.1 (SR-110/111):** claims serialize through ONE registry record via CAS/ETag conditional update (the
  realizable primitive — separate conditional creates don't serialize); per-step TARGET-ROW preconditions +
  a `needs_replan` terminal (reconcile replans from fresh state under the SAME held claims — admin writes
  stay free, never blindly overwritten, no forever-failing forward-only step).
- **W4.2 (SR-112, converged AGY+Codex):** boundaries take the DATA STORE's reservation-write timestamp
  (two-phase plan→reserve→finalize); the settled echo's instant derives from the SAME store's registry read
  — no LA execution clock anywhere in the horizon proof.
- **W4.3 (SR-113/114, both converged):** hash versioning — backfill divergence is decided on RECOMPUTED
  canonical content over the snapshots, embedded hashes are dedup-only (old-hash and new-hash steps of
  identical content converge); the valuation middle tier is now a REAL cross-seam contract (see W4.4).
- **W4.4 (SR-114/115/116):** signature gains `steps` (attested RecordSteps for the window's transferIds →
  engine-side item-stamp projection, parity-fixtured against the client fold) and `controls`
  (tombstones/corrections queried BY TARGET IDENTITY, own attestation, window-exempt — closes the
  unsatisfiable-"covered" hole); request flags carry owner+TTL, expired requests bypassed (no
  crashed-requester lockout), symmetric both directions.

## Attack per part (fresh surface only)
- **W4.1:** the claims registry as a single serialization point (contention/liveness; registry record
  growth; a crashed holder's claims — released by which reconcile path, and can `needs_replan` loop
  forever against a persistently changing target row?).
- **W4.2:** the two-phase finalize (is the pure planner's output truly time-shift-invariant — can any
  reject/validation verdict differ between the provisional plan and the finalized one? if yes, which
  verdict governs?); the registry-last-modified echo source under SharePoint timestamp granularity
  (sub-second collisions at the boundary — is `>` vs `>=` pinned correctly?).
- **W4.3:** the recomputed-content divergence rule vs snapshot field evolution (a pre-W4 snapshot and a
  post-W4 snapshot of the same transfer differ by the NEW stamp/basis fields — do they falsely diverge?
  what is canonical content across schema versions?); projection parity when steps are missing/partial
  (backfill-only transfers).
- **W4.4:** `controls` completeness (what attests that ALL controls targeting the supplied identities were
  found?); steps attestation vs the RecordSteps ingest (can a step the client folded locally be absent
  server-side, and what does the projection do?); TTL'd requests under repeated crash-restart churn.

## Verdict
Four verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete scenarios.
Claude ground-truths and folds; parts BOTH auditors PASS freeze.
