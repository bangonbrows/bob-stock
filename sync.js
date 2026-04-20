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

  // ─── Multi-Tab Leader Election (Tier 2 Fix #15) ─────────────────────
  _isLeader: false,
  _bc: null,             // BroadcastChannel instance
  _tabId: null,          // Unique ID for this tab
  _leaderHeartbeat: null,
  _leaderCheckTimer: null,
  _lastLeaderPing: 0,
  LEADER_TIMEOUT: 10000,  // If no heartbeat for 10s, leader is dead
  HEARTBEAT_INTERVAL: 4000,

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

  // ─── Multi-Tab Leader Election (Tier 2 Fix #15) ─────────────────────

  /**
   * Initializes BroadcastChannel-based leader election.
   * Only the leader tab runs push/pull sync. Follower tabs listen for
   * 'db-updated' messages and refresh their in-memory cache.
   *
   * Protocol:
   * - On init, tab sends 'claim-leader'. If no 'leader-exists' reply
   *   within 500ms, this tab becomes leader.
   * - Leader sends 'heartbeat' every 4s.
   * - If a follower doesn't see a heartbeat for 10s, it tries to claim leader.
   * - When leader tab closes, it sends 'leader-leaving'. Next tab promotes.
   * - After any sync pull/push, leader broadcasts 'db-updated' so followers refresh.
   */
  _initLeaderElection() {
    if (typeof BroadcastChannel === 'undefined') {
      // BroadcastChannel not supported — act as sole leader (old browser fallback)
      this._isLeader = true;
      console.log('[Sync] BroadcastChannel not supported — running as solo leader.');
      return;
    }

    this._tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    this._bc = new BroadcastChannel('bob-sync-leader');

    this._bc.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'claim-leader':
          // Another tab is trying to become leader — tell it we exist
          if (this._isLeader) {
            this._bc.postMessage({ type: 'leader-exists', tabId: this._tabId });
          }
          break;

        case 'leader-exists':
          // Another tab is already leader — stay as follower
          this._isLeader = false;
          this._lastLeaderPing = Date.now();
          break;

        case 'heartbeat':
          this._lastLeaderPing = Date.now();
          break;

        case 'leader-leaving':
          // Leader is closing — try to promote ourselves
          console.log('[Sync] Leader left. Attempting promotion...');
          this._lastLeaderPing = 0;
          setTimeout(() => this._tryClaimLeader(), Math.random() * 300);
          break;

        case 'db-updated':
          // Leader synced new data — refresh our cache
          if (!this._isLeader && typeof DB !== 'undefined' && DB.refresh) {
            DB.refresh().then(() => {
              this._rerender();
              console.log('[Sync] Cache refreshed from leader sync.');
            });
          }
          break;

        case 'local-write':
          // A follower wrote to Dexie — leader must refresh cache and push
          if (this._isLeader && typeof DB !== 'undefined' && DB.refresh) {
            console.log('[Sync] Follower wrote data — refreshing leader cache and scheduling push.');
            DB.refresh().then(() => {
              this.scheduleSync();
            });
          }
          break;
      }
    };

    // Try to claim leadership
    this._tryClaimLeader();

    // Watch for leader death (no heartbeats)
    this._leaderCheckTimer = setInterval(() => {
      if (!this._isLeader && this._lastLeaderPing > 0 &&
          (Date.now() - this._lastLeaderPing) > this.LEADER_TIMEOUT) {
        console.log('[Sync] Leader heartbeat timeout. Attempting promotion...');
        this._tryClaimLeader();
      }
    }, this.LEADER_TIMEOUT / 2);

    // When this tab is closing, notify others
    window.addEventListener('beforeunload', () => {
      if (this._isLeader && this._bc) {
        this._bc.postMessage({ type: 'leader-leaving', tabId: this._tabId });
      }
    });
  },

  /**
   * Attempts to claim leader. Sends 'claim-leader' and waits 500ms.
   * If no 'leader-exists' reply, we become leader and start heartbeat + polling.
   */
  _tryClaimLeader() {
    if (this._isLeader) return;

    this._bc.postMessage({ type: 'claim-leader', tabId: this._tabId });

    setTimeout(() => {
      // If no leader responded in 500ms, we're the leader
      if (!this._isLeader && (Date.now() - this._lastLeaderPing) > 500) {
        this._becomeLeader();
      }
    }, 500);
  },

  /**
   * Promotes this tab to leader — starts heartbeat and sync polling.
   */
  _becomeLeader() {
    this._isLeader = true;
    console.log(`[Sync] This tab (${this._tabId}) is now the sync leader.`);

    // Start heartbeat
    if (this._leaderHeartbeat) clearInterval(this._leaderHeartbeat);
    this._leaderHeartbeat = setInterval(() => {
      if (this._bc && this._isLeader) {
        this._bc.postMessage({ type: 'heartbeat', tabId: this._tabId });
      }
    }, this.HEARTBEAT_INTERVAL);

    // Start sync polling (if we have config)
    if (this._pushUrl && this._pullUrl) {
      this._startPolling();
    }
  },

  /**
   * Starts the periodic pull polling loop.
   */
  _startPolling() {
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._pollInterval = setInterval(() => this.poll(), this.POLL_INTERVAL);
  },

  /**
   * Broadcasts a 'db-updated' event to follower tabs after sync changes.
   */
  _notifyFollowers() {
    if (this._bc) {
      this._bc.postMessage({ type: 'db-updated', tabId: this._tabId });
    }
  },

  // ─── Field Mapping ──────────────────────────────────────────────────

  /**
   * Maps a local transaction object to the SharePoint PascalCase format
   * expected by the push-v2 Logic App's Create Item action.
   */
  _toSharePoint(t) {
    // Derive Timestamp as epoch ms from createdAt or current time.
    // This is the BUSINESS EVENT TIME (when the transaction happened).
    // SyncTimestamp (server arrival time) is set server-side by the Logic App — not sent from client.
    let ts = 0;
    if (typeof t.timestamp === 'number') {
      ts = t.timestamp;
    } else if (t.createdAt) {
      ts = new Date(t.createdAt).getTime();
    } else {
      ts = Date.now();
    }

    const sp = {
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
    // Tombstone support: include TargetTransactionId if present
    if (t.targetTransactionId) {
      sp.TargetTransactionId = t.targetTransactionId;
    }
    return sp;
  },

  /**
   * Maps a SharePoint list item (PascalCase) back to local camelCase format.
   * Used when pulling remote transactions.
   * Note: SyncTimestamp is NOT mapped to local — it's used as the sync cursor only
   * (tracked via lastSyncAt/watermark), not stored in Dexie.
   * Timestamp (business event time) maps to createdAt for UI display.
   */
  _fromSharePoint(item) {
    const local = {
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
    // Tombstone support: map TargetTransactionId if present
    if (item.TargetTransactionId) {
      local.targetTransactionId = item.TargetTransactionId;
    }
    return local;
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
      // GPT review: always refresh from Dexie before push so we pick up
      // any writes from follower tabs that went straight to IndexedDB
      if (typeof DB !== 'undefined' && DB.refresh) {
        await DB.refresh();
      }
      const data = DB.get();  // synchronous — returns freshly refreshed cache

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
      this._notifyFollowers();
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
   *   - Accepts POST { since: <epoch_ms_number>, $top: N, $skip: N }
   *   - Returns { items: [...], serverTimestamp: "...", status: "ok" }
   *   - Items are flat SharePoint list records with PascalCase field names
   *   - Filtered by: Timestamp ge <since>
   *
   * PAGINATION (Tier 2 Fix #13):
   *   Uses $top=1000 and $skip to page through large result sets.
   *   Loops until a page returns fewer items than $top.
   *   lastSyncAt is NOT advanced until ALL pages are successfully retrieved.
   *   If any page fails, the pull aborts and retries next cycle from the
   *   same lastSyncAt (no data loss, just a delayed sync).
   *
   * TOMBSTONE HANDLING (Tier 2 Fix #6):
   *   Items with Type === 'deleted' are tombstones — they signal that
   *   the referenced transaction (TargetTransactionId field holds the original ID)
   *   should be removed from the local database.
   */
  PULL_PAGE_SIZE: 1000,
  PULL_LOOKBACK_MS: 10000,  // 10-second overlap margin — re-queries a small window to catch
                             // rows that were mid-commit during the previous pull cycle.
                             // Replayed rows are harmless: Dexie put() deduplicates by ID.
                             // (Required by GPT as condition for final green flag.)

  async pull() {
    if (!this._pullUrl) return;

    try {
      let skip = 0;
      let allItems = [];
      let keepGoing = true;
      let watermark = null;  // Snapshot upper bound — captured from first page

      // Page through results with snapshot-safe pagination (GPT review fix)
      // First page captures serverTimestamp as watermark (epoch ms, server-owned).
      // All pages filter: SyncTimestamp gt (since - lookback) AND SyncTimestamp le watermark
      // SyncTimestamp is set server-side at ingest (not client event time).
      // Stable sort: SyncTimestamp asc, ID asc (SharePoint server ID tie-breaker)
      // This prevents offline/backdated pushes from being permanently skipped.
      // The lookback margin (10s) catches rows that were mid-commit during the last pull.
      const safeSince = Math.max(0, this._lastSyncAt - this.PULL_LOOKBACK_MS);
      while (keepGoing) {
        const body = {
          since: String(safeSince),
          $top: this.PULL_PAGE_SIZE,
          $skip: skip
        };
        // Send watermark on subsequent pages so Logic App uses consistent upper bound
        if (watermark) {
          body.watermark = watermark;
        }

        const resp = await fetch(this._pullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          console.warn(`[Sync] Pull page failed (skip=${skip}):`, resp.status);
          this._showStatus('Data may be stale \u2014 last sync failed', 'warning', 0);
          return;  // Abort — don't advance lastSyncAt, retry next cycle
        }

        const remote = await resp.json();
        const items = (remote && Array.isArray(remote.items)) ? remote.items : [];

        // Capture watermark from first page response
        if (!watermark && remote.serverTimestamp) {
          watermark = remote.serverTimestamp;
        }

        allItems = allItems.concat(items);
        console.log(`[Sync] Pull page: skip=${skip}, received=${items.length}, total=${allItems.length}, watermark=${watermark}`);

        if (items.length < this.PULL_PAGE_SIZE) {
          keepGoing = false;  // Last page — fewer items than page size
        } else {
          skip += this.PULL_PAGE_SIZE;
        }
      }

      if (allItems.length === 0) {
        return;  // No changes
      }

      console.log(`[Sync] Pull received ${allItems.length} total items from SharePoint.`);

      const local = DB.get();
      const localIds = new Set((local.transactions || []).map(t => t.id));

      // Diagnostic: count overlap/replay rows (items in the lookback window already known locally)
      // This helps verify the lookback margin is working and can be tuned later.
      let overlapCount = 0;

      // Separate tombstones from regular transactions
      const tombstones = [];
      const newTransactions = [];

      for (const spItem of allItems) {
        if (!spItem.TransactionId) continue;

        // Tombstone handling (Fix #6): Type === 'deleted' means remove the original
        if (spItem.Type === 'deleted') {
          tombstones.push(spItem);
          continue;
        }

        // Skip items we already have locally (includes lookback overlap rows)
        if (localIds.has(spItem.TransactionId)) {
          overlapCount++;
          continue;
        }

        // Skip items from this device (we already have them)
        if (spItem.DeviceId === this._deviceId) continue;

        const localTxn = this._fromSharePoint(spItem);
        newTransactions.push(localTxn);
      }

      if (overlapCount > 0) {
        console.log(`[Sync] Lookback overlap: ${overlapCount} rows already known locally (deduped). Margin: ${this.PULL_LOOKBACK_MS}ms`);
      }

      let changed = false;

      // Process tombstones — remove deleted transactions from local DB
      if (tombstones.length > 0) {
        for (const ts of tombstones) {
          // TargetTransactionId holds the original transaction ID that was deleted
          // (dedicated field per GPT review — not overloading TransferId)
          const originalId = ts.TargetTransactionId || ts.TransactionId;
          if (originalId && localIds.has(originalId)) {
            DB.removeTransaction(originalId, { skipTombstone: true });
            console.log(`[Sync] Tombstone applied: removed transaction ${originalId}`);
            changed = true;
          }
        }
      }

      // Merge new transactions
      if (newTransactions.length > 0) {
        DB.addTransactions(newTransactions);
        console.log(`[Sync] Merged ${newTransactions.length} new transactions from remote.`);
        changed = true;
      }

      if (changed) {
        DB.commit();
        this._rerender();
        this._notifyFollowers();
      }

      // Only advance lastSyncAt AFTER all pages succeeded.
      // Use watermark (server timestamp at pull start) if available, NOT Date.now().
      // The watermark is the exact upper bound used by the query (SyncTimestamp le watermark).
      // Any records that arrive during the pull loop have SyncTimestamp > watermark,
      // so they'll be picked up in the next sync cycle. (Gemini + GPT both flagged this.)
      // Pull filter uses "gt since" (not "ge") to avoid replaying boundary rows.
      if (watermark) {
        const wmTs = typeof watermark === 'number' ? watermark : new Date(watermark).getTime();
        if (!isNaN(wmTs) && wmTs > 0) {
          this._lastSyncAt = wmTs;
        } else {
          this._lastSyncAt = Date.now();
        }
      } else {
        this._lastSyncAt = Date.now();
      }
      localStorage.setItem('bob_last_sync', String(this._lastSyncAt));

      // Clear any stale-data warning since sync succeeded
      this._showStatus('Synced \u2713', 'success');

    } catch (err) {
      console.error('[Sync] Pull error:', err);
      this._showStatus('Data may be stale \u2014 last sync failed', 'warning', 0);
    }
  },

  // ─── Tombstone Push (Tier 2 Fix #6) ─────────────────────────────────

  /**
   * Pushes a tombstone record to SharePoint when a transaction is deleted locally.
   * The tombstone is an append-only record with Type='deleted' and TransferId
   * pointing to the original transaction ID. Other devices will see this on their
   * next pull and remove the corresponding transaction.
   *
   * @param {string} originalTxnId - The ID of the deleted transaction
   * @param {object} originalTxn - The original transaction object (for context fields)
   */
  async pushTombstone(originalTxnId, originalTxn) {
    if (!this._pushUrl) {
      console.warn('[Sync] No push URL — tombstone queued locally only.');
      return;
    }

    const tombstone = {
      TransactionId: 'del_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      Date: new Date().toISOString().split('T')[0],
      StoreId: originalTxn?.storeId || '',
      ProductId: originalTxn?.productId || '',
      Type: 'deleted',
      Qty: 0,
      StaffName: (typeof Auth !== 'undefined' && Auth.user()) ? Auth.user().name || Auth.user().username || '' : '',
      Reason: 'Transaction deleted: ' + originalTxnId,
      DeviceId: this._deviceId || '',
      Timestamp: Date.now(),
      TransferId: '',
      TargetTransactionId: originalTxnId  // Dedicated field for tombstone target (GPT review)
    };

    try {
      const payload = { data: { transactions: [tombstone] } };
      const resp = await fetch(this._pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        throw new Error(`Tombstone push failed: ${resp.status}`);
      }

      console.log(`[Sync] Tombstone pushed for deleted transaction ${originalTxnId}`);
    } catch (err) {
      console.error('[Sync] Tombstone push failed:', err);
      // Store tombstone locally for retry on next push cycle
      if (typeof DB !== 'undefined') {
        const localTombstone = {
          id: tombstone.TransactionId,
          date: tombstone.Date,
          storeId: tombstone.StoreId,
          productId: tombstone.ProductId,
          type: 'deleted',
          qty: 0,
          staffName: tombstone.StaffName,
          reason: tombstone.Reason,
          deviceId: tombstone.DeviceId,
          transferId: '',
          targetTransactionId: originalTxnId,
          createdAt: new Date().toISOString(),
          _synced: false  // Will be picked up by next push() cycle
        };
        DB.addTransaction(localTombstone);
      }
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
   * Tier 2 Fix #15: Only the leader tab actually pushes. Follower tabs
   * just mark pending — the leader's next poll cycle will pick it up.
   */
  scheduleSync() {
    localStorage.setItem('bob_sync_pending', 'true');
    if (!this._isLeader) {
      // Follower tab — notify leader so it refreshes cache and pushes
      if (this._bc) {
        this._bc.postMessage({ type: 'local-write', tabId: this._tabId });
      }
      return;
    }
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
   *
   * Tier 2 Fix #15: Uses leader election so only one tab runs sync.
   * All tabs load config, but only the leader starts push/pull/polling.
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

    // Initialize leader election (Fix #15)
    this._initLeaderElection();

    // Wait briefly for leader election to resolve
    await new Promise(r => setTimeout(r, 600));

    if (!this._isLeader) {
      console.log('[Sync] This tab is a follower — sync delegated to leader tab.');
      return;
    }

    // === Leader-only logic below ===

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

    // Start polling (leader only)
    this._startPolling();

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
   * Stops polling and cleans up leader election (for cleanup/testing).
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
    if (this._leaderHeartbeat) {
      clearInterval(this._leaderHeartbeat);
      this._leaderHeartbeat = null;
    }
    if (this._leaderCheckTimer) {
      clearInterval(this._leaderCheckTimer);
      this._leaderCheckTimer = null;
    }
    if (this._bc) {
      if (this._isLeader) {
        this._bc.postMessage({ type: 'leader-leaving', tabId: this._tabId });
      }
      this._bc.close();
      this._bc = null;
    }
    this._isLeader = false;
  }
};
