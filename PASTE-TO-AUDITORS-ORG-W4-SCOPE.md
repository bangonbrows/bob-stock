# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 13 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 13 — THREE parts only.** ✅ **W4.3 STAMPS is FROZEN** (both of you
passed it at R12); its spec is locked and out of this round. R12's remaining findings folded as
**W4-SR-131..135**. One ground-truth correction: AGY's W4.2 finding (retail devices miss office claims)
was NOT REAL — it rests on the pre-R4 model; since R4, resolution is strictly per-store and the office
fan-out's claim set INCLUDES every retail key, so the intersection check catches exactly that case (Codex
independently passed W4.2 on the Chunk-10 credential derivation). The key-set definition is now pinned in
W4.2 P4 so it cannot be re-litigated.

Both auditors in parallel; paper review; report-only; verdict PER PART — parts BOTH of you PASS freeze.
Scoreboard: W4.3 frozen · W4.2 = Codex PASS twice running, AGY's last finding refuted · W4.1/W4.4 down to
narrow mechanics. If a part is done, PASS it.

## Read (branch `azure-phase-5-8-server`)
`AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` · `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` ·
`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` · `AZURE-CHUNK-ORG-LA-CHANGES.md` §1/§2/§6.
(Frozen: `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` — reference only. History: the frozen ledger.)

## What R12 changed
- **W4.1 (SR-131/132):** fencing reworked to immutable PER-CLAIM-SET LEASE IDs from a durable monotonic
  registry counter (survives deletion, never reused; unrelated releases can't fence a healthy plan — the
  R11 "advance the generation" wording is superseded). RESUME is a first-class intent on the
  topology-change route: Director key + topology-change sudo + changeId/digest-bound idempotency +
  conditional blocked_manual→needs_replan.
- **W4.2 (SR-133):** no behaviour change — the resolvable-key-set definition is PINNED (credential StoreIds
  per Chunk-10 + global; office keys only for credentials that bill office rows; fan-out claims cover the
  retail keys).
- **W4.4 (SR-134/135):** replacement approval = a Director-sudo-gated SERVER operation (fetches the
  authoritative target + complete steps with enumeration proof, runs the canonical precedence server-side,
  mints the stamps — client values never authoritative). Archived-target replacements are written INTO the
  archive list under the archive lease with the atomic snapshot adjustment (the CHUNK8 item-5 correction
  arm, now actually defined) — the cross-list rule stays a pure corruption detector.

## Attack per part (fresh surface only)
- **W4.1:** the lease-id counter as a hot cell (every reservation CASes one record — contention with the
  settled-echo reads?); RESUME idempotency digest vs a LEGITIMATE second resume after a second block on the
  same journal (same changeId, different block episode — does the digest distinguish?).
- **W4.2:** anything the SR-133 pin still leaves open — otherwise PASS it.
- **W4.4:** the correction-approval op's snapshot adjustment vs a CONCURRENT archive run (lease covers the
  write, but does the snapshot adjustment compose with Chunk-8's publish-nothing verification?); the
  approval op targeting a row that is itself already covered by an earlier control (chain prevention at
  approval time vs engine-side ambiguity fail-close).

## Verdict
Three verdicts (`W4.x: PASS | PASS-with-notes | BLOCK`), numbered findings per part with concrete
scenarios. Claude ground-truths and folds; parts BOTH auditors PASS freeze.
