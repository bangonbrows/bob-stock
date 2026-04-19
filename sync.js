/**
 * BOB Stock App — Sync Module (Phase 3)
 * Replaces the old Sync object with Logic App v2 API integration.
 *
 * Flow:
 *   DB.commit() → Sync.scheduleSync() → debounce 800ms → push()
 *   init() → _loadConfig() → check pending → start 30s poll → pull()
 *
 * Push: POST full dataset to push-v2 Logic App → SharePoint StockTakes.Data
 * Pull: POST {since: lastSyncTs} to pull-v2 Logic App → get changed items
 * Config: Fetched from AppConfig SharePoint list via config Logic App
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
  CONFIG_URL: 'https://prod-25.australiaeast.logic.azure.com:443/workflows/0d91c5e735f149898512b1fbf04b33f0/triggers/When_an_HTTP_request_is_received/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2FWhen_an_HTTP_request_is_received%2Frun&sv=1.0&sig=w1LTFeB8T-nr48W1J5rZkh_QzgPIJaOZLajCQjr0U5g',

  // ─── Config Management ───────────────────────────────────────────────

  /**
   * Loads sync config from localStorage (push/pull/config URLs).
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
   * Pushes local data to SharePoint via the push-v2 Logic App.
   * Sends changed transactions since last sync.
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

      // Build the push payload — send full dataset
      const payload = {
        deviceId: this._deviceId,
        timestamp: new Date().toISOString(),
        data: {
          productTypes: data.productTypes,
          categories: data.categories,
          products: data.products,
          stores: data.stores,
          users: data.users,
          thresholds: data.thresholds,
          transactions: data.transactions,
          deletedTransactions: data.deletedTransactions,
          transfers: data.transfers,
          costHistory: data.costHistory,
          stockTakes: data.stockTakes,
          deliveries: data.deliveries,
          stockTakePin: data.stockTakePin,
          stockThresholds: data.stockThresholds,
          _v: data._v,
        }
      };

      const resp = await fetch(this._pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Push failed: ${resp.status} ${resp.statusText}`);
      }

      const result = await resp.json().catch(() => ({}));

      // Update last sync timestamp
      this._lastSyncAt = Date.now();
      localStorage.setItem('bob_last_sync', String(this._lastSyncAt));
      localStorage.removeItem('bob_sync_pending');
      this._retryCount = 0;

      this._showStatus('Synced ✓', 'success');
      console.log('[Sync] Push complete:', result);

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
   * Sends {since: lastSyncTs} to get only items modified after that time.
   */
  async pull() {
    if (!this._pullUrl) return;

    try {
      const resp = await fetch(this._pullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: this._lastSyncAt }),
      });

      if (!resp.ok) {
        console.warn('[Sync] Pull failed:', resp.status);
        return;
      }

      const remote = await resp.json();

      // If no changes, nothing to do
      if (!remote || !remote.length || remote.length === 0) return;

      // remote is an array of SharePoint list items with Data column
      // Each item has .Data (JSON string) containing the pushed payload
      const local = DB.get();  // synchronous
      let merged = false;

      for (const item of remote) {
        try {
          const remoteData = typeof item.Data === 'string' ? JSON.parse(item.Data) : item.Data;
          if (remoteData && remoteData.deviceId !== this._deviceId) {
            // Merge remote data from a different device
            this._merge(remoteData, local);
            merged = true;
          }
        } catch (e) {
          console.warn('[Sync] Failed to parse remote item:', e);
        }
      }

      if (merged) {
        DB.save(local);  // synchronous (fire-and-forget persist)
        this._rerender();
        this._lastSyncAt = Date.now();
        localStorage.setItem('bob_last_sync', String(this._lastSyncAt));
        console.log('[Sync] Pull merged remote changes.');
      }

    } catch (err) {
      console.error('[Sync] Pull error:', err);
    }
  },

  // ─── Merge Logic ────────────────────────────────────────────────────

  /**
   * Merges remote data into local data.
   * Transactions are append-only (merge by ID, remote wins for new ones).
   * Reference data (products, stores, etc.) uses remote-wins strategy.
   */
  _merge(remote, local) {
    // Merge transactions: add any remote transactions we don't have locally
    if (remote.transactions && Array.isArray(remote.transactions)) {
      const localIds = new Set(local.transactions.map(t => t.id));
      const newTxns = remote.transactions.filter(t => !localIds.has(t.id));
      if (newTxns.length > 0) {
        local.transactions = [...local.transactions, ...newTxns];
        console.log(`[Sync] Merged ${newTxns.length} new transactions from remote.`);
      }
    }

    // Merge deleted transactions
    if (remote.deletedTransactions && Array.isArray(remote.deletedTransactions)) {
      const localDelIds = new Set((local.deletedTransactions || []).map(t => t.id));
      const newDel = remote.deletedTransactions.filter(t => !localDelIds.has(t.id));
      if (newDel.length > 0) {
        local.deletedTransactions = [...(local.deletedTransactions || []), ...newDel];
      }
    }

    // Merge transfers
    if (remote.transfers && Array.isArray(remote.transfers)) {
      const localTrIds = new Set((local.transfers || []).map(t => t.id));
      const newTr = remote.transfers.filter(t => !localTrIds.has(t.id));
      if (newTr.length > 0) {
        local.transfers = [...(local.transfers || []), ...newTr];
      }
    }

    // Reference data: remote wins (full replace if remote has data)
    // This keeps SEED data in sync across all devices
    const refTables = ['products', 'stores', 'users', 'categories', 'productTypes', 'thresholds'];
    for (const table of refTables) {
      if (remote[table] && Array.isArray(remote[table]) && remote[table].length > 0) {
        local[table] = remote[table];
      }
    }
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
      this._showStatus('26a0 Cloud sync unavailable 2014 config not found. Contact Kunal.', 'error', 0);
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
