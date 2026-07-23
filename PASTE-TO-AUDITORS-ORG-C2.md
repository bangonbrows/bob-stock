# REVIEW PACK — Org-Structure chunk, W4.4 Contract 2 (correction-approval route) — SCOPE REVIEW R3

> ## ROUND 3 — re-review after the round-2 folds
> Round-2 verdicts: BOTH reviewers BLOCK — 10 distinct REAL findings (1 converged pair: the
> never-promoted device pending) + 1 REAL note + 1 note REFUTED with evidence (the transient-export
> window cannot exist: `export_lease` is acquirable only from `idle`, so no export runs while a
> correction holds the state — adjudication recorded in §7b, challenge it if the reasoning is
> wrong). Every fold is in the design doc's **R2 fold record table** (finding → ground truth →
> fold). Headline changes this round: a RE-SEIZE rule for stalled recoverers + the pinned
> staleness-exit invariant on all five states (§3/3a); the ctl-v1 replacement covered set is now the
> FULL ENGINE ROW FORM, derived not hand-picked (adds TransferId/UnitPriceAtTime/IdempotencyKey —
> two of those were engine-read and unsealed, §7a); §7b(5) seal verification split BY ORIGIN
> (Director rows: ctl-v1; adopted device tombstones: their C1 row-v1 seal + head-bound adoption
> fields, §7b); the device-claim lifecycle hardened (pre-insert ownership fence, foreign-CAS
> compensation, TWO-WAY TTL scrub incl. roll-forward promotion, OpId-or-ControlId retry match —
> §8/§4/§6); registry committed-phase schema fixed (OpId retained for device items,
> PublicationVersion null-until-adopted + adoption's P7 CAS-fill, supersede/withdraw on an unadopted
> tombstone refuses `TOMBSTONE_PENDING_ADOPTION` — §4); recovery decides on a CANDIDATE HEAD-SET
> with per-entry hasOwnProperty semantics (adopt's N heads + withdraw's explicit null now decidable
> — §6); the P4 delta law generalized (supersede was arithmetically WRONG — the six-cell mode table
> in §5 P4); the no-journal seize rule re-keyed to OpId (journals discoverable from the P5.1 crash
> window — §3a); the target-seal check is a THREE-WAY contract closing the seal-strip demotion
> (§5 P3.2); and the INVARIANT_BROKEN blast radius honestly re-stated as GLOBAL (H9). This round:
> re-review the revised design end-to-end and answer the NEW questions Q1v3-Q7v3 (§14) — the
> three-party seize chain and the delta-law chains especially.

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
   honest notes H1-H9, the R1+R2 fold records, and questions Q1v3-Q7v3).
2. For grounding only: `AZURE-CHUNK-ORG-LA-CHANGES.md` §6 (correction bullet),
   `AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md` P2, and the frozen engine's control validation
   (`azure-functions/src/functions/buybackExport.js` header CONTROLS FORM + lines ~500-601, 783-800 —
   the fixed contract the route must satisfy).

**Judge:** correctness of the physical design against the frozen spec — the four-state coordination
record, the reservation registry lifecycle (create/supersede/withdraw, rollback restore), the
journal/publication protocol and its crash matrix, the targetLine/originalEventAt capture rules, the
stamp-minting precedence and its two fail-closed rejections (D-C2-1/2), the manifest-head publication,
and the push-path tombstone claim. Answer Q1v3-Q7v3 explicitly. If a decision contradicts a frozen SR
pin, cite the pin.

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
