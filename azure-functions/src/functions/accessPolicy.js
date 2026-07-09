// BOB Stock - Azure Function: Account Access Model (Account Access chunk, AA-W2).
// Same division of labour as validateKeys/validateUser: the gated Logic Apps do ALL SharePoint I/O and
// forward the server-read rows/blobs here; THIS function owns the pure logic:
//
//   POST /api/evaluateAccess {proof, pinProof?, capability?, action?, deviceContext, policy, rows:[userRow]}
//     -> 200 {ok, username?, role?, via?} | {ok:false, reason}
//        The single authorization decision point (SR-2/SR-8): verifies the person proof against the CURRENT
//        user row, resolves the capability through the SR-7 order (explicit per-account override is FINAL ->
//        24h-PIN grant [stockTakeCount/transferReceive only] -> role/type default), and for privileged
//        ACTIONS consults the sudo map (policy 'password' => a purpose-bound sudo proof is REQUIRED;
//        'session' => the 12h session proof is accepted). Missing/unparseable policy => FAIL CLOSED
//        (capability denied; sudo evaluated as 'password').
//   POST /api/policyMerge {current, proposed, pinPlain?}
//     -> 200 {ok, blob, version} | {ok:false, reason}
//        Validates a proposed access_policy write: schema, reserved-key rejection, FLOOR invariants (SR-1 -
//        a write that relaxes a floored sudo key is REJECTED, never silently corrected), size cap; bumps
//        `version` SERVER-side (client never mints a version). If pinPlain is present the 24h stock-take PIN
//        is hashed HERE with the pepper (plaintext never stored, never echoed back).
//   POST /api/validatePin {pin, deviceContext, policy, rows:[storeAccountRow]}
//     -> 200 {ok, proof, expiresAt} | {ok:false}
//        Verifies the Director-set 24h PIN against policy.pin and mints a purpose='pin-grant' proof bound to
//        the requesting ACCOUNT + device context, expiring at the PIN's expiry. Replaces the client-local
//        hash compare (enforcement matrix D5): the grant becomes something recordsteps-push can VALIDATE.
//
// P-13: these routes are the REAL gate for every SERVER-class capability in the enforcement matrix
// (AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md §3). Client-side Auth.can mirrors resolveCapability() for UX only;
// sentinel S-parity probes assert the two implementations agree on the same fixtures.

const { app } = require('@azure/functions');
const crypto = require('crypto');
const { verifyProofBody, computeHash, rowUsable } = require('./validateUser');

const PIN_GRANT_PURPOSE = 'pin-grant';
const PIN_CAPS = ['stockTakeCount', 'transferReceive'];      // the ONLY caps a PIN grant can lift (D-AA-2/SR-7)
const PIN_USERNAME = '__stocktake_pin__';                    // fixed hash-scheme id for the PIN secret
const FLOOR_ACTIONS = ['access-policy', 'user-admin'];       // SR-1 floor. NOTE: D-AA-5 floors only the
// DIRECTOR-target user-admin ops; v1 floors ALL of user-admin (superset - simpler and safer; per-op
// target-role relaxation can come later without a schema change).
const SUDO_VALUES = ['password', 'session'];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;              // role names, capability keys, action keys
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;                      // override keys = UserId
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_POLICY_JSON = 100000;                              // SP text-field + DoS guard

function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function toIso(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) { try { return new Date(v).toISOString(); } catch (e) { return ''; } }
  if (v instanceof Date) { try { return v.toISOString(); } catch (e) { return ''; } }
  return '';
}

// ── The SR-7 resolver — ONE algorithm, mirrored verbatim in client Auth.can (parity sentinel) ──────────
// Order: explicit per-account override (allow OR deny - FINAL) -> PIN grant (PIN_CAPS only, lifts a
// type-default deny) -> role/type default. Unknown capability, unknown role, or no policy => DENY.
function resolveCapability(policy, capability, userId, role, hasPinGrant) {
  if (!policy || typeof policy !== 'object' || !capability || RESERVED.has(capability)) return { ok: false, reason: 'NO_POLICY' };
  const ovs = policy.overrides;
  if (ovs && typeof ovs === 'object' && hasOwn(ovs, userId)) {
    const ov = ovs[userId];
    if (ov && typeof ov === 'object' && hasOwn(ov, capability)) return { ok: ov[capability] === true, via: 'override' };
  }
  if (hasPinGrant === true && PIN_CAPS.includes(capability)) return { ok: true, via: 'pin' };
  const roles = policy.roles;
  if (roles && typeof roles === 'object' && hasOwn(roles, role)) {
    const rd = roles[role];
    if (rd && typeof rd === 'object' && hasOwn(rd, capability)) return { ok: rd[capability] === true, via: 'role' };
  }
  return { ok: false, reason: 'DENIED' };
}

// Sudo-map lookup: what proof does ACTION require? Fail CLOSED: unknown action / missing map => 'password'.
function sudoRequirement(policy, action) {
  const m = policy && typeof policy === 'object' ? policy.sudo : null;
  if (FLOOR_ACTIONS.includes(action)) return 'password';           // floor is absolute even if the blob lies
  if (m && typeof m === 'object' && hasOwn(m, action) && m[action] === 'session') return 'session';
  return 'password';
}

// ── evaluateAccess ─────────────────────────────────────────────────────────────────────────────────────
function evaluateAccess(pepper, proofSecret, body, nowMs) {
  const capability = typeof body.capability === 'string' ? body.capability : null;
  const action = typeof body.action === 'string' ? body.action : null;
  const deviceContext = typeof body.deviceContext === 'string' ? body.deviceContext : '';
  const policy = body.policy && typeof body.policy === 'object' ? body.policy : null;
  if (!capability && !action) return { ok: false, reason: 'BAD_REQUEST' };

  // 1. Which proof purposes are acceptable? (sudo map, fail-closed)
  const expected = [];
  if (action) {
    expected.push(action);                                          // the purpose-bound sudo proof always works
    if (policy && sudoRequirement(policy, action) === 'session') expected.push('session');
  } else {
    expected.push('session');                                       // capability-only checks (gated reads/ingest)
  }

  // 2. Verify the person proof against the CURRENT row (existing Chunk-9 path - tokenVersion, dc, expiry).
  const v = verifyProofBody(proofSecret, { proof: body.proof, expectedPurposes: expected, deviceContext, rows: body.rows }, nowMs);
  if (!v.ok) return { ok: false, reason: action && (!policy || sudoRequirement(policy, action) === 'password') ? 'NEED_SUDO' : 'BAD_PROOF' };

  // 3. PIN grant (only consulted for PIN_CAPS): a separate proof, bound to the SAME account + device.
  let hasPin = false;
  if (typeof body.pinProof === 'string' && body.pinProof) {
    const pv = verifyProofBody(proofSecret, { proof: body.pinProof, expectedPurposes: [PIN_GRANT_PURPOSE], deviceContext, rows: body.rows }, nowMs);
    hasPin = pv.ok === true && pv.username === v.username;
  }

  // 4. Capability resolution (SR-7). No policy => FAIL CLOSED.
  if (capability) {
    if (!policy) return { ok: false, reason: 'NO_POLICY' };
    const row = (Array.isArray(body.rows) ? body.rows : []).find(r => r && r.Username === v.username);
    const userId = String((row && row.UserId) || '');
    const r = resolveCapability(policy, capability, userId, v.role, hasPin);
    if (!r.ok) return { ok: false, reason: hasPin === false && PIN_CAPS.includes(capability) ? 'NEED_PIN' : (r.reason || 'DENIED') };
    return { ok: true, username: v.username, role: v.role, via: r.via };
  }
  return { ok: true, username: v.username, role: v.role, via: 'sudo-map' };
}

// ── policyMerge ────────────────────────────────────────────────────────────────────────────────────────
function badKeys(obj, re) {
  return Object.keys(obj).some(k => RESERVED.has(k) || !re.test(k));
}
function validCapMap(m) {
  return m && typeof m === 'object' && !Array.isArray(m) && !badKeys(m, KEY_RE) && Object.values(m).every(v => v === true || v === false);
}
function policyMerge(pepper, body, nowMs) {
  const current = body.current && typeof body.current === 'object' ? body.current : null;
  const p = body.proposed && typeof body.proposed === 'object' ? body.proposed : null;
  if (!p) return { ok: false, reason: 'BAD_REQUEST' };

  // roles
  if (!p.roles || typeof p.roles !== 'object' || Array.isArray(p.roles) || badKeys(p.roles, KEY_RE)) return { ok: false, reason: 'BAD_ROLES' };
  for (const rd of Object.values(p.roles)) if (!validCapMap(rd)) return { ok: false, reason: 'BAD_ROLES' };
  if (!hasOwn(p.roles, 'director')) return { ok: false, reason: 'NO_DIRECTOR_ROLE' };   // can't define Directors away
  // overrides
  const ovs = p.overrides && typeof p.overrides === 'object' && !Array.isArray(p.overrides) ? p.overrides : {};
  if (badKeys(ovs, ID_RE)) return { ok: false, reason: 'BAD_OVERRIDES' };
  for (const ov of Object.values(ovs)) if (!validCapMap(ov)) return { ok: false, reason: 'BAD_OVERRIDES' };
  // sudo map + FLOOR (SR-1): a proposal that relaxes a floored key is REJECTED - the caller must see the
  // refusal, not have it silently corrected (an unlocked-device attacker probing the floor gets a hard no).
  const sudo = p.sudo && typeof p.sudo === 'object' && !Array.isArray(p.sudo) ? p.sudo : {};
  if (badKeys(sudo, KEY_RE) || !Object.values(sudo).every(v => SUDO_VALUES.includes(v))) return { ok: false, reason: 'BAD_SUDO' };
  for (const f of FLOOR_ACTIONS) if (hasOwn(sudo, f) && sudo[f] !== 'password') return { ok: false, reason: 'FLOOR_VIOLATION' };
  const mergedSudo = { ...sudo };
  for (const f of FLOOR_ACTIONS) mergedSudo[f] = 'password';        // floor keys always present + locked

  // pin: keep current unless pinPlain (set) or pinClear (remove)
  let pin = current && current.pin && typeof current.pin === 'object' ? current.pin : null;
  if (body.pinClear === true) pin = null;
  if (typeof body.pinPlain === 'string' && body.pinPlain) {
    if (!/^\d{4,12}$/.test(body.pinPlain)) return { ok: false, reason: 'BAD_PIN' };
    const salt = crypto.randomBytes(16).toString('hex');
    pin = { salt, hash: computeHash(pepper, PIN_USERNAME, salt, body.pinPlain), expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString() };
  }

  const blob = { version: (Number(current && current.version) || 0) + 1, roles: p.roles, overrides: ovs, sudo: mergedSudo, pin };
  const json = JSON.stringify(blob);
  if (json.length > MAX_POLICY_JSON) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true, blob, version: blob.version };
}

// ── validatePin ────────────────────────────────────────────────────────────────────────────────────────
function validatePin(pepper, proofSecret, body, nowMs) {
  const pinEntry = typeof body.pin === 'string' ? body.pin : '';
  const deviceContext = typeof body.deviceContext === 'string' ? body.deviceContext : '';
  const policy = body.policy && typeof body.policy === 'object' ? body.policy : null;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const cfg = policy && policy.pin && typeof policy.pin === 'object' ? policy.pin : null;
  const nowIso = new Date(nowMs).toISOString();
  // burn equal hash work on every path (anti-oracle, same discipline as evaluateUser)
  const computed = computeHash(pepper, PIN_USERNAME, String((cfg && cfg.salt) || 'dummy-salt'), pinEntry || 'x');
  if (!cfg || !pinEntry) return { ok: false };
  const expIso = toIso(cfg.expiresAt);
  if (!(expIso !== '' && expIso > nowIso)) return { ok: false };                   // PIN expired/unset
  const sh = String(cfg.hash || '');
  if (!/^[0-9a-f]{64}$/i.test(sh)) return { ok: false };
  try {
    if (!(computed.length === sh.length && crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(sh.toLowerCase(), 'hex')))) return { ok: false };
  } catch (e) { return { ok: false }; }
  // the requesting ACCOUNT must itself be a live row (a deactivated store account can't PIN-elevate)
  const row = rows.find(r => r && r.Username === (typeof body.username === 'string' ? body.username : ''));
  if (!row || !rowUsable(row, nowIso)) return { ok: false };
  const expMs = Math.min(Date.parse(expIso), nowMs + 24 * 60 * 60 * 1000);
  const payload = {
    u: String(row.UserId || ''), un: String(row.Username || ''), r: String(row.Role || ''),
    p: PIN_GRANT_PURPOSE, dc: deviceContext, tv: Number(row.TokenVersion) || 0,
    iat: nowMs, exp: expMs, n: crypto.randomBytes(8).toString('hex'),
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', proofSecret).update(b64).digest('hex');
  return { ok: true, proof: b64 + '.' + sig, expiresAt: expMs };
}

function handlerFactory(fn) {
  return async (request) => {
    const pepper = process.env.BOB_AUTH_PEPPER;
    const proofSecret = process.env.BOB_PROOF_SECRET;
    if (!pepper || pepper.length < 32 || !proofSecret || proofSecret.length < 32) {
      return { status: 500, jsonBody: { error: 'verifier not configured' } };     // FAIL CLOSED at the caller
    }
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    if (Array.isArray(body.rows) && body.rows.length > 50) return { status: 400, jsonBody: { error: 'too many rows' } };
    return { jsonBody: fn(pepper, proofSecret, body, Date.now()) };
  };
}

app.http('evaluateAccess', { methods: ['POST'], authLevel: 'function', handler: handlerFactory(evaluateAccess) });
app.http('policyMerge', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((p, s, b, n) => policyMerge(p, b, n)) });
app.http('validatePin', { methods: ['POST'], authLevel: 'function', handler: handlerFactory(validatePin) });

module.exports = { resolveCapability, sudoRequirement, evaluateAccess, policyMerge, validatePin, FLOOR_ACTIONS, PIN_CAPS, PIN_GRANT_PURPOSE, PIN_USERNAME };
