# AUDIT PACK — Org-Structure chunk, WAVE 3 (client sync hardening) — Codex + AGY

**You are auditing the OS-W3 BUILD** — the first org-chunk wave that edits the LIVE sync engine (`sync.js` +
`db.js`). The design you unanimously converged after 6 scope-review rounds (16 folds, W3-SR-1..16) is now
implemented. Your job: verify the CODE faithfully implements the LOCKED SPEC, and try to break it.
Branch `azure-phase-5-8-server`, build commit **`7aa4733`**. Both auditors run in parallel.

## Non-negotiables (framework rules)
- **RUN it, don't just read it.** The smoke harness drives the REAL app (Playwright + real IndexedDB):
  `cd test && node smoke-test.js` → **250/250** on clean code, including the 10 new W3 sentinels
  (S-250..S-259). Write your OWN adversarial probes — mock the pull/push endpoints per the sentinels'
  pattern (route `**sw3pull.test**` etc.) and drive `Sync.poll()` / `DB.purgeToScopeAtomic` directly.
- **Report ONLY.** Numbered findings (P0-P3 + concrete repro). Claude ground-truths every finding.
- **Isolate your worktree.** Your own copy, never the shared tree.
- **The spec is the requirement:** `AZURE-CHUNK-ORG-W3-SCOPE.md` (status: CONVERGED @ `dcceaf8`). Verify each
  fold W3-SR-1..16 is implemented EXACTLY as pinned — any deviation is a finding even if it "looks fine".

## What was built (map)
| Piece | Where | Fold(s) |
|---|---|---|
| `_nested` push/pushSteps + `_drainPendingLocked()` | sync.js (push ~1252, pushSteps ~1960, drain ~2065) | W3-SR-1 |
| pull page-1 PINNED ORDER: policy → hold → scope | sync.js ~1660-1690 | W3-SR-4/8/9/12/13 |
| `_reconcileScope` (topo map, flush-first, late-row re-arm) | sync.js ~1895 | W3-SR-3/5/7/11 |
| `pullSteps()` entry guard (hold + purge-pending) | sync.js ~2078 | W3-SR-10/15 |
| scheduleSync + local-write re-arm | sync.js ~2155/~975 | W3-SR-14 |
| egress rows durably `_rejected` | sync.js ~1310 | W3-SR-6 |
| `purgeToScopeAtomic` (ONE rw txn: read+predicates+throw+rewrite) | db.js ~381 | W3-SR-2/3/5 |
| `_scopeGuardOnWrite` in EVERY durable writer | db.js (9 writers) | W3-SR-16 |
| `hasOutOfScopeRows` / `reArmScopeIfOutOfScope` | db.js | W3-SR-11 |
| Sentinels S-250..S-259 (+ S-222/S-223 disk-seeded) | test/smoke-test.js | all |

## Attack these
1. **The lock discipline (W3-SR-1):** `_nested` mode must NEVER touch `_syncLock`, never schedule the retry
   timer, never `_drainSyncQueue`. Trace every exit path of `push(_isRetry,_nested)` incl. 401, egress-only
   batches, markSynced failure, ambiguous ack. Can any nested path release the caller's lock or deadlock?
2. **The atomic purge (W3-SR-2):** is the read+diff+rewrite REALLY one Dexie txn (no `await` escaping the
   zone)? Do the per-table predicates match the spec pins (transactions/recordSteps per-row; metadata tables
   ride on them)? Can `wipeStores` drop a pending row? Can a thrown predicate leave partial state?
3. **Ordering (W3-SR-4/9):** can ANY page-1 outcome (hold, scope abort, purge failure, malformed body) skip
   the policyVersion check or `_reconcilePolicyPurge`? Try a hold envelope WITHOUT policyVersion.
4. **The hold lifecycle (W3-SR-13/15):** sticky-flag scenarios — hold → network error → normal; hold → scope
   change; reload mid-hold; follower tabs during a hold. `pullSteps` guard vs `init()` direct path.
5. **The re-arm net (W3-SR-11/14/16):** find a durable write path NOT covered by `_scopeGuardOnWrite` or the
   scheduleSync/local-write/page-1 detectors. Check phase2.js callers, Records writers, restore/import paths.
6. **Envelope pins (W3-SR-8/12):** feed maxId/scope on a hold body — cursor must not move, purge must not run.
   Non-2xx JSON with the flag. Legacy-client simulation (does a 200-empty hold harm the CURRENT deployed code?).
7. **Regressions:** normal sync cycles, transfer lifecycle, deletes/tombstones, backup/restore, the AA policy
   purge — anything the 250-sentinel gate might not cover. The change-safety concern: `push`/`pushSteps` got a
   new parameter; every legacy call site passes fewer args (verify no behavioural drift).

## Gates already green (verify, don't trust)
smoke **250/250** · topology-proof **191/191** · CSP + static PASS · call-graph sweep clean · full saboteur
sweep: running at hand-off — its result is in the wave-review doc by the time you read this.

## Verdict
PASS / PASS-with-notes / BLOCK, numbered findings with concrete repros (a mocked envelope + state that
produces the wrong local outcome, or a spec fold the code deviates from).
