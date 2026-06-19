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
  _emailUrl: null,  // MFL-010: email Logic App URL from AppConfig (not hard-coded)
  _localWriteDebounce: null,  // MFL-018: debounce leader refresh on follower writes
  _configUrl: null,
  _syncLock: false,  // Unified lock — serialises push and pull operations
  _syncing: false,    // Wave L2 (#3): a manual syncNow cycle (push→pull) is in flight on THIS (leader) tab
  _syncQueued: false, // Wave L2 (#3): a syncNow arrived mid-cycle → run exactly one more cycle after
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
   * Loads sync config from sessionStorage cache (push/pull URLs).
   * These URLs are the SAS-secured Logic App trigger endpoints.
   * Stored in sessionStorage (not localStorage) so they are cleared on tab/browser close.
   */
  _loadConfig() {
    try {
      const raw = sessionStorage.getItem('bob_sync_config');
      if (!raw) return false;
      const config = JSON.parse(raw);
      this._pushUrl = config.pushUrl || null;
      this._pullUrl = config.pullUrl || null;
      this._emailUrl = config.emailUrl || null;  // MFL-010
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
   * Caches the result in sessionStorage for the current session.
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

      // F3-CRIT01 (Gemini FINAL CRIT-01): master-data distribution. Before this,
      // products/stores/categories NEVER synced — a Director price change or new
      // product stayed trapped on one device (catalogue islands, verified live).
      // AppConfig may now carry a 'master_data' item; merge it on every config
      // fetch (app launch). Non-fatal if absent. Upstream catalogue WRITES still
      // need a Logic App endpoint — see SERVER-SIDE-REQUIREMENTS.md.
      try {
        const mdItem = data.items.find(i => i.ConfigType === 'master_data');
        if (mdItem && mdItem.ConfigData) await this._applyMasterData(mdItem.ConfigData);
      } catch (e) {
        console.warn('[Sync] master_data merge failed (catalogue unchanged):', e);
      }

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
        this._emailUrl = urls.emailUrl || null;  // MFL-010
        this._configUrl = this.CONFIG_URL;
        // Cache in sessionStorage — SAS URLs must not persist across sessions (Tier 1 Fix #5)
        sessionStorage.setItem('bob_sync_config', JSON.stringify({
          pushUrl: urls.pushUrl,
          pullUrl: urls.pullUrl,
          emailUrl: urls.emailUrl || null,
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

  // F3-CRIT01: merge a versioned master-data payload into the local catalogue.
  // Payload: { version:N, products:[], stores:[], categories:[], productTypes:[] }.
  // Rules:
  //   - version gate: only apply when version > the device's last-applied version
  //     (localStorage 'bob_catalogue_version') — idempotent across launches.
  //   - UPSERT only: server rows update/insert; local-only rows are KEPT (there is
  //     no upstream catalogue push yet, so deletion here would destroy
  //     Director-added products that exist nowhere else).
  //   - server is authoritative per-field; local costPrice is preserved unless the
  //     server explicitly sends one (cost flows from local delivery workflows).
  //   - every row passes the same boundary rules as import: safe key, no
  //     sanitizer-stripped chars in ids, finite non-negative money. Bad rows are
  //     skipped + logged, never coerced.
  async _applyMasterData(raw) {
    const md = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!md || typeof md !== 'object') return;
    const version = Number(md.version);
    if (!Number.isFinite(version) || version <= 0) return;
    let lastApplied = 0;
    try { lastApplied = parseInt(localStorage.getItem('bob_catalogue_version') || '0', 10) || 0; } catch (e) {}
    if (version <= lastApplied) return;

    const d = DB.get();
    if (!d) return;
    const badId = v => typeof v !== 'string' || v === '' || !/^[A-Za-z0-9_-]+$/.test(v) ||
      (typeof Stock !== 'undefined' && Stock._isSafeKey && !Stock._isSafeKey(v));  // Wave J (Tier 3): allowlist not denylist — catalogue hygiene + defence-in-depth, consistent with the UI add + backup gates. All real catalogue ids are [A-Za-z0-9_-] (pt_/cat_/MKU_1...), so this false-rejects nothing. NOTE: the original driver (a master_data product id embedded into cost-history ledger ids) was removed when those ids became opaque (ch_<ms>_<hex>, GPT FINAL deep audit); the allowlist is retained to keep catalogue ids clean.
    // F-followup (GPT-WF-03): money through the SHARED policy (rejects >MONEY_MAX
    // and non-finite/negative; normalises to 2dp), not the old finite+non-negative-only.
    const _money = v => (typeof Validate !== 'undefined') ? Validate.money(v, { optional: true }) : { ok: Number.isFinite(Number(v)) && Number(v) >= 0, value: Number(v) };
    const badMoney = v => v != null && !_money(v).ok;
    // F-followup (CL-01, I-02): reserved keys must NEVER be copied from a remote
    // row — `local['__proto__']=…` / Object.assign spreading a `__proto__` field
    // swaps the merged object's prototype (prototype-pollution at the catalogue boundary).
    const RESERVED = { id: 1, __proto__: 1, constructor: 1, prototype: 1 };
    const normMoney = (k, v, moneyFields) => (moneyFields.indexOf(k) >= 0 && v != null) ? _money(v).value : v;
    // F-followup: ONE reserved-key copy guard used by BOTH the update and insert
    // branches (so a single saboteur mutation breaks both — no blind branch). A
    // reserved key (__proto__/constructor/prototype/id) is NEVER copied from a
    // remote row, on either path.
    const copyFields = (target, row, moneyFields, keepLocalCost) => {
      Object.keys(row).forEach(k => {
        if (RESERVED[k]) return;
        if (keepLocalCost && k === 'costPrice' && row.costPrice == null) return;  // keep local cost unless server sends one
        target[k] = normMoney(k, row[k], moneyFields);
      });
    };
    const skipped = [];
    const upsert = (coll, rows, moneyFields) => {
      if (!Array.isArray(rows)) return 0;
      moneyFields = moneyFields || [];
      let applied = 0;
      rows.forEach(row => {
        if (!row || typeof row !== 'object' || badId(row.id) || typeof row.name !== 'string' || row.name === '') { skipped.push(coll + ':' + (row && row.id)); return; }
        if (moneyFields.some(f => badMoney(row[f]))) { skipped.push(coll + ':' + row.id + ':money'); return; }
        const local = (d[coll] = d[coll] || []).find(x => x && x.id === row.id);
        if (local) {
          copyFields(local, row, moneyFields, true);
        } else {
          const clean = {};                                           // build on a fresh plain object — no proto inheritance from the payload
          copyFields(clean, row, moneyFields, false);
          clean.id = row.id;
          clean.active = row.active !== false;
          d[coll].push(clean);
        }
        applied++;
      });
      return applied;
    };

    // Wave H follow-up (GPT BLOCK P2): the upserts below mutate the LIVE cache before the durable
    // write. If commitDurable fails we hold the version (H2) but must ALSO roll the cache back —
    // otherwise a cache-only product/price survives in memory, and a transaction later saved against
    // a cache-only product orphans on the next refresh (Dexie has no such product). Snapshot the four
    // mutated collections so we can restore the exact pre-merge state on failure.
    const _mdSnap = {
      products: JSON.parse(JSON.stringify(d.products || [])),
      stores: JSON.parse(JSON.stringify(d.stores || [])),
      categories: JSON.parse(JSON.stringify(d.categories || [])),
      productTypes: JSON.parse(JSON.stringify(d.productTypes || [])),
    };
    const counts = {
      products: upsert('products', md.products, ['price', 'costPrice']),
      stores: upsert('stores', md.stores, []),
      categories: upsert('categories', md.categories, []),
      productTypes: upsert('productTypes', md.productTypes, []),
    };
    if (skipped.length) {
      console.warn('[Sync] master_data skipped ' + skipped.length + ' invalid row(s): ' + skipped.join(', '));
      try { if (typeof Diag !== 'undefined') Diag.log('sync', 'master_data skipped rows: ' + skipped.join(', ')); } catch (e) {}
    }
    // Wave H (H2 / blind G1-12, ×2): persist DURABLY and advance the catalogue version ONLY if the
    // write actually succeeded. The old fire-and-forget DB.commit() + immediate localStorage version
    // bump meant a failed background persist still advanced the version → the next launch's
    // `version<=lastApplied` gate skipped re-applying → catalogue desynced FOREVER, never retried.
    const _ok = await DB.commitDurable();  // runs _sanitizeNames + ref-data persist; returns false on failure
    if (!_ok) {
      // Wave H follow-up (GPT + Gemini BLOCK P2): a durable persist failure must (a) hold the version,
      // (b) roll the cache back so no cache-only catalogue survives, and (c) trip the same fatal
      // "stop-on-durable-failure" gate as every other write path.
      // (b) IN-PLACE rollback (NOT an array swap): restore each surviving row's fields and drop rows
      // this merge inserted, so any module still holding a product object reference sees the restored
      // values rather than the mutated ones (Gemini reference-drift finding — an array swap leaves the
      // old, mutated objects alive for whoever captured them).
      const _restoreColl = (coll) => {
        const arr = d[coll]; if (!Array.isArray(arr)) return;
        const snapById = new Map((_mdSnap[coll] || []).map(r => [r && r.id, r]));
        for (let i = arr.length - 1; i >= 0; i--) { const o = arr[i]; if (!o || !snapById.has(o.id)) arr.splice(i, 1); }  // drop rows inserted by this failed merge
        arr.forEach(o => { const snap = snapById.get(o.id); if (snap) { Object.keys(o).forEach(k => delete o[k]); Object.assign(o, snap); } });  // restore surviving rows IN PLACE
      };
      ['products', 'stores', 'categories', 'productTypes'].forEach(_restoreColl);
      if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) Stock._invalidateThrMap();
      if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();  // stock cache derives from products — rebuild against the restored catalogue
      console.warn('[Sync] master_data v' + version + ' persist FAILED — version held at ' + lastApplied + ', cache rolled back (will re-apply on next config fetch).');
      try { if (typeof Diag !== 'undefined') Diag.log('sync', 'master_data persist failed, version NOT advanced (held ' + lastApplied + '), cache rolled back'); } catch (e) {}
      // (c) catalogue-specific fatal message. NOTE: DB.commitDurable()'s _retryWrite already trips the
      // GENERIC fatal gate (db.js:185) on an exhausted durable write — so master-data failure was never
      // silent (Gemini's "no fatal" was a false positive). This call OVERWRITES that generic message
      // with a master-data-specific one, matching the per-call-site pattern every other durable path
      // uses (transfer/movement/delivery/stock-take each set their own message on top of _retryWrite).
      if (typeof UI !== 'undefined' && UI.fatalSaveError) UI.fatalSaveError('A catalogue update could not be saved to this device. Your data is unchanged — please reload, and contact your administrator if this keeps happening.');
      this._rerender();  // reflect the rolled-back catalogue in the UI
      return;
    }
    try { localStorage.setItem('bob_catalogue_version', String(version)); } catch (e) {}
    if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) Stock._invalidateThrMap();
    this._rerender();
    console.log('[Sync] master_data v' + version + ' applied:', JSON.stringify(counts));
  },

  /**
   * Saves sync config to sessionStorage.
   * Called from the Cloud Sync settings UI.
   */
  // SA-D-F1/G-F4: localStorage can throw (Safari Private, quota) — never let a pending-flag op crash a save.
  _setPending(on) { try { if (on) localStorage.setItem('bob_sync_pending', 'true'); else localStorage.removeItem('bob_sync_pending'); } catch (e) {} },
  _getPending() { try { return localStorage.getItem('bob_sync_pending') === 'true'; } catch (e) { return false; } },
  // Wave L2 (#5, GPT+Gemini P0): the nav "Stock last synced" indicator's DISPLAY timestamp. DELIBERATELY
  // SEPARATE from bob_last_sync — that key is the PULL CURSOR (loaded into _lastSyncAt, the "fetch server
  // rows newer than this" watermark); stamping it on push with the device clock would skip server rows and
  // cause silent data loss. This key is display-only and never read back as a cursor. Stamped on any sync
  // success (push or pull); shared across tabs via localStorage so followers' indicators update too.
  _stampUiSync() { try { localStorage.setItem('bob_ui_last_sync', String(Date.now())); } catch (e) {} },

  saveConfig(pushUrl, pullUrl, configUrl) {
    const config = { pushUrl, pullUrl };
    if (configUrl) config.configUrl = configUrl;
    if (this._emailUrl) config.emailUrl = this._emailUrl;  // SA-C-F1: keep email URL across a settings save (don't disable logistics email)
    sessionStorage.setItem('bob_sync_config', JSON.stringify(config));
    this._pushUrl = pushUrl;
    this._pullUrl = pullUrl;
    this._configUrl = configUrl || null;
    console.log('[Sync] Config saved.');
  },

  /**
   * Returns current config for the settings UI.
   */
  getConfig() {
    const raw = sessionStorage.getItem('bob_sync_config');
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * Clears sensitive sync data (SAS URLs) from sessionStorage.
   * Called by Auth.logout() to ensure credentials don't linger.
   * Non-sensitive data (device ID, last sync timestamp) stays in localStorage.
   */
  clearSensitiveData() {
    sessionStorage.removeItem('bob_sync_config');
    this._pushUrl = null;
    this._pullUrl = null;
    this._emailUrl = null;  // MFL-010: clear email URL on logout too
    this._configUrl = null;
    console.log('[Sync] Sensitive data cleared.');
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

    this._tabStartedAt = Date.now();
    this._tabId = 'tab_' + this._tabStartedAt + '_' + Math.random().toString(36).substring(2, 7);
    this._bc = new BroadcastChannel('bob-sync-leader');
    this._pendingClaim = false;  // T2-07: track if we have an active claim in flight

    this._bc.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'claim-leader':
          // Another tab is trying to become leader
          if (this._isLeader) {
            // We're already leader — tell them
            this._bc.postMessage({ type: 'leader-exists', tabId: this._tabId });
          } else if (this._pendingClaim) {
            // T2-07: We also have a pending claim — deterministic tiebreaker
            // Older tab (lower startedAt) wins; tabId breaks exact ties
            const theyWin = (msg.startedAt < this._tabStartedAt) ||
                            (msg.startedAt === this._tabStartedAt && msg.tabId < this._tabId);
            if (theyWin) {
              // They have priority — cancel our claim
              this._pendingClaim = false;
              this._lastLeaderPing = Date.now();
              console.log(`[Sync] Lost election tiebreak to ${msg.tabId} — standing down.`);
            }
            // If we win, we just ignore their claim — they'll see our claim and stand down
          }
          break;

        case 'leader-exists':
          // Another tab is already leader — stay as follower
          this._isLeader = false;
          this._pendingClaim = false;
          this._lastLeaderPing = Date.now();
          break;

        case 'heartbeat':
          this._lastLeaderPing = Date.now();
          // MFL-011: two leaders after mobile backgrounding — newer leader wins, older demotes.
          if (this._isLeader && msg.tabId !== this._tabId && typeof msg.startedAt === 'number' &&
              (msg.startedAt > this._tabStartedAt ||
               (msg.startedAt === this._tabStartedAt && msg.tabId < this._tabId))) {  // C-F5: equal-startedAt tie-break
            console.warn('[Sync] Another newer leader active — demoting this tab to follower.');
            this._isLeader = false;
            if (this._leaderHeartbeat) { clearInterval(this._leaderHeartbeat); this._leaderHeartbeat = null; }
            if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
            this._lastLeaderPing = Date.now();
          }
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

        // Wave I (Tier 2): the 'push-tombstone' delegation is GONE. A delete now writes a durable
        // tombstone row atomically; the follower's 'local-write' below makes the leader refresh +
        // push it (and leader poll() also drains pending), so no tombstone-specific channel is needed.

        case 'local-write':
          // A follower wrote to Dexie — leader refreshes cache and pushes.
          // MFL-018: debounce so a burst of follower writes triggers ONE refresh+push, not N.
          if (this._isLeader && typeof DB !== 'undefined' && DB.refresh) {
            clearTimeout(this._localWriteDebounce);
            this._localWriteDebounce = setTimeout(() => {
              DB.refresh().then(() => this.scheduleSync());
            }, 400);
          }
          break;

        case 'request-sync':
          // Wave L2 (#3): a follower tapped "Sync now" / reconnected — ONLY the leader runs the actual
          // push+pull cycle (single-syncer invariant). Refresh first so the leader pushes the follower's
          // latest durable writes, then run the queued cycle.
          if (this._isLeader && typeof DB !== 'undefined' && DB.refresh) {
            DB.refresh().then(() => this._runSyncCycle());
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
   * Attempts to claim leader. Sends 'claim-leader' with startedAt for deterministic tiebreak.
   * T2-07: Uses startedAt + tabId tiebreaker to prevent split-brain on simultaneous startup.
   * Adds random jitter (0-200ms) before claiming to reduce collision probability.
   */
  _tryClaimLeader() {
    if (this._isLeader) return;

    // T2-07: Small random jitter to reduce simultaneous claim probability
    const jitter = Math.random() * 200;
    setTimeout(() => {
      if (this._isLeader) return;  // Another tab may have claimed while we waited
      this._pendingClaim = true;
      this._bc.postMessage({ type: 'claim-leader', tabId: this._tabId, startedAt: this._tabStartedAt });

      setTimeout(() => {
        // If no leader responded in 500ms AND our claim wasn't cancelled by tiebreaker
        if (!this._isLeader && this._pendingClaim && (Date.now() - this._lastLeaderPing) > 500) {
          this._pendingClaim = false;
          this._becomeLeader();
        }
        this._pendingClaim = false;
      }, 500);
    }, jitter);
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
        this._bc.postMessage({ type: 'heartbeat', tabId: this._tabId, startedAt: this._tabStartedAt });
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
      Qty: (function(v){ var n = Math.trunc(Number(v)); return Number.isSafeInteger(n) ? n : 0; })(t.qty),  // DA-4: safe-int egress (NaN/Infinity/huge -> 0, symmetry with ingest)
      StaffName: t.staffName || '',
      Reason: t.reason || '',
      DeviceId: t.deviceId || this._deviceId || '',
      Timestamp: ts,
      TransferId: t.transferId || ''
    };
    // Tombstone support: include TargetTransactionId + the deletion audit metadata (Wave I / I-2 —
    // was only TargetTransactionId, so other devices learned a row was deleted but not who/when/why).
    if (t.targetTransactionId) {
      sp.TargetTransactionId = t.targetTransactionId;
      sp.DeletedBy = t.deletedBy || '';
      sp.DeletedAt = t.deletedAt || '';
      sp.DeleteReason = t.deleteReason || '';
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
    // F-followup (GPT-WF-01): STRICT ingest — reject the whole row (return null ->
    // caller quarantines) rather than coerce. The old code truncated 5.9 to 5
    // (silent wrong stock), zeroed NaN/huge/Infinity (silent lost movement), and
    // accepted unknown Type / unknown product / unknown store, while the cursor
    // advanced. A boundary must never turn hostile/malformed input into durable
    // truth. Uses the shared Validate.qty policy (same as UI + backup import).
    if (!item) return null;
    const _q = (typeof Validate !== 'undefined') ? Validate.qty(item.Qty) : { ok: Number.isSafeInteger(Math.trunc(Number(item.Qty))) && Math.trunc(Number(item.Qty)) >= 0 && Number.isInteger(Number(item.Qty)), value: Number(item.Qty) };
    if (!_q.ok) return null;                                                    // fractional / NaN / huge / Infinity / negative
    const _dir = (typeof Txn !== 'undefined' && Txn.classify) ? Txn.classify({ type: String(item.Type || '') }).direction : 'in';
    if (_dir !== 'in' && _dir !== 'out') return null;                           // unknown / non-movement transaction type
    // Unknown product/store reference: reject (an orphan ledger row the stock cache
    // would skip = the exact ledger/cache disagreement H-01 was meant to close).
    // Note: the realistic legitimate-but-not-yet-synced case is mitigated by the
    // master_data catalogue merge running at launch BEFORE pull; the authoritative
    // guard is server-side (SERVER-SIDE-REQUIREMENTS.md P0-2).
    const _d = (typeof DB !== 'undefined' && DB.get) ? DB.get() : null;
    if (_d) {
      if (!(_d.products || []).some(p => p && p.id === item.ProductId)) return null;
      if (!(_d.stores || []).some(s => s && s.id === item.StoreId)) return null;
    }
    const local = {
      id: item.TransactionId,
      date: item.Date || '',
      storeId: item.StoreId || '',
      productId: item.ProductId || '',
      type: item.Type || '',
      qty: _q.value,                                                            // validated safe non-negative integer (no coercion)
      staffName: item.StaffName || '',
      reason: item.Reason || '',
      deviceId: item.DeviceId || '',
      transferId: item.TransferId || '',
      createdAt: (function(){ try { if(item.Timestamp){ var _d=new Date(item.Timestamp); if(!isNaN(_d.getTime())) return _d.toISOString(); } } catch(e){} return new Date().toISOString(); })(),  // SA-C-F1: tolerate malformed remote Timestamp
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
  async push(_isRetry) {
    // T3-02: _isRetry flag allows retry to re-enter push() without releasing the lock
    if (this._syncLock && !_isRetry) {
      console.log('[Sync] Sync already in progress, skipping push.');
      return;
    }
    if (!this._pushUrl) {
      console.warn('[Sync] No push URL configured.');
      return;
    }

    this._syncLock = true;
    this._showStatus('Syncing...', 'info', 0);

    try {
      // GPT review: always refresh from Dexie before push so we pick up
      // any writes from follower tabs that went straight to IndexedDB
      if (typeof DB !== 'undefined' && DB.refresh) {
        await DB.refresh();
      }
      const data = DB.get();  // synchronous — returns freshly refreshed cache

      // Filter to only unsynced transactions
      const _allUnsynced = (data.transactions || []).filter(t => !t._synced);

      // F-followup-2 (GPT-FF-02): EGRESS validation — the 4th trust boundary.
      // _toSharePoint coerced bad qty (5.9->5, NaN->0) and forwarded unknown
      // type/product/store, so a tampered/legacy local row could poison the cloud
      // for every device. Validate each row with the SAME policy as ingress;
      // exclude (do NOT push) anything that fails, and log it. Such rows stay
      // unsynced (never propagated) — correct for garbage; server-side remains
      // the authoritative gate (SERVER-SIDE-REQUIREMENTS.md).
      const _egressOk = (t) => {
        if (!t) return false;
        // Wave H (H1 / blind G1-22, ×4, P1): a tombstone is an offline delete queued as a
        // type:'deleted' row (qty 0, no in/out direction). The in/out-only checks below
        // rejected it, so offline deletes NEVER egressed → ghost stock on every other device.
        // A well-formed tombstone (carries its TargetTransactionId) must propagate even if the
        // referenced product/store is gone — it deletes by target id, not by stock movement.
        // _toSharePoint already serialises it correctly (Type:'deleted' + TargetTransactionId).
        if (String(t.type || '') === 'deleted') return !!t.targetTransactionId;
        if (typeof Validate !== 'undefined' && !Validate.qty(t.qty).ok) return false;
        const _dir = (typeof Txn !== 'undefined' && Txn.classify) ? Txn.classify({ type: String(t.type || '') }).direction : 'in';
        if (_dir !== 'in' && _dir !== 'out') return false;
        if (!(data.products || []).some(p => p && p.id === t.productId)) return false;
        if (!(data.stores || []).some(s => s && s.id === t.storeId)) return false;
        return true;
      };
      const unsynced = _allUnsynced.filter(_egressOk);
      const _rejected = _allUnsynced.filter(t => !_egressOk(t));
      if (_rejected.length > 0) {
        console.warn(`[Sync] EGRESS: ${_rejected.length} hostile/invalid local row(s) excluded from push (not propagated): ${_rejected.map(t => t.id).join(', ')}`);
        try { if (typeof Diag !== 'undefined') Diag.log('sync', `egress-excluded ${_rejected.length} invalid local rows: ${_rejected.map(t => t.id).join(', ')}`); } catch (e) {}
      }

      if (unsynced.length === 0) {
        console.log('[Sync] No unsynced transactions to push.');
        this._showStatus('Synced ✓', 'success'); this._stampUiSync();
        Sync._setPending(false);
        return;
      }

      // Capture exact IDs being sent BEFORE the async push — any transactions
      // added during the fetch must NOT be marked as synced.
      const batchIds = new Set(unsynced.map(t => t.id));

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

      // ── Server acknowledgement verification (GPT Tier 1 review requirement) ──
      // The Logic App returns: { status: "ok", processedCount: N, serverTimestamp }
      // Verification rules:
      //   status ok/success + processedCount === batchSize  → mark synced
      //   status ok/success WITHOUT processedCount          → FAIL-SAFE, leave unsynced
      //   status missing + processedCount === batchSize     → mark synced (fallback)
      //   anything else (partial, ambiguous, missing)       → FAIL-SAFE, leave unsynced
      //
      // If the server can't prove full-batch success, we leave the batch unsynced
      // and retry on the next cycle. Dedup on the server prevents duplicate inserts.

      const serverStatus = (result.status || '').toLowerCase();
      const serverCount = result.processedCount;
      const batchSize = spTransactions.length;

      let ackVerified = false;
      if (serverStatus === 'ok' || serverStatus === 'success') {
        if (serverCount !== undefined) {
          // Server reported a count — must match batch size for full-batch confirmation
          ackVerified = (Number(serverCount) === batchSize);
          if (!ackVerified) {
            console.warn(`[Sync] Partial push: server processed ${serverCount}/${batchSize}. Leaving batch unsynced for retry.`);
          }
        } else {
          // No processedCount — ambiguous, leave unsynced for retry (GPT strict requirement)
          console.warn('[Sync] Server returned ok but no processedCount — leaving batch unsynced for safety.');
          ackVerified = false;
        }
      } else if (!serverStatus && serverCount !== undefined && Number(serverCount) === batchSize) {
        // C-F4: count-fallback ONLY when there is NO status (never on an explicit error/failed status)
        ackVerified = true;
      }

      if (ackVerified) {
        // F2-CRIT03: mark ONLY the pushed batch as synced via a targeted row
        // update. The old path (DB.save) clear+rewrote ALL 12 Dexie tables per
        // push ack — a freeze time-bomb once the ledger grows. On a failed
        // persist the batch stays unsynced and re-pushes (server dedup safe).
        const _marked = await DB.markTransactionsSynced(batchIds);
        if (!_marked) {
          // Wave H (H3 / GPTa-31): the server ack verified, but the LOCAL _synced write FAILED.
          // The rows are still _synced=false and will re-push (server dedup makes replay safe) —
          // but the old code fell through and cleared pending + showed "Synced ✓", a false-
          // confidence lie. Keep pending, show a finalising status, and schedule a proactive
          // retry (GPTa-32: these paths previously left pending=true with NO retry timer).
          console.warn('[Sync] markSynced persist failed — keeping pending + scheduling retry (NOT showing Synced).');
          this._showStatus('Saving sync state… will retry', 'warning');
          Sync._setPending(true);
          this._scheduleSyncRetry();
        } else {
          // SA-G-F2: do NOT advance the pull cursor from the device clock on push.
          // _lastSyncAt is the pull "since" and must be driven ONLY by the server watermark in
          // pull(); a fast client clock here would skip other stores' rows. Pushed rows get
          // re-pulled and deduped (server dedup + client ID-merge), which is safe.
          Sync._setPending(false);
          this._retryCount = 0;
          this._markRetryCount = 0;

          this._showStatus('Synced ✓', 'success'); this._stampUiSync();
          this._notifyFollowers();
          console.log(`[Sync] Push complete: ${batchSize} transactions synced.`, result);
        }
      } else {
        // Fail-safe: server response ambiguous or partial — leave unsynced, retry later
        // Server-side dedup (by TransactionId) ensures replayed rows are harmless
        console.warn('[Sync] Push response ambiguous — batch left unsynced for retry.', result);
        this._showStatus('Sync uncertain — will retry', 'warning');
        Sync._setPending(true);
        this._scheduleSyncRetry();  // Wave H (GPTa-32): the ambiguous branch used to schedule NO retry
      }

    } catch (err) {
      console.error('[Sync] Push error:', err);
      this._retryCount++;

      if (this._retryCount <= this._maxRetries) {
        this._showStatus(`Sync failed, retrying (${this._retryCount}/${this._maxRetries})...`, 'warning');
        const delay = 2000 * this._retryCount;
        // T3-02: Keep lock held during retry delay — call push(true) to skip lock check
        this._syncRetryTimer = setTimeout(() => {
          this._syncRetryTimer = null;
          this.push(true);  // _isRetry=true: re-enters push without releasing/re-acquiring lock
        }, delay);
        this._skipLockRelease = true;
      } else {
        this._showStatus('Sync failed — will retry later', 'error');
        Sync._setPending(true);  // G-F4
        this._retryCount = 0;
      }
    } finally {
      if (!this._skipLockRelease) {
        this._syncLock = false;
        this._drainSyncQueue();  // Wave L2r1 (GPT P2): run a manual/reconnect cycle that collided with this raw push
      }
      this._skipLockRelease = false;
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
    if (this._syncLock) {
      console.log('[Sync] Sync already in progress, skipping pull.');
      return;
    }

    this._syncLock = true;
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
        // Gemini-1: no new rows, but still advance the cursor to the server watermark so quiet
        // systems don't re-query the same range every cycle (sync stagnation).
        if (watermark) { const wmTs = typeof watermark === 'number' ? watermark : new Date(watermark).getTime(); if (!isNaN(wmTs) && wmTs > 0) { this._lastSyncAt = Math.max(this._lastSyncAt, wmTs); try { localStorage.setItem('bob_last_sync', String(this._lastSyncAt)); } catch(e) {} } }
        return;  // No new rows (cursor advanced)
      }

      console.log(`[Sync] Pull received ${allItems.length} total items from SharePoint.`);

      const local = DB.get();
      const localIds = new Set((local.transactions || []).map(t => t.id));

      // Diagnostic: count overlap/replay rows (items in the lookback window already known locally)
      // This helps verify the lookback margin is working and can be tuned later.
      let overlapCount = 0;
      const quarantined = [];  // F1-H01: negative-qty remote rows skipped at ingest

      // Separate tombstones from regular transactions
      const tombstones = [];
      const newTransactions = [];

      for (const spItem of allItems) {
        if (!spItem || typeof spItem !== 'object' || !spItem.TransactionId) continue;  // SA-C-F2: skip null/garbage rows (don't throw -> don't stall the device's sync)

        // Wave J (Tier 3 — stored XSS): validate the raw row's ids BEFORE the tombstone split. Ledger
        // ids render into inline handlers; a hostile TransactionId/TargetTransactionId/TransferId from
        // the cloud would execute. MUST be checked here, not only in _fromSharePoint, because tombstone
        // rows skip _fromSharePoint (the `Type==='deleted'` continue just below). Quarantine the row.
        if (typeof Stock !== 'undefined' && Stock._isSafeLedgerId) {
          const _idBad = ['TransactionId', 'TargetTransactionId', 'TransferId'].some(f => spItem[f] != null && spItem[f] !== '' && !Stock._isSafeLedgerId(String(spItem[f])));
          if (_idBad) { quarantined.push(spItem.TransactionId); continue; }
        }

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

        // F1-H01 (GPT FINAL H-01): stock movements are never negative. A negative
        // remote row would sit in the ledger while the stock cache skips it, so
        // ledger/reports/cache disagree forever. _fromSharePoint returns null for
        // such rows — quarantine loudly, never coerce.
        if (!localTxn || localTxn.qty < 0) {
          quarantined.push(String(spItem.TransactionId));
          continue;
        }
        newTransactions.push(localTxn);
      }

      if (quarantined.length > 0) {
        console.warn(`[Sync] QUARANTINED ${quarantined.length} remote row(s) (negative qty or unsafe ledger id — admin: fix at source): ${quarantined.join(', ')}`);
        try { if (typeof Diag !== 'undefined') Diag.log('sync', `quarantined ${quarantined.length} negative-qty remote rows: ${quarantined.join(', ')}`); } catch (e) {}
      }

      if (overlapCount > 0) {
        console.log(`[Sync] Lookback overlap: ${overlapCount} rows already known locally (deduped). Margin: ${this.PULL_LOOKBACK_MS}ms`);
      }

      let changed = false;
      let tombstoneDurable = true;  // SA-G-F3: gate the cursor on durable tombstone removal

      // Wave I (Tier 2 / I-5 — ghost resurrection): merge new transactions FIRST, THEN apply
      // tombstones against the POST-merge ledger. The old order (tombstones first, gated on the
      // pre-merge localIds) dropped a same-batch create+delete: the tombstone's target wasn't local
      // yet, so the delete was skipped and the create then merged = resurrected row.
      // Merge new transactions — DURABLE (MFL-001): the pull cursor must NOT advance past rows that
      // aren't durably persisted, or those stock movements are lost forever.
      let mergeDurable = true;
      if (newTransactions.length > 0) {
        mergeDurable = await DB.addTransactionsDurable(newTransactions, { remote: true });  // L2r1 (GPT P3): remote rows already _synced — don't schedule a redundant push
        if (mergeDurable) {
          console.log(`[Sync] Merged ${newTransactions.length} new transactions from remote.`);
          changed = true;
        } else {
          console.error('[Sync] Durable persist of merged rows FAILED — leaving cursor unchanged so they re-pull next cycle.');
        }
      }

      // Apply tombstones against the CURRENT ledger (post-merge), by TargetTransactionId ONLY
      // (Wave I: dropped the `|| ts.TransactionId` fallback — a tombstone deletes its explicit target).
      if (tombstones.length > 0) {
        for (const ts of tombstones) {
          const originalId = ts.TargetTransactionId;
          if (!originalId) continue;  // malformed tombstone — skip; not a cursor blocker
          const _orig = DB.get().transactions.find(t => t.id === originalId);
          if (!_orig) continue;  // target not present (already deleted / never seen) — NO-OP, must NOT block the cursor (Wave I, GPT)
          // SA-G-F3: durable removal — if the delete isn't persisted, don't advance the cursor.
          const _okDel = await DB.removeTransactionDurable(originalId, { skipTombstone: true });
          if (!_okDel) { tombstoneDurable = false; continue; }
          // MFL-004: record the deletion in THIS device's audit log from the synced metadata
          if (DB.addDeletedTransaction && !((DB.get().deletedTransactions || []).some(x => x.id === originalId))) {
            DB.addDeletedTransaction(Object.assign({}, _orig, {
              _deletedBy: ts.DeletedBy || '', _deletedAt: ts.DeletedAt || new Date().toISOString(), _deleteReason: ts.DeleteReason || ''
            }));
          }
          console.log(`[Sync] Tombstone applied: removed transaction ${originalId}`);
          changed = true;
        }
      }

      if (changed) {
        DB.commit();
        this._rerender();
        this._notifyFollowers();
      }

      // MFL-001: advance the cursor ONLY if the merged rows were durably persisted.
      if (!mergeDurable || !tombstoneDurable) {  // SA-G-F3
        this._showStatus('Data may be stale — will retry', 'warning');
        return;
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
          // MFL-008: clamp — never let a stale/older server watermark move the cursor backwards
          this._lastSyncAt = Math.max(this._lastSyncAt, wmTs);
        } else {
          this._lastSyncAt = Math.max(this._lastSyncAt, Date.now());
        }
      } else {
        this._lastSyncAt = Math.max(this._lastSyncAt, Date.now());
      }
      localStorage.setItem('bob_last_sync', String(this._lastSyncAt));

      // Clear any stale-data warning since sync succeeded
      this._showStatus('Synced \u2713', 'success'); this._stampUiSync();

    } catch (err) {
      console.error('[Sync] Pull error:', err);
      this._showStatus('Data may be stale \u2014 last sync failed', 'warning', 0);
    } finally {
      this._syncLock = false;
      this._drainSyncQueue();  // Wave L2r1 (GPT P2): run a manual/reconnect cycle that collided with this raw pull
    }
  },

  // ─── Tombstone handling (Wave I / Tier 2) ───────────────────────────
  // The separate Sync.pushTombstone fetch path was REMOVED. A delete now writes a durable
  // tombstone row (type:'deleted' + targetTransactionId + DeletedBy/At/Reason) ATOMICALLY with
  // the delete (DB._makeTombstone / removeTransactionDurable), with _synced:false. The normal
  // push() drains it — egress whitelists it (_egressOk), the strict processedCount ack + retry +
  // offline-queue all apply, and there is no no-URL drop (it just waits like any unsynced row).
  // Followers: the durable row + the 'local-write' leader-refresh (and leader poll() draining
  // pending) propagate it — no tombstone-specific BroadcastChannel message.

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
    Sync._setPending(true);
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

  // Wave L2 (#3, GPT+Gemini convergent design): the entry point for the manual "Sync now" button AND
  // auto-sync-on-reconnect. The single-syncer invariant MUST hold — _syncLock is PER-TAB (in-memory), so
  // a follower must NOT run push()/pull() directly while the leader polls (duplicate pushes, concurrent
  // pulls, cursor/status regression). The LEADER owns the cycle; a follower DELEGATES over BroadcastChannel.
  // If no live leader responds, this tab claims leadership (existing election path) and runs it itself.
  async syncNow() {
    if (this._isLeader) return this._runSyncCycle();
    // Follower: ask the leader to run the cycle; it broadcasts 'db-updated' when done → our cache refreshes.
    if (this._bc) { try { this._bc.postMessage({ type: 'request-sync', tabId: this._tabId }); } catch (e) {} }
    const leaderAlive = this._lastLeaderPing > 0 && (Date.now() - this._lastLeaderPing) < this.LEADER_TIMEOUT;
    if (!leaderAlive) { this._becomeLeader(); return this._runSyncCycle(); }  // no leader → promote + run
    this._showStatus('Syncing…', 'info', 2500);  // transient; the leader surfaces the real progress
    return { ok: true, delegated: true };
  },
  // Leader-only: serialise the manual push→pull cycle ("send my work, then catch up"). If one is already
  // running, queue EXACTLY ONE follow-up rather than overlapping (or dropping a genuinely newer request).
  // Wave L2r1 (GPT P2): ALSO queue when _syncLock is held by a RAW push()/pull() (a background poll or the
  // scheduleSync debounce) — those hold _syncLock WITHOUT setting _syncing, so without this guard the cycle's
  // own push/pull would both silently skip and the manual/reconnect sync would no-op while reporting success.
  async _runSyncCycle() {
    if (this._syncing || this._syncLock) { this._syncQueued = true; return { ok: true, queued: true }; }
    this._syncing = true;
    try {
      do {
        this._syncQueued = false;
        await this.push();   // local → server first
        await this.pull();   // then server → local
      } while (this._syncQueued);
    } finally { this._syncing = false; }
    return { ok: true };
  },
  // Wave L2r1 (GPT P2 fix): a raw push()/pull() (the background poll or the scheduleSync debounce) holds
  // _syncLock WITHOUT setting _syncing. A manual "Sync now" / reconnect cycle that arrives in that window
  // queues itself (see the _runSyncCycle guard) instead of silently no-opping; this runs that ONE queued
  // cycle the moment the raw op releases the lock. Guarded on !_syncing so an in-flight cycle's own
  // push/pull releases don't re-enter (the do-while already drains requests that arrive mid-cycle).
  _drainSyncQueue() {
    if (this._syncQueued && !this._syncing) {
      this._syncQueued = false;
      this._runSyncCycle();
    }
  },

  // Wave H (H3 / GPTa-31, GPTa-32): a bounded proactive retry for the push paths that leave the
  // batch unsynced+pending without an immediate re-push (markSynced-fail + ambiguous ack). Fires
  // AFTER the current push()'s finally releases the lock, then routes through the normal debounced
  // scheduleSync() — no lock juggling. Bounded so a persistently-failing local write doesn't spin
  // forever; the rows still re-push on the next user write or pull cycle. Reset on a clean sync.
  _scheduleSyncRetry() {
    if (this._markRetryTimer) return;
    if ((this._markRetryCount || 0) >= 5) { this._markRetryCount = 0; return; }
    this._markRetryCount = (this._markRetryCount || 0) + 1;
    this._markRetryTimer = setTimeout(() => {
      this._markRetryTimer = null;
      this.scheduleSync();
    }, 3000);
  },

  /**
   * Periodic poll for remote changes.
   */
  async poll() {
    await this.pull();
    // Wave I (Tier 2, GPT): the leader's periodic poll also DRAINS pending writes. A delete now
    // writes a durable tombstone row + relies on the 'local-write' BroadcastChannel signal to make
    // the leader push it — but that signal can be missed (backgrounded/closed follower tab). Pushing
    // on poll guarantees any unsynced row (incl. a tombstone) is eventually sent, with no
    // tombstone-specific path. Leader-only + lock-guarded; a clean cycle with nothing pending is a no-op.
    if (this._isLeader && this._getPending && this._getPending()) {
      try { await this.push(); } catch (e) { /* push handles its own retry/status */ }
    }
  },

  // ─── Initialization ─────────────────────────────────────────────────

  /**
   * Initializes the sync system. Called after DB is ready.
   *
   * Tier 2 Fix #15: Uses leader election so only one tab runs sync.
   * All tabs load config, but only the leader starts push/pull/polling.
   */
  async init() {
    // Try remote config first (self-configuring), fall back to sessionStorage cache
    let hasConfig = await this._fetchRemoteConfig();
    if (!hasConfig) {
      // Fall back to cached sessionStorage config (within same session)
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
    if (Sync._getPending()) {
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
    return this._syncLock;
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
