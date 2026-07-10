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
  _lastSyncId: 0,   // Azure pull-hardening: ID-cursor (max SharePoint item ID merged). Replaces the
                    // SyncTimestamp watermark as the pull cursor (bob_last_sp_id). See AZURE-PULL-HARDENING-SPEC.md.
  // Azure Chunk 4 — record-steps sync (transfers/deliveries/stock-takes). Separate endpoints + ID-cursor
  // (bob_last_step_sp_id) from the ledger. Steps sync is ENABLED only when both URLs are present in config;
  // otherwise it's a graceful no-op (old config / pre-Chunk-4 = ledger-only, unchanged).
  _stepsPushUrl: null,
  _stepsPullUrl: null,
  _lastStepSyncId: 0,
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

  // ─── Chunk 5: cloud-boundary authorization (AZURE-CHUNK5-SCOPE.md REV 2) ────
  // Keys travel in the request BODY as an `auth` envelope (NOT headers — custom headers
  // trigger a CORS preflight whose Logic App handling is a deploy risk; body fields are
  // CORS-neutral and the server hides the whole trigger body via secureData). Build
  // deviation from the spec's "header" wording — flagged in the wave review.
  // Keys persist in localStorage (device possession = the credential, D2d); they are
  // NEVER in backups (the backup reads DB data, and _REUSABLE_AUTH_KEYS scrubs any
  // embedded copies) and NEVER in Diag (bsk_/bdk_ redaction).
  _authRequired: null,   // per-endpoint flags advertised by config (D6 phase 1); null = not advertised
  _unauthorized: false,  // a 401 was received; sync paused until keys change (NO retry-loop)

  _authKeys() {
    try {
      return {
        storeId: localStorage.getItem('bob_auth_store_id') || '',
        storeKey: localStorage.getItem('bob_auth_store_key') || '',
        directorKey: localStorage.getItem('bob_auth_director_key') || '',
      };
    } catch (e) { return { storeId: '', storeKey: '', directorKey: '' }; }
  },

  hasAuthKeys() {
    const k = this._authKeys();
    return !!(k.storeKey || k.directorKey);
  },

  // Wrap an outgoing request body with the auth envelope (only when keys exist, so a
  // pre-Chunk-5 server — or the D6 phase-1 window — sees an unchanged request shape).
  _withAuth(body) {
    const k = this._authKeys();
    if (!k.storeKey && !k.directorKey) return body;
    const auth = { deviceId: this._deviceId || '' };
    if (k.storeId) auth.storeId = k.storeId;
    if (k.storeKey) auth.storeKey = k.storeKey;
    if (k.directorKey) auth.directorKey = k.directorKey;
    return Object.assign({}, body, { auth });
  },

  // ─── Chunk 9: person auth-proofs (key-card model, Codex R1) ─────────────────────────────────────────
  // The user's PASSWORD transits ONLY at login/sudo (to _userVerifyUrl). On success the server mints a
  // short-lived signed PROOF; sensitive requests carry the proof, never the password. Proofs live in MEMORY
  // ONLY (never localStorage/sessionStorage/Dexie/backup). Wiped on lock/logout.
  _userVerifyUrl: null, _userAdminUrl: null,   // from sync_config
  _sessionProof: null,                          // { proof, role, username, expiresAt } - the 12h background proof
  _deviceContext() { const k = this._authKeys(); return k.directorKey ? '__director' : (k.storeId || ''); },

  // Log in a person: device keys (Chunk 5) + username/password -> server verify -> session proof in memory.
  // Returns {ok, role} | {ok:false, reason:'device'|'invalid'|'offline'|'config'}. The caller (Auth) also
  // caches an OFFLINE local verifier (PBKDF2) so subsequent launches can log in without the cloud.
  async personLogin(username, password) {
    if (!this._userVerifyUrl) return { ok: false, reason: 'config' };
    let resp;
    try {
      resp = await fetch(this._userVerifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._withAuth({ user: { username: String(username || ''), password: String(password || ''), purpose: 'session' } })) });
    } catch (e) { return { ok: false, reason: 'offline' }; }
    if (resp.status === 401) { let j = {}; try { j = await resp.json(); } catch (e) {} return { ok: false, reason: j.reason === 'device_unauthorized' ? 'device' : 'invalid' }; }
    if (!resp.ok) return { ok: false, reason: 'offline' };
    const j = await resp.json();
    if (j.status === 'ok' && j.proof) {
      this._sessionProof = { proof: j.proof, role: j.role, username: j.username, expiresAt: j.expiresAt };
      return { ok: true, role: j.role };
    }
    return { ok: false, reason: 'invalid' };
  },

  // Mint a short-TTL, purpose-bound SUDO proof (publish/archive/user-admin/backup/approve/resolve/delivery/
  // adjustment). Requires the password AGAIN (D9-6 re-prompt) — never reuses the session proof for privileged
  // actions. Returns the proof string or null.
  async sudo(purpose, password) {
    if (!this._userVerifyUrl) return null;
    // Prefer the CURRENTLY logged-in user (Auth.user) over the session-proof pointer — a sudo action must
    // always target the person at the keyboard, never a stale/other _sessionProof username.
    const username = (typeof Auth !== 'undefined' && Auth.user() && Auth.user().username) || (this._sessionProof && this._sessionProof.username) || '';
    let resp;
    try {
      resp = await fetch(this._userVerifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._withAuth({ user: { username, password: String(password || ''), purpose } })) });
    } catch (e) { return null; }
    if (!resp.ok) return null;
    const j = await resp.json();
    return (j.status === 'ok' && j.proof) ? j.proof : null;
  },

  // The logged-in person's username (so a gated LA can read the right UserCredentials row to verify the proof
  // against — a lie here just fails, since verifyProof matches the proof's signed username to the row).
  _actorUsername() { return (this._sessionProof && this._sessionProof.username) || (typeof Auth !== 'undefined' && Auth.user() && Auth.user().username) || ''; },

  // Attach the session proof to a sensitive request body (background gated reads: corp-costs, archive-pull).
  _withPerson(body) {
    const b = this._withAuth(body);
    b.actorUsername = this._actorUsername();
    if (this._sessionProof && this._sessionProof.proof && this._sessionProof.expiresAt > Date.now()) b.proof = this._sessionProof.proof;
    return b;
  },

  // ── AA-W5: server-validated 24h PIN grant + action proofs for ingest validation ─────────────────────
  // Under an ACTIVE access policy the PIN hash lives ONLY server-side (policy.pin, stripped from delivery);
  // entering the PIN verifies online and mints a purpose='pin-grant' proof the ingest LAs demand on
  // staff-role stock-take/receive rows (matrix D5 / LA-CHANGES §3-4/§9). Memory-only, wiped with the rest.
  _pinGrantProof: null,   // { proof, expiresAt }
  async pinUnlock(pin) {
    if (!this._userVerifyUrl) return { ok: false, reason: 'config' };
    let resp;
    try {
      resp = await fetch(this._userVerifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this._withAuth({ op: 'pin', pin: String(pin || ''), actorUsername: this._actorUsername() })) });
    } catch (e) { return { ok: false, reason: 'offline' }; }
    if (!resp.ok) return { ok: false, reason: 'denied' };
    const j = await resp.json().catch(() => ({}));
    if (j.ok === true && j.proof) { this._pinGrantProof = { proof: j.proof, expiresAt: Number(j.expiresAt) || 0 }; this._relayProof({ kind: 'pin', proof: j.proof, expiresAt: Number(j.expiresAt) || 0 }); return { ok: true, expiresAt: j.expiresAt }; }  // AA-07: relay the pin-grant to the leader
    return { ok: false, reason: 'denied' };
  },
  // Short-lived purpose-bound proofs minted at ACTION time (approve/resolve/delivery — D9-8 closure).
  // Held ≤5 min (the proof TTL) purely so the imminent debounced push can attach them.
  _actionProofs: {},
  holdActionProof(purpose, proof) {
    if (typeof proof === 'string' && proof && proof !== '__no_person_auth__' && proof !== '__session_ok__') {
      this._actionProofs[purpose] = { proof, at: Date.now() };
      this._relayProof({ kind: 'action', purpose, proof });   // AA-07: reach the leader tab (the only pusher)
    }
  },
  // AA-07: privileged actions can happen in a NON-leader tab, but only the leader pushes. Relay the freshly
  // minted proof to the leader IN MEMORY (BroadcastChannel — never persisted) so _withIngestProofs on the
  // leader attaches it; otherwise the row pushes proof-less and gets permanently quarantined post-activation.
  // Same origin = same logged-in user, so cross-tab relay stays within the account (P-13).
  _relayProof(msg) { try { if (this._bc && !this._isLeader) this._bc.postMessage({ type: 'proof-relay', tabId: this._tabId, payload: msg }); } catch (e) {} },
  _acceptRelayedProof(msg) {
    if (!this._isLeader || !msg) return;                       // only the pusher stores relayed proofs
    if (msg.kind === 'action' && typeof msg.purpose === 'string') this.holdActionProofLocal(msg.purpose, msg.proof);
    else if (msg.kind === 'pin' && typeof msg.proof === 'string') this._pinGrantProof = { proof: msg.proof, expiresAt: Number(msg.expiresAt) || 0 };
  },
  holdActionProofLocal(purpose, proof) {   // store WITHOUT re-broadcasting (avoids a relay loop)
    if (typeof proof === 'string' && proof) this._actionProofs[purpose] = { proof, at: Date.now() };
  },
  // Attach person material to an INGEST request (push / steps-push): session proof + actor (as _withPerson),
  // any live pin-grant, and the fresh action proofs. The LAs validate per row/step type (LA-CHANGES §3-4);
  // extra fields are ignored by pre-AA endpoints, so this is inert until enforcement flips.
  _withIngestProofs(body) {
    const b = this._withPerson(body);
    if (this._pinGrantProof && this._pinGrantProof.proof && this._pinGrantProof.expiresAt > Date.now()) b.pinProof = this._pinGrantProof.proof;
    const live = {};
    for (const [p, e] of Object.entries(this._actionProofs)) { if (e && (Date.now() - e.at) < 5 * 60 * 1000) live[p] = e.proof; else delete this._actionProofs[p]; }
    if (Object.keys(live).length) b.sudoProofs = live;
    return b;
  },

  // Wipe every in-memory person credential (lock/logout). Session proof + pin grant + action proofs.
  clearPersonProofs() { this._sessionProof = null; this._pinGrantProof = null; this._actionProofs = {}; },

  // Director user management via the gated user-admin LA (Chunk 9, D9-2). op = create|setPassword|deactivate|
  // activate|setRole|unlock|list. Requires a purpose='user-admin' sudo proof (the caller mints it). Returns the
  // parsed response {status,...} or {status:'error', reason}. Returns {reason:'config'} if not configured.
  async userAdmin(op, data, sudoProof) {
    if (!this._userAdminUrl) return { status: 'error', reason: 'config' };
    let resp;
    try {
      const body = this._withAuth({ op, data: data || {} });
      body.actorUsername = this._actorUsername();
      if (sudoProof) body.proof = sudoProof;
      resp = await fetch(this._userAdminUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { return { status: 'error', reason: 'offline' }; }
    if (resp.status === 401) { return { status: 'error', reason: 'device' }; }
    if (resp.status === 403) { return { status: 'error', reason: 'person' }; }
    const j = await resp.json().catch(() => ({ status: 'error', reason: 'bad_response' }));
    j._http = resp.status;
    return j;
  },
  personAuthActive() { return !!this._userAdminUrl && !!this._userVerifyUrl; },

  // Central 401 handling (D6): clear the cached config (it may be stale), mark the
  // device unauthorised, surface it, and STOP — never a retry-loop on auth failure.
  _handleUnauthorized(where) {
    this._unauthorized = true;
    try { sessionStorage.removeItem('bob_sync_config'); } catch (e) {}
    this._showStatus('Sync not authorised — enter sync keys in Settings', 'error', 0);
    try { if (typeof Diag !== 'undefined') Diag.log('auth', '401 unauthorized from ' + where); } catch (e) {}
    console.warn('[Sync] 401 unauthorized from ' + where + ' — sync paused until keys change.');
  },

  // Director enters keys in Settings → persist, clear the pause, re-bootstrap.
  async saveAuthKeys(storeId, storeKey, directorKey) {
    try {
      localStorage.setItem('bob_auth_store_id', String(storeId || '').trim());
      localStorage.setItem('bob_auth_store_key', String(storeKey || '').trim());
      localStorage.setItem('bob_auth_director_key', String(directorKey || '').trim());
    } catch (e) { return false; }
    this._unauthorized = false;
    const ok = await this._fetchRemoteConfig();
    if (ok) this.scheduleSync();
    return ok;
  },

  // ─── Chunk 6: catalogue publish (up) + corporate-cost read (gated) ──────────
  // The catalogue DOWN-merge (_applyMasterData) is unchanged + already audited. Chunk 6 adds the UPWARD
  // publish and the SEPARATE gated corporate-cost read. URLs come from sync_config (like the others).
  _catalogueWriteUrl: null,
  _corpCostsUrl: null,
  _archivePullUrl: null,  // Chunk 8: Director/HO on-demand read of archived movements for full-history reports

  // Dirty tracking: which catalogue rows a Director changed since the last successful publish. Stored as a
  // localStorage set of "coll:id" (public rows) + "cost:productId" (cost changes). baseRv is read from the
  // row's own _rv (set by the last master_data merge) at publish time — a new row has no _rv -> baseRv 0.
  _catDirtyKey: 'bob_catalogue_dirty',
  _markCatalogueDirty(coll, id) {
    try {
      const set = new Set(JSON.parse(localStorage.getItem(this._catDirtyKey) || '[]'));
      set.add(coll + ':' + id);
      localStorage.setItem(this._catDirtyKey, JSON.stringify([...set]));
    } catch (e) {}
  },
  _catalogueDirty() { try { return JSON.parse(localStorage.getItem(this._catDirtyKey) || '[]'); } catch (e) { return []; } },
  _clearCatalogueDirty(keys) {
    try {
      const set = new Set(this._catalogueDirty());
      (keys || []).forEach(k => set.delete(k));
      localStorage.setItem(this._catDirtyKey, JSON.stringify([...set]));
    } catch (e) {}
  },
  hasUnpublishedCatalogue() { return this._catalogueDirty().length > 0; },

  // Build the publish payload from the dirty set: public `changes` (products/stores/categories/productTypes,
  // cost STRIPPED — cost never rides the public path) + `costChanges` (product cost only).
  _buildCataloguePayload() {
    const d = DB.get(); if (!d) return { changes: [], costChanges: [], keys: [] };
    const changes = [], costChanges = [], keys = [];
    for (const k of this._catalogueDirty()) {
      const [coll, ...rest] = k.split(':'); const id = rest.join(':');
      if (coll === 'cost') {
        const p = (d.products || []).find(x => x && x.id === id);
        if (p && p.costPrice != null) { costChanges.push({ productId: id, costPrice: p.costPrice, baseRv: Number(p._costRv) || 0 }); keys.push(k); }
      } else if (['products', 'stores', 'categories', 'productTypes'].includes(coll)) {
        const row = (d[coll] || []).find(x => x && x.id === id);
        if (row) {
          const clean = {}; Object.keys(row).forEach(f => { if (f !== 'costPrice' && f !== '_costRv') clean[f] = row[f]; });  // cost never in the public path
          changes.push({ coll, row: clean, baseRv: Number(row._rv) || 0 }); keys.push(k);
        }
      }
    }
    return { changes, costChanges, keys };
  },

  // Director presses "Publish catalogue" -> push the deltas, honest result, clear only what landed.
  // Chunk 9: publishing is a SUDO action — the caller passes a fresh purpose='publish' proof (from a password
  // re-prompt). When person-auth is enforced (server advertises userVerifyUrl), no proof = fail closed.
  async publishCatalogue(sudoProof) {
    if (!this._catalogueWriteUrl) return { ok: false, error: 'Catalogue publishing is not configured on this device.' };
    if (this._userVerifyUrl && !sudoProof) return { ok: false, error: 'Password confirmation required to publish.', needSudo: true };
    const { changes, costChanges, keys } = this._buildCataloguePayload();
    if (!changes.length && !costChanges.length) return { ok: true, nothing: true };
    let resp;
    try {
      const body = this._withAuth({ data: { changes, costChanges } });
      if (sudoProof) body.proof = sudoProof;
      body.actorUsername = this._actorUsername();
      resp = await fetch(this._catalogueWriteUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { return { ok: false, error: 'Network error — try again.' }; }
    if (resp.status === 403) return { ok: false, error: 'Password confirmation was rejected — try again.', needSudo: true };
    if (resp.status === 401) { this._handleUnauthorized('catalogue-write'); return { ok: false, unauthorized: true }; }
    if (!resp.ok) return { ok: false, error: 'Publish failed (' + resp.status + ') — try again.' };
    const r = await resp.json().catch(() => ({}));
    // GPT-C6-1 defence-in-depth: a 'write_failed' means the server could NOT durably persist (it exhausted its
    // If-Match retries) — accepted is empty and NOTHING landed. Do NOT clear any dirty keys; the Director
    // retries. The server already returns accepted=[] on write_failed, but gate on status too so a rejected/
    // conflicted row (status ok) still only clears the rows the server actually accepted.
    const durable = r.status === 'ok';
    const accepted = new Set(((durable ? r.accepted : []) || []).map(String));
    // Clear ONLY the dirty keys the server accepted (a rejected/conflicted row stays dirty for the Director to fix/retry).
    const landed = keys.filter(k => { const [coll, ...rest] = k.split(':'); const id = rest.join(':'); return coll === 'cost' ? accepted.has('cost:' + id) : accepted.has(id); });
    this._clearCatalogueDirty(landed);
    if (durable && r.masterVersion != null) { try { localStorage.setItem('bob_catalogue_last_published', JSON.stringify({ version: r.masterVersion, at: Date.now() })); } catch (e) {} }
    return { ok: durable, writeStatus: r.status, accepted: r.accepted || [], rejected: r.rejected || [], conflicts: r.conflicts || [], retry: !durable };
  },
  lastPublished() { try { return JSON.parse(localStorage.getItem('bob_catalogue_last_published') || 'null'); } catch (e) { return null; } },

  // AA-W4: publish a proposed access_policy to the gated write LA. FAIL CLOSED like publishCatalogue:
  // when person-auth is live, no sudo proof = no network call (SR-1 — policy edits are always-password).
  // The server (policyMerge) validates schema/floor and bumps the version; we never mint one locally.
  async publishAccessPolicy(proposed, sudoProof, pinPlain, pinClear) {
    if (!this._accessPolicyWriteUrl) return { ok: false, reason: 'no-endpoint' };
    if (this._userVerifyUrl && (!sudoProof || sudoProof === '__no_person_auth__')) return { ok: false, reason: 'needSudo' };
    // AA-03: optimistic concurrency — the server rejects the write if the policy moved since we adopted, so
    // a second Director (or the PIN-set path building from a stale draft) can't silently drop the first's edit.
    const baseVersion = (typeof Auth !== 'undefined' && Auth.policyVersion) ? Auth.policyVersion() : 0;
    const body = { proposed, actorUsername: this._actorUsername(), baseVersion };
    if (sudoProof && sudoProof !== '__no_person_auth__') body.proof = sudoProof;
    if (typeof pinPlain === 'string' && pinPlain) body.pinPlain = pinPlain;
    if (pinClear === true) body.pinClear = true;
    let resp;
    try { resp = await fetch(this._accessPolicyWriteUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this._withAuth(body)) }); }
    catch (e) { return { ok: false, reason: 'offline' }; }
    if (resp.status === 401) { this._handleUnauthorized('access-policy-write'); return { ok: false, reason: 'device' }; }
    if (resp.status === 403) return { ok: false, reason: 'person' };
    const r = await resp.json().catch(() => ({}));
    return { ok: r.ok === true, version: r.version, reason: r.reason };
  },

  // Is THIS device corporate (gets central cost) or a franchise store (keeps its own cost)? A Director device
  // (no store id) is corporate. A store device is corporate iff its store isFranchise !== true.
  _isCorporateDevice() {
    const k = this._authKeys();
    if (k.directorKey && !k.storeId) return true;              // Director personal device
    if (!k.storeId) return true;                                // unbound (pre-auth) — treat as corporate (HO/office)
    const s = (DB.get().stores || []).find(x => x && x.id === k.storeId);
    return !(s && s.isFranchise === true);
  },

  // Fetch + apply corporate cost — ONLY on a corporate device (a franchise device never even calls it; the
  // server would 403 anyway). Sets local product.costPrice from the gated payload; franchise devices keep
  // their own local cost untouched.
  async _fetchCorporateCosts() {
    if (!this._corpCostsUrl) return;
    if (!this._isCorporateDevice()) return;                     // franchise device: keep local cost, don't fetch
    // AA-W3: under an adopted policy the ACCOUNT must hold seeCost — the server 403s regardless (SR-10);
    // this avoids fetching + caching a payload the logged-in user can't view. Logged-out: device rule stands.
    if (typeof Auth !== 'undefined' && Auth._policy && Auth.user && Auth.user() && !Auth.can('seeCost')) return;
    let resp;
    try { resp = await fetch(this._corpCostsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this._withPerson({})) }); }  // Chunk 9: session proof
    catch (e) { return; }
    if (!resp.ok) return;                                       // 403 (unexpected on a corporate device) -> keep local cost
    const r = await resp.json().catch(() => ({}));
    const costs = (r.corporate_costs && Array.isArray(r.corporate_costs.costs)) ? r.corporate_costs.costs : null;
    if (!costs) return;
    await this._applyCorporateCosts(costs);
  },
  async _applyCorporateCosts(costs) {
    const d = DB.get(); if (!d || !Array.isArray(d.products)) return;
    let changed = false;
    const byId = new Map(d.products.map(p => [p && p.id, p]));
    costs.forEach(c => {
      if (!c || typeof c.productId !== 'string') return;
      const p = byId.get(c.productId); if (!p) return;
      const val = (typeof Validate !== 'undefined') ? Validate.money(c.costPrice, { optional: true }) : { ok: Number.isFinite(Number(c.costPrice)), value: Number(c.costPrice) };
      if (!val.ok) return;
      if (p.costPrice !== val.value || p._costRv !== c._rv) { p.costPrice = val.value; p._costRv = c._rv; changed = true; }
    });
    if (changed) { try { await DB.commitDurable(); } catch (e) {} if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) Stock._invalidateThrMap(); this._rerender(); }
  },

  // ── AA-W3: access_policy adoption + SR-4 narrowing purge ──────────────────────────────────────────
  // Version-monotonic adopt of the server-published policy blob. On a bump that REVOKES seeCost/seeArchive
  // for the logged-in account, the now-unauthorized cached data is purged: the merged corporate-cost
  // payload (products carrying the _costRv marker from _applyCorporateCosts) is scrubbed durably, and the
  // in-memory archive overlay is dropped. A failed durable scrub raises 'bob_policy_purge_pending' which
  // blocks backup export (same privacy lock as the Chunk-10 scope purge) and retries on the next adopt.
  // NOTE (documented): locally-recorded costHistory rows are the device's OWN data and are NOT purged;
  // the corp-costs BLOB is the "cached corporate payload" SR-4 targets. The server 403s all further cost
  // reads regardless (SR-10).
  async _applyAccessPolicy(raw) {
    let blob;
    try { blob = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (!blob || typeof blob !== 'object' || !blob.roles || typeof blob.roles !== 'object') return;
    const d = DB.get(); if (!d) return;
    const curV = (d.accessPolicy && Number(d.accessPolicy.version)) || 0;
    const newV = Number(blob.version);
    if (!Number.isFinite(newV) || newV < 0) return;                                          // AA-18: reject non-finite/negative version (can't wedge future publishes)
    if (d.accessPolicy && newV <= curV) {
      if (typeof Auth !== 'undefined' && !Auth._policy) Auth.adoptPolicy(d.accessPolicy);   // boot path: make the persisted policy live
      await this._reconcilePolicyPurge();                                                     // AA-05: clear any stuck purge even on a no-op adopt
      return;                                                                                // monotonic: never adopt a rollback
    }
    // AA-04: the narrowing decision runs off the DEVICE, not the session. The corp-cost payload
    // (_costRv-marked products) is server-granted material; if the device holds it and EITHER the logged-in
    // account loses seeCost OR we adopt while logged-OUT (the normal morning boot — can't evaluate per
    // account), purge it. An authorized device re-populates via the seeCost-gated _fetchCorporateCosts.
    // AA-20: a PIN clear/change bumps pinEpoch — drop this device's local PIN unlock so the UI matches the
    // server (which now rejects the stale grant). Instant kill on adopt, not wait-for-expiry.
    const oldEpoch = (d.accessPolicy && Number(d.accessPolicy.pinEpoch)) || 0;
    if ((Number(blob.pinEpoch) || 0) !== oldEpoch) {
      this._pinGrantProof = null;
      try { if (typeof Auth !== 'undefined') Auth._tempStockTake = null; } catch (e) {}
      try { if (typeof window !== 'undefined' && window.__clearStGrant) window.__clearStGrant(); } catch (e) {}  // clears the index.html module-scoped _stTakeUnlocked flag
    }
    const hadCostPayload = (d.products || []).some(p => p && p._costRv !== undefined);
    let lostArchive = false, lostCost = false;
    const u = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user() : null;
    if (u && typeof Auth.can === 'function') {
      const hadCost = Auth.can('seeCost'), hadArch = Auth.can('seeArchive');
      Auth.adoptPolicy(blob);
      lostCost = hadCost && !Auth.can('seeCost');
      lostArchive = hadArch && !Auth.can('seeArchive');
    } else {
      if (typeof Auth !== 'undefined' && Auth.adoptPolicy) Auth.adoptPolicy(blob);
      lostCost = hadCostPayload;                                                              // logged-out + holds cost payload ⇒ purge (device-safe)
    }
    d.accessPolicy = blob;
    let okPolicy = false;
    try { okPolicy = await DB.commitDurable(); } catch (e) {}
    if (!okPolicy) { try { localStorage.setItem('bob_policy_purge_pending', '1'); } catch (e) {} }  // AA-05(a): persist failed — force a reconcile so a reload can't silently un-narrow
    if (lostArchive) {
      try {
        if (typeof Stock !== 'undefined') Stock._archiveOverlay = null;
        if (Array.isArray(d.transactions)) d.transactions = d.transactions.filter(t => !(t && t._archived));
        if (typeof Stock !== 'undefined' && Stock._buildCache) Stock._buildCache();
      } catch (e) {}
    }
    if (lostCost) { try { localStorage.setItem('bob_policy_purge_pending', '1'); } catch (e) {} await this._purgeCostPayload(); }
    console.log('[Sync] access_policy v' + newV + ' adopted' + (lostCost || lostArchive ? ' (narrowing purge ran)' : ''));
    this._rerender();
  },
  // AA-04/AA-05: device-level cost-payload scrub with a version-independent pending flag (mirrors the
  // Chunk-10 scope purge). Removes the server-granted _costRv payload durably; a failed commit keeps
  // 'bob_policy_purge_pending' set (blocks backup export) so the next boot/pull reconcile retries.
  async _purgeCostPayload() {
    const d = DB.get(); if (!d) return true;
    let changed = false;
    (d.products || []).forEach(p => { if (p && p._costRv !== undefined) { p.costPrice = null; delete p._costRv; changed = true; } });
    if (!changed) { try { localStorage.removeItem('bob_policy_purge_pending'); } catch (e) {} return true; }
    let ok = false;
    try { ok = await DB.commitDurable(); } catch (e) {}
    try { if (ok) localStorage.removeItem('bob_policy_purge_pending'); else localStorage.setItem('bob_policy_purge_pending', '1'); } catch (e) {}
    if (typeof Stock !== 'undefined' && Stock._invalidateThrMap) Stock._invalidateThrMap();
    return ok;
  },
  // AA-05: version-independent reconciler — retries a stuck cost purge on boot + every pull, regardless of
  // the policy version (the monotonic adopt guard can't re-trigger it). Called next to _reconcileScope.
  async _reconcilePolicyPurge() {
    let pending = false;
    try { pending = localStorage.getItem('bob_policy_purge_pending') === '1'; } catch (e) {}
    if (pending) await this._purgeCostPayload();
  },

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
      this._stepsPushUrl = config.stepsPushUrl || null;  // Chunk 4
      this._stepsPullUrl = config.stepsPullUrl || null;  // Chunk 4
      this._catalogueWriteUrl = config.catalogueWriteUrl || null;  // Chunk 6
      this._corpCostsUrl = config.corpCostsUrl || null;  // Chunk 6
      this._archivePullUrl = config.archivePullUrl || null;  // Chunk 8
      this._userVerifyUrl = config.userVerifyUrl || null;  // Chunk 9
      this._userAdminUrl = config.userAdminUrl || null;  // Chunk 9
      this._accessPolicyWriteUrl = config.accessPolicyWriteUrl || null;  // AA-W4
      this._configUrl = this.CONFIG_URL;
      this._deviceId = localStorage.getItem('bob_device_id') || this._generateDeviceId();
      this._lastSyncAt = parseInt(localStorage.getItem('bob_last_sync') || '0', 10);
      this._lastSyncId = parseInt(localStorage.getItem('bob_last_sp_id') || '0', 10);  // ID-cursor (0 = full replay; safe, dedup by TransactionId)
      this._lastStepSyncId = parseInt(localStorage.getItem('bob_last_step_sp_id') || '0', 10);  // Chunk 4 step ID-cursor
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
        body: JSON.stringify(this._withAuth({})),
      });
      if (resp.status === 401) {  // Chunk 5 (D6): config now requires a key once enforcement flips
        this._handleUnauthorized('config');
        return false;
      }
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

      // Chunk 8 (ledger archival): adopt the published stock_snapshot (opening balances at a monotonic-id
      // cutoff). Stored on Stock so _buildCache can seed from it and apply only post-cutoff local rows.
      // Absent item = no archival yet (fold degenerates to summing all local rows — unchanged behaviour).
      try {
        const snapItem = data.items.find(i => i.ConfigType === 'stock_snapshot');
        if (snapItem && snapItem.ConfigData && typeof Stock !== 'undefined' && Stock._adoptSnapshot) {
          Stock._adoptSnapshot(snapItem.ConfigData);
        }
      } catch (e) {
        console.warn('[Sync] stock_snapshot adopt failed (fold falls back to full-sum):', e);
      }

      // AA-W3 (Account Access): adopt the published access_policy. Absent item = pre-activation → the
      // legacy Auth._caps seed governs (behaviour unchanged). Adoption is version-monotonic and runs the
      // SR-4 narrowing purge for the logged-in account. Failure retains the previous policy (fail closed —
      // the server enforces regardless).
      try {
        const apItem = data.items.find(i => i.ConfigType === 'access_policy');
        if (apItem && apItem.ConfigData) await this._applyAccessPolicy(apItem.ConfigData);
      } catch (e) {
        console.warn('[Sync] access_policy adopt failed (previous policy retained):', e);
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
        this._stepsPushUrl = urls.stepsPushUrl || null;  // Chunk 4 (absent on pre-Chunk-4 config = steps sync off)
        this._stepsPullUrl = urls.stepsPullUrl || null;  // Chunk 4
        this._catalogueWriteUrl = urls.catalogueWriteUrl || null;  // Chunk 6 (absent = publishing off)
        this._corpCostsUrl = urls.corpCostsUrl || null;  // Chunk 6
        this._archivePullUrl = urls.archivePullUrl || null;  // Chunk 8 (absent = archive reports off; Director/HO on-demand)
        this._userVerifyUrl = urls.userVerifyUrl || null;  // Chunk 9 (absent = person-auth off; falls back to local-only login)
        this._userAdminUrl = urls.userAdminUrl || null;  // Chunk 9
        this._accessPolicyWriteUrl = urls.accessPolicyWriteUrl || null;  // AA-W4 (absent = access-policy editing off)
        // Chunk 5 (D6 phase 1): the server advertises which endpoints will require keys.
        // If auth is coming and this device has no keys yet, tell the Director BEFORE the flag day.
        this._authRequired = urls.authRequired || null;
        if (this._authRequired && !this.hasAuthKeys()) {
          this._showStatus('Sync keys required soon — enter them in Settings', 'warning', 0);
        }
        this._configUrl = this.CONFIG_URL;
        // Cache in sessionStorage — SAS URLs must not persist across sessions (Tier 1 Fix #5)
        sessionStorage.setItem('bob_sync_config', JSON.stringify({
          pushUrl: urls.pushUrl,
          pullUrl: urls.pullUrl,
          emailUrl: urls.emailUrl || null,
          stepsPushUrl: urls.stepsPushUrl || null,
          stepsPullUrl: urls.stepsPullUrl || null,
          catalogueWriteUrl: urls.catalogueWriteUrl || null,  // Chunk 6
          corpCostsUrl: urls.corpCostsUrl || null,  // Chunk 6
          archivePullUrl: urls.archivePullUrl || null,  // Chunk 8
          userVerifyUrl: urls.userVerifyUrl || null,  // Chunk 9
          userAdminUrl: urls.userAdminUrl || null,  // Chunk 9
          accessPolicyWriteUrl: urls.accessPolicyWriteUrl || null,  // AA-W4
          configUrl: this.CONFIG_URL
        }));
        this._deviceId = localStorage.getItem('bob_device_id') || this._generateDeviceId();
        this._lastSyncAt = parseInt(localStorage.getItem('bob_last_sync') || '0', 10);
        this._lastSyncId = parseInt(localStorage.getItem('bob_last_sp_id') || '0', 10);  // ID-cursor
        this._lastStepSyncId = parseInt(localStorage.getItem('bob_last_step_sp_id') || '0', 10);  // Chunk 4
        // Chunk 6: apply corporate cost (gated) ON TOP of the public catalogue — corporate/Director devices
        // only; a franchise device skips it and keeps its own local cost. Fire-and-forget so config load
        // isn't blocked; it re-renders when the cost lands.
        this._fetchCorporateCosts().catch(() => {});
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
        if (k === 'costPrice') return;  // Chunk 6 (D-COST): cost NEVER comes from the public master_data — corporate cost arrives ONLY via the gated corporate_costs path (_fetchCorporateCosts); franchise devices keep their own local cost untouched
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
    this._stepsPushUrl = null;  // Chunk 4
    this._stepsPullUrl = null;  // Chunk 4
    this._configUrl = null;
    console.log('[Sync] Sensitive data cleared.');
  },

  /**
   * Generates a unique device ID for this browser/device.
   */
  _generateDeviceId() {
    const id = 'dev_' + Date.now() + '_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');  // GPT-18 (Wave M3): crypto, not Math.random
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
    this._tabId = 'tab_' + this._tabStartedAt + '_' + Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('');  // GPT-18 (Wave M3): crypto, not Math.random
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

        case 'proof-relay':
          // AA-07: a non-leader tab minted a privileged/pin proof — the leader (sole pusher) stores it in
          // memory so the imminent push carries it. Ignored unless we're the leader.
          this._acceptRelayedProof(msg.payload);
          break;

        case 'db-updated':
          // Leader synced new data — refresh our cache
          if (!this._isLeader && typeof DB !== 'undefined' && DB.refresh) {
            DB.refresh().then(() => {
              // AA-06: the leader may have adopted a new access_policy. A follower's real gate is
              // Auth._policy (set only at login/restore/init), so re-adopt the refreshed persisted policy
              // and retry a stuck cost purge — else the follower's can(revokedCap) stays stale until reload.
              try {
                if (typeof Auth !== 'undefined' && Auth.adoptPolicy) {
                  const ap = DB.get().accessPolicy;
                  if (ap) Auth.adoptPolicy(ap); else Auth._policy = null;
                }
              } catch (e) {}
              this._reconcilePolicyPurge().catch(() => {});
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
      TransferId: t.transferId || '',
      // Azure Chunk 4 (D4-E): deterministic dedup key. Initial transfer-receive rows carry a per-product
      // receive key (set in phase2.js receive()); every other row falls back to its unique TransactionId.
      // The server enforces uniqueness on this column → a 2nd offline receive of the same (transfer,store,
      // product) 409s → stock can't double. Falling back to TransactionId means non-receive rows never collide.
      IdempotencyKey: t.idempotencyKey || t.id
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
      _synced: true,
      // Chunk 8 (archival): the monotonic SharePoint item id. The archival cutoff is BY this id, so the
      // client fold seeds from the snapshot then applies only rows with _spId > cutoffId (or _spId == null =
      // a brand-new local/unsynced row, always within the retain window => post-cutoff). A row that lacks a
      // usable ID is stored as null (never 0 — 0 would falsely read as "<= any cutoff" and get pruned/skipped).
      _spId: (function(){ var v = (item.ID != null ? item.ID : item.Id); var n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; })()
    };
    // Tombstone support: map TargetTransactionId if present
    if (item.TargetTransactionId) {
      local.targetTransactionId = item.TargetTransactionId;
    }
    return local;
  },

  // Chunk 8 (D8-6): map an ARCHIVE list row (TxnType/TxnDate/TxnTimestamp field names) to the local shape
  // used by report overlays. Same strict-ingest posture as _fromSharePoint (reject fractional/negative qty).
  _fromArchive(item) {
    if (!item) return null;
    const _q = (typeof Validate !== 'undefined') ? Validate.qty(item.Qty) : { ok: Number.isSafeInteger(Number(item.Qty)) && Number(item.Qty) >= 0, value: Number(item.Qty) };
    if (!_q.ok) return null;
    const sid = Number(item.SourceId);
    return {
      id: String(item.TransactionId || ''),
      date: item.TxnDate || '',
      storeId: item.StoreId || '',
      productId: item.ProductId || '',
      type: item.TxnType || '',
      qty: _q.value,
      staffName: item.StaffName || '',
      reason: item.Reason || '',
      deviceId: item.DeviceId || '',
      transferId: item.TransferId || '',
      targetTransactionId: item.TargetTransactionId || '',
      createdAt: (function(){ try { if(item.TxnTimestamp){ var _d=new Date(Number(item.TxnTimestamp)); if(!isNaN(_d.getTime())) return _d.toISOString(); } } catch(e){} return ''; })(),
      _synced: true,
      _archived: true,   // report-overlay marker; never persisted, never in the stock cache
      _spId: (Number.isSafeInteger(sid) && sid > 0) ? sid : null
    };
  },

  // Director/HO on-demand pull of archived movements for a date range (report overlay). Returns an array of
  // ACTIVE movement rows with tombstoned originals + 'deleted' rows REMOVED, so report sums match the snapshot
  // (which already excluded them). Returns null if no endpoint is configured; [] on an authorised empty range.
  async pullArchive(fromDate, toDate) {
    if (!this._archivePullUrl) return null;
    const body = this._withPerson({ from: fromDate || '', to: toDate || '' });  // Chunk 9: session proof
    const resp = await fetch(this._archivePullUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (resp.status === 401) { this._handleUnauthorized('archive-pull'); this._showStatus('Not authorised to load archived data', 'warning'); return null; }  // AGY MED: 401 must trigger the SAME central pause as push/pull/config (rotated keys shouldn't keep polling)
    if (!resp.ok) { console.warn('[Sync] Archive pull failed:', resp.status); return null; }
    const j = await resp.json();
    const items = (j && Array.isArray(j.items)) ? j.items : [];
    const tombstoned = new Set();
    for (const it of items) { if (String(it.TxnType || '') === 'deleted' && it.TargetTransactionId) tombstoned.add(String(it.TargetTransactionId)); }
    const out = [];
    for (const it of items) {
      if (String(it.TxnType || '') === 'deleted') continue;                 // drop tombstones themselves
      if (tombstoned.has(String(it.TransactionId))) continue;               // drop the deleted originals
      const row = this._fromArchive(it);
      if (row && row.qty >= 0) out.push(row);
    }
    return out;
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
    if (this._unauthorized) return;  // Chunk 5 (D6): paused after a 401 until keys change
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

      // Filter to only unsynced transactions. Chunk 2: also exclude rows the SERVER PERMANENTLY
      // REJECTED (_rejected) — they did not land and must NOT re-push every cycle forever (they are
      // surfaced to an admin instead; see DB.markTransactionsRejected + the ack handling below).
      const _allUnsynced = (data.transactions || []).filter(t => !t._synced && !t._rejected);

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
        body: JSON.stringify(this._withIngestProofs(payload)),   // AA-W5: + session/pin/action proofs (inert until enforcement flips)
      });

      if (resp.status === 401) {
        // Chunk 5: auth failure is TERMINAL for this cycle — no retry-loop (D6). Batch stays
        // pending; entering valid keys in Settings clears the pause and re-syncs.
        this._handleUnauthorized('push');
        Sync._setPending(true);
        return;
      }
      if (!resp.ok) {
        throw new Error(`Push failed: ${resp.status} ${resp.statusText}`);
      }

      const result = await resp.json().catch(() => ({}));

      // ── Chunk 2: honest ingest-validation contract (push-v2-validate) ──────────
      // The validating Logic App returns:
      //   { status, inputCount, accepted:[ids], duplicates:[ids],
      //     rejected:[{index,TransactionId,reasonCode,reason}],
      //     failed:[{index,TransactionId,reason,retryable}], serverTimestamp, catalogueCheck }
      // It enforces a TERMINAL INVARIANT server-side (inputCount === accepted+duplicates+rejected+
      // failed) and returns non-2xx + acks NOTHING if it can't hold — so a 2xx carrying these buckets
      // is trustworthy. Client policy:
      //   accepted + duplicates → _synced (a duplicate/409 means the server already has it; idempotent)
      //   rejected  (permanent) → durable quarantine flag + surfaced to admin; NEVER _synced, NEVER
      //                           re-pushed forever (DB.markTransactionsRejected)
      //   failed    (retryable) → left UNSYNCED for a NORMAL retry next cycle; NEVER quarantined
      // Detected by the presence of any of the four outcome arrays (the legacy push-v2 returns only
      // processedCount → the else-branch below, retained for a safe rollback / mixed-endpoint window).
      const _isV2 = Array.isArray(result.accepted) || Array.isArray(result.duplicates)
                 || Array.isArray(result.rejected) || Array.isArray(result.failed);

      if (_isV2) {
        const _acc  = Array.isArray(result.accepted)   ? result.accepted   : [];
        const _dup  = Array.isArray(result.duplicates) ? result.duplicates : [];
        const _rej  = Array.isArray(result.rejected)   ? result.rejected   : [];
        const _fail = Array.isArray(result.failed)     ? result.failed      : [];

        // Defence in depth (P-13): only ever act on ids WE actually sent in this batch — never trust
        // a server-returned id outside the batch (e.g. another device's row id leaking into a bucket).
        const _accSyncIds = _acc.filter(id => batchIds.has(id));
        const _dupSyncIds = _dup.filter(id => batchIds.has(id));
        const _rejRows = _rej.filter(r => r && batchIds.has(r.TransactionId));
        const _failRows = _fail.filter(f => f && batchIds.has(f.TransactionId));
        const _rejSet  = new Set(_rejRows.map(r => r.TransactionId));
        const _failSet = new Set(_failRows.map(f => f.TransactionId));

        // FAIL CLOSED on a CONTRADICTORY response (GPT Chunk-2 audit P2, round 2): an id the server placed in
        // a "landed" bucket (accepted/duplicate) AND ALSO in rejected/failed means the response is internally
        // inconsistent and CANNOT be trusted on ANY of it. Make NO durable changes (don't sync, don't
        // quarantine), keep the WHOLE batch pending, and retry. (Round-1 quarantined the conflict id instead,
        // which removed it from the retry set, so the "retry" sent nothing and falsely cleared pending.)
        const _landedIds = new Set([..._accSyncIds, ..._dupSyncIds]);
        const _conflict = [..._landedIds].some(id => _rejSet.has(id) || _failSet.has(id));
        if (_conflict) {
          console.warn('[Sync] (v2) server returned conflicting buckets for a sent row — response untrusted; NO durable changes, retrying the whole batch (fail-closed).');
          this._showStatus('Sync response invalid — will retry', 'warning');
          Sync._setPending(true);
          this._scheduleSyncRetry();
        } else {

          // (1) accepted + duplicates → durable _synced (targeted row update)
          const _syncIds = new Set([..._landedIds]);
          let _marked = true;
          if (_syncIds.size > 0) _marked = await DB.markTransactionsSynced(_syncIds);

          // (2) permanent rejects → durable quarantine (surfaced). CHECK the boolean (GPT P2 r1): a failed
          // quarantine write must force a retry, not a false "done" that strands the row.
          let _rejMarked = true;
          if (_rejRows.length > 0) {
            const _rejMap = new Map(_rejRows.map(r => [r.TransactionId, { code: r.reasonCode, reason: r.reason }]));
            _rejMarked = await DB.markTransactionsRejected(_rejMap);
            console.warn('[Sync] Server REJECTED ' + _rejRows.length + ' row(s): ' + _rejRows.map(r => r.TransactionId + '=' + (r.reasonCode || r.reason || '?')).join(', '));
            try { if (typeof Diag !== 'undefined') Diag.log('sync', 'server-rejected ' + _rejRows.length + ' rows: ' + _rejRows.map(r => r.TransactionId + ':' + (r.reasonCode || '')).join(',')); } catch (e) {}
            // Chunk 10 (audit AGY-C3): give OUT_OF_SCOPE_STORE a plain-English banner instead of a generic reject.
            if (_rejRows.some(r => (r.reasonCode || '') === 'OUT_OF_SCOPE_STORE')) {
              this._showStatus('Some entries were for a store this device isn’t set up to manage and weren’t saved. Check this device’s store setup.', 'warning', 0);
            }
          }

          // (3) COVERAGE (GPT P2 r1): every sent row must map to exactly ONE outcome. Count any sent row that
          // landed in NO bucket — it stays unsynced and MUST drive a retry (never a clean "Synced" while a
          // sent row is in limbo / the server returned a partial 2xx).
          let _unaccounted = 0;
          batchIds.forEach(id => { if (!_syncIds.has(id) && !_rejSet.has(id) && !_failSet.has(id)) _unaccounted++; });

          // CLEAN only when both durable writes succeeded, nothing is retryable, and nothing is unaccounted-for.
          // Anything else → keep pending + retry, never lie "Synced". (Conflict is handled above, not here.)
          const _clean = _marked && _rejMarked && _failRows.length === 0 && _unaccounted === 0;
          if (_clean) {
            // Fully resolved: accepted/duplicates durable, rejects durably quarantined + surfaced.
            Sync._setPending(false);
            this._retryCount = 0;
            this._markRetryCount = 0;
            this._stampUiSync();
            if (_rejRows.length > 0) this._showStatus('Synced ✓ — ' + _rejRows.length + ' rejected by server', 'warning');
            else this._showStatus('Synced ✓', 'success');
            this._notifyFollowers();
            console.log('[Sync] Push complete (v2): ' + _syncIds.size + ' synced, ' + _rejRows.length + ' rejected, ' + _failRows.length + ' failed.', result);
          } else {
            // NOT fully resolved — keep pending + schedule a retry; surface what happened, never "Synced ✓".
            if (!_marked || !_rejMarked) console.warn('[Sync] (v2) durable sync-state write failed — keeping pending + retry (NOT showing Synced).');
            if (_unaccounted > 0) console.warn('[Sync] (v2) ' + _unaccounted + ' sent row(s) in NO server bucket — keeping pending + retry (fail-safe).');
            if (_failRows.length > 0) console.warn('[Sync] ' + _failRows.length + ' row(s) failed (retryable) — left unsynced for retry.');
            const _bits = [];
            if (_rejRows.length > 0) _bits.push(_rejRows.length + ' rejected');
            if (_failRows.length > 0) _bits.push(_failRows.length + ' will retry');
            if (_unaccounted > 0 || !_marked || !_rejMarked) _bits.push('sync incomplete — will retry');
            this._showStatus(_bits.join(', ') || 'Sync incomplete — will retry', 'warning');
            Sync._setPending(true);
            this._scheduleSyncRetry();
          }
        }

      } else {

      // ── Legacy push-v2 acknowledgement verification (processedCount) — retained for rollback ──
      // The legacy Logic App returns: { status: "ok", processedCount: N, serverTimestamp }
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

      }  // end legacy (else) ack path

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
   * The pull-v2 Logic App (ID-CURSOR contract — see AZURE-PULL-HARDENING-SPEC.md):
   *   - Accepts POST { lastId: <int-as-string>, maxId: <int-as-string, optional>, $top: N }
   *   - Returns { items: [...], maxId: "<frozen ceiling>", count, lastId, status: "ok" }
   *   - Items are flat SharePoint list records with PascalCase field names + an `ID` (SP item id)
   *   - Server filters: ID gt <lastId> AND ID le <maxId>, ordered by ID asc
   *
   * WHY ID-CURSOR (not SyncTimestamp): SharePoint throttles any query whose matched set exceeds
   * ~5,000 items — even with a real index and paging — so the old SyncTimestamp `gt since` + `$skip`
   * pull 502'd once a device had >5k rows to catch up on (new/long-offline device onboarding).
   * Paging by the primary key ID crosses the threshold at any scale (proven on staging, 6k rows).
   *
   * PAGINATION + SNAPSHOT FREEZE (C1):
   *   First page lets the server freeze `maxId` (the list's current max ID) as the cycle ceiling;
   *   subsequent pages echo it so concurrent inserts can't extend the walk. Page by `lastId` =
   *   max ID seen so far; loop until a short page. The cursor (bob_last_sp_id) advances to the
   *   frozen maxId ONLY after every page merged durably; any page failure aborts and re-pulls
   *   next cycle from the same cursor (no data loss).
   *
   * PHANTOM-READ LOOKBACK (C2):
   *   SharePoint allocates IDs sequentially but commits them asynchronously, so a higher ID can
   *   become visible before a lower one finishes committing. We start each cycle from
   *   (lastSyncId - PULL_ID_LOOKBACK) so a row that was mid-commit last cycle is re-seen; replayed
   *   rows are harmless (deduped locally by TransactionId).
   *
   * TOMBSTONE HANDLING (Tier 2 Fix #6):
   *   Items with Type === 'deleted' are tombstones — they signal that
   *   the referenced transaction (TargetTransactionId field holds the original ID)
   *   should be removed from the local database. Tombstones are appended as NEW rows (new ID),
   *   so the ID-cursor always reaches them — provided NO row is ever edited/deleted in place
   *   on the SharePoint list (operational rule, C7).
   */
  PULL_PAGE_SIZE: 1000,
  PULL_ID_LOOKBACK: 100,  // C2: re-query the last N ids each cycle to catch async-committed rows.
                           // Replayed rows are harmless — deduped locally by TransactionId.
                           // Sizing (auditor follow-up): the out-of-order *visibility* window (a higher
                           // ID visible before a lower one finishes committing) is bounded by the number
                           // of inserts committing against the list at once = push-v2's writer concurrency
                           // (50). 100 = 2x that bound. (Codex wanted >=1000-or-prove; AGY wanted 20 —
                           // 20 < the 50 concurrency floor = unsafe. 100 is correctness-safe; the ~30KB/
                           // poll re-read is negligible on store wifi. Raise if push concurrency ever grows.)
  PULL_LOOKBACK_MS: 10000,  // (legacy, retained) time-overlap margin from the SyncTimestamp era.

  async pull() {
    if (this._unauthorized) return;  // Chunk 5 (D6): paused after a 401 until keys change
    if (!this._pullUrl) return;
    if (this._syncLock) {
      console.log('[Sync] Sync already in progress, skipping pull.');
      return;
    }

    this._syncLock = true;
    try {
      let allItems = [];
      let keepGoing = true;
      let frozenMaxId = null;  // C1: snapshot ceiling — server-frozen on first page, echoed after
      let scopeChecked = false;  // Chunk 10: reconcile the server-echoed store scope once, on the first page

      // ID-cursor pagination (threshold-safe at any scale). Start from (lastSyncId - lookback) so
      // async-committed rows from last cycle are re-seen (C2). cursorId advances to the max ID seen
      // per page; the server freezes maxId on the first page and we echo it so concurrent inserts
      // can't extend this cycle (C1).
      const safeLastId = Math.max(0, this._lastSyncId - this.PULL_ID_LOOKBACK);
      let cursorId = safeLastId;
      while (keepGoing) {
        const body = {
          lastId: String(cursorId),
          $top: this.PULL_PAGE_SIZE
        };
        // Echo the frozen ceiling on every page after the first (C1)
        if (frozenMaxId != null) {
          body.maxId = String(frozenMaxId);
        }

        const resp = await fetch(this._pullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._withAuth(body)),
        });

        if (resp.status === 401) {  // Chunk 5: pause sync, no retry-loop (D6)
          this._handleUnauthorized('pull');
          return;
        }
        if (!resp.ok) {
          console.warn(`[Sync] Pull page failed (lastId=${cursorId}):`, resp.status);
          this._showStatus('Data may be stale \u2014 last sync failed', 'warning', 0);
          return;  // Abort — don't advance lastSyncAt, retry next cycle
        }

        const remote = await resp.json();
        const items = (remote && Array.isArray(remote.items)) ? remote.items : [];

        // Chunk 10 (store isolation): the server echoes this device's effective store scope. If it changed
        // since last sync, purge out-of-scope local rows and re-bootstrap from a clean cursor (D10-3), then
        // abort this cycle — the next pull re-fetches the in-scope set from scratch. Runs once, on page 1.
        if (!scopeChecked) {
          scopeChecked = true;
          if (await this._reconcileScope(remote.scope)) return;
          // AA-W3 (SR-4): the server also echoes the current access_policy version. A bump we haven't
          // adopted yet forces a config re-fetch NOW (which adopts + runs the narrowing purge) instead of
          // waiting for the next app launch.
          try {
            const pv = Number(remote.policyVersion);
            if (Number.isFinite(pv) && pv > 0 && typeof Auth !== 'undefined' && pv > ((DB.get().accessPolicy && Number(DB.get().accessPolicy.version)) || 0)) {
              this._fetchRemoteConfig().catch(() => {});
            }
          } catch (e) {}
          this._reconcilePolicyPurge().catch(() => {});   // AA-05: retry a stuck cost purge every pull, version-independent
        }

        // C1: capture the frozen ceiling from the first page response
        if (frozenMaxId == null && remote.maxId != null) {
          const m = parseInt(remote.maxId, 10);
          if (!isNaN(m)) frozenMaxId = m;
        }

        allItems = allItems.concat(items);
        console.log(`[Sync] Pull page: lastId=${cursorId}, received=${items.length}, total=${allItems.length}, frozenMaxId=${frozenMaxId}`);

        if (items.length < this.PULL_PAGE_SIZE) {
          keepGoing = false;  // Last page — fewer items than page size
        } else {
          // Advance to the max ID on this page (rows are ID-ordered asc). Computed locally so we
          // never trust a single server field.
          const pageMaxId = items.reduce((mx, it) => {
            const v = parseInt(it && it.ID, 10);
            return (!isNaN(v) && v > mx) ? v : mx;
          }, cursorId);
          if (pageMaxId <= cursorId) {
            // A FULL page that did not advance the max ID = a malformed/garbage server page (Codex P2).
            // FAIL CLOSED: abort the whole cycle WITHOUT merging the partial result or advancing the
            // cursor, so the next cycle re-pulls cleanly from the same point. Never risk an infinite
            // same-page loop or a half-applied cycle.
            console.warn(`[Sync] Pull no forward progress at lastId=${cursorId} on a full page — aborting cycle, cursor unchanged`);
            this._showStatus('Data may be stale — last sync failed', 'warning', 0);
            return;
          }
          cursorId = pageMaxId;
        }
      }

      if (allItems.length === 0) {
        // No new rows, but still advance the cursor to the frozen ceiling so quiet systems don't
        // re-query the same range every cycle (sync stagnation). Only ever advances forward.
        if (frozenMaxId != null && frozenMaxId > 0) {
          this._lastSyncId = Math.max(this._lastSyncId, frozenMaxId);
          try { localStorage.setItem('bob_last_sp_id', String(this._lastSyncId)); } catch(e) {}
        }
        this._lastSyncAt = Date.now();  // UI freshness stamp (sync succeeded, no new rows)
        try { localStorage.setItem('bob_last_sync', String(this._lastSyncAt)); } catch(e) {}
        return;  // No new rows (cursor advanced)
      }

      console.log(`[Sync] Pull received ${allItems.length} total items from SharePoint.`);

      const local = DB.get();
      const localById = new Map((local.transactions || []).map(t => [t.id, t]));
      const localIds = new Set(localById.keys());
      let spIdBackfilled = 0;  // Chunk 8: assign _spId to already-known rows (esp. this device's own rows, which
                               // are never re-ingested via _fromSharePoint) so the archival fold can tell which
                               // local rows are <= cutoff. Without this, an old own-device row keeps _spId==null,
                               // is treated as "recent", and double-counts against the snapshot that already folds it.
      const spIdBackfillRows = [];  // AGY P1: DB.commit() does NOT persist the transactions table, so an in-memory
                                    // _spId backfill is lost on reload (rows revert to _spId==null and double-count).
                                    // Collect the mutated rows and write them DURABLY (bulkPut) below.
      const _spIdOf = (it) => { const v = (it.ID != null ? it.ID : it.Id); const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

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

        // Skip items we already have locally (includes lookback overlap rows), but first BACKFILL the
        // SharePoint id onto the known local row if it's missing (Chunk 8 fold correctness).
        if (localIds.has(spItem.TransactionId)) {
          overlapCount++;
          const known = localById.get(spItem.TransactionId);
          if (known && known._spId == null) { const sid = _spIdOf(spItem); if (sid != null) { known._spId = sid; spIdBackfilled++; spIdBackfillRows.push(known); } }
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

      if (spIdBackfilled > 0) {
        changed = true;
        // AGY P1: persist the backfill DURABLY — commit() only writes ref-data, so without this the _spId is
        // lost on reload and the rows double-count against the snapshot. Best-effort: on failure the rows keep
        // _spId in memory this session and get re-backfilled next pull cycle (the migration re-pull re-sees them).
        try { await DB.persistTransactionRows(spIdBackfillRows); } catch (e) { console.warn('[Sync] _spId backfill durable persist failed (will re-backfill next cycle):', e); }
        console.log(`[Sync] Backfilled _spId on ${spIdBackfilled} known local row(s) for archival fold (durably persisted).`);
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

      // C3: advance the ID cursor ONLY after every page merged durably (gated above).
      // Advance to the frozen ceiling (the exact ID upper bound the cycle used) — any rows that
      // arrived after the freeze have ID > frozenMaxId and are caught next cycle. Math.max clamp:
      // never let the cursor move backwards. The C2 lookback re-reads the tail; dedup handles it.
      if (frozenMaxId != null && frozenMaxId > 0) {
        this._lastSyncId = Math.max(this._lastSyncId, frozenMaxId);
        localStorage.setItem('bob_last_sp_id', String(this._lastSyncId));
      }
      // _lastSyncAt is now a pure UI freshness stamp (wall-clock of last successful sync) — the pull
      // cursor is bob_last_sp_id. Stamp it so the staleness banner reflects real sync recency.
      this._lastSyncAt = Date.now();
      try { localStorage.setItem('bob_last_sync', String(this._lastSyncAt)); } catch(e) {}

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

  // ─── Chunk 10 — store-scope reconciliation ──────────────────────────────────────────
  // The pull LA echoes `scope` = this device's effective store set (['*'] = sees all). When it differs from
  // the last-seen scope, the device may be holding rows it's no longer entitled to (a wider scope was
  // narrowed, or scope enforcement just switched on). Purge those rows and reset the pull cursor so the
  // in-scope set re-pulls cleanly. Returns true if the caller should ABORT this cycle (scope changed).
  // Returns false when the server sent no scope (older LA — backward compatible) or the scope is unchanged.
  async _reconcileScope(scopeArr) {
    if (!Array.isArray(scopeArr)) return false;               // server didn't echo scope — no-op
    const sig = JSON.stringify([...scopeArr].sort());
    let prev = null; try { prev = localStorage.getItem('bob_scope_sig'); } catch (e) {}
    if (sig === prev) return false;                            // scope unchanged — normal pull continues

    // Scope changed (or first-ever sync). '*' = full access → nothing to purge, just record the signature.
    if (!scopeArr.includes('*')) {
      const ok = await DB.purgeToScope(scopeArr);
      if (!ok) {
        // durable purge failed — the device may still hold out-of-scope rows. FAIL CLOSED: raise a privacy lock
        // (blocks backup export, warns) and do NOT record the new sig, so every later cycle re-attempts the purge
        // until it durably succeeds (audit GPT#4).
        this._scopePurgePending = true;
        try { localStorage.setItem('bob_scope_purge_pending', '1'); } catch (e) {}
        console.error('[Sync] scope purge failed — privacy lock raised, will retry every cycle.');
        this._showStatus('Finishing a store-scope update — some actions are paused until it completes', 'warning', 0);
        return true;
      }
      try { if (typeof Stock !== 'undefined' && Stock._scopeSnapshot) Stock._scopeSnapshot(scopeArr); } catch (e) {}
      this._rerender();
      this._notifyFollowers();
    }
    // purge succeeded (or '*' = no purge needed) — clear any privacy lock from a prior failed attempt
    this._scopePurgePending = false;
    try { localStorage.removeItem('bob_scope_purge_pending'); } catch (e) {}
    // Re-bootstrap BOTH cursors (ledger + record-steps) so in-scope rows below the old cursor re-pull fresh.
    this._lastSyncId = 0;
    this._lastStepSyncId = 0;
    try { localStorage.setItem('bob_last_sp_id', '0'); } catch (e) {}
    try { localStorage.setItem('bob_last_step_sp_id', '0'); } catch (e) {}
    try { localStorage.setItem('bob_scope_sig', sig); } catch (e) {}
    console.log('[Sync] store scope changed → purged out-of-scope data + cursor reset. New scope:', sig);
    return true;                                               // abort this cycle; next pull re-bootstraps
  },

  // ─── Azure Chunk 4 — record-steps push/pull (parallel stream to the ledger) ──────────
  // Same honest accept/reject/duplicate/failed contract as the Chunk-2 ledger push; ids are stepIds.
  // R1 FAIL-CLOSED ORDERING: a stock-effecting step (one carrying payload.expectedLedgerKeys) is eligible
  // to push ONLY once ALL its ledger rows are confirmed _synced — so the record can never claim a stock
  // effect (e.g. "received") before the stock itself has landed. The cycle runs ledger push FIRST, then
  // pushSteps (see _runSyncCycle / scheduleSync / poll), which is what makes the ordering hold.
  async pushSteps() {
    if (!this._stepsPushUrl) return;                 // steps sync disabled (pre-Chunk-4 config) — graceful no-op
    if (typeof Records === 'undefined') return;
    if (this._syncLock) { console.log('[Sync] Sync in progress, skipping pushSteps.'); return; }
    this._syncLock = true;
    try {
      if (typeof DB !== 'undefined' && DB.refresh) await DB.refresh();
      const data = DB.get();
      const allUnsynced = (data.recordSteps || []).filter(s => s && !s._synced && !s._rejected);
      if (allUnsynced.length === 0) { Sync._setStepPending(false); return; }

      // R1 eligibility: hold a stock-effecting step until its ledger rows are durably synced (+ not rejected).
      const ledgerById = new Map((data.transactions || []).map(t => [t.id, t]));
      const eligible = [], held = [];
      for (const s of allUnsynced) {
        const keys = (s.payload && Array.isArray(s.payload.expectedLedgerKeys)) ? s.payload.expectedLedgerKeys.filter(Boolean) : [];
        if (keys.length === 0) { eligible.push(s); continue; }
        const ready = keys.every(k => { const r = ledgerById.get(k); return r && r._synced && !r._rejected; });
        (ready ? eligible : held).push(s);
      }
      if (held.length) console.log('[Sync] R1: holding ' + held.length + ' record-step(s) until their ledger rows sync.');
      if (eligible.length === 0) { Sync._setStepPending(true); return; }

      const batchIds = new Set(eligible.map(s => s.stepId));
      const payload = { data: { steps: eligible.map(s => Records.toSharePoint(s)) } };
      console.log('[Sync] Pushing ' + eligible.length + ' record-step(s)...');

      const resp = await fetch(this._stepsPushUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this._withIngestProofs(payload)) });  // AA-W5
      if (resp.status === 401) {  // Chunk 5: pause sync, no retry-loop (D6); steps stay pending
        this._handleUnauthorized('pushSteps');
        Sync._setStepPending(true);
        return;
      }
      if (!resp.ok) throw new Error('Steps push failed: ' + resp.status + ' ' + resp.statusText);
      const result = await resp.json().catch(() => ({}));

      const _acc  = Array.isArray(result.accepted)   ? result.accepted   : [];
      const _dup  = Array.isArray(result.duplicates) ? result.duplicates : [];
      const _rej  = Array.isArray(result.rejected)   ? result.rejected   : [];
      const _fail = Array.isArray(result.failed)     ? result.failed      : [];
      const _idOf = r => r && (r.StepId || r.stepId);
      const accIds  = _acc.filter(id => batchIds.has(id));
      const dupIds  = _dup.filter(id => batchIds.has(id));
      const rejRows = _rej.filter(r => batchIds.has(_idOf(r)));
      const failRows = _fail.filter(f => batchIds.has(_idOf(f)));
      const rejSet  = new Set(rejRows.map(_idOf));
      const failSet = new Set(failRows.map(_idOf));
      const landed  = new Set([...accIds, ...dupIds]);

      // Fail-closed on a contradictory response (id in a landed bucket AND rejected/failed): trust none of it.
      const conflict = [...landed].some(id => rejSet.has(id) || failSet.has(id));
      if (conflict) {
        console.warn('[Sync] (steps) contradictory server buckets — no durable change, retrying whole batch.');
        Sync._setStepPending(true); this._scheduleSyncRetry();
        return;
      }
      let marked = true, rejMarked = true;
      if (landed.size > 0) marked = await DB.markStepsSynced(landed);
      if (rejRows.length > 0) {
        rejMarked = await DB.markStepsRejected(new Map(rejRows.map(r => [_idOf(r), { code: r.reasonCode, reason: r.reason }])));
        console.warn('[Sync] Server REJECTED ' + rejRows.length + ' record-step(s): ' + rejRows.map(r => _idOf(r) + '=' + (r.reasonCode || r.reason || '?')).join(', '));
        try { if (typeof Diag !== 'undefined') Diag.log('sync', 'server-rejected ' + rejRows.length + ' record-steps'); } catch (e) {}
      }
      let unaccounted = 0;
      batchIds.forEach(id => { if (!landed.has(id) && !rejSet.has(id) && !failSet.has(id)) unaccounted++; });

      const clean = marked && rejMarked && failRows.length === 0 && unaccounted === 0 && held.length === 0;
      Sync._setStepPending(!clean);
      if (!clean) this._scheduleSyncRetry();
      else { this._notifyFollowers(); }
      console.log('[Sync] Steps push: ' + landed.size + ' synced, ' + rejRows.length + ' rejected, ' + failRows.length + ' failed, ' + unaccounted + ' unaccounted, ' + held.length + ' held.');
    } catch (err) {
      console.error('[Sync] pushSteps error:', err);
      Sync._setStepPending(true); this._scheduleSyncRetry();
    } finally {
      this._syncLock = false;
      this._drainSyncQueue();
    }
  },

  async pullSteps() {
    if (!this._stepsPullUrl) return;                 // steps sync disabled — graceful no-op
    if (typeof Records === 'undefined') return;
    if (this._syncLock) { console.log('[Sync] Sync in progress, skipping pullSteps.'); return; }
    this._syncLock = true;
    try {
      let allItems = [], keepGoing = true, frozenMaxId = null;
      const safeLastId = Math.max(0, this._lastStepSyncId - this.PULL_ID_LOOKBACK);
      let cursorId = safeLastId;
      while (keepGoing) {
        const body = { lastId: String(cursorId), $top: this.PULL_PAGE_SIZE };
        if (frozenMaxId != null) body.maxId = String(frozenMaxId);
        const resp = await fetch(this._stepsPullUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this._withAuth(body)) });
        if (resp.status === 401) { this._handleUnauthorized('pullSteps'); return; }  // Chunk 5: no retry-loop (D6)
        if (!resp.ok) { console.warn('[Sync] Steps pull page failed (lastId=' + cursorId + '):', resp.status); return; }
        const remote = await resp.json();
        const items = (remote && Array.isArray(remote.items)) ? remote.items : [];
        if (frozenMaxId == null && remote.maxId != null) { const m = parseInt(remote.maxId, 10); if (!isNaN(m)) frozenMaxId = m; }
        allItems = allItems.concat(items);
        if (items.length < this.PULL_PAGE_SIZE) keepGoing = false;
        else {
          const pageMaxId = items.reduce((mx, it) => { const v = parseInt(it && it.ID, 10); return (!isNaN(v) && v > mx) ? v : mx; }, cursorId);
          if (pageMaxId <= cursorId) { console.warn('[Sync] Steps pull no forward progress — aborting cycle.'); return; }
          cursorId = pageMaxId;
        }
      }

      if (allItems.length === 0) {
        if (frozenMaxId != null && frozenMaxId > 0) { this._lastStepSyncId = Math.max(this._lastStepSyncId, frozenMaxId); try { localStorage.setItem('bob_last_step_sp_id', String(this._lastStepSyncId)); } catch (e) {} }
        return;
      }

      const local = DB.get();
      const knownStepIds = new Set((local.recordSteps || []).map(s => s.stepId));
      const newSteps = [];
      for (const it of allItems) {
        const step = Records.fromSharePoint(it);
        if (!step) continue;                              // malformed → skip (don't stall)
        if (knownStepIds.has(step.stepId)) continue;      // already have it (lookback overlap / own row)
        newSteps.push(step);
      }

      let mergeDurable = true;
      if (newSteps.length > 0) {
        mergeDurable = await DB.addStepsDurable(newSteps, { remote: true });
        if (mergeDurable) {
          console.log('[Sync] Merged ' + newSteps.length + ' new record-step(s).');
          await Records.applyFold();        // materialise/refresh the local transfer/delivery/stocktake records
          this._rerender();
          this._notifyFollowers();
        } else {
          console.error('[Sync] Durable persist of merged steps FAILED — cursor unchanged, will re-pull.');
        }
      }

      if (!mergeDurable) { this._showStatus('Data may be stale — will retry', 'warning'); return; }
      if (frozenMaxId != null && frozenMaxId > 0) { this._lastStepSyncId = Math.max(this._lastStepSyncId, frozenMaxId); try { localStorage.setItem('bob_last_step_sp_id', String(this._lastStepSyncId)); } catch (e) {} }
    } catch (err) {
      console.error('[Sync] pullSteps error:', err);
    } finally {
      this._syncLock = false;
      this._drainSyncQueue();
    }
  },

  // Chunk 4: separate pending flag for record-steps (so a held/failed step keeps the leader draining).
  _setStepPending(on) { try { if (on) localStorage.setItem('bob_step_sync_pending', 'true'); else localStorage.removeItem('bob_step_sync_pending'); } catch (e) {} },
  _getStepPending() { try { return localStorage.getItem('bob_step_sync_pending') === 'true'; } catch (e) { return false; } },

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
      await this.pushSteps();  // Chunk 4: drain record-steps after the ledger (R1 ordering)
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
    // Chunk 5 (D6): after a 401 the device is paused — no fetch storm from the 30s poll.
    // Entering valid keys (saveAuthKeys) clears the pause and re-runs.
    if (this._unauthorized) return { ok: false, unauthorized: true };
    if (this._syncing || this._syncLock) { this._syncQueued = true; return { ok: true, queued: true }; }
    this._syncing = true;
    try {
      do {
        this._syncQueued = false;
        await this.push();        // ledger local → server FIRST (R1: stock before record-steps)
        await this.pushSteps();   // then record-steps (eligible only when their ledger rows are synced)
        await this.pull();        // ledger server → local
        await this.pullSteps();   // then record-steps server → local (fold into records)
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
    await this.pullSteps();  // Chunk 4: pull record-steps each cycle, fold into records
    // Wave I (Tier 2, GPT): the leader's periodic poll also DRAINS pending writes. A delete now
    // writes a durable tombstone row + relies on the 'local-write' BroadcastChannel signal to make
    // the leader push it — but that signal can be missed (backgrounded/closed follower tab). Pushing
    // on poll guarantees any unsynced row (incl. a tombstone) is eventually sent, with no
    // tombstone-specific path. Leader-only + lock-guarded; a clean cycle with nothing pending is a no-op.
    if (this._isLeader && this._getPending && this._getPending()) {
      try { await this.push(); } catch (e) { /* push handles its own retry/status */ }
    }
    // Chunk 4: also drain pending record-steps (e.g. steps held last cycle whose ledger rows have now synced).
    if (this._isLeader && this._getStepPending && this._getStepPending()) {
      try { await this.pushSteps(); } catch (e) {}
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
    // Chunk 8 (AGY P1 / migration): rows synced BEFORE this build carry no _spId, and the ID-cursor never
    // re-pulls rows below the high-water mark — so they'd stay _spId==null and DOUBLE-COUNT at the first
    // archival (null != covered -> applied on top of the snapshot seed). One-time: if any synced row lacks an
    // _spId, rewind the pull cursor to 0 so the next pull re-reads the whole ledger and backfills every row
    // (dedup by TransactionId makes the replay harmless; the ID-cursor pull is threshold-safe at any scale).
    try {
      if (!localStorage.getItem('bob_c8_spid_migrated')) {
        const needs = typeof DB !== 'undefined' && DB.get && (DB.get().transactions || []).some(t => t && t._synced === true && t._spId == null);
        if (needs) { this._lastSyncId = 0; localStorage.setItem('bob_last_sp_id', '0'); console.log('[Sync] Chunk-8 _spId migration: rewound pull cursor to 0 for a one-time full backfill.'); }
        localStorage.setItem('bob_c8_spid_migrated', '1');
      }
    } catch (e) {}

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
    if (Sync._getStepPending && Sync._getStepPending()) {
      console.log('[Sync] Pending record-steps found, pushing...');
      await this.pushSteps();
    }

    // GPTa-24: a brand-new (never-synced) device renders the bundled seed until the first 30s poll —
    // pull immediately so staff act on real data, not seed. Non-blocking to app use; offline-safe.
    // pull() does NOT reliably throw on failure (failed HTTP returns internally), so confirm success by
    // the advanced cursor (_lastSyncId>0), never by a catch — otherwise we'd show "Up to date" on seed.
    // ID-cursor migration: gate on _lastSyncId (the new cursor). Existing devices have bob_last_sp_id
    // unset (=0) so they take this branch once and replay from ID 0 — a one-time full pull, deduped by
    // TransactionId (C6). Cheap while live is <5k; threshold-safe even if not.
    if (this._lastSyncId === 0) {
      console.log('[Sync] First ID-cursor run on this device — pulling initial data...');
      this._showStatus('↻ Syncing latest data…', 'info', 0);
      try { await this.pull(); } catch (e) {}
      try { await this.pullSteps(); } catch (e) {}  // Chunk 4: first-run record-steps pull too
      if (this._lastSyncId > 0) { this._showStatus('✓ Up to date', 'success', 2500); }
      else { this._showStatus('⚠ Could not sync yet — showing local data; will retry automatically', 'error', 0); }
    } else if (this._lastSyncAt > 0 && (Date.now() - this._lastSyncAt) > this.STALE_THRESHOLD) {
      // Check if data is stale
      console.log('[Sync] Data is stale, pulling fresh...');
      await this.pull();
      await this.pullSteps();  // Chunk 4
    }
    // Chunk 4: also run the one-time automatic backfill of pre-existing local records (D4-I).
    // No-op when there are no un-emitted local records (current state) or already run on this device.
    try { if (typeof Records !== 'undefined' && Records.runBackfillOnce) await Records.runBackfillOnce(); } catch (e) { console.warn('[Sync] backfill skipped:', e); }

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
