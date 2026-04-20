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
          { key: 'stockThresholds', value: d.stockThresholds || {} },
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
          { key: 'stockThresholds', value: d.stockThresholds || {} },
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
  const metaThresholds = await bobDB.meta.get('stockThresholds');

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
    stockThresholds: metaThresholds ? metaThresholds.value : {},
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
  save(d) {
    this._cache = d;
    _retryWrite(
      () => _persistAllToDexie(d),
      'Full save'
    ).catch(err => {
      console.error('[DB] Background full-save failed after retries:', err);
    });
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
    this._cache._v = (this._cache._v || 0) + 1;
    // Only rewrite small reference tables + meta — NOT transactions
    _retryWrite(
      () => _persistRefDataToDexie(this._cache),
      'Commit (ref data)'
    ).catch(err => {
      console.error('[DB] Background commit failed after retries:', err);
    });
    if (typeof Sync !== 'undefined') Sync.scheduleSync();
    return true;
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
    this._cache.transactions.push(txn);
    _appendRecord('transactions', txn).catch(err => {
      console.error('[DB] Background transaction append failed:', err);
    });
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
    this._cache.transactions.push(...txns);
    _appendRecords('transactions', txns).catch(err => {
      console.error('[DB] Background bulk transaction append failed:', err);
    });
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
  removeTransaction(txnId, options) {
    if (!this._cache) return false;
    // Grab the original transaction before removing (for tombstone context)
    const original = this._cache.transactions.find(t => t.id === txnId);
    this._cache.transactions = this._cache.transactions.filter(t => t.id !== txnId);
    // GPT review: apply retry/warning to delete operations (not just writes)
    _retryWrite(
      () => bobDB.transactions.delete(txnId),
      `Delete transaction ${txnId}`
    ).catch(err => {
      console.error('[DB] Background transaction delete failed after retries:', err);
    });
    // Push tombstone to SharePoint (unless this IS a remote tombstone being applied)
    if (!(options && options.skipTombstone) && typeof Sync !== 'undefined' && Sync.pushTombstone) {
      Sync.pushTombstone(txnId, original || {});
    }
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
  atomicTransferWrite(transactions, transfer) {
    if (!this._cache) return false;

    // Update cache synchronously (optimistic — matches existing pattern)
    if (transactions && transactions.length > 0) {
      this._cache.transactions.push(...transactions);
    }
    // Transfer is already mutated in cache by reference — just need to persist

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
        }
      }
    }).finally(() => {
      _pendingWrites--;
    });

    return true;
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

  try {
    const old = JSON.parse(raw);
    console.log('[DB] Migrating from localStorage → IndexedDB...');
    await _persistAllToDexie(old);

    // Archive old data (safety net — don't delete)
    localStorage.setItem(DB.KEY + '_migrated', raw);
    localStorage.removeItem(DB.KEY);

    console.log('[DB] Migration complete.');
    return true;
  } catch (err) {
    console.error('[DB] Migration failed — falling back to localStorage:', err);
    return false;
  }
}

/**
 * Loads SEED data into Dexie (first run, no existing data).
 * SEED data is defined in index.html and passed here.
 * Uses _persistAllToDexie (full write) since this is a one-time bulk op.
 */
async function _loadSeedData(seed) {
  console.log('[DB] Loading SEED data into IndexedDB...');
  const data = {
    productTypes: seed.productTypes || [],
    categories: seed.categories || [],
    products: seed.products || [],
    stores: seed.stores || [],
    users: seed.users || [],
    thresholds: seed.thresholds || [],
    transactions: [],
    deletedTransactions: [],
    transfers: [],
    costHistory: [],
    stockTakes: [],
    deliveries: [],
    stockTakePin: { pin: null, expiresAt: null },
    stockThresholds: {},
    _v: 1,
  };
  await _persistAllToDexie(data);
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

    console.log(`[DB] Ready. ${DB._cache.products.length} products, ${DB._cache.transactions.length} transactions, v${DB._cache._v}`);
    return true;
  } catch (err) {
    console.error('[DB] Init failed:', err);

    // Fallback: try to read from localStorage directly (disaster recovery)
    const raw = localStorage.getItem(DB.KEY) || localStorage.getItem(DB.KEY + '_migrated');
    if (raw) {
      try {
        DB._cache = JSON.parse(raw);
        console.warn('[DB] Fell back to localStorage data.');
        return true;
      } catch (e) {
        console.error('[DB] Fallback also failed:', e);
      }
    }
    return false;
  }
}
