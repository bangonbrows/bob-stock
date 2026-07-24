# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R15

> ## ROUND 15 — re-review after the round-14 folds
> Round-14 verdicts: BOTH BLOCK — 8 distinct REAL findings (1 CONVERGED pair), all folded (the
> design doc's **R14 fold record table**). One reviewer ESCALATED the withdrawn-discriminator
> question to PASS (closed by both). Most findings were completions of the R13 folds themselves +
> two stale-rule deletions; both reviewers again affirm the N18 protocol + coordination
> architecture is rock solid. The folds: (1) [CONVERGED] the orphan-sweep would have deleted ALL
> pre-Contract-2 legacy archive history (N17 is new, so legacy runs have absent records) — fixed
> with a VERSION FLOOR (`SnapshotVersion >= published version AND N17 not-Published/absent`):
> legacy rows sit below the published version and are spared, residue sits at/above it and is
> caught; (2) an obsolete R2 rule that quarantined "a main-ledger tombstone whose registry
> ControlId differs" is DELETED — since R11 losers never reach the main ledger, so that rule now
> only fired on legitimately SUPERSEDED history; (3) N17.`Published` gets a SEPARATE tamper-evident
> `PublishedSig` (a bare SharePoint flip is ignored); (4) the export's committed-registry read
> becomes a DOUBLE-COLLECT-until-stable (a paginated walk can miss an in-place commit on an
> already-passed page); (5) the N18 409 check now requires CANONICAL BYTE-EQUALITY, not just a
> valid seal on the existing row (a mutated resubmission under a reused id is rejected); (6) the
> foreign-409 path releases its own pending claim and the promote cell re-checks N18 target
> identity; (7) the "mint missing CommitSig" auto-sign is DELETED (it contradicted the collision
> adjudication); (8) CONTROL_ID_COLLISION gets a terminal Director-recovery lane (retire_claim
> extended) so a colliding claim can't lock its target forever. This round: re-review end-to-end
> and answer Q1v15-Q5v15 (§14) — the sweep-safety predicate and the stale-rule sweep especially.
> Q5v15 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R14 fold records, and questions Q1v15-Q5v15).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v15-Q5v15 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the N17 sweep/version-floor + PublishedSig
(N17/N10), the deleted R2 main-ledger race-loser rule (§8/§6), and the archive row `SnapshotVersion`
carried since C1 (§1). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
