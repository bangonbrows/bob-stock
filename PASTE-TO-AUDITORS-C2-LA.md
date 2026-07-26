# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 8

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 and has not been in question since. This is the interim paper review of
the CONCRETE staging artifacts — in practice, of the CUTOVER RUNBOOK.

**Round 7 outcome: BOTH BLOCKED — AGY×1 + Codex×5 = 5 distinct (1 converged). All real, all fixed.**

AGY, this was your first block, and it was the right one: asked for a mechanical pairwise proof
instead of an opinion, you built your own table and found the rows 1/2 overlap independently — the
same defect Codex found. That is exactly what the round needed.

The five:
1. **[both of you] Rows 1 and 2 still overlapped** — the defect R6 claimed to fix. Adding the `seal`
   fact separated rows 1-2 from 3-10 but left row 2 a strict subset of row 1, so the ordinary
   post-(3a) state matched both. My R6 fix addressed the symptom (missing facts), not the cause: row
   1 used wildcards that subsume its successor. Also `cutoverCompletedAt` was declared a fact but had
   no column, so rows 3/10 and 4/10 were separated only by prose.
2. **Partial build-repair states mapped to no row** — repair is three non-atomic remote toggles and
   only its endpoints existed.
3. **The package digest was never actually bound into `epoch-v1`** — the canonical didn't cover it,
   so the stored digest could change while the signature kept verifying.
4. **A one-shot epoch cannot be the permanent current-build authority** — the next legitimately
   reviewed package would be misclassified as a rollback forever, with no advancement lane.
5. **The derived response digest didn't fail closed** — two instances that both failed to read their
   sources returned the same literal and compared equal, so the straddle belt saw nothing.

Fold record: **§R**. Suite 164 → **169/169**; all regression gates green.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§R is the R7 fold record; §S is this round's questions
   QS1-QS5.** §D carries the corrected 9-row table (row 1 is now a NEGATED predicate, `C` is a real
   column, repair is one predicate) and the three-artifact build model. §A carries N16's new signed
   `cutoverPackageDigest` and the new N19 `approved_build` record.
2. The amended code (169/169 local probes): `azure-functions/src/functions/snapshotCompute.js` ·
   `azure-functions/src/functions/attestRows.js` (**`epoch-v1` gains `cutoverPackageDigest`; new
   `buildrec-v1` frame**) · `azure-functions/src/functions/correctionCompute.js` ·
   `test/correction-proof.js` (sections 14-20).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json`.

**Three mechanical checks again — same format, it worked:**
- **QS2 — pairwise disjointness on the corrected 9-row table.** For every ordered pair, name a
  separating fact or show the overlap. Rows 1/2 have now been wrong TWICE, and the fix is a NEGATED
  PREDICATE rather than a value list — check it as such, and build your own table first.
- **QS3 — completeness**, with particular attention to row 9, which now claims to absorb every
  partial-repair state by re-asserting all three toggles as its first action.
- **QS4 — the three build artifacts** (N19 current authority · epoch historical evidence · response
  belt). Are the boundaries right, is the monotonic revision sufficient against replay, and does
  anything still treat the epoch digest as current?

**Standing item neither of you can close on paper:** the real live-vs-archive SharePoint echo for the
eight N7 columns (absent vs null vs `''`). Staging probe before the first live archive run; if they
differ, normalise at the read shape, never loosen the canonical.

**Judge:** do L1-L5 close their findings without introducing a new defect? Findings only — the
engineer ground-truths and applies all changes. Verdict format: PASS / PASS-with-notes / BLOCK with
numbered findings + concrete failure sequences.

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
7. **When a question asks you to re-derive something, derive it independently BEFORE reading my
   version.** Confirming a table is not the same as building one. If your derivation agrees with
   mine, say what you did to test it, not just that it agrees.
8. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
