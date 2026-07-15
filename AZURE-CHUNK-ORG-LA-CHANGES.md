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
   **W4-SR-64/78/98/99/100/110/111/112 CONCURRENCY FENCE — CLAIMS REGISTRY:** claims (storeId,
   officeStoreId, new usernames, the SPECIFIC pricing keys read/written) serialize through ONE `claims
   registry` record: reservation = a CAS/ETag CONDITIONAL UPDATE on that single record, succeeding iff no
   active claim overlaps (SR-110 — separate conditional CREATES do not serialize; the version check alone
   cannot catch two onboards of one officeStoreId). The pending journal is created AFTER the claim wins;
   claims carry owner + TTL/heartbeat + an immutable PER-CLAIM-SET LEASE ID from a durable monotonic
   counter on the registry (SR-117/125/131 — the counter survives deletion, ids never reused; unrelated
   releases touch only their own entries, so no cross-plan fencing): the live holder renews; the reconcile
   sweep SCRUBS orphans (claim-set with no journal after TTL, or a terminal journal ⇒ removed); journal
   CREATION, boundary finalization, and EVERY mutating step are conditional on "my claim-set present with
   my lease id, unexpired" — a scrubbed worker that resumes cannot create its journal or apply a step.
   **RESUME (SR-126/132/136):** the blocked_manual exit is a first-class INTENT on THIS route — Director
   key + `topology-change` sudo; the journal carries a monotonic `blockEpisode` (incremented on every entry
   into blocked_manual) and the sudo proof + digest + conditional transition + idempotency result all bind
   to `(changeId, blockEpisode)` — a second legitimate resume is a new operation, a delayed first-episode
   request can never resume a later episode (stale/duplicate/mismatched-episode resumes rejected).
   **BOUNDARY FINALIZATION (SR-112):** effective interval boundaries take the DATA STORE's write timestamp
   of the reservation (two-phase: plan→reserve→re-finalize boundaries with the reservation row's server
   timestamp) — LA execution clocks are never a boundary source. **APPLY-TOP REPLAN (SR-119):** before the
   first mutating step the LA re-reads the FULL state bundle and re-runs `planTopologyChange` — an identical
   fresh plan proceeds; a different-but-valid plan is ADOPTED (only admin writes can interleave under held
   claims); a pre-mutation reject aborts. This covers the whole planner READ-SET (consulted rows, collection
   membership), which per-row write-target ETags cannot. The plan's conflict test compares the
   CLAIMED pricing keys' state, NOT the global counter (SR-99); the claimed-keys assertion re-runs at the
   TOP of the apply phase, BEFORE any mutating step. Abort (⇒ durable **`aborted`**, excluded by reconcile)
   is possible ONLY pre-mutation and also CLEARS `topology_pending` + VOIDS the provisional snapshot +
   releases the claims. After the first mutating step the plan is FORWARD-ONLY — but every fan-out/
   createAccounts step carries a PRECONDITION on its target row's state captured at the state read (SR-111);
   a precondition failure transitions the journal to **`needs_replan`**: reconcile re-plans from FRESH state
   under the SAME held claims + change-id and applies the delta idempotently (admin writes like credential
   deactivation stay free and are incorporated, never blindly overwritten). EVERY step application is a
   CONDITIONAL update requiring `status: pending` + the worker's claim token/ETag (SR-100). Symmetrically, the §6
   pricing-change route REJECTS (409 retry-after) any write touching a franchisee/store with a PENDING
   `topology_change`. Both writers bump the SAME version on publish. **W4-SR-77:** the state read ALWAYS
   includes the store row at `intent.officeStoreId` (if any) so the planner can reject
   `OFFICE_STORE_ID_TAKEN`.
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
7. Response `{ok, changeId, version}`. Failure semantics (W4-SR-120): a TRANSIENT step failure leaves
   `pending` (reconcile retries); a PRECONDITION failure ⇒ `needs_replan` (reconcile replans under held
   claims); a fresh-plan REJECT after mutation ⇒ `blocked_manual` (claims + pending held = fail-closed;
   surfaced to the Director; reconcile replans after the underlying state is fixed). Reconcile scans
   `pending` AND `needs_replan`; claims release on `aborted`/`complete` + via the SR-117 orphan scrub
   (claims carry owner + TTL/heartbeat; a claim with no journal after TTL, or a terminal journal, is
   scrubbed).

**RECONCILE sweep** (a timer LA or the next topology call): scan `status: pending` AND `needs_replan`
records (W4-SR-120/126 — NOT `blocked_manual`, which waits on the Director's RESUME action transitioning it
to `needs_replan`); re-apply missing steps idempotently UNDER the claim/fencing-generation conditions
(W4-SR-125); scrub orphaned claims (W4-SR-117). If the drain never completes, the store stays fail-closed
(safe) and is surfaced to the Director.

**Late old-era rows (OS-SR-5/7 amend + OS-SR-10):** after the boundary is FINALIZED, a pre-boundary row
arriving from an ex-scope device is QUARANTINED with `stale_era` (surfaced to the Director for manual
settlement), NEVER silently applied to the closed era. The old-era flush window itself is authorized by a
one-shot, expiring, server-issued grace tied to the device's PRIOR scopeVersion (OS-SR-10) — timestamp alone
never authorizes an old-era write.

## 2. pull-v2 + config: serve the new items + version echoes
- Serve `store_eras`, `franchisees`, `pricing_history` to authenticated devices; echo their `version`
  (and the per-credential `scopeVersion`) on every pull page so the client re-bootstraps on an era/ownership
  change even when StoreIds are unchanged (D-OS-F6 / OS-W3).
- **W4-SR-80/81/102/112/118/127 SETTLED echo:** the pricing version echo carries `settled: true` ONLY when
  no pending pricing/topology journal exists AND no active claim INTERSECTS the requesting device's
  resolvable pricing keys (SR-127 — its stores/offices + the global tier; a claim IS a reservation whose
  boundary equals its own claim timestamp, so journal absence alone proves nothing while a relevant claim is
  live; scoping keeps one stuck franchisee from freezing the fleet's horizons; claim TTLs bound ordinary
  unsettled windows). T = the registry's last-modified as observed by the check (never an LA execution
  clock). Because every journaled boundary's `from` = its reservation's store-assigned write timestamp
  (§1 SR-112), a reservation landing after the check publishes boundaries >= T — equality is safe (the
  horizon admits strictly-before-T only). The client advances `lastConfirmedCurrentAt` only on settled
  echoes, storing T (never the device clock).
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
  first observation; newer-but-unadoptable ⇒ durable pricing_stale, judged by the W4-SR-74 HORIZON rule —
  resolutions strictly before the device's settled-echo `lastConfirmedCurrentAt` stand; at/after fail closed;
  the superseded SR-51 closed-tier rule is DELETED per W4-SR-83). Schema validated EXACTLY (W4-SR-42:
  exact root fields, reqId keys, global = product keys only). **PUBLICATION BINDING (W4-SR-52):** the
  master_data snapshot carries the pricing publication version (`pricingVersion`) it was generated under, so
  clients can prove scalar + history came from one publication.
- **Stamp columns + ingest validation (W4-SR-13/18/20/38/39/40/58/62/89):** SellAtSupply/DiscAtSupply columns
  on StockTransactions + StockTransactions_Archive (BOTH-OR-NEITHER per row; money fields validated by the
  canonical W4 policy — number-typed, finite, ≥0, ≤1,000,000, ≤2dp; DiscAtSupply = 0-100 AND ≤2dp per
  W4-SR-89 — validRate alone is insufficient); transfer
  ITEM stamps ride RecordSteps Payload.items[].sellAtSupply/discAtSupply (validated in the steps ingest —
  there are NO Transfers columns; that list is a deleted scaffold). ALSO carried: UnitPriceAtTime (same
  validateMoney policy) + StockFromStoreId/StockToStoreId + the StockFrom/StockTo TEXT labels (bounded
  strings — the actual sale-vs-wastage classification inputs, W4-SR-58). Archive-move and archive-pull
  preserve all of these. **NO in-transit stamp migration exists** — W4-SR-41 is superseded by
  stamp-at-receive (W4-SR-59): RecordSteps are immutable; legacy stamps are published by the receive step.
- **Buy-back export route (extends §3 per W4-SR-9/24/25/26/36/37 + R5 SR-55/56/57 + R6 SR-68/69/70/75 + R7
  SR-90..96):** queries LIVE across the FULL event window AND ARCHIVE across the FULL event window (Chunk-8
  archives by monotonic ID, not date — no date-partition seam) and supplies them to the engine as SEPARATE
  `rows.live`/`rows.archive` arrays (W4-SR-90). Same-list tombstones apply; a CROSS-LIST tombstone (either
  direction) = a FAIL-CLOSED CONFLICT surfaced for the Chunk-8 Director-correction path, never silently
  applied (W4-SR-70, aligning with CHUNK8 item 5). Dedup on BOTH identities (W4-SR-96, per CHUNK8 item 5):
  same-TransactionId copies with differing financial/classification fields FAIL CLOSED (W4-SR-55); distinct
  TransactionIds sharing an IdempotencyKey FAIL CLOSED. ARCHIVE COORDINATION (W4-SR-68/75/92/93/95/140): ONE
  shared coordination record with CAS/ETag transitions — the FULL FOUR-STATE machine
  (`idle | run_active(heartbeat) | export_lease(ttl) | correction_active(heartbeat, journalId)`); every
  acquisition (archiver run, export lease, correction approval) is an atomic CAS transition on it
  (no check-then-act); the route renews the lease during queries and asserts CONTINUOUS tenure after the
  second query (same lease id, unexpired, no intervening run — else discard + retry); a run whose heartbeat
  is STALE is surfaced + driven terminal by the reconcile sweep (complete or roll back per Chunk-8
  publish-nothing), so a crashed archiver never locks settlements out; attestations carry the completed-run
  version + lease id + the continuity post-check. FAIRNESS, THREE-WAY (W4-SR-108/116/140):
  `run_requested`/`export_requested`/`correction_requested` flags on the coordination record give a losing
  acquirer the next turn — each request carries owner + store timestamp + a short TTL; EVERY acquirer
  honors ALL live competing requests; EXPIRED requests are bypassed and reconciled (a crashed requester
  never locks the others out). ALSO SUPPLIED to the engine (W4-SR-114/115/122/123/124): `steps` — the
  RecordSteps rows for every transferId in the row set (enumeration-attested; the engine derives the
  transfer-item stamp projection and enforces the ORIGIN ASSERTION per SR-122/129: no valid submit/backfill
  origin ⇒ fail closed unless the row's ORIGINAL live-list id predates the Chunk-4 steps epoch — live rows
  compare their item ID, ARCHIVED rows their preserved SourceId, absent provenance ⇒ refuse; grace records
  BIND the flushing device's expected stepIds so drain proves STEP ingest too) — and
  `controls: { live, archive }` (SR-123) — TYPED tombstone/`replacement`-correction rows (SR-124/130:
  deletion removes; replacement substitutes with window membership on its ORIGINAL-EVENT UTC INSTANT and
  MUST carry both-or-neither stamps captured at approval via the full valuation precedence — an unstamped
  replacement is malformed, fail closed; no delta type; ambiguity fails closed) queried BY TARGET IDENTITY
  against the supplied row/drain identities, per-list full-target-set completion attestations
  inside the same lease, NOT window-bounded (a post-buyback deletion can prove "covered"). Bound to the bought-back storeId,
  boundary-evaluated on the row UTC instant (never the calendar-day string) for ECONOMIC rows; supplies
  full-window enumeration attestations for BOTH lists + graceClosed + (for FINAL) the DRAIN evidence
  (W4-SR-57/69/91/94/107): the OS-SR-10 grace record carries pinned terminal states `issued → consumed`
  (durably set BEFORE any row write in the same run) `→ committed` (after the last row write, RECORDING the
  written row identities); DRAINED = every grace record for the store TERMINAL, and the route/engine assert
  every committed-recorded row identity reached a TERMINAL ACCOUNTED state in the supplied rows — PRESENT,
  or covered by a validated SAME-LIST tombstone/correction (W4-SR-107); neither ⇒ refuse FINAL; cross-list ⇒
  conflict. IdempotencyKey identity applies to validated NON-EMPTY keys only (W4-SR-109; blanks fall back to
  TransactionId + surfaced legacy count). The `drain` evidence is an ENGINE INPUT (the pure engine itself
  refuses a FINAL without it). Absent graceClosed or drain ⇒ the settlement is marked PROVISIONAL and
  regenerable; FINAL requires all.
- **Correction-approval route (W4-SR-134/135/137/138 — the CHUNK8 item-5 correction arm, now defined):**
  Director-sudo-gated (editPricing-class privileged op; purpose pinned at build). Given a target
  TransactionId: acquires **`correction_active(heartbeat, journalId)`** on the shared coordination record
  (CAS; mutually exclusive with `run_active`/`export_lease`); **ROUTE CONTRACT — SPLIT BY MODE
  (SR-138/149):** INITIAL-CREATE requires the target to have NO committed reservation/control (and never a
  control-row target); SUPERSEDE/WITHDRAW requires a COMMITTED reservation whose active revision EXACTLY
  matches the intent's observed `{activeControlId, revision, publicationVersion}` — re-read after acquiring
  the state, reject on mismatch (a stale Director intent can never silently discard a newer revision);
  fetches the AUTHORITATIVE
  target row (live or archive), obtains the COMPLETE RecordSteps set for its transfer with enumeration
  proof, runs the canonical valuation precedence SERVER-side, binds the original-event UTC instant + the
  pricing publication version, and MINTS the replacement's immutable both-or-neither stamps
  (client-supplied values never authoritative). **PUBLICATION (SR-137/139/142):** journal (persisting the
  candidate version id) → write the correction row + prepare the adjusted snapshot as a CANDIDATE version
  (archived targets) → VERIFY (validity, SourceId/control set, hashes + the SR-142 DELTA-EXACTNESS
  invariant per (storeId, productId): newSnapshot = oldSnapshot − effect(target) + effect(replacement),
  unaffected pairs unchanged, published snapshot + live rows == the corrected fold — "neutrality" does not
  apply to a balance-changing correction) → PUBLISH the new version LAST → terminal-complete → release.
  PUBLICATION IS THE IRREVOCABLE COMMIT POINT (SR-139): reconcile reads the active publication pointer
  first — matching the journal's candidate ⇒ ROLL FORWARD only (never delete published rows); pre-publish ⇒
  complete or roll back; either way BEFORE any archive run or export may proceed. UNIQUENESS is a DURABLE
  RESERVATION with a LIFECYCLE (SR-138/141/143/144): a unique control-target index/registry spanning BOTH
  lists that EVERY control writer claims — the approval op AND the push ingest's tombstone path (a device
  tombstone racing an approval is quarantined for Director review, never a second control). Reservation
  states `pending(owner, opId, journalId, ttl) → committed(controlId, publicationVersion)` — only a
  PUBLISHED control commits; an INITIAL-CREATE rollback releases the pending; a SUPERSEDE claims via
  `pending_supersede(priorCommitted)` and its rollback RESTORES the prior committed lock (SR-147 — never
  strips a published predecessor's protection); orphans TTL+journal-reconciled (SR-143). The invariant is
  one ACTIVE effective control per target (SR-144): a Director-sudo SUPERSEDE/WITHDRAW runs through this
  same route under the same reservation; the effective revision RIDES the publication manifest — the
  publication pointer is the SOLE visibility switch, so roll-forward/rollback selects the exact matching
  revision; the export's FINAL check is the PER-TARGET HEAD comparison (SR-148/151:
  activeManifest.controlHeads[targetId] must name exactly the supplied {controlId, revision,
  bornPublicationVersion}, born ≤ active; withdrawn = explicit null head; delta-manifests walked — NEVER a
  global-version equality, which would block FINAL forever after any unrelated correction). TIER-1 STAMP
  AUTHORITY = SERVER SEMANTIC ATTESTATION (SR-152→153..167): every stamped LINE carries the FOUR authority
  fields {sellAtSupply, discAtSupply, pricingVersion, catalogueVersion}, all-or-none per-line, plus
  `basis` validated SEPARATELY (SR-159/167: stamped bases require all four; legacy-lens requires none);
  the steps-ingest validator (the D4-K validateMoney pattern extended) RECOMPUTES expected stamps from
  server-owned pricing history + the **IMMUTABLE CATALOGUE PUBLICATION ARCHIVE (SR-156/160/161 — NEW
  SERVER DELIVERABLE: append-only publications keyed by version w/ prices + publication intervals, written
  by ONE server-only journaled PUBLISHER — candidate [snapshot + archive record + interval] → verify →
  pointer-switch LAST → terminal, roll-forward iff switched; non-client-writable, version-CAS'd.
  CROSS-DOMAIN COMPOSITION (SR-164): pricing dual-writes + add-product use ONE COMPOSITE PARENT JOURNAL
  (the child catalogue publication PREPARES, cannot commit; the parent's single fenced commit = the sole
  visibility switch for BOTH domains — no split-brain in either crash order); Chunk-6 catalogue-only
  publishes invoke the publisher directly; the correction op only READS the archive. RETENTION INDEFINITE
  — never pruned, so no expiry state exists; claimed version must exist and be valid for the minting
  instant; unknown/forged ⇒ BAD_VERSION fail-closed into a DURABLE idempotent queue (SR-165/168: keyed by
  row/line identity + offending digest, written by the ingest path's own journal; COVERAGE IS A DERIVED
  VIEW over the active control-head manifest — control ops never write the queue (dual-write eliminated:
  rollback can't falsely clear; WITHDRAW auto-reopens; SUPERSEDE re-evaluates); stored terminals only
  from single-registry ops: corrected-and-reattested (re-attestation MINTS a server-owned tuple from the
  histories active at the minting instant — never retries the invalid claim) and rejected (unblocks FINAL
  only with the row in a durable accounted/excluded state)); settlement PROVISIONAL while any entry is
  neither stored-terminal nor view-covered; never current-price fallback — master_data.version alone counts one mutable blob and resolves nothing
  historical)** and REJECTS mismatches (BAD_STAMPS, quarantined) — accepted steps gain a SERVER-SET attestation marker (client
  values stripped). Stamped TRANSFERLESS rows (direct HO-supply) carry the five-tuple as ROW columns
  mapped on EVERY transport surface and get the SAME validation at push-v2 ROW ingest with a server-set
  attestation column (SR-155/157). ACCEPTANCE ECHO (SR-157): the pull's known-row merge INSTALLS
  server-owned attestation/version fields on rows the device already holds (the originator must see its
  own attestation; a locally-minted marker never renders as attested). The engine's tier-1 = attested
  evidence only (control rows bind via the per-target head check); BACKFILL snapshots are never tier-1
  provenance — backfill-only rows value from server-resolved history BOTH halves (discount + archived
  price) as-of the row date, delivered to clients via the gated RESOLVE-VALUATION route (SR-163/166: `rowId` MANDATORY — a tuple-only
  form permits row-existence laundering; response bound to the immutable row/line identity + a canonical
  digest of the valuation-relevant inputs → {resolvedSell, resolvedDisc, pricingVersion, catalogueVersion}
  → install-time digest compare, control ops invalidate cached responses → cached as durable server-owned
  mapped fields per the SR-157 allowlist merge; invoice renders only those or a surfaced pending state), w/ an optional Director re-attestation route
  (SR-154/158). Client-vs-client equality is DEAD as an authority proof. ⚠ TWO flagged scoped amendments
  to frozen W4.3 (per-line tuple w/ five-field fixtures; backfill stamps untrusted w/ the SR-163
  transport) — REVISED at R20, re-OK pending. Immutable versioned revision history; supersede delta = −previousEffective + newEffective;
  withdraw restores the target's effect (the append-only original evaluates PRESENT again for drain).
  CROSS-IDENTITY VALUATION (SR-145): target/item stamps mint a replacement's stamps only when product
  (and store/classification) identity matches; a product-changing replacement derives from the REPLACEMENT
  product's own sources (its genuinely-linked item stamps, else the original-event lens for that product).
  COORDINATION (SR-140): the shared record's machine is FOUR-state (idle | run_active | export_lease |
  correction_active) with THREE request flags (run/export/correction_requested, each {owner,
  storeTimestamp, ttl}); every acquirer honors all live competing requests. Live target ⇒ live list, same
  journal discipline, no snapshot interplay. Same-list by construction — the export's cross-list rule stays
  a pure corruption detector.
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
