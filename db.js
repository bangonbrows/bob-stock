/**
 * BOB Stock App — Dexie.js Data Layer (Phase 3)
 * Replaces the localStorage-based DB object with IndexedDB via Dexie.js
 *
 * CRITICAL DESIGN: DB.get() remains SYNCHRONOUS (returns _cache).
 * The cache is pre-loaded during initDB() before any UI renders.
 * DB.commit() is also synchronous — it updates _cache in memory and
 * fires the Dexie write in the background (fire-and-forget).
 * This preserves compatibility with 140+ existing DB.get() calls
 * and 29 DB.commit() calls that don't use await.
 *
 * HYBRID WRITE STRATEGY (Option C):
 * - Append-only tables (transactions, deletedTransactions, transfers)
 *   use single-record inserts via bobDB.<table>.put(item).
 *   This scales to 100K+ records without lag.
 * - Small reference tables (products, stores, users, categories, etc.)
 *   use clear-and-rewrite. These are tiny (<200 records) and rarely change.
 * - Full clear-and-rewrite (_persistAllToDexie) is ONLY used for:
 *   migration, SEED loading, and sync pull merges.
 */

// ─── Dexie Database Definition ───────────────────────────────────────────────
const bobDB = new Dexie('BobStockDB');

bobDB.version(1).stores({
  // SEED / reference data — keyed by `id`, indexed for lookups
  productTypes:   'id, name',
  categories:     'id, name, ptId',
  products:       'id, name, catId, active',
  stores:         'id, name, type, active',
  users:          'id, username, role',
  thresholds:     '[storeId+productId], storeId, productId',

  // Transactional data — keyed by `id`, indexed for queries
  transactions:         'id, date, storeId, productId, type, createdAt, _syncTs',
  deletedTransactions:  'id, date, storeId, productId',
  transfers:            'id, date, _syncTs',
  costHistory:          'id, productId, date, _syncTs',
  stockTakes:           'id, storeId, date, _syncTs',
  deliveries:           'id, storeId, date, _syncTs',

  // App metadata — key-value store for config, device info, etc.
  meta:                 'key'
});

// ─── Write Tracking ─────────────────────────────────────────────────────────
// Tracks whether a Dexie write is in flight, used by beforeunload guard.
let _pendingWrites = 0;

// ─── Full Dexie Write (migration, SEED, sync merge ONLY) ────────────────────
// Clears and rewrites ALL tables. Expensive at scale — only use for bulk ops.

async function _persistAllToDexie(d) {
  _pendingWrites++;
  try {
    await bobDB.transaction('rw',
      bobDB.productTypes, bobDB.categories, bobDB.products,
      bobDB.stores, bobDB.users, bobDB.thresholds,
      bobDB.transactions, bobDB.deletedTransactions,
      bobDB.transfers, bobDB.costHistory, bobDB.stockTakes,
      bobDB.deliveries, bobDB.meta,
      async () => {
        await Promise.all([
          bobDB.productTypes.clear().then(() => d.productTypes?.length ? bobDB.productTypes.bulkPut(d.productTypes) : null),
          bobDB.categories.clear().then(() => d.categories?.length ? bobDB.categories.bulkPut(d.categories) : null),
          bobDB.products.clear().then(() => d.products?.length ? bobDB.products.bulkPut(d.products) : null),
          bobDB.stores.clear().then(() => d.stores?.length ? bobDB.stores.bulkPut(d.stores) : null),
          bobDB.users.clear().then(() => d.users?.length ? bobDB.users.bulkPut(d.users) : null),
          bobDB.thresholds.clear().then(() => d.thresholds?.length ? bobDB.thresholds.bulkPut(d.thresholds) : null),
          bobDB.transactions.clear().then(() => d.transactions?.length ? bobDB.transactions.bulkPut(d.transactions) : null),
          bobDB.deletedTransactions.clear().then(() => d.deletedTransactions?.length ? bobDB.deletedTransactions.bulkPut(d.deletedTransactions) : null),
          bobDB.transfers.clear().then(() => d.transfers?.length ? bobDB.transfers.bulkPut(d.transfers) : null),
          bobDB.costHistory.clear().then(() => d.costHistory?.length ? bobDB.costHistory.bulkPut(d.costHistory) : null),
          bobDB.stockTakes.clear().then(() => d.stockTakes?.length ? bobDB.stockTakes.bulkPut(d.stockTakes) : null),
          bobDB.deliveries.clear().then(() => d.deliveries?.length ? bobDB.deliveries.bulkPut(d.deliveries) : null),
        ]);

        await bobDB.meta.bulkPut([
          { key: '_v', value: d._v || 0 },
          { key: 'stockTakePin', value: d.stockTakePin || { pin: null, expiresAt: null } },
          // Fix #8: stockThresholds removed — thresholds now in d.thresholds table
        ]);
      }
    );
    return true;
  } catch (err) {
    console.error('[DB] Full persist failed:', err);
    return false;
  } finally {
    _pendingWrites--;
  }
}

// ─── Reference-Only Rewrite (used by normal commit) ─────────────────────────
// Only rewrites the small, rarely-changing reference tables + meta.
// Transactions/transfers/deletedTransactions are handled by individual puts.

async function _persistRefDataToDexie(d) {
  _pendingWrites++;
  try {
    await bobDB.transaction('rw',
      bobDB.productTypes, bobDB.categories, bobDB.products,
      bobDB.stores, bobDB.users, bobDB.thresholds,
      bobDB.costHistory, bobDB.stockTakes, bobDB.deliveries,
      bobDB.meta,
      async () => {
        await Promise.all([
          bobDB.productTypes.clear().then(() => d.productTypes?.length ? bobDB.productTypes.bulkPut(d.productTypes) : null),
          bobDB.categories.clear().then(() => d.categories?.length ? bobDB.categories.bulkPut(d.categories) : null),
          bobDB.products.clear().then(() => d.products?.length ? bobDB.products.bulkPut(d.products) : null),
          bobDB.stores.clear().then(() => d.stores?.length ? bobDB.stores.bulkPut(d.stores) : null),
          bobDB.users.clear().then(() => d.users?.length ? bobDB.users.bulkPut(d.users) : null),
          bobDB.thresholds.clear().then(() => d.thresholds?.length ? bobDB.thresholds.bulkPut(d.thresholds) : null),
          // costHistory, stockTakes, deliveries are small and may be edited, so rewrite
          bobDB.costHistory.clear().then(() => d.costHistory?.length ? bobDB.costHistory.bulkPut(d.costHistory) : null),
          bobDB.stockTakes.clear().then(() => d.stockTakes?.length ? bobDB.stockTakes.bulkPut(d.stockTakes) : null),
          bobDB.deliveries.clear().then(() => d.deliveries?.length ? bobDB.deliveries.bulkPut(d.deliveries) : null),
        ]);

        await bobDB.meta.bulkPut([
          { key: '_v', value: d._v || 0 },
          { key: 'stockTakePin', value: d.stockTakePin || { pin: null, expiresAt: null } },
          // Fix #8: stockThresholds removed — thresholds now in d.thresholds table
        ]);
      }
    );
    return true;
  } catch (err) {
    console.error('[DB] Ref-data persist failed:', err);
    return false;
  } finally {
    _pendingWrites--;
  }
}

// ─── Write Retry Logic (Tier 2 Fix #17) ─────────────────────────────────────
// Retries failed Dexie writes with exponential backoff.
// Shows a persistent warning banner if all retries fail.

const WRITE_MAX_RETRIES = 3;
const WRITE_BASE_DELAY = 500;  // ms — doubles each retry (500, 1000, 2000)

/**
 * Shows or hides the write-failure warning banner.
 * The banner is injected into the DOM once, then shown/hidden.
 */
function _showWriteWarning(show) {
  let banner = document.getElementById('db-write-warning');
  if (show && !banner) {
    banner = document.createElement('div');
    banner.id = 'db-write-warning';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#d32f2f;color:#fff;text-align:center;padding:10px 16px;' +
      'font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    banner.textContent = '\u26A0 Your changes may not have been saved. Please do not close this tab.';
    document.body.appendChild(banner);
  }
  if (banner) {
    banner.style.display = show ? 'block' : 'none';
  }
}

/**
 * Retries a Dexie write operation with exponential backoff.
 * @param {Function} writeFn - Async function that performs the Dexie write
 * @param {string} label - Human-readable label for logging
 * @returns {boolean} true if write succeeded, false if all retries exhausted
 */
async function _retryWrite(writeFn, label) {
  for (let attempt = 0; attempt <= WRITE_MAX_RETRIES; attempt++) {
    try {
      await writeFn();
      // If we were showing a warning from a previous failure, clear it
      _showWriteWarning(false);
      return true;
    } catch (err) {
      if (attempt < WRITE_MAX_RETRIES) {
        const delay = WRITE_BASE_DELAY * Math.pow(2, attempt);
        console.warn(`[DB] ${label} failed (attempt ${attempt + 1}/${WRITE_MAX_RETRIES + 1}), retrying in ${delay}ms:`, err);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[DB] ${label} failed after ${WRITE_MAX_RETRIES + 1} attempts:`, err);
        _showWriteWarning(true);
        // G-F2/G-F3: surface ANY exhausted write failure loudly — no fire-and-forget save fails silently
        if (typeof UI !== 'undefined' && UI.fatalSaveError) UI.fatalSaveError('A save to this device failed (' + label + '). Your last change may not have been saved — contact your administrator.');
        return false;
      }
    }
  }
  return false;
}

// ─── Single-Record Append (used for transactions, transfers, etc.) ───────────
// Inserts or updates a single record in an append-only table.
// This is O(1) regardless of table size — no lag at 100K+ records.
// Tier 2 Fix #17: Now retries with exponential backoff and shows warning on failure.

async function _appendRecord(tableName, record) {
  _pendingWrites++;
  try {
    return await _retryWrite(
      () => bobDB[tableName].put(record),
      `Append to ${tableName}`
    );
  } finally {
    _pendingWrites--;
  }
}

// ─── Bulk Append (used for sync merge of multiple remote records) ────────────

async function _appendRecords(tableName, records) {
  if (!records || records.length === 0) return true;
  _pendingWrites++;
  try {
    return await _retryWrite(
      () => bobDB[tableName].bulkPut(records),
      `Bulk append to ${tableName} (${records.length} records)`
    );
  } finally {
    _pendingWrites--;
  }
}

// F1-C01 shared primitive: BOTH the load-time normalizer (DB._normalizeActiveFlags)
// and the seed loader (_loadSeedData) run through this ONE function — so the
// saboteur harness can prove sentinel S-37 by breaking a single point. A missing
// active flag means ACTIVE; only an explicit active===false means deactivated.
function _defaultActiveTrue(rows) {
  (rows || []).forEach(o => { if (o && typeof o === 'object') o.active = o.active !== false; });
  return rows || [];
}

// ─── Async Dexie Read (used once at init) ────────────────────────────────────

async function _loadFromDexie() {
  const [productTypes, categories, products, stores, users,
         thresholds, transactions, deletedTransactions,
         transfers, costHistory, stockTakes, deliveries] = await Promise.all([
    bobDB.productTypes.toArray(),
    bobDB.categories.toArray(),
    bobDB.products.toArray(),
    bobDB.stores.toArray(),
    bobDB.users.toArray(),
    bobDB.thresholds.toArray(),
    bobDB.transactions.toArray(),
    bobDB.deletedTransactions.toArray(),
    bobDB.transfers.toArray(),
    bobDB.costHistory.toArray(),
    bobDB.stockTakes.toArray(),
    bobDB.deliveries.toArray(),
  ]);

  const metaV = await bobDB.meta.get('_v');
  const metaPin = await bobDB.meta.get('stockTakePin');
  // Fix #8: stockThresholds no longer loaded — thresholds unified in d.thresholds

  return {
    productTypes,
    categories,
    products,
    stores,
    users,
    thresholds,
    transactions,
    deletedTransactions,
    transfers,
    costHistory,
    stockTakes,
    deliveries,
    stockTakePin: metaPin ? metaPin.value : { pin: null, expiresAt: null },
    _v: metaV ? metaV.value : 0,
  };
}

// ─── DB Object (Compatibility Shim) ─────────────────────────────────────────
// SYNCHRONOUS API — same contract as the original localStorage-based DB.
// get() returns the cache; commit() updates cache + fires async persist.

const DB = {
  KEY: 'bob_stock_v4',   // kept for migration detection
  _cache: null,
  // Compatibility stubs for App.launch() and phase2.js
  load() { /* no-op: data loaded by initDB(SEED) */ },
  _migrate() { /* no-op: schema handled by Dexie */ },

  /**
   * SYNCHRONOUS. Returns the in-memory data cache.
   * Must call initDB() first to populate the cache.
   * 140+ existing call sites depend on this being sync.
   */
  get() {
    if (!this._cache) {
      console.error('[DB] Cache not loaded! Call initDB() first.');
      return null;
    }
    return this._cache;
  },

  /**
   * SYNCHRONOUS on the surface.
   * Full save — writes ALL data to cache and persists ALL tables to Dexie.
   * Used by sync merge (pull) where multiple tables change at once.
   * For normal user actions, prefer commit() which uses the hybrid strategy.
   */
  // B-F1: strip < > from all catalogue names at the persistence choke point so a
  // boobytrapped name can NEVER be stored (closes the ~104 raw ${name} sinks at the source).
  _sanitizeNames() {
    if (!this._cache) return;
    // B-F1/A-F1: strip body AND attribute-breakout chars from names + supplier fields
    const strip = v => (typeof v === 'string') ? v.replace(/[<>"'`]/g, '') : v;
    ['products','stores','categories','productTypes','users'].forEach(coll => {
      (this._cache[coll] || []).forEach(o => {
        if (!o) return;
        if (typeof o.name === 'string') o.name = strip(o.name);
        if (typeof o.supplierName === 'string') o.supplierName = strip(o.supplierName);
        if (typeof o.supplierContact === 'string') o.supplierContact = strip(o.supplierContact);
        if (typeof o.username === 'string') o.username = strip(o.username);  // R6: sanitize username (feeds createdBy)
        if (typeof o.id === 'string') o.id = strip(o.id);  // SA-B-F1: ids render raw in ~40 sinks (store id is user-entered); ids never legitimately contain < > " ' `
      });
    });
    this._normalizeActiveFlags();  // F1-C01: piggy-back on the same choke point — every load/commit/save path runs through here
  },

  // F1-C01 (GPT FINAL C-01): products/stores with NO active flag must default to
  // ACTIVE, never hidden. Seed products omit `active`; ~20 UI surfaces filter on
  // truthy p.active, so a fresh install rendered 192 products / 0 visible.
  // `active === false` (explicit deactivation via Remove) is preserved.
  // Both this and the seed loader run through _defaultActiveTrue (one provable point).
  _normalizeActiveFlags() {
    if (!this._cache) return;
    ['products','stores'].forEach(coll => _defaultActiveTrue(this._cache[coll]));
  },

  save(d) {
    this._cache = d;
    this._sanitizeNames();
    _retryWrite(
      async () => { const _r = await _persistAllToDexie(d); if (!_r) throw new Error('full persist returned false'); },  // A-F2
      'Full save'
    ).catch(err => {
      console.error('[DB] Background full-save failed after retries:', err);
    });
    // Fix #9: Full cache rebuild after save (sync merge replaces entire dataset)
    if (typeof Stock !== 'undefined' && Stock._buildCache) {
      Stock._buildCache();
    }
    return true;
  },

  /**
   * SYNCHRONOUS on the surface.
   * Bumps version, persists ONLY reference data to Dexie (fast).
   * Append-only tables (transactions, transfers, deletedTransactions)
   * are written individually via addTransaction/addTransfer/etc.
   * Returns true (optimistic). 27 bare calls + 3 if-checked calls.
   */
  commit() {
    if (!this._cache) return false;
    this._sanitizeNames();
    this._cache._v = (this._cache._v || 0) + 1;
    // Only rewrite small reference tables + meta — NOT transactions
    _retryWrite(
      async () => { const _r = await _persistRefDataToDexie(this._cache); if (!_r) throw new Error('ref-data persist returned false'); },  // A-F2: surface swallowed failure
      'Commit (ref data)'
    ).catch(err => {
      console.error('[DB] Background commit failed after retries:', err);
    });
    if (typeof Sync !== 'undefined') Sync.scheduleSync();
    return true;
  },

  // F2-CRIT03 (Gemini FINAL CRIT-03): flipping _synced on a pushed batch used
  // DB.save() — a clear+rewrite of ALL 12 tables (10k+ ledger rows) on EVERY
  // successful push. Verified live: 12 table clears for one flag flip. This is
  // the targeted replacement: update only the pushed rows, in cache + Dexie.
  // Returns true only when the rows are durably persisted; on false the batch
  // stays unsynced and re-pushes next cycle (server dedup makes replay safe).
  async markTransactionsSynced(ids) {
    if (!this._cache) return false;
    const idSet = ids instanceof Set ? ids : new Set(ids);
    const rows = (this._cache.transactions || []).filter(t => t && idSet.has(t.id));
    if (rows.length === 0) return true;
    const _now = Date.now();
    rows.forEach(t => { t._synced = true; t._syncedAt = _now; });  // Wave I: stamp _syncedAt for the TTL tombstone prune
    _pendingWrites++;
    try {
      const ok = await _retryWrite(
        () => bobDB.transactions.bulkPut(rows),
        `Mark ${rows.length} transactions synced`
      );
      if (!ok) rows.forEach(t => { t._synced = false; delete t._syncedAt; });  // cache must not claim what disk didn't confirm
      return ok;
    } finally {
      _pendingWrites--;
    }
  },

  // Wave I (Tier 2 / I-4): prune synced tombstones older than the TTL so type:'deleted' rows do not
  // accumulate forever (they slow every O(N) cache/ledger loop). Prune by _syncedAt (when it was
  // confirmed synced), falling back to createdAt. SharePoint remains the persistent cloud record, so
  // a local prune NEVER loses a delete. Best-effort, fire-and-forget on launch.
  async pruneSyncedTombstones(ttlDays) {
    if (!this._cache) return 0;
    const ttl = (ttlDays || 30) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttl;
    const stamp = t => (typeof t._syncedAt === 'number' ? t._syncedAt : (t.createdAt ? new Date(t.createdAt).getTime() : 0));
    const staleIds = (this._cache.transactions || [])
      .filter(t => t && t.type === 'deleted' && t._synced && stamp(t) < cutoff)
      .map(t => t.id);
    if (!staleIds.length) return 0;
    const idSet = new Set(staleIds);
    this._cache.transactions = this._cache.transactions.filter(t => !idSet.has(t.id));
    _pendingWrites++;
    try { await _retryWrite(() => bobDB.transactions.bulkDelete(staleIds), `Prune ${staleIds.length} synced tombstones`); }
    catch (e) { console.error('[DB] Tombstone prune failed:', e); }
    finally { _pendingWrites--; }
    console.log('[DB] Pruned ' + staleIds.length + ' synced tombstone(s) older than ' + (ttlDays || 30) + 'd');
    return staleIds.length;
  },

  // ─── Append-Only Record Methods (Hybrid Option C) ─────────────────

  /**
   * Adds a single transaction to cache AND Dexie.
   * Call this INSTEAD of pushing to cache.transactions manually + commit().
   * Usage: DB.addTransaction(txn); DB.commit();
   * Or:    DB.addTransaction(txn); // commit() will be called separately
   *
   * IMPORTANT: This updates the cache synchronously and fires
   * the Dexie insert in the background. commit() only needs to
   * persist the ref tables and meta — transactions are already saved.
   */
  addTransaction(txn) {
    if (!this._cache) return false;
    // MFL-023: dedupe by id — don't create a second cache entry for an existing transaction
    if (txn && this._cache.transactions.some(t => t.id === txn.id)) return true;
    this._cache.transactions.push(txn);
    _appendRecord('transactions', txn).catch(err => {
      console.error('[DB] Background transaction append failed:', err);
    });
    // Fix #9: Incremental cache update
    if (typeof Stock !== 'undefined' && Stock._applyDelta) {
      Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
    }
    return true;
  },

  /**
   * Adds a deleted transaction record.
   */
  addDeletedTransaction(txn) {
    if (!this._cache) return false;
    if (!this._cache.deletedTransactions) this._cache.deletedTransactions = [];
    this._cache.deletedTransactions.push(txn);
    _appendRecord('deletedTransactions', txn).catch(err => {
      console.error('[DB] Background deletedTransaction append failed:', err);
    });
    return true;
  },

  /**
   * Adds a transfer record.
   */
  addTransfer(transfer) {
    if (!this._cache) return false;
    if (!this._cache.transfers) this._cache.transfers = [];
    this._cache.transfers.push(transfer);
    _appendRecord('transfers', transfer).catch(err => {
      console.error('[DB] Background transfer append failed:', err);
    });
    return true;
  },

  /**
   * Updates an existing transfer in Dexie (already mutated in cache).
   * Use this when modifying a transfer's status, items, etc.
   * Does NOT push to cache (the object is already there via reference).
   */
  updateTransfer(transfer) {
    if (!this._cache) return false;
    _appendRecord('transfers', transfer).catch(err => {
      console.error('[DB] Background transfer update failed:', err);
    });
    return true;
  },

  /**
   * Bulk-adds multiple transactions (used by sync merge).
   */
  addTransactions(txns) {
    if (!this._cache || !txns || txns.length === 0) return false;
    const _seen = new Set(this._cache.transactions.map(t => t.id));
    txns = txns.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });  // MFL-023/DA-1: dedupe vs cache AND within the batch (running set)
    if (txns.length === 0) return true;
    this._cache.transactions.push(...txns);
    _appendRecords('transactions', txns).catch(err => {
      console.error('[DB] Background bulk transaction append failed:', err);
    });
    // Fix #9: Incremental cache update for each transaction
    if (typeof Stock !== 'undefined' && Stock._applyDelta) {
      for (const txn of txns) {
        Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
      }
    }
    return true;
  },

  /**
   * Removes a transaction by ID from cache AND Dexie.
   * Tier 2 Fix #6: Also pushes a tombstone to SharePoint so other devices
   * learn about the deletion on their next sync pull.
   *
   * @param {string} txnId - The transaction ID to remove
   * @param {object} options - Optional: { skipTombstone: true } to suppress sync
   *   (used when applying a remote tombstone — don't re-push what we just received)
   */
  // Wave I (Tier 2): build the durable tombstone row written ATOMICALLY with a delete.
  // type:'deleted' + targetTransactionId is what push()/_egressOk forward and pull() applies;
  // DeletedBy/DeletedAt/DeleteReason carry the deletion audit trail to other devices. crypto id
  // suffix (not Math.random — GPT-18). The tombstone is a normal unsynced row drained by push().
  _makeTombstone(original, txnId, options) {
    const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')
      : String(_pendingWrites) + 'x';
    const actor = (typeof Auth !== 'undefined' && Auth.user()) ? (Auth.user().name || Auth.user().username || '') : '';
    return {
      id: 'del_' + Date.now() + '_' + rnd,
      date: new Date().toISOString().split('T')[0],
      storeId: (original && original.storeId) || '',
      productId: (original && original.productId) || '',
      type: 'deleted',
      qty: 0,
      staffName: actor,
      reason: 'Transaction deleted: ' + txnId,
      deviceId: (typeof Sync !== 'undefined' && Sync._deviceId) ? Sync._deviceId : '',
      transferId: '',
      targetTransactionId: txnId,
      deletedBy: (options && options.deletedBy) || actor,
      deletedAt: (options && options.deletedAt) || new Date().toISOString(),
      deleteReason: (options && options.deleteReason) || '',
      createdAt: new Date().toISOString(),
      _synced: false
    };
  },

  removeTransaction(txnId, options) {
    if (!this._cache) return false;
    // Grab the original transaction before removing (for tombstone context)
    const original = this._cache.transactions.find(t => t.id === txnId);
    if (!original) return true;
    this._cache.transactions = this._cache.transactions.filter(t => t.id !== txnId);
    // Fix #9: Reverse delta to keep cache in sync
    if (typeof Stock !== 'undefined' && Stock._applyDelta) {
      // Reverse the direction: if original was 'in', we need to subtract (apply as 'out' equivalent)
      const reversedType = original.type === 'in' ? 'out' :
                           original.type === 'return_in' ? 'out' :
                           original.type === 'transfer_in' ? 'transfer_out' :
                           original.type === 'out' ? 'in' :
                           original.type === 'transfer_out' ? 'transfer_in' :
                           original.type === 'wastage' ? 'in' :
                           original.type === 'move_out' ? 'in' :  // MFL-006: reverse out -> add back
                           original.type === 'adjustment_in' ? 'adjustment_out' :
                           original.type === 'adjustment_out' ? 'adjustment_in' : original.type;
      Stock._applyDelta(original.storeId, original.productId, reversedType, original.qty);
    }
    // Wave I (Tier 2 / I-6): write the tombstone ATOMICALLY with the delete (one Dexie txn), then
    // let normal push() drain it. skipTombstone = applying a remote tombstone, so write neither.
    const ts = (options && options.skipTombstone) ? null : this._makeTombstone(original, txnId, options);
    if (ts) this._cache.transactions.push(ts);
    _retryWrite(
      () => bobDB.transaction('rw', bobDB.transactions, async () => {
        await bobDB.transactions.delete(txnId);
        if (ts) await bobDB.transactions.put(ts);
      }),
      `Delete transaction ${txnId}${ts ? ' + tombstone' : ''}`
    ).then(ok => {
      // Wave I follow-up (GPT + Gemini code re-audit): roll the cache back to match disk if the
      // background delete+tombstone write fails — restore the original, drop the optimistic
      // tombstone, rebuild stock. Without this, the non-durable path left a cache/disk tear
      // (cache: deleted+tombstoned; disk: unchanged). Brings removeTransaction to parity with
      // removeTransactionDurable. (_retryWrite returns false on exhausted retries, doesn't throw.)
      if (!ok && this._cache) {
        if (!this._cache.transactions.some(t => t.id === original.id)) this._cache.transactions.push(original);
        if (ts) this._cache.transactions = this._cache.transactions.filter(t => t !== ts);
        if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
        console.error('[DB] Background delete+tombstone failed — cache rolled back to match disk.');
      }
    }).catch(err => {
      console.error('[DB] Background delete+tombstone error:', err);
    });
    if (ts && typeof Sync !== 'undefined' && Sync.scheduleSync) Sync.scheduleSync();
    return true;
  },

  /**
   * ATOMIC BATCH WRITE (Tier 2 Fix #12)
   * Writes multiple transactions + a transfer update in a single Dexie transaction.
   * If any write fails, ALL writes are rolled back — no partial state.
   *
   * Used by Transfer.receive() and Transfer.resolveFlag() where multiple
   * addTransaction calls + an updateTransfer must succeed or fail together.
   *
   * @param {Array} transactions - Array of transaction objects to insert
   * @param {object|null} transfer - Transfer object to update (optional)
   * @returns {boolean} true (synchronous — actual write is async but atomic)
   */
  atomicTransferWrite(transactions, transfer, transferSnapshot) {
    if (!this._cache) return false;

    // T2-06: Use pre-mutation snapshot passed by caller for rollback on failure.
    // Caller must snapshot the transfer BEFORE mutating it — db.js cannot snapshot here
    // because the transfer is already mutated by the time this method is called.

    // Update cache synchronously (optimistic — matches existing pattern)
    if (transactions && transactions.length > 0) {
      const _seen = new Set(this._cache.transactions.map(t => t.id));
      transactions = transactions.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });  // DA-1/CONV-2: dedupe vs cache + within batch
      this._cache.transactions.push(...transactions);
      // Fix #9: Incremental cache update for atomic batch
      if (typeof Stock !== 'undefined' && Stock._applyDelta) {
        for (const txn of transactions) {
          Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
        }
      }
    }

    // Atomic Dexie write — all or nothing, with retry (GPT review)
    _pendingWrites++;
    const tables = [bobDB.transactions];
    if (transfer) tables.push(bobDB.transfers);

    _retryWrite(
      () => bobDB.transaction('rw', ...tables, async () => {
        if (transactions && transactions.length > 0) {
          await bobDB.transactions.bulkPut(transactions);
        }
        if (transfer) {
          await bobDB.transfers.put(transfer);
        }
      }),
      'Atomic transfer write'
    ).then(ok => {
      if (!ok) {
        // All retries exhausted — roll back cache
        console.error('[DB] Atomic transfer write failed after retries — rolling back cache.');
        if (transactions && transactions.length > 0) {
          const ids = new Set(transactions.map(t => t.id));
          this._cache.transactions = this._cache.transactions.filter(t => !ids.has(t.id));
          // Fix #9: Rebuild cache from scratch after rollback to avoid drift
          if (typeof Stock !== 'undefined' && Stock._buildCache) {
            Stock._buildCache();
          }
        }
        // T2-06: Restore transfer object to pre-mutation state on failure
        if (transfer && transferSnapshot) {
          Object.keys(transfer).forEach(k => delete transfer[k]);
          Object.assign(transfer, transferSnapshot);
          console.warn('[DB] Transfer object restored to pre-write snapshot.');
        }
      }
    }).finally(() => {
      _pendingWrites--;
    });

    return true;
  },

  // ─── W1a — DURABLE (await-able) WRITE API (MFL-002 fix) ──────────────────
  // These are the Promise-returning counterparts of the fire-and-forget methods
  // above. A caller that `await`s these gets `true` ONLY after the Dexie write
  // is confirmed durable, or `false` after retries are exhausted — in which case
  // the optimistic cache mutation is rolled back here. Callers must show success
  // / navigate / clear the form / send email ONLY when the result is `true`, and
  // surface a failure to the user when it is `false`.
  // Additive: the legacy methods above are untouched; nothing calls these yet.

  async addTransactionDurable(txn) {
    if (!this._cache) return false;
    if (txn && this._cache.transactions.some(t => t.id === txn.id)) return true; // MFL-023 dedupe
    this._cache.transactions.push(txn);
    if (typeof Stock !== 'undefined' && Stock._applyDelta) {
      Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
    }
    const ok = await _appendRecord('transactions', txn);
    if (!ok) {
      // Roll back the optimistic cache mutation (remove the exact object we pushed)
      this._cache.transactions = this._cache.transactions.filter(t => t !== txn);
      if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
    }
    return ok;
  },

  async addTransactionsDurable(txns) {
    if (!this._cache || !txns || txns.length === 0) return false;
    const _seen = new Set(this._cache.transactions.map(t => t.id));
    txns = txns.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });  // MFL-023/DA-1: dedupe vs cache AND within the batch (running set)
    if (txns.length === 0) return true;
    this._cache.transactions.push(...txns);
    if (typeof Stock !== 'undefined' && Stock._applyDelta) {
      for (const txn of txns) Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
    }
    const ok = await _appendRecords('transactions', txns);
    if (!ok) {
      const added = new Set(txns);
      this._cache.transactions = this._cache.transactions.filter(t => !added.has(t));
      if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
    }
    return ok;
  },

  async commitDurable() {
    if (!this._cache) return false;
    this._sanitizeNames();
    const prevV = this._cache._v || 0;
    this._cache._v = prevV + 1;
    // NOTE: _persistRefDataToDexie swallows its own error and returns false, so we
    // must convert a false return into a throw — otherwise _retryWrite (which only
    // catches throws) would treat a failed persist as success.
    const ok = await _retryWrite(
      async () => { const r = await _persistRefDataToDexie(this._cache); if (!r) throw new Error('ref-data persist returned false'); },
      'Commit (ref data, durable)'
    );
    if (ok) {
      if (typeof Sync !== 'undefined') Sync.scheduleSync();
    } else {
      this._cache._v = prevV; // restore version counter on failure
    }
    return ok;
  },

  async addTransferDurable(transfer) {
    if (!this._cache) return false;
    if (!this._cache.transfers) this._cache.transfers = [];
    this._cache.transfers.push(transfer);
    const ok = await _appendRecord('transfers', transfer);
    if (!ok) this._cache.transfers = this._cache.transfers.filter(t => t !== transfer);
    return ok;
  },

  async updateTransferDurable(transfer, transferSnapshot) {
    if (!this._cache) return false;
    const ok = await _appendRecord('transfers', transfer);
    if (!ok && transferSnapshot) {
      // Restore the transfer object to its pre-mutation state
      Object.keys(transfer).forEach(k => delete transfer[k]);
      Object.assign(transfer, transferSnapshot);
    }
    return ok;
  },

  async removeTransactionDurable(txnId, options) {
    if (!this._cache) return false;
    const original = this._cache.transactions.find(t => t.id === txnId);
    if (!original) return true; // nothing to remove — idempotent success
    // Wave I (Tier 2 / I-6): build the tombstone, then delete + put it in ONE Dexie transaction —
    // atomic (both or neither). skipTombstone = applying a remote tombstone → write neither.
    const ts = (options && options.skipTombstone) ? null : this._makeTombstone(original, txnId, options);
    this._cache.transactions = this._cache.transactions.filter(t => t.id !== txnId);
    if (ts) this._cache.transactions.push(ts);
    // Rebuild from the ledger (avoids the move_out reverse-delta hazard, MFL-006)
    if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
    _pendingWrites++;
    let ok = false;
    try {
      ok = await _retryWrite(
        () => bobDB.transaction('rw', bobDB.transactions, async () => {
          await bobDB.transactions.delete(txnId);
          if (ts) await bobDB.transactions.put(ts);
        }),
        `Delete transaction ${txnId} + tombstone (durable)`
      );
    } finally { _pendingWrites--; }
    if (!ok) {
      // Roll back BOTH: restore the original, drop the optimistic tombstone
      this._cache.transactions.push(original);
      if (ts) this._cache.transactions = this._cache.transactions.filter(t => t !== ts);  // durable: drop optimistic tombstone
      if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
      return false;
    }
    // Wave I: the tombstone is now a normal unsynced row — push() drains it (egress whitelists it,
    // strict processedCount ack + retry inherited). No separate pushTombstone path.
    if (ts && typeof Sync !== 'undefined' && Sync.scheduleSync) Sync.scheduleSync();
    return true;
  },

  async atomicTransferWriteDurable(transactions, transfer, transferSnapshot) {
    if (!this._cache) return false;
    if (transactions && transactions.length > 0) {
      const _seen = new Set(this._cache.transactions.map(t => t.id));
      transactions = transactions.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });  // DA-1/CONV-2: dedupe vs cache + within batch
      this._cache.transactions.push(...transactions);
      if (typeof Stock !== 'undefined' && Stock._applyDelta) {
        for (const txn of transactions) Stock._applyDelta(txn.storeId, txn.productId, txn.type, txn.qty);
      }
    }
    _pendingWrites++;
    const tables = [bobDB.transactions];
    if (transfer) tables.push(bobDB.transfers);
    let ok = false;
    try {
      ok = await _retryWrite(
        () => bobDB.transaction('rw', ...tables, async () => {
          if (transactions && transactions.length > 0) await bobDB.transactions.bulkPut(transactions);
          if (transfer) await bobDB.transfers.put(transfer);
        }),
        'Atomic transfer write (durable)'
      );
    } finally { _pendingWrites--; }
    if (!ok) {
      if (transactions && transactions.length > 0) {
        const added = new Set(transactions);
        this._cache.transactions = this._cache.transactions.filter(t => !added.has(t));
        if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
      }
      if (transfer && transferSnapshot) {
        Object.keys(transfer).forEach(k => delete transfer[k]);
        Object.assign(transfer, transferSnapshot);
      }
    }
    return ok;
  },

  async atomicDeliveryWrite(txns) {
    // A-F1: a delivery is ALL-OR-NOTHING across transactions + deliveries + costHistory + products
    if (!this._cache) return false;
    if (txns && txns.length > 0) {
      const _seen = new Set(this._cache.transactions.map(t => t.id));
      txns = txns.filter(t => { if (!t || _seen.has(t.id)) return false; _seen.add(t.id); return true; });  // DA-1/CONV-2: dedupe vs cache + within batch
      this._cache.transactions.push(...txns);
      if (typeof Stock !== 'undefined' && Stock._applyDelta) {
        for (const t of txns) Stock._applyDelta(t.storeId, t.productId, t.type, t.qty);
      }
    }
    _pendingWrites++;
    let ok = false;
    try {
      ok = await _retryWrite(() => bobDB.transaction('rw',
        bobDB.transactions, bobDB.deliveries, bobDB.costHistory, bobDB.products, bobDB.meta,
        async () => {
          if (txns && txns.length > 0) await bobDB.transactions.bulkPut(txns);
          await bobDB.deliveries.clear(); if (this._cache.deliveries && this._cache.deliveries.length) await bobDB.deliveries.bulkPut(this._cache.deliveries);
          await bobDB.costHistory.clear(); if (this._cache.costHistory && this._cache.costHistory.length) await bobDB.costHistory.bulkPut(this._cache.costHistory);
          await bobDB.products.clear(); if (this._cache.products && this._cache.products.length) await bobDB.products.bulkPut(this._cache.products);
        }), 'Atomic delivery write');
    } finally { _pendingWrites--; }
    if (!ok) {
      if (txns && txns.length > 0) {
        const set = new Set(txns);
        this._cache.transactions = this._cache.transactions.filter(t => !set.has(t));
      }
      try { await this.refresh(); } catch(e) {}  // G-F1: revert ref-table cache mutations too (symmetric rollback)
    }
    return ok;
  },

  /**
   * Wipes the Dexie database and reloads.
   * Only called from settings (rare).
   */
  reset() {
    bobDB.delete().then(() => {
      this._cache = null;
      localStorage.removeItem(this.KEY);
      localStorage.removeItem(this.KEY + '_migrated');
      location.reload();
    });
  },

  /**
   * ASYNC. Refreshes the in-memory cache from Dexie.
   * Called after sync pull merges remote data.
   */
  async refresh() {
    this._cache = await _loadFromDexie();
    this._sanitizeNames();  // GPT-003: sanitize on load (import/migrate/restore bypass commit-time sanitize)
    // Fix #9: Rebuild cache after refresh from Dexie
    if (typeof Stock !== 'undefined' && Stock._buildCache) {
      Stock._buildCache();
    }
    return this._cache;
  }
};

// ─── beforeunload Guard (Gemini recommendation) ─────────────────────────────
// Warns the user if they try to close the tab while a Dexie write is pending.
// Prevents the "Power Failure" data loss scenario.

window.addEventListener('beforeunload', (e) => {
  const syncing = typeof Sync !== 'undefined' && Sync.isSyncing && Sync.isSyncing();
  if (_pendingWrites > 0 || syncing) {
    e.preventDefault();
    e.returnValue = 'Data is still saving. Are you sure you want to leave?';
    return e.returnValue;
  }
});

// ─── Migration & Initialization ──────────────────────────────────────────────

/**
 * One-time migration: reads old localStorage blob → imports into Dexie.
 * Archives the old key as a safety net (doesn't delete).
 * Uses _persistAllToDexie (full write) since this is a one-time bulk op.
 */
async function _migrateFromLocalStorage() {
  const raw = localStorage.getItem(DB.KEY);
  if (!raw) return false;

  let old;
  try {
    old = JSON.parse(raw);
  } catch (err) {
    // Corrupt source blob: unreadable either way — fall through to the seed path.
    console.error('[DB] Migration source unreadable (corrupt JSON):', err);
    return false;
  }

  console.log('[DB] Migrating from localStorage → IndexedDB...');
  // Wave G (blind audit CaC-H4): _persistAllToDexie swallows its own errors and returns false,
  // so the old `await` here could "succeed", archive + delete the live key, and boot an EMPTY app
  // after a failed persist (e.g. quota on a big restore). A failed persist must THROW so initDB's
  // disaster-recovery catch serves the still-intact localStorage data in recovery mode instead.
  const ok = await _persistAllToDexie(old);
  if (!ok) throw new Error('Migration persist to IndexedDB failed — localStorage source kept intact');

  // Archive old data (safety net — don't delete). Only reached after a VERIFIED persist.
  localStorage.setItem(DB.KEY + '_migrated', raw);
  localStorage.removeItem(DB.KEY);

  console.log('[DB] Migration complete.');
  return true;
}

/**
 * Loads SEED data into Dexie (first run, no existing data).
 * SEED data is defined in index.html and passed here.
 * Uses _persistAllToDexie (full write) since this is a one-time bulk op.
 */
async function _loadSeedData(seed) {
  console.log('[DB] Loading SEED data into IndexedDB...');
  // F1-C01: seed products ship without `active` — default missing flags to true
  // BEFORE first persist so a fresh install never boots with an empty catalogue.
  // Copies first (never mutate the SEED constant), then the shared normalizer.
  const _act = arr => _defaultActiveTrue((arr || []).map(o => (o && typeof o === 'object') ? Object.assign({}, o) : o));
  const data = {
    productTypes: seed.productTypes || [],
    categories: seed.categories || [],
    products: _act(seed.products),
    stores: _act(seed.stores),
    users: seed.users || [],
    thresholds: seed.thresholds || [],
    transactions: [],
    deletedTransactions: [],
    transfers: [],
    costHistory: [],
    stockTakes: [],
    deliveries: [],
    stockTakePin: { pin: null, expiresAt: null },
    // Fix #8: stockThresholds removed — thresholds unified in d.thresholds
    _v: 1,
  };
  // Wave G (CaC-H4 sibling sweep): same silent-false trap as migration — a failed seed persist
  // must throw so boot shows the fatal contact-admin screen, not a silently empty app.
  const ok = await _persistAllToDexie(data);
  if (!ok) throw new Error('SEED persist to IndexedDB failed');
  console.log('[DB] SEED data loaded.');
}

/**
 * ASYNC. Called once on app startup, BEFORE any UI renders.
 * Handles migration → seed → cache load in sequence.
 *
 * Usage in index.html:
 *   await initDB(SEED);
 *   // now DB.get() works synchronously everywhere
 *   App.init();
 */
async function initDB(seedData) {
  try {
    // Step 1: Migrate from old localStorage if present
    const migrated = await _migrateFromLocalStorage();

    // Step 2: If no migration, check if Dexie is empty → load SEED
    if (!migrated) {
      const count = await bobDB.products.count();
      if (count === 0 && seedData) {
        await _loadSeedData(seedData);
      }
    }

    // Step 3: Load everything into the synchronous cache
    DB._cache = await _loadFromDexie();
    DB._sanitizeNames();  // GPT-003: sanitize on initial load (covers localStorage migration + backup restore before first render)
    DB.pruneSyncedTombstones().catch(() => {});  // Wave I (Tier 2 / I-4): best-effort TTL prune of old synced tombstones on launch

    console.log(`[DB] Ready. ${DB._cache.products.length} products, ${DB._cache.transactions.length} transactions, v${DB._cache._v}`);
    return true;
  } catch (err) {
    console.error('[DB] Init failed:', err);

    // Fallback: try to read from localStorage directly (disaster recovery)
    const raw = localStorage.getItem(DB.KEY) || localStorage.getItem(DB.KEY + '_migrated');
    if (raw) {
      try {
        DB._cache = JSON.parse(raw);
        DB._recoveryMode = true;  // M-01: this archive is frozen at migration time and may be weeks stale
        console.warn('[DB] Fell back to localStorage data (RECOVERY MODE — possibly stale).');
        // Never silently present stale stock as current — surface the blocking contact-admin warning.
        try { if (typeof UI !== 'undefined' && UI.fatalSaveError) UI.fatalSaveError('Local database could not open. The app is showing the LAST LOCAL BACKUP, which may be OUT OF DATE — do not rely on stock numbers. Please contact your administrator.'); } catch(e) {}
        return true;
      } catch (e) {
        console.error('[DB] Fallback also failed:', e);
      }
    }
    return false;
  }
}
