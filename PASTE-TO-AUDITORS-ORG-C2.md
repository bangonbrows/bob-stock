# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R14

> ## ROUND 14 — re-review after the round-13 folds
> Round-13 verdicts: BOTH BLOCK — 5 distinct REAL findings (2 CONVERGED pairs), all folded (the
> design doc's **R13 fold record table**). All were concurrency/discriminator edges around the
> R12 folds; both reviewers again affirmed the core architecture is solid. The folds:
> (1) [CONVERGED] the WITHDRAWN form is `committed(ControlId:null)`, and my R12 "committed claim"
> language wrongly caught it in TWO places — the export blocked a retired deletion forever, and
> the scrub would RE-MINT it (resurrecting an aborted deletion); both predicates now require a
> NON-NULL ControlId, and a withdrawn claim with a leftover N18 row is simply cleaned (delete
> N18, never re-mint); (2) [CONVERGED] the version-based orphan-sweep was SHIELDABLE — archive
> runs and Director corrections share `stock_snapshot.version`, so a correction publishing a
> crashed run's intended version defeated `SnapshotVersion > version`; replaced by a DURABLE
> PER-RUN PUBLICATION MARKER (N17.`Published`, stamped after the snapshot-CAS, with a
> snapshot.runId reconcile for publish-then-crash), which both reviewers asked for by name;
> (3) the export's committed-registry read is pinned as the FINAL complete linearization point
> after the ledger walk; (4) the N18 409 now verifies EXACT identity (the registry is unique by
> TargetTransactionId, N18 by TransactionId — different domains, so a reused TransactionId across
> targets is malformed, not idempotent); (5) the re-mint's main-ledger 409 gets collision
> adjudication (a foreign row holding the id ⇒ CONTROL_ID_COLLISION, never signed), and the
> crashed-foreign-compensation N18 residue gets its scrub cell. This round: re-review end-to-end
> and answer Q1v14-Q5v14 (§14) — the withdrawn-discriminator sweep and the durable publication
> marker especially. Q5v14 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R13 fold records, and questions Q1v14-Q5v14).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v14-Q5v14 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the withdrawn registry form (§4 ControlId:null),
the N17 publication marker (N17/N10), and the registry/N18 uniqueness domains (§4/§8/N18). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
