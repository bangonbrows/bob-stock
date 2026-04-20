/**
 * BOB Stock App — Sync Module (Phase 3, v2 — Transaction Ledger)
 * Fixed to align with Logic App v2 field mapping.
 *
 * Flow:
 *   DB.commit() → Sync.scheduleSync() → debounce 800ms → push()
 *   init() → _fetchRemoteConfig() → check pending → start 30s poll → pull()
 *
 * Push: POST {data:{transactions:[...]}} to push-v2 Logic App
 *       → Logic App For Each → Create Item in StockTransactions list
 *       → Each transaction mapped from local camelCase to SharePoint PascalCase
 *
 * Pull: POST {since: lastSyncTs} to pull-v2 Logic App
 *       → Returns {items:[...], serverTimestamp, status}
 *       → Items are flat SharePoint records, mapped back to local camelCase
 *
 * Config: Fetched from AppConfig SharePoint list via config Logic App
 *
 * FIELD MAPPING (local ↔ SharePoint):
 *   id          ↔ TransactionId
 *   date        ↔ Date
 *   storeId     ↔ StoreId
 *   productId   ↔ ProductId
 *   type        ↔ Type
 *   qty         ↔ Qty
 *   staffName   ↔ StaffName
 *   reason      ↔ Reason
 *   deviceId    ↔ DeviceId
 *   createdAt   → Timestamp (converted to epoch ms)
 *   transferId  ↔ TransferId
 */

const Sync = {
  // ─── State ───────────────────────────────────────────────────────────
  _pushUrl: null,
  _pullUrl: null,
  _configUrl: null,
  _pushLock: false,
  _retryCount: 0,
  _maxRetries: 3,
  _debounceTimer: null,
  _pollInterval: null,
  _lastSyncAt: 0,
  _deviceId: null,
  _statusEl: null,
  _hideTimer: null,
  STALE_THRESHOLD: 12 * 60 * 60 * 1000,  // 12 hours
  POLL_INTERVAL: 30000,                    // 30 seconds
  DEBOUNCE_MS: 800,
  // The config endpoint URL — the ONLY hardcoded URL in the app.
  // All other URLs (push, pull) are fetched from AppConfig via this endpoint.
  CONFIG_URL: '%%CONFIG_URL%%',

  // ─── Config Management ───────────────────────────────────────────────

  /**
   * Loads sync config from localStorage cache (push/pull URLs).
   * These URLs are the SAS-secured Logic App trigger endpoints.
   */
  _loadConfig() {
    try {
      const raw = localStorage.getItem('bob_sync_config');
      if (!raw) return false;
      const config = JSON.parse(raw);
      this._pushUrl = config.pushUrl || null;
      this._pullUrl = config.pullUrl || null;
      this._configUrl = this.CONFIG_URL;
      this._deviceId = localStorage.getItem('bob_device_id') || this._generateDeviceId();
      this._lastSyncAt = parseInt(localStorage.getItem('bob_last_sync') || '0', 10);
      return !!(this._pushUrl && this._pullUrl);
    } catch (e) {
      console.error('[Sync] Config load failed:', e);
      return false;
    }
  },

  /**
   * Fetches sync config from the remote AppConfig endpoint.
   * Looks for a 'sync_config' item and extracts pushUrl/pullUrl.
   * Caches the result in localStorage for offline resilience.
   * Returns true if config was successfully loaded.
   */
  async _fetchRemoteConfig() {
    if (!this.CONFIG_URL || this.CONFIG_URL.includes('%%')) {
      console.warn('[Sync] No config endpoint URL configured.');
      return false;
    }
    try {
      const resp = await fetch(this.CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        console.warn('[Sync] Config fetch failed:', resp.status);
        return false;
      }
      const data = await resp.json();
      if (!data.items || !Array.isArray(data.items)) return false;

      const syncItem = data.items.find(i => i.ConfigType === 'sync_config');
      if (!syncItem || !syncItem.ConfigData) {
        console.warn('[Sync] No sync_config item found in AppConfig.');
        return false;
      }

      const urls = typeof syncItem.ConfigData === 'string'
        ? JSON.parse(syncItem.ConfigData)
        : syncItem.ConfigData;

      if (urls.pushUrl && urls.pullUrl) {
        this._pushUrl = urls.pushUrl;
        this._pullUrl = urls.pullUrl;
        this._configUrl = this.CONFIG_URL;
        // Cache in localStorage for offline use
        localStorage.setItem('bob_sync_config', JSON.stringify({
          pushUrl: urls.pushUrl,
          pullUrl: urls.pullUrl,
          configUrl: this.CONFIG_URL
        }));
        this._deviceId = localStorage.getItem('bob_device_id') || this._generateDeviceId();
        this._lastSyncAt = parseInt(localStorage.getItem('bob_last_sync') || '0', 10);
        console.log('[Sync] Remote config loaded and cached.');
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[Sync] Remote config fetch error:', e);
      return false;
    }
  },

  /**
   * Saves sync config to localStorage.
   * Called from the Cloud Sync settings UI.
   */
  saveConfig(pushUrl, pullUrl, configUrl) {
    const config = { pushUrl, pullUrl };
    if (configUrl) config.configUrl = configUrl;
    localStorage.setItem('bob_sync_config', JSON.stringify(config));
    this._pushUrl = pushUrl;
    this._pullUrl = pullUrl;
    this._configUrl = configUrl || null;
    console.log('[Sync] Config saved.');
  },

  /**
   * Returns current config for the settings UI.
   */
  getConfig() {
    const raw = localStorage.getItem('bob_sync_config');
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Generates a unique device ID for this browser/device.
   */
  _generateDeviceId() {
    const id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('bob_device_id', id);
    return id;
  },

  // ─── Field Mapping ──────────────────────────────────────────────────

  /**
   * Maps a local transaction object to the SharePoint PascalCase format
   * expected by the push-v2 Logic App's Create Item action.
   */
  _toSharePoint(t) {
    // Derive Timestamp as epoch ms from createdAt or current time
    let ts = 0;
    if (typeof t.timestamp === 'number') {
      ts = t.timestamp;
    } else if (t.createdAt) {
      ts = new Date(t.createdAt).getTime();
    } else {
      ts = Date.now();
    }

    return {
      TransactionId: t.id,
      Date: t.date || '',
      StoreId: t.storeId || '',
      ProductId: t.productId || '',
      Type: t.type || '',
      Qty: typeof t.qty === 'number' ? t.qty : parseInt(t.qty, 10) || 0,
      StaffName: t.staffName || '',
      Reason: t.reason || '',
      DeviceId: t.deviceId || this._deviceId || '',
      Timestamp: ts,
      TransferId: t.transferId || ''
    };
  },

  /**
   * Maps a SharePoint list item (PascalCase) back to local camelCase format.
   * Used when pulling remote transactions.
   */
  _fromSharePoint(item) {
    return {
      id: item.TransactionId,
      date: item.Date || '',
      storeId: item.StoreId || '',
      productId: item.ProductId || '',
      type: item.Type || '',
      qty: typeof item.Qty === 'number' ? item.Qty : parseInt(item.Qty, 10) || 0,
      staffName: item.StaffName || '',
      reason: item.Reason || '',
      deviceId: item.DeviceId || '',
      transferId: item.TransferId || '',
      createdAt: item.Timestamp ? new Date(item.Timestamp).toISOString() : new Date().toISOString(),
      _synced: true
    };
  },

  // ─── Status UI ───────────────────────────────────────────────────────

  /**
   * Shows a status message in the sync status bar.
   */
  _showStatus(msg, type = 'info', duration = 3000) {
    if (!this._statusEl) {
      this._statusEl = document.getElementById('sync-status');
    }
    if (!this._statusEl) return;

    this._statusEl.textContent = msg;
    this._statusEl.className = 'sync-status sync-' + type;
    this._statusEl.style.display = 'block';

    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (duration > 0) {
      this._hideTimer = setTimeout(() => {
        this._statusEl.style.display = 'none';
      }, duration);
    }
  },

  // ─── Push (Local → SharePoint) ───────────────────────────────────────

  /**
   * Pushes unsynced local transactions to SharePoint via push-v2 Logic App.
   *
   * The push-v2 Logic App expects:
   *   POST { data: { transactions: [ {TransactionId, Date, StoreId, ...}, ... ] } }
   *
   * Its For Each iterates triggerBody()?['data']?['transactions'] and creates
   * one SharePoint list item per transaction.
   *
   * Only transactions without _synced=true are sent. After a successful push,
   * they are marked _synced=true in local storage.
   */
  async push() {
    if (this._pushLock) {
      console.log('[Sync] Push already in progress, skipping.');
      return;
    }
    if (!this._pushUrl) {
      console.warn('[Sync] No push URL configured.');
      return;
    }

    this._pushLock = true;
    this._showStatus('Syncing...', 'info', 0);

    try {
      const data = DB.get();  // synchronous — returns cached data

      // Filter to only unsynced transactions
      const unsynced = (data.transactions || []).filter(t => !t._synced);

      if (unsynced.length === 0) {
        console.log('[Sync] No unsynced transactions to push.');
        this._showStatus('Synced ✓', 'success');
        localStorage.removeItem('bob_sync_pending');
        return;
      }

      // Map local camelCase to SharePoint PascalCase
      const spTransactions = unsynced.map(t => this._toSharePoint(t));

      // Build payload matching Logic App's expected format:
      // triggerBody()?['data']?['transactions']
      const payload = {
        data: {
          transactions: spTransactions
        }
      };

      console.log(`[Sync] Pushing ${spTransactions.length} unsynced transactions...`);

      const resp = await fetch(this._pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Push failed: ${resp.status} ${resp.statusText}`);
      }

      const result = await resp.json().catch(() => ({}));

      // Mark pushed transactions as synced in local data
      const pushedIds = new Set(unsynced.map(t => t.id));
      data.transactions.forEach(t => {
        if (pushedIds.has(t.id)) {
          t._synced = true;
        }
      });
      DB.save(data);

      // Update last sync timestamp
      this._lastSyncAt = Date.now();
      localStorage.setItem('bob_last_sync', String(this._lastSyncAt));
      localStorage.removeItem('bob_sync_pending');
      this._retryCount = 0;

      this._showStatus('Synced ✓', 'success');
      console.log(`[Sync] Push complete: ${spTransactions.length} transactions synced.`, result);

    } catch (err) {
      console.error('[Sync] Push error:', err);
      this._retryCount++;

      if (this._retryCount <= this._maxRetries) {
        this._showStatus(`Sync failed, retrying (${this._retryCount}/${this._maxRetries})...`, 'warning');
        setTimeout(() => {
          this._pushLock = false;
          this.push();
        }, 2000 * this._retryCount);  // exponential-ish backoff
        return;
      } else {
        this._showStatus('Sync failed — will retry later', 'error');
        localStorage.setItem('bob_sync_pending', 'true');
        this._retryCount = 0;
      }
    } finally {
      this._pushLock = false;
    }
  },

  // ─── Pull (SharePoint → Local) ───────────────────────────────────────

  /**
   * Pulls changes from SharePoint via the pull-v2 Logic App.
   *
   * The pull-v2 Logic App:
   *   - Accepts POST { since: <epoch_ms_number> }
   *   - Returns { items: [...], serverTimestamp: "...", status: "ok" }
   *   - Items are flat SharePoint list records with PascalCase field names
   *   - Filtered by: Timestamp ge <since>
   *
   * New transactions from other devices are mapped to local format and appended.
   */
  async pull() {
    if (!this._pullUrl) return;

    try {
      const resp = await fetch(this._pullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: String(this._lastSyncAt) }),
      });

      if (!resp.ok) {
        console.warn('[Sync] Pull failed:', resp.status);
        return;
      }

      const remote = await resp.json();

      // pull-v2 returns {items: [...], serverTimestamp, status}
      if (!remote || !remote.items || !Array.isArray(remote.items) || remote.items.length === 0) {
        return;  // No changes
      }

      console.log(`[Sync] Pull received ${remote.items.length} items from SharePoint.`);

      const local = DB.get();
      const localIds = new Set((local.transactions || []).map(t => t.id));

      // Map SharePoint items to local format and filter out ones we already have
      const newTransactions = [];
      for (const spItem of remote.items) {
        // Skip items without a TransactionId (shouldn't happen, but safety)
        if (!spItem.TransactionId) continue;

        // Skip items we already have locally
        if (localIds.has(spItem.TransactionId)) continue;

        // Skip items from this device (we already have them)
        if (spItem.DeviceId === this._deviceId) continue;

        const localTxn = this._fromSharePoint(spItem);
        newTransactions.push(localTxn);
      }

      if (newTransactions.length > 0) {
        local.transactions = [...(local.transactions || []), ...newTransactions];
        DB.save(local);
        this._rerender();
        console.log(`[Sync] Merged ${newTransactions.length} new transactions from remote.`);
      }

      // Update last sync timestamp
      this._lastSyncAt = Date.now();
      localStorage.setItem('bob_last_sync', String(this._lastSyncAt));

    } catch (err) {
      console.error('[Sync] Pull error:', err);
    }
  },

  // ─── Merge Logic ────────────────────────────────────────────────────

  /**
   * Simple merge: adds remote transactions we don't have locally.
   * No more full-dataset merge — reference data comes from AppConfig.
   */
  _mergeTransactions(remoteItems, localTransactions) {
    const localIds = new Set(localTransactions.map(t => t.id));
    const newOnes = remoteItems.filter(t => !localIds.has(t.id));
    return [...localTransactions, ...newOnes];
  },

  /**
   * Re-renders the UI after a remote merge.
   * Calls the app's existing render functions.
   */
  _rerender() {
    try {
      if (typeof App !== 'undefined' && App.render) {
        App.render();
      }
    } catch (e) {
      console.warn('[Sync] Re-render failed:', e);
    }
  },

  // ─── Scheduling ──────────────────────────────────────────────────────

  /**
   * Called by DB.commit() — debounces rapid changes, then pushes.
   */
  scheduleSync() {
    localStorage.setItem('bob_sync_pending', 'true');
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      await this.push();
    }, this.DEBOUNCE_MS);
  },

  /**
   * Periodic poll for remote changes.
   */
  async poll() {
    await this.pull();
  },

  // ─── Initialization ─────────────────────────────────────────────────

  /**
   * Initializes the sync system. Called after DB is ready.
   */
  async init() {
    // Try remote config first (self-configuring), fall back to localStorage cache
    let hasConfig = await this._fetchRemoteConfig();
    if (!hasConfig) {
      // Fall back to cached localStorage config (offline resilience)
      hasConfig = this._loadConfig();
    }
    if (!hasConfig) {
      console.log('[Sync] No sync config found. Cloud sync disabled.');
      this._showStatus('\u26A0 Cloud sync unavailable \u2014 config not found. Contact Kunal.', 'error', 0);
      return;
    }

    console.log(`[Sync] Initialized. Device: ${this._deviceId}, Last sync: ${this._lastSyncAt ? new Date(this._lastSyncAt).toISOString() : 'never'}`);

    // Check for pending sync from last session
    if (localStorage.getItem('bob_sync_pending') === 'true') {
      console.log('[Sync] Pending sync found, pushing...');
      await this.push();
    }

    // Check if data is stale
    if (this._lastSyncAt > 0 && (Date.now() - this._lastSyncAt) > this.STALE_THRESHOLD) {
      console.log('[Sync] Data is stale, pulling fresh...');
      await this.pull();
    }

    // Start polling
    this._pollInterval = setInterval(() => this.poll(), this.POLL_INTERVAL);

    // Register for service worker sync events
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('bob-sync-data');
      } catch (e) {
        console.warn('[Sync] Background sync registration failed:', e);
      }
    }
  },

  /**
   * Returns true if a sync push is currently in flight.
   * Used by the beforeunload guard in db.js.
   */
  isSyncing() {
    return this._pushLock;
  },

  /**
   * Stops polling (for cleanup/testing).
   */
  stop() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }
};
