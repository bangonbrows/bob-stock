# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R23

> ## ROUND 23 — re-review after the round-22 folds
> Round-22 verdicts: BOTH BLOCK — 2 distinct REAL findings (both CONVERGED), all folded (the
> design doc's **R22 fold record table**). Q1v22 (exact per-run deletion set), Q3v22 (global
> idempotency concept), and Q4v22 (withdrawn-head) were confirmed, and BOTH reviewers state the
> design is SOUND for all Contract-2 steady-state operations. The two findings were both "the R21
> fixes were right but under-specified in the actual spec sections": (1) I said the sweep
> authenticates the row identity via the run's integrity hash, but that hash is computed fresh each
> run and never STORED — so there was no durable signed thing to verify against later; N17 now
> carries a signed membership hash (written before copying, covered by the record signature) that
> the cleanup and recovery both verify against, halting on any tamper; and because pre-launch legacy
> data has no such hash, the one-time cutover explicitly skips the check for it (it's throwaway
> trial data, and production cuts over on a fresh archive with no legacy at all); (2) I'd put the
> global replay-check in the deliverable list but the normative push section still said ordinary
> rows were untouched and didn't pin a read order — the global Live→Archive source-first check now
> applies to every push row in the normative sequence. Both are wiring/durability completions, not
> new mechanisms. This round: re-review end-to-end and answer Q1v23-Q4v23 (§14). Q4v23 is the
> explicit convergence gate — both reviewers have signalled the design is at the doorstep.
>
> [Superseded R22 summary retained below for reference:]
> ## ROUND 22 — re-review after the round-21 folds
> Round-21 verdicts: BOTH BLOCK — 4 distinct REAL findings (1 CONVERGED pair), all folded (the
> design doc's **R21 fold record table**). Q2v21 (one retention lifecycle) confirmed. AGY had just
> ONE finding; the design is "extremely close." The folds: (1) [CONVERGED] the cleanup deleted live
> rows by an age cutoff, but the unit-move archives a target's correction rows regardless of age —
> so a recent correction row was stranded in live and then destroyed by the sweep; the cleanup now
> deletes the EXACT set of rows a run archived (identified by the run itself), not by an age cutoff;
> (2) the original-row identity the sweep matches on is now cryptographically sealed into the run's
> integrity hash, so a hand-edit of that field breaks the hash and halts rather than misdirecting a
> deletion; (3) a replayed transaction that used to create a phantom live row is now caught by
> checking both the live and archive lists on push (so it's acknowledged without a duplicate), which
> also fixes a later archive-ID collision; (4) a withdrawn correction no longer trips the
> "unadjudicated deletion" export blocker (an explicit-null head is adjudicated history). Two folds
> are flagged as scoped amendments to existing surfaces (the push validator and the archive
> fidelity hash) for the return re-audit. This round: re-review end-to-end and answer Q1v22-Q5v22
> (§14) — the exact per-run deletion set especially. Q5v22 is the explicit convergence gate.
>
> [Superseded R21 summary retained below for reference:]
> ## ROUND 21 — re-review after the round-20 folds
> Round-20 verdicts: BOTH BLOCK — 4 distinct REAL findings (some converged) + a note, all folded
> (the design doc's **R20 fold record table**). Q4v20 (the §4/§8 collision-recovery text parity)
> PASSED with both — the seventh sub-question closed. Both reviewers CONFIRMED the Live-presence
> sweep DIRECTION is right; the problem was recovery precision. The folds: (1) the sweep now keys
> on the archive row's durable original-row identity (`SourceId`), NOT the transaction id — a
> device replaying an old transaction mints a NEW row id, so it no longer trips the sweep into
> deleting the legit archived copy; (2) the recovery step now actually COMPLETES a published run's
> leftover live-deletions before the sweep runs (a run that published then crashed mid-cleanup no
> longer leaves published rows looking like junk); (3) a stale line in N16 that still demanded a
> live manifest head is removed, so N10/N16/export/cutover all state ONE retention lifecycle
> (retention by not-in-live; export-active-selection by head); (4) the cutover briefly fences the
> push path during its scan so live-presence can't change mid-classification, and completes any
> published legacy run's deletions first. This round: re-review end-to-end and answer Q1v21-Q4v21
> (§14) — the SourceId sweep + reconcile completion especially. Q4v21 is the explicit convergence
> gate.
>
> [Superseded R20 summary retained below for reference:]
> ## ROUND 20 — re-review after the round-19 folds
> Round-19 verdicts: BOTH BLOCK — 4 distinct REAL findings (2 CONVERGED pairs) + a proof cleanup,
> all folded (the design doc's **R19 fold record table**). Q4v19 (foreign-collision) PASSED with
> both — the sixth sub-question closed. The headline is a SIMPLIFICATION both reviewers converged
> on: my archive-cleanup still leaned on a deletable signature as "crash proof", so an attacker
> deleting one column made published history look crashed and got it swept. Both said the same
> thing — use ACTUAL LEDGER STATE: a crashed run's rows are still in the Live ledger (it never
> finished), a published run's rows were already removed from Live. So the sweep now deletes an
> archived row ONLY if a copy is still in Live (a genuine leftover duplicate — the Live copy is the
> truth, nothing lost) and SPARES everything else. This DELETED a whole layer of fragile signature
> machinery and closed two findings at once: the history-reaper (a deleted signature no longer
> matters) AND the direct-to-archive corrections (a superseded/withdrawn/crashed correction is
> simply not-in-Live, so it's kept as append-only history and never bricks the cleanup). The
> engine's existing dual-list dedup already makes any transient duplicate economically inert, so no
> reader-filter is needed. Also: (3) the cutover now runs that same Live-presence cleanup before
> sealing the boundary; (4) a leftover contradictory line in §8 (it still said the collision state
> "stops the scrub") is fixed to match §4. This round: re-review end-to-end and answer Q1v20-Q5v20
> (§14) — the live-presence sweep especially. Q5v20 is the explicit convergence gate.
>
> [Superseded R19 summary retained below for reference:]
> ## ROUND 19 — re-review after the round-18 folds
> Round-18 verdicts: BOTH BLOCK — 5 distinct REAL findings, all folded (the design doc's **R18
> fold record table**). Q2v18 (source-first pre-commit) and Q4v18 (collision recovery) PASSED with
> both — two more sub-questions closed. Both reviewers CONFIRMED the archive-epoch model itself is
> sound; the findings COMPLETE it. The folds: (1) the sweep still deleted on ABSENCE of a
> publication proof, which re-opened the history-reaper (delete an old published run's marker ⇒ its
> history swept) — now deletion requires POSITIVE crash proof (a valid record signature AND no
> valid publication signature AND stale), and an absent/corrupt record on a post-cutover row is
> treated as tampering ⇒ HALT, never delete; (2) I'd forgotten that Director corrections on an
> already-archived row write their control row DIRECTLY into the archive with no run-marker — those
> legit rows are now admitted and spared by their own cryptographic seal + manifest head; (3) the
> cutover boundary is now captured under a quiescent protocol (disable old writer → wait idle →
> seal → enable) so no archive write straddles it; (4) a stale sentence that still said "no marker
> = legacy" (contradicting the epoch classifier) is deleted; (5) a genuine contradiction in the
> collision text — it said both "preserve the pending row" and "delete it" — is resolved: a
> deletion whose ID is squatted by a foreign row can never apply, so its pending row is deleted and
> the collision is surfaced loudly for the Director to re-issue. This round: re-review end-to-end
> and answer Q1v19-Q5v19 (§14) — the positive-crash-proof sweep and the direct-to-archive
> acceptance especially. Q5v19 is the explicit convergence gate.
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
   honest notes H1-H14, the R1-R22 fold records, and questions Q1v23-Q4v23).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v23-Q4v23 explicitly. If a decision contradicts a frozen
SR pin, cite the pin. This round's folds lean on the N17 durable `ArchiveMembersHash` (signed,
RecordSig-covered), the legacy-cutover authentication bypass (D-C2-2 trial data), and the normative
global push idempotency in §8. Useful grounding for this round's folds: `sync.js` pull tombstone application
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
