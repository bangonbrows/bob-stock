# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 23 (paper review) — Codex + AGY

**You are reviewing: the W4.4 verdict + AGY's re-OK on W4.3 amendment 1.** R22 status: ✅ **amendment 2 is
CLOSED** (approved by both). Codex approved amendment 1 ("internally consistent"). The converged queue
dual-write finding is folded as **SR-168** (coverage = derived view). AGY's malformed-fallback demand was
**adjudicated NOT REAL** (SR-169), adopting Codex's clearing analysis: the ingest boundary rejects partial
tuples, so a malformed row in the engine's input proves the boundary was bypassed — fail-closed is the
corruption detector, and falling through would mask the compromise; the legitimate item-tier fallback
(SR-97) applies only to WHOLLY-ABSENT row evidence. AGY: please re-verdict amendment 1 against that
rationale (the pin is in W4.4 P6 + the fold record).

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` (P6: the SR-168 queue block + the SR-169 malformed pin + the R22
fold record) · `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 · `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` status block.
(Frozen otherwise: W4.1/W4.2/W4.3.)

## What R22 changed
- **SR-168 (your converged catch):** BAD_VERSION coverage is a DERIVED VIEW over the active control-head
  manifest — no control operation ever writes the queue (the dual-write is eliminated structurally, not
  patched): rollback cannot falsely clear; WITHDRAW auto-reopens; SUPERSEDE re-evaluates; no lock ordering
  exists. Stored terminals only from single-registry ops (re-attestation mints; `rejected` requires a
  durable accounted/excluded state). Durable ingest-written entries keep the work item crash-safe.
- **SR-169:** malformed basis×authority rows STOP (fail closed) — pinned with the layered-guard rationale;
  no behaviour change.

## Attack surface (final checks)
- SR-168's derived view at EXPORT time: the engine evaluates coverage against the active manifest it
  already receives (SR-151 heads) — confirm the evaluation needs NO extra input and composes with the
  PROVISIONAL/FINAL rules when a control head changes between two export runs.
- The re-attestation terminal vs a LATER control on the same row (re-attested THEN tombstoned — both a
  stored terminal and a view coverage exist; confirm precedence is irrelevant because both unblock).
- Anything else — if it's done, PASS it and the scope review closes.

## Verdict
One W4.4 verdict (`PASS | PASS-with-notes | BLOCK`) from each auditor + AGY's OK/objection on amendment 1.
When BOTH of you PASS all open items, W4.4 freezes and the W4 scope review CLOSES.
