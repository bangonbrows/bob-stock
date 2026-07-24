# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R11

> ## ROUND 11 — re-review after the round-10 folds
> Round-10 verdicts: BOTH BLOCK — 4 distinct REAL findings (1 CONVERGED pair), all folded (the
> design doc's **R10 fold record table**). The headline is a SECOND engineer-mechanism
> refutation, and it retires a design element that had survived since round 3: the STAGED
> VISIBILITY FLIP (insert a tombstone `pending`, later MERGE it to `committed`) is incompatible
> with the client's immutable ID cursor — the row keeps its original id, so any peer whose
> cursor had already passed it would NEVER receive the deletion. Replaced by the COMMIT-TIME
> RE-MINT: at the commit point the route inserts a FRESH committed copy at a NEW id (ahead of
> every cursor, delivered like any ordinary row) and then deletes the pending copy
> (write-before-delete); the scrub completes either half. This restores H10's one-round-trip
> claim and the adopt exemption's premise. The other folds: (1) the ENUMERATION CONTRACT —
> absence is now proven by a STRICT SEQUENTIAL Live → Archive → Quarantine walk (every mover
> writes its destination before deleting its source, so this order cannot miss a row mid-move)
> PLUS an idle-with-same-ETag stability interval around the complete paged walk; anything else
> is transient, never terminal; (2) N17 hardened into its own list with an Enforce-Unique
> RunId, an InputDigest (a crashed run's retry with a differing input is REJECTED — recompute
> needs a fresh id), create-if-absent + outcome-by-read, and server-minted run ids; (3)
> TombstoneIds switch from numeric row ids to STABLE TransactionIds — this deletes the entire
> ID-coordinate class from the design AND restores the membership coordinate for rows that have
> vanished (the absent-row retirement lane decides its delta with no extra machinery). This
> round: re-review end-to-end and answer Q1v11-Q5v11 (§14) — the re-mint's cursor-delivery and
> duplicate-transient consequences, and the enumeration contract's coverage of every mover,
> especially. Q5v11 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R10 fold records, and questions Q1v11-Q5v11).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v11-Q5v11 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the client sync contract — `sync.js` pull cursor
(~:1819-1900, the ID cursor + frozen ceiling + lookback) and tombstone application (~:2030-2110). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
