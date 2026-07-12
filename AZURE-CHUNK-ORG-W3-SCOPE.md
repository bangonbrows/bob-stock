# OS-W3 SCOPE — Chunk-10 companion: offline flush-before-purge + era-aware re-bootstrap (CLIENT)

**Status:** SCOPE REVIEW R4 FOLDED (2026-07-12) — R1: Codex×5 + AGY×3 → W3-SR-1..8; R2: converged TOCTOU
amendment + Codex×2 → W3-SR-9/10; R3: AGY PASS + Codex×3 → W3-SR-10 amended, W3-SR-11/12; R4: AGY PASS + Codex×2 → W3-SR-13/14; **R5: AGY PASS (third consecutive, "completely airtight"); Codex×2 →
W3-SR-15 (`_topologyHold` clears only on a non-hold, NON-ABORTING page-1; `pullSteps()` also suppresses while
purge-pending) + W3-SR-16 (the detector moves to the DB LAYER — `DB._scopeGuardOnWrite` in every durable
writer; draft-transfer writes bypassed `scheduleSync`)**. ALL ground-truthed REAL. Awaiting R6 → build.
**Touches:** `sync.js` + `db.js` (**the LIVE sync engine** — first org-chunk wave that edits live-app files).
Branch `azure-phase-5-8-server`; nothing deploys until the end-of-phase cutover.
**Spec anchors (converged):** OS-SR-5 (push-before-purge), OS-SR-5/7 amendment (bounded drain window),
OS-SR-10 (server-authorized one-shot old-era flush; `stale_era` quarantine), OS-SR-6 (device-bound roles see
the current era only), OS-SR-1 (pull fails closed while `topology_pending`). LA-side counterparts stay
staging-apply items — **W3 builds the CLIENT side**, safe with today's LAs AND the future ones.

## The mapped ground truth (file:line, verified 2026-07-12)

**GAP-1 — offline data loss on scope change (the headline bug).**
- `poll()` runs `pull()` FIRST (sync.js:2197); pending pushes drain only AFTER (sync.js:2204).
- `pull()` → `_reconcileScope` (sync.js:1656 → 1881) → `DB.purgeToScope` (sync.js:1889) with no pre-flush.
- `DB.purgeToScope` (db.js:381) filters by store membership only — no exception for un-uploaded rows.
- Net: unsent offline entries for a store leaving scope are deleted before ever being pushed.

**GAP-2 — era changes with an unchanged store list never re-bootstrap.**
- Only trigger = sorted-StoreIds signature (sync.js:1883). CONVERT/BUYBACK keeps a POS's StoreIds identical →
  no purge, no cursor reset, prior-era data lingers (violates OS-SR-6).

**GAP-3 — no client handling for the fail-closed topology window.**
- A quiesced store's failed pull is a generic "stale" warning (sync.js:1642-1645); no hold semantics.

## SCOPE REVIEW R1 (2026-07-12): Codex BLOCK×5 + AGY×3 — all REAL, all folded

| # | Auditor | Finding (ground-truthed) | Fold |
|---|---|---|---|
| **W3-SR-1** | Codex-1 | `_reconcileScope` runs INSIDE pull's `_syncLock` (set sync.js:1608); public `push()` no-ops under the lock (sync.js:1255) and `pushSteps()` always does (sync.js:1926) → the designed flush would silently skip and the device locks forever | the flush uses a NEW lock-aware internal drain primitive (`_drainPendingLocked()`) that runs the push bodies re-entrantly under the already-held lock (the `_isRetry` pattern, sync.js:1254), never the public entrypoints; sentinel S-W3-1 must exercise the REAL poll path (lock held) |
| **W3-SR-2** | AGY-1 → **AMENDED R2 (AGY + Codex converged)** | multi-tab TOCTOU: `purgeToScope` diffs + rewrites from the LEADER's in-memory `_cache` (db.js:393). **R2 falsified the R1 fold**: `DB.refresh()` (db.js:1153) and `_persistAllToDexie` (db.js:63) are SEPARATE IndexedDB transactions — a follower commit in the gap between them is annihilated by the `clear()`+`bulkPut()` rewrite, and a post-persist re-check finds 0 pending (the row is already gone) | **SINGLE ATOMIC Dexie `rw` TRANSACTION**: a new `DB.purgeToScopeAtomic` performs (1) the disk READ of every sync table, (2) the per-table pending-predicate evaluation, (3) abort-by-throw if ANY pending row would drop, (4) the `clear()`+`bulkPut()` of filtered rows — ALL inside ONE `bobDB.transaction('rw', …)` block, so the native IDB lock (Dexie zone keeps it alive across the callback) excludes follower writes for the whole critical section; the in-memory cache reloads AFTER commit; S-W3-2 lands a follower write in the old refresh→persist window and proves it survives (txn serialises it before or after, never inside) |
| **W3-SR-3** | AGY-2 | POS old-era leak: an era bump with the store still IN scope purges NOTHING (`allow.has` keeps it, db.js:386) → the incoming owner's device retains the ex-owner's full local ledger (OS-SR-6 violation) | on a `topologyVersion` bump, `_reconcileScope` passes the affected store(s) as an explicit `wipeStores` argument; `purgeToScope(scopeArr, {wipeStores})` drops those stores' rows EVEN THOUGH in-scope (after the same flush-first + unsynced guard), so the new era pulls onto a clean slate; S-W3-4 asserts the old-era rows actually LEFT Dexie |
| **W3-SR-4** | AGY-3 | policy-purge starvation: `_reconcileScope`'s early `return` (sync.js:1656) — and the new topology hold — skip the AA `policyVersion` check + `_reconcilePolicyPurge` (sync.js:1660-1666); a stuck scope purge (days offline) leaves a demoted user with elevated cost visibility | REORDER: the policyVersion check + `_reconcilePolicyPurge` run BEFORE `_reconcileScope` and unconditionally on every page-1 pull (they are field-level and independent of store scope); no scope/topology outcome may starve them; new sentinel S-W3-7 |
| **W3-SR-5** | Codex-2 | the unsynced-row guard is underspecified for tables without transaction-style flags: `purgeToScope` also drops stockTakes/deliveries/thresholds/transfers (db.js:396-400) which carry no `_synced`; a mechanical `!_synced` check blocks forever on historical rows | PER-TABLE pending predicates, pinned here: **transactions** `!_synced && !_rejected`; **recordSteps** `!_synced && !_rejected`; **transfers** pending iff any of its record-steps are pending (steps are the sync vehicle) or legacy in-flight status (`draft/submitted` with unsynced ledger rows); **stockTakes/deliveries/thresholds** are DERIVED/legacy metadata whose durable representation is the ledger + steps — droppable once their expectedLedgerKeys/step rows are synced, else pending; sentinels cover a synced legacy delivery/stockTake/transfer (purge proceeds) AND an unsynced recordStep (purge refuses) |
| **W3-SR-6** | Codex-3 | egress-invalid local rows are excluded from push with only a console log (sync.js:1303-1310) — never durably `_rejected` → the purge guard would block forever on rows the server will never see (livelock, not loss) | the egress filter now durably marks excluded rows `_rejected:'egress-invalid'` (same persistence path as server rejections) so they surface in the existing rejected-rows status AND become purge-droppable; S-W3-3 includes a local egress-invalid row |
| **W3-SR-7** | Codex-4 | a scalar `bob_topo_ver` misses multi-store era changes (store A at v10, store B bumps 2→3 — a scalar/max stays 10, B never re-bootstraps) | `bob_topo_vers` is a JSON MAP keyed by storeId (`{"boor":3,"karr":10"}`); the reconcile compares PER STORE and wipes exactly the bumped store(s); sentinel: the LOWER-version store changes while the max does not |
| **W3-SR-8** | Codex-5 | `topologyPending` had no pinned HTTP/envelope contract; the live client returns before JSON on non-ok (sync.js:1642) so a 423-with-body would read as a generic failure; a 200-body mock would pass while the real contract fails | PINNED CONTRACT: the pull LA signals a quiesced store with **HTTP 200** + `{topologyPending:true, items:[], policyVersion:<current>}` — deliberately 200 so TODAY'S deployed clients treat it as a harmless empty pull (no rows served = fail-closed, no cursor damage), and W3 clients show the hold. The client ALSO defensively parses a non-2xx JSON body for the flag (belt-and-braces). S-W3-5 pins both the 200-envelope and the non-2xx defensive path; the staging-apply E2E proves the REAL LA emits it (mock-must-match-server rule) |
| **W3-SR-9** | Codex R2-2 | the R1 hold envelope OMITTED `policyVersion` — a Director demotion landing while the store is topology-pending gives the client no bump signal (`_reconcilePolicyPurge` only retries an ALREADY-SET pending flag, sync.js:482; it doesn't discover a new policy) → revoked cost visibility persists for the whole hold | the hold envelope CARRIES `policyVersion` (added to the pinned contract above) and the client processes the policyVersion check on hold responses exactly as on normal page-1 pulls (W3-0 ordering); S-W3-7 gains a topology-hold + policyVersion-bump case |
| **W3-SR-10** | Codex R2-3 → **AMENDED R3** | the hold was specified for the LEDGER pull only; `poll()` runs `pullSteps()` right after (sync.js:2198) with its own endpoint + cursor (`bob_last_step_sp_id`, sync.js:2059) → step metadata for the quiesced store could merge and the STEP cursor advance while the ledger is fail-closed. **R3: gating only `poll()`/`_runSyncCycle` missed `init()`'s first-run path, which calls `pull()` then `pullSteps()` DIRECTLY (sync.js:2279, 2282)** | the suppression lives INSIDE `pullSteps()` itself — an entry guard `if (this._topologyHold) return;` — so EVERY caller (poll, cycle, init, any future sequence) is covered by construction; `push()`/`pushSteps()` still attempt (the drain window). The steps-pull LA's own fail-closed check is spec'd as a staging-apply item; S-W3-10 covers the init/first-run path explicitly |
| **W3-SR-11** | Codex R3-1 | a follower write serialised AFTER the atomic purge commit + signature record leaves an out-of-scope row on a device that is now "reconciled by signature" — later cycles no-op (sync.js:1885), the push gets rejected, and the row lingers forever (privacy residual, not loss) | the reconcile is RE-ARMABLE: the leader's `local-write` refresh handler (sync.js:957) and every page-1 pull run a cheap out-of-scope check (any row whose store ∉ the recorded `bob_scope_sig` scope, using the same per-table filters); a hit sets `bob_scope_purge_pending` + clears the recorded signature, so the NEXT cycle re-runs the full flush→purge path. The signature is a cache, never a guarantee — detection re-arms reconciliation. S-W3-2 extended: a late row must be purged on the next cycle (after flush), never accepted as steady-state |
| **W3-SR-12** | Codex R3-2 | the pinned 200 hold envelope wasn't SAFE for today's deployed clients if it carried `maxId`: current clients capture `remote.maxId` (sync.js:1670) and on an empty page ADVANCE the ledger cursor to that ceiling (sync.js:1700) → withheld rows are skipped forever when the hold lifts | the pinned contract now FORBIDS fields: a hold response is EXACTLY `{topologyPending:true, items:[], policyVersion:<current>}` — **no `maxId`, no `scope`** (either would make an old client advance its cursor / run a purge mid-quiesce). S-W3-5 asserts the omissions; the staging-apply E2E asserts the REAL LA omits them (mock-must-match-server) |
| **W3-SR-13** | Codex R4-1 | the `_topologyHold` LIFECYCLE wasn't pinned — a sticky flag would suppress `pullSteps()` forever after the hold lifts (steps sync permanently disabled) | PINNED: `_topologyHold` is SET only by a hold response and CLEARED by the next page-1 pull that returns a NON-hold response; a network error / thrown pull leaves it UNCHANGED (fail closed — steps stay suppressed until the ledger confirms the hold lifted). It is in-memory only (a reload re-derives it from the next pull). S-W3-10 adds "hold → normal pull → `pullSteps()` resumes" |
| **W3-SR-14** | Codex R4-2 | the re-arm detection (W3-SR-11) ran on follower `local-write` + page-1 pull — but a LEADER-originated late write (stale modal/draft in the leader tab) only triggers `scheduleSync()` → debounced push (sync.js:2114/2124), no detection; a rejected push or going offline leaves the row unlocked until some later pull | the out-of-scope detector runs at the COMMON write entry: inside `scheduleSync()` (every durable local write funnels through it, leader or follower) in addition to the `local-write` refresh handler + page-1 pull. Any durable write of an out-of-scope row re-arms the purge-pending lock BEFORE/WITH the push attempt, regardless of push outcome or connectivity. S-W3-2 gains a leader-originated late-row case |
| **W3-SR-15** | Codex R5-1 | the W3-SR-13 clear-point collides with a scope-purge abort: a NON-hold page-1 pull can still ABORT for scope reconciliation (sync.js:1654/1890) — clearing `_topologyHold` there would resume `pullSteps()` while the device is still under `bob_scope_purge_pending` | TWO pins: (a) `_topologyHold` clears only on a non-hold page-1 that COMPLETES scope reconciliation without abort; (b) belt-and-braces, `pullSteps()`'s entry guard ALSO suppresses while `bob_scope_purge_pending` is set — steps never advance while the ledger is unreconciled, whatever the flag's state. S-W3-10 adds the "non-hold pull that aborts on purge failure → steps still suppressed" case |
| **W3-SR-16** | Codex R5-2 | `scheduleSync()` is NOT the true choke point: draft-transfer durable writes bypass it — `DB.addTransferDurable` (phase2.js:163 → db.js:1009) and `DB.updateTransferDurable` (phase2.js:199 → db.js:1018) persist to Dexie and return without `scheduleSync()`/`_afterLedgerWrite` → a stale draft-transfer modal writes an out-of-scope row with NO detector and NO push | the detector moves DOWN to the DB LAYER: a single `DB._scopeGuardOnWrite(row…)` hook invoked by EVERY durable writer (`addTransactionDurable`, `addTransferDurable`, `updateTransferDurable`, the recordSteps writers, and any future durable writer — enumerated in the build checklist) sets the purge-pending lock + clears the signature on any out-of-scope write; `scheduleSync()` keeps its check as defence-in-depth. S-W3-2 adds the draft-transfer (add + update) cases |

## The design (post-R1)

**W3-1 FLUSH-BEFORE-PURGE (GAP-1; per W3-SR-1/2/5/6).**
In `_reconcileScope`, before ANY purge:
1. `_drainPendingLocked()` — the lock-aware internal drain (ledger then steps, R1 ordering preserved).
2. `DB.purgeToScopeAtomic(scopeArr, {wipeStores})` — ONE Dexie `rw` transaction spanning every sync table:
   disk read → per-table pending predicates (W3-SR-5) walk the EXACT rows to be dropped → abort-by-throw if
   any pending → else `clear()`+`bulkPut()` the filtered rows. The native IDB lock excludes follower writes
   for the whole read-diff-write section (W3-SR-2 R2 amendment); cache reloads after commit.
3. On refusal: raise `bob_scope_purge_pending` (existing mechanics, sync.js:1894-1898), do NOT record the new
   signature, retry next cycle. Egress-invalid rows are durably `_rejected` (W3-SR-6) so they can't livelock.
4. Only a clean atomic walk purges + resets cursors + records the signature.
5. **The signature is a CACHE, never a guarantee (W3-SR-11/14/16):** the out-of-scope detector is a DB-LAYER
   hook (`DB._scopeGuardOnWrite`) invoked by EVERY durable writer (transactions, transfers add+update,
   recordSteps — enumerated in the build checklist), plus defence-in-depth checks in `scheduleSync()`, the
   `local-write` refresh handler, and every page-1 pull; any hit clears the signature + sets the purge-pending
   lock so the next cycle re-runs flush→purge. A late write is locked AT the write itself, regardless of
   connectivity; it can linger at most one cycle.

**W3-2 ERA/TOPOLOGY-VERSION RE-BOOTSTRAP (GAP-2; per W3-SR-3/7).**
- Pull LA echoes per-store `topologyVersion`s (mirrors the `policyVersion` echo, sync.js:1661). Client persists
  `bob_topo_vers` as a per-store JSON map.
- A bumped store routes through the same flush-first path with `wipeStores:[thatStore]` — its rows are dropped
  even though still in scope, then cursors reset and the new era re-pulls clean.
- Backward compatible: no echo (today's LA) = no-op.

**W3-3 TOPOLOGY-HOLD HANDLING (GAP-3; per W3-SR-8/9/10/12).**
- Pinned envelope: HTTP 200, EXACTLY `{topologyPending:true, items:[], policyVersion:<current>}` — **no
  `maxId`, no `scope`** (W3-SR-12; either would damage today's deployed clients) (+ defensive non-2xx JSON
  parse). The client processes `policyVersion` on hold responses exactly as on normal pulls (W3-SR-9).
- A ledger hold sets `_topologyHold`; the skip lives INSIDE `pullSteps()` as an entry guard so every caller —
  poll, cycle, AND `init()`'s first-run path (sync.js:2279/2282) — is covered by construction (W3-SR-10 R3
  amendment); `push()`/`pushSteps()` still attempt (the drain window).
- Client status: calm ("Store update in progress — syncing will resume shortly"), normal poll cadence retries;
  rejections follow the rejected-row path (server quarantines `stale_era` for Director settlement).

**W3-0 ORDERING FIX (per W3-SR-4).** The AA policyVersion check + `_reconcilePolicyPurge` move ABOVE
`_reconcileScope` on page 1 and run unconditionally — no scope purge, hold, or abort can starve the
cost-visibility downgrade.

**Explicitly OUT of W3:** the topology LA / quiesce flag / flush authorization / `stale_era` quarantine /
snapshot (server, staging-apply); the era-aware lens + buy-back export (W4); wizard UI (W5).

## Change-safety plan (touches live sync.js)
Sentinels (join the smoke gate):
- **S-W3-1** pending offline row for an out-of-scope store survives a scope change **on the REAL poll path
  (lock held)** — pushed via the internal drain, then purged.
- **S-W3-2** `purgeToScopeAtomic` refuses to drop an unsynced row, **with a follower Dexie write landing in
  the old refresh→persist window — proving the single `rw` transaction serialises it (the row survives either
  by aborting the purge or by landing after the commit; it is NEVER annihilated)** (W3-SR-2 R2 amendment) —
  **AND (W3-SR-11) a row landing AFTER commit + signature record is detected by the re-arm check and purged on
  the NEXT cycle (after flush); "lands after commit" is never accepted as steady-state** — **including a
  LEADER-originated late row (stale modal in the leader tab): the DB-layer `_scopeGuardOnWrite` locks it AT the
  write, even offline or on a rejected push (W3-SR-14/16), with explicit draft-transfer cases
  (`addTransferDurable` + `updateTransferDurable`, which bypass `scheduleSync`)**.
- **S-W3-3** flush fails (offline) → NO purge, privacy lock, signature not advanced, retries; **includes a
  local egress-invalid row that gets durably `_rejected` and stops blocking**.
- **S-W3-4** `topologyVersion` bump with unchanged StoreIds → flush → wipe → cursor reset, **asserting the
  old-era rows actually left Dexie**.
- **S-W3-5** `topologyPending` (pinned 200-envelope AND defensive non-2xx body) → calm hold, cursors
  untouched, push still attempted — **AND (W3-SR-12) asserts the envelope carries NO `maxId` and NO `scope`
  (a hold body containing `maxId` must NOT advance the ledger cursor even on a W3 client — defence in depth)**.
- **S-W3-6** (regression) a normal scope change with nothing pending behaves exactly as today.
- **S-W3-7** a failed/stuck scope flush does NOT prevent a pending AA policy downgrade from executing
  (`_reconcilePolicyPurge` runs and cost fields drop) — **AND a policyVersion bump arriving on a topology-HOLD
  envelope is adopted during the hold** (W3-SR-9).
- **S-W3-8** per-store map: the lower-version store bumps while the aggregate max doesn't → that store still
  re-bootstraps.
- **S-W3-9** per-table predicates: a synced legacy delivery/stockTake/transfer purges fine; an unsynced
  recordStep blocks the purge.
- **S-W3-10** during a ledger topology hold, `pullSteps()` does NOT run — enforced by ITS OWN entry guard, and
  the sentinel exercises the `init()` first-run path (`pull()` → `pullSteps()` direct, sync.js:2279/2282), not
  just `poll()`: the step cursor (`bob_last_step_sp_id`) is untouched and no step metadata for the quiesced
  store merges, while `push()`/`pushSteps()` still attempt (W3-SR-10 R3 amendment) — **AND (W3-SR-13) the
  lifecycle: hold → normal pull → `pullSteps()` RESUMES; a thrown/errored pull leaves the flag unchanged
  (fail closed)** — **AND (W3-SR-15) a non-hold pull that ABORTS on scope-purge failure keeps steps suppressed
  (the entry guard also honours `bob_scope_purge_pending`)**.
Full local gate before hand-off: smoke (240+new), topology-proof 191, saboteur sweep (concurrency 10), static
gates, change-safety sweep on the touched call-graph (`poll`/`pull`/`push`/`pushSteps`/`_reconcileScope`/
`purgeToScope` callers). Mock-must-match-server: the pinned pull-echo contract is proven against the REAL LA at
staging-apply E2E (staging-ledger item).

## Risk register (post-R1)
- R1 flush livelock → closed by W3-SR-6 (durable egress rejection) + rejected-row surfacing; device safe.
- R2 scope change while already purge-pending → unchanged: lock holds until a flush-clean durable purge.
- R3 policy-purge ordering → CLOSED by W3-0 (runs first, unconditionally).
- R4 multi-tab → W3-SR-2 fold (refresh-inside-purge, disk-state diff) + S-W3-2 race sentinel; the flush runs
  in-cycle under the held lock via `_drainPendingLocked` (W3-SR-1), never a parallel path.

## Kunal decisions needed
- None blocking. Hold-status wording default: "Store update in progress — syncing will resume shortly."
