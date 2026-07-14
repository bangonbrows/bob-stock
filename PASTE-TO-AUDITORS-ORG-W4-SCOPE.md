# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 14 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 14 — TWO parts only.** ✅ **W4.3 STAMPS and W4.2 LENS are FROZEN**
(both of you passed each; specs locked, out of scope). R13's three findings — all converged or Codex-deep,
all REAL — folded as **W4-SR-136..138**.

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
Scoreboard: W4.2 + W4.3 frozen · W4.1 = one converged finding folded (episode binding) · W4.4 = two folded
(correction publication protocol + approval-time uniqueness). The remaining surface is the R13 folds
themselves. If a part is done, PASS it.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§6.
(Frozen, reference only: W4.2-LENS / W4.3-STAMPS docs. History: the frozen ledger.)

## What R13 changed
- **W4.1 (SR-136):** RESUME binds to `(changeId, blockEpisode)` — a monotonic counter incremented on every
  entry into `blocked_manual`; sudo proof, digest, conditional transition, and idempotency result all bind
  to the pair (a second legitimate resume is a new operation; a delayed first-episode request can never
  resume a later episode). Your converged finding, folded exactly as proposed.
- **W4.4 (SR-137):** the correction publication protocol is now realizable — `correction_active(heartbeat,
  journalId)` CAS state on the shared coordination record, mutually exclusive with runs/exports;
  candidate → verify (validity/delta/neutrality/SourceId/hashes) → publish-LAST → terminal → release;
  crashed corrections reconciled terminal before runs/exports resume (Chunk-8 publish-nothing discipline).
- **W4.4 (SR-138):** approval-time uniqueness — under `correction_active`, both control lists are queried
  by target identity; covered targets and control-row targets are REJECTED (one control per original
  target, server-side, race-safe); the engine's ambiguity rule demotes to a corruption detector.

## Attack per part (fresh surface only)
- **W4.1:** the blockEpisode counter's durability (does it survive a needs_replan→blocked cycle across
  reconcile workers? can two workers racing a block-entry mint the same episode?); anything else — if the
  part is done, PASS it.
- **W4.4:** correction_active vs the export lease fairness rules (can a correction starve settlements or
  vice versa — do the SR-108/116 request flags cover the third state?); the verify step's neutrality
  check for a replacement that legitimately CHANGES a balance (corrections aren't neutral by design —
  what exactly does "neutrality" assert here?); reconcile rollback of a published-candidate edge.

## Verdict
Two verdicts (`W4.1 / W4.4: PASS | PASS-with-notes | BLOCK`), numbered findings with concrete scenarios.
Claude ground-truths and folds; parts BOTH auditors PASS freeze — and the W4 scope review CLOSES when all
four are frozen.
