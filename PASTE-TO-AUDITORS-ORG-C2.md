# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R4

> ## ROUND 4 — re-review after the round-3 folds
> Round-3 verdicts: one reviewer PASS, one BLOCK×5 — all 5 ground-truthed REAL against the frozen
> engine and client code, all folded (the design doc's **R3 fold record table** has finding →
> ground truth → fold; convergence requires BOTH reviewers to pass the SAME revision, so this
> round goes to both). The R2 transient-export adjudication was independently ACCEPTED by both
> reviewers and is closed. Headline changes this round: (1) ONE CANONICAL HEAD SHAPE
> `{controlId, revision, bornPublicationVersion}` everywhere — the adopted-head `born` field name
> would have tripped the frozen engine's exact comparison (:519) and bricked every adopted
> tombstone (§5b/§7b); (2) STAGED VISIBILITY for device tombstones — inserted
> `ControlState='pending'` (excluded from device pulls and fail-closed for exports), flipped
> visible only AFTER the registry commit CAS; a tombstone that loses a race against a correction
> is quarantined while still invisible, so peer devices can never durably delete an original that
> a correction was protecting (§8 v3, N7/N13; the check-to-insert race and the
> durable-row/no-registry crash are both closed by scrub rules); (3) ADOPTION DELTA BY
> SNAPSHOT-REPRESENTATION — zero-delta adoption was arithmetically wrong for archived targets
> whose effect is baked into snapshot balances; decided via a NEW archive-run input-horizon marker
> (N10), recorded once as `TargetInSnapshot` on the registry item, consulted by all later chain
> cells (§5b, §4, §5 P4 qualifier); (4) the SEAL-EPOCH ARTIFACT (N16) — the previously-undefined
> C1 epoch boundary is now a concrete immutable config item with an `EPOCH_UNDEFINED` fail-closed
> lane (§5 P3.2); (5) EMPTY HEAD-SET publications are unreachable — zero-eligible adopt is a
> terminal no-op before any write; an empty-CandidateHeads journal is invalid by construction
> (§5b/§6); plus two note folds: §7b(4) blocker rescoped so an adjudicated target's stale headless
> rows never block forever, and the §3 staleness-exit invariant is an N10 build acceptance item.
> This round: re-review the revised design end-to-end and answer the NEW questions Q1v4-Q6v4 (§14)
> — the staged-visibility interleavings and the adoption-delta chains especially.

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
   honest notes H1-H10, the R1+R2+R3 fold records, and questions Q1v4-Q6v4).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v4-Q6v4 explicitly. If a decision contradicts a frozen SR
pin, cite the pin. Useful grounding for this round's folds: `sync.js` pull tombstone application
(~:2030-2110), `azure-functions/src/functions/snapshotCompute.js` (:79-93 tombstone exclusion).

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
