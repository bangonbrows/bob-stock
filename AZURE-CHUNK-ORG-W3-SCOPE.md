# OS-W3 SCOPE — Chunk-10 companion: offline flush-before-purge + era-aware re-bootstrap (CLIENT)

**Status:** MAP COMPLETE (2026-07-12) — awaiting Kunal read → Codex+AGY parallel scope review → build.
**Touches:** `sync.js` + `db.js` (**the LIVE sync engine** — first org-chunk wave that edits live-app files).
Branch `azure-phase-5-8-server`; nothing deploys until the end-of-phase cutover.
**Spec anchors (already converged, R1–R4):** OS-SR-5 (push-before-purge), OS-SR-5/7 amendment (bounded drain
window before snapshot finalization), OS-SR-10 (server-authorized one-shot old-era flush; stale_era
quarantine), OS-SR-6 (device-bound roles see the current era only), OS-SR-1 (pull fails closed while
`topology_pending`). LA-side counterparts are SPEC'D in `AZURE-CHUNK-ORG-LA-CHANGES.md` and stay
staging-apply items — **W3 builds the CLIENT side** and must be safe with today's LAs AND the future ones.

## The mapped ground truth (file:line, verified 2026-07-12)

**GAP-1 — offline data loss on scope change (the headline bug; ground-truthed REAL).**
- The 30s background `poll()` runs `pull()` FIRST (sync.js:2197) and only drains pending pushes AFTER
  (sync.js:2204).
- `pull()` calls `_reconcileScope(remote.scope)` on page 1 (sync.js:1656 → 1881). On a changed scope it calls
  `DB.purgeToScope(scopeArr)` (sync.js:1889) IMMEDIATELY — no pre-flush.
- `DB.purgeToScope` (db.js:381) filters every per-store table by store membership ONLY — it makes **no
  exception for rows not yet uploaded** (`!t._synced && !t._rejected`, the same predicate push() uses at
  sync.js:1278).
- Net: a device holding **unsent offline entries** for a store that leaves its scope (e.g. a TM's store is
  reassigned while their phone is offline) has those entries **deleted before they were ever pushed** =
  permanent stock-ledger loss. The manual path (`_runSyncCycle`, sync.js:2158) happens to push first, but the
  background poll — the common path — does not.

**GAP-2 — era changes with an unchanged store list never re-bootstrap.**
- The only reconcile trigger is the sorted-StoreIds signature (`bob_scope_sig`, sync.js:1883).
- A CONVERT/BUYBACK keeps the store POS's StoreIds identical (`['boor']` before and after), so the signature
  never changes → no purge, no cursor reset. But the OWNERSHIP ERA changed: a device-bound role must see the
  CURRENT era only (OS-SR-6), and its stale local rows/caches from the prior era linger. Today there is no
  client trigger tied to the era/topology version at all.

**GAP-3 — no client handling for the fail-closed topology window.**
- The (spec'd) topology LA quiesces a store mid-change: pull FAILS CLOSED for that store while
  `topology_pending` (OS-SR-1; LA-CHANGES §"pull-v2 fails closed"). The current client treats any non-ok pull
  as a generic "Data may be stale" warning (sync.js:1642-1645) — no hold/deny semantics, no retry messaging,
  and a mid-window scope echo could still race the purge.

## The design (what W3 builds — all client-side)

**W3-1 FLUSH-BEFORE-PURGE (closes GAP-1).**
In `_reconcileScope`, before ANY `purgeToScope`:
1. Attempt a bounded flush: `push()` + `pushSteps()` of all pending rows (they already send regardless of
   store — sync.js:1278).
2. Re-check after the flush: if ANY row that the purge would drop is still `!_synced && !_rejected` → **do
   NOT purge, do NOT record the new signature**; raise the existing `bob_scope_purge_pending` privacy lock
   (same fail-closed mechanics as the current durable-purge failure, sync.js:1894-1898) and retry next cycle.
3. Only when every to-be-dropped row is durably synced (or explicitly `_rejected`) does the purge + cursor
   reset + signature record proceed.
- **Per-row check, not an aggregate** (framework rule: invariant ≠ per-item validation) — the guard walks the
  exact rows the purge would drop, mirroring `purgeToScope`'s own filters (incl. either-end transfer/step
  retention).
- **Belt-and-braces invariant in `DB.purgeToScope` itself:** it independently refuses (returns false) if its
  filtered-copy diff would drop any unsynced, unrejected row. Defence in depth: even a future caller that
  forgets the flush cannot lose data. (A `_rejected` row is server-refused hostile/invalid input — it may drop.)
- Rejected/held rows for a departed store that the server will never accept: after the bounded retry window
  they surface via the existing rejected-rows status path; they are NEVER silently dropped (they stay under the
  privacy lock until pushed, rejected, or the Director settles — matching stale_era semantics server-side).

**W3-2 ERA/TOPOLOGY-VERSION RE-BOOTSTRAP (closes GAP-2).**
- The pull LA will echo a per-store `topologyVersion` (spec'd; mirrors the existing `policyVersion` echo at
  sync.js:1661). The client persists it beside `bob_scope_sig` (`bob_topo_ver`).
- A bump — even with an UNCHANGED StoreIds signature — routes through the SAME reconcile path: flush-first
  (W3-1) → purge to scope (for a POS this drops nothing in-scope; for narrowed roles it drops old-era
  out-of-scope rows) → cursor reset → re-pull. The server's era-lens then only serves current-era rows to
  device-bound roles (OS-SR-6 — server side, already spec'd).
- Backward compatible: no echo (today's LA) = no-op, exactly like the existing `remote.scope` guard
  (sync.js:1882).

**W3-3 TOPOLOGY-HOLD HANDLING (closes GAP-3).**
- The (spec'd) fail-closed pull response for a quiesced store carries a distinguishable marker
  (`topologyPending: true`). Client: show a calm status ("Store update in progress — syncing will resume
  shortly"), do NOT treat as an error, do NOT advance cursors, retry on the normal poll cadence.
- During the hold the client still ATTEMPTS pushes (that is the drain window working — OS-SR-5/7 amendment);
  the ingest LA decides acceptance (one-shot flush authorization, OS-SR-10). A push rejection during the hold
  follows the normal rejected-row path (quarantined server-side as `stale_era` for Director settlement — never
  silently applied, never silently dropped).

**Explicitly OUT of W3 (build later / elsewhere):**
- The topology-change LA itself, quiesce flag, drain-window authorization, `stale_era` quarantine, snapshot
  finalization — SERVER items, spec'd in LA-CHANGES, applied at the staging-apply phase (single pass, with the
  deferred AA LAs).
- The era-aware report lens + buy-back export (OS-W4). Director wizard UI (OS-W5).

## Change-safety plan (this touches live sync.js)
- **Discover-before-touch:** this document IS the map; no behaviour change ships without the sentinels below.
- **New sentinels (join the 240-strong smoke gate):**
  - S-W3-1: pending offline row for an out-of-scope store SURVIVES a scope change (pushed first, then purged).
  - S-W3-2: `purgeToScope` refuses to drop an unsynced row (defence-in-depth invariant fires without the flush).
  - S-W3-3: flush fails (offline) → NO purge, privacy lock raised, signature NOT advanced, retries next cycle.
  - S-W3-4: `topologyVersion` bump with unchanged StoreIds triggers flush → purge → cursor reset.
  - S-W3-5: `topologyPending` pull response → calm hold status, cursors untouched, push still attempted.
  - S-W3-6 (regression): normal scope change with nothing pending behaves exactly as today (purge + reset once).
- **Full local gate before hand-off:** smoke (240+new), topology-proof 191, saboteur sweep (concurrency 10),
  static gates. Change-safety sweep on the touched call-graph (`poll`/`pull`/`push`/`_reconcileScope`/
  `purgeToScope` callers).
- **Mock-must-match-server:** the sentinel harness mocks the pull echo — the REAL echo contract is proven at
  the staging-apply E2E (flagged as a staging-ledger item, not silently assumed).

## Risk register (honest)
- R1: flush-loop livelock if a row can never sync (server persistently rejects) → bounded by the existing
  rejected-row path + privacy lock surfacing; the device is SAFE (nothing lost), just visibly unreconciled.
- R2: a scope change while ALREADY under `bob_scope_purge_pending` → unchanged from today: the lock holds until
  a durable, flush-clean purge succeeds.
- R3: ordering with the AA policy purge (`_reconcilePolicyPurge`, sync.js:1666) — runs AFTER scope reconcile
  today; W3 keeps that order (scope purge is store-level, policy purge is field-level; no interaction found in
  the map — auditors: please falsify).
- R4: multi-tab — reconcile runs in the leader's pull; followers learn via `_notifyFollowers()` (sync.js:1902,
  unchanged). The flush uses the same `_syncLock` the cycle already holds — W3 must re-use the in-cycle push
  path, not spawn a parallel one (implementation note).

## Kunal decisions needed
- None blocking. Default wording for the hold status is proposed in W3-3; change if you want different words.
