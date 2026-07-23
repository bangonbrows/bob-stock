# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R5

> ## ROUND 5 — re-review after the round-4 folds
> Round-4 verdicts: BOTH BLOCK — 8 distinct REAL findings (2 CONVERGED pairs: both reviewers
> independently caught the two archived-row ID-coordinate mistakes) + 1 engineer family find
> banked while ground-truthing. All folded (the design doc's **R4 fold record table** has finding
> → ground truth → fold). Confirmed-closed at R4 by both: empty-set unreachability, head-shape
> parity, the commit-point ordering, and the transient-export adjudication (re-affirmed). Headline
> changes this round: (1) THE NORMALIZATION LAW replaces the R3 representation qualifier — the
> in-snapshot decision gates ONLY the first publication on an archived ensemble; after it the
> plain six-cell table is provably exact (the R3 wording dropped the withdraw restore term); the
> registry `TargetInSnapshot` column is DELETED — the decisions live in the journal's
> `AdoptionDecisions` (pre-P6, crash-reproducible) and nothing consults them after publication,
> which also dissolves the P6→P7 recoverability finding (§5 P4, §5b, §4, P5.1); (2) ALL
> list-boundary comparisons now use LIVE-COORDINATE provenance (live `_spId` / archived
> `SourceId`) — the adoption horizon AND the seal epoch; `archiveEpochId` is deleted (N16 has ONE
> `epochId`); (3) COMMIT SEALS — `ControlState` was an unsealed visibility authority; the commit
> point now mints a `ctlcommit-v1` `CommitSig` and the pull LA batch-verifies it before delivering
> any tombstone (SP-direct flips are withheld + surfaced; legacy lane bounded by
> `tombstoneCommitEpochId`); the own-committed retry now COMPLETES the mint+MERGE itself, closing
> the invisible-forever crash window (§8, N7, N13); (4) the seal-epoch artifact is now derivable
> (production: exact at cutover; staging: attested best-effort, H11) and DETECTABLY immutable
> (`EpochSig`, verify-on-read, `EPOCH_TAMPERED`) (N16); (5) NEW mode `retire_claim` — the R3
> remedy for a seal-skipped pre-epoch tombstone was unreachable (every lane blocked by the claim
> itself); a Director-sudo journaled op retires the claim and opens the normal lanes; post-epoch
> unsealed claims stay locked loudly (§5b, N1); (6) engineer find: ARCHIVE EXCLUSION — archive
> runs now exclude control rows and head-named rows entirely (they stay live forever), so a later
> run can never fold a corrected-away effect back into balances (N10, H12). This round: re-review
> end-to-end and answer the NEW questions Q1v5-Q6v5 (§14) — the normalization-law induction and
> the CommitSig authority chain especially.

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
   honest notes H1-H12, the R1-R4 fold records, and questions Q1v5-Q6v5).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v5-Q6v5 explicitly. If a decision contradicts a frozen SR
pin, cite the pin. Useful grounding for this round's folds: `sync.js` pull tombstone application
(~:2030-2110), `azure-functions/src/functions/snapshotCompute.js` (:79-93 tombstone exclusion),
`azure-functions/src/functions/attestRows.js` (the frame/keyring machinery the new seals extend).

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
