# Azure Phase — Chunk Process (Scope → Commit)

**Status:** Standing reference. This is the process every Azure-phase chunk follows.
Ratified by Kunal 2026-07-03. Any change to this process gets edited here, not just agreed in chat.

Roles: **Claude = sole engineer** (writes all code). **GPT + Antigravity (AGY) = external auditors**
(report only, never edit). **Kunal = owner** (routes audits, makes gating decisions, authorises deploy).

---

## Per chunk

1. **Scope** — Claude writes `AZURE-CHUNK{N}-SCOPE.md`: what's being built, why, design options,
   and the decisions only Kunal can make.

2. **Spec audit** — the scope goes to GPT + AGY as a design review
   (`audit-artifacts/PASTE-TO-AUDITORS-CHUNK{N}-SPEC.txt`) **before any code**.
   They attack the design; Kunal makes the flagged decisions.

3. **Discover before touch (P-12)** — before changing anything existing, Claude maps how it
   currently works and ensures a sentinel covers current behaviour. No behaviour change without a
   covering sentinel first.

4. **Build (Mode A)** — Claude builds the whole wave autonomously, client + cloud, on **staging
   only**. Live is never touched; nothing is committed. Kunal reviews once at wave end.

5. **Prove it locally** — every change gets:
   - a **sentinel** (test proving the new behaviour), and
   - a **saboteur mutation** (deliberately breaking the code to prove the sentinel catches it).
   Then: full smoke suite green + scoped saboteur run (new mutations all CAUGHT / 0 BLIND) +
   real end-to-end probes against the actual staging cloud (never mocks — the mock-drift rule).

6. **Full sweep (Claude's local gate)** — the complete saboteur sweep (all mutations, every wave
   since the beginning) runs on Claude's machine ONLY. Expect all CAUGHT / 0 BLIND / 0 SKIPPED.
   **Never ask an auditor to run the full sweep** — each mutation spins a full Chromium smoke
   suite; the full set is impractical on an auditor box (GPT once churned 12+ hrs). Auditors get
   the completed log as evidence and may spot-check individual mutations.

7. **Wave review + code audit** — Claude writes the wave review pack
   (`AZURE-CHUNK{N}-WAVE-REVIEW.md`) + the auditor paste-note
   (`audit-artifacts/PASTE-TO-AUDITORS-CHUNK{N}-CODE.txt`); Kunal routes it to GPT + AGY.
   Auditors **run**, never just read:
   - the full smoke suite (all sentinels),
   - the **scoped saboteur sweep** — only the mutations touched by this wave's edits,
   - real probes against the actual staging cloud (Node/browser driving the real endpoints).
   They report observed numbers only. No editing, ever.

8. **Triage** — every finding is verified before fixing ("make sure we need these fixes").
   Disagreements are ground-truthed by Claude actually running the scenario. False positives are
   documented with evidence, not fixed.

9. **Fix everything** — all confirmed findings fixed in one batch (no cherry-picking), each with
   new sentinels + mutations, re-proven locally (smoke + scoped saboteur + full sweep re-run),
   then a re-verify note goes back to the auditors
   (`audit-artifacts/PASTE-TO-AUDITORS-CHUNK{N}-REVERIFY.txt`).

10. **Convergence gate** — after the fixes, both auditors re-run the full works, not just eyeball
    the diff: smoke suite + **scoped saboteur mutations** (only the ones covering that round's
    fixes) + re-drive the real staging cloud end-to-end. The chunk is NOT clean until **both**
    independently come back with matching clean numbers. Then the chunk goes on **HOLD**.

---

## Anti-clash rules (apply to EVERY audit hand-off, steps 2, 7 and 10)

GPT and AGY often run concurrently. Every paste-note must enforce:

- **Harness isolation:** each auditor runs on their OWN copy of the repo — never Claude's live
  working tree (an auditor once trampled an uncommitted sentinel). Claude commits or stashes
  before hand-off so auditor runs start from a known tree.
- **Saboteur concurrency:** auditors cap `SABOTEUR_CONCURRENCY=5` so both can run at once.
- **Cloud namespacing:** every test id is prefixed `gpt_` / `agy_` (transfer ids, RecordIds,
  StepIds, TransactionIds, store/product test values). The staging lists enforce unique keys —
  without prefixes, one auditor's row shows up as the other's false "duplicate".
- **SharePoint protection:** functional probes only, NO load tests. The staging Logic Apps share
  one `sharepointonline` connection with the LIVE Logic Apps; high-volume concurrent seeding can
  throttle it and cause transient 429s on live sync.

---

## End of phase (all chunks on HOLD)

11. **6-way blind audit** — six unprimed auditors (GPT, AGY, Claude — app + CLI each) on a
    de-primed tree with no knowledge of what was fixed (P-17: primed auditors confirm what
    they're told is fixed).

12. **Cleanup** — remove test rows from staging lists, delete the read-only auditor credential,
    rotate the automation secrets.

13. **Commit + cutover** — ONE single commit/deploy, only with Kunal's explicit OK. Never before.

14. **Bank the lessons** — every learning goes back into the audit framework (monotonic growth),
    and the project log gets its row.
