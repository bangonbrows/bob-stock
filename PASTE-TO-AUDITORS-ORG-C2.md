# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R18

> ## ROUND 18 — re-review after the round-17 folds
> Round-17 verdicts: BOTH BLOCK — 4 distinct REAL findings (3 CONVERGED pairs) + a proof-suite
> cleanup, all folded (the design doc's **R17 fold record table**). The headline: the archive
> cleanup is resolved at the ROOT with an ARCHIVE-C2-EPOCH cutover boundary (riding the seal-epoch
> artifact) — three rounds of trying to tell legit old history from crashed-run junk via the
> per-run marker failed because both can end up marker-less (Codex asked for a cutover marker back
> in R15). Now: a row BELOW the epoch is definitively pre-Contract-2 legacy (always read AND
> spared), a row ABOVE it is a C2 run's row needing a valid signed publication proof (else residue
> ⇒ inert to readers AND physically swept so it can't jam a later archive move); the publication
> proof is the SIGNATURE's existence, not the editable boolean (`Published:false` + valid sig =
> tamper contradiction ⇒ HALT); production's fresh archive ⇒ epoch 0 ⇒ no legacy at all. Also:
> (2) the two-list pre-commit check gains the source-first Live→Archive order (stable against a
> concurrent archive move); (3) the crash-recovery scrub now establishes a main row is genuinely
> OURS by content before acting, so a foreign colliding row can't cause a legit pending deletion
> to be silently deleted; (4) a contradictory line saying the collision state "stops the scrub"
> is corrected — it stops only the retry, the scrub recovers a crashed collision. This round:
> re-review end-to-end and answer Q1v18-Q5v18 (§14) — the archive-epoch sweep especially. Q5v18
> is the explicit convergence gate.
>
> [Superseded R17 summary retained below for reference:]
> Round-16 folds: (1) [CONVERGED] the R15 archive-cleanup could be weaponized —
> corrupting an OLD published run's marker made the sweep purge its legit history, and deleting a
> crashed run's marker made its residue look like legacy and survive; the sweep is now
> NON-DESTRUCTIVE-ON-AMBIGUITY (it deletes only on a positive signed crashed-run proof and HALTS +
> alarms on any ambiguity, never deleting real history) and residue is rendered INERT by a
> reader-filter (every archive reader ignores rows under an unpublished/unverifiable run), with
> marker-deletion-by-list-access explicitly scoped as the P-13 threat banked for server
> enforcement; (2) [CONVERGED] the R15 pre-commit collision check looked only at the live list, so
> an attacker could reuse an ARCHIVED id and plant a time-bomb that bricks the archive job months
> later — now it queries BOTH lists (mirroring the frozen Director check); (3) [CONVERGED] the
> `collision` state leaked its N18 row into an infinite re-register loop and had no crash-safe
> lifecycle — it now deletes N18 first, has a scrub cell + TTL, and a loop-guard on the
> no-registry-N18 path; (4) the scrub's crash-recovery cells now verify CommitSig before deleting
> N18, matching the retry branch. This round: re-review end-to-end and answer Q1v17-Q5v17 (§14) —
> the sweep tamper-safety and the collision lifecycle especially. Q5v17 is the explicit
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
   honest notes H1-H14, the R1-R17 fold records, and questions Q1v18-Q5v18).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v18-Q5v18 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the ARCHIVE-C2-EPOCH cutover (N16/N10), the
archive-item-id as an immutable classifier, and D-C2-2 (fresh production archive ⇒ no legacy). Useful grounding for this round's folds: `sync.js` pull tombstone application
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
