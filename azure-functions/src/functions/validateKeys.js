// BOB Stock — Azure Function: BATCHED credential verifier (Chunk 5 cloud authz).
// Spec: AZURE-CHUNK5-SCOPE.md §5 (verify-not-hash, batched, FAIL CLOSED) — adopted from spec-audit
// rounds 1+2 (GPT HIGH-1 R1: no anonymous oracle, never emit hash material; GPT LOW/MED-4 + AGY MED-1
// R2: ONE round-trip verifies all credentials on a request).
//
// v2 contract (build deviation, documented in the wave review): Logic Apps consumption cannot apply
// secureData to Compose/Select/Query actions, so building a per-credential checks array in WDL would
// leak the presented secrets into run history. Instead the Logic App forwards its inputs UNTRANSFORMED
// (trigger auth object + the raw StoreCredentials rows from a secured ApiConnection read) in ONE
// secured Http call, and THIS function does the pairing, grace-window filtering, and verification.
//
//   POST {claimedStoreId, storeKey, directorKey, rows:[{StoreId,Salt,SecretHash,Version,GraceUntil},...]}
//   -> 200 {storeOk:boolean, directorOk:boolean}     (booleans ONLY — never any hash/salt material)
//   -> 400 on malformed input; 500 if the pepper is not configured.
// The calling Logic App treats ANY non-200 — or unreachable — as NOT VERIFIED and returns 401
// (auth FAILS CLOSED; deliberately opposite to validateMoney's fail-open, which has a client backstop).
//
// Hash scheme (GPT R1 answer 3): HMAC-SHA-256(pepper, storeId + "\0" + salt + "\0" + secret), hex.
// Pepper lives ONLY in the Function App setting BOB_AUTH_PEPPER (never SharePoint / client / repo).
// Comparison is constant-time. authLevel 'function' from day 1 — no anonymous dictionary oracle.
// Grace windows (dual-accept rotation): a row is usable when GraceUntil is empty OR >= now (UTC ISO).
// There is NO hash-emitting route anywhere: seeding/rotation computes salt+hash offline at mint time.

const { app } = require('@azure/functions');
const crypto = require('crypto');

const MAX_ROWS = 20; // a store + '__director' across a few rotation versions

function computeHash(pepper, storeId, salt, secret) {
  return crypto.createHmac('sha256', pepper)
    .update(String(storeId) + '\0' + String(salt) + '\0' + String(secret))
    .digest('hex');
}

function rowUsable(row, nowIso) {
  if (!row || typeof row !== 'object') return false;
  if (row.Active === false) return false;   // GPT R2 caveat: enforce Active in the Function too (defence in
                                            // depth), not solely the Logic App OData filter. Missing Active =
                                            // trust the query (backward-compatible with callers that pre-filter).
  const g = row.GraceUntil;
  if (g == null || g === '') return true;
  return typeof g === 'string' && g >= nowIso ? true : false; // ISO-8601 UTC lexical compare
}

function verifyAgainstRow(pepper, row, secret) {
  if (!secret || typeof secret !== 'string') return false;
  const { StoreId, Salt, SecretHash } = row;
  if (typeof StoreId !== 'string' || !StoreId) return false;
  if (typeof Salt !== 'string' || !Salt) return false;
  if (typeof SecretHash !== 'string' || !/^[0-9a-f]{64}$/i.test(SecretHash)) return false;
  const computed = computeHash(pepper, StoreId, Salt, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(SecretHash.toLowerCase(), 'hex'));
  } catch (e) {
    return false;
  }
}

function evaluate(pepper, body, nowIso) {
  const claimed = typeof body.claimedStoreId === 'string' ? body.claimedStoreId : '';
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(r => rowUsable(r, nowIso));
  let storeOk = false, directorOk = false;
  for (const row of rows) {
    if (row.StoreId === '__director') {
      if (verifyAgainstRow(pepper, row, body.directorKey)) directorOk = true;
    } else if (claimed && row.StoreId === claimed) {
      if (verifyAgainstRow(pepper, row, body.storeKey)) storeOk = true;
    }
  }
  return { storeOk, directorOk };
}

app.http('validateKeys', {
  methods: ['POST'],
  authLevel: 'function', // gated from day 1 (GPT R1 HIGH-1) — key held only by the Logic Apps
  handler: async (request) => {
    const pepper = process.env.BOB_AUTH_PEPPER;
    if (!pepper || pepper.length < 32) {
      // Misconfiguration must FAIL CLOSED at the caller: non-200 -> Logic App returns 401.
      return { status: 500, jsonBody: { error: 'verifier not configured' } };
    }
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { error: 'bad json' } }; }
    if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
      return { status: 400, jsonBody: { error: 'rows must be an array (max ' + MAX_ROWS + ')' } };
    }
    return { jsonBody: evaluate(pepper, body, new Date().toISOString()) };
  }
});

module.exports = { computeHash, verifyAgainstRow, rowUsable, evaluate }; // exported for unit/sentinel tests
