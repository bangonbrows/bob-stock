# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R6

> ## ROUND 6 — re-review after the round-5 folds
> Round-5 verdicts: BOTH BLOCK — 4 distinct REAL findings (2 CONVERGED pairs), ALL confined to
> the two mechanisms round 4 introduced; both are REDESIGNED this round (the design doc's **R5
> fold record table** has finding → ground truth → fold). Confirmed-closed at R5 by both
> reviewers: the normalization law + six-cell table (all standard publications), the CommitSig
> authority chain, the ID-coordinate sweep (count zero), the signed epoch artifact, head shape,
> empty-set, retry healing, and the export adjudication. The two redesigns:
> (1) **`retire_claim` v2 is a TRUE PUBLICATION** — round 4's version corrupted balances
> (retirement didn't normalize — the converged repro: excluded +10 → retire → create-replace +8
> landed at −2), couldn't ride the journal machinery (empty CandidateHeads), and destroyed its
> own gate evidence on a mid-crash. Now it publishes an explicit-null head (the withdraw form —
> non-empty decision key, standard §6 recovery), applies the normalizing delta via the same
> horizon rule (journaled), transitions the registry to the withdrawn form (rollback restores),
> and quarantines the tombstone ONLY in P7 — after the commit point — so every pre-commit crash
> leaves the evidence intact. Post-retirement corrections ride the supersede lane (§5b).
> (2) **CONTROL-AWARE PAIRED ARCHIVAL replaces the permanent archive exclusion** — round 4's pin
> broke the client scalar-cutoff contract (clients treat `_spId ≤ cutoffId` as snapshot-covered
> and skip/prune; a permanently-excluded row below the cutoff diverged client stock from
> settlement, plus unbounded retention). Now snapshotCompute receives the active controlManifest
> and folds EFFECTIVE values, and the run's cutoff is CLAMPED so a controlled ensemble (target +
> its control rows) always archives TOGETHER — no excluded row ever sits below a published
> cutoff, the covering invariant holds exactly, retention is bounded (N10, H12). This round:
> re-review end-to-end and answer the NEW questions Q1v6-Q5v6 (§14) — the retire crash matrix
> and the paired-archival invariants especially. Q5v6 is the explicit convergence gate.

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
   honest notes H1-H12, the R1-R5 fold records, and questions Q1v6-Q5v6).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v6-Q5v6 explicitly. If a decision contradicts a frozen SR
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
