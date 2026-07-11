// BOB Stock - Azure Function: Org-Structure topology engine (Org chunk, OS-W2).
// Same division of labour as accessPolicy/validateUser: the gated `topology-change` Logic App does ALL
// SharePoint I/O + the Director-key/sudo gate + the pending/2-phase-commit journal; THIS function owns the
// PURE decision logic and is exercised directly by the logic-proof suite (test/topology-proof.js).
//
//   POST /api/topologyPlan {intent, state, nowMs}
//     -> {ok, plan} | {ok:false, reason}
//        Validates a Director's ONE intent (create/onboard/add/convert/buyback) and DERIVES the full change
//        set from server-owned rows (OS-SR-2 — never trust a client fanout): the era close/open, the
//        append-only pricing interval, the credential fanout (which logins gain/lose the store, which
//        deactivate), the opening-balance snapshot request, and the buy-back export window. The LA journals
//        this plan `pending`, applies each step idempotently, then marks `complete`; a reconcile sweep
//        resumes a crash (OS-SR-1).
//   POST /api/topologyResolve {eras, pricing, dateMs}
//     -> {owner, rate} — the era-aware read helpers the pull/report LAs use (OS-SR-3/6/11): who owned the
//        store on a date, and which franchise rate applied then (as-of, from the append-only history).
//
// Governing contract: AZURE-CHUNK-ORG-ENFORCEMENT-MATRIX.md; spec: AZURE-CHUNK-ORG-STRUCTURE.md (OS-SR-1..12).

const { app } = require('@azure/functions');

const HO = 'HO';
// Audit OS-A-F1: a NON-POS personal login of ANY of these roles is cancelled when ownership changes (D-OS-2).
// `staff` is included — the shared store POS (isStorePOS) is protected earlier in deriveFanout and STAYS; only
// a staff login WITHOUT isStorePOS is a cancellable personal account.
const PERSONAL_ROLES = ['staff', 'store_manager', 'territory_manager'];
// Codex R10 P1: the COMPLETE set of credential roles this system issues (matches the client). A credential with
// any OTHER role (legacy/typo/injected) holding the store would survive an ownership change with NO fanout
// action — re-opening the live-scope leak. The planner fails closed on any unknown role (as accessPolicy does).
const KNOWN_ROLES = new Set(['staff', 'store_manager', 'territory_manager', 'franchisee', 'director', 'head_office']);
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
// A credential is ACTIVE unless explicitly deactivated (SharePoint stores the flag as 1/0 or true/false).
function isActiveCred(c) { return c.Active !== 0 && c.Active !== false; }

function isFiniteMs(v) { return typeof v === 'number' && Number.isFinite(v); }
function toMs(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; }
function iso(ms) { return new Date(ms).toISOString(); }
function safeId(s) { return typeof s === 'string' && ID_RE.test(s) && !RESERVED.has(s); }
// Audit OS-A-F6: require a RAW string id — `String(undefined)` is the literal 'undefined' which passes ID_RE,
// so an omitted id silently became a valid id. reqId rejects anything not already a well-formed string.
function reqId(v) { return typeof v === 'string' && ID_RE.test(v) && !RESERVED.has(v); }
// Audit OS-A-F3: a franchise rate must be a finite percent in [0,100] (mirrors catalogueMerge's guard).
function validRate(r) { return typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 100; }
// Audit OS-A-F5 (+ Codex conv F1/F3): a WELL-FORMED interval list = every entry parseable, sorted, NON-
// overlapping, and AT MOST ONE open interval (which is therefore last). Empty = valid. Shared by BOTH eras
// and pricing series so there is ONE fail-closed definition, not per-path guards with adjacent bypasses.
function validIntervals(arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length === 0) return true;
  const norm = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') return false;
    // Codex R16 P2: endpoints must be ISO STRINGS (the contract + what the engine itself emits via iso()).
    // Date.parse coerces, so a NUMERIC from/to (e.g. 0) parsed "successfully" and became authoritative
    // era/pricing state — carried into the buyback export boundary. Type-check before parsing.
    if (typeof p.from !== 'string') return false;
    if (p.to != null && typeof p.to !== 'string') return false;
    const f = toMs(p.from); if (f === null) return false;
    const t = p.to == null ? null : toMs(p.to);
    if (p.to != null && t === null) return false;   // unparseable end
    if (t != null && t < f) return false;            // end before start
    norm.push({ f, t });
  }
  norm.sort((a, b) => a.f - b.f);
  let opens = 0;
  for (let i = 0; i < norm.length; i++) {
    if (norm[i].t === null) opens++;
    if (i > 0) { const prevEnd = norm[i - 1].t === null ? Infinity : norm[i - 1].t; if (norm[i].f < prevEnd) return false; }  // overlap (an open prev ⇒ any later interval overlaps ⇒ open must be last)
  }
  return opens <= 1;
}
// An era list is valid intervals AND every owner is 'HO' or a well-formed id (Codex conv-R2 F1: reject '' /
// malformed owners — an empty owner was resolving into a live window + a blank export franchiseeId).
function validEras(eras) {
  if (!validIntervals(eras)) return false;
  return (Array.isArray(eras) ? eras : []).every(e => e && (e.owner === HO || reqId(e.owner)));
}
// A pricing series is valid intervals AND every interval's RATE is a valid percent (Codex conv-R3 F2:
// validIntervals only checked geometry — a stored -1/101/NaN/Infinity rate slipped through and was resolved).
function validPricingSeries(arr) {
  if (!validIntervals(arr)) return false;
  return (Array.isArray(arr) ? arr : []).every(p => p && validRate(p.rate));
}
// The single OPEN era (to:null), or null. Used by the PLANNER as "the current owner" — a topology change must
// transition from the OPEN era, never a closed era that merely covers `now` (Codex conv-R2 F2: a future-dated
// closed era must NOT read as current). resolveEra (below) is for HISTORICAL date lookups by the read LAs.
function openEraOwner(eras) { const o = (Array.isArray(eras) ? eras : []).filter(e => e && e.to == null); return o.length === 1 ? { owner: o[0].owner, from: o[0].from } : null; }

// ── Era resolution (OS-SR-6 visibility) ───────────────────────────────────────────────────────────────
// eras = [{owner, from:<ISO>, to:<ISO|null>}]. Returns the owner whose [from,to) covers dateMs (to:null =
// open/current). Null if none OR malformed (validEras) — fail-closed for the caller.
function resolveEra(eras, dateMs) {
  if (!isFiniteMs(dateMs) || !validEras(eras)) return null;   // OS-A-F5/Codex-F1: malformed (multi-open OR overlapping) ⇒ fail closed
  for (const e of eras) {
    if (!e || typeof e.owner !== 'string') continue;
    const f = toMs(e.from); if (f === null || dateMs < f) continue;
    const t = e.to == null ? Infinity : toMs(e.to);
    if (t === null) continue;
    if (dateMs < t) return { owner: e.owner, from: e.from, to: e.to };
  }
  return null;
}

// The [from,to) windows an account may SEE. A device-bound role (store POS / store_manager — no franchiseeId)
// sees the CURRENT era ONLY (OS-SR-6). A franchisee/HO account sees every era it owned. Malformed ⇒ [].
function eraWindowsFor(eras, ownerId, deviceBound) {
  if (!validEras(eras)) return [];   // Codex-F1: the era-window helper must fail closed on malformed state too
  if (!Array.isArray(eras)) return [];
  if (deviceBound) {
    const cur = eras.find(e => e && e.to == null);
    return cur ? [{ from: cur.from, to: cur.to }] : [];
  }
  return eras.filter(e => e && e.owner === ownerId).map(e => ({ from: e.from, to: e.to }));
}

// ── Pricing resolution (OS-SR-3/11 — rate as-of a row's date, from the append-only history) ────────────
function resolvePricingRate(intervals, dateMs) {
  if (!isFiniteMs(dateMs) || !validPricingSeries(intervals)) return null;   // Codex conv-R2 F3 + R3 F2: malformed geometry OR a bad rate ⇒ fail closed, never resolve
  for (const p of intervals) {
    if (!p || typeof p.rate !== 'number') continue;
    const f = toMs(p.from); if (f === null || dateMs < f) continue;
    const t = p.to == null ? Infinity : toMs(p.to);
    if (t === null) continue;
    if (dateMs < t) return p.rate;
  }
  return null;   // no rate in force ⇒ caller treats as no franchise loading (fail to no-discount, never guess)
}

// Per-PRODUCT rate resolution (Kunal 2026-07-10): different products carry different franchise %; the store
// default is the fallback. `storePricing` = { '*': <default series>, '<productId>': <override series>, ... }.
// The lens reads the PRODUCT's own dated series as-of the row's date if one exists, else the '*' default
// series as-of that date. Every series is append-only + immutable (OS-SR-11/12), so a product-rate change is
// also historically frozen — the same fix as the store default, applied per product.
const PRICING_DEFAULT_KEY = '*';
function resolvePricingForProduct(storePricing, productId, dateMs) {
  if (Array.isArray(storePricing)) storePricing = { [PRICING_DEFAULT_KEY]: storePricing };  // OS-A-F7: tolerate a flat default series
  if (!storePricing || typeof storePricing !== 'object') return null;
  // Codex R13 P2: the READ path must fail closed on a malformed pricing map, symmetric with the write/planner
  // paths (R12). A reserved/malformed KEY (e.g. a JSON.parse-created '__proto__', or 'bad key!') that reached
  // the lens was read back as authoritative pricing — treat any bad key as malformed ⇒ null (no franchise rate,
  // never guess). Keys must be '*' or a well-formed productId.
  if (!Object.keys(storePricing).every(k => k === PRICING_DEFAULT_KEY || reqId(k))) return null;
  // Codex R14 P2: the REQUESTED productId must also be well-formed (symmetry with the map keys). A malformed/
  // reserved/non-string productId (`'bad key!'`, `'__proto__'`, `42`) previously MISSED the override lookup and
  // silently fell through to the '*' default — treating corrupt input as a valid unlisted product. Fail closed.
  // (null/undefined productId is a legitimate STORE-level query ⇒ resolve the default.)
  if (productId != null && !reqId(productId)) return null;
  if (productId != null && Object.prototype.hasOwnProperty.call(storePricing, productId)) {
    const own = storePricing[productId];
    if (!validPricingSeries(own)) return null;   // Codex conv-R3 F2: a MALFORMED override fails CLOSED — never silently fall back to the default rate
    const viaOwn = resolvePricingRate(own, dateMs);
    if (viaOwn != null) return viaOwn;            // a VALID override that simply doesn't cover this date ⇒ default applies (correct)
  }
  return resolvePricingRate(storePricing[PRICING_DEFAULT_KEY], dateMs);
}
// Append a rate change to ONE key ('*' for the store default, or a productId for an override) inside the
// per-store pricing map. Returns the updated map or {error}. Used by BOTH the topology planner (store default
// at conversion) and the product-pricing edit path (per-product override) so every rate change is dated.
function appendPricingForKey(storePricing, key, rate, nowMs) {
  if (storePricing != null && (typeof storePricing !== 'object' || Array.isArray(storePricing))) return { error: 'MALFORMED_PRICING' };  // Codex conv-R4: a non-map fails closed, never silently becomes {}
  // Codex R12 P2: this exported helper is used by BOTH the planner AND the product-pricing edit path. It must
  // validate the KEY itself (not just the map) — else a direct consumer mints an authoritative map with a
  // malformed/reserved key (`'bad key!'`, `'__proto__'`) that the planner then refuses to operate on.
  if (key !== PRICING_DEFAULT_KEY && !reqId(key)) return { error: 'MALFORMED_PRICING' };
  // Codex R15 P2: validate the EXISTING map's keys too (symmetry with closeAllPricing/planner/read) — else a
  // dirty key ('bad key!', a JSON.parse '__proto__') rides through the spread into the returned authoritative
  // map, which the planner then refuses to operate on.
  if (storePricing) { for (const k of Object.keys(storePricing)) if (k !== PRICING_DEFAULT_KEY && !reqId(k)) return { error: 'MALFORMED_PRICING' }; }
  const map = storePricing && typeof storePricing === 'object' ? { ...storePricing } : {};
  const r = appendPricingInterval(map[key], rate, nowMs);
  if (r.error) return { error: r.error };
  map[key] = r.history;
  return { pricing: map };
}

// Append-only pricing change (OS-SR-12): CLOSE the open interval at nowMs, OPEN a new one from nowMs. NEVER
// mutates a prior interval. A rate === current open rate is a no-op (no spurious interval). Returns the new
// history or {error} on an immutability violation (e.g. a from earlier than the last closed interval).
function appendPricingInterval(history, rate, nowMs) {
  if (rate != null && !validRate(rate)) return { error: 'BAD_RATE' };       // OS-A-F3: no NaN/out-of-range rate
  if (history != null && !validPricingSeries(history)) return { error: 'MALFORMED_PRICING' };  // Codex conv-R3 F2: validate the RAW existing series (catches a non-array + bad stored rates), not the coerced copy
  const h = Array.isArray(history) ? history.map(x => ({ ...x })) : [];
  const opens = h.filter(p => p && p.to == null);
  // Codex-F3(a): the backdate/overlap guard runs BEFORE the same-rate no-op — else a same-rate backdated
  // append short-circuits to ok while leaving a gap over the change date. OS-A-F4: new interval must start
  // AT/AFTER the end of EVERY existing interval (not just the open one), so a closed period can't be overlapped.
  let lastBoundary = -Infinity;
  for (const p of h) { const b = p && (p.to == null ? toMs(p.from) : toMs(p.to)); if (b != null && b > lastBoundary) lastBoundary = b; }
  if (h.length && nowMs < lastBoundary) return { error: 'PRICING_BACKDATE' };
  const open = opens[0];
  if (open && Number(open.rate) === Number(rate)) return { history: h };   // unchanged (only reached once the guards pass)
  if (open) open.to = iso(nowMs);
  if (rate != null) h.push({ rate: Number(rate), from: iso(nowMs), to: null });
  return { history: h };
}

// Close the open pricing interval (buy-back → no franchise rate going forward).
function closePricing(history, nowMs) {
  if (history != null && !validPricingSeries(history)) return { error: 'MALFORMED_PRICING' };   // Codex conv-R3 F2: validate RAW (a non-array 'series' was silently becoming [])
  const h = Array.isArray(history) ? history.map(x => ({ ...x })) : [];
  // Codex conv-R3 F2: a closed interval ending in the FUTURE relative to nowMs would leave a franchise rate
  // effective PAST the buy-back — reject (the engine never produces this; a malformed input must fail closed).
  for (const p of h) { const t = p.to == null ? null : toMs(p.to); if (t != null && t > nowMs) return { error: 'PRICING_BACKDATE' }; }
  const open = h.find(p => p && p.to == null);
  if (open) { const of = toMs(open.from); if (of !== null && nowMs < of) return { error: 'PRICING_BACKDATE' }; open.to = iso(nowMs); }
  return { history: h };
}
// Buy-back closes EVERY open series (store default '*' AND every per-product override) — the store leaves the
// franchise, so all franchise rates stop applying going forward; the closed intervals stay immutable.
function closeAllPricing(storePricing, nowMs) {
  if (storePricing != null && (typeof storePricing !== 'object' || Array.isArray(storePricing))) return { error: 'MALFORMED_PRICING' };  // Codex conv-R4: a non-map fails closed
  const map = storePricing && typeof storePricing === 'object' ? { ...storePricing } : {};
  // Codex R12 P2: validate the KEYS too (symmetry with appendPricingForKey) — this exported helper must not
  // process/return an authoritative map with a malformed/reserved key.
  for (const k of Object.keys(map)) if (k !== PRICING_DEFAULT_KEY && !reqId(k)) return { error: 'MALFORMED_PRICING' };
  for (const k of Object.keys(map)) { const c = closePricing(map[k], nowMs); if (c.error) return { error: c.error }; map[k] = c.history; }
  return { pricing: map };
}

// ── Era transition: close the open era, open a new one under newOwner ──────────────────────────────────
function transitionEras(eras, newOwner, nowMs) {
  if (!validEras(eras)) return { error: 'MALFORMED_ERAS' };   // OS-A-F5/Codex-F1: refuse to transition a malformed input state
  if (!(newOwner === HO || reqId(newOwner))) return { error: 'BAD_OWNER' };   // Codex conv-R2 F1: never open an era with a blank/malformed owner
  const e = Array.isArray(eras) ? eras.map(x => ({ ...x })) : [];
  const open = e.find(x => x && x.to == null);
  if (open) { const of = toMs(open.from); if (of !== null && nowMs < of) return { error: 'ERA_BACKDATE' }; open.to = iso(nowMs); }
  e.push({ owner: newOwner, from: iso(nowMs), to: null });
  if (!validEras(e)) return { error: 'MALFORMED_ERAS' };   // Codex conv-R2 F2: reject if appending overlaps a closed-future era (output must stay well-formed)
  return { eras: e, closedOwner: open ? open.owner : null };
}

// ── Credential fanout derivation (OS-SR-2 — server-derived, never client) ──────────────────────────────
// Given ALL credentials (device StoreCredentials + person UserCredentials, each {id, Role, StoreIds[],
// Active, franchiseeId?, isStorePOS?}) and the transition, compute the diff. Rules:
//  - store POS device cred for the store: STAYS (scope unchanged) but scopeVersion BUMPED (D-OS-2/D-OS-F6).
//  - new owner's franchisee office cred: ADD store; bump.
//  - old owner's franchisee office cred: REMOVE store; bump; LEFT ACTIVE even if empty (D-OS-4).
//  - personal accounts (PERSONAL_ROLES) holding the store, on a CONVERT: REMOVE store; DEACTIVATE if now
//    zero stores (single-store manager) else keep the rest (multi-store TM); bump. (Not touched on add/buyback
//    of a store that was already theirs — only ownership-change conversions cancel personal people.)
function deriveFanout(creds, storeId, opts) {
  const { newFranchiseeId, oldFranchiseeId, cancelPersonal } = opts;
  const out = [];
  for (const c of (Array.isArray(creds) ? creds : [])) {
    if (!c || !safeId(String(c.id))) continue;
    const ids = Array.isArray(c.StoreIds) ? c.StoreIds.slice() : [];
    const has = ids.includes(storeId);
    if (c.isStorePOS && has) { out.push({ id: c.id, action: 'bump' }); continue; }  // POS stays, just bump
    if (newFranchiseeId && c.franchiseeId === newFranchiseeId && c.isFranchiseOffice) {
      if (!has) { ids.push(storeId); out.push({ id: c.id, action: 'setStoreIds', StoreIds: ids, active: true }); }
      else out.push({ id: c.id, action: 'bump' });
      continue;
    }
    if (oldFranchiseeId && c.franchiseeId === oldFranchiseeId && c.isFranchiseOffice && has) {
      const next = ids.filter(x => x !== storeId);
      // D-OS-4: the ex-office is NOT deactivated by losing the store (stays active even if empty). Codex R11 P2:
      // but it must not be REACTIVATED either — a Director-deactivated office stays deactivated. Preserve state.
      out.push({ id: c.id, action: 'setStoreIds', StoreIds: next, active: isActiveCred(c) });
      continue;
    }
    if (cancelPersonal && has && PERSONAL_ROLES.includes(String(c.Role))) {
      const next = ids.filter(x => x !== storeId);
      out.push({ id: c.id, action: 'setStoreIds', StoreIds: next, active: next.length > 0 });  // deactivate if zero left (D-OS-2)
      continue;
    }
  }
  return out;
}

// Codex R9 F3: the DEFAULT '*' pricing history must ALIGN with the ownership eras — franchise rates cover the
// franchise periods with NO gaps, and NO franchise pricing exists during an HO period. The engine's own outputs
// satisfy this by construction (append on the era boundary, close on buy-back); a state that VIOLATES it is
// corrupt and would export a wrong/partial billing window. Returns true iff aligned. `eras`/pricing assumed
// already geometry-valid (validEras + validPricingSeries) by the caller.
function pricingAlignsWithEras(pricing, eras, nowMs) {
  const win = (x) => [toMs(x.from), x.to == null ? Infinity : toMs(x.to)];
  const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  const HOwins = eras.filter(e => e.owner === HO).map(win);
  const frWins = eras.filter(e => e.owner !== HO).map(win);
  // 1) NO pricing interval (default OR any per-product override) may overlap an HO era — a franchise rate must
  //    never be effective while the store is HO-owned.
  for (const k of Object.keys(pricing)) {
    for (const iv of (Array.isArray(pricing[k]) ? pricing[k] : [])) {
      const [f, t] = win(iv);
      if (f === null) return false;
      for (const [h0, h1] of HOwins) if (overlaps(f, t, h0, h1)) return false;
    }
  }
  // 2) every FRANCHISE era must be fully + contiguously covered by the default '*' series (no uncovered gap).
  const def = (Array.isArray(pricing[PRICING_DEFAULT_KEY]) ? pricing[PRICING_DEFAULT_KEY] : []).map(win).sort((a, b) => a[0] - b[0]);
  for (const [e0, e1] of frWins) {
    let cursor = e0;
    for (const [p0, p1] of def) {
      if (p1 <= cursor) continue;
      if (p0 > cursor) break;          // gap before this interval → not covered
      cursor = p1;
      if (cursor >= e1) break;
    }
    if (cursor < e1) return false;
  }
  return true;
}

// ── The planner ────────────────────────────────────────────────────────────────────────────────────────
function planTopologyChange(intent, state, nowMs) {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: 'BAD_INTENT' };
  if (!isFiniteMs(nowMs)) return { ok: false, reason: 'BAD_NOW' };
  const op = intent.op;
  const storeId = intent.storeId;
  if (!reqId(storeId)) return { ok: false, reason: 'BAD_STORE_ID' };   // OS-A-F6: reject omitted/undefined id
  // Codex conv-R4 F1: the SERVER-STATE ENVELOPE must be VALIDATED, never silently coerced to defaults. A
  // malformed collection (e.g. creds:'not-an-array') coerced to [] produced an EMPTY fanout on a convert —
  // silently SKIPPING the personal-account cancellations (the data-leak fix) and POS bumps. A present-but-
  // wrong-typed field FAILS CLOSED (a missing/undefined field may still default). And the state bundle MUST be
  // for the store the intent names.
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { ok: false, reason: 'BAD_STATE' };
  const st = state;
  // Codex conv-R5 F1/F2: the LA always supplies the COMPLETE server-owned state, so every collection must be
  // PRESENT and correctly typed — a MISSING one is NOT defaulted (omitting creds previously produced an empty
  // fanout, re-opening the exact security hole). Missing/wrong-type ⇒ BAD_STATE.
  if (!Array.isArray(st.creds)) return { ok: false, reason: 'BAD_STATE' };
  if (!Array.isArray(st.franchisees)) return { ok: false, reason: 'BAD_STATE' };
  if (!Array.isArray(st.eras)) return { ok: false, reason: 'BAD_STATE' };
  if (!st.pricing || typeof st.pricing !== 'object' || Array.isArray(st.pricing)) return { ok: false, reason: 'BAD_STATE' };
  if (st.store != null && (typeof st.store !== 'object' || st.store.id !== storeId)) return { ok: false, reason: 'STORE_ID_MISMATCH' };  // the bundle must be FOR this store
  // Codex conv-R5 F1 + R7 F1: validate EVERY credential ROW — a malformed row (no id, StoreIds not an array,
  // primitive entry) was SILENTLY SKIPPED by deriveFanout, meaning a required cancellation was never emitted.
  // R7: the fanout-driving flags (isStorePOS / isFranchiseOffice / Active) are read by TRUTHINESS in
  // deriveFanout, so a non-boolean (e.g. the string 'false', which is truthy) would flip a personal staff cred
  // into the store POS and let it KEEP the converted store. They must be strict booleans; franchiseeId, if
  // present, must be a well-formed id. Fail closed on any deviation.
  if (!st.creds.every(c => c && typeof c === 'object' && reqId(c.id) && typeof c.Role === 'string' && KNOWN_ROLES.has(c.Role)   // Codex R10 P1: role must be a KNOWN role (an unknown role holding the store would survive ownership change with no fanout)
      && Array.isArray(c.StoreIds) && c.StoreIds.every(s => reqId(s))   // sweep: each StoreId a WELL-FORMED id (reject a reserved/injected/malformed scope entry), not just any string
      && (c.username === undefined || typeof c.username === 'string') && (c.Username === undefined || typeof c.Username === 'string')   // sweep: the optional login aliases feed uniqueness checks — must be strings
      && (c.isStorePOS === undefined || typeof c.isStorePOS === 'boolean')
      && (c.isFranchiseOffice === undefined || typeof c.isFranchiseOffice === 'boolean')
      // Codex R11 P2: `Active` gates isActiveCred (the inactive-office guard). It is NOT a fanout truthiness
      // flag, so SharePoint's 1/0 is allowed — but a STRING (`'false'` is truthy) would defeat the guard. Accept
      // only boolean or 0/1.
      && (c.Active === undefined || typeof c.Active === 'boolean' || c.Active === 0 || c.Active === 1)
      && (c.franchiseeId === undefined || c.franchiseeId === null || reqId(c.franchiseeId))
      // Codex R9 F1: the fanout flags must be CONSISTENT with the role, not just well-typed booleans. A store
      // POS is a `staff`-role device login; a franchise office is a `franchisee`-role login WITH a franchiseeId;
      // the two kinds are mutually exclusive. Without this a `store_manager` could set isStorePOS to dodge
      // cancellation, or a `staff` login could pose as an office and gain store scope.
      && !(c.isStorePOS === true && c.isFranchiseOffice === true)
      && (c.isStorePOS !== true || c.Role === 'staff')
      && (c.isFranchiseOffice !== true || (c.Role === 'franchisee' && reqId(c.franchiseeId))))) return { ok: false, reason: 'BAD_CREDENTIAL' };
  // Codex R7 F1: credential ids are primary keys — a duplicate id would emit TWO conflicting fanout actions
  // (a bump AND a setStoreIds) for the same account. Reject a duplicated id.
  { const seen = new Set(); for (const c of st.creds) { if (seen.has(c.id)) return { ok: false, reason: 'DUPLICATE_CREDENTIAL' }; seen.add(c.id); } }
  // Codex R10 note: a franchisee has exactly ONE office credential — two office rows for one franchiseeId would
  // both gain the store on convert (double scope). Reject more than one office per franchisee.
  { const offSeen = new Set(); for (const c of st.creds) { if (c.isFranchiseOffice === true) { if (offSeen.has(c.franchiseeId)) return { ok: false, reason: 'DUPLICATE_OFFICE' }; offSeen.add(c.franchiseeId); } } }
  // Codex R11 P2 (OS-SR-8): the franchisee entity is the STABLE identity — every row must be a well-formed
  // object with a valid franchiseeId, and the id must be UNIQUE (two rows for one id = ambiguous server truth).
  if (!st.franchisees.every(f => f && typeof f === 'object' && !Array.isArray(f) && reqId(f.franchiseeId)
      && (f.officeUsername === undefined || f.officeUsername === null || reqId(f.officeUsername))   // sweep: office login must be a well-formed id (feeds usernameTaken)
      && (f.officeStoreId === undefined || f.officeStoreId === null || reqId(f.officeStoreId))       // sweep: office store id well-formed
      && (f.displayName === undefined || f.displayName === null || typeof f.displayName === 'string'))) return { ok: false, reason: 'BAD_FRANCHISEE' };
  { const fSeen = new Set(); for (const f of st.franchisees) { if (fSeen.has(f.franchiseeId)) return { ok: false, reason: 'DUPLICATE_FRANCHISEE' }; fSeen.add(f.franchiseeId); } }
  // sweep (OS-SR-8 login namespace): credential ids and franchisee office usernames share ONE login namespace —
  // no identifier may collide ACROSS accounts (a cred id == an office username = two accounts, one login). The
  // per-collection dupe checks above don't catch a cross-collection collision. Aliases WITHIN one account (its
  // id == its own username) are fine — dedupe per-account before checking the global set.
  { const logins = new Set();
    const claim = (identifiers) => { const own = new Set(identifiers.filter(u => u != null)); for (const u of own) { if (logins.has(u)) return true; } for (const u of own) logins.add(u); return false; };
    for (const c of st.creds) { if (claim([c.id, c.username, c.Username])) return { ok: false, reason: 'DUPLICATE_LOGIN' }; }
    for (const f of st.franchisees) { if (claim([f.officeUsername])) return { ok: false, reason: 'DUPLICATE_LOGIN' }; } }
  // Codex conv-R5 F2: validate EVERY pricing series in the map (not only the touched key), else a malformed
  // per-product override rides into the committed plan.
  // sweep: every pricing-map KEY must be the default '*' or a well-formed productId (block a reserved/injected
  // key like '__proto__'); every VALUE a valid series.
  if (!Object.keys(st.pricing).every(k => k === PRICING_DEFAULT_KEY || reqId(k))) return { ok: false, reason: 'MALFORMED_PRICING' };
  if (!Object.values(st.pricing).every(v => validPricingSeries(v))) return { ok: false, reason: 'MALFORMED_PRICING' };
  const creds = st.creds;
  const franchisees = st.franchisees;
  const eras = st.eras;
  const pricing = st.pricing;
  if (!validEras(eras)) return { ok: false, reason: 'MALFORMED_STATE' };   // OS-A-F5/Codex-F1: fail closed on any malformed era history (multi-open OR overlapping)
  // Codex conv-R3 F1 + R5 F2: store-row, era-HISTORY, and pricing-HISTORY existence must AGREE. A real store
  // has ownership history; a NEW store (no store row, no eras) must ALSO have no orphan pricing history — else a
  // storeId whose financial history exists could be re-created.
  if ((!!st.store) !== (eras.length > 0)) return { ok: false, reason: 'STORE_ERA_MISMATCH' };
  if (eras.length === 0 && Object.values(pricing).some(v => Array.isArray(v) && v.length > 0)) return { ok: false, reason: 'STORE_ERA_MISMATCH' };
  const rec = { op, storeId, ts: iso(nowMs) };

  // Codex conv-R2 F2: "current owner" is the OPEN era, NOT any closed era covering `now` (a future-dated
  // closed era must never read as current). resolveEra (date lookup) is for the read LAs, not the planner.
  const currentOwner = openEraOwner(eras);   // null for a brand-new store OR an all-closed (malformed) history
  // Codex-F2: an EXISTING store must have an OPEN current era (seeded at cutover). st.store set but no open era
  // ⇒ uninitialised/malformed ⇒ fail closed; never treat it as brand-new (which would skip the takeover
  // snapshot + previous-owner sever). `create` legitimately has st.store == null (guarded per-branch below).
  if (op !== 'create' && st.store && !currentOwner) return { ok: false, reason: 'NO_ERA_RECORD' };
  const franchiseeExists = (fid) => franchisees.some(f => f && f.franchiseeId === fid);
  // Codex-F4 (+ conv-R2 F4): a login must be UNIQUE across existing credentials + franchisee offices. The store
  // POS login == the storeId, so a new store must also not collide, and an onboard's office username must differ
  // from the store's own POS login.
  const usernameTaken = (u) => creds.some(c => c && (c.username === u || c.Username === u || c.id === u)) || franchisees.some(f => f && f.officeUsername === u);
  // Codex R7 F1: an EXISTING store is a going concern → its store-POS device credential MUST be present in the
  // supplied state (the LA passes the complete server rows). Without it deriveFanout emits no POS bump and the
  // store's device login silently drops out of scope. `create` targets a NEW store (POS is created), so exempt.
  const storePOSExists = creds.some(c => c.isStorePOS === true && c.StoreIds.includes(storeId));
  if (op !== 'create' && st.store && !storePOSExists) return { ok: false, reason: 'NO_STORE_POS' };
  // Codex R7 F2: cross-collection consistency for a LIVE (open) franchise era. The current franchise owner MUST
  // have a stable franchisee entity (OS-SR-8) — else buyback exports for an orphan `fr_ghost` — AND the store
  // MUST carry an OPEN default '*' pricing interval (seeded when it became a franchise) — else buyback closes no
  // active franchise rate. Either gap = a structurally impossible state; fail closed.
  if (currentOwner && currentOwner.owner !== HO) {
    if (!franchiseeExists(currentOwner.owner)) return { ok: false, reason: 'ORPHAN_ERA_OWNER' };
    const def = pricing[PRICING_DEFAULT_KEY];
    if (!(Array.isArray(def) && def.some(i => i && i.to == null))) return { ok: false, reason: 'NO_ACTIVE_PRICING' };
  }
  // Codex R9 F3: the '*' pricing history must ALIGN with the ownership eras (covers franchise periods with no
  // gap; no franchise rate during an HO period). Applies to any store that has history.
  if (eras.length > 0 && !pricingAlignsWithEras(pricing, eras, nowMs)) return { ok: false, reason: 'PRICING_ERA_MISALIGNED' };
  const officeCredFor = (fid) => creds.find(c => c.isFranchiseOffice === true && c.franchiseeId === fid) || null;

  // ---- create HO store ----
  if (op === 'create' && intent.type === 'HO') {
    if (st.store) return { ok: false, reason: 'STORE_EXISTS' };
    if (usernameTaken(storeId)) return { ok: false, reason: 'STORE_LOGIN_TAKEN' };   // conv-R2 F4: the new store POS login (=storeId) must be unique
    const e = transitionEras([], HO, nowMs); if (e.error) return { ok: false, reason: e.error };
    return { ok: true, plan: { eras: e.eras, pricing, fanout: [], createAccounts: [{ kind: 'storePOS', storeId }], snapshot: null, export: null, record: { ...rec, from: null, to: HO } } };
  }

  // ---- create born-franchise store (existing franchisee) OR add store to existing franchisee ----
  if ((op === 'create' && intent.type === 'franchise') || op === 'add') {
    if (op === 'create' && st.store) return { ok: false, reason: 'STORE_EXISTS' };   // conv-R2 F2: create must target a NEW store
    const fid = intent.toFranchiseeId;
    if (!reqId(fid) || !franchiseeExists(fid)) return { ok: false, reason: 'NO_SUCH_FRANCHISEE' };
    if (currentOwner && currentOwner.owner !== HO) return { ok: false, reason: 'DIRECT_TRANSFER_FORBIDDEN' };  // OS-A-F8/D-OS-3: no direct fran→fran (buy back to HO first) — a franchise-owned store rejects `add` outright
    { const office = officeCredFor(fid); if (!office) return { ok: false, reason: 'NO_TARGET_OFFICE' };   // Codex R7 F1: the new owner's office cred must exist, else it never gains store scope
      if (!isActiveCred(office)) return { ok: false, reason: 'INACTIVE_TARGET_OFFICE' }; }   // Codex R10 note: a topology change must not silently reactivate a Director-deactivated office
    if (!validRate(intent.rate)) return { ok: false, reason: 'BAD_RATE' };   // OS-A-F3: a franchise op needs a valid rate
    if (!st.store && usernameTaken(storeId)) return { ok: false, reason: 'STORE_LOGIN_TAKEN' };   // conv-R2 F4: a NEW store's POS login must be unique
    const wasHO = currentOwner && currentOwner.owner === HO;   // an existing HO store being handed over
    const e = transitionEras(eras, fid, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingForKey(pricing, PRICING_DEFAULT_KEY, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: fid, oldFranchiseeId: e.closedOwner !== HO ? e.closedOwner : null, cancelPersonal: wasHO });
    const createAccounts = st.store ? [] : [{ kind: 'storePOS', storeId }];
    return { ok: true, plan: { eras: e.eras, pricing: pr.pricing, fanout, createAccounts, snapshot: wasHO ? { store: storeId, cutoffMs: nowMs } : null, export: null, record: { ...rec, from: e.closedOwner, to: fid } } };
  }

  // ---- onboard NEW franchisee (+ first store, new or an existing HO store) ----
  if (op === 'onboard') {
    const nf = intent.newFranchisee;
    if (!nf || !reqId(nf.franchiseeId) || franchiseeExists(nf.franchiseeId)) return { ok: false, reason: 'BAD_NEW_FRANCHISEE' };
    if (!reqId(nf.officeUsername)) return { ok: false, reason: 'BAD_OFFICE_USERNAME' };
    if (nf.displayName != null && typeof nf.displayName !== 'string') return { ok: false, reason: 'BAD_NEW_FRANCHISEE' };   // sweep: displayName flows into the created account
    if (usernameTaken(nf.franchiseeId)) return { ok: false, reason: 'USERNAME_TAKEN' };   // sweep: the new franchiseeId must not collide with an existing login either
    if (usernameTaken(nf.officeUsername) || nf.officeUsername === storeId) return { ok: false, reason: 'USERNAME_TAKEN' };   // Codex-F4 + conv-R2 F4: office login unique AND distinct from the store POS login
    if (!validRate(intent.rate)) return { ok: false, reason: 'BAD_RATE' };   // OS-A-F3
    if (currentOwner && currentOwner.owner !== HO) return { ok: false, reason: 'DIRECT_TRANSFER_FORBIDDEN' };  // OS-A-F8/D-OS-3
    if (!st.store && usernameTaken(storeId)) return { ok: false, reason: 'STORE_LOGIN_TAKEN' };   // conv-R2 F4: new store POS login unique
    const wasHO = currentOwner && currentOwner.owner === HO;
    const e = transitionEras(eras, nf.franchiseeId, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingForKey(pricing, PRICING_DEFAULT_KEY, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    // Codex R10 note: the new office account is born SCOPED to its first store — else, applied literally, it
    // would start empty and the franchisee couldn't see the store they were just onboarded onto.
    const createAccounts = [{ kind: 'franchisee', franchiseeId: nf.franchiseeId, displayName: nf.displayName, officeUsername: nf.officeUsername, StoreIds: [storeId] }];
    if (!st.store) createAccounts.push({ kind: 'storePOS', storeId });
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: nf.franchiseeId, oldFranchiseeId: null, cancelPersonal: wasHO });
    return { ok: true, plan: { eras: e.eras, pricing: pr.pricing, fanout, createAccounts, snapshot: wasHO ? { store: storeId, cutoffMs: nowMs } : null, export: null, record: { ...rec, from: e.closedOwner, to: nf.franchiseeId } } };
  }

  // ---- convert HO store → franchise (existing franchisee) — the D-OS-1 case A when the franchisee exists ----
  if (op === 'convert') {
    if (!currentOwner || currentOwner.owner !== HO) return { ok: false, reason: 'NOT_HO_OWNED' };
    const fid = intent.toFranchiseeId;
    if (!reqId(fid) || !franchiseeExists(fid)) return { ok: false, reason: 'NO_SUCH_FRANCHISEE' };
    { const office = officeCredFor(fid); if (!office) return { ok: false, reason: 'NO_TARGET_OFFICE' };   // Codex R7 F1: the new owner's office cred must exist, else it never gains store scope
      if (!isActiveCred(office)) return { ok: false, reason: 'INACTIVE_TARGET_OFFICE' }; }   // Codex R10 note: a topology change must not silently reactivate a Director-deactivated office
    if (!validRate(intent.rate)) return { ok: false, reason: 'BAD_RATE' };   // OS-A-F3
    const e = transitionEras(eras, fid, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingForKey(pricing, PRICING_DEFAULT_KEY, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: fid, oldFranchiseeId: null, cancelPersonal: true });
    return { ok: true, plan: { eras: e.eras, pricing: pr.pricing, fanout, createAccounts: [], snapshot: { store: storeId, cutoffMs: nowMs }, export: null, record: { ...rec, from: HO, to: fid } } };
  }

  // ---- buy-back franchise → HO ----
  if (op === 'buyback') {
    if (!currentOwner || currentOwner.owner === HO) return { ok: false, reason: 'NOT_FRANCHISE_OWNED' };
    const oldFid = currentOwner.owner;
    // Codex R9 F2: the ex-owner's office credential must EXIST and currently HOLD the store — else deriveFanout
    // emits no scope-removal and the departed franchisee keeps the (now-HO) store in scope. Mirrors NO_TARGET_OFFICE.
    if (!creds.some(c => c.isFranchiseOffice === true && c.franchiseeId === oldFid && c.StoreIds.includes(storeId))) return { ok: false, reason: 'NO_EXOFFICE' };
    const e = transitionEras(eras, HO, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = closeAllPricing(pricing, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    // OS-A-F2 (both auditors, P1): ownership is CHANGING → the ex-franchisee's personal staff/mgr/TM lose the
    // store (deactivate if zero left). Without this they keep the now-HO store in scope and pull HO's data.
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: null, oldFranchiseeId: oldFid, cancelPersonal: true });
    // OS-SR-4: export the ex-franchisee's just-closed era [from,to) — server-generated later from this window.
    const closed = e.eras.find(x => x && x.owner === oldFid && x.to === iso(nowMs));
    return { ok: true, plan: { eras: e.eras, pricing: pr.pricing, fanout, createAccounts: [], snapshot: { store: storeId, cutoffMs: nowMs }, export: { franchiseeId: oldFid, storeId, from: closed ? closed.from : null, to: iso(nowMs) }, record: { ...rec, from: oldFid, to: HO } } };
  }

  return { ok: false, reason: 'UNKNOWN_OP' };
}

// ── HTTP handlers ──────────────────────────────────────────────────────────────────────────────────────
function handlerFactory(fn) {
  return async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { return { status: 400, jsonBody: { ok: false, reason: 'bad json' } }; }
    return { jsonBody: fn(body, Date.now()) };
  };
}

app.http('topologyPlan', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((b, now) => planTopologyChange(b.intent, b.state, isFiniteMs(b.nowMs) ? b.nowMs : now)) });
app.http('topologyResolve', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((b) => ({ owner: resolveEra(b.eras, b.dateMs), rate: resolvePricingForProduct(b.pricing, b.productId, b.dateMs) })) });  // OS-A-F7: per-product resolution via the route

module.exports = { resolveEra, eraWindowsFor, resolvePricingRate, resolvePricingForProduct, appendPricingInterval, appendPricingForKey, closePricing, closeAllPricing, transitionEras, deriveFanout, planTopologyChange, HO, PERSONAL_ROLES, PRICING_DEFAULT_KEY };
