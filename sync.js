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
  STALE_THRESHOLD: 12 * 60 * 60 * 1000,
  POLL_INTERVAL: 30000,
  DEBOUNCE_MS: 800,
  _loadConfig() { try { const raw = localStorage.getItem('bob_sync_config'); if (!raw) return false; const config = JSON.parse(raw); this._pushUrl = config.pushUrl || null; this._pullUrl = config.pullUrl || null; return !!(this._pushUrl && this._pullUrl); } catch (e) { return false; } },
};