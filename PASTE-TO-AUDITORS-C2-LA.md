# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 9

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25 and has not been in question since. This is the interim paper review of
the CONCRETE staging artifacts — in practice, of the CUTOVER RUNBOOK.

**Round 8 outcome: BOTH BLOCKED — AGY×1 + Codex×4 = 4 distinct (1 converged). All real, all fixed.**

**Disjointness is now PROVEN — by both of you, independently and mechanically** (AGY 36 pairs, Codex
72 ordered pairs). The rows-1/2 overlap that survived two rounds is dead, and the block has moved
from OVERLAP to COMPLETENESS. That is real progress: the table is well-formed, and what remains is
which states it forgets.

The four:
1. **[both of you] The repair row stopped owning repair the moment its own deploy succeeded.** It
   required `build = not reviewed`, but its action deploys the reviewed build — flipping that fact
   before any writer is restored. The result matched no row and halted permanently, *immediately
   after successfully deploying the correct package*, with production stranded fully quiesced.
2. **An unmapped both-enabled/pre-stamp state on the FIRST cutover** — the stamp write and the
   writer enables were separate mutations, so a timed-out stamp left an ordinary prefix homeless.
3. **A monotonic revision inside an overwriteable singleton is not replay-safe** — restoring the
   complete, still-valid revision-1 tuple *and its signature* over revision 2 verifies perfectly.
   You also correctly caught that my "replay" probe was not one; it tested tampering.
4. **The N19 bootstrap was missing entirely** — a virgin run could never make the `build` fact true,
   so it would redeploy the same package forever.

**Root cause of 1 and 2, fixed structurally rather than patched:** `cutoverCompletedAt` was stamped
AFTER the boundary writers went live, so writer-state and marker always disagreed for a window and I
kept adding rows to cover symptoms. **The stamp now happens BEFORE either boundary writer is
enabled**, making it a monotonic latch: `C` absent ⇒ no boundary writer has ever been enabled ⇒ the
sealed boundary is exact. That collapses every partial-enable and post-repair state into one row and
takes the table from 9 rows to 8.

Fold record: **§T**. Suite 169 → **171/171**; all regression gates green.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§T is the R8 fold record; §U is this round's questions
   QU1-QU5.** §D carries the 8-row table, the new (3c) bootstrap action, and the append-only N19.
   §A carries `BuildApprovals_Staging`. §F/§H/§J/§L/§N/§P/§R are the earlier folds.
2. The amended code (171/171 local probes): `azure-functions/src/functions/snapshotCompute.js` ·
   `azure-functions/src/functions/attestRows.js` · `test/correction-proof.js` (sections 14-20 — note
   the corrected replay probes).
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json`.

**What I want this round:**
- **QU2 — completeness, mechanically, on the 8-row table.** Disjointness is settled; this is the
  only open structural question. Walk every legitimate prefix INCLUDING a crash between each of
  (6b-i)/(6b-ii)/(6b-iii) and each of the three repair toggles.
- **QU3 — attack the latch premise directly.** The whole fix rests on "`C` absent ⇒ no
  boundary-advancing writer has ever been enabled". Is that invariant actually guaranteed by the
  pinned order? Is there any path — a manual enable, a partially-succeeded stamp write, an LA
  enabled outside the runner — that breaks it? If that premise is false, the fix is worthless.
- **QU4 — is append-only N19 + highest-valid + retained high-water sufficient**, is the (3c)
  bootstrap correct and re-runnable, and is the stated P-13 residual (a SharePoint-direct actor
  deleting the newest approval rows) the right boundary to accept?

**Standing item neither of you can close on paper:** the real live-vs-archive SharePoint echo for the
eight N7 columns (absent vs null vs `''`). Staging probe before the first live archive run.

**Judge:** do M1-M4 close their findings without introducing a new defect? Findings only — the
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
   version.** Confirming a table is not the same as building one. If your derivation agrees with
   mine, say what you did to test it, not just that it agrees.
8. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
