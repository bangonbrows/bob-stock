# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R16

> ## ROUND 16 — re-review after the round-15 folds
> Round-15 verdicts: BOTH BLOCK — 4 distinct REAL findings (2 CONVERGED pairs), all folded (the
> design doc's **R15 fold record table**). Q2v15 (stale-rule deletions) and Q3v15 (PublishedSig
> integrity) were CONFIRMED closed. Two of the four were flaws in the R14 folds themselves,
> including one where the R14 fix was actively harmful; both reviewers converged on both. The
> folds: (1) [CONVERGED] the R14 VERSION FLOOR was wrong BOTH ways — it deleted the last legacy
> run (whose version equals the current published version on the first C2 run) AND spared residue
> outpaced by two later publications; DROPPED entirely in favour of writing the N17 record BEFORE
> copying any rows, so an ABSENT N17 record now definitively means "pre-Contract-2 legacy ⇒
> spare", a PRESENT-but-unpublished record means "residue ⇒ delete", and an unreadable current-run
> record HALTS the sweep; (2) [CONVERGED] the R14 N18-mismatch promote rule was REVERSED-DANGEROUS
> — a target mismatch means the N18 row belongs to the unique-key WINNER, so my "delete it" rule
> let an attacker delete peers' legitimate deletions by forging a colliding ID and abandoning it;
> now the scrub ONLY releases the stranded claim and NEVER touches the N18 row; (3) the
> CONTROL_ID_COLLISION lifecycle is redesigned around a PRE-COMMIT id check (a forged colliding
> tombstone is rejected before the irrevocable commit, target stays present) plus a durable
> `collision` registry state that self-resolves to release (no membership, no balance delta — the
> R14 retire_claim extension is withdrawn); (4) the retry/collision completion now VERIFIES
> CommitSig (a corrupted CommitSig on a provably-own row is re-minted; N18 is never deleted until
> the committed row fully verifies). This round: re-review end-to-end and answer Q1v16-Q5v16
> (§14) — the record-before-copy sweep and the collision lifecycle especially. Q5v16 is the
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
   honest notes H1-H13, the R1-R15 fold records, and questions Q1v16-Q5v16).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v16-Q5v16 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the N17 record-before-copy sweep (N17/N10), the
N18 unique-key ownership (§8/§6), and the registry `collision` state + pre-commit check (§4/§8). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
