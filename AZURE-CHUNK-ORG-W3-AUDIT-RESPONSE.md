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

## Next
Codex + AGY round-2 re-check on the fix commit. Per the convergence rule: loop until BOTH clean.
