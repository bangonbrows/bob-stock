# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R10

> ## ROUND 10 — re-review after the round-9 folds
> Round-9 verdicts: one reviewer PASS (THIRD consecutive explicit all-clear on the closure gate)
> · one reviewer BLOCK×4, ALL REAL, all folded (the design doc's **R9 fold record table**). Both
> must pass the same revision, so this round goes to both. The R9 folds: (1) the tombstone-set
> record gets its DURABLE ARTIFACT — N17 `archive_run_record` (one sealed AppConfig item per
> run: immutable RunId key, TombstoneIds built from the EXACT snapshotCompute input array,
> `runrec-v1` seal verified on read, record-durable-BEFORE-publish ordering, [] a valid empty
> set vs absent = UNDECIDABLE — closing the storage/authority gap); (2) the one uncovered
> own-claim cell is pinned: committed × ledger-row-absent ⇒ `CONTROL_ROW_MISSING`, fail-closed
> terminal + surfaced, NEVER reconstructed, with a retire_claim ABSENT-ROW EVIDENCE lane as the
> Director remedy (and a matching reconcile anomaly sweep); (3) own-identity RETENTION through
> `pending_supersede` is pinned (top-level OpId/ControlId keep the prior committed identity;
> the own matcher also checks PriorCommitted as a belt) — the R8 branch is now provably
> reachable; (4) the divergence warning is GENERALIZED: `deviceConvergencePending` +
> `affectedTarget` ride EVERY mode whose effective result devices cannot reconstruct
> (retirement, withdraw/supersede of adopted deletions, all Director corrections), stored +
> replayed + set by recovering workers; ADOPT alone is exempt with pinned reasoning (the
> tombstone was already device-applied — no NEW divergence). This round: re-review end-to-end
> and answer Q1v10-Q5v10 (§14) — the N17 crash splits and the convergence-warning family
> especially. Q5v10 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R9 fold records, and questions Q1v10-Q5v10).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v10-Q5v10 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. Useful grounding for this round's folds: `sync.js` pull tombstone application
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
