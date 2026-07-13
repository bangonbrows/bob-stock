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
   `pricing_history`.
4. `topologyPlan {intent, state, nowMs}` → the plan (era close/open, pricing append, fanout, createAccounts,
   snapshot, export, record). Reject reasons pass through to the client.
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

## 6. W4 server contracts (OS-W4 scope review R3+R4, W4-SR-28/32/33/36/38/39/40/44 — staging-apply items)
- **Pricing-change route:** authenticated, Director-gated (editPricing sudo — ADDED to validateUser.js
  SUDO_PURPOSES + the client sudo prompt map, W4-SR-44). Runs appendPricingForKey SERVER-side (effective now,
  append-only per OS-SR-12). ATOMIC TO READERS (W4-SR-32): journals pricing_pending, writes history + the
  legacy scalar, then PUBLISHES both under ONE version bump — readers only ever adopt version-consistent
  snapshots; the reconcile sweep resumes a crash. CONCURRENCY (W4-SR-33): requires expectedVersion (CAS,
  the AA-03 baseVersion pattern) + a client-minted stable opId (idempotent replay returns the prior result).
  Serves global-tier appends (global[productId]) and office-default appends (office['*']); the per-product
  tier writer is the W5 wizard (W4-SR-23).
- **Add-product-with-discount (W4-SR-43):** ONE idempotent journaled op — catalogue create + the
  global[productId] opening interval + scalar dual-write, published under one version.
- **Pricing-config echo shape (R4 model revision — PER-STORE, no resolver map):**
  { version, global: {productId: series}, stores: {storeOrOfficeId: {'*': series, productId?: series}} } —
  served via config, version-echoed on pull; adoption durable + monotonic (W4-SR-27/29/31: activation flag on
  first observation; newer-but-unadoptable ⇒ durable pricing_stale fail-closed past the last confirmed
  boundary). Schema validated EXACTLY (W4-SR-42: exact root fields, reqId keys, global = product keys only).
- **Stamp columns + ingest validation (W4-SR-13/18/20/38/39/40):** SellAtSupply/DiscAtSupply columns on
  StockTransactions + StockTransactions_Archive (BOTH-OR-NEITHER per row, finite, discount 0-100); transfer
  ITEM stamps ride RecordSteps Payload.items[].sellAtSupply/discAtSupply (validated in the steps ingest —
  there are NO Transfers columns; that list is a deleted scaffold). ALSO carried: UnitPriceAtTime +
  StockFromStoreId/StockToStoreId (the K4 fields the export needs, currently client-only). Archive-move and
  archive-pull preserve all of these.
- **Buy-back export route (extends §3 per W4-SR-9/24/25/26/36/37):** queries LIVE across the FULL event
  window AND ARCHIVE across the FULL event window (Chunk-8 archives by monotonic ID, not date — no
  date-partition seam), unions + dedupes by TransactionId, bound to the bought-back storeId, boundary-
  evaluated on the row UTC instant (never the calendar-day string), and supplies the engine full-window
  enumeration attestations for BOTH lists + the graceClosed attestation (absent ⇒ the settlement is marked
  PROVISIONAL and regenerable; FINAL requires it).
