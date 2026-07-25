# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 4

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25. This is the interim paper review of the CONCRETE staging artifacts
BEFORE the owner applies them to staging.

**Round 3 outcome: Codex BLOCK×3 — all three real, reproduced, and fixed.** (1) The fidelity-hash
canonical was not TYPED as the design's N10 clause requires by name, so `ControlState:null` and
field-absent hashed identically and a destructive live-delete could proceed against an incomplete
archive copy. (2) The `controlHeads` discriminator failed OPEN — a malformed manifest silently
published the raw balance (+10) instead of the effective one (+8). (3) The apply runner could not
restart after step (6): legitimate post-cutover growth tripped the mandatory epoch-divergence HALT.
Fold record + repros: **§J**. Suite 144 → **154/154**, all regression gates green.

**One fold carries a scope judgement worth attacking (QK2).** Typing the canonical BLANKET broke
the Chunk-8 archive-carry contract immediately (28→27): the C1 optional numeric stamps have the
OPPOSITE converged rule, `absent ≡ ''`, because SharePoint renders an unstamped column as absent in
one list read and `''` in the other. Typing them would HALT every run containing an unstamped row.
The typed rule is therefore scoped to the eight N7 control fields — the design types the EXTENSION,
not the pre-existing C1 set. If you think that reading is wrong, say so with the design line.

**Note on Round 3's AGY verdict.** AGY returned PASS on all five questions and "100% approved".
Its QI3 answer quoted a specific N10 Logic App definition, including the ARM expression
`@coalesce(variables('capturedSnapshot')?['controlManifest']?['controlHeads'], json('{}'))`. **No
Logic App JSON exists in this repo** — `gen-correction-def.js` and `apply-c2-staging.js` are
unwritten, and are the next deliverable. The cited artifact was invented, and it was used to pass
the exact question Codex blocked on. **Please verify every claim against a file that actually
exists, and state explicitly when you cannot.**

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — THE document under review.
   - **§J is the R3 fold record** (three findings, repros, fixes, and the H1 scope split).
   - **§K is this round's questions QK1-QK5** — answer each explicitly.
   - §F / §H the R1 and R2 fold records · §A schemas · §B the N1 LA (step 13a pins the membership
     input mapping) · §C the N9/N10/N13 transforms · §D the apply runner, now with the
     **phase-aware rerun** rule.
2. The amended code (154/154 local probes):
   `azure-functions/src/functions/snapshotCompute.js` — the typed N7 cells + `CANON_VERSION`, the
   fail-closed manifest validation, `partitionMode`, and the legacy short-circuit.
   ⚠ Still a flagged amendment to the audited Chunk-8 surface.
   `azure-functions/src/functions/correctionCompute.js` · `test/correction-proof.js` (sections 14-16
   hold the F/G/H fold probes) · `test/archive-carry-proof.js` (the C1 rule that scoped H1).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` (the converged spec — the N10 row carries the
   typed-canonical clause), `audit-artifacts/archive-def-current.json` (the legacy LA).

**Judge:** does each H1-H3 fold close its finding without introducing a new defect, and is the H1
scope split correct? Findings only — the engineer ground-truths and applies all changes. Verdict
format: PASS / PASS-with-notes / BLOCK with numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
5. Work from a FRESH copy at the latest commit; if you report that a fix is missing, print the
   commit you are reading first.
6. **Do not describe the contents of a file you have not opened.** If a needed artifact does not
   exist yet, say that — it is a legitimate finding, not something to infer around.
7. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
