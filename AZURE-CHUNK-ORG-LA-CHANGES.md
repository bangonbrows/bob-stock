# Org-Structure chunk — staging LOGIC APP changes (OS-W2 spec; apply at staging-apply/cutover)

**Status:** SPECIFIED 2026-07-10 (OS-W2). The LAs live on staging (not in-repo); this is the authoritative
change record, same pattern as Chunks 5–10 + Account Access. Function-side counterpart is IN-REPO + logic-
proven: `azure-functions/src/functions/topology.js` (`topologyPlan`/`topologyResolve`), 38-probe suite
`test/topology-proof.js`. Contract: `AZURE-CHUNK-ORG-ENFORCEMENT-MATRIX.md`; spec: OS-SR-1..12.

## Shared rules
- The client wizard sends ONE INTENT payload; the LA does everything server-side (OS-SR-1/2). The LA
  RECOMPUTES the fanout from server-owned rows via `topologyPlan` — the client intent carries only which
  store + which transition + the chosen rate/franchisee, NEVER a credential list.
- Director device key + `topology-change` sudo proof (new purpose; add to `validateUser.js` SUDO_PURPOSES +
  the floor is NOT required, but the action is always-password like other privileged ops). Store key ⇒ 401.
- All new AppConfig items (`store_eras`, `franchisees`, `pricing_history`, `topology_change`) are served via
  the gated config/pull delivery with a `version` echo (like `access_policy_version`) so clients detect bumps.

## 1. NEW LA: `topology-change-staging` (OS-SR-1 — pending / 2-phase-commit + reconcile)
Trigger `POST {auth, proof, intent}`.
1. `validateKeys` — Director key REQUIRED (store key → 401).
2. `verifyProof` — sudo proof purpose=`topology-change`. 403 on fail.
3. Read server-owned state: the store row, ALL StoreCredentials + UserCredentials rows (id/Role/StoreIds/
   Active/franchiseeId/isStorePOS/isFranchiseOffice), the `franchisees` list, the store's `store_eras` +
   `pricing_history`, AND (W4-SR-48) the target franchisee's OFFICE store row + its eras + pricing as
   `state.office` — the planner clones/creates office series and (on onboard) the office store itself.
4. `topologyPlan {intent, state, nowMs}` → the plan (era close/open, pricing append, fanout, createAccounts,
   snapshot, export, record). Reject reasons pass through to the client.
   **W4-SR-64 CONCURRENCY FENCE:** the pricing publication VERSION read with the state in step 3 rides the
   plan; the step-5 pricing writes CAS on it — advanced ⇒ ABORT + RE-PLAN from fresh state (the 2-phase
   journal makes the re-run idempotent). Symmetrically, the §6 pricing-change route REJECTS (409 retry-after)
   any write whose fan-out set touches a franchisee/store with a PENDING `topology_change`. Both writers bump
   the SAME version on publish.
5. **2-PHASE COMMIT:** write a `topology_change` AppConfig record `status:pending` carrying the plan + a
   change-id. THEN apply each step IDEMPOTENTLY (keyed on the change-id so a re-run is a no-op):
   - QUIESCE (OS-SR-5/7): mark the store's `topology_pending` flag; the pull LA FAILS CLOSED for that store
     while pending (devices hold/deny). Give a bounded DRAIN window for the store's devices to flush old-era
     queues (the client push-before-purge, OS-W3).
   - snapshot (if requested): capture the store's opening-balance server-side sum AT the cutoff (OS-SR-7),
     stamp it into `stock_snapshot` scoped to the new owner, atomic with the era boundary.
   - write `store_eras` (close old era `to`, open new), `pricing_history` (append/close interval).
   - apply the fanout: for each `{id, action}` — `setStoreIds` (new StoreIds + `active`) or `bump`
     (scopeVersion++). ALWAYS bump scopeVersion on every touched credential (D-OS-F6) so the client
     re-bootstraps even when StoreIds are unchanged (the store POS on a convert).
   - `createAccounts`: mint the franchisee entity + office account (caps from the data-driven role matrix,
     D-AA-3) and/or the store POS device credential.
6. Mark `topology_change` `status:complete`, clear the store's `topology_pending`.
7. Response `{ok, changeId, version}`; on any step failure leave `pending` (the RECONCILE sweep resumes).

**RECONCILE sweep** (a timer LA or the next topology call): find `status:pending` records older than the
drain window; re-apply missing steps idempotently; if the drain never completes, the store stays
fail-closed (safe) and is surfaced to the Director.

**Late old-era rows (OS-SR-5/7 amend + OS-SR-10):** after the boundary is FINALIZED, a pre-boundary row
arriving from an ex-scope device is QUARANTINED with `stale_era` (surfaced to the Director for manual
settlement), NEVER silently applied to the closed era. The old-era flush window itself is authorized by a
one-shot, expiring, server-issued grace tied to the device's PRIOR scopeVersion (OS-SR-10) — timestamp alone
never authorizes an old-era write.

## 2. pull-v2 + config: serve the new items + version echoes
- Serve `store_eras`, `franchisees`, `pricing_history` to authenticated devices; echo their `version`
  (and the per-credential `scopeVersion`) on every pull page so the client re-bootstraps on an era/ownership
  change even when StoreIds are unchanged (D-OS-F6 / OS-W3).
- pull-v2 read scoping ADDS the era-window filter (OS-SR-6): a franchisee/HO account gets rows only within
  its owner's era window(s); a device-bound role (store POS / store_manager) gets the CURRENT era only. Fail
  closed with no era record (extends the AA `store_eras` SR-6 floor).
- pull-v2 FAILS CLOSED for a store with a pending `topology_change` (OS-SR-1).

## 3. Buy-back export (OS-SR-4) — a gated read
A `topology-export-staging` path (or a mode on archive-pull): Director-gated, generates the ex-franchisee's
usage/cost/retail-profit for the CLOSED era `[from,to)` from server-owned rows (D-OS-6). Both bounds; never
lower-bound-only; never client-filtered.

## 4. Reports / lens (server + client, OS-SR-3/11 — see OS-W4)
Money in reports reads the franchise rate from `pricing_history` AS-OF each row's date via `topologyResolve`
(or the client mirror), NOT `store.franchiseDiscount`. The live `store.franchiseDiscount` scalar becomes a
convenience default for NEW rows only; the authoritative rate is the dated history.

## 5. Function App: add the topology routes + the `topology-change` sudo purpose
Deploy `topology.js` (topologyPlan/topologyResolve, authLevel function). Add `topology-change` to
`validateUser.js` SUDO_PURPOSES so the write LA can demand a purpose-bound sudo proof.

## 6. W4 server contracts (OS-W4 scope reviews R3-R5, W4-SR-28/32/33/36/38/39/40/44 + R5 SR-45..62 — staging-apply items)
- **Pricing-change route:** authenticated, Director-gated (editPricing sudo — ADDED to validateUser.js
  SUDO_PURPOSES + the client sudo prompt map, W4-SR-44). Runs appendPricingForKey SERVER-side (effective now,
  append-only per OS-SR-12 — the EFFECTIVE-NOW APPEND INVARIANT is load-bearing for the W4-SR-74 stale
  horizon; no post-activation writer may backdate). **OFFICE-DEFAULT FAN-OUT (W4-SR-45):** an office-default
  edit appends the SAME
  interval to the office's '*' AND the '*' of every retail store currently in an open franchise era owned by
  that franchisee — target set derived from SERVER rows, never client-supplied; the journal spans the WHOLE
  fan-out set (partial fan-out never published). **FENCE (W4-SR-64):** REJECTS (409 retry-after) while any
  targeted franchisee/store has a pending `topology_change`; shares ONE publication version with the topology
  LA (each trips the other's CAS). ATOMIC TO READERS (W4-SR-32): journals pricing_pending,
  writes history + the legacy scalar, then PUBLISHES all of it under ONE version bump — readers only ever
  adopt version-consistent snapshots; the reconcile sweep resumes a crash. CONCURRENCY (W4-SR-33/54):
  requires expectedVersion (CAS, the AA-03 baseVersion pattern) + a client-minted stable opId whose replay
  BINDS to a canonical digest (op-type + target + canonical payload + actor — different digest under a reused
  opId is REJECTED); the idempotency lookup runs BEFORE CAS so a lost-response retry returns the prior result
  after the version advanced. Serves global-tier appends (global[productId]) and office-default appends;
  the per-product tier writer is the W5 wizard (W4-SR-23).
- **Add-product-with-discount (W4-SR-43/53/54):** ONE idempotent journaled op — catalogue create + the
  global[productId] opening interval + scalar dual-write, published under one version — under the SAME
  expectedVersion CAS + catalogue concurrency check + digest-bound opId as pricing edits.
- **Pricing-config echo shape (R4 model revision — PER-STORE, no resolver map):**
  { version, global: {productId: series}, stores: {storeOrOfficeId: {'*': series, productId?: series}} } —
  served via config, version-echoed on pull; adoption durable + monotonic (W4-SR-27/29/31: activation flag on
  first observation; newer-but-unadoptable ⇒ durable pricing_stale, evaluated PER RESOLUTION per W4-SR-51 —
  only closed-interval decisions across all consulted tiers stay valid). Schema validated EXACTLY (W4-SR-42:
  exact root fields, reqId keys, global = product keys only). **PUBLICATION BINDING (W4-SR-52):** the
  master_data snapshot carries the pricing publication version (`pricingVersion`) it was generated under, so
  clients can prove scalar + history came from one publication.
- **Stamp columns + ingest validation (W4-SR-13/18/20/38/39/40/58/62):** SellAtSupply/DiscAtSupply columns on
  StockTransactions + StockTransactions_Archive (BOTH-OR-NEITHER per row; money fields validated by the
  SHARED validateMoney policy — finite, ≥0, ≤ MONEY_MAX, ≤2dp; discount via validRate 0-100); transfer
  ITEM stamps ride RecordSteps Payload.items[].sellAtSupply/discAtSupply (validated in the steps ingest —
  there are NO Transfers columns; that list is a deleted scaffold). ALSO carried: UnitPriceAtTime (same
  validateMoney policy) + StockFromStoreId/StockToStoreId + the StockFrom/StockTo TEXT labels (bounded
  strings — the actual sale-vs-wastage classification inputs, W4-SR-58). Archive-move and archive-pull
  preserve all of these. **NO in-transit stamp migration exists** — W4-SR-41 is superseded by
  stamp-at-receive (W4-SR-59): RecordSteps are immutable; legacy stamps are published by the receive step.
- **Buy-back export route (extends §3 per W4-SR-9/24/25/26/36/37 + R5 SR-55/56/57 + R6 SR-68/69/70/75):**
  queries LIVE across the FULL event window AND ARCHIVE across the FULL event window (Chunk-8 archives by
  monotonic ID, not date — no date-partition seam), unions + dedupes by TransactionId. Same-list tombstones
  apply; a CROSS-LIST tombstone (either direction) = a FAIL-CLOSED CONFLICT surfaced for the Chunk-8
  Director-correction path, never silently applied (W4-SR-70, aligning with CHUNK8 item 5); same-ID copies
  whose financial/classification fields differ also FAIL CLOSED (W4-SR-55). ARCHIVE STABILITY (W4-SR-68/75):
  the route REFUSES while an archive run is IN PROGRESS and takes a bounded EXPORT LEASE the archiver checks
  before starting a new run (lease acquisition has priority over new runs; TTL-bounded so archival can't
  starve); both queries run inside the lease; attestations carry the completed-run version + lease id and
  the engine requires a consistent pair (the before/after scalar compare is DELETED). Bound to the
  bought-back storeId, boundary-evaluated on the row UTC instant (never the calendar-day string); supplies
  full-window enumeration attestations for BOTH lists + graceClosed + (for FINAL) the DRAINED-INGEST proof
  (W4-SR-57/69): the OS-SR-10 grace record carries pinned terminal states `issued → consumed` (durably set
  BEFORE any row write in the same run) `→ committed` (after the last row write); DRAINED = every grace
  record for the store TERMINAL (committed or expired-unconsumed). Absent graceClosed or drain ⇒ the
  settlement is marked PROVISIONAL and regenerable; FINAL requires both.
- **Activation seed (runbook contract, W4-SR-46/50/63/65):** per store, one '*' interval PER FRANCHISE ERA
  (closed [from,to) for closed eras; open for the open era), ALL at the seed-time scalar value — required by
  `pricingAlignsWithEras`; HO interludes stay uncovered. `global[productId]` seeded ONLY for legacy discounts
  that are numbers > 0 (legacy 0 = inherit, NEVER seeded as 0%). The seed is the ONLY backdated write ever
  (inside v1); everything after obeys the effective-now invariant.
- **Money policy for W4 fields (W4-SR-62/73):** `SellAtSupply`/`UnitPriceAtTime` at EVERY surface (row
  ingest, steps payload, archive, engine): JSON NUMBER type required (strings rejected — no Number()
  coercion), finite, ≥ 0, ≤ 1,000,000 (the CLIENT `Validate.MONEY_MAX`), ≤ 2dp (reject). Shared parity
  fixture matrix proves client/ingest/engine verdict-identical. NOTE (out of W4 scope, flagged): the
  pre-existing `badMoney` (validateMoney.js) ↔ client `Validate.money` divergence on Chunk-4 delivery costs
  (cap 10M vs 1M; `Number(v)` string coercion) is an open alignment item.
