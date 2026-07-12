# OS-W3 SCOPE — Chunk-10 companion: offline flush-before-purge + era-aware re-bootstrap (CLIENT)

**Status:** SCOPE REVIEW R1 FOLDED (2026-07-12) — Codex BLOCK×5 + AGY falsifications×3, ALL ground-truthed
REAL and folded as **W3-SR-1..8** below — awaiting R2 re-review → build.
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
| **W3-SR-2** | AGY-1 | multi-tab TOCTOU: `purgeToScope` diffs + rewrites from the LEADER's in-memory `_cache` (db.js:393); a follower's Dexie write landing after the flush but before the purge is annihilated by `_persistAllToDexie` overwriting disk from stale memory | `purgeToScope` must `await DB.refresh()` internally IMMEDIATELY before building the filtered copy + safety diff, so both evaluate the definitive DISK state; the refresh→diff→persist sequence documents the remaining window and the leader re-checks pending flags after persist (S-W3-2 simulates a concurrent Dexie-direct write during the flush await) |
| **W3-SR-3** | AGY-2 | POS old-era leak: an era bump with the store still IN scope purges NOTHING (`allow.has` keeps it, db.js:386) → the incoming owner's device retains the ex-owner's full local ledger (OS-SR-6 violation) | on a `topologyVersion` bump, `_reconcileScope` passes the affected store(s) as an explicit `wipeStores` argument; `purgeToScope(scopeArr, {wipeStores})` drops those stores' rows EVEN THOUGH in-scope (after the same flush-first + unsynced guard), so the new era pulls onto a clean slate; S-W3-4 asserts the old-era rows actually LEFT Dexie |
| **W3-SR-4** | AGY-3 | policy-purge starvation: `_reconcileScope`'s early `return` (sync.js:1656) — and the new topology hold — skip the AA `policyVersion` check + `_reconcilePolicyPurge` (sync.js:1660-1666); a stuck scope purge (days offline) leaves a demoted user with elevated cost visibility | REORDER: the policyVersion check + `_reconcilePolicyPurge` run BEFORE `_reconcileScope` and unconditionally on every page-1 pull (they are field-level and independent of store scope); no scope/topology outcome may starve them; new sentinel S-W3-7 |
| **W3-SR-5** | Codex-2 | the unsynced-row guard is underspecified for tables without transaction-style flags: `purgeToScope` also drops stockTakes/deliveries/thresholds/transfers (db.js:396-400) which carry no `_synced`; a mechanical `!_synced` check blocks forever on historical rows | PER-TABLE pending predicates, pinned here: **transactions** `!_synced && !_rejected`; **recordSteps** `!_synced && !_rejected`; **transfers** pending iff any of its record-steps are pending (steps are the sync vehicle) or legacy in-flight status (`draft/submitted` with unsynced ledger rows); **stockTakes/deliveries/thresholds** are DERIVED/legacy metadata whose durable representation is the ledger + steps — droppable once their expectedLedgerKeys/step rows are synced, else pending; sentinels cover a synced legacy delivery/stockTake/transfer (purge proceeds) AND an unsynced recordStep (purge refuses) |
| **W3-SR-6** | Codex-3 | egress-invalid local rows are excluded from push with only a console log (sync.js:1303-1310) — never durably `_rejected` → the purge guard would block forever on rows the server will never see (livelock, not loss) | the egress filter now durably marks excluded rows `_rejected:'egress-invalid'` (same persistence path as server rejections) so they surface in the existing rejected-rows status AND become purge-droppable; S-W3-3 includes a local egress-invalid row |
| **W3-SR-7** | Codex-4 | a scalar `bob_topo_ver` misses multi-store era changes (store A at v10, store B bumps 2→3 — a scalar/max stays 10, B never re-bootstraps) | `bob_topo_vers` is a JSON MAP keyed by storeId (`{"boor":3,"karr":10"}`); the reconcile compares PER STORE and wipes exactly the bumped store(s); sentinel: the LOWER-version store changes while the max does not |
| **W3-SR-8** | Codex-5 | `topologyPending` had no pinned HTTP/envelope contract; the live client returns before JSON on non-ok (sync.js:1642) so a 423-with-body would read as a generic failure; a 200-body mock would pass while the real contract fails | PINNED CONTRACT: the pull LA signals a quiesced store with **HTTP 200** + `{topologyPending:true, items:[], scope:<unchanged echo omitted>}` — deliberately 200 so TODAY'S deployed clients treat it as a harmless empty pull (no rows served = fail-closed, no cursor damage), and W3 clients show the hold. The client ALSO defensively parses a non-2xx JSON body for the flag (belt-and-braces). S-W3-5 pins both the 200-envelope and the non-2xx defensive path; the staging-apply E2E proves the REAL LA emits it (mock-must-match-server rule) |

## The design (post-R1)

**W3-1 FLUSH-BEFORE-PURGE (GAP-1; per W3-SR-1/2/5/6).**
In `_reconcileScope`, before ANY purge:
1. `_drainPendingLocked()` — the lock-aware internal drain (ledger then steps, R1 ordering preserved).
2. `DB.purgeToScope` internally: `await DB.refresh()` → build filtered copy from DISK state → per-table
   pending predicates (W3-SR-5) walk the EXACT rows to be dropped → any pending row ⇒ return false (no purge).
3. On refusal: raise `bob_scope_purge_pending` (existing mechanics, sync.js:1894-1898), do NOT record the new
   signature, retry next cycle. Egress-invalid rows are durably `_rejected` (W3-SR-6) so they can't livelock.
4. Only a clean walk purges + resets cursors + records the signature.

**W3-2 ERA/TOPOLOGY-VERSION RE-BOOTSTRAP (GAP-2; per W3-SR-3/7).**
- Pull LA echoes per-store `topologyVersion`s (mirrors the `policyVersion` echo, sync.js:1661). Client persists
  `bob_topo_vers` as a per-store JSON map.
- A bumped store routes through the same flush-first path with `wipeStores:[thatStore]` — its rows are dropped
  even though still in scope, then cursors reset and the new era re-pulls clean.
- Backward compatible: no echo (today's LA) = no-op.

**W3-3 TOPOLOGY-HOLD HANDLING (GAP-3; per W3-SR-8).**
- Pinned envelope: HTTP 200 `{topologyPending:true, items:[]}` (+ defensive non-2xx JSON parse).
- Client: calm status ("Store update in progress — syncing will resume shortly"), cursors untouched, normal
  poll cadence retries; pushes still attempted during the hold (the drain window); rejections follow the
  rejected-row path (server quarantines `stale_era` for Director settlement).

**W3-0 ORDERING FIX (per W3-SR-4).** The AA policyVersion check + `_reconcilePolicyPurge` move ABOVE
`_reconcileScope` on page 1 and run unconditionally — no scope purge, hold, or abort can starve the
cost-visibility downgrade.

**Explicitly OUT of W3:** the topology LA / quiesce flag / flush authorization / `stale_era` quarantine /
snapshot (server, staging-apply); the era-aware lens + buy-back export (W4); wizard UI (W5).

## Change-safety plan (touches live sync.js)
Sentinels (join the smoke gate):
- **S-W3-1** pending offline row for an out-of-scope store survives a scope change **on the REAL poll path
  (lock held)** — pushed via the internal drain, then purged.
- **S-W3-2** `purgeToScope` refuses to drop an unsynced row, **evaluated against DISK state with a concurrent
  Dexie-direct follower write landing during the flush await** (the W3-SR-2 race).
- **S-W3-3** flush fails (offline) → NO purge, privacy lock, signature not advanced, retries; **includes a
  local egress-invalid row that gets durably `_rejected` and stops blocking**.
- **S-W3-4** `topologyVersion` bump with unchanged StoreIds → flush → wipe → cursor reset, **asserting the
  old-era rows actually left Dexie**.
- **S-W3-5** `topologyPending` (pinned 200-envelope AND defensive non-2xx body) → calm hold, cursors
  untouched, push still attempted.
- **S-W3-6** (regression) a normal scope change with nothing pending behaves exactly as today.
- **S-W3-7** a failed/stuck scope flush does NOT prevent a pending AA policy downgrade from executing
  (`_reconcilePolicyPurge` runs and cost fields drop).
- **S-W3-8** per-store map: the lower-version store bumps while the aggregate max doesn't → that store still
  re-bootstraps.
- **S-W3-9** per-table predicates: a synced legacy delivery/stockTake/transfer purges fine; an unsynced
  recordStep blocks the purge.
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
