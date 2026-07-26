# REVIEW PACK — Contract 2 INTERIM LA REVIEW · ROUND 6

**Context.** Routine internal pre-deployment review for our own stock-management app (Bang on
Brows, Perth; reviewers and engineer all work for the owner). The Contract 2 correction-approval
DESIGN converged 2026-07-25. This is the interim paper review of the CONCRETE staging artifacts
BEFORE the owner applies them to staging.

**Round 5 outcome: Codex BLOCK×3 — all three real and fixed. AGY PASS.** Codex confirmed I2 closed,
confirmed the conditional-canonical rejection was sound reasoning, and confirmed the pinned
`Call_compute` body matches what the code reads.

**All three findings were defects in the previous round's own fix** — the "closed-world" phase
matrix I introduced in R4 was neither closed nor complete, and its central justification was wrong:
1. **It excluded the ordinary starting state.** A virgin system matched no row and fell through to
   `INCONSISTENT`, so a fresh runner would HALT before it could begin. A crash partway through the
   quiescence step did the same, permanently.
2. **The correction LA was missing from the fence and the matrix.** It writes control rows into the
   target's own list — direct-to-archive for archived targets — so it is a ledger writer that can
   advance the archive boundary and, deployed enabled too early, can put a control row into Live
   that the untransformed pull LA would deliver to devices as a phantom stock movement.
3. **A Function rollback was invisible to phase authority**, which reads writer state only. After
   cutover a rollback still resolved to POST while the Logic Apps called an incompatible build.

Fold record: **§N**. Suite 158 → **161/161**; all regression gates green.

**This is the second consecutive round where the fix, not the original design, was the defect.** So
this round I am explicitly asking you NOT to check my table.

**Read (in your own copy of the repo, branch `azure-phase-5-8-server`, latest commit):**
1. `AZURE-CHUNK-ORG-C2-LA-CHANGES.md` — **§N is the R5 fold record; §O is this round's questions
   QO1-QO5.** §D carries the corrected matrix, the PRE-QUIESCENCE state, the build-identity lane and
   the pinned (6a)/(6b) order; §B step 16 is the N1 write that made it a ledger writer; §F/§H/§J/§L
   are the earlier fold records.
2. The amended code (161/161 local probes): `azure-functions/src/functions/snapshotCompute.js`
   (⚠ still a flagged amendment to the audited Chunk-8 surface) ·
   `azure-functions/src/functions/correctionCompute.js` · `test/correction-proof.js` (sections
   14-18) · `test/archive-carry-proof.js`.
3. For grounding: `AZURE-CHUNK-ORG-W44-C2-DESIGN.md` · `audit-artifacts/archive-def-current.json`.

**What I most want from this round:**
- **QO2 — re-derive the matrix from scratch; do not check my rows.** Enumerate the states a
  legitimate prefix of §D can actually reach, confirm each maps to exactly one row with a forward
  action, and confirm everything I send to `INCONSISTENT` is genuinely unreachable legitimately.
  Two rounds running, the state machine has been wrong in a way that checking-the-table missed.
- **QO3 — is `{C2 archive LA, N1}` the COMPLETE set of boundary-advancing writers?** I got this set
  wrong last round. Name any other writer, LA, or path that can create an archive-list row or mint
  an above-epoch id.
- **QO4 — is a self-reported `buildStamp` adequate authority for phase?** This project's own
  principle prefers non-forgeable ledger state over markers (C2-R19-1/C2-R24-1), and I have just
  introduced a marker. If that is the wrong instrument, say what observable would be right.

**Standing item neither of you can close on paper** (§N): the real live-vs-archive SharePoint echo
for the eight N7 columns — absent vs null vs `''`. A staging probe before the first live archive
run; if they differ, normalise at the read shape, never loosen the canonical.

**Judge:** do J1-J3 close their findings without introducing a new defect? Findings only — the
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
7. **When a question asks you to re-derive something, derive it independently before reading my
   version.** Confirming a table is not the same as building one.
8. If interrupted, note WHERE you stopped first so the next session resumes from a checkpoint.
