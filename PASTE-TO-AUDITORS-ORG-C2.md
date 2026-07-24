# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R13

> ## ROUND 13 — re-review after the round-12 folds
> Round-12 verdicts: BOTH BLOCK — 7 distinct REAL findings (2 CONVERGED pairs), all folded (the
> design doc's **R12 fold record table**). Every finding was a LIFECYCLE/OBSERVABILITY gap around
> the N18 pending list introduced last round, plus the orphan-sweep predicate and stale proof
> text — the core algorithmic architecture was confirmed fully formed by both. The folds:
> (1) the export now reads `ControlRegistry_Staging` for COMMITTED claims (a device commit CASes
> the registry before its main-ledger re-mint and doesn't hold the coordination state, so an
> export could overlap the window and bill a committed deletion as present — now a committed claim
> with no materialized row/active head fires the fail-closed blocker; a PENDING/N18 claim
> correctly does NOT block); (2) the enumeration order is now N18 → Live → Archive → Quarantine
> (source-before-destination for the re-mint's N18→Live move — a Live-first reader could false-
> conclude CONTROL_ROW_MISSING mid re-mint); (3) N18 gets Enforce-Unique + outcome-by-read (no
> duplicate pending rows / no stalled retry); (4) the pending+N18-durable-before-CAS crash gets
> its PROMOTE scrub outcome, and the device retry's both-copies state now deletes the N18 residue
> (the full `{registry × N18 × main-ledger}` matrix); (5) the orphan-sweep predicate switches
> from the unimplementable "no published snapshot record" (stock_snapshot holds only the latest
> runId; N17 is pre-publication) to VERSION-based — delete archive rows whose SnapshotVersion >
> the published version (both reviewers converged on exactly this); (6) §11's proof suite is
> purged of retired mechanisms (loser⇒N18-delete not Quarantine; membership⇒TransactionId not
> horizon; visibility⇒re-mint not flip). This round: re-review end-to-end and answer Q1v13-Q5v13
> (§14) — the export registry-read predicate and the full crash matrix especially. Q5v13 is the
> explicit convergence gate.

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
   honest notes H1-H13, the R1-R12 fold records, and questions Q1v13-Q5v13).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v13-Q5v13 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the archive LA copy/publish ordering + snapshot
version (audit-artifacts/archive-def-current.json) and the registry/N18 list semantics (§4/§8/N18). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
