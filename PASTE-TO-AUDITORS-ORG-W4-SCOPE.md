# AUDIT PACK — Org-Structure chunk, W4 SCOPE REVIEW ROUND 7 (paper review, PER-PART) — Codex + AGY

**You are reviewing the OS-W4 spec, round 7 — now SPLIT.** Your R6 verdicts (AGY BLOCK×3 + Codex BLOCK×13,
three converged pairs) were all ground-truthed REAL and folded as **W4-SR-63..75**; per the R5 pin, R6's
design-level divergence split the spec into FOUR CONSOLIDATED sub-wave docs. The old scope doc is now a
frozen fold ledger (history only). Both auditors in parallel; paper review; report-only.

## Ground rules for R7
- **Verdict PER PART** (four verdicts, not one): a part that PASSES is FROZEN and leaves the loop; only
  diverging parts iterate in R8.
- Each sub-doc is self-contained CURRENT truth (no fold archaeology needed) and carries its SR numbers for
  traceability back to the ledger.
- On any contradiction between a sub-doc, the ledger, or LA-CHANGES: the SUB-DOC governs — but the
  contradiction itself is a FINDING (that's how the last two rounds caught real bugs).

## Read (branch `azure-phase-5-8-server`)
| Part | Doc | Also read |
|---|---|---|
| **W4.1 planner** | `AZURE-CHUNK-ORG-W4.1-PLANNER-SCOPE.md` | `topology.js` (the real engine), LA-CHANGES §1 |
| **W4.2 lens/invoice/adoption** | `AZURE-CHUNK-ORG-W4.2-LENS-SCOPE.md` | LA-CHANGES §6 (route/echo/seed) |
| **W4.3 stamps/transport** | `AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md` | phase2.js/records.js/sync.js cited lines |
| **W4.4 export engine** | `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` | LA-CHANGES §3+§6, AZURE-CHUNK8-SCOPE.md items 3/5/7/8 |
| (shared) | `AZURE-CHUNK-ORG-LA-CHANGES.md` §1 + §6 | fold ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` for history |

## What R6 changed (headline)
- **SR-64 fence:** topology and pricing writes share ONE publication version — topology CASes it (abort +
  re-plan on advance); pricing writes 409 while a targeted franchisee has a pending topology change.
- **SR-65 seed:** one '*' interval PER FRANCHISE ERA per store (required by `pricingAlignsWithEras`), all at
  the frozen-legacy value; **SR-63:** legacy 0-discount = inherit, never seeded as 0%.
- **SR-67 basis:** one transfer item = ONE durable pricing basis (submit-stamped | receive-stamped |
  legacy-lens); all top-ups/returns/corrections inherit it (SR-19 amended). **SR-66:** receive-conflict
  identity now includes the money stamps.
- **SR-68/75 archive stability:** scalar version-compare deleted → export refuses during a run + takes a
  bounded priority lease. **SR-69:** drain = grace-record terminal states (issued→consumed→committed).
  **SR-70:** cross-list tombstones = fail-closed conflict (aligns with Chunk-8 item 5).
- **SR-71/72 planner guards:** OFFICE_STORE_OP_FORBIDDEN; officeStoreId ≠ storeId + full cross-namespace
  uniqueness.
- **SR-73 money:** one canonical policy (number-typed, ≤1,000,000, ≤2dp) — the badMoney divergence is
  flagged out-of-scope. **SR-74 stale:** per-tier rule replaced by the `lastConfirmedCurrentAt` horizon
  (grounded on the pinned effective-now append invariant).

## Attack per part
- **W4.1:** break an existing W2 invariant with `state.office` present; find an op/state combination where
  the office guards or the POS exemption misfire; attack the CAS-carry (can a plan apply against pricing
  state newer than it read?).
- **W4.2:** attack the SR-74 horizon (find a resolution it wrongly admits — e.g. can any legitimate writer
  violate effective-now? what advances `lastConfirmedCurrentAt` and can it advance falsely?); the dormant
  gate's bounded age; pricingVersion coherence across master_data vs config pulls.
- **W4.3:** find a `transfer_in`-creating or stamp-carrying path outside the basis/conflict rules
  (cancellations, backfills, cross-generation resolves); attack stamp-at-receive determinism and its
  interaction with receive conflicts; the money-policy fixture gaps.
- **W4.4:** attack the lease/run protocol (crashed archiver mid-run, lease expiry mid-query, reconcile
  interplay); the grace-record lifecycle (can `committed` be set without the rows being visible to the
  query?); classification parity; any Chunk-8 contradiction we still missed.

## Verdict
Four verdicts: `W4.1: PASS|PASS-with-notes|BLOCK` (etc.), numbered findings per part with concrete
scenarios (state + sequence → wrong money, wrong coverage, or a spec contradiction). Claude ground-truths
and folds; parts that PASS freeze.
