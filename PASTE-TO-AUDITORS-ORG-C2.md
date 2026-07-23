# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R7

> ## ROUND 7 — re-review after the round-6 folds
> Round-6 verdicts: one reviewer PASS ("ready for implementation"; its one fidelity-hash note was
> REFUTED with evidence — no stored hash field exists, hashes are per-run transient values
> compared before publish/delete; the real adjacent requirement folded via the other reviewer's
> finding 5) · one reviewer BLOCK×5, ALL REAL, all folded (the design doc's **R6 fold record
> table**). Convergence requires both passing the same revision, so this round goes to both.
> The R6 folds: (1) retirement gains a PRE-P6 VISIBILITY WITHDRAWAL (the tombstone row is marked
> `retiring` and excluded from pulls before anything commits — reversible, evidence-preserving)
> AND a P7 HEALING TOUCH (a no-op Modified bump on the restored target row: pulls are
> modified-since cursors, so every device that ever applied the deletion re-receives and
> re-merges the target — closing the P6→P7 crash window AND all pre-existing device divergence);
> (2) the NULL-HEAD lane is now fully normative: two new delta cells (null→replace, null→delete —
> the converged +10→+8 repro is now DERIVED from the table), the explicit-null expected tuple,
> and the registry WITHDRAWN FORM with pending_supersede restore (§4/§5 P4/request contract);
> (3) UNIT-MOVE archival (E1 v3): an ensemble archives as a unit keyed on the TARGET alone
> passing the FULL archive predicate (id + retention); its control/tombstone rows move in the
> same run regardless of their own ids/timestamps (they are never client-covering-relevant) — the
> cutoff clamp is DELETED, which closes BOTH the retainAfterTs pair-split repro and the
> unbounded-retention-under-repeated-supersedes repro; (4) the archive SELECT/copy/re-read/
> fidelity-hash canonical carries the FULL N7 control form (versioned, fails closed BEFORE the
> live delete); (5) the stale R4 permanent-exclusion sentence in §5 P4 is gone. This round:
> re-review end-to-end and answer Q1v7-Q5v7 (§14) — the healing-touch delivery semantics and the
> unit-move consumer sweep especially. Q5v7 is the explicit convergence gate.

**Context.** Routine internal design review for our own stock-management app (Bang on Brows, Perth;
reviewers and engineer all work for the owner). This is a PAPER review of a design document — nothing
is built or deployed yet. You approved and froze the parent behavioural spec
(`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md`, R25) and the Contract-2 summary
(`AZURE-CHUNK-ORG-W44-SERVER-CONTRACTS.md`); this round reviews the CONCRETE physical design that
implements it. Contract 1's equivalent review found 3 real design flaws in a converged parent spec —
the same scrutiny is wanted here.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` — THE document under review (everything is in there:
   deliverables, state machines, order of operations, recovery, pinned parameters, engineer-flagged
   honest notes H1-H13, the R1-R6 fold records, and questions Q1v7-Q5v7).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v7-Q5v7 explicitly. If a decision contradicts a frozen SR
pin, cite the pin. Useful grounding for this round's folds: `sync.js` pull tombstone application
(~:2030-2110), `azure-functions/src/functions/snapshotCompute.js` (the fold rules the control-aware
amendment extends), the client cutoff consumers (index.html ~:1427-1476 skip, db.js ~:721-734
prune), and the frozen engine's withdrawn/null-head semantics (buybackExport.js :515-520, 563-565).

**Verdict format:** PASS / PASS-with-notes / BLOCK, numbered findings with concrete failure sequences
(interleavings welcome). The engineer ground-truths every finding before acting; findings only —
the engineer applies all changes.

## Reviewer session hygiene (read FIRST)
This is ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
Earlier sessions were interrupted by an automated provider content filter reacting to
security-flavoured wording:
1. Name any scripts/notes you make in neutral QA terms (`design-walkthrough.md`,
   `state-machine-check.js`) — never words like unauthorized/exploit/attack in filenames or variables.
2. When quoting repo files, cite `file:line` and summarise in your own neutral words; avoid pasting
   comment blocks wholesale (engineer comments have tripped the filter before — read code
   comment-free where possible).
3. Describe findings in plain engineering terms — "the gate does not hold when X", not
   attack/bypass language.
4. This is a paper review — no processes to run; if you do run anything, only terminate processes
   under your own copy folder.
5. If interrupted, note WHERE you stopped in your report first, so the next session resumes from a
   checkpoint.
