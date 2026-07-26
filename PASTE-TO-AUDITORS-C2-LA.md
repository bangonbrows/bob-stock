# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 11

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 and has not been in question since. This is the interim paper review of
the CONCRETE staging artifacts — in practice, of the CUTOVER RUNBOOK.

**Round 10 outcome: AGY PASS-with-2-notes · Codex BLOCK×5. All real, all fixed — and BOTH AGY notes
converged with Codex findings.**

The matrix was proven disjoint (R8) and complete (R9) and was **not touched this round**. Every
finding was in the runbook around it, or in a claim I made about the outside world:

1. **Five coherence conflicts still in §D** — including row 5's cell saying only "stamp `C`",
   dropping the re-observation and read-back, and the build section still naming the retired
   overwriteable singleton. An implementer reading rows or prose rather than the numbered steps
   would have rebuilt two defects we had already closed.
2. **The Azure exclusion control didn't exclude the operations that matter.** `workflows/write` is
   not what runs a workflow; a resource lock is the wrong instrument (ReadOnly blocks the runner
   too); and a disabled Consumption workflow still finishes in-progress runs and permits resubmit.
3. **My own fail-closed rule deadlocked its own bootstrap** — approval written before the floor, and
   "floor absent + valid log ⇒ HALT" then trapped every rerun.
4. **The high-water had no singleton/ambiguous-outcome protocol** and was missing from the §A
   inventory entirely.
5. **Revision advancement was asserted but never specified**, and the obvious implementation
   (floor-first) bricks.

Fixes: all five conflicts rewritten; the deny now names the full operation set as an RBAC deny
assignment and **is demoted to a staging-proven item rather than an asserted one**; bootstrap-crash
is a forward action; the high-water has uniqueness, create-if-absent, outcome-by-read and a
duplicate HALT; and a new numbered **(3d) advance lane** pins append-before-floor, which is probed.

Fold record: **§X**. Suite 173 → **175/175**; all regression gates green.

**Read (branch `azure-phase-5-8-server`, latest commit, fresh copy):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§X is the R10 fold record; §Y is this round's questions
   QY1-QY5.** §A now lists `build_high_water`; §D carries (3d), the corrected controls and the
   corrected row 5.
2. Code (175/175 local probes): `azure-functions/src/functions/attestRows.js` ·
   `snapshotCompute.js` · `test/correction-proof.js` (sections 14-20).

**What I want this round:**
- **QY2 — the same coherence sweep.** Read §A, §B, §C, §D in order as an implementer who follows the
  numbered steps and inventory tables and **never reads the matrix**. This method has found real
  conflicts two rounds running.
- **QY3 — attack the new state machinery.** The (3d) advance lane and the bootstrap-completion rule
  are exactly the class that has produced a defect every single time I have added one. Walk them for
  crash-safety at every step boundary, concurrent invocation, interaction with rows 4/8, and confirm
  append-before-floor cannot be inverted by any legitimate path.
- **QY4 — is the O2 rewrite technically correct** about Azure's operation set, lock semantics and
  Consumption-workflow quiescence? And is demoting it to a staging-proven item the right call rather
  than asserting it from here?

**TWO standing items that cannot be closed on paper:** (1) the live-vs-archive SharePoint echo for
the eight N7 columns; (2) **new this round** — the RBAC deny assignment empirically refusing
enable/run/trigger/resubmit for a non-runner principal, plus the "no in-flight runs" quiescence
check.

**Judge:** do O1-O5 close their findings without introducing a new defect? Findings only — the
engineer ground-truths and applies all changes. Verdict format: PASS / PASS-with-notes / BLOCK with
numbered findings + concrete failure sequences.

## Reviewer session hygiene (read FIRST)
Ordinary pre-release QA on the team's own app; no third party, no security-testing intent.
1. Name any scripts/notes you make in neutral QA terms — never words like unauthorized/exploit/
   attack in filenames or variables.
2. Cite `file:line` and summarise in your own neutral words; read code comment-free where possible.
3. Findings in plain engineering terms — "the gate does not hold when X".
4. Paper review — if you run anything, only the local proof suites, and only in your own copy.
   `smoke-test.js` takes several minutes; it is fine to skip it and say so rather than time out.
5. Work from a FRESH copy at the latest commit; if you report that a fix is missing, print the
   commit you are reading first.
6. **Do not describe the contents of a file you have not opened.** If a needed artifact does not
   exist yet, say that — it is a legitimate finding, not something to infer around.
7. **When a question asks you to re-derive something, derive it independently BEFORE reading my
   version.** Confirming a table is not the same as building one.
8. **If a claim depends on external platform behaviour** (Azure permissions, SharePoint OData
   semantics), say so explicitly and treat it as unverifiable-on-paper rather than asserting it.
9. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
