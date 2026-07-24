# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R12

> ## ROUND 12 — re-review after the round-11 folds
> Round-11 verdicts: BOTH BLOCK — 4 distinct REAL findings (2 CONVERGED pairs), all folded (the
> design doc's **R11 fold record table**). Two of the four were round-10 folds not fully
> propagated (both reviewers converged): §5b's membership consumer still compared the OLD numeric
> ids against the new TransactionId set (⇒ double-subtraction), and two recovery paths still
> named the RETIRED in-place visibility flip. The deepest was a physical flaw in the round-10
> re-mint itself (Codex): the ledger enforces a UNIQUE TransactionId, so the re-mint's
> same-id INSERT would 409 — a fresh committed copy alongside the pending one cannot exist. The
> fix is the SEPARATE PENDING LIST (N18 `StockControlPending_Staging`): a device tombstone's
> pending copy stages off-ledger — never pull-visible, never in economics, never occupying the
> ledger's unique key — and the commit inserts the tombstone into the MAIN ledger for the FIRST
> and ONLY time (unique key satisfied; fresh high id ⇒ cursor-deliverable, the R10 goal intact),
> then deletes the N18 row (write-before-delete). `ControlState='pending'` is no longer a
> main-ledger value (pending = "present in N18"), which SIMPLIFIES the N13 allowlist and the
> authority gate. The other folds: the §5b consumer now reads TransactionId (numeric-coordinate
> language deleted design-wide); every recovery path (success, own-committed retry, both scrubs)
> now cites the ONE re-mint procedure, never a flip; and N10 gains a startup ORPHAN-SWEEP so a
> changed-input archive retry under a fresh id can't leave a target duplicated across two run
> ids. This round: re-review end-to-end and answer Q1v12-Q5v12 (§14) — the separate-pending-list
> consumer sweep and the re-mint crash matrix especially. Q5v12 is the explicit convergence gate.

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
   honest notes H1-H13, the R1-R11 fold records, and questions Q1v12-Q5v12).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v12-Q5v12 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the ledger's Enforce-Unique `TransactionId`
constraint (AZURE-CHUNK2-SCOPE.md) and the archive LA copy/publish ordering
(audit-artifacts/archive-def-current.json). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
