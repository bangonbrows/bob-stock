# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 2 (confirm-folds)

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 (you both passed the same revision — Codex R25 "No findings", AGY
confirmed unconditionally). The owner chose an interim paper review of the CONCRETE staging
artifacts BEFORE he applies them to staging.

**Round 1 returned 13 findings (AGY×2 + Codex×11). Every one was ground-truthed REAL and folded**
at commit `bb1987e`; the local proof suite went 108 → 127/127 and every regression gate is green
(attest 58/58, archive-carry 28/28, buyback-export 170/170, topology 256/256, access-policy 67/67,
smoke 277/277, static + CSP PASS). Both of you confirmed the DESIGN is frozen-sound; all 13 were
implementation fidelity.

**This round confirms the folds.** It is not a fresh design review — a finding that the design
itself is wrong would be extraordinary and should say so explicitly.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — THE document under review.
   - **§F is the R1 FOLD RECORD** — all 13 findings, what changed, where, and which probe covers it.
   - **§G is this round's questions QG1-QG5** — answer each explicitly.
   - §A schemas · §B the N1 correction LA phase-by-phase · §C the N9/N10/N13 transforms ·
     §D the apply-runner/quiescent-cutover plan · §E the R1 questions QL1-QL4 (still standing).
2. The W-B1/W-B2r code the LA calls (127/127 local probes):
   `azure-functions/src/functions/correctionCompute.js` (every decision op — note the NEW
   `assembleSnapshot`, `modeGate`, `ctlRowsEqual`, `normalizeArchiveRow`, `stableClone`),
   `azure-functions/src/functions/snapshotCompute.js` (**F3: now control-aware — a flagged
   amendment to the audited Chunk-8 surface**),
   `azure-functions/src/functions/attestRows.js` (the five frames — econ-v1 untouched, 58/58),
   `test/correction-proof.js` (section 14 holds the F1-F10 fold probes).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (the converged spec + R1-R24 fold records),
   `audit-artifacts/archive-def-current.json` (the house LA patterns being mirrored).

**Judge:** does each fold actually close its finding without introducing a new defect or
contradicting a converged design rule — and does the CONCRETE implementation now match the
CONVERGED design exactly (CAS/ETag/fence mechanics, phase ordering, compute-op boundaries, schema
shapes, cutover quiescence)? Findings only — the engineer ground-truths and applies all changes.
Verdict format: PASS / PASS-with-notes / BLOCK with numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
5. Work from a FRESH copy at the latest commit (the R1 folds changed three source files); if you
   report that a fix is missing, print the commit you are reading first.
6. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
