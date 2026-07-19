/**
 * BOB Stock App — Records Module (Azure Chunk 4: multi-table record sync)
 * =======================================================================
 * Makes transfers / deliveries / stock-takes sync across devices using an
 * APPEND-ONLY "record-steps" model (D1). Every lifecycle transition is one
 * immutable step; the client FOLDS a record's steps to rebuild the local
 * Dexie object the UI already reads.
 *
 * DESIGN INVARIANTS (locked in AZURE-CHUNK4-SCOPE.md "SPEC REVIEW RESOLVED"):
 *  - TWO STREAMS: record-steps carry lifecycle/metadata ONLY and NEVER credit
 *    stock. The StockTransactions ledger stays the sole stock source of truth
 *    (unchanged), linked to a step by recordId/transferId + expectedLedgerKeys.
 *  - ADDITIVE: the existing local write paths (phase2.js / index.html) are
 *    untouched. They emit a step alongside their normal write (Records.emit).
 *    The fold's job is to materialise records this device did NOT originate
 *    (inbound) and to update its own records when other devices act on them.
 *  - FOLD is a pure, lifecycle-aware reduce over a record's steps, ordered
 *    SEQ asc -> Timestamp asc -> StepId asc (deterministic, order-independent,
 *    idempotent on re-pull). It never trusts the last sorted status blindly and
 *    never treats a missing dependency as resolved.
 *  - R1 RECONCILIATION: a stock-effecting step is rendered `stockPending` until
 *    its expectedLedgerKeys are observed locally (present + not rejected), and
 *    `stockMismatch` if any were server-rejected. The matching push order is
 *    fail-closed (ledger rows push first; the step is only eligible to push once
 *    its ledger rows are confirmed) — enforced in Sync.pushSteps().
 *  - IDEMPOTENCY: stepId is the deterministic dedup key. A receive step is keyed
 *    on a STABLE persisted receiveAttemptId (survives a crash-retry; a different
 *    device gets a different one -> both survive -> the fold sees the conflict).
 *
 * WIRE CONTRACT (client camelCase  <->  SharePoint PascalCase) — keep this map ==
 * the recordsteps-push/pull Logic Apps (the Chunk-2 lesson: a mock that drifts
 * from the deployed contract passes the harness but breaks in reality):
 *   stepId        <-> StepId        (deterministic idempotency key; Enforce-Unique)
 *   recordType    <-> RecordType    ('transfer'|'delivery'|'stocktake')
 *   recordId      <-> RecordId
 *   stepType      <-> StepType
 *   seq           <-> Seq           (lifecycle-phase ordinal; fold sort hint)
 *   ownerStoreId  <-> OwnerStoreId
 *   fromStoreId   <-> FromStoreId   ('' unless transfer)
 *   toStoreId     <-> ToStoreId     ('' unless transfer)
 *   status        <-> Status        (record status this step sets)
 *   payload(obj)  <-> Payload       (JSON string)
 *   actorId       <-> ActorId
 *   actorName     <-> ActorName
 *   deviceId      <-> DeviceId
 *   timestamp     <-> Timestamp     (epoch ms business event time)
 *   deleted       <-> Deleted       (bool; record voided)
 *   (server-set)  <-  SyncTimestamp (pull cursor; never sent by client)
 *   (server-set)  <-  ID            (SP item id; ID-cursor pull key)
 */

const Records = {
  // ─── Step taxonomy ───────────────────────────────────────────────────
  // transfer 'create' (draft) is local WIP and NOT synced — the genesis synced
  // step is 'submit' (transfer sent). flag rides the receive payload (D4-B).
  RECORD_TYPES: ['transfer', 'delivery', 'stocktake'],
  STEP_TYPES: {
    transfer:  ['submit', 'receive', 'resolve', 'cancel'],
    delivery:  ['record', 'packaging_edit'],
    stocktake: ['count', 'approve', 'reject'],
  },
  // Lifecycle-phase ordinals for the fold sort. seq is NOT a per-device counter
  // (different devices emit different steps of one record) — it is a stable phase
  // rank so the reduce is deterministic regardless of arrival order. Ties broken
  // by Timestamp then StepId.
  SEQ: {
    submit: 10, record: 10, count: 10,
    cancel: 15,
    receive: 20, packaging_edit: 20, approve: 30, reject: 30,
    resolve: 40,
    backfill: 5,
  },
  MAX_PAYLOAD_BYTES: 60000,  // bound the JSON payload (server enforces too)

  // ─── id / actor helpers ──────────────────────────────────────────────
  _rnd() {
    return (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')
      : String(Date.now() % 1e8) + 'x';
  },
  // D4-M: globally-unique record ids (delivery/stocktake were plain Date.now()).
  genId(prefix) { return prefix + Date.now() + '_' + this._rnd(); },
  // A stable receive-attempt id: minted ONCE per receive attempt and stored on the
  // local transfer (_receiveAttemptId) so a crash-retry replays the SAME step id.
  newAttemptId() { return 'ra_' + Date.now() + '_' + this._rnd(); },

  _actor() {
    try { if (typeof Auth !== 'undefined' && Auth.actor) return Auth.actor() || {}; } catch (e) {}
    return {};
  },
  _actorId() { const a = this._actor(); return (a && (a.id || a.username)) || ''; },
  _actorName() {
    try { if (typeof Auth !== 'undefined' && Auth.user && Auth.user()) return Auth.user().name || Auth.user().username || ''; } catch (e) {}
    const a = this._actor(); return (a && (a.name || a.username)) || '';
  },
  _deviceId() { return (typeof Sync !== 'undefined' && Sync._deviceId) ? Sync._deviceId : ''; },

  // A composite-key segment must be a safe ledger id [A-Za-z0-9_-] so the joined
  // stepId is unambiguous + server-validatable. ids/storeIds are already sanitised
  // at entry; this is a defensive assertion (returns '' for an unsafe segment so a
  // bad component produces a clearly-broken — not a forged — key).
  _seg(v) {
    const s = String(v == null ? '' : v);
    if (typeof Stock !== 'undefined' && Stock._isSafeLedgerId) return Stock._isSafeLedgerId(s) ? s : '';
    return /^[A-Za-z0-9_-]+$/.test(s) ? s : '';
  },

  // ─── stepId composition (deterministic idempotency keys) ─────────────
  // Components are safe ledger ids joined by ':'. The server re-validates by
  // stripping ':' and running the Chunk-2 no-regex safe-id check on the remainder.
  stepId(recordType, recordId, stepType, disc) {
    const pfx = recordType === 'transfer' ? 'tr' : recordType === 'delivery' ? 'del' : 'st';
    const parts = [pfx, this._seg(recordId), stepType];
    if (disc != null && disc !== '') parts.push(this._seg(disc));
    // some steps carry a 2-part discriminator (receive: toStore + attemptId)
    return parts.join(':');
  },
  receiveStepId(recordId, toStoreId, attemptId) {
    return ['tr', this._seg(recordId), 'receive', this._seg(toStoreId), this._seg(attemptId)].join(':');
  },
  // A resolve step is keyed by (generation, the set of products it resolves) so two distinct resolve
  // operations on one transfer don't collide, while a retry of the SAME resolve is deduped. A conflict
  // re-resolution bumps the generation (D4-F reopen).
  resolveStepId(recordId, generation, productIds) {
    const h = this._stableHash((productIds || []).slice().sort());
    return ['tr', this._seg(recordId), 'resolve', String(generation || 0), h].join(':');
  },
  // GPT Chunk-4 BLOCK #3 (D4-I): include the content HASH in the backfill stepId. Two devices backfilling the
  // SAME record with IDENTICAL content → same hash → same stepId → 409 converge (harmless). But if the content
  // DIFFERS (e.g. two pre-Chunk-4 records that collided on an old Date.now() id) → different hash → different
  // stepId → BOTH land → the fold sees divergent backfill snapshots and surfaces a conflict, instead of the old
  // behaviour where the 2nd silently 409'd and first-writer-won.
  backfillStepId(recordType, recordId, hash) {
    const pfx = recordType === 'transfer' ? 'tr' : recordType === 'delivery' ? 'del' : 'st';
    const parts = [pfx, this._seg(recordId), 'backfill'];
    if (hash) parts.push(this._seg(hash));
    return parts.join(':');
  },

  // ─── Emit (the write path) ───────────────────────────────────────────
  // Builds a step from a partial spec and persists it durably (DB.addStepDurable),
  // which schedules a push. ADDITIVE: callers still do their normal local write +
  // ledger write; this just records the lifecycle step alongside. Returns the step
  // (or null on a guard failure). NEVER throws into the caller's write path.
  async emit(spec) {
    try {
      if (!spec || !spec.recordType || !spec.recordId || !spec.stepType) return null;
      const payload = spec.payload || {};
      const step = {
        stepId:       spec.stepId || this.stepId(spec.recordType, spec.recordId, spec.stepType, spec.disc),
        recordType:   spec.recordType,
        recordId:     String(spec.recordId),
        stepType:     spec.stepType,
        seq:          (this.SEQ[spec.stepType] != null ? this.SEQ[spec.stepType] : 50),
        ownerStoreId: this._seg(spec.ownerStoreId || ''),
        fromStoreId:  this._seg(spec.fromStoreId || ''),
        toStoreId:    this._seg(spec.toStoreId || ''),
        status:       spec.status || '',
        payload:      payload,
        actorId:      spec.actorId != null ? spec.actorId : this._actorId(),
        actorName:    spec.actorName != null ? spec.actorName : this._actorName(),
        deviceId:     this._deviceId(),
        timestamp:    (typeof spec.timestamp === 'number') ? spec.timestamp : Date.now(),
        deleted:      !!spec.deleted,
        _synced:      false,
      };
      if (typeof DB !== 'undefined' && DB.addStepDurable) {
        await DB.addStepDurable(step);
      }
      return step;
    } catch (e) {
      console.error('[Records] emit failed (non-fatal — local write already done):', e);
      try { if (typeof Diag !== 'undefined') Diag.log('sync', 'record-step emit failed: ' + (e && e.message)); } catch (_) {}
      return null;
    }
  },

  // ─── Wire mapping ────────────────────────────────────────────────────
  toSharePoint(step) {
    let payloadStr = '';
    try { payloadStr = JSON.stringify(step.payload || {}); } catch (e) { payloadStr = '{}'; }
    return {
      StepId:       step.stepId,
      RecordType:   step.recordType || '',
      RecordId:     step.recordId || '',
      StepType:     step.stepType || '',
      Seq:          Number.isSafeInteger(step.seq) ? step.seq : 50,
      OwnerStoreId: step.ownerStoreId || '',
      FromStoreId:  step.fromStoreId || '',
      ToStoreId:    step.toStoreId || '',
      Status:       step.status || '',
      Payload:      payloadStr,
      ActorId:      step.actorId || '',
      ActorName:    step.actorName || '',
      DeviceId:     step.deviceId || this._deviceId() || '',
      Timestamp:    (typeof step.timestamp === 'number') ? step.timestamp : Date.now(),
      Deleted:      !!step.deleted,
    };
  },
  // Inbound SP item -> local step. Returns null for a malformed row (caller skips,
  // never throws -> never stalls the device's sync).
  fromSharePoint(item) {
    if (!item || typeof item !== 'object' || !item.StepId) return null;
    if (!this.RECORD_TYPES.includes(String(item.RecordType))) return null;
    let payload = {};
    try { payload = item.Payload ? JSON.parse(item.Payload) : {}; }
    catch (e) { return null; }  // unparseable payload -> skip (server should have rejected it)
    if (!payload || typeof payload !== 'object') return null;
    const seqN = parseInt(item.Seq, 10);
    return {
      stepId:       String(item.StepId),
      recordType:   String(item.RecordType),
      recordId:     String(item.RecordId || ''),
      stepType:     String(item.StepType || ''),
      seq:          Number.isSafeInteger(seqN) ? seqN : (this.SEQ[String(item.StepType)] || 50),
      ownerStoreId: String(item.OwnerStoreId || ''),
      fromStoreId:  String(item.FromStoreId || ''),
      toStoreId:    String(item.ToStoreId || ''),
      status:       String(item.Status || ''),
      payload:      payload,
      actorId:      String(item.ActorId || ''),
      actorName:    String(item.ActorName || ''),
      deviceId:     String(item.DeviceId || ''),
      timestamp:    (function () { const n = Number(item.Timestamp); return Number.isFinite(n) ? n : 0; })(),
      deleted:      item.Deleted === true || item.Deleted === 'true' || item.Deleted === 1,
      _synced:      true,
    };
  },

  // ─── Fold ─────────────────────────────────────────────────────────────
  // Deterministic order: SEQ asc, Timestamp asc, StepId asc.
  sortSteps(steps) {
    return (steps || []).slice().sort((a, b) => {
      const sa = (a.seq != null ? a.seq : 50), sb = (b.seq != null ? b.seq : 50);
      if (sa !== sb) return sa - sb;
      const ta = a.timestamp || 0, tb = b.timestamp || 0;
      if (ta !== tb) return ta - tb;
      return String(a.stepId).localeCompare(String(b.stepId));
    });
  },

  // R1: derive the stock state for a step's expectedLedgerKeys (ledger TransactionIds).
  // 'confirmed' = all present + none rejected; 'mismatch' = at least one server-rejected;
  // 'pending' = at least one not-yet-seen; 'none' = no keys (not a stock-effecting step).
  // Chunk 8 (D8-7): after archival, a ledger row whose SP id <= the snapshot cutoff is PRUNED locally, so a
  // long-settled key would look "missing" and regress to 'pending' forever. GPT P1: a missing key is CONFIRMED
  // ONLY when it is a KNOWN-ARCHIVED key — proven per-key via DB's archived-step-key index (populated at prune
  // time from steps' expectedLedgerKeys). A key that NEVER LANDED is NOT in that index, so it stays 'pending'
  // (never a false 'completed' — this preserves the Chunk-4 R1 guarantee across archival). No date heuristic.
  // Server-rejected keys, when the row is still present, still win (mismatch). stepTimestamp is retained for
  // signature compatibility but no longer influences the verdict.
  stockStateFor(expectedKeys, stepTimestamp) {
    const keys = Array.isArray(expectedKeys) ? expectedKeys.filter(Boolean) : [];
    if (keys.length === 0) return 'none';
    const txns = (typeof DB !== 'undefined' && DB.get && DB.get()) ? (DB.get().transactions || []) : [];
    const byId = new Map(txns.map(t => [t.id, t]));
    const hasArchivedKey = (typeof DB !== 'undefined' && DB.hasArchivedStepKey) ? (k => DB.hasArchivedStepKey(k)) : (() => false);
    let pending = false;
    for (const k of keys) {
      const row = byId.get(k);
      if (!row) { if (!hasArchivedKey(k)) pending = true; continue; }  // missing: confirmed ONLY if proven archived, else pending
      if (row._rejected) return 'mismatch';
    }
    return pending ? 'pending' : 'confirmed';
  },

  // Group all known steps by recordId.
  _groupByRecord(steps) {
    const m = new Map();
    (steps || []).forEach(s => {
      if (!s || !s.recordId) return;
      if (!m.has(s.recordId)) m.set(s.recordId, []);
      m.get(s.recordId).push(s);
    });
    return m;
  },

  // OS-W43-R1 (Codex-1): a line's stamp claim is adopted ALL-FOUR-or-none.
  _fullTuple(o) { return !!(o && o.sellAtSupply != null && o.discAtSupply != null && o.pricingVersion != null && o.catalogueVersion != null); },
  // Fold one record's steps into the local object shape the UI reads.
  // Dispatches by the recordType of the genesis step.
  foldRecord(steps) {
    const sorted = this.sortSteps(steps);
    if (sorted.length === 0) return null;
    const rt = sorted[0].recordType;
    let folded = null;
    if (rt === 'transfer')  folded = this.foldTransfer(sorted);
    else if (rt === 'delivery')  folded = this.foldDelivery(sorted);
    else if (rt === 'stocktake') folded = this.foldStocktake(sorted);
    if (!folded) return null;
    // GPT Chunk-4 BLOCK #3 (D4-I) + OS-W4.3 (W4-SR-113/121/106): if two devices backfilled the same
    // recordId with DIFFERENT content, both snapshots land (distinct hash-in-id). Divergence is decided by
    // RECOMPUTING the v4 semantic canonical hash over each snapshot — never by comparing embedded hash
    // strings (a pre-W4 and a W4 snapshot of the SAME economic reality canonicalize identically, so the
    // hash-algorithm migration can't false-diverge; meaningful stamp/item differences still conflict).
    // A resolve step naming the divergent EMBEDDED hashes via resolvesBackfillHashes SETTLES them (SR-106,
    // the resolvesAttemptIds pattern) — a Director-resolved divergence actually converges.
    const bfSteps = sorted.filter(s => s.stepType === 'backfill' && s.payload && s.payload.snapshot);
    if (bfSteps.length > 1) {
      let lastRes = null;
      for (const s of sorted) if (s.stepType === 'resolve') lastRes = s;
      const settled = new Set((lastRes && lastRes.payload && lastRes.payload.resolvesBackfillHashes) || []);
      const live = bfSteps.filter(s => !settled.has((s.payload && s.payload.hash) || ''));
      const canon = new Set(live.map(s => this._deepHash(rt, s.payload.snapshot)));
      if (canon.size > 1) {
        folded.status = 'conflict';
        folded._conflict = { kind: 'backfill_divergence', hashes: live.map(s => (s.payload && s.payload.hash) || ''), canonicalHashes: Array.from(canon) };
      }
    }
    return folded;
  },

  // ----- transfer -----
  foldTransfer(sorted) {
    let t = null;
    const receives = [];
    let cancelled = false, lastResolve = null;
    for (const s of sorted) {
      const p = s.payload || {};
      if (s.stepType === 'submit' || (s.stepType === 'backfill' && p.snapshot)) {
        const base = (s.stepType === 'backfill') ? p.snapshot : p;
        t = {
          id: s.recordId,
          date: base.createdAt || base.date || new Date(s.timestamp || Date.now()).toISOString(),
          createdAt: base.createdAt || '',
          submittedAt: base.submittedAt || ((s.stepType === 'submit' && s.timestamp) ? new Date(s.timestamp).toISOString() : (base.date || '')),   // OS-W43-R2 (Codex-3): the submit step's own instant backfills pre-W4 payloads; EXCLUDED from the canonical form (derived metadata, cross-version stable)
          fromStoreId: s.fromStoreId || base.fromStoreId || '',
          toStoreId: s.toStoreId || base.toStoreId || '',
          createdBy: base.createdBy || s.actorId || '',
          createdByName: base.createdByName || s.actorName || '',
          status: (s.stepType === 'backfill') ? (base.status || 'in_transit') : 'in_transit',
          type: base.type || 'standard',
          returnReason: base.returnReason || null,
          returnNote: base.returnNote || '',
          items: (base.items || []).map(it => ({
            productId: it.productId,
            sentQty: it.sentQty,
            receivedQty: (it.receivedQty != null ? it.receivedQty : null),
            status: it.status || 'confirmed',
            flagNote: it.flagNote || '',
            resolvedBy: it.resolvedBy || null,
            resolvedAction: it.resolvedAction || null,
            creditedAtReceive: it.creditedAtReceive || 0,
            // OS-W4.3 P3 (SR-87) + R1 Codex-1: the FULL authority tuple is mapped EXPLICITLY, all-four-or-
            // none (a partial tuple is never adopted). A stampless genesis with no explicit basis stays
            // UNSET — "awaiting stamp-at-receive" vs "durably legacy" is decided by the receive rules.
            // R1 Codex-2: stamps whose source is a BACKFILL snapshot are marked UNTRUSTED (amendment 2 —
            // not tier-2 valuation evidence; the invoice uses server-resolved values or a pending state).
            sellAtSupply: this._fullTuple(it) ? it.sellAtSupply : null,
            discAtSupply: this._fullTuple(it) ? it.discAtSupply : null,
            pricingVersion: this._fullTuple(it) ? it.pricingVersion : null,
            catalogueVersion: this._fullTuple(it) ? it.catalogueVersion : null,
            basis: it.basis || null,
            _stampsUntrusted: (s.stepType === 'backfill' && this._fullTuple(it)) ? true : undefined,
          })),
          notes: base.notes || '',
          _stepSourced: true,
        };
      } else if (!t) {
        continue;  // a step before its genesis — hold (out-of-order; re-pull will reconcile)
      } else if (s.stepType === 'receive') {
        receives.push(s);
        this._applyReceive(t, s);
      } else if (s.stepType === 'resolve') {
        lastResolve = s;
        this._applyResolve(t, s);
      } else if (s.stepType === 'cancel') {
        cancelled = true;
        t.status = 'cancelled';
        t.completedDate = new Date(s.timestamp || Date.now()).toISOString();
      }
    }
    if (!t) return null;

    // ── Conflict detection (D4-F) ──────────────────────────────────────
    // Two+ receive steps from different attempts → compare per-line received qty.
    // Same qty on all lines → benign duplicate (silent). Different → conflict, and
    // the conflict reopens if a receive arrived AFTER the latest resolve covered it.
    if (!cancelled && receives.length > 1) {
      const conflict = this._detectReceiveConflict(receives, lastResolve);
      if (conflict) {
        t.status = 'conflict';
        t._conflict = conflict;
      }
    }
    // A cancel racing a receive is itself a conflict (D4-F extra Q3).
    if (cancelled && receives.length > 0) {
      t.status = 'conflict';
      t._conflict = t._conflict || { kind: 'cancel_vs_receive', receives: receives.map(r => this._receiveSummary(r)) };
    }

    // R1 stock state from the most recent stock-effecting step.
    t._stockState = this._transferStockState(sorted);
    // R1 (GPT Chunk-4 BLOCK #1): NEVER present a clean completed/received receive whose stock hasn't landed.
    // The UI routes by `status`, so the stock reality must be reflected THERE (not only in _stockState).
    // Keep the true lifecycle status in _lifecycleStatus; surface stock_pending/stock_mismatch in `status`.
    // Transient + self-healing: as the ledger rows arrive, a re-fold moves pending → confirmed → completed.
    if (t.status !== 'conflict' && t.status !== 'cancelled') {
      if (t._stockState === 'mismatch') { t._lifecycleStatus = t.status; t.status = 'stock_mismatch'; }
      else if (t._stockState === 'pending' && (t.status === 'completed' || t.status === 'received')) { t._lifecycleStatus = t.status; t.status = 'stock_pending'; }
    }
    return t;
  },

  _applyReceive(t, s) {
    const p = s.payload || {};
    t.receivedBy = p.receivedBy || s.actorId || t.receivedBy || null;
    t.receivedDate = p.receivedDate || new Date(s.timestamp || Date.now()).toISOString();
    let anyFlag = false;
    (p.lines || []).forEach(ln => {
      const item = (t.items || []).find(i => i.productId === ln.productId);
      if (!item) return;
      item.receivedQty = ln.receivedQty;
      if (ln.flagged) { item.status = 'flagged'; item.flagNote = ln.flagNote || ''; item.creditedAtReceive = ln.receivedQty || 0; anyFlag = true; }
      else { item.status = 'accepted'; }
      // OS-W4.3 (SR-86/97) BASIS PRECEDENCE: a stamped item is PERMANENT — nothing a later step omits can
      // downgrade it. A stamped receive line fills a stampless item (stamp-at-receive publishing). A
      // basis-less receive line (a pre-W4 receiver) sets 'legacy-lens' ONLY when the submit is ALSO
      // stampless — a stamped submit survives a stale receive untouched (its unstamped rows are handled
      // by valuation precedence, no row mutation).
      const _itemStamped = (item.sellAtSupply != null && item.discAtSupply != null);
      const _lnStamped = Records._fullTuple(ln);
      if (_lnStamped && !_itemStamped) { item.sellAtSupply = ln.sellAtSupply; item.discAtSupply = ln.discAtSupply; item.pricingVersion = ln.pricingVersion; item.catalogueVersion = ln.catalogueVersion; item.basis = ln.basis || 'receive-stamped'; item._stampsUntrusted = undefined; }   // a STEP-sourced tuple is trusted evidence (R1 Codex-2)
      else if (_lnStamped && _itemStamped && item._stampsUntrusted) { item.sellAtSupply = ln.sellAtSupply; item.discAtSupply = ln.discAtSupply; item.pricingVersion = ln.pricingVersion; item.catalogueVersion = ln.catalogueVersion; item.basis = ln.basis || item.basis; item._stampsUntrusted = undefined; }
      else if (!_lnStamped && !_itemStamped && !item.basis) { item.basis = 'legacy-lens'; }
    });
    t.status = anyFlag ? 'received' : 'completed';
    if (!anyFlag) t.completedDate = new Date(s.timestamp || Date.now()).toISOString();
  },

  _applyResolve(t, s) {
    const p = s.payload || {};
    (p.resolutions || []).forEach(r => {
      const item = (t.items || []).find(i => i.productId === r.productId);
      if (!item) return;
      item.resolvedBy = p.resolvedBy || s.actorId || null;
      item.resolvedAction = r.action || null;
      item.status = 'resolved';
      // OS-W4.3 P5 (SR-85) + R1 Codex-1/2: the resolve carries the PINNED full tuple — the chosen
      // outcome publishes cross-device and is trusted step evidence.
      if (Records._fullTuple(r)) { item.sellAtSupply = r.sellAtSupply; item.discAtSupply = r.discAtSupply; item.pricingVersion = r.pricingVersion; item.catalogueVersion = r.catalogueVersion; item._stampsUntrusted = undefined; }
      if (r.basis) item.basis = r.basis;
    });
    t.status = 'completed';
    t.completedDate = new Date(s.timestamp || Date.now()).toISOString();
  },

  _receiveSummary(s) {
    const p = s.payload || {};
    return {
      attemptId: p.receiveAttemptId || '',
      deviceId: s.deviceId || '',
      actorName: s.actorName || '',
      timestamp: s.timestamp || 0,
      lines: (p.lines || []).map(l => {
        const o = { productId: l.productId, receivedQty: l.receivedQty };
        if (l.sellAtSupply != null && l.discAtSupply != null) { o.sellAtSupply = l.sellAtSupply; o.discAtSupply = l.discAtSupply; if (l.pricingVersion != null) o.pricingVersion = l.pricingVersion; if (l.catalogueVersion != null) o.catalogueVersion = l.catalogueVersion; }   // OS-W4.3 (SR-66) + R1: the full tuple is part of the conflict identity
        if (l.basis) o.basis = l.basis;
        return o;
      }),
    };
  },

  // Returns a conflict descriptor when UNRESOLVED receive attempts disagree on a line qty, OR a receive
  // landed after the latest resolve that was meant to settle it (reopen). GPT Chunk-4 BLOCK #2: a resolve
  // that names (covers) all the disagreeing attempts CLEARS the conflict — the old code re-flagged any
  // quantity disagreement even after it had been resolved, so a resolved conflict folded back to 'conflict'.
  _detectReceiveConflict(receives, lastResolve) {
    const byAttempt = receives.map(r => this._receiveSummary(r));
    // Attempts already settled by the latest resolve are no longer in conflict.
    const covered = new Set((lastResolve && lastResolve.payload && lastResolve.payload.resolvesAttemptIds) || []);
    const uncovered = byAttempt.filter(a => !covered.has(a.attemptId));
    // Reopen: an UNCOVERED receive that landed AFTER the resolve (a late 3rd receive — D4-F).
    const reopened = !!(lastResolve && uncovered.some(a => a.timestamp > (lastResolve.timestamp || 0)));
    // Disagreement is evaluated over UNCOVERED attempts only. A resolve that covers every attempt → no
    // uncovered attempts → no disagreement → resolved (returns null).
    // OS-W4.3 (SR-66): the identity extends beyond qty to the FINANCIAL payload — equal quantities with
    // DIFFERING stamps are a conflict (billing must never be sync-order-dependent). Absence is not a
    // differing claim: a pre-W4 attempt without stamps does not conflict with a stamped attempt of the
    // same qty (SR-97 — valuation precedence covers its rows); only two PRESENT-but-unequal stamp sets
    // disagree.
    const lineMap = {};   // productId -> { qtys: Set, stamps: Set (stamped lines only) }
    uncovered.forEach(a => a.lines.forEach(l => {
      const e = (lineMap[l.productId] = lineMap[l.productId] || { qtys: new Set(), stamps: new Set() });
      e.qtys.add(Number(l.receivedQty));
      if (l.sellAtSupply != null && l.discAtSupply != null) e.stamps.add(l.sellAtSupply + '|' + l.discAtSupply + '|' + (l.pricingVersion != null ? l.pricingVersion : '') + '|' + (l.catalogueVersion != null ? l.catalogueVersion : '') + '|' + (l.basis || ''));
    }));
    const disagree = Object.keys(lineMap).some(pid => lineMap[pid].qtys.size > 1 || lineMap[pid].stamps.size > 1);
    if (!disagree && !reopened) return null;
    return {
      kind: reopened ? 'reopened' : 'qty_disagreement',
      generation: ((lastResolve && lastResolve.payload && lastResolve.payload.generation) || 0) + (reopened ? 1 : 0),
      attempts: uncovered.length ? uncovered : byAttempt,
    };
  },

  _transferStockState(sorted) {
    // Use the latest stock-effecting step's expectedLedgerKeys.
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      const keys = s.payload && s.payload.expectedLedgerKeys;
      if (Array.isArray(keys) && keys.length) {
        const st = this.stockStateFor(keys, s.timestamp);  // Chunk 8: pass step time for the archived-key resolver
        if (st !== 'none') return st;
      }
    }
    return 'confirmed';
  },

  // ----- delivery -----
  foldDelivery(sorted) {
    let d = null;
    const edits = [];
    for (const s of sorted) {
      const p = s.payload || {};
      if (s.stepType === 'record' || (s.stepType === 'backfill' && p.snapshot)) {
        const base = (s.stepType === 'backfill') ? p.snapshot : p;
        d = Object.assign({}, base, { id: s.recordId, _stepSourced: true });
      } else if (s.stepType === 'packaging_edit' && d) {
        edits.push(s);
      }
    }
    if (!d) return null;
    // Apply packaging edits in order (last wins per line for cost fields).
    edits.forEach(s => {
      (s.payload.lines || []).forEach(ln => {
        const line = (d.lines || []).find(l => l.productId === ln.productId);
        if (!line) return;
        Object.assign(line, ln);
      });
    });
    d._stockState = this._latestStockState(sorted);
    return d;
  },

  // ----- stocktake -----
  foldStocktake(sorted) {
    let st = null;
    for (const s of sorted) {
      const p = s.payload || {};
      if (s.stepType === 'count' || (s.stepType === 'backfill' && p.snapshot)) {
        const base = (s.stepType === 'backfill') ? p.snapshot : p;
        st = {
          id: s.recordId,
          date: base.date || new Date(s.timestamp || Date.now()).toISOString().split('T')[0],
          storeId: s.ownerStoreId || base.storeId || '',
          completedBy: base.completedBy || s.actorName || '',
          items: (base.items || []).map(it => Object.assign({}, it)),
          status: base.status || 'pending',
          _stepSourced: true,
        };
      } else if (!st) {
        continue;
      } else if (s.stepType === 'approve') {
        st.status = 'approved';
        st.approvedBy = p.approvedBy || s.actorName || '';
        st.approvedAt = p.approvedAt || new Date(s.timestamp || Date.now()).toISOString();
      } else if (s.stepType === 'reject') {
        st.status = 'rejected';
        st.rejectedBy = p.rejectedBy || s.actorName || '';
        st.rejectedAt = p.rejectedAt || new Date(s.timestamp || Date.now()).toISOString();
      }
    }
    if (!st) return null;
    st._stockState = this._latestStockState(sorted);
    return st;
  },

  _latestStockState(sorted) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const keys = sorted[i].payload && sorted[i].payload.expectedLedgerKeys;
      if (Array.isArray(keys) && keys.length) {
        const stt = this.stockStateFor(keys, sorted[i].timestamp);  // Chunk 8: step time for archived-key resolver
        if (stt !== 'none') return stt;
      }
    }
    return 'confirmed';
  },

  // ─── Apply pulled steps to the local record tables (inbound materialisation) ──
  // After a pull merges new steps into DB._cache.recordSteps, re-fold every record
  // that has steps and upsert the folded object into transfers/deliveries/stockTakes.
  // Records this device originated are folded identically (idempotent); records from
  // other devices are CREATED here so they become visible/actionable. Returns true if
  // anything changed. Durable; never throws into the pull path.
  async applyFold() {
    try {
      if (typeof DB === 'undefined' || !DB.get) return false;
      const d = DB.get();
      const steps = d.recordSteps || [];
      if (steps.length === 0) return false;
      const groups = this._groupByRecord(steps);
      let changed = false;
      const transfersToWrite = [];
      for (const [recordId, recSteps] of groups) {
        const folded = this.foldRecord(recSteps);
        if (!folded) continue;
        const rt = recSteps[0].recordType;
        if (rt === 'transfer') {
          const arr = d.transfers || (d.transfers = []);
          const idx = arr.findIndex(x => x && x.id === recordId);
          if (idx === -1) { arr.push(folded); transfersToWrite.push(folded); changed = true; }
          else if (this._mergeWorthwhile(arr[idx], folded)) { Object.assign(arr[idx], folded); transfersToWrite.push(arr[idx]); changed = true; }
        } else if (rt === 'delivery') {
          const arr = d.deliveries || (d.deliveries = []);
          const idx = arr.findIndex(x => x && x.id === recordId);
          if (idx === -1) { arr.push(folded); changed = true; }
          else if (this._mergeWorthwhile(arr[idx], folded)) { Object.assign(arr[idx], folded); changed = true; }
        } else if (rt === 'stocktake') {
          const arr = d.stockTakes || (d.stockTakes = []);
          const idx = arr.findIndex(x => x && x.id === recordId);
          if (idx === -1) { arr.push(folded); changed = true; }
          else if (this._mergeWorthwhile(arr[idx], folded)) { Object.assign(arr[idx], folded); changed = true; }
        }
      }
      if (!changed) return false;
      // Persist: transfers via their durable writer; deliveries/stockTakes ride the
      // ref-data commit (they live in the ref-data persist set).
      for (const tr of transfersToWrite) { try { await DB.updateTransferDurable(tr); } catch (e) {} }
      try { await DB.commitDurable(); } catch (e) {}
      return true;
    } catch (e) {
      console.error('[Records] applyFold failed:', e);
      return false;
    }
  },

  // Only overwrite a local record from the fold when the fold actually advances it
  // (avoids churn + protects a more-advanced local state from an out-of-order partial
  // fold). Heuristic: status rank, plus a conflict always wins (must surface).
  _STATUS_RANK: { draft: 0, in_transit: 1, pending: 1, received: 2, stock_pending: 2, conflict: 3, stock_mismatch: 3, completed: 4, cancelled: 4, clean: 4, approved: 4, rejected: 4 },
  // A conflict is cleared ONLY by a genuine settlement (a resolve → completed/cancelled, or a stock-state
  // terminal). This lets a resolved conflict clear on OTHER devices once they pull the resolve step (GPT
  // BLOCK #2 interaction) while still refusing a spurious non-terminal fold from silently clearing it.
  _CLEARS_CONFLICT: { completed: 1, cancelled: 1, stock_mismatch: 1, stock_pending: 1 },
  _mergeWorthwhile(localRec, folded) {
    if (!localRec) return true;
    if (folded.status === 'conflict' || folded.status === 'stock_mismatch') return true;  // always surface
    if (localRec.status === 'conflict') return !!this._CLEARS_CONFLICT[folded.status];     // only a settlement clears it
    const lr = this._STATUS_RANK[localRec.status] != null ? this._STATUS_RANK[localRec.status] : 0;
    const fr = this._STATUS_RANK[folded.status] != null ? this._STATUS_RANK[folded.status] : 0;
    return fr >= lr;  // fold may advance or refresh same-rank (idempotent), never regress
  },

  // ─── Automatic one-time backfill (D4-I) ──────────────────────────────
  // On first run of the Chunk-4 code, emit ONE deterministic snapshot step per
  // pre-existing local record (transfers/deliveries/stockTakes that predate
  // record-steps) so they propagate cross-device. NEVER manual (Kunal). With no
  // production data yet this is effectively a no-op (= start fresh). Convergence
  // (auditor D4-I): the StepId is deterministic ({recordType}:{recordId}:backfill)
  // so two devices backfilling the same record collide on the server's Enforce-Unique
  // (409 → duplicate); a content `hash` is carried so a genuine divergence (two
  // different records under one id) can be flagged server-side rather than silently
  // first-writer-wins. Stock is untouched — these snapshots carry NO expectedLedgerKeys
  // (the historical ledger rows already synced); a backfill step never credits stock.
  BACKFILL_FLAG: 'bob_records_backfilled',

  // ── OS-W4.3 (W4-SR-105): CANONICAL RECURSIVE serializer. The old _stableHash passed
  // Object.keys(obj).sort() as a stringify REPLACER, which drops nested-object fields at EVERY level —
  // item stamps, and even item CONTENT, were invisible to it (⚠ pre-existing Chunk-4 bug: backfill
  // divergence detection was blind to item-level differences since D4-I; flagged Kunal-visible). This
  // serializer sorts keys at every depth, so $100-vs-$150 item stamps produce distinct hashes.
  _canonicalSerialize(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(x => this._canonicalSerialize(x)).join(',') + ']';
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + this._canonicalSerialize(v[k])).join(',') + '}';
  },
  _fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  },
  // OS-W4.3 (W4-SR-121/128): the VERSION-NORMALIZED SEMANTIC CANONICAL FORM, v4 — divergence is decided
  // by recomputing THIS over each backfill snapshot, never by comparing embedded hash strings (SR-113:
  // old-algorithm hashes live in historical stepIds; the two algorithms' outputs are never compared).
  // Rules: STRICT SCHEMA PROJECTION (keys unknown to the pinned W4 shape are STRIPPED — a future field
  // can never falsely diverge a W4 fold; SR-128 pins every future schema change to a NEW immutable
  // canonical-form version + fixture extension, never a mutation of this one); legacy ABSENCE maps to
  // the exact W4 defaults (a stampless legacy item gains basis 'legacy-lens'); explicit-null and absent
  // collapse to ONE form — so a pre-W4 snapshot and a W4 snapshot of the SAME economic reality hash
  // IDENTICALLY, while meaningful stamp/basis differences are preserved and still conflict.
  CANONICAL_FORM_VERSION: 4,
  _canonTransferItemV4(it) {
    const o = it || {};
    const stamped = (o.sellAtSupply != null && o.discAtSupply != null);
    return {
      productId: o.productId != null ? o.productId : '',
      sentQty: o.sentQty != null ? o.sentQty : null,
      receivedQty: o.receivedQty != null ? o.receivedQty : null,
      status: o.status || 'confirmed',
      flagNote: o.flagNote || '',
      resolvedBy: o.resolvedBy != null ? o.resolvedBy : null,
      resolvedAction: o.resolvedAction != null ? o.resolvedAction : null,
      creditedAtReceive: o.creditedAtReceive || 0,
      sellAtSupply: stamped ? o.sellAtSupply : null,
      discAtSupply: stamped ? o.discAtSupply : null,
      pricingVersion: stamped && o.pricingVersion != null ? o.pricingVersion : null,      // OS-W43-R1 (Codex-1): a version-only difference is a MEANINGFUL canonical difference
      catalogueVersion: stamped && o.catalogueVersion != null ? o.catalogueVersion : null,
      // OS-W43-R1 (AGY-4): basis-UNSET ("awaiting stamp-at-receive") and the CHOSEN 'legacy-lens' are
      // DIFFERENT states and must hash differently — the fleet must be able to surface a disagreement
      // between them. Pre-W4 absence ≡ unset (null), preserving cross-version same-reality identity.
      basis: o.basis || (stamped ? 'submit-stamped' : null),
    };
  },
  _canonicalTransferV4(snap) {
    const s = snap || {};
    return {
      _v: this.CANONICAL_FORM_VERSION,
      id: s.id != null ? s.id : '',
      date: s.date || s.createdAt || '',
      createdAt: s.createdAt || '',
      fromStoreId: s.fromStoreId || '',
      toStoreId: s.toStoreId || '',
      createdBy: s.createdBy || '',
      status: s.status || 'in_transit',
      type: s.type || 'standard',
      returnReason: s.returnReason != null ? s.returnReason : null,
      returnNote: s.returnNote || '',
      notes: s.notes || '',
      items: (s.items || []).map(it => this._canonTransferItemV4(it)),
    };
  },
  // OS-W43-R1 (Codex-4/AGY-3): the non-transfer record types get REAL strict-projected v4 forms —
  // keys unknown to the pinned W4 shapes are STRIPPED before hashing (SR-128), so a future-version
  // delivery/stocktake snapshot of the same economic reality can never false-diverge a W4 fold.
  _canonDeliveryLineV4(l) {
    const o = l || {};
    return {
      productId: o.productId != null ? o.productId : '', quantity: o.quantity != null ? o.quantity : null,
      unitCost: o.unitCost != null ? o.unitCost : null, weightGrams: o.weightGrams || 0,
      packaging: o.packaging != null ? o.packaging : null, labelling: o.labelling != null ? o.labelling : null,
      foreignUnitCost: o.foreignUnitCost != null ? o.foreignUnitCost : null,
      foreignPackaging: o.foreignPackaging != null ? o.foreignPackaging : null,
      foreignLabelling: o.foreignLabelling != null ? o.foreignLabelling : null,
      headerCostShare: o.headerCostShare != null ? o.headerCostShare : null,
      landedCostPerUnit: o.landedCostPerUnit != null ? o.landedCostPerUnit : null,
      previousCost: o.previousCost != null ? o.previousCost : null,
      appliedCost: o.appliedCost != null ? o.appliedCost : null,
      costUpdated: !!o.costUpdated, packagingUpdatedAt: o.packagingUpdatedAt != null ? o.packagingUpdatedAt : null,
    };
  },
  _canonicalDeliveryV4(snap) {
    const s = snap || {}; const hc = s.headerCosts || {}; const cur = s.currency || {}; const fhc = cur.foreignHeaderCosts || {};
    return {
      _v: this.CANONICAL_FORM_VERSION, _t: 'delivery',
      id: s.id != null ? s.id : '', date: s.date || '', storeId: s.storeId || '',
      supplier: s.supplier || s.supplierName || '', invoiceNo: s.invoiceNo != null ? s.invoiceNo : null,
      createdAt: s.createdAt || '', createdBy: s.createdBy || '', status: s.status || '',
      headerCosts: { freight: hc.freight != null ? hc.freight : null, tax: hc.tax != null ? hc.tax : null, shipping: hc.shipping != null ? hc.shipping : null, customs: hc.customs != null ? hc.customs : null },
      currency: { code: cur.code || '', rate: cur.rate != null ? cur.rate : null, foreignTotal: cur.foreignTotal != null ? cur.foreignTotal : null, foreignHeaderCosts: { freight: fhc.freight != null ? fhc.freight : null, tax: fhc.tax != null ? fhc.tax : null, shipping: fhc.shipping != null ? fhc.shipping : null } },
      lines: (s.lines || []).map(l => this._canonDeliveryLineV4(l)),
    };
  },
  _canonicalStocktakeV4(snap) {
    const s = snap || {};
    return {
      _v: this.CANONICAL_FORM_VERSION, _t: 'stocktake',
      id: s.id != null ? s.id : '', date: s.date || '', storeId: s.storeId || '',
      completedBy: s.completedBy || '', status: s.status || '',
      approvedBy: s.approvedBy != null ? s.approvedBy : null, approvedAt: s.approvedAt != null ? s.approvedAt : null,
      rejectedBy: s.rejectedBy != null ? s.rejectedBy : null, rejectedAt: s.rejectedAt != null ? s.rejectedAt : null,
      items: (s.items || []).map(i => { const o = i || {}; return { productId: o.productId != null ? o.productId : '', systemCount: o.systemCount != null ? o.systemCount : null, physicalCount: o.physicalCount != null ? o.physicalCount : null, difference: o.difference != null ? o.difference : null, reason: o.reason != null ? o.reason : null, note: o.note != null ? o.note : null }; }),
    };
  },
  _canonicalSnapshotV4(recordType, snap) {
    if (recordType === 'transfer') return this._canonicalTransferV4(snap);
    if (recordType === 'delivery') return this._canonicalDeliveryV4(snap);
    if (recordType === 'stocktake') return this._canonicalStocktakeV4(snap);
    return { _v: this.CANONICAL_FORM_VERSION, _t: recordType, snap: snap || {} };
  },
  _deepHash(recordType, snap) {
    return this._fnv(this._canonicalSerialize(this._canonicalSnapshotV4(recordType, snap)));
  },
  // Retained ONLY as the legacy stepId-dedup input shape for non-snapshot uses; NOT a divergence signal.
  _stableHash(obj) {
    return this._fnv(this._canonicalSerialize(obj));
  },

  async runBackfillOnce() {
    let done = false;
    try { done = localStorage.getItem(this.BACKFILL_FLAG) === '1'; } catch (e) {}
    if (done) return false;
    if (typeof DB === 'undefined' || !DB.get) return false;
    const d = DB.get();
    if (!d) return false;
    // Records that already have ANY step are step-sourced — skip (don't double-backfill).
    const hasStep = new Set((d.recordSteps || []).map(s => s.recordId));
    const plan = [
      { type: 'transfer',  rows: d.transfers  || [], owner: r => r.toStoreId || r.fromStoreId || '' },
      { type: 'delivery',  rows: d.deliveries || [], owner: r => r.storeId || '' },
      { type: 'stocktake', rows: d.stockTakes || [], owner: r => r.storeId || '' },
    ];
    let emitted = 0;
    for (const grp of plan) {
      for (const rec of grp.rows) {
        if (!rec || !rec.id || hasStep.has(rec.id)) continue;
        const hash = this._deepHash(grp.type, rec);   // OS-W4.3 (SR-105/113): the v4 canonical deep hash — deterministic across W4 devices; historical steps carry old-algorithm hashes and are never string-compared (divergence recomputes)
        await this.emit({
          recordType: grp.type,
          recordId: rec.id,
          stepType: 'backfill',
          stepId: this.backfillStepId(grp.type, rec.id, hash),   // hash-in-id: divergent content -> distinct id -> both land
          ownerStoreId: grp.owner(rec),
          fromStoreId: grp.type === 'transfer' ? (rec.fromStoreId || '') : '',
          toStoreId: grp.type === 'transfer' ? (rec.toStoreId || '') : '',
          status: rec.status || '',
          payload: { snapshot: rec, hash: hash, hashVersion: this.CANONICAL_FORM_VERSION, backfilledBy: this._deviceId() },
        });
        emitted++;
      }
    }
    try { localStorage.setItem(this.BACKFILL_FLAG, '1'); } catch (e) {}
    if (emitted > 0) console.log('[Records] Backfill emitted ' + emitted + ' snapshot step(s) for pre-existing local records.');
    return emitted > 0;
  },
};

// Node/test harness export (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) { module.exports = { Records }; }
