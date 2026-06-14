# BOB Stock App - Audit-of-Audit Report - GPT Codex

Date: 2026-06-05
Auditor role: process auditor / audit auditor
Scope: the GPT Codex external audit process that produced `EXTERNAL-AUDIT-GPT-CODEX-FINAL-2026-06-05.md`
Target repo: `C:\Users\joshi\repos\bob-stock`

## Verdict

The previous GPT Codex audit is valid as a **blocking rejection audit**. It found three Chromium-backed P1 blockers and correctly said the fixed code was not ready for alpha/beta.

It is **not** valid as a clean final sign-off. The previous report explicitly said it stopped below the framework floor, and this process audit confirms that several audit-system loopholes remain. Treat the prior report as: "ship is blocked for proven reasons." Do not treat it as: "everything else is clean."

Process status: **BLOCKED FOR CLEAN SIGN-OFF** until the hardened process below is followed after the app fixes land.

## Evidence Reviewed

- `PASTE-TO-GPT-v2.txt`
- `EXTERNAL-AUDIT-BRIEF-v2.md`
- `STOCK-AUDIT-FRAMEWORK.md`
- `CANONICAL-INVARIANTS.md`
- `LENS-CATALOGUE.md`
- `META-AUDIT-of-the-audit.md`
- `EXTERNAL-AUDIT-GPT-CODEX-FINAL-2026-06-05.md`
- Current repo branch/status/file hashes

Current code snapshot observed during this process audit:

```text
Branch: fix/cli-tri-audit-2026-05
Base:   005caee T3-M3r1: Dead code removal + 4 audit fixes + 3 revision fixes
Status: dirty working tree

index.html SHA256 BE620EC8DAFCEE0A94FE6B6C4FB81F444023FC1703397C5CE2DCA9E7CCD8A6AA
phase2.js  SHA256 EA514E3B1D3F0443CB7C20E98F398F14708C744131D70DE0A090B088567D8465
db.js      SHA256 19664C312FCB314A4E78FD28B644D115C1BA2CC6CD4A02B4AB4ADF0B39318F6B
sync.js    SHA256 9278184EC4D6F01CCD5E29ECAC059B68408AD630B48ED4A73AFA97272FF6712C
sw.js      SHA256 169B96C341B431BF2FD5B1B1C9F34FB1B38C5DEF6A7124A4F249E3A675ECF03C
```

## Process Findings

### PA-001 - BLOCKER - Blocking audit can be mistaken for clean sign-off

The prior report found real P1s and correctly blocked deploy, but it did not complete the full framework floor. The report says: "This is not a complete clean-signoff pass under the framework's 950-probe floor." It also says: "I stopped at a blocking report."

This is defensible only if the artifact is labeled and used as blocker triage. It is a process loophole if anyone reads it as a final external sign-off.

Required closure: split future report statuses into `BLOCKING PARTIAL`, `FULL SIGN-OFF`, and `FULL SIGN-OFF FAILED`. Only `FULL SIGN-OFF` may support alpha/beta readiness.

### PA-002 - BLOCKER - Exact evidence is not reproducible enough

The previous audit report includes JSON evidence, but it does not save the exact probe scripts, raw command transcript, browser context settings, screenshots/videos for UI findings, or a manifest mapping every probe to its source file and output.

The repo is also a dirty working tree, so branch/base alone is insufficient to pin the audited code. This process audit captured SHA256 hashes, but the original report did not.

Required closure: every future audit writes an artifact folder containing `manifest.json`, probe scripts, raw stdout/stderr, screenshots/videos where UI is involved, file hashes, git status, and the final report.

### PA-003 - BLOCKER - Lens x surface matrix is incomplete

The Stock framework says every lens from `LENS-CATALOGUE.md` must be walked against every surface, and empty cells block ship. The previous report has a useful `Lens x Surface Summary`, but it lists only six lenses and does not include a full lens-by-surface grid.

That is enough for a blocker report, not enough for final clean sign-off.

Required closure: use a machine-readable matrix with one row per `lens x surface x boundary`, with status `runtime-probed`, `static-only`, `not-applicable`, `blocked`, or `not-tested`. Any `not-tested` cell blocks sign-off.

### PA-004 - BLOCKER - The audit proved instances, not full classes

The previous report proved three important classes:

- credential-bearing user objects in some transaction rows;
- ref-data false success for a supplier save;
- import/localStorage XSS through one product-name render path.

It did not dynamically prove the whole sibling population for each class. It explicitly says it did not enumerate every raw sink and did not complete the full seven-pass floor.

Required closure: for every confirmed class, enumerate the full population and run at least one runtime probe per sibling family. Examples: every `by` writer, every `DB.commit()` user-facing save, every backup/import/load/migration boundary, every raw product/store/category/productType/id sink.

### PA-005 - BLOCKER - Banked meta-audit categories were outside the previous pass

The framework now includes Passes H, I, and J because the prior seven-pass system missed real categories:

- environment/boot/third-party trust;
- authorization map from the console;
- business-logic end-state and financial correctness.

The previous GPT report did not execute those passes. It found external blockers, but it did not incorporate the newly banked categories into a final sign-off run.

Required closure: after fixes, run the revised 10-pass floor, not the older 7-pass floor. Current floor is approximately 1,210 probes across A-J.

### PA-006 - HIGH - Email push-ack design ruling was not scenario-probed deeply enough

The prior report gave a design ruling on email-after-local-durable-save vs push-ack, and respected the brief's deferral. It did not run a full scenario table for durable save success, push failure, email success/failure, user retry, duplicate prevention, and later sync reconciliation.

Required closure: add an outbox/side-effect probe matrix before beta. The minimum matrix is:

- durable write fails: no email;
- durable write succeeds, push succeeds, email succeeds: one email;
- durable write succeeds, push fails, email succeeds: user-visible pending sync, no hidden duplicate on retry;
- durable write succeeds, push succeeds, email fails: retry semantics documented;
- duplicate transfer submit/retry: exactly one side-effect.

### PA-007 - HIGH - Harness green was over-weighted without coverage measurement

The prior report ran smoke and saboteur successfully. That is useful, but the framework and meta-audit warn that green harness output only proves known sentinels stayed green/red. It does not prove broad code coverage.

Required closure: add coverage instrumentation or at least a function/branch execution ledger for each pass. Report untouched functions and branches. Add S-15/S-16/S-17 for the external findings before treating the harness as a release gate.

### PA-008 - HIGH - UI finding lacked screenshot/video artifact

The framework requires screenshot/video if the finding is UI. GPT-EXT-003 is a UI stored-XSS path; the JSON proof is strong, but no screenshot/video was saved.

Required closure: keep JSON evidence as primary proof, but save a screenshot or short trace for every UI/DOM finding.

### PA-009 - HIGH - No clean golden-path shop workflow was run as an explicit sign-off gate

The previous audit ran technical smoke/saboteur tests and adversarial probes. It did not separately document the golden shop-floor workflow from fresh boot through normal staff/director operations.

Required closure: after fixes, run a clean happy-path workflow: fresh profile, app boot, login, movement, delivery, stock-take, transfer create/receive, dashboard/report render, offline/online sync indicator. This is not a replacement for adversarial probes; it is a separate product-works gate.

### PA-010 - MEDIUM - Peer convergence was intentionally deferred, but must happen before final process closure

The prior run correctly stayed independent and did not inspect Gemini/peer findings. That is right during parallel external audit. It becomes a loophole if no later convergence step maps solo and shared findings.

Required closure: after both external reports exist, run a convergence table: finding, auditor, surface, invariant, why other auditors missed it, new lens/sentinel/framework update.

### PA-011 - MEDIUM - Real backend contract remains outside the automated probe model

The brief correctly forbids probes from hitting real Logic Apps. The meta-audit also notes that mocked Logic Apps cannot prove the live SharePoint/Logic App field mapping contract.

Required closure: keep automated probes fully mocked, but add a separate controlled pre-go-live backend contract smoke with test-only data and explicit operator approval. This is a deployment readiness gate, not an auditor probe.

### PA-012 - MEDIUM - Verify scaffold drift was accepted without a replacement static gate

The v2 brief says `verify-app.js` scaffold drift is deferred. The previous report followed that instruction. The loophole is that no replacement static release gate was named for file size, service worker cache shape, manifest sanity, and script/resource loading.

Required closure: either update `verify-app.js` to current reality or write `verify-release.js` and make it explicit which static checks gate ship.

### PA-013 - LOW - Instruction order conflict was not reconciled in the report

The user's wrapper, `PASTE-TO-GPT-v2.txt`, and `STOCK-AUDIT-FRAMEWORK.md` do not state the same read order. The previous report listed what was read but did not call out that hierarchy conflict.

Required closure: future audits should log authority order when instructions conflict: user request, then PASTE file, then current v2 brief/decision log, then framework docs, with the stricter rule winning.

### PA-014 - LOW - Test setup artifacts were left in the working tree

The prior report disclosed `node_modules` and `package-lock.json` under `test/` from `npm install`. This is not a product defect, but it adds noise to later git status and can confuse exact snapshot review.

Required closure: use an artifact/cache policy for test dependencies, or explicitly list setup artifacts in the report and clean them only with owner approval.

## Hardened Audit Protocol

Use this protocol for the next post-fix audit. It closes the loopholes above.

### Phase 0 - Freeze the target

1. Record branch, base commit, full `git status --short`, and SHA256 for the five audited files.
2. Create an audit artifact folder, for example `audit-artifacts/2026-06-05-gpt-final-signoff/`.
3. Save every script, command, raw output, screenshot/video, and report into that folder.
4. Fail closed if the working tree changes during the audit unless the change is explicitly part of a new audited snapshot.

### Phase 1 - Run blocker triage

1. Run `npm.cmd run smoke`.
2. Run `npm.cmd run saboteur`.
3. Run targeted high-risk probes for recently fixed classes.
4. If any P0/P1/P2-block is proven, publish `BLOCKING PARTIAL` and stop only after the finding has full evidence and sentinel recommendations.

### Phase 2 - Run full clean sign-off only after blockers are fixed

1. Execute Passes A-J, not just A-G.
2. Meet the current floor: about 1,210 distinct runtime probes.
3. Build the full lens x surface x boundary matrix.
4. Record coverage/untouched-code evidence.
5. Use Perth as primary timezone, plus Sydney and UTC for timestamp-sensitive probes.
6. Keep Logic Apps mocked and assert no real external email/push endpoint is hit.
7. Use desktop, iPhone SE, and Pixel 5 contexts for UI/PWA/mobile surfaces.
8. Run multi-tab and shared-sync mock scenarios for concurrency surfaces.
9. Save UI screenshots/videos where the finding or confirmation is visual/DOM-backed.
10. Run the clean golden-path shop workflow.

### Phase 3 - Close every class, not just every instance

For each finding class, produce a population table:

- all writers;
- all readers/renderers;
- all import/export paths;
- all sync ingest/egress paths;
- all backups/migrations;
- all role entry points;
- all sentinels and saboteurs.

No class is closed until every sibling is fixed or deliberately deferred with owner sign-off.

### Phase 4 - Converge auditors

1. Compare GPT, Gemini, internal, and meta-audit findings after independent runs are complete.
2. For every solo finding, ask why the other processes missed it.
3. Add a lens, invariant, sentinel, or saboteur for the missed class.
4. Require two consecutive external rounds with no P0/P1/P2-block and no new lens class before calling the audit process clean.

## Bottom Line

The audit process did catch serious hidden bugs. That part worked.

The loophole is procedural: the process can still stop too early, under-document probes, over-trust green harness output, and leave whole unprobed categories outside the final sign-off. The fix is not "more confidence"; it is a stricter artifact-backed 10-pass sign-off protocol with full class closure and convergence.
