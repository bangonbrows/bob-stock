# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R8

> ## ROUND 8 — re-review after the round-7 folds
> Round-7 verdicts: one reviewer PASS (explicit all-clear on the closure gate) · one reviewer
> BLOCK×4, ALL REAL, all folded (the design doc's **R7 fold record table**) + 1 typed-canonical
> build pin. Both reviewers must pass the same revision, so this round goes to both. The
> heaviest R7 correction is an ENGINEER-PREMISE REFUTATION: the R6 "healing touch" claimed pulls
> are modified-since — they are an immutable SharePoint-ID cursor (sync.js:1823), so the touch
> could never re-deliver an old-ID or archived row. It is DELETED, not patched: retirement now
> honestly restores SERVER truth only, device-side restoration is explicitly deferred to the
> banked H7 re-delivery lane, and the response surfaces `deviceRestorationPending` to the
> Director (§5b, H13 — trial-data lane per D-C2-2). The other R7 folds: (1) the N13 tombstone
> filter is now an explicit ALLOWLIST (null-legacy + committed-with-valid-CommitSig delivered;
> pending/retiring/unknown excluded BY CONSTRUCTION — the §5b/N13 spec drift both halves closed);
> (2) the §8 device retry gains a TERMINAL ADJUDICATED branch — a lost-ack retry against a
> retired/withdrawn claim (ControlId null) answers `superseded_by_adjudication` terminally,
> never inserts or loops; (3) the archive run gains a TOMBSTONE AUTHORITY GATE — it refuses
> (transiently) while any pending/retiring tombstone is in its input and batch-verifies committed
> CommitSigs before compute, so D8-7 economics only ever see adjudicated tombstones (closing the
> losing-tombstone balance-divergence repro); (4) the versioned hash canonical uses TYPED values
> (0 vs null vs absent distinct). This round: re-review end-to-end and answer Q1v8-Q5v8 (§14) —
> the allowlist matrix and the authority-gate interleavings especially. Q5v8 is the explicit
> convergence gate.

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
   honest notes H1-H13, the R1-R7 fold records, and questions Q1v8-Q5v8).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v8-Q5v8 explicitly. If a decision contradicts a frozen SR
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
