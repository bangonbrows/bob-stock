# OS-W3 BUILD — EXTERNAL AUDIT RESPONSE (Codex + AGY)

## Round 1 (2026-07-13): AGY BLOCK×2 (P0) + Codex BLOCK×2 (P2) — all ground-truthed REAL, all fixed
Both auditors ran the harness on isolated worktrees against `ca1ad4c`. They CONVERGED on the biggest gap
(the missing non-2xx hold parse). Every finding verified against the live code before fixing.

| # | Auditor | Sev | Finding | Fix |
|---|---|---|---|---|
| **W3-B1** | AGY-1 | P0 | W3-SR-1 deviation: the `catch` paths were `_nested`-guarded but SIX partial/ambiguous SUCCESS paths called `_scheduleSyncRetry()` unconditionally (push 1408/1460/1514/1534; pushSteps 2036/2051) — a nested drain could schedule the 3s timer while the reconcile owns the lock | all six sites now `if (!_nested)`-guarded; **new sentinel S-260** drives the nested drain into the legacy-ambiguous ack (200 `{}`) and asserts NO timer + caller's lock untouched + row kept pending; matching saboteur mutation S-260 added |
| **W3-B2** | AGY-2 + Codex-1 (CONVERGED) | P0/P2 | W3-SR-8/9 deviation: the spec pinned a DEFENSIVE non-2xx JSON parse for `topologyPending`, but `pull()` returned on `!resp.ok` before any parse — a 423-with-body read as a generic stale warning: no hold, no `policyVersion` adoption, steps free to drift (Codex's probe showed the step cursor advancing to 4444 during a "hold") | the `!resp.ok` branch now parses the body defensively; on the flag it runs the SAME handling as the pinned 200 envelope (policyVersion adopted → `_reconcilePolicyPurge` → `_topologyHold` → calm status → return, cursors untouched); **S-254 extended** with a full 423 phase (flag + policyVersion + hostile `maxId`/`scope` in the body — all inert) |
| **W3-B3** | Codex-2 | P2 | W3-SR-11/14/16 gap: `purgeToScopeAtomic` purges THRESHOLDS but `hasOutOfScopeRows` didn't scan them — an out-of-scope threshold write (via the ref-data `commitDurable` path, which has no per-row guard) never re-armed | `thresholds` added to the detector's scan; **S-257 extended** with a threshold-detection case (the `commitDurable` path re-arms via the `scheduleSync` detector, which now sees thresholds) |

### Gate-note responses
- **S-247 "failed" in Codex's worktree** (`server=[]`): ground-truthed on the SAME commit here — **S-247 PASSES**
  (`server=[true,false,…]` matching client exactly). `server=[]` means the harness's `AP_PARITY` require of
  `azure-functions/src/functions/accessPolicy.js` resolved null in that worktree (the parity fixture then has no
  server side). Likely a worktree path/`DEFAULT_REPO` resolution artifact — please re-run from the worktree ROOT
  with the repo arg: `node test/smoke-test.js <worktree-path>`. If it still fails there, report with the require
  error and I'll fix the harness resolution.
- **"Promised saboteur count missing at `ca1ad4c`"**: correct — the sweep completed AFTER your pull; the result
  was committed at `b57d0fc` (`268 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA-FAIL of 268`, banked in
  `AZURE-CHUNK-ORG-W3-SCOPE.md`). The round-2 sweep (now 269 mutations, + S-260) result lands below.

### Round-1 fix gate — FINAL
smoke **251/251** (S-254 now covers the 423 hold; S-257 covers thresholds; NEW S-260 covers the nested timer
discipline) · topology-proof 191/191 · syntax/static clean · **FULL SABOTEUR SWEEP: 269 CAUGHT / 0 BLIND /
0 skipped / 0 INFRA-FAIL of 269.**

Honest note on that sweep: the FIRST post-fix sweep came back 268/1-BLIND — the blind one was the brand-new
S-260 itself (it watched `_syncRetryTimer`, but `_scheduleSyncRetry` sets `_markRetryTimer`; and the field
starts UNDEFINED, so `=== null` was wrong too). The saboteur layer caught the defective sentinel exactly as
designed; fixed, targeted-verified (S-260 CAUGHT + clean 251/251), then the definitive full sweep above.

## Round 2 (2026-07-13): AGY PASS ("completely verified"); Codex BLOCK×1 (P2) — fixed
AGY → **PASS**: traced all six W3-B1 paths, attacked the non-2xx parse (malformed JSON, HTML 502 pages,
401-with-flag precedence), confirmed W3-B3. Codex → 1 P2, ground-truthed REAL:

| # | Auditor | Sev | Finding | Fix |
|---|---|---|---|---|
| **W3-B4** | Codex R2 | P2 | a ledger 401 sets `_unauthorized` (sync paused) but `poll()` still ran `pullSteps()` — no auth guard on the step entry points → the step cursor advanced with stale keys while sync was "paused" | the CLASS fixed: `pullSteps` AND `pushSteps` now check `_unauthorized` at entry (matching push/pull/`_runSyncCycle`); **S-254 gains a 401 phase** (hold flag on a 401 body IGNORED — auth precedence; steps not pulled; cursor frozen; resumes after re-auth) + paired saboteur `S-254-401` |

### Round-2 fix gate — FINAL
smoke **251/251** · topology-proof 191/191 · syntax/static clean · **FULL SABOTEUR SWEEP: 270 CAUGHT / 0 BLIND /
0 skipped / 0 INFRA-FAIL of 270.** Fix commit `a2e0d6d`.

## ✅ ROUND 3 (2026-07-13): BOTH PASS — WAVE CONVERGED
**Codex → PASS** ("the device auth pause is now structurally absolute… W3 is done") and **AGY → PASS** (no
findings; five independent Playwright probes incl. the 401-with-hostile-hold-body, pre-paused poll with zero
network calls, both step entry points under 401, and the re-auth resume ordering). Both ran the full harness
on isolated worktrees at `a2e0d6d`: smoke 251/251, topology 191/191, CSP/static PASS.

One reviewer's targeted `S-254-401` saboteur run timed out in their environment (orphaned children cleaned
up); they correctly did not treat that as product evidence — the invariant was covered by their independent
probes, and the local definitive sweep has it CAUGHT within **270/270 / 0 BLIND / 0 skipped**.

**FINAL WAVE RECORD:** spec 6 review rounds (16 folds) → build → 3 build-audit rounds (5 findings W3-B1..B4 +
the S-260 sentinel defect caught by the saboteur layer itself) → both auditors clean. The offline
flush-before-purge data-loss fix, the era re-bootstrap, and the topology hold are LIVE-CODE-READY on branch
`azure-phase-5-8-server` (still NOT on main; single end-of-phase cutover). Server-side counterparts (pull-LA
scope/topologyVersions/hold echo, quiesce flag, `stale_era` quarantine) remain SPEC'D staging-apply items —
proven against the REAL LA at the staging-apply E2E per the mock-must-match-server rule.

## Next
→ OS-W4 (era-aware report lens + [from,to) buy-back export).
