# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 12 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 12.** R11: 6 distinct findings (3 converged pairs), folded as
**W4-SR-125..130**. Codex PASSED W4.3; AGY's single W4.3 finding (future-field projection) aligned with
Codex's own PASS-note and is folded — **W4.3 is the prime freeze candidate this round.** One ground-truth
note: AGY's "late-syncing pre-Chunk-4 device" scenario is impossible as stated (Chunk-5 device auth rejects
pre-Chunk-4 builds outright), but the underlying epoch-provenance gap was real (Codex's archived-SourceId
variant) and the backup-resurrection corner is folded fail-closed.

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
The finding stream is now: R6=13, R7=21, R8=15, R9=7, R10=8, R11=6, with every R11 item a refinement of an
R9/R10 mechanism. If a part is done, PASS it.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` · `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` ·
`AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6. History: frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md`.

## What R11 changed
- **W4.1 (SR-125/126):** FENCING GENERATIONS — journal creation, finalization, and every mutating step are
  conditional on the unexpired claim + matching generation; scrub/release advances the generation (a
  stalled-then-resumed worker fails its next conditional write, including creating its own journal).
  `blocked_manual` gains its pinned exit: a Director-authorized RESUME → `needs_replan`; the stray
  "reconcile finds pending only" W2 paragraph is fixed.
- **W4.2 (SR-127):** the R10 global settled rule is SCOPED — settled = no active claims intersecting the
  DEVICE'S resolvable key set (its stores/offices + global). Safety proof unchanged (irrelevant claims
  can't move relevant boundaries); one stuck franchisee can no longer freeze the fleet's horizons.
- **W4.3 (SR-128):** the v4 canonicalizer performs STRICT SCHEMA PROJECTION (unknown future keys stripped
  for divergence hashing) + the pinned obligation: every future schema change = a NEW immutable
  canonical-form version + fixture extension, never a mutation of the W4 form.
- **W4.4 (SR-129/130):** epoch provenance = live item ID / archived `SourceId` (never the archive item's
  own id); absent ⇒ refuse; backup-resurrection corner fail-closed + surfaced with pinned remedies.
  Replacements MUST carry both-or-neither stamps captured AT APPROVAL via the full valuation precedence
  (unstamped replacement = malformed); original-event metadata = validated UTC INSTANT.

## Attack per part (fresh surface only)
- **W4.1:** the fencing-generation lifecycle (generation advanced per-release — is the granularity per
  claim-set or per registry? can a replan under held claims accidentally straddle a generation bump?);
  RESUME authorization (who can invoke it, and is it sudo-bound like other Director privileged ops?).
- **W4.2:** the scoped-settled key intersection (is "the device's resolvable key set" derivable
  server-side from its credential at echo time — offices included? does a multi-store franchisee device
  compute the same set the server does?).
- **W4.3:** the strict projection vs the both-or-neither invariant (can stripping a future field ever break
  a validation the W4 device still runs?). If nothing bites, PASS it.
- **W4.4:** replacement stamps captured at approval — the approval happens AFTER buy-back on live data
  (does the approving device have the target's transfer steps to run the precedence? what if the target is
  archived?); SourceId trust (is the preserved SourceId validated at archive-write so a forged control
  can't smuggle an epoch downgrade?).

## Verdict
Four verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete scenarios.
Claude ground-truths and folds; parts BOTH auditors PASS freeze.
