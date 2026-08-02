
(function() {
'use strict';

const origMigrate = DB._migrate.bind(DB);
DB._migrate = function() {
  origMigrate();
  let changed = false;
  if (!this._cache.transfers) { this._cache.transfers = []; changed = true; }
  if (this._cache.transfers.length > 0) {
    const cutoff = Date.now() - 30 * 86400000;
    const before = this._cache.transfers.length;
    this._cache.transfers = this._cache.transfers.filter(t => {
      if (t.status !== 'completed' && t.status !== 'cancelled') return true;
      return new Date(t.completedDate || t.date).getTime() > cutoff;
    });
    if (this._cache.transfers.length < before) changed = true;
  }
  if (changed) this.commit();
};


const Transfer = {
  EMAIL_URL: null,  // MFL-010: moved to AppConfig — fetched at runtime via Sync._emailUrl

  _canCreate() { return Auth.can('transferCreate'); },       // D-018 transfer role matrix
  _canReceive() { return Auth.can('transferReceive'); },
  _canResolve() { return Auth.can('resolveDiscrepancy'); },  // D-018: resolve (write-off) = director only
  _canSetThresholds() { return Auth.can('editRefData'); },   // thresholds are ref data (same HO+director set)
  _canCancel() { return Auth.can('transferCancel'); },       // D-044: cancel = Director ONLY
  _canViewHistory() { return Auth.can('viewTransferHistory'); },  // L3 #10: central cap (was isAtLeast('store_manager') which wrongly denied franchisee — ranks below store_manager)

  _txn(type, productId, qty, storeId, transferId, reason) {
    const u = Auth.user();
    return { id: 'txn_' + Date.now() + '_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join(''), type, productId, qty, storeId, transferId, date: UI.todayLocal(), staffName: u?.name || u?.username || 'unknown', reason: reason || '', by: Auth.actor(), editLog: [], createdAt: new Date().toISOString() };
  },

  _receiveKey(transferId, storeId, productId) { return 'transfer:' + transferId + ':receive:' + storeId + ':' + productId; },

  _pricingSubmitGate(fromStoreId, toStoreId) {
    try {
      if (typeof Pricing === 'undefined' || typeof DB === 'undefined') return { ok: true };
      const d = DB.get(); if (!d) return { ok: true };
      const fromSt = (d.stores || []).find(x => x && x.id === fromStoreId);
      const toSt = (d.stores || []).find(x => x && x.id === toStoreId);
      const fromWh = fromSt && !fromSt.isFranchise && fromSt.type === 'warehouse';
      if (!((fromWh || fromStoreId === 'head_office') && toSt && toSt.isFranchise)) return { ok: true };
      const g = Pricing.commitGate(toStoreId);
      if (g && g.ok) return { ok: true };
      const hold = (g && g.hold) || 'PRICING_DATA_ERROR';
      const msg = hold === 'NO_FRESH_OBSERVATION' ? 'This device needs a fresh sync before sending stock to a franchise store — connect, sync, then try again.'
        : hold === 'PRICING_UNRESOLVED' ? 'This device was restored from a backup and needs one successful sync before franchise supply can be sent.'
        : 'Franchise pricing needs attention before new supply can be sent — sync first; if this persists a Director should check the pricing setup.';
      return { ok: false, error: msg, hold };
    } catch (e) { return { ok: false, error: 'Franchise pricing could not be verified — try again after a sync.', hold: 'PRICING_DATA_ERROR' }; }
  },

  _notify(payload) {
    if (payload && typeof Auth!=='undefined' && Auth._slimActorsDeep) Auth._slimActorsDeep(payload);  // SA-I-F1: deep-slim incl nested flaggedItems[].resolvedBy
    try { const _u=((typeof Sync!=='undefined'&&Sync._emailUrl)||''); if(!_u){ console.warn('[Transfer] email URL not configured'); return; } fetch(_u, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).catch(() => {}); } catch(e) {}
  },

  async _emit(spec) {
    try { if (typeof Records !== 'undefined' && Records.emit) return await Records.emit(spec); } catch (e) { console.error('[Transfer] step emit failed (non-fatal):', e); }
    return null;
  },
  _submitPayload(t, ledgerIds) {
    return {
      fromStoreId: t.fromStoreId, toStoreId: t.toStoreId, type: t.type,
      returnReason: t.returnReason || null, returnNote: t.returnNote || '',
      createdAt: t.createdAt || t.date, createdBy: t.createdBy, createdByName: t.createdByName,
      notes: t.notes || '',
      items: (t.items || []).map(i => ({ productId: i.productId, sentQty: i.sentQty })),
      expectedLedgerKeys: ledgerIds || [],
    };
  },
  async _emitSubmit(t, ledgerIds) {
    return this._emit({
      recordType: 'transfer', recordId: t.id, stepType: 'submit',
      ownerStoreId: t.fromStoreId, fromStoreId: t.fromStoreId, toStoreId: t.toStoreId,
      status: 'in_transit', payload: this._submitPayload(t, ledgerIds),
    });
  },
  async _emitResolve(t, resolutions, ledgerIds, generation) {
    const productIds = (resolutions || []).map(r => r.productId);
    return this._emit({
      recordType: 'transfer', recordId: t.id, stepType: 'resolve',
      stepId: (typeof Records !== 'undefined' && Records.resolveStepId) ? Records.resolveStepId(t.id, generation || 0, productIds) : undefined,
      ownerStoreId: t.toStoreId, fromStoreId: t.fromStoreId, toStoreId: t.toStoreId, status: 'completed',
      payload: {
        generation: generation || 0,
        resolvesAttemptIds: t._receiveAttemptId ? [t._receiveAttemptId] : [],
        resolvedBy: Auth.actor(),
        resolutions: resolutions || [],
        expectedLedgerKeys: ledgerIds || [],
      },
    });
  },

  async create(fromStoreId, toStoreId, items, options) {
    if (!this._canCreate()) return { ok:false, error:'Permission denied' };
    if (!fromStoreId || !toStoreId || !items?.length) return { ok:false, error:'Missing required fields' };
    if (fromStoreId === toStoreId) return { ok:false, error:'Cannot transfer to same store' };
    if (!(Auth.isHO() || Auth.is('director'))) { const _mine=Auth.storeIds()||[]; if(!_mine.includes(fromStoreId)||!_mine.includes(toStoreId)) return { ok:false, error:'You can only transfer between stores you manage' }; }  // D-018 store-scope
    const opt = options || {};
    const d = DB.get();
    const id = 'tr_' + Date.now() + '_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    const _items = [];
    for (const i of items) {
      const _q = Validate.qty(i.qty);
      if (!_q.ok || _q.value <= 0) return { ok:false, error:'Each transfer line needs a whole quantity of 1 or more (' + UI.productName(i.productId) + ')' };
      _items.push({ productId: i.productId, qty: _q.value });
    }
    if (!opt.isDraft) {
      for (const i of _items) {
        const _avail = Stock.qty(i.productId, fromStoreId);
        if (i.qty > _avail) return { ok:false, error:`Cannot send ${i.qty} × ${UI.productName(i.productId)} — ${UI.storeName(fromStoreId)} only has ${_avail} on record. Sync or run a stock-take, then try again.` };
      }
      const _pg = this._pricingSubmitGate(fromStoreId, toStoreId);   // OS-W4.2 P3/P5: a non-draft create IS a submit — the pricing-commitment gate runs before any write
      if (!_pg.ok) return { ok:false, error:_pg.error };
    }
    const transfer = {
      id, date: now, createdAt: now, fromStoreId, toStoreId,
      createdBy: Auth.actor(),
      createdByName: Auth.user()?.name || Auth.user()?.username || 'unknown',
      status: opt.isDraft ? 'draft' : 'in_transit',
      type: opt.type || (opt.returnReason ? 'return' : 'standard'),  // Wave L1 (GPTa-27): tag returns so the hub stops rendering every transfer as "Standard"
      returnReason: opt.returnReason || null,
      returnNote: opt.returnNote || '',
      items: _items.map(i => ({
        productId: i.productId, sentQty: i.qty, receivedQty: null,
        status: 'pending',
        flagNote: '', resolvedBy: null, resolvedAction: null
      })),
      receivedBy: null, receivedDate: null, completedDate: null,
      notes: opt.notes || ''
    };
    if (opt.isDraft) {
      const _ok = await DB.addTransferDurable(transfer);
      if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
      return { ok:true, transferId:id };
    }
    if (!DB.get().transfers) DB.get().transfers = [];
    DB.get().transfers.push(transfer);
    const _batch = transfer.items.map(item => this._txn('transfer_out', item.productId, item.sentQty, fromStoreId, id, 'Transfer to ' + UI.storeName(toStoreId)));
    const _ok = await DB.atomicTransferWriteDurable(_batch, transfer, null);
    if (!_ok) { DB.get().transfers = DB.get().transfers.filter(x => x !== transfer); UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emitSubmit(transfer, _batch.map(x => x.id));  // Chunk 4: record-step (genesis)
    this._notify({
      type: 'transfer_created', fromStore: UI.storeName(fromStoreId), toStore: UI.storeName(toStoreId),
      date: now, createdBy: Auth.actor(),
      items: transfer.items.map(i => ({ product: UI.productName(i.productId), qty: i.sentQty })),
      totalItems: transfer.items.length,
      totalUnits: transfer.items.reduce((s, i) => s + i.sentQty, 0)
    });
    return { ok:true, transferId:id };
  },

  createFromStockTake(storeId, stockTakeItems) {
    if (!this._canCreate()) return { ok:false, error:'Permission denied' };
    const items = [];
    stockTakeItems.forEach(st => {
      const thr = Stock.threshold(st.productId, storeId);
      const optimum = thr ? (thr.optimumQty || thr.minQty || 0) : 0;
      if (optimum && st.counted < optimum) {
        items.push({ productId: st.productId, qty: optimum - st.counted });
      }
    });
    if (!items.length) return { ok:false, error:'No shortfalls detected' };
    return this.create('head_office', storeId, items, { isDraft:true, notes:'Auto-generated from stock take' });
  },

  async confirmDraftItem(transferId, productId) {
    const t = this.get(transferId);
    if (!t || t.status !== 'draft') return { ok:false, error:'Invalid transfer or not a draft' };
    const item = t.items.find(i => i.productId === productId);
    if (!item) return { ok:false, error:'Item not found' };
    const snap = JSON.parse(JSON.stringify(t));
    item.status = item.status === 'confirmed' ? 'pending' : 'confirmed';
    const ok = await DB.updateTransferDurable(t, snap);
    if (!ok) { UI.fatalSaveError('Draft change could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    return { ok:true };
  },

  async submitDraft(transferId, draftQtys) {
    if (!this._canCreate()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || t.status !== 'draft') return { ok:false, error:'Invalid transfer or not a draft' };
    { const _pg = this._pricingSubmitGate(t.fromStoreId, t.toStoreId);   // OS-W4.2 P3/P5: submit = the pricing-commitment moment; gate BEFORE any mutation
      if (!_pg.ok) return { ok:false, error:_pg.error }; }
    const snapshot = JSON.parse(JSON.stringify(t));
    t.items = t.items.filter(i => i.status === 'confirmed');
    if (!t.items.length) {
      Object.keys(t).forEach(k => delete t[k]); Object.assign(t, snapshot);
      return { ok:false, error:'No confirmed items to submit' };
    }
    if (draftQtys) {
      t.items.forEach(i => {
        if (draftQtys[i.productId] !== undefined) i.sentQty = Math.max(0, UI.safeInt(draftQtys[i.productId]) || 0);
      });
    }
    for (const i of t.items) {
      const _q = Validate.qty(i.sentQty);
      if (!_q.ok || _q.value <= 0) { Object.keys(t).forEach(k => delete t[k]); Object.assign(t, snapshot); return { ok:false, error:'Each line needs a whole quantity of 1 or more before submitting (' + UI.productName(i.productId) + ')' }; }
      i.sentQty = _q.value;
    }
    for (const i of t.items) {
      const _avail = Stock.qty(i.productId, t.fromStoreId);
      if (i.sentQty > _avail) { Object.keys(t).forEach(k => delete t[k]); Object.assign(t, snapshot); return { ok:false, error:`Cannot send ${i.sentQty} × ${UI.productName(i.productId)} — ${UI.storeName(t.fromStoreId)} only has ${_avail} on record. Sync or run a stock-take, then try again.` }; }
    }
    t.items.forEach(i => { i.status = 'pending'; });
    t.status = 'in_transit';
    t.date = new Date().toISOString();
    const batchTxns = [];
    t.items.forEach(item => {
      batchTxns.push(this._txn('transfer_out', item.productId, item.sentQty, t.fromStoreId, transferId, 'Transfer to ' + UI.storeName(t.toStoreId)));
    });
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emitSubmit(t, batchTxns.map(x => x.id));  // Chunk 4: record-step (genesis)
    this._notify({
      type: 'transfer_created', fromStore: UI.storeName(t.fromStoreId), toStore: UI.storeName(t.toStoreId),
      date: t.date, createdBy: Auth.actor(),
      items: t.items.map(i => ({ product: UI.productName(i.productId), qty: i.sentQty })),
      totalItems: t.items.length,
      totalUnits: t.items.reduce((s, i) => s + i.sentQty, 0)
    });
    return { ok:true };
  },

  async receive(transferId, receivedItems) {
    if (!this._canReceive()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || t.status !== 'in_transit') return { ok:false, error:'Invalid transfer or not in transit' };
    if (!(Auth.isHO() || Auth.is('director') || (Auth.storeIds && Auth.storeIds().includes(t.toStoreId)))) {
      return { ok:false, error:'You can only receive transfers for your own store' };
    }
    {
      const _d = DB.get();
      const _already = (_d.transactions || []).some(x => x && x.transferId === transferId && x.type === 'transfer_in');
      if (_already) return { ok:false, error:'This transfer was already received (possibly on another device). Sync and reopen it.' };
    }
    const _rq = {};
    for (const _it of t.items) {
      const _ri = receivedItems.find(r => r.productId === _it.productId);
      const _qv = Validate.qty(_ri ? _ri.receivedQty : 0);
      if (!_qv.ok) return { ok:false, error:`Received quantity for ${UI.productName(_it.productId)} must be a whole number (0 or more) — nothing was saved` };
      if (_qv.value > _it.sentQty) {
        return { ok:false, error:`Received qty (${_qv.value}) exceeds sent (${_it.sentQty}) for ${UI.productName(_it.productId)}. Record an over-receipt as a stock adjustment, not a transfer receipt.` };
      }
      _rq[_it.productId] = _qv.value;
    }
    if (!t._receiveAttemptId) t._receiveAttemptId = (typeof Records !== 'undefined' && Records.newAttemptId) ? Records.newAttemptId() : ('ra_' + Date.now());
    const snapshot = JSON.parse(JSON.stringify(t));
    const d = DB.get();
    const now = new Date().toISOString();
    let hasFlagged = false;
    const batchTxns = [];
    t.items.forEach(item => {
      const rQty = _rq[item.productId];
      item.receivedQty = rQty;
      if (rQty === item.sentQty) {
        item.status = 'accepted';
        { const _rin = this._txn('transfer_in', item.productId, rQty, t.toStoreId, transferId, 'Received from ' + UI.storeName(t.fromStoreId)); _rin.idempotencyKey = this._receiveKey(transferId, t.toStoreId, item.productId); batchTxns.push(_rin); }  // Chunk 4 D4-E
      } else {
        item.status = 'flagged';
        hasFlagged = true;
        const credit = Math.max(0, Math.min(item.sentQty, Math.trunc(Number(rQty)) || 0));
        item.creditedAtReceive = credit;
        if (credit > 0) {
          { const _rin = this._txn('transfer_in', item.productId, credit, t.toStoreId, transferId, 'Received (discrepancy flagged) from ' + UI.storeName(t.fromStoreId)); _rin.idempotencyKey = this._receiveKey(transferId, t.toStoreId, item.productId); batchTxns.push(_rin); }  // Chunk 4 D4-E
        }
      }
    });
    t.receivedBy = Auth.actor();
    t.receivedDate = now;
    t.status = hasFlagged ? 'received' : 'completed';
    if (!hasFlagged) t.completedDate = now;
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emit({
      recordType: 'transfer', recordId: t.id, stepType: 'receive',
      stepId: (typeof Records !== 'undefined' && Records.receiveStepId) ? Records.receiveStepId(t.id, t.toStoreId, t._receiveAttemptId) : undefined,
      ownerStoreId: t.toStoreId, fromStoreId: t.fromStoreId, toStoreId: t.toStoreId,
      status: hasFlagged ? 'received' : 'completed',
      payload: {
        receiveAttemptId: t._receiveAttemptId, receivedBy: t.receivedBy, receivedDate: t.receivedDate,
        lines: t.items.map(i => ({ productId: i.productId, receivedQty: i.receivedQty, flagged: i.status === 'flagged', flagNote: i.flagNote || '' })),
        completed: !hasFlagged,
        expectedLedgerKeys: batchTxns.map(x => x.id),
      },
    });
    if (!hasFlagged) this._notifyCompleted(t);
    return { ok:true, hasFlagged };
  },

  async resolveFlag(transferId, productId, action, qty, note) {
    if (!this._canResolve()) return { ok:false, error:'Permission denied' };
    if (typeof Pages !== 'undefined' && Pages._actionSudo && (await Pages._actionSudo('resolve', 'resolve this discrepancy')) === null) return { ok:false, error:'Password confirmation cancelled' };  // AA-W5 D9-8 (inert pre-activation)
    const t = this.get(transferId);
    if (!t || (t.status !== 'received' && t.status !== 'in_transit')) return { ok:false, error:'Invalid transfer' };
    const item = t.items.find(i => i.productId === productId && i.status === 'flagged');
    if (!item) return { ok:false, error:'Flagged item not found' };
    const snapshot = JSON.parse(JSON.stringify(t));
    const batchTxns = this._computeFlagResolution(t, item, action, qty, note);
    const allDone = t.items.every(i => i.status === 'accepted' || i.status === 'resolved');
    if (allDone) {
      t.status = 'completed';
      t.completedDate = new Date().toISOString();
    }
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emitResolve(t, [{ productId, action, qty, note: note || '' }], batchTxns.map(x => x.id), 0);  // Chunk 4
    if (allDone) this._notifyCompleted(t);
    return { ok:true };
  },

  _computeFlagResolution(t, item, action, qty, note) {
    item.resolvedBy = Auth.actor();
    item.resolvedAction = action;
    item.flagNote = note || '';
    item.status = 'resolved';
    const alreadyCredited = Number.isSafeInteger(item.creditedAtReceive)
      ? Math.max(0, Math.min(item.sentQty, item.creditedAtReceive)) : 0;
    const batchTxns = [];
    const pid = item.productId, tid = t.id;
    if (action === 'accept_as_is') {
      const credit = Math.max(0, Math.min(item.sentQty, Math.trunc(Number(item.receivedQty)) || 0));  // clamp to [0, sentQty], integer
      const topUp = credit - alreadyCredited;
      if (topUp > 0) batchTxns.push(this._txn('transfer_in', pid, topUp, t.toStoreId, tid, 'Flag resolved — accepted as-is from ' + UI.storeName(t.fromStoreId)));
      const diff = item.sentQty - credit;
      if (diff > 0) batchTxns.push(this._txn('transfer_in', pid, diff, t.fromStoreId, tid, 'Shortfall returned — ' + diff + ' units'));
    } else if (action === 'adjust') {
      const credit = Math.max(0, Math.min(item.sentQty, Math.trunc(Number(qty)) || 0));  // clamp to [0, sentQty], integer
      const delta = credit - alreadyCredited;
      if (delta > 0) batchTxns.push(this._txn('transfer_in', pid, delta, t.toStoreId, tid, 'Flag resolved — adjusted qty from ' + UI.storeName(t.fromStoreId)));
      else if (delta < 0) batchTxns.push(this._txn('adjustment_out', pid, -delta, t.toStoreId, tid, 'Flag resolved — received qty adjusted down by Director'));  // adjustment category, NOT 'out' (= sale)
      const diff = item.sentQty - credit;
      if (diff > 0) batchTxns.push(this._txn('transfer_in', pid, diff, t.fromStoreId, tid, 'Adjustment remainder returned — ' + diff + ' units'));
    } else if (action === 'reject') {
      if (alreadyCredited > 0) batchTxns.push(this._txn('adjustment_out', pid, alreadyCredited, t.toStoreId, tid, 'Rejected — received units sent back to ' + UI.storeName(t.fromStoreId)));  // reverse the receive-time credit
      batchTxns.push(this._txn('transfer_in', pid, item.sentQty, t.fromStoreId, tid, 'Rejected — full qty returned to ' + UI.storeName(t.fromStoreId)));
    }
    return batchTxns;
  },

  async resolveAllFlags(transferId, resolutions) {
    if (!this._canResolve()) return { ok:false, error:'Permission denied' };
    if (typeof Pages !== 'undefined' && Pages._actionSudo && (await Pages._actionSudo('resolve', 'resolve this discrepancy')) === null) return { ok:false, error:'Password confirmation cancelled' };  // AA-W5 D9-8 (inert pre-activation)
    const t = this.get(transferId);
    if (!t || (t.status !== 'received' && t.status !== 'in_transit')) return { ok:false, error:'Invalid transfer' };
    const snapshot = JSON.parse(JSON.stringify(t));
    const batchTxns = [];
    for (const r of (resolutions || [])) {
      const item = t.items.find(i => i.productId === r.productId && i.status === 'flagged');
      if (!item) continue;
      const qty = r.action === 'adjust' ? (r.qty || 0) : undefined;
      batchTxns.push(...this._computeFlagResolution(t, item, r.action, qty, r.note || ''));
    }
    const allDone = t.items.every(i => i.status === 'accepted' || i.status === 'resolved');
    if (allDone) { t.status = 'completed'; t.completedDate = new Date().toISOString(); }
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emitResolve(t, (resolutions || []).map(r => ({ productId: r.productId, action: r.action, qty: r.qty, note: r.note || '' })), batchTxns.map(x => x.id), 0);  // Chunk 4
    if (allDone) this._notifyCompleted(t);
    return { ok:true };
  },

  _creditedAtDest(transferId, productId, toStoreId) {
    return (DB.get().transactions || [])
      .filter(x => x && x.transferId === transferId && x.storeId === toStoreId && x.productId === productId)
      .reduce((s, x) => s + (x.type === 'transfer_in' || x.type === 'adjustment_in' ? x.qty : (x.type === 'adjustment_out' ? -x.qty : 0)), 0);
  },
  async resolveConflict(transferId, chosen) {
    if (!this._canResolve()) return { ok:false, error:'Permission denied' };
    if (typeof Pages !== 'undefined' && Pages._actionSudo && (await Pages._actionSudo('resolve', 'resolve this discrepancy')) === null) return { ok:false, error:'Password confirmation cancelled' };  // AA-W5 D9-8 (inert pre-activation)
    const t = this.get(transferId);
    if (!t) return { ok:false, error:'Transfer not found' };
    if (t.status !== 'conflict') return { ok:false, error:'This transfer is not in a conflict state' };
    chosen = chosen || {};
    const snapshot = JSON.parse(JSON.stringify(t));
    const batchTxns = [];
    const resolutions = [];
    for (const item of (t.items || [])) {
      if (!(item.productId in chosen)) continue;
      const _q = Validate.qty(chosen[item.productId]);
      if (!_q.ok || _q.value > item.sentQty) { Object.keys(t).forEach(k => delete t[k]); Object.assign(t, snapshot); return { ok:false, error:`Chosen quantity for ${UI.productName(item.productId)} must be a whole number from 0 to ${item.sentQty}` }; }
      const chosenQty = _q.value;
      const credited = this._creditedAtDest(transferId, item.productId, t.toStoreId);
      const delta = chosenQty - credited;
      if (delta > 0) batchTxns.push(this._txn('adjustment_in', item.productId, delta, t.toStoreId, transferId, 'Double-receive conflict resolved by Director — corrected up'));
      else if (delta < 0) batchTxns.push(this._txn('adjustment_out', item.productId, -delta, t.toStoreId, transferId, 'Double-receive conflict resolved by Director — corrected down'));
      item.receivedQty = chosenQty;
      item.status = 'resolved';
      item.resolvedBy = Auth.actor();
      item.resolvedAction = 'conflict_resolved';
      resolutions.push({ productId: item.productId, action: 'conflict_resolved', qty: chosenQty, note: '' });
    }
    const generation = ((t._conflict && t._conflict.generation) || 0) + 1;
    const attemptIds = (t._conflict && t._conflict.attempts || []).map(a => a.attemptId).filter(Boolean);
    t.status = 'completed';
    t.completedDate = new Date().toISOString();
    delete t._conflict;
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Conflict resolution could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    await this._emit({
      recordType: 'transfer', recordId: t.id, stepType: 'resolve',
      stepId: (typeof Records !== 'undefined' && Records.resolveStepId) ? Records.resolveStepId(t.id, generation, resolutions.map(r => r.productId)) : undefined,
      ownerStoreId: t.toStoreId, fromStoreId: t.fromStoreId, toStoreId: t.toStoreId, status: 'completed',
      payload: { generation, resolvesAttemptIds: attemptIds, resolvedBy: Auth.actor(), resolutions, conflictResolution: true, expectedLedgerKeys: batchTxns.map(x => x.id) },
    });
    this._notifyCompleted(t);
    return { ok:true };
  },

  _notifyCompleted(t) {
    const flagged = t.items.filter(i => i.status === 'resolved');
    this._notify({
      type: 'transfer_completed', fromStore: UI.storeName(t.fromStoreId), toStore: UI.storeName(t.toStoreId),
      date: t.completedDate, receivedBy: t.receivedBy,
      items: t.items.map(i => ({
        product: UI.productName(i.productId), sent: i.sentQty, received: i.receivedQty, status: i.status
      })),
      flaggedItems: flagged.map(i => ({
        product: UI.productName(i.productId), sent: i.sentQty, received: i.receivedQty,
        action: i.resolvedAction, note: i.flagNote, resolvedBy: i.resolvedBy
      }))
    });
  },

  list(filters) {
    const d = DB.get();
    let list = d.transfers || [];
    if (filters) {
      if (filters.status) list = list.filter(t => t.status === filters.status);
      if (filters.storeId) list = list.filter(t => t.fromStoreId === filters.storeId || t.toStoreId === filters.storeId);
    }
    if (Auth.isStoreLevel() && !Auth.isMgmt()) { const mine = Auth.storeIds() || []; list = list.filter(t => mine.includes(t.fromStoreId) || mine.includes(t.toStoreId)); }
    return list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  get(transferId) {
    return (DB.get().transfers || []).find(t => t.id === transferId) || null;
  },

  async cancel(transferId) {
    if (!this._canCancel()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || (t.status !== 'in_transit' && t.status !== 'draft')) return { ok:false, error:'Cannot cancel this transfer' };
    if (!(Auth.isHO() || Auth.is('director'))) { const _mine=Auth.storeIds()||[]; if(!_mine.includes(t.fromStoreId)||!_mine.includes(t.toStoreId)) return { ok:false, error:'You can only cancel transfers between stores you manage' }; }  // D-018 store-scope
    if (t.status === 'in_transit') {
      const _d = DB.get();
      if ((_d.transactions || []).some(x => x && x.transferId === transferId && x.type === 'transfer_in')) {
        return { ok:false, error:'This transfer was already received (possibly on another device) — it can no longer be cancelled. Sync and reopen it.' };
      }
    }
    const snapshot = JSON.parse(JSON.stringify(t));
    const batchTxns = [];
    if (t.status === 'in_transit') {
      t.items.forEach(item => {
        batchTxns.push(this._txn('transfer_in', item.productId, item.sentQty, t.fromStoreId, transferId, 'Transfer cancelled — stock returned'));
      });
    }
    const _wasInTransit = (t.status === 'in_transit');
    t.status = 'cancelled';
    t.completedDate = new Date().toISOString();
    const _ok = await DB.atomicTransferWriteDurable(batchTxns, t, snapshot);
    if (!_ok) { UI.fatalSaveError('Transfer could not be saved to this device.'); return { ok:false, error:'Save failed - not saved' }; }
    if (_wasInTransit) {
      await this._emit({
        recordType: 'transfer', recordId: t.id, stepType: 'cancel',
        ownerStoreId: t.fromStoreId, fromStoreId: t.fromStoreId, toStoreId: t.toStoreId, status: 'cancelled',
        payload: { cancelledBy: Auth.actor(), expectedLedgerKeys: batchTxns.map(x => x.id) },
      });
    }
    return { ok:true };
  },


  pruneCompleted(daysOld) {
    const d = DB.get();
    const cutoff = Date.now() - (daysOld || 30) * 86400000;
    const before = d.transfers.length;
    const _prunedIds = [];
    d.transfers = d.transfers.filter(t => {
      if (t.status !== 'completed' && t.status !== 'cancelled') return true;
      const keep = new Date(t.completedDate || t.date).getTime() > cutoff;
      if (!keep) _prunedIds.push(t.id);
      return keep;
    });
    if (_prunedIds.length) {
      DB.commit();
      if (typeof bobDB !== 'undefined') bobDB.transfers.bulkDelete(_prunedIds).catch(() => {});
    }
    return before - d.transfers.length;
  }
};

const pageContainer = document.querySelector('.main-wrap') || document.querySelector('.main-content') || document.querySelector('.content') || document.querySelector('main');
if (pageContainer) {
  const newPages = ['transfers','create-transfer','draft-transfer','receive-transfer','resolve-flags','resolve-conflict','optimum-levels'];
  newPages.forEach(id => {
    if (!document.getElementById('page-' + id)) {
      const div = document.createElement('div');
      div.id = 'page-' + id;
      div.className = 'page';
      pageContainer.appendChild(div);
    }
  });
}

if (typeof buildSidebar === 'function') {
  const origBuildSidebar = buildSidebar;
  window.buildSidebar = function() {
    origBuildSidebar();
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav && !sidebarNav.querySelector('[data-page="transfers"]')) {
      const role = Auth.user()?.role || '';
      const canCreate = ['director','head_office','territory_manager','franchisee'].includes(role);  // D-018
      const canSeeHub = !!Auth.user();  // D-018: any staff can reach the Hub to RECEIVE
      const canViewHistory = canSeeHub;
      const canSetThresholds = ['director','head_office'].includes(role);
      if (canViewHistory || canCreate) {
        const section = document.createElement('div');
        section.className = 'nav-section';
        let html = '<div class="nav-section-title">Transfers</div>';
        html += '<a class="nav-item" onclick="navigateTo(\'transfers\')" data-page="transfers">' + iconTransfer() + '<span>Transfers Hub</span></a>';
        if (canCreate) {
          html += '<a class="nav-item" onclick="navigateTo(\'create-transfer\')" data-page="create-transfer">' + iconPlus() + '<span>New Transfer</span></a>';
        }
        if (canSetThresholds) {
          html += '<a class="nav-item" onclick="navigateTo(\'optimum-levels\')" data-page="optimum-levels">' + iconSettings() + '<span>Optimum Levels</span></a>';
        }
        section.innerHTML = html;
        sidebarNav.appendChild(section);
      }
    }
    if (typeof buildMobileNav === 'function') {
      setTimeout(buildMobileNav, 0);
    }
  };
}

function iconTransfer() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16l-4-4m0 0l4-4m-4 4h18M17 8l4 4m0 0l-4 4m4-4H3"/></svg>';
}
function iconPlus() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg>';
}
function iconSettings() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
}

if (typeof navigateTo === 'function') {
  const origNavigateTo = navigateTo;
  window.navigateTo = function(page) {
    const phase2Pages = {
      'transfers': () => renderTransfersHub(),
      'create-transfer': () => renderCreateTransfer(),
      'optimum-levels': () => renderOptimumLevels()
    };
    if (phase2Pages[page]) {
      document.querySelectorAll('.page').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(a => a.classList.remove('active'));
      document.querySelectorAll('[data-page="' + page + '"]').forEach(a => a.classList.add('active'));
      const el = document.getElementById('page-' + page);
      if (el) el.classList.add('active');
      phase2Pages[page]();
    } else {
      origNavigateTo(page);
    }
  };
  window.navigateToTransferDetail = function(page, transferId) {
    document.querySelectorAll('.page').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('[data-page="transfers"]').forEach(a => a.classList.add('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    if (page === 'draft-transfer') renderDraftTransfer(transferId);
    else if (page === 'receive-transfer') renderReceiveTransfer(transferId);
    else if (page === 'resolve-flags') renderResolveFlags(transferId);
    else if (page === 'resolve-conflict') renderResolveConflict(transferId);
  };
}

setTimeout(function() {
  if (typeof buildSidebar === 'function' && Auth.user()) buildSidebar();
}, 100);

   Phase 2 — Transfer Feature UI
   All rendering functions + stepper component + CSS
   ============================================================ */

(function(){
'use strict';

const style = document.createElement('style');
style.textContent = `

.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;letter-spacing:.3px;white-space:nowrap}
.badge-draft{background:#e0e0e0;color:#555}
.badge-in_transit{background:#d0e4f7;color:#1a6fb5}
.badge-pending_receipt{background:#d0e4f7;color:#1a6fb5}
.badge-received{background:#fde8cc;color:#b5711a}
.badge-flagged{background:#fde8cc;color:#b5711a}
.badge-completed{background:#d4edda;color:#1a6e2e}
.badge-cancelled{background:#f8d7da;color:#a71d2a}

.tx-list{display:flex;flex-direction:column;gap:8px}
.tx-row{background:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 1px 4px rgba(0,0,0,.07);cursor:pointer;display:grid;grid-template-columns:90px 1fr auto;align-items:center;gap:8px;transition:box-shadow .15s}
.tx-row:hover{box-shadow:0 2px 8px rgba(0,0,0,.13)}
.tx-row .tx-date{font-size:13px;color:#777}
.tx-row .tx-route{font-size:14px;font-weight:600;color:var(--black,#231F20)}
.tx-row .tx-meta{font-size:12px;color:#999;margin-top:2px}
.tx-row .tx-right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.tx-row .tx-items{font-size:12px;color:#777}

.filter-tabs{display:flex;gap:4px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch}
.filter-tab{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:500;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;white-space:nowrap;transition:all .15s}
.filter-tab.active{background:var(--rose,#d8838b);color:#fff;border-color:var(--rose,#d8838b)}

.ph2-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.ph2-title{font-size:20px;font-weight:700;color:var(--black,#231F20)}
.btn-rose{background:var(--rose,#d8838b);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn-rose:hover{opacity:.85}
.btn-outline{background:#fff;color:var(--rose,#d8838b);border:2px solid var(--rose,#d8838b);padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.btn-sm{padding:6px 12px;font-size:13px}
.btn-grey{background:#e0e0e0;color:#555;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}

.stepper{display:inline-flex;align-items:center;gap:0;border:1.5px solid var(--rose-mid,#edb8bc);border-radius:8px;overflow:hidden;background:#fff}
.stepper-btn{width:40px;height:40px;border:none;background:var(--rose-light,#fdf0f1);color:var(--rose,#d8838b);font-size:20px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s;-webkit-user-select:none;user-select:none}
.stepper-btn:active{background:var(--rose-mid,#edb8bc)}
.stepper-val{width:48px;height:40px;text-align:center;font-size:16px;font-weight:600;border:none;border-left:1.5px solid var(--rose-mid,#edb8bc);border-right:1.5px solid var(--rose-mid,#edb8bc);background:#fff;color:var(--black,#231F20);cursor:pointer;-moz-appearance:textfield}
.stepper-val::-webkit-outer-spin-button,.stepper-val::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

.pp-search{width:100%;padding:10px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box}
.pp-search:focus{border-color:var(--rose,#d8838b);outline:none}
.pp-grid{display:grid;grid-template-columns:minmax(120px,2fr) repeat(4,1fr) auto;gap:0;font-size:13px}
.pp-grid.phone-cols{grid-template-columns:minmax(100px,2fr) 1fr auto}
.pp-hdr{font-weight:700;padding:8px 6px;background:var(--rose-light,#fdf0f1);color:var(--black,#231F20);border-bottom:2px solid var(--rose-mid,#edb8bc);position:sticky;top:0}
.pp-cell{padding:8px 6px;border-bottom:1px solid #eee;display:flex;align-items:center}
.pp-cell.name{font-weight:500}
.pp-cell.shortfall{color:var(--rose,#d8838b);font-weight:600}
.pp-grid-wrap{max-height:50vh;overflow-y:auto;border:1px solid #eee;border-radius:8px}

.summary-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--rose-light,#fdf0f1);border-radius:8px;margin-top:12px;flex-wrap:wrap;gap:8px}
.summary-stat{font-size:14px;font-weight:600;color:var(--black,#231F20)}
.summary-stat span{color:var(--rose,#d8838b)}

.fg{margin-bottom:14px}
.fg label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px}
.fg select,.fg input[type=text],.fg textarea{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box}
.fg select:focus,.fg input[type=text]:focus,.fg textarea:focus{border-color:var(--rose,#d8838b);outline:none}
.fg textarea{resize:vertical;min-height:60px}
.toggle-group{display:flex;gap:0;border:1.5px solid var(--rose-mid,#edb8bc);border-radius:8px;overflow:hidden}
.toggle-opt{flex:1;padding:10px;text-align:center;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#777;transition:all .15s}
.toggle-opt.active{background:var(--rose,#d8838b);color:#fff}

.recv-row{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.07);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.recv-left{flex:1;min-width:140px}
.recv-left .prod-name{font-weight:600;font-size:14px}
.recv-left .sent-qty{font-size:13px;color:#777}
.recv-right{display:flex;align-items:center;gap:10px}
.match-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:none;cursor:pointer;min-width:70px;transition:all .15s}
.match-btn.unmatched{background:#e0e0e0;color:#555}
.match-btn.matched{background:#28a745;color:#fff}
.match-btn.mismatch{background:#f0ad4e;color:#fff}
.match-icon{font-size:18px;margin-left:4px}
.match-ok{color:#28a745}
.match-flag{color:#f0ad4e}

.flag-row{background:#fff;border-radius:10px;padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.flag-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.flag-product{font-weight:600;font-size:15px}
.flag-diff{font-size:13px;font-weight:600;color:#f0ad4e}
.flag-detail{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:13px;color:#555;margin-bottom:10px}
.flag-actions{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.flag-actions button{padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;border:none;cursor:pointer}
.btn-accept{background:#d4edda;color:#1a6e2e}
.btn-adjust{background:#fde8cc;color:#b5711a}
.btn-reject{background:#f8d7da;color:#a71d2a}
.flag-actions button.active-action{outline:2px solid var(--black,#231F20);outline-offset:1px}
.flag-notes{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;margin-top:6px}

.opt-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.opt-table th{background:var(--rose-light,#fdf0f1);padding:8px 10px;text-align:left;font-weight:700;position:sticky;top:0;border-bottom:2px solid var(--rose-mid,#edb8bc)}
.opt-table td{padding:6px 10px;border-bottom:1px solid #eee}
.opt-table input[type=number]{width:70px;padding:6px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;text-align:center}
.opt-table input[type=number]:focus{border-color:var(--rose,#d8838b);outline:none}
.opt-table-wrap{max-height:60vh;overflow-y:auto;border:1px solid #eee;border-radius:8px}

.draft-row{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.07);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.draft-left{flex:1;min-width:140px}
.draft-left .prod-name{font-weight:600;font-size:14px}
.draft-left .shortfall-info{font-size:13px;color:#777}
.draft-right{display:flex;align-items:center;gap:10px}
.confirm-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:none;cursor:pointer}
.confirm-btn.unconfirmed{background:var(--rose,#d8838b);color:#fff}
.confirm-btn.confirmed{background:#28a745;color:#fff}

.pagination{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px}
.pagination button{padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;border:1px solid #ddd;background:#fff;cursor:pointer;color:#555}
.pagination button.active{background:var(--rose,#d8838b);color:#fff;border-color:var(--rose,#d8838b)}
.pagination button:disabled{opacity:.4;cursor:default}
.page-info{font-size:13px;color:#777}

.tx-detail-card{background:#fff;border-radius:10px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:16px}
.tx-detail-card h3{margin:0 0 10px;font-size:16px;color:var(--black,#231F20)}
.tx-detail-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:#555}
.tx-detail-row strong{color:var(--black,#231F20)}

@media(max-width:600px){
  .tx-row{grid-template-columns:70px 1fr auto;padding:10px 12px}
  .tx-row .tx-route{font-size:13px}
  .pp-grid{grid-template-columns:minmax(100px,2fr) 1fr auto;font-size:12px}
  .pp-hdr.hide-phone,.pp-cell.hide-phone{display:none}
  .recv-row{flex-direction:column;align-items:flex-start}
  .recv-right{width:100%;justify-content:space-between}
  .flag-detail{grid-template-columns:1fr 1fr}
  .ph2-title{font-size:17px}
}
`;
document.head.appendChild(style);



const _stepperTimers = {};

window.createStepper = function(opts) {
  const id = opts.id || ('stp_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2,'0')).join(''));  // GPT-18 (Wave M3): crypto, not Math.random
  const val = opts.value ?? 0;
  const min = opts.min ?? 0;
  const max = opts.max ?? 9999;
  window['_stp_' + id] = opts.onChange || function(){};
  return `<div class="stepper" id="stp-wrap-${id}">
    <button type="button" class="stepper-btn" data-stp="${id}" data-dir="-1"
      onmousedown="Stepper.startHold('${id}',-1)"
      onmouseup="Stepper.endHold('${id}')"
      onmouseleave="Stepper.endHold('${id}')"
      ontouchstart="Stepper.startHold('${id}',-1)"
      ontouchend="Stepper.endHold('${id}')"
      onclick="Stepper.step('${id}',-1,${min},${max})">&#8722;</button>
    <input type="number" class="stepper-val" id="stp-${id}" value="${val}"
      min="${min}" max="${max}"
      onfocus="this.select()"
      onchange="Stepper.direct('${id}',this.value,${min},${max})"
      onblur="Stepper.direct('${id}',this.value,${min},${max})"
      inputmode="numeric">
    <button type="button" class="stepper-btn" data-stp="${id}" data-dir="1"
      onmousedown="Stepper.startHold('${id}',1)"
      onmouseup="Stepper.endHold('${id}')"
      onmouseleave="Stepper.endHold('${id}')"
      ontouchstart="Stepper.startHold('${id}',1)"
      ontouchend="Stepper.endHold('${id}')"
      onclick="Stepper.step('${id}',1,${min},${max})">+</button>
  </div>`;
};

window.Stepper = {
  _get(id) { return document.getElementById('stp-' + id); },
  _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },

  step(id, dir, min, max) {
    const el = this._get(id);
    if (!el) return;
    const nv = this._clamp(parseInt(el.value||0) + dir, min, max);
    el.value = nv;
    (window['_stp_' + id])(nv, id);
  },

  direct(id, raw, min, max) {
    const el = this._get(id);
    if (!el) return;
    let v = parseInt(raw);
    if (isNaN(v)) v = 0;
    v = this._clamp(v, min, max);
    el.value = v;
    (window['_stp_' + id])(v, id);
  },

  startHold(id, dir) {
    if (_stepperTimers[id]) return;
    const el = this._get(id);
    if (!el) return;
    const min = parseInt(el.min) || 0;
    const max = parseInt(el.max) || 9999;
    let elapsed = 0;
    _stepperTimers[id] = setInterval(() => {
      elapsed += 200;
      if (elapsed >= 3000) {
        const nv = Stepper._clamp(parseInt(el.value||0) + dir * 10, min, max);
        el.value = nv;
        (window['_stp_' + id])(nv, id);
      }
    }, 200);
  },

  endHold(id) {
    if (_stepperTimers[id]) {
      clearInterval(_stepperTimers[id]);
      delete _stepperTimers[id];
    }
  },

  val(id) {
    const el = this._get(id);
    return el ? parseInt(el.value || 0) : 0;
  }
};


const _txState = {
  hubFilter: 'all',
  hubPage: 0,
  createItems: {},    // productId -> qty
  createType: 'standard',
  createFrom: '',
  createTo: '',
  createReturnReason: '',
  createReturnNotes: '',
  createSearch: '',
  receiveMatched: {},  // productId -> bool
  receiveQtys: {},     // productId -> qty
  flagActions: {},     // productId -> {action, qty, notes}
  optScope: 'global',
  optStore: '',
  optEdits: {},        // key -> {min, optimum}
  draftConfirmed: {},  // productId -> bool
  draftQtys: {}        // productId -> qty
};


window.renderTransfersHub = function() {
  const el = document.getElementById('page-transfers');
  if (!el) return;
  const data = DB.get();
  const transfers = data.transfers || [];
  const user = Auth.user();
  const myStores = Auth.storeIds ? Auth.storeIds() : [];
  const isHO = Auth.isHO();
  const isMgmt = Auth.isMgmt();

  let visible = transfers.filter(t => {
    if (Auth.is('director') || isHO) return true;
    if (isMgmt) return myStores.includes(t.fromStoreId) || myStores.includes(t.toStoreId);
    return myStores.includes(t.fromStoreId) || myStores.includes(t.toStoreId);
  });

  const canViewHistory = Auth.can('viewTransferHistory');
  if (!canViewHistory) visible = visible.filter(t => t.status !== 'completed');

  let f = _txState.hubFilter;
  if (f === 'completed' && !canViewHistory) f = 'all';
  const statusFilters = {
    all: () => true,
    in_transit: t => t.status === 'in_transit',
    needs_receiving: t => t.status === 'in_transit' && myStores.includes(t.toStoreId),
    flagged: t => t.status === 'flagged' || t.status === 'received',
    completed: t => t.status === 'completed',
    drafts: t => t.status === 'draft'
  };
  const filtered = visible.filter(statusFilters[f] || statusFilters.all);

  filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const perPage = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const page = Math.min(_txState.hubPage, totalPages - 1);
  const paged = filtered.slice(page * perPage, (page + 1) * perPage);

  const canCreate = ['franchisee','territory_manager','head_office','director'].includes(Auth.user()?.role);  // D-F3: match D-018 matrix
  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'needs_receiving', label: 'Needs Receiving' },
    { key: 'flagged', label: 'Flagged' },
    ...(canViewHistory ? [{ key: 'completed', label: 'Completed' }] : []),  // L3 #10: hide completed-history tab from staff
    { key: 'drafts', label: 'Drafts' }
  ];

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Transfers</div>
      ${canCreate ? `<button class="btn-rose" onclick="navigateTo('create-transfer')">+ New Transfer</button>` : ''}
    </div>
    <div class="filter-tabs">
      ${tabs.map(t => `<button class="filter-tab${f === t.key ? ' active' : ''}"
        onclick="_txState.hubFilter='${t.key}';_txState.hubPage=0;renderTransfersHub()">${t.label}</button>`).join('')}
    </div>
    ${paged.length === 0 ? `<div style="text-align:center;padding:40px 0;color:#999">No transfers found</div>` : `
      <div class="tx-list">
        ${paged.map(t => {
          const items = t.items || [];
          const totalUnits = items.reduce((s, i) => s + (i.sentQty || i.qty || 0), 0);
          const statusLabel = (t.status || 'draft').replace(/_/g, ' ');
          return `<div class="tx-row" onclick="TransferUI.openDetail(this.dataset.id)" data-id="${UI.esc(t.id)}">
            <div class="tx-date">${UI.fmtDate(t.createdAt)}</div>
            <div>
              <div class="tx-route">${UI.storeName(t.fromStoreId)} &rarr; ${UI.storeName(t.toStoreId)}</div>
              <div class="tx-meta">${UI.esc(t.createdByName || '')} &middot; ${t.type === 'return' ? 'Return' : 'Standard'}</div>
            </div>
            <div class="tx-right">
              <span class="badge badge-${t.status || 'draft'}">${UI.esc(statusLabel)}</span>
              <span class="tx-items">${items.length} item${items.length !== 1 ? 's' : ''} &middot; ${totalUnits} units</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    `}
    ${totalPages > 1 ? `
      <div class="pagination">
        <button ${page === 0 ? 'disabled' : ''} onclick="_txState.hubPage=${page - 1};renderTransfersHub()">&laquo; Prev</button>
        <span class="page-info">Page ${page + 1} of ${totalPages}</span>
        <button ${page >= totalPages - 1 ? 'disabled' : ''} onclick="_txState.hubPage=${page + 1};renderTransfersHub()">Next &raquo;</button>
      </div>
    ` : ''}
  `;
};


window.renderCreateTransfer = function() {
  const el = document.getElementById('page-create-transfer');
  if (!el) return;
  const data = DB.get();
  const stores = data.stores || [];
  const products = (data.products || []).filter(p => p.active !== false);
  const isHO = Auth.isHO();

  if (!_txState.createFrom) _txState.createFrom = isHO ? 'head_office' : (Auth.storeId() || '');

  const from = _txState.createFrom;
  const to = _txState.createTo;
  const type = _txState.createType;
  const search = _txState.createSearch.toLowerCase();
  const isPhone = window.innerWidth < 600;

  const filteredProducts = products.filter(p =>
    !search || (p.name || '').toLowerCase().includes(search) || (p.id || '').toLowerCase().includes(search)
  );


  const totalSelected = Object.values(_txState.createItems).filter(q => q > 0).length;
  const totalUnits = Object.values(_txState.createItems).reduce((s, q) => s + (q > 0 ? q : 0), 0);

  const _visibleStores = Auth.isHO() ? stores : stores.filter(s => ((Auth.storeIds && Auth.storeIds()) || []).includes(s.id));
  const storeOpts = _visibleStores.map(s =>
    `<option value="${s.id}"${s.id === from ? ' selected' : ''}>${UI.storeName(s.id)}</option>`
  ).join('');
  const storeOptsTo = _visibleStores.map(s =>
    `<option value="${s.id}"${s.id === to ? ' selected' : ''}>${UI.storeName(s.id)}</option>`
  ).join('');

  const returnReasons = ['Damaged', 'Expired', 'Excess', 'Wrong Product', 'Other'];

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Create Transfer</div>
      <button class="btn-grey" onclick="navigateTo('transfers')">&larr; Back</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="fg">
        <label>From Store</label>
        <select onchange="_txState.createFrom=this.value;renderCreateTransfer()">
          <option value="">Select...</option>${storeOpts}
        </select>
      </div>
      <div class="fg">
        <label>To Store</label>
        <select onchange="_txState.createTo=this.value;renderCreateTransfer()">
          <option value="">Select...</option>${storeOptsTo}
        </select>
      </div>
    </div>

    <div class="fg">
      <label>Transfer Type</label>
      <div class="toggle-group">
        <div class="toggle-opt${type === 'standard' ? ' active' : ''}"
          onclick="_txState.createType='standard';renderCreateTransfer()">Standard Transfer</div>
        <div class="toggle-opt${type === 'return' ? ' active' : ''}"
          onclick="_txState.createType='return';renderCreateTransfer()">Return / Dead Stock</div>
      </div>
    </div>

    ${type === 'return' ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg">
          <label>Reason</label>
          <select onchange="_txState.createReturnReason=this.value">
            <option value="">Select reason...</option>
            ${returnReasons.map(r => `<option${_txState.createReturnReason === r ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Notes</label>
          <textarea placeholder="Additional notes..." onchange="_txState.createReturnNotes=this.value">${UI.esc(_txState.createReturnNotes)}</textarea>
        </div>
      </div>
    ` : ''}

    <input class="pp-search" type="text" placeholder="Search products..."
      value="${UI.esc(_txState.createSearch)}"
      oninput="_txState.createSearch=this.value;renderCreateTransfer()">

    <div class="pp-grid-wrap">
      <div class="pp-grid${isPhone ? ' phone-cols' : ''}">
        <div class="pp-hdr">Product</div>
        <div class="pp-hdr${isPhone ? ' hide-phone' : ''}">Origin Stock</div>
        <div class="pp-hdr${isPhone ? ' hide-phone' : ''}">Dest Stock</div>
        <div class="pp-hdr${isPhone ? ' hide-phone' : ''}">Optimum</div>
        <div class="pp-hdr">Shortfall</div>
        <div class="pp-hdr">Qty</div>
        ${filteredProducts.map(p => {
          const originQty = from ? Stock.qty(p.id, from) : 0;
          const destQty = to ? Stock.qty(p.id, to) : 0;
          const thr = to ? Stock.threshold(p.id, to) : null;
          const optimum = thr ? (thr.optimumQty || thr.minQty || 0) : 0;
          const shortfall = Math.max(0, optimum - destQty);
          const curQty = _txState.createItems[p.id] || 0;
          return `
            <div class="pp-cell name">${UI.esc(p.name)}</div>
            <div class="pp-cell${isPhone ? ' hide-phone' : ''}">${originQty}</div>
            <div class="pp-cell${isPhone ? ' hide-phone' : ''}">${destQty}</div>
            <div class="pp-cell${isPhone ? ' hide-phone' : ''}">${optimum || '-'}</div>
            <div class="pp-cell shortfall">${shortfall || '-'}</div>
            <div class="pp-cell">${createStepper({
              id: 'ct_' + p.id,
              value: curQty,
              min: 0,
              max: originQty > 0 ? originQty : 9999,
              onChange: function(v) { _txState.createItems[p.id] = v; _updateCreateSummary(); }
            })}</div>`;
        }).join('')}
      </div>
    </div>

    <div class="summary-bar" id="create-summary">
      <div class="summary-stat"><span>${totalSelected}</span> products selected</div>
      <div class="summary-stat"><span>${totalUnits}</span> total units</div>
      <button class="btn-rose" onclick="TransferUI.submitCreate()"
        ${totalSelected === 0 ? 'disabled style="opacity:.5"' : ''}>Submit Transfer</button>
    </div>
  `;

  filteredProducts.forEach(p => {
    window['_stp_ct_' + p.id] = function(v) {
      _txState.createItems[p.id] = v;
      _updateCreateSummary();
    };
  });
};

function _updateCreateSummary() {
  const sumEl = document.getElementById('create-summary');
  if (!sumEl) return;
  const totalSelected = Object.values(_txState.createItems).filter(q => q > 0).length;
  const totalUnits = Object.values(_txState.createItems).reduce((s, q) => s + (q > 0 ? q : 0), 0);
  sumEl.innerHTML = `
    <div class="summary-stat"><span>${totalSelected}</span> products selected</div>
    <div class="summary-stat"><span>${totalUnits}</span> total units</div>
    <button class="btn-rose" onclick="TransferUI.submitCreate()"
      ${totalSelected === 0 ? 'disabled style="opacity:.5"' : ''}>Submit Transfer</button>
  `;
}


window.renderDraftTransfer = function(transferId) {
  const el = document.getElementById('page-draft-transfer');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const items = transfer.items || [];

  items.forEach(i => {
    if (_txState.draftQtys[i.productId] === undefined) _txState.draftQtys[i.productId] = i.qty || i.shortfall || 0;
    if (_txState.draftConfirmed[i.productId] === undefined) _txState.draftConfirmed[i.productId] = false;
  });

  const allConfirmed = items.every(i => _txState.draftConfirmed[i.productId]);

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Draft Transfer</div>
      <button class="btn-grey" onclick="navigateTo('transfers')">&larr; Back</button>
    </div>

    <div class="tx-detail-card">
      <h3>${UI.storeName(transfer.fromStoreId)} &rarr; ${UI.storeName(transfer.toStoreId)}</h3>
      <div class="tx-detail-row"><span>Date</span><strong>${UI.fmtDate(transfer.createdAt)}</strong></div>
      <div class="tx-detail-row"><span>Type</span><strong>${transfer.type === 'return' ? 'Return / Dead Stock' : 'Standard'}</strong></div>
      <div class="tx-detail-row"><span>Status</span><strong><span class="badge badge-draft">Draft</span></strong></div>
    </div>

    ${items.map(i => {
      const confirmed = _txState.draftConfirmed[i.productId];
      const qty = _txState.draftQtys[i.productId] || 0;
      return `<div class="draft-row">
        <div class="draft-left">
          <div class="prod-name">${UI.productName(i.productId)}</div>
          <div class="shortfall-info">Shortfall: ${i.shortfall || i.qty || 0}</div>
        </div>
        <div class="draft-right">
          ${createStepper({
            id: 'dr_' + i.productId,
            value: qty,
            min: 0,
            max: 9999,
            onChange: function(v) { _txState.draftQtys[i.productId] = v; }
          })}
          <button class="confirm-btn ${confirmed ? 'confirmed' : 'unconfirmed'}"
            onclick="TransferUI.toggleDraftConfirm(this.dataset.tid,this.dataset.pid)" data-tid="${UI.esc(transferId)}" data-pid="${UI.esc(i.productId)}">
            ${confirmed ? 'Undo' : 'Confirm'}
          </button>
        </div>
      </div>`;
    }).join('')}

    <div style="margin-top:16px;text-align:right">
      ${Auth.is('director') ? `<button class="btn-grey" style="margin-right:8px" onclick="TransferUI.cancelTransfer(this.dataset.tid)" data-tid="${UI.esc(transferId)}">Cancel Transfer</button>` : ''}
      <button class="btn-rose" onclick="TransferUI.submitDraft(this.dataset.tid)" data-tid="${UI.esc(transferId)}"
        ${!allConfirmed ? 'disabled style="opacity:.5"' : ''}>
        Submit &amp; Send Transfer
      </button>
    </div>
  `;

  items.forEach(i => {
    window['_stp_dr_' + i.productId] = function(v) { _txState.draftQtys[i.productId] = v; };
  });
};


window.renderReceiveTransfer = function(transferId) {
  const el = document.getElementById('page-receive-transfer');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const items = transfer.items || [];

  items.forEach(i => {
    if (_txState.receiveQtys[i.productId] === undefined) _txState.receiveQtys[i.productId] = i.sentQty || i.qty || 0;
    if (_txState.receiveMatched[i.productId] === undefined) _txState.receiveMatched[i.productId] = false;
  });

  const allMatched = items.every(i => _txState.receiveMatched[i.productId]);

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Receive Transfer</div>
      <button class="btn-grey" onclick="navigateTo('transfers')">&larr; Back</button>
    </div>

    <div class="tx-detail-card">
      <h3>From: ${UI.storeName(transfer.fromStoreId)}</h3>
      <div class="tx-detail-row"><span>Date</span><strong>${UI.fmtDate(transfer.createdAt)}</strong></div>
      <div class="tx-detail-row"><span>Created By</span><strong>${UI.esc(transfer.createdByName || '-')}</strong></div>
      <div class="tx-detail-row"><span>Items</span><strong>${items.length}</strong></div>
    </div>

    ${items.map(i => {
      const sent = i.sentQty || i.qty || 0;
      const recvQty = _txState.receiveQtys[i.productId] ?? sent;
      const matched = _txState.receiveMatched[i.productId];
      const isMismatch = matched && recvQty !== sent;
      const isOk = matched && recvQty === sent;
      let btnClass = 'unmatched';
      let btnLabel = 'Match';
      let icon = '';
      if (isOk) { btnClass = 'matched'; btnLabel = 'Undo Match'; icon = '<span class="match-icon match-ok">&#10003;</span>'; }
      else if (isMismatch) { btnClass = 'mismatch'; btnLabel = 'Undo Match'; icon = '<span class="match-icon match-flag">&#9888;</span>'; }

      return `<div class="recv-row">
        <div class="recv-left">
          <div class="prod-name">${UI.productName(i.productId)} ${icon}</div>
          <div class="sent-qty">Sent: <strong>${sent}</strong></div>
        </div>
        <div class="recv-right">
          ${createStepper({
            id: 'rv_' + i.productId,
            value: recvQty,
            min: 0,
            max: 9999,
            onChange: function(v) {
              _txState.receiveQtys[i.productId] = v;
              if (_txState.receiveMatched[i.productId]) {
                _txState.receiveMatched[i.productId] = false;
                renderReceiveTransfer(transferId);
              }
            }
          })}
          <button class="match-btn ${btnClass}"
            onclick="TransferUI.toggleMatch(this.dataset.tid,this.dataset.pid)" data-tid="${UI.esc(transferId)}" data-pid="${UI.esc(i.productId)}">${btnLabel}</button>
        </div>
      </div>`;
    }).join('')}

    <div style="margin-top:16px;text-align:right">
      ${Auth.is('director') ? `<button class="btn-grey" style="margin-right:8px" onclick="TransferUI.cancelTransfer(this.dataset.tid)" data-tid="${UI.esc(transferId)}">Cancel Transfer</button>` : ''}
      <button class="btn-rose" onclick="TransferUI.submitReceive(this.dataset.tid)" data-tid="${UI.esc(transferId)}"
        ${!allMatched ? 'disabled style="opacity:.5"' : ''}>Submit Receipt</button>
    </div>
  `;

  items.forEach(i => {
    window['_stp_rv_' + i.productId] = function(v) {
      _txState.receiveQtys[i.productId] = v;
      if (_txState.receiveMatched[i.productId]) {
        _txState.receiveMatched[i.productId] = false;
        renderReceiveTransfer(transferId);
      }
    };
  });
};


window.renderResolveFlags = function(transferId) {
  const el = document.getElementById('page-resolve-flags');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const flagged = (transfer.items || []).filter(i => i.status === 'flagged');

  flagged.forEach(i => {
    if (!_txState.flagActions[i.productId]) {
      _txState.flagActions[i.productId] = { action: '', qty: i.receivedQty || 0, notes: '' };
    }
  });

  const allResolved = flagged.every(i => _txState.flagActions[i.productId]?.action);

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Resolve Flags</div>
      <button class="btn-grey" onclick="navigateTo('transfers')">&larr; Back</button>
    </div>

    <div class="tx-detail-card">
      <h3>${UI.storeName(transfer.fromStoreId)} &rarr; ${UI.storeName(transfer.toStoreId)}</h3>
      <div class="tx-detail-row"><span>Flagged Items</span><strong>${flagged.length}</strong></div>
    </div>

    ${flagged.map(i => {
      const sent = i.sentQty || i.qty || 0;
      const recv = i.receivedQty || 0;
      const diff = recv - sent;
      const fa = _txState.flagActions[i.productId] || {};
      const isAdjust = fa.action === 'adjust';
      return `<div class="flag-row">
        <div class="flag-header">
          <div class="flag-product">${UI.productName(i.productId)}</div>
          <div class="flag-diff">${diff > 0 ? '+' : ''}${diff}</div>
        </div>
        <div class="flag-detail">
          <div>Sent: <strong>${sent}</strong></div>
          <div>Received: <strong>${recv}</strong></div>
          <div>Difference: <strong style="color:${diff === 0 ? '#28a745' : '#f0ad4e'}">${diff > 0 ? '+' : ''}${diff}</strong></div>
        </div>
        <div class="flag-actions">
          <button class="btn-accept${fa.action === 'accept_as_is' ? ' active-action' : ''}"
            onclick="TransferUI.setFlagAction(this.dataset.tid,this.dataset.pid,'accept_as_is')" data-tid="${UI.esc(transferId)}" data-pid="${UI.esc(i.productId)}">Accept As-Is</button>
          <button class="btn-adjust${fa.action === 'adjust' ? ' active-action' : ''}"
            onclick="TransferUI.setFlagAction(this.dataset.tid,this.dataset.pid,'adjust')" data-tid="${UI.esc(transferId)}" data-pid="${UI.esc(i.productId)}">Adjust</button>
          <button class="btn-reject${fa.action === 'reject' ? ' active-action' : ''}"
            onclick="TransferUI.setFlagAction(this.dataset.tid,this.dataset.pid,'reject')" data-tid="${UI.esc(transferId)}" data-pid="${UI.esc(i.productId)}">Reject</button>
        </div>
        ${isAdjust ? `<div style="margin-bottom:6px">
          <label style="font-size:12px;color:#777">Adjusted quantity:</label>
          ${createStepper({
            id: 'fl_' + i.productId,
            value: fa.qty,
            min: 0,
            max: 9999,
            onChange: function(v) { _txState.flagActions[i.productId].qty = v; }
          })}
        </div>` : ''}
        <input class="flag-notes" type="text" placeholder="Notes (optional)..."
          value="${UI.esc(fa.notes || '')}"
          onchange="_txState.flagActions['${i.productId}'].notes=this.value">
      </div>`;
    }).join('')}

    <div style="margin-top:16px;text-align:right">
      <button class="btn-rose" onclick="TransferUI.completeFlags(this.dataset.tid)" data-tid="${UI.esc(transferId)}"
        ${!allResolved ? 'disabled style="opacity:.5"' : ''}>Complete Transfer</button>
    </div>
  `;

  flagged.forEach(i => {
    window['_stp_fl_' + i.productId] = function(v) { _txState.flagActions[i.productId].qty = v; };
  });
};


let _conflictChosen = {};
window.renderResolveConflict = function(transferId) {
  const el = document.getElementById('page-resolve-conflict');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }
  const conflict = transfer._conflict || { attempts: [] };
  const attempts = conflict.attempts || [];
  const isDirector = (typeof Auth !== 'undefined' && Auth.is && Auth.is('director'));

  const productIds = [];
  attempts.forEach(a => (a.lines || []).forEach(l => { if (productIds.indexOf(l.productId) === -1) productIds.push(l.productId); }));

  if (_conflictChosen.__tid !== transferId) {
    _conflictChosen = { __tid: transferId };
    productIds.forEach(pid => {
      const item = (transfer.items || []).find(i => i.productId === pid);
      const sent = item ? item.sentQty : 0;
      let best = 0;
      attempts.forEach(a => { const ln = (a.lines || []).find(l => l.productId === pid); if (ln && Number(ln.receivedQty) > best) best = Number(ln.receivedQty); });
      _conflictChosen[pid] = Math.max(0, Math.min(sent, best));
    });
  }

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Resolve Receive Conflict</div>
      <button class="btn-grey" onclick="navigateTo('transfers')">&larr; Back</button>
    </div>
    <div class="tx-detail-card">
      <h3>${UI.storeName(transfer.fromStoreId)} &rarr; ${UI.storeName(transfer.toStoreId)}</h3>
      <div class="tx-detail-row"><span>Status</span><strong style="color:#dc2626">Conflicting receives</strong></div>
      <div style="font-size:.82rem;color:#6b7280;margin-top:6px">This transfer was received on more than one device with different counts. Stock currently reflects the first receive to sync. Choose the correct quantity for each line — only the difference will be adjusted.</div>
    </div>
    ${!isDirector ? '<div class="card card-body" style="color:#b45309">Only a Director can resolve a receive conflict.</div>' : productIds.map(pid => {
      const item = (transfer.items || []).find(i => i.productId === pid);
      const sent = item ? item.sentQty : 0;
      const cells = attempts.map(a => {
        const ln = (a.lines || []).find(l => l.productId === pid);
        const who = UI.esc(a.actorName || a.deviceId || 'device');
        return `<div style="flex:1;min-width:110px;padding:6px 8px;background:#f9fafb;border-radius:6px;text-align:center">
          <div style="font-size:.72rem;color:#9ca3af">${who}</div>
          <div style="font-size:1.05rem;font-weight:700">${ln ? ln.receivedQty : '—'}</div></div>`;
      }).join('');
      return `<div class="flag-row">
        <div class="flag-header"><div class="flag-product">${UI.productName(pid)}</div><div class="flag-diff">sent ${sent}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">${cells}</div>
        <div style="margin:6px 0"><label style="font-size:12px;color:#777">Correct quantity received:</label>
          ${createStepper({ id: 'cf_' + pid, value: _conflictChosen[pid], min: 0, max: sent, onChange: function(v) {} })}
        </div>
      </div>`;
    }).join('')}
    ${isDirector ? `<div style="margin-top:16px;text-align:right">
      <button class="btn-rose" onclick="TransferUI.submitConflict(this.dataset.tid)" data-tid="${UI.esc(transferId)}">Resolve Conflict</button>
    </div>` : ''}
  `;
  productIds.forEach(pid => { window['_stp_cf_' + pid] = function(v) { _conflictChosen[pid] = v; }; });
};


window.renderOptimumLevels = function() {
  const el = document.getElementById('page-optimum-levels');
  if (!el) return;

  if (!Auth.is('director') && !Auth.isHO()) {
    el.innerHTML = '<p style="padding:20px;color:#999">You do not have access to this page.</p>';
    return;
  }

  const data = DB.get();
  const products = (data.products || []).filter(p => p.active !== false);
  const stores = data.stores || [];
  const scope = _txState.optScope;
  const storeId = _txState.optStore;

  products.forEach(p => {
    const key = scope === 'global' ? p.id : p.id + '_' + storeId;
    if (!_txState.optEdits[key]) {
      if (scope === 'global') {
        const globalThr = data.thresholds.find(t => t.productId === p.id && (t.storeId === null || t.storeId === '*'));
        _txState.optEdits[key] = { min: globalThr?.minQty || 0, optimum: globalThr?.optimumQty || 0 };
      } else {
        const thr = Stock.threshold(p.id, storeId);
        _txState.optEdits[key] = { min: thr?.minQty || 0, optimum: thr?.optimumQty || 0 };
      }
    }
  });

  el.innerHTML = `
    <div class="ph2-header">
      <div class="ph2-title">Optimum Stock Levels</div>
      <button class="btn-rose" onclick="TransferUI.saveOptimumLevels()">Save All</button>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
      <div class="fg" style="margin-bottom:0;flex:1;min-width:140px">
        <label>Scope</label>
        <select onchange="_txState.optScope=this.value;_txState.optEdits={};renderOptimumLevels()">
          <option value="global"${scope === 'global' ? ' selected' : ''}>Global (all stores)</option>
          <option value="store"${scope === 'store' ? ' selected' : ''}>Per-store override</option>
        </select>
      </div>
      ${scope === 'store' ? `
        <div class="fg" style="margin-bottom:0;flex:1;min-width:140px">
          <label>Store</label>
          <select onchange="_txState.optStore=this.value;_txState.optEdits={};renderOptimumLevels()">
            <option value="">Select store...</option>
            ${stores.map(s => `<option value="${s.id}"${s.id === storeId ? ' selected' : ''}>${UI.storeName(s.id)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
    </div>

    <div class="opt-table-wrap">
      <table class="opt-table">
        <thead>
          <tr>
            <th>Product</th>
            <th style="width:100px">Min Level</th>
            <th style="width:100px">Optimum</th>
            ${scope === 'store' && storeId ? '<th style="width:80px">Current</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${products.map(p => {
            const key = scope === 'global' ? p.id : p.id + '_' + storeId;
            const ed = _txState.optEdits[key] || { min: 0, optimum: 0 };
            const current = scope === 'store' && storeId ? Stock.qty(p.id, storeId) : null;
            return `<tr>
              <td>${UI.esc(p.name)}</td>
              <td><input type="number" value="${ed.min}" min="0"
                onchange="_txState.optEdits['${key}'].min=parseInt(this.value)||0"></td>
              <td><input type="number" value="${ed.optimum}" min="0"
                onchange="_txState.optEdits['${key}'].optimum=parseInt(this.value)||0"></td>
              ${current !== null ? `<td style="text-align:center;font-weight:600;color:${current < ed.min ? '#a71d2a' : '#555'}">${current}</td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
};


window._txState = _txState;  // SA-D-F2: inline onclick handlers reference _txState in global scope
window.Transfer = Transfer;  // Wave H: expose the domain module (like TransferUI) so the harness can drive receive()/resolveAllFlags() directly — no security change (client is not the trust boundary, P-13)
window.TransferUI = {

  openDetail(transferId) {
    const data = DB.get();
    const t = (data.transfers || []).find(x => x.id === transferId);
    if (!t) return;
    if (t.status === 'completed' && !Transfer._canViewHistory()) { if (typeof UI !== 'undefined' && UI.toast) UI.toast("You don't have access to transfer history", 'error'); return; }

    if (t.status === 'draft') {
      _txState.draftConfirmed = {};
      _txState.draftQtys = {};
      navigateToTransferDetail('draft-transfer', transferId);
    } else if (t.status === 'in_transit') {
      const myStores = Auth.storeIds ? Auth.storeIds() : [];
      if (myStores.includes(t.toStoreId) || Auth.isHO() || Auth.is('director')) {
        _txState.receiveMatched = {};
        _txState.receiveQtys = {};
        navigateToTransferDetail('receive-transfer', transferId);
      } else {
        TransferUI.showReadOnly(t);
      }
    } else if (t.status === 'flagged' || t.status === 'received') {
      if (Auth.is('director')) {  // D-044: resolving is Director-only — others get read-only, not a dead resolve screen
        _txState.flagActions = {};
        navigateToTransferDetail('resolve-flags', transferId);
      } else { TransferUI.showReadOnly(t); }
    } else if (t.status === 'conflict') {  // Azure Chunk 4: double-receive conflict — Director resolves, others read-only
      if (Auth.is('director')) {
        _conflictChosen = {};
        navigateToTransferDetail('resolve-conflict', transferId);
      } else { TransferUI.showReadOnly(t); }
    } else {
      TransferUI.showReadOnly(t);  // includes stock_pending / stock_mismatch (R1 — informational, nothing to action)
    }
  },

  showReadOnly(t) {
    const items = t.items || [];
    UI.modal(`
      <div style="max-width:500px">
        <h3 style="margin-top:0">${UI.storeName(t.fromStoreId)} &rarr; ${UI.storeName(t.toStoreId)}</h3>
        <div class="tx-detail-row"><span>Date</span><strong>${UI.fmtDate(t.createdAt)}</strong></div>
        <div class="tx-detail-row"><span>Status</span><strong><span class="badge badge-${t.status}">${(t.status||'').replace(/_/g,' ')}</span></strong></div>
        ${t.status === 'stock_pending' ? `<div style="background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:8px 10px;border-radius:6px;font-size:.8rem;margin:6px 0">⏳ This transfer was received, but its stock movements haven't synced to this device yet — the stock figures aren't final. This clears automatically once sync completes.</div>` : ''}
        ${t.status === 'stock_mismatch' ? `<div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:8px 10px;border-radius:6px;font-size:.8rem;margin:6px 0">⚠ This transfer was received, but one or more of its stock movements were rejected by the server — the stock did NOT land. Please contact your administrator; do not rely on these stock numbers.</div>` : ''}
        <div class="tx-detail-row"><span>Type</span><strong>${t.type === 'return' ? 'Return' : 'Standard'}</strong></div>
        <div class="tx-detail-row"><span>Created By</span><strong>${UI.esc(t.createdByName || '-')}</strong></div>
        <hr style="margin:12px 0;border:none;border-top:1px solid #eee">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr style="text-align:left"><th style="padding:4px 0">Product</th><th>Sent</th><th>Received</th></tr>
          ${items.map(i => `<tr>
            <td style="padding:4px 0">${UI.productName(i.productId)}</td>
            <td>${i.sentQty || i.qty || 0}</td>
            <td>${i.receivedQty != null ? i.receivedQty : '-'}</td>
          </tr>`).join('')}
        </table>
        <div style="text-align:right;margin-top:16px">
          <button class="btn-grey" onclick="UI.closeModal()">Close</button>
        </div>
      </div>
    `);
  },

  cancelTransfer(transferId) {  // D-044: Director-only cancel for a wrong draft/in-transit transfer
    if (!Transfer._canCancel()) { UI.toast('Only a Director can cancel a transfer', 'error'); return; }
    const t = Transfer.get(transferId);
    if (!t) return;
    if (t.status !== 'in_transit' && t.status !== 'draft') { UI.toast('This transfer can no longer be cancelled', 'error'); return; }
    const back = t.status === 'in_transit'
      ? `It has already been sent, so the stock will be returned to ${UI.storeName(t.fromStoreId)}.`
      : 'This draft will be discarded.';
    UI.confirm(`Cancel this transfer (${UI.storeName(t.fromStoreId)} → ${UI.storeName(t.toStoreId)})? ${back}`, async function() {
      if (_txState._creating) return; _txState._creating = true;  // D-F4 double-submit guard
      try {
        const result = await Transfer.cancel(transferId);
        if (!result.ok) { UI.toast(result.error, 'error'); return; }
        UI.toast('Transfer cancelled', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to cancel transfer', 'error');
      } finally { _txState._creating = false; }
    });
  },

  submitCreate() {
    const from = _txState.createFrom;
    const to = _txState.createTo;
    if (!from || !to) { UI.toast('Select both stores', 'error'); return; }
    if (from === to) { UI.toast('From and To stores must differ', 'error'); return; }
    const items = [];
    for (const [pid, qty] of Object.entries(_txState.createItems)) {
      if (qty > 0) items.push({ productId: pid, qty: qty });
    }
    if (items.length === 0) { UI.toast('Add at least one product', 'error'); return; }

    if (_txState.createType === 'return' && !_txState.createReturnReason) {
      UI.toast('Select a return reason', 'error'); return;
    }

    UI.confirm(`Create transfer of ${items.length} products (${items.reduce((s,i)=>s+i.qty,0)} units) from ${UI.storeName(from)} to ${UI.storeName(to)}?`, async function() {
      if (_txState._creating) return;  // D-F2: prevent double-confirm duplicate transfer
      _txState._creating = true;
      try {
        const opts = {};
        if (_txState.createType === 'return') {
          opts.returnReason = _txState.createReturnReason || null;
          opts.returnNote = _txState.createReturnNotes || '';
        }
        const result = await Transfer.create(from, to, items, opts);
        if (!result.ok) { UI.toast(result.error, 'error'); return; }
        _txState.createItems = {};
        _txState.createSearch = '';
        _txState.createReturnReason = '';
        _txState.createReturnNotes = '';
        UI.toast('Transfer created', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to create transfer', 'error');
      } finally { _txState._creating = false; }
    });
  },

  toggleDraftConfirm(transferId, productId) {
    _txState.draftConfirmed[productId] = !_txState.draftConfirmed[productId];
    renderDraftTransfer(transferId);
  },

  submitDraft(transferId) {
    const t = Transfer.get(transferId);
    if (!t || t.status !== 'draft') return;
    t.items.forEach(i => {
      if (_txState.draftConfirmed[i.productId] && i.status !== 'confirmed') i.status = 'confirmed';
    });
    const allConfirmed = t.items.every(i => i.status === 'confirmed');
    if (!allConfirmed) { UI.toast('Confirm all items first', 'warning'); return; }

    UI.confirm('Submit this draft and mark as In Transit?', async function() {
      try {
        const result = await Transfer.submitDraft(transferId, _txState.draftQtys);
        if (!result.ok) { UI.toast(result.error, 'error'); return; }
        _txState.draftConfirmed = {};
        _txState.draftQtys = {};
        UI.toast('Transfer sent', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to submit draft', 'error');
      }
    });
  },

  toggleMatch(transferId, productId) {
    _txState.receiveMatched[productId] = !_txState.receiveMatched[productId];
    renderReceiveTransfer(transferId);
  },

  submitReceive(transferId) {
    if (!Transfer._canReceive() && Auth.user()?.role === 'staff' && typeof Pages !== 'undefined' && Pages._pinUnlockModal) {
      if (typeof Auth.overrideFor === 'function' && Auth.overrideFor('transferReceive') === false) {
        UI.toast('Receiving transfers is turned off for this account.', 'error'); return;
      }
      Pages._pinUnlockModal('receive this transfer', () => TransferUI.submitReceive(transferId));
      return;
    }
    const data = DB.get();
    const transfer = (data.transfers || []).find(t => t.id === transferId);
    if (!transfer) return;
    const items = transfer.items || [];
    const allMatched = items.every(i => _txState.receiveMatched[i.productId]);
    if (!allMatched) { UI.toast('Match all items first', 'warning'); return; }

    const hasFlags = items.some(i => {
      const sent = i.sentQty || i.qty || 0;
      const recv = _txState.receiveQtys[i.productId];
      return recv !== sent;
    });

    const msg = hasFlags
      ? 'Some items have mismatched quantities. Submit receipt and flag mismatches?'
      : 'All items match. Submit receipt?';

    UI.confirm(msg, async function() {
      if (_txState._creating) return; _txState._creating = true;  // D-F4
      try {
        const receiptItems = items.map(i => ({
          productId: i.productId,
          receivedQty: _txState.receiveQtys[i.productId] ?? (i.sentQty || i.qty || 0)
        }));
        const result = await Transfer.receive(transferId, receiptItems);
        if (!result.ok) { UI.toast(result.error, 'error'); return; }
        _txState.receiveMatched = {};
        _txState.receiveQtys = {};
        UI.toast(hasFlags ? 'Receipt submitted with flags' : 'Receipt completed', hasFlags ? 'warning' : 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to submit receipt', 'error');
      } finally { _txState._creating = false; }
    });
  },

  setFlagAction(transferId, productId, action) {
    const fa = _txState.flagActions[productId] || { qty: 0, notes: '' };
    fa.action = fa.action === action ? '' : action;
    _txState.flagActions[productId] = fa;
    renderResolveFlags(transferId);
  },

  completeFlags(transferId) {
    const t = Transfer.get(transferId);
    if (!t) return;
    const flagged = (t.items || []).filter(i => i.status === 'flagged');
    const allResolved = flagged.every(i => _txState.flagActions[i.productId]?.action);
    if (!allResolved) { UI.toast('Resolve all flagged items first', 'warning'); return; }

    UI.confirm('Complete this transfer with the resolved flags?', async function() {
      if (_txState._creating) return; _txState._creating = true;  // D-F4
      try {
        const resolutions = flagged.map(i => {
          const fa = _txState.flagActions[i.productId];
          return { productId: i.productId, action: fa.action, qty: fa.action === 'adjust' ? (fa.qty || 0) : undefined, note: fa.notes || '' };
        });
        const result = await Transfer.resolveAllFlags(transferId, resolutions);
        if (!result.ok) throw new Error(result.error);
        _txState.flagActions = {};
        UI.toast('Transfer completed', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to complete transfer', 'error');
      } finally { _txState._creating = false; }
    });
  },

  submitConflict(transferId) {
    const t = Transfer.get(transferId);
    if (!t || t.status !== 'conflict') { UI.toast('This transfer is not in a conflict state', 'warning'); return; }
    UI.confirm('Resolve this conflict with the chosen quantities? Stock will be adjusted to match.', async function() {
      if (_txState._creating) return; _txState._creating = true;
      try {
        const chosen = {};
        Object.keys(_conflictChosen || {}).forEach(k => { if (k !== '__tid') chosen[k] = _conflictChosen[k]; });
        const result = await Transfer.resolveConflict(transferId, chosen);
        if (!result.ok) throw new Error(result.error);
        _conflictChosen = {};
        UI.toast('Conflict resolved — stock adjusted', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to resolve conflict', 'error');
      } finally { _txState._creating = false; }
    });
  },

  async saveOptimumLevels() {
    if (this._optSaving) return; this._optSaving = true;
    try {
    const scope = _txState.optScope;
    const storeId = _txState.optStore;
    const d = DB.get();
    const products = (d.products || []).filter(p => p.active !== false);
    let saved = 0;

    for (const p of products) {
      const key = scope === 'global' ? p.id : p.id + '_' + storeId;
      const ed = _txState.optEdits[key];
      if (!ed) continue;
      const min = Number(ed.min || 0), opt = Number(ed.optimum || 0);
      if (!Number.isInteger(min) || min < 0 || !Number.isInteger(opt) || opt < 0) { UI.toast(`${p.name}: min/optimum must be whole non-negative numbers`, 'error'); return; }
      if (opt > 0 && min > 0 && opt < min) { UI.toast(`${p.name}: optimum must be greater than or equal to minimum`, 'error'); return; }
      const targetStoreId = scope === 'global' ? '*' : storeId;
      const idx = d.thresholds.findIndex(t => t.productId === p.id && ((scope === 'global') ? (t.storeId === null || t.storeId === '*') : t.storeId === targetStoreId));
      const _existingLead = idx >= 0 ? (d.thresholds[idx].leadDays != null ? d.thresholds[idx].leadDays : null) : null;
      const entry = { productId: p.id, storeId: targetStoreId, minQty: min, optimumQty: opt, leadDays: _existingLead };
      if (idx >= 0) { Object.assign(d.thresholds[idx], entry); } else { d.thresholds.push(entry); }
      saved++;
    }

    if (saved > 0) {
      if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) { Stock._invalidateThrMap(); }
      if(!(await DB.commitDurable())){ try{ await DB.refresh(); }catch(e){} UI.fatalSaveError('Thresholds could not be saved to this device.'); return; }
      UI.toast(`Saved ${saved} threshold(s)`, 'success');
    } else {
      UI.toast('No changes to save', 'info');
    }
    } finally { this._optSaving = false; }
  },

  resetState() {
    _txState.createItems = {};
    _txState.createType = 'standard';
    _txState.createFrom = '';
    _txState.createTo = '';
    _txState.createReturnReason = '';
    _txState.createReturnNotes = '';
    _txState.createSearch = '';
    _txState.receiveMatched = {};
    _txState.receiveQtys = {};
    _txState.flagActions = {};
    _txState.draftConfirmed = {};
    _txState.draftQtys = {};
    _txState.optEdits = {};
  }
};

})();

})();
