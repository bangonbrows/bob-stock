// BOB Stock - Azure Function: per-PERSON verification + short-lived auth proofs (Chunk 9).
// Same division of labour as validateKeys (Chunk 5): the gated Logic Apps do SharePoint I/O + lockout
// counter writes; THIS function owns the crypto - constant-time password verification against the
// UserCredentials rows, and minting/verifying the short-lived signed proofs that replace
// password-per-request (Codex R1 P1: the password transits ONLY at login/sudo; everything else carries
// a purpose-bound proof).
//
// Routes (authLevel 'function', no SharePoint access):
//   POST /api/validateUser  {username, password, purpose, deviceContext, rows:[userRow...]}
//     -> 200 {userOk:false}                                  (wrong/locked/inactive/unknown - reasons only
//                                                              where the LA needs them for counters)
//     -> 200 {userOk:true, proof, role, username, expiresAt}
//   POST /api/verifyProof   {proof, expectedPurposes:[...], deviceContext, rows:[userRow...]}
//     -> 200 {ok:boolean, username?, role?}                  (booleans + identity only - never hash material)
//
// Verification scheme = Chunk 5's: HMAC-SHA256(BOB_AUTH_PEPPER, username + "\0" + salt + "\0" + password),
// hex, constant-time compare. Proof = base64url(payload JSON) + "." + hex(HMAC-SHA256(BOB_PROOF_SECRET, b64)).
// Payload: {u:userId, un:username, r:role, p:purpose, dc:deviceContext, tv:tokenVersion, iat, exp}.
// TTLs: 'session' proofs 12h (background gated reads: corp-costs, archive-pull); every other purpose is a
// SUDO proof at 5 min, single-purpose (publish/archive/user-admin/backup/approve/resolve/delivery/adjustment).
// Anti-enumeration (Codex): unknown usernames burn the SAME hash work as real ones (dummy row) and return the
// same {userOk:false} shape. Lockout is row-state (LockedUntil/Active) - enforced here as "row not usable";
// the LA maintains the counters with If-Match.

const { app } = require('@azure/functions');
const crypto = require('crypto');

const SUDO_TTL_MS = 5 * 60 * 1000;          // purpose-bound sudo proofs
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // background gated reads
const SUDO_PURPOSES = ['publish', 'archive', 'user-admin', 'backup', 'approve', 'resolve', 'delivery', 'adjustment'];
const ALL_PURPOSES = ['session', ...SUDO_PURPOSES];

function computeHash(pepper, username, salt, secret) {
  return crypto.createHmac('sha256', pepper)
    .update(String(username) + '\0' + String(salt) + '\0' + String(secret))
    .digest('hex');
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
function sign(secret, b64) { return crypto.createHmac('sha256', secret).update(b64).digest('hex'); }
function timingSafeHexEq(aHex, bHex) {
  try { return aHex.length === bHex.length && crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex')); }
  catch (e) { return false; }
}

function rowUsable(row, nowIso) {
  if (!row || typeof row !== 'object') return false;
  const act = row.Active; // SP Number column: 1 = active
  if (!(act === 1 || act === true || act === '1')) return false;
  const lu = row.LockedUntil;
  if (typeof lu === 'string' && lu !== '' && lu > nowIso) return false; // locked (ISO lexical compare)
  const g = row.GraceUntil;
  if (g != null && g !== '' && !(typeof g === 'string' && g >= nowIso)) return false;
  return true;
}

function mintProof(proofSecret, row, purpose, deviceContext, nowMs) {
  const ttl = purpose === 'session' ? SESSION_TTL_MS : SUDO_TTL_MS;
  const payload = {
    u: String(row.UserId || ''), un: String(row.Username || ''), r: String(row.Role || ''),
    p: purpose, dc: String(deviceContext || ''),
    tv: Number(row.TokenVersion) || 0,
    iat: nowMs, exp: nowMs + ttl, n: crypto.randomBytes(8).toString('hex'),
  };
  const b64 = b64url(JSON.stringify(payload));
  return { proof: b64 + '.' + sign(proofSecret, b64), expiresAt: payload.exp };
}

function evaluateUser(pepper, proofSecret, body, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const purpose = ALL_PURPOSES.includes(body.purpose) ? body.purpose : null;
  const deviceContext = typeof body.deviceContext === 'string' ? body.deviceContext : '';
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!purpose) return { userOk: false, reason: 'BAD_PURPOSE' };
  if (!username || !password) { computeHash(pepper, 'x', 'x', password || 'x'); return { userOk: false }; }

  const row = rows.find(r => r && r.Username === username);
  if (!row) {
    // anti-enumeration: burn equivalent work, identical response shape
    computeHash(pepper, username, 'dummy-salt-0123456789abcdef', password);
    return { userOk: false };
  }
  if (!rowUsable(row, nowIso)) {
    computeHash(pepper, username, String(row.Salt || 'dummy'), password); // equal work even when locked/inactive
    // 'locked' surfaced ONLY to the LA (internal) so it can skip counter-increment on an already-locked row;
    // the LA's outward response stays generic (oracle-safe).
    const lu = row.LockedUntil;
    return { userOk: false, locked: !!(typeof lu === 'string' && lu !== '' && lu > nowIso) };
  }
  const sh = String(row.SecretHash || '');
  if (!/^[0-9a-f]{64}$/i.test(sh)) { computeHash(pepper, username, String(row.Salt || ''), password); return { userOk: false }; }
  const computed = computeHash(pepper, username, String(row.Salt || ''), password);
  if (!timingSafeHexEq(computed, sh.toLowerCase())) return { userOk: false };
  const minted = mintProof(proofSecret, row, purpose, deviceContext, nowMs);
  return { userOk: true, proof: minted.proof, expiresAt: minted.expiresAt, role: String(row.Role || ''), username };
}

function verifyProofBody(proofSecret, body, nowMs) {
  const proof = typeof body.proof === 'string' ? body.proof : '';
  const expected = Array.isArray(body.expectedPurposes) ? body.expectedPurposes.filter(p => ALL_PURPOSES.includes(p)) : [];
  const deviceContext = typeof body.deviceContext === 'string' ? body.deviceContext : '';
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dot = proof.lastIndexOf('.');
  if (dot <= 0 || expected.length === 0) return { ok: false };
  const b64 = proof.slice(0, dot), sig = proof.slice(dot + 1);
  if (!timingSafeHexEq(sign(proofSecret, b64), String(sig))) return { ok: false };
  let payload;
  try { payload = JSON.parse(unb64url(b64)); } catch (e) { return { ok: false }; }
  if (!payload || typeof payload !== 'object') return { ok: false };
  if (!(Number(payload.exp) > nowMs)) return { ok: false };                       // expired
  if (!expected.includes(payload.p)) return { ok: false };                        // wrong purpose
  if (String(payload.dc || '') !== deviceContext) return { ok: false };           // device-context binding
  // tokenVersion: the verifying LA supplies the CURRENT user row; a password reset bumps TokenVersion and
  // kills every outstanding proof instantly (Codex #6 - no grace on password change).
  const row = rows.find(r => r && r.Username === payload.un);
  if (!row) return { ok: false };                                                 // user gone/deactivated -> fail closed
  const nowIso = new Date(nowMs).toISOString();
  if (!rowUsable(row, nowIso)) return { ok: false };                              // deactivated/locked since minting
  if ((Number(row.TokenVersion) || 0) !== (Number(payload.tv) || 0)) return { ok: false };
  return { ok: true, username: String(payload.un), role: String(payload.r || '') };
}

function handlerFactory(fn) {
  return async (request) => {
    const pepper = process.env.BOB_AUTH_PEPPER;
    const proofSecret = process.env.BOB_PROOF_SECRET;
    if (!pepper || pepper.length < 32 || !proofSecret || proofSecret.length < 32) {
      return { status: 500, jsonBody: { error: 'verifier not configured' } }; // FAIL CLOSED at the caller
    }
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    if (Array.isArray(body.rows) && body.rows.length > 50) return { status: 400, jsonBody: { error: 'too many rows' } };
    return { jsonBody: fn(pepper, proofSecret, body, Date.now()) };
  };
}

// mintUserCredential: server-side salt+hash for user-admin create/setPassword. The hash flows Function -> LA ->
// SharePoint only (secureData on both hops); the LA's CLIENT response never contains it (Chunk 5 rule: hash
// material never reaches a client). Enforces the D9-4 minimum lengths (8 everyone, 10 for director role).
function mintCredential(pepper, body) {
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (!username || !/^[A-Za-z0-9_.-]{2,64}$/.test(username)) return { ok: false, reason: 'BAD_USERNAME' };
  const minLen = role === 'director' ? 10 : 8;
  if (password.length < minLen) return { ok: false, reason: 'PASSWORD_TOO_SHORT', minLen };
  const salt = crypto.randomBytes(16).toString('hex');
  return { ok: true, salt, hash: computeHash(pepper, username, salt, password) };
}

app.http('validateUser', { methods: ['POST'], authLevel: 'function', handler: handlerFactory(evaluateUser) });
app.http('verifyProof', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((p, s, b, n) => verifyProofBody(s, b, n)) });
app.http('mintUserCredential', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((p, s, b) => mintCredential(p, b)) });

module.exports = { computeHash, evaluateUser, verifyProofBody, mintProof, mintCredential, rowUsable, SUDO_PURPOSES, ALL_PURPOSES };
