# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 3

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 (you both passed the same revision). The owner chose an interim paper
review of the CONCRETE staging artifacts BEFORE he applies them to staging.

**Round 2 outcome: AGY PASS on all four questions · Codex BLOCK with 6 findings — every one of the
six reproduced against the real modules and was fixed. Zero refuted.** They were serious: the
null-head lane was dead (a withdrawn deletion never restored its target), the archive fidelity hash
was blind to the whole control form (a copy that dropped `ControlId` passed the gate, then the live
delete destroyed the only complete control row), delta validation had a live-target bypass and
scored direction-none types as outbound, the membership bind test passed on two `undefined`s,
"absent controlHeads is byte-identical" was false, and `archive_state` was being reshaped while the
legacy writer that overwrites it was still enabled. Fold record + repros: **§H**. Suite 127 →
**144/144**; all regression gates green (attest 58/58, archive-carry 28/28, buyback-export 170/170,
topology 256/256, access-policy 67/67, smoke 277/277, static + CSP PASS).

**Note for AGY:** three of the six were on surfaces you passed (QL1/QL2/QL3). The repros in §H are
the ground truth — please re-derive rather than re-affirm.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — THE document under review.
   - **§H is the R2 fold record** (all six findings, the repro each produced, the fix).
   - **§I is this round's questions QI1-QI5** — answer each explicitly.
   - §F the R1 fold record · §A schemas · §B the N1 LA phase-by-phase (note the new **step 13a**
     pinning the membership input mapping) · §C the N9/N10/N13 transforms · §D the apply-runner
     and quiescent cutover (**resequenced again** — `archive_state` now transforms inside the
     quiesced window).
2. The amended code (144/144 local probes):
   `azure-functions/src/functions/snapshotCompute.js` — **three of the six folds land here**: the
   manifest-aware tombstone set, the N7 control form in `hashRows`, and the `c2Mode` property-
   presence discriminator. ⚠ Still a flagged amendment to the audited Chunk-8 surface.
   `azure-functions/src/functions/correctionCompute.js` — `hasEconDirection`, the moved live
   suppression, the mandatory membership bindings.
   `test/correction-proof.js` — section 15 holds the G1-G6 probes.
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (the converged spec),
   `audit-artifacts/archive-def-current.json` (the legacy LA whose ConfigData writes drove G6).

**Judge:** does each G1-G6 fold close its finding without introducing a new defect — and does the
implementation now match the converged design exactly? Two folds changed evaluation ORDER (G1, G3)
and one widened a hash that gates a destructive delete (G2), so those deserve the hardest look.
Findings only — the engineer ground-truths and applies all changes. Verdict format: PASS /
PASS-with-notes / BLOCK with numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
5. Work from a FRESH copy at the latest commit (two source files and the proof suite changed this
   round); if you report that a fix is missing, print the commit you are reading first.
6. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
