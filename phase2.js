// ╔══════════════════════════════════════════════════════════╗
// ║  PHASE 2: Bulk Stock Transfers — Self-contained patch   ║
// ╚══════════════════════════════════════════════════════════╝
// This script is appended near </body>. It:
// 1. Patches DB._migrate to add transfers
// 2. Patches Stock.qty to handle transfer_in
// 3. Adds the Transfer module
// 4. Adds HTML page containers
// 5. Patches buildSidebar to add Transfers nav
// 6. Patches navigateTo to handle new pages
// 7. Loads all Phase 2 UI rendering + CSS

(function() {
'use strict';

// ── 1. Patch DB._migrate ──
const origMigrate = DB._migrate.bind(DB);
DB._migrate = function() {
  origMigrate();
  let changed = false;
  if (!this._cache.transfers) { this._cache.transfers = []; changed = true; }
  // Fix #8: stockThresholds removed — thresholds now unified in d.thresholds array
  // Prune completed transfers > 30 days
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

// ── 2. Stock.qty patch REMOVED (Tier 2 Fix #7) ──
// transfer_in is now handled by the Txn classifier in index.html Stock.qty()

// ── Transfer Module ──────────────────────────────────────────────────────────
const Transfer = {
  EMAIL_URL: 'https://prod-29.australiaeast.logic.azure.com:443/workflows/c190a25cfabc48fc85e1d63628c092b1/triggers/When_a_HTTP_request_is_received/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2FWhen_a_HTTP_request_is_received%2Frun&sv=1.0&sig=h7DYTLNOEE1RvqVW0ROaN31JCIBhn3vevqHsyCLBqo4',

  _canCreate() { return Auth.isAtLeast('store_manager') && !Auth.is('staff'); },
  _canReceive() { return Auth.isAtLeast('staff'); },
  _canResolve() { return Auth.is('director') || Auth.is('head_office') || Auth.is('franchisee'); },
  _canSetThresholds() { return Auth.is('director') || Auth.is('head_office'); },
  _canCancel() { return Auth.is('director') || Auth.is('head_office'); },
  _canViewHistory() { return Auth.isAtLeast('store_manager') && !Auth.is('staff'); },

  _txn(type, productId, qty, storeId, transferId, reason) {
    const u = Auth.user();
    return { id: 'txn_' + Date.now() + '_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join(''), type, productId, qty, storeId, transferId, date: new Date().toISOString().slice(0,10), staffName: u?.name || u?.username || 'unknown', reason: reason || '', by: u, editLog: [], createdAt: new Date().toISOString() };
  },

  _notify(payload) {
    // T3-03: Added .catch() to handle async rejection (try/catch can't catch promise errors)
    try { fetch(this.EMAIL_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).catch(() => {}); } catch(e) {}
  },

  create(fromStoreId, toStoreId, items, options) {
    if (!this._canCreate()) return { ok:false, error:'Permission denied' };
    if (!fromStoreId || !toStoreId || !items?.length) return { ok:false, error:'Missing required fields' };
    if (fromStoreId === toStoreId) return { ok:false, error:'Cannot transfer to same store' };
    const opt = options || {};
    const d = DB.get();
    // T3-03: Add random suffix to prevent ID collision from concurrent devices
    const id = 'tr_' + Date.now() + '_' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    const transfer = {
      id, date: now, createdAt: now, fromStoreId, toStoreId,
      createdBy: Auth.user(),
      createdByName: Auth.user()?.name || Auth.user()?.username || 'unknown',
      status: opt.isDraft ? 'draft' : 'in_transit',
      returnReason: opt.returnReason || null,
      returnNote: opt.returnNote || '',
      items: items.map(i => ({
        productId: i.productId, sentQty: i.qty, receivedQty: null,
        status: opt.isDraft ? 'pending' : 'pending',
        flagNote: '', resolvedBy: null, resolvedAction: null
      })),
      receivedBy: null, receivedDate: null, completedDate: null,
      notes: opt.notes || ''
    };
    DB.addTransfer(transfer);
    // Transit Void: deduct stock immediately unless draft
    if (!opt.isDraft) {
      transfer.items.forEach(item => {
        DB.addTransaction(this._txn('transfer_out', item.productId, item.sentQty, fromStoreId, id, 'Transfer to ' + UI.storeName(toStoreId)));
      });
    }
    DB.commit();
    if (!opt.isDraft) {
      this._notify({
        type: 'transfer_created', fromStore: UI.storeName(fromStoreId), toStore: UI.storeName(toStoreId),
        date: now, createdBy: Auth.user(),
        items: transfer.items.map(i => ({ product: UI.productName(i.productId), qty: i.sentQty })),
        totalItems: transfer.items.length,
        totalUnits: transfer.items.reduce((s, i) => s + i.sentQty, 0)
      });
    }
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

  confirmDraftItem(transferId, productId) {
    const t = this.get(transferId);
    if (!t || t.status !== 'draft') return { ok:false, error:'Invalid transfer or not a draft' };
    const item = t.items.find(i => i.productId === productId);
    if (!item) return { ok:false, error:'Item not found' };
    item.status = item.status === 'confirmed' ? 'pending' : 'confirmed';
    DB.updateTransfer(t); DB.commit();
    return { ok:true };
  },

  submitDraft(transferId, draftQtys) {
    if (!this._canCreate()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || t.status !== 'draft') return { ok:false, error:'Invalid transfer or not a draft' };
    // T2-06: Snapshot the transfer BEFORE any mutations — passed to atomicTransferWrite for rollback
    const snapshot = JSON.parse(JSON.stringify(t));
    // Remove unconfirmed items
    t.items = t.items.filter(i => i.status === 'confirmed');
    if (!t.items.length) {
      // Restore snapshot since we mutated t.items
      Object.keys(t).forEach(k => delete t[k]); Object.assign(t, snapshot);
      return { ok:false, error:'No confirmed items to submit' };
    }
    // T2-06: Apply draft quantity edits after snapshot, before atomic write
    if (draftQtys) {
      t.items.forEach(i => {
        if (draftQtys[i.productId] !== undefined) i.sentQty = draftQtys[i.productId];
      });
    }
    t.items.forEach(i => { i.status = 'pending'; });
    t.status = 'in_transit';
    t.date = new Date().toISOString();
    // Tier 2 Fix #12 (GPT review): collect all transactions, write atomically
    const batchTxns = [];
    t.items.forEach(item => {
      batchTxns.push(this._txn('transfer_out', item.productId, item.sentQty, t.fromStoreId, transferId, 'Transfer to ' + UI.storeName(t.toStoreId)));
    });
    // T2-05/T2-06: Pass pre-mutation snapshot for rollback on failure
    DB.atomicTransferWrite(batchTxns, t, snapshot);
    this._notify({
      type: 'transfer_created', fromStore: UI.storeName(t.fromStoreId), toStore: UI.storeName(t.toStoreId),
      date: t.date, createdBy: Auth.user(),
      items: t.items.map(i => ({ product: UI.productName(i.productId), qty: i.sentQty })),
      totalItems: t.items.length,
      totalUnits: t.items.reduce((s, i) => s + i.sentQty, 0)
    });
    return { ok:true };
  },

  receive(transferId, receivedItems) {
    if (!this._canReceive()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || t.status !== 'in_transit') return { ok:false, error:'Invalid transfer or not in transit' };
    // T2-06: Snapshot before mutations
    const snapshot = JSON.parse(JSON.stringify(t));
    const d = DB.get();
    const now = new Date().toISOString();
    let hasFlagged = false;
    // Tier 2 Fix #12: Collect all transactions, then write atomically
    const batchTxns = [];
    t.items.forEach(item => {
      const ri = receivedItems.find(r => r.productId === item.productId);
      const rQty = ri ? ri.receivedQty : 0;
      item.receivedQty = rQty;
      if (rQty === item.sentQty) {
        item.status = 'accepted';
        batchTxns.push(this._txn('transfer_in', item.productId, rQty, t.toStoreId, transferId, 'Received from ' + UI.storeName(t.fromStoreId)));
      } else {
        item.status = 'flagged';
        hasFlagged = true;
      }
    });
    t.receivedBy = Auth.user();
    t.receivedDate = now;
    t.status = hasFlagged ? 'received' : 'completed';
    if (!hasFlagged) t.completedDate = now;
    // T2-05/T2-06: Pass pre-mutation snapshot for rollback on failure
    DB.atomicTransferWrite(batchTxns, t, snapshot);
    if (!hasFlagged) this._notifyCompleted(t);
    return { ok:true, hasFlagged };
  },

  resolveFlag(transferId, productId, action, qty, note) {
    if (!this._canResolve()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || (t.status !== 'received' && t.status !== 'in_transit')) return { ok:false, error:'Invalid transfer' };
    const item = t.items.find(i => i.productId === productId && i.status === 'flagged');
    if (!item) return { ok:false, error:'Flagged item not found' };
    // T2-06: Snapshot before mutations
    const snapshot = JSON.parse(JSON.stringify(t));
    const d = DB.get();
    item.resolvedBy = Auth.user();
    item.resolvedAction = action;
    item.flagNote = note || '';
    item.status = 'resolved';
    // Tier 2 Fix #12: Collect all transactions, then write atomically
    const batchTxns = [];
    if (action === 'accept_as_is') {
      batchTxns.push(this._txn('transfer_in', productId, item.receivedQty, t.toStoreId, transferId, 'Flag resolved — accepted as-is from ' + UI.storeName(t.fromStoreId)));
      const diff = item.sentQty - item.receivedQty;
      if (diff > 0) {
        batchTxns.push(this._txn('transfer_in', productId, diff, t.fromStoreId, transferId, 'Shortfall returned — ' + diff + ' units'));
      }
    } else if (action === 'adjust') {
      batchTxns.push(this._txn('transfer_in', productId, qty, t.toStoreId, transferId, 'Flag resolved — adjusted qty from ' + UI.storeName(t.fromStoreId)));
      const diff = item.sentQty - qty;
      if (diff > 0) {
        batchTxns.push(this._txn('transfer_in', productId, diff, t.fromStoreId, transferId, 'Adjustment remainder returned — ' + diff + ' units'));
      }
    } else if (action === 'reject') {
      batchTxns.push(this._txn('transfer_in', productId, item.sentQty, t.fromStoreId, transferId, 'Rejected — full qty returned to ' + UI.storeName(t.fromStoreId)));
    }
    // Check if all items resolved
    const allDone = t.items.every(i => i.status === 'accepted' || i.status === 'resolved');
    if (allDone) {
      t.status = 'completed';
      t.completedDate = new Date().toISOString();
    }
    // T2-05/T2-06: Pass pre-mutation snapshot for rollback on failure
    DB.atomicTransferWrite(batchTxns, t, snapshot);
    // T3-M3r1: Notify AFTER successful atomic write (was before — would send ghost emails on write failure)
    if (allDone) this._notifyCompleted(t);
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
    // Store-level users only see their store's transfers
    if (Auth.isStoreLevel() && !Auth.isMgmt()) {
      const sid = Auth.storeId();
      list = list.filter(t => t.fromStoreId === sid || t.toStoreId === sid);
    }
    return list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  get(transferId) {
    return (DB.get().transfers || []).find(t => t.id === transferId) || null;
  },

  cancel(transferId) {
    if (!this._canCancel()) return { ok:false, error:'Permission denied' };
    const t = this.get(transferId);
    if (!t || (t.status !== 'in_transit' && t.status !== 'draft')) return { ok:false, error:'Cannot cancel this transfer' };
    // T2-06: Snapshot before mutations
    const snapshot = JSON.parse(JSON.stringify(t));
    // Tier 2 Fix #12 (GPT review): collect all transactions, write atomically
    const batchTxns = [];
    if (t.status === 'in_transit') {
      // Reverse transfer_out transactions
      t.items.forEach(item => {
        batchTxns.push(this._txn('transfer_in', item.productId, item.sentQty, t.fromStoreId, transferId, 'Transfer cancelled — stock returned'));
      });
    }
    t.status = 'cancelled';
    t.completedDate = new Date().toISOString();
    // T2-05/T2-06: Pass pre-mutation snapshot for rollback on failure
    DB.atomicTransferWrite(batchTxns, t, snapshot);
    return { ok:true };
  },

  // Fix #8: getThresholds/setThresholds REMOVED — unified into Stock.threshold() + d.thresholds array
  // Optimum Stock Levels UI now reads/writes d.thresholds directly via saveOptimumLevels()

  pruneCompleted(daysOld) {
    const d = DB.get();
    const cutoff = Date.now() - (daysOld || 30) * 86400000;
    const before = d.transfers.length;
    d.transfers = d.transfers.filter(t => {
      if (t.status !== 'completed' && t.status !== 'cancelled') return true;
      return new Date(t.completedDate || t.date).getTime() > cutoff;
    });
    if (d.transfers.length < before) DB.commit();
    return before - d.transfers.length;
  }
};

// ── 4. Add HTML page containers ──
const pageContainer = document.querySelector('.main-wrap') || document.querySelector('.main-content') || document.querySelector('.content') || document.querySelector('main');
if (pageContainer) {
  const newPages = ['transfers','create-transfer','draft-transfer','receive-transfer','resolve-flags','optimum-levels'];
  newPages.forEach(id => {
    if (!document.getElementById('page-' + id)) {
      const div = document.createElement('div');
      div.id = 'page-' + id;
      div.className = 'page';
      pageContainer.appendChild(div);
    }
  });
}

// ── 5. Patch buildSidebar to add Transfers section ──
if (typeof buildSidebar === 'function') {
  const origBuildSidebar = buildSidebar;
  window.buildSidebar = function() {
    origBuildSidebar();
    // Add Transfers section after the existing nav
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav && !sidebarNav.querySelector('[data-page="transfers"]')) {
      const role = Auth.user()?.role || '';
      const canCreate = ['director','head_office','franchisee','store_manager'].includes(role);
      const canViewHistory = canCreate;
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
    // Also rebuild mobile nav
    if (typeof buildMobileNav === 'function') {
      setTimeout(buildMobileNav, 0);
    }
  };
}

// ── Icon helpers for nav ──
function iconTransfer() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16l-4-4m0 0l4-4m-4 4h18M17 8l4 4m0 0l-4 4m4-4H3"/></svg>';
}
function iconPlus() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg>';
}
function iconSettings() {
  return '<svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
}

// ── 6. Patch navigateTo to handle new pages ──
if (typeof navigateTo === 'function') {
  const origNavigateTo = navigateTo;
  window.navigateTo = function(page) {
    const phase2Pages = {
      'transfers': () => renderTransfersHub(),
      'create-transfer': () => renderCreateTransfer(),
      'optimum-levels': () => renderOptimumLevels()
    };
    if (phase2Pages[page]) {
      // Use same pattern as original navigateTo
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
  // Also add navigateToTransferDetail for specific transfer pages
  window.navigateToTransferDetail = function(page, transferId) {
    document.querySelectorAll('.page').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('[data-page="transfers"]').forEach(a => a.classList.add('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    if (page === 'draft-transfer') renderDraftTransfer(transferId);
    else if (page === 'receive-transfer') renderReceiveTransfer(transferId);
    else if (page === 'resolve-flags') renderResolveFlags(transferId);
  };
}

// ── 7. Rebuild sidebar on next tick to add Transfers nav ──
setTimeout(function() {
  if (typeof buildSidebar === 'function' && Auth.user()) buildSidebar();
}, 100);

/* ============================================================
   Phase 2 — Transfer Feature UI
   All rendering functions + stepper component + CSS
   ============================================================ */

(function(){
'use strict';

// ---- Inject CSS on load ----
const style = document.createElement('style');
style.textContent = `
/* ============ TRANSFER UI STYLES ============ */

/* --- Status Badges --- */
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;letter-spacing:.3px;white-space:nowrap}
.badge-draft{background:#e0e0e0;color:#555}
.badge-in_transit{background:#d0e4f7;color:#1a6fb5}
.badge-pending_receipt{background:#d0e4f7;color:#1a6fb5}
.badge-received{background:#fde8cc;color:#b5711a}
.badge-flagged{background:#fde8cc;color:#b5711a}
.badge-completed{background:#d4edda;color:#1a6e2e}
.badge-cancelled{background:#f8d7da;color:#a71d2a}

/* --- Transfer Cards / Rows --- */
.tx-list{display:flex;flex-direction:column;gap:8px}
.tx-row{background:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 1px 4px rgba(0,0,0,.07);cursor:pointer;display:grid;grid-template-columns:90px 1fr auto;align-items:center;gap:8px;transition:box-shadow .15s}
.tx-row:hover{box-shadow:0 2px 8px rgba(0,0,0,.13)}
.tx-row .tx-date{font-size:13px;color:#777}
.tx-row .tx-route{font-size:14px;font-weight:600;color:var(--black,#231F20)}
.tx-row .tx-meta{font-size:12px;color:#999;margin-top:2px}
.tx-row .tx-right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.tx-row .tx-items{font-size:12px;color:#777}

/* --- Filter Tabs --- */
.filter-tabs{display:flex;gap:4px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch}
.filter-tab{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:500;border:1px solid #ddd;background:#fff;color:#555;cursor:pointer;white-space:nowrap;transition:all .15s}
.filter-tab.active{background:var(--rose,#d8838b);color:#fff;border-color:var(--rose,#d8838b)}

/* --- Page Header --- */
.ph2-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.ph2-title{font-size:20px;font-weight:700;color:var(--black,#231F20)}
.btn-rose{background:var(--rose,#d8838b);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn-rose:hover{opacity:.85}
.btn-outline{background:#fff;color:var(--rose,#d8838b);border:2px solid var(--rose,#d8838b);padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
.btn-sm{padding:6px 12px;font-size:13px}
.btn-grey{background:#e0e0e0;color:#555;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}

/* --- Stepper --- */
.stepper{display:inline-flex;align-items:center;gap:0;border:1.5px solid var(--rose-mid,#edb8bc);border-radius:8px;overflow:hidden;background:#fff}
.stepper-btn{width:40px;height:40px;border:none;background:var(--rose-light,#fdf0f1);color:var(--rose,#d8838b);font-size:20px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s;-webkit-user-select:none;user-select:none}
.stepper-btn:active{background:var(--rose-mid,#edb8bc)}
.stepper-val{width:48px;height:40px;text-align:center;font-size:16px;font-weight:600;border:none;border-left:1.5px solid var(--rose-mid,#edb8bc);border-right:1.5px solid var(--rose-mid,#edb8bc);background:#fff;color:var(--black,#231F20);cursor:pointer;-moz-appearance:textfield}
.stepper-val::-webkit-outer-spin-button,.stepper-val::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

/* --- Product Picker Grid --- */
.pp-search{width:100%;padding:10px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box}
.pp-search:focus{border-color:var(--rose,#d8838b);outline:none}
.pp-grid{display:grid;grid-template-columns:minmax(120px,2fr) repeat(4,1fr) auto;gap:0;font-size:13px}
.pp-grid.phone-cols{grid-template-columns:minmax(100px,2fr) 1fr auto}
.pp-hdr{font-weight:700;padding:8px 6px;background:var(--rose-light,#fdf0f1);color:var(--black,#231F20);border-bottom:2px solid var(--rose-mid,#edb8bc);position:sticky;top:0}
.pp-cell{padding:8px 6px;border-bottom:1px solid #eee;display:flex;align-items:center}
.pp-cell.name{font-weight:500}
.pp-cell.shortfall{color:var(--rose,#d8838b);font-weight:600}
.pp-grid-wrap{max-height:50vh;overflow-y:auto;border:1px solid #eee;border-radius:8px}

/* --- Summary Bar --- */
.summary-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--rose-light,#fdf0f1);border-radius:8px;margin-top:12px;flex-wrap:wrap;gap:8px}
.summary-stat{font-size:14px;font-weight:600;color:var(--black,#231F20)}
.summary-stat span{color:var(--rose,#d8838b)}

/* --- Form Groups --- */
.fg{margin-bottom:14px}
.fg label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px}
.fg select,.fg input[type=text],.fg textarea{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box}
.fg select:focus,.fg input[type=text]:focus,.fg textarea:focus{border-color:var(--rose,#d8838b);outline:none}
.fg textarea{resize:vertical;min-height:60px}
.toggle-group{display:flex;gap:0;border:1.5px solid var(--rose-mid,#edb8bc);border-radius:8px;overflow:hidden}
.toggle-opt{flex:1;padding:10px;text-align:center;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#777;transition:all .15s}
.toggle-opt.active{background:var(--rose,#d8838b);color:#fff}

/* --- Receive Transfer --- */
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

/* --- Flag Resolution --- */
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

/* --- Optimum Levels --- */
.opt-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.opt-table th{background:var(--rose-light,#fdf0f1);padding:8px 10px;text-align:left;font-weight:700;position:sticky;top:0;border-bottom:2px solid var(--rose-mid,#edb8bc)}
.opt-table td{padding:6px 10px;border-bottom:1px solid #eee}
.opt-table input[type=number]{width:70px;padding:6px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:13px;text-align:center}
.opt-table input[type=number]:focus{border-color:var(--rose,#d8838b);outline:none}
.opt-table-wrap{max-height:60vh;overflow-y:auto;border:1px solid #eee;border-radius:8px}

/* --- Draft Transfer --- */
.draft-row{background:#fff;border-radius:10px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,.07);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.draft-left{flex:1;min-width:140px}
.draft-left .prod-name{font-weight:600;font-size:14px}
.draft-left .shortfall-info{font-size:13px;color:#777}
.draft-right{display:flex;align-items:center;gap:10px}
.confirm-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:none;cursor:pointer}
.confirm-btn.unconfirmed{background:var(--rose,#d8838b);color:#fff}
.confirm-btn.confirmed{background:#28a745;color:#fff}

/* --- Pagination --- */
.pagination{display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px}
.pagination button{padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;border:1px solid #ddd;background:#fff;cursor:pointer;color:#555}
.pagination button.active{background:var(--rose,#d8838b);color:#fff;border-color:var(--rose,#d8838b)}
.pagination button:disabled{opacity:.4;cursor:default}
.page-info{font-size:13px;color:#777}

/* --- Transfer Detail Card --- */
.tx-detail-card{background:#fff;border-radius:10px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:16px}
.tx-detail-card h3{margin:0 0 10px;font-size:16px;color:var(--black,#231F20)}
.tx-detail-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:#555}
.tx-detail-row strong{color:var(--black,#231F20)}

/* --- Responsive --- */
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


// ============================================================
// STEPPER COMPONENT
// ============================================================

const _stepperTimers = {};

window.createStepper = function(opts) {
  const id = opts.id || ('stp_' + Math.random().toString(36).slice(2,8));
  const val = opts.value ?? 0;
  const min = opts.min ?? 0;
  const max = opts.max ?? 9999;
  // Register change handler
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
        // Accelerate: +/-10
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


// ============================================================
// STATE for transfer pages
// ============================================================
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


// ============================================================
// 1. TRANSFERS HUB
// ============================================================
window.renderTransfersHub = function() {
  const el = document.getElementById('page-transfers');
  if (!el) return;
  const data = DB.get();
  const transfers = data.transfers || [];
  const user = Auth.user();
  const myStores = Auth.storeIds ? Auth.storeIds() : [];
  const isHO = Auth.isHO();
  const isMgmt = Auth.isMgmt();

  // Filter transfers visible to user
  let visible = transfers.filter(t => {
    if (Auth.is('director') || isHO) return true;
    if (isMgmt) return myStores.includes(t.fromStoreId) || myStores.includes(t.toStoreId);
    return myStores.includes(t.fromStoreId) || myStores.includes(t.toStoreId);
  });

  // Status filter
  const f = _txState.hubFilter;
  const statusFilters = {
    all: () => true,
    in_transit: t => t.status === 'in_transit',
    needs_receiving: t => t.status === 'in_transit' && myStores.includes(t.toStoreId),
    flagged: t => t.status === 'flagged' || t.status === 'received',
    completed: t => t.status === 'completed',
    drafts: t => t.status === 'draft'
  };
  const filtered = visible.filter(statusFilters[f] || statusFilters.all);

  // Sort by date desc
  filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Pagination
  const perPage = 15;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const page = Math.min(_txState.hubPage, totalPages - 1);
  const paged = filtered.slice(page * perPage, (page + 1) * perPage);

  const canCreate = Auth.isAtLeast('store_manager');
  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'needs_receiving', label: 'Needs Receiving' },
    { key: 'flagged', label: 'Flagged' },
    { key: 'completed', label: 'Completed' },
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
          return `<div class="tx-row" onclick="TransferUI.openDetail('${t.id}')">
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


// ============================================================
// 2. CREATE TRANSFER
// ============================================================
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

  // Fix #8: Use unified Stock.threshold() instead of stockThresholds

  const totalSelected = Object.values(_txState.createItems).filter(q => q > 0).length;
  const totalUnits = Object.values(_txState.createItems).reduce((s, q) => s + (q > 0 ? q : 0), 0);

  const storeOpts = stores.map(s =>
    `<option value="${s.id}"${s.id === from ? ' selected' : ''}>${UI.storeName(s.id)}</option>`
  ).join('');
  const storeOptsTo = stores.map(s =>
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

  // Rebind stepper callbacks after render
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


// ============================================================
// 3. DRAFT TRANSFER
// ============================================================
window.renderDraftTransfer = function(transferId) {
  const el = document.getElementById('page-draft-transfer');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const items = transfer.items || [];

  // Init state
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
            onclick="TransferUI.toggleDraftConfirm('${transferId}','${i.productId}')">
            ${confirmed ? 'Undo' : 'Confirm'}
          </button>
        </div>
      </div>`;
    }).join('')}

    <div style="margin-top:16px;text-align:right">
      <button class="btn-rose" onclick="TransferUI.submitDraft('${transferId}')"
        ${!allConfirmed ? 'disabled style="opacity:.5"' : ''}>
        Submit &amp; Send Transfer
      </button>
    </div>
  `;

  // Rebind callbacks
  items.forEach(i => {
    window['_stp_dr_' + i.productId] = function(v) { _txState.draftQtys[i.productId] = v; };
  });
};


// ============================================================
// 4. RECEIVE TRANSFER
// ============================================================
window.renderReceiveTransfer = function(transferId) {
  const el = document.getElementById('page-receive-transfer');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const items = transfer.items || [];

  // Init receive state
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
              // Auto-unmark match if qty changed after matching
              if (_txState.receiveMatched[i.productId]) {
                _txState.receiveMatched[i.productId] = false;
                renderReceiveTransfer(transferId);
              }
            }
          })}
          <button class="match-btn ${btnClass}"
            onclick="TransferUI.toggleMatch('${transferId}','${i.productId}')">${btnLabel}</button>
        </div>
      </div>`;
    }).join('')}

    <div style="margin-top:16px;text-align:right">
      <button class="btn-rose" onclick="TransferUI.submitReceive('${transferId}')"
        ${!allMatched ? 'disabled style="opacity:.5"' : ''}>Submit Receipt</button>
    </div>
  `;

  // Rebind callbacks
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


// ============================================================
// 5. RESOLVE FLAGS
// ============================================================
window.renderResolveFlags = function(transferId) {
  const el = document.getElementById('page-resolve-flags');
  if (!el) return;
  const data = DB.get();
  const transfer = (data.transfers || []).find(t => t.id === transferId);
  if (!transfer) { el.innerHTML = '<p>Transfer not found.</p>'; return; }

  const flagged = (transfer.items || []).filter(i => i.status === 'flagged');

  // Init flag state
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
            onclick="TransferUI.setFlagAction('${transferId}','${i.productId}','accept_as_is')">Accept As-Is</button>
          <button class="btn-adjust${fa.action === 'adjust' ? ' active-action' : ''}"
            onclick="TransferUI.setFlagAction('${transferId}','${i.productId}','adjust')">Adjust</button>
          <button class="btn-reject${fa.action === 'reject' ? ' active-action' : ''}"
            onclick="TransferUI.setFlagAction('${transferId}','${i.productId}','reject')">Reject</button>
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
      <button class="btn-rose" onclick="TransferUI.completeFlags('${transferId}')"
        ${!allResolved ? 'disabled style="opacity:.5"' : ''}>Complete Transfer</button>
    </div>
  `;

  // Rebind adjust stepper callbacks
  flagged.forEach(i => {
    window['_stp_fl_' + i.productId] = function(v) { _txState.flagActions[i.productId].qty = v; };
  });
};


// ============================================================
// 6. OPTIMUM LEVELS
// ============================================================
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
  // Fix #8: Use unified Stock.threshold() instead of stockThresholds
  const scope = _txState.optScope;
  const storeId = _txState.optStore;

  // Init edits from canonical thresholds
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


// ============================================================
// TransferUI — action handlers
// ============================================================
window.TransferUI = {

  openDetail(transferId) {
    const data = DB.get();
    const t = (data.transfers || []).find(x => x.id === transferId);
    if (!t) return;

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
      _txState.flagActions = {};
      navigateToTransferDetail('resolve-flags', transferId);
    } else {
      TransferUI.showReadOnly(t);
    }
  },

  showReadOnly(t) {
    const items = t.items || [];
    UI.modal(`
      <div style="max-width:500px">
        <h3 style="margin-top:0">${UI.storeName(t.fromStoreId)} &rarr; ${UI.storeName(t.toStoreId)}</h3>
        <div class="tx-detail-row"><span>Date</span><strong>${UI.fmtDate(t.createdAt)}</strong></div>
        <div class="tx-detail-row"><span>Status</span><strong><span class="badge badge-${t.status}">${(t.status||'').replace(/_/g,' ')}</span></strong></div>
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

    UI.confirm(`Create transfer of ${items.length} products (${items.reduce((s,i)=>s+i.qty,0)} units) from ${UI.storeName(from)} to ${UI.storeName(to)}?`, function() {
      try {
        const opts = {};
        if (_txState.createType === 'return') {
          opts.returnReason = _txState.createReturnReason || null;
          opts.returnNote = _txState.createReturnNotes || '';
        }
        const result = Transfer.create(from, to, items, opts);
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
      }
    });
  },

  toggleDraftConfirm(transferId, productId) {
    _txState.draftConfirmed[productId] = !_txState.draftConfirmed[productId];
    renderDraftTransfer(transferId);
  },

  submitDraft(transferId) {
    const t = Transfer.get(transferId);
    if (!t || t.status !== 'draft') return;
    // Confirm all items first via Transfer module
    t.items.forEach(i => {
      if (_txState.draftConfirmed[i.productId] && i.status !== 'confirmed') {
        Transfer.confirmDraftItem(transferId, i.productId);
      }
      // T2-06: Do NOT mutate sentQty here — pass draftQtys to Transfer.submitDraft()
      // so the mutation happens inside the atomic write boundary
    });
    const allConfirmed = t.items.every(i => i.status === 'confirmed');
    if (!allConfirmed) { UI.toast('Confirm all items first', 'warning'); return; }

    UI.confirm('Submit this draft and mark as In Transit?', function() {
      try {
        // T2-06: Pass draft quantities so they're applied inside the atomic boundary
        const result = Transfer.submitDraft(transferId, _txState.draftQtys);
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

    UI.confirm(msg, function() {
      try {
        const receiptItems = items.map(i => ({
          productId: i.productId,
          receivedQty: _txState.receiveQtys[i.productId] ?? (i.sentQty || i.qty || 0)
        }));
        const result = Transfer.receive(transferId, receiptItems);
        if (!result.ok) { UI.toast(result.error, 'error'); return; }
        _txState.receiveMatched = {};
        _txState.receiveQtys = {};
        UI.toast(hasFlags ? 'Receipt submitted with flags' : 'Receipt completed', hasFlags ? 'warning' : 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to submit receipt', 'error');
      }
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

    UI.confirm('Complete this transfer with the resolved flags?', function() {
      try {
        flagged.forEach(i => {
          const fa = _txState.flagActions[i.productId];
          const action = fa.action; // 'accept_as_is' | 'adjust' | 'reject'
          const qty = fa.action === 'adjust' ? (fa.qty || 0) : undefined;
          const note = fa.notes || '';
          const result = Transfer.resolveFlag(transferId, i.productId, action, qty, note);
          if (!result.ok) throw new Error(result.error);
        });
        _txState.flagActions = {};
        UI.toast('Transfer completed', 'success');
        navigateTo('transfers');
        renderTransfersHub();
      } catch (e) {
        UI.toast(e.message || 'Failed to complete transfer', 'error');
      }
    });
  },

  saveOptimumLevels() {
    // Fix #8: Write to canonical d.thresholds array
    const scope = _txState.optScope;
    const storeId = _txState.optStore;
    const d = DB.get();
    const products = (d.products || []).filter(p => p.active !== false);
    let saved = 0;

    products.forEach(p => {
      const key = scope === 'global' ? p.id : p.id + '_' + storeId;
      const ed = _txState.optEdits[key];
      if (!ed) return;
      const targetStoreId = scope === 'global' ? null : storeId;
      const idx = d.thresholds.findIndex(t => t.productId === p.id && ((targetStoreId === null) ? (t.storeId === null || t.storeId === '*') : t.storeId === targetStoreId));
      const entry = { productId: p.id, storeId: targetStoreId, minQty: ed.min || 0, optimumQty: ed.optimum || 0, leadDays: null };
      if (idx >= 0) { Object.assign(d.thresholds[idx], entry); } else { d.thresholds.push(entry); }
      saved++;
    });

    if (saved > 0) {
      // T3-04: Invalidate threshold Map cache before commit
      if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) { Stock._invalidateThrMap(); }
      DB.commit();
      UI.toast(`Saved ${saved} threshold(s)`, 'success');
    } else {
      UI.toast('No changes to save', 'info');
    }
  },

  // Reset all transient state (call when navigating away)
  resetState() {
    _txState.createItems = {};
    _txState.createSearch = '';
    _txState.receiveMatched = {};
    _txState.receiveQtys = {};
    _txState.flagActions = {};
    _txState.draftConfirmed = {};
    _txState.draftQtys = {};
  }
};

})();

})();
