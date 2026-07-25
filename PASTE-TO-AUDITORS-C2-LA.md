# REVIEW PACK — Contract 2 INTERIM LA REVIEW (pre-staging-apply)

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 (you both passed the same revision — Codex R25 "No findings", AGY
confirmed unconditionally). The owner chose an interim paper review of the CONCRETE staging
artifacts BEFORE he applies them to staging. This round reviews implementation fidelity, not the
design (the design is frozen; a finding that the design itself is wrong would be extraordinary and
should say so explicitly).

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — THE document under review: the action-level
   implementation of the N1 correction LA (§B, all six modes + reconcile), the N9/N10/N13
   transforms (§C), the list schemas (§A), and the apply-runner/cutover plan (§D). Answer its §E
   questions QL1-QL4 explicitly.
2. The W-B1 code the LA calls (shipped, 108/108 local probes):
   `azure-functions/src/functions/correctionCompute.js` (every decision op),
   `azure-functions/src/functions/attestRows.js` (the five frames — econ-v1 untouched, 58/58),
   `test/correction-proof.js` (the probe suite — check it drives the REAL modules and that the
   auditor repros are faithfully encoded).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (the converged spec + R1-R24 fold records),
   `audit-artifacts/archive-def-current.json` (the house LA patterns being mirrored).

**Judge:** does the CONCRETE implementation match the CONVERGED design exactly — the CAS/ETag/
fence mechanics, the phase ordering, the compute-op boundaries (no logic in the LA), the schema
shapes, the cutover quiescence? Findings only — the engineer ground-truths and applies all
changes. Verdict format: PASS / PASS-with-notes / BLOCK with numbered findings + concrete
failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
5. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
