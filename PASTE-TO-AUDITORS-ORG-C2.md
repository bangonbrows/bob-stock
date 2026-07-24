# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R9

> ## ROUND 9 — re-review after the round-8 folds
> Round-8 verdicts: one reviewer PASS (second consecutive explicit all-clear on the closure
> gate) · one reviewer BLOCK×4, ALL REAL, all folded (the design doc's **R8 fold record
> table**). Both must pass the same revision, so this round goes to both. The R8 folds:
> (1) `deviceRestorationPending` + `affectedTarget` now live IN the normative response contract —
> on retirement success, in the journal's stored result, and on terminal-opId replay, so the
> Director warning survives lost responses; (2) the §8 own-claim dispatch gains the
> OWN-PENDING_SUPERSEDE branch — a lost-ack device retry arriving while a Director
> withdraw/supersede is in flight answers by READ (`ok`, already-applied; never inserts,
> quarantines, or heal-MERGEs mid-Director-op; correct under both the Director op's rollback and
> roll-forward); (3) the archive-run authority gate is now the SAME explicit allowlist as N13
> (unknown/future ControlState values refuse + surface instead of falling through to D8-7); and
> (4) the scalar INPUT-HORIZON marker is REPLACED by the INPUT TOMBSTONE-SET RECORD — each run
> persists the exact set of tombstone live-coordinate ids its input actually contained, and the
> adoption/retirement membership test is set-membership, not an id comparison (a scalar max
> cannot prove prefix completeness under SharePoint's out-of-order ID visibility, which the
> client code itself records at sync.js:1837). This round: re-review end-to-end and answer
> Q1v9-Q5v9 (§14) — the own-claim state-space cover and the membership record's authority
> especially. Q5v9 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R8 fold records, and questions Q1v9-Q5v9).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v9-Q5v9 explicitly. If a decision contradicts a frozen SR
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
