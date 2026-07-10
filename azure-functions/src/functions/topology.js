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
const PERSONAL_ROLES = ['store_manager', 'territory_manager'];  // personal accounts cancelled on convert (D-OS-2). staff = the shared store POS, which STAYS.
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

function isFiniteMs(v) { return typeof v === 'number' && Number.isFinite(v); }
function toMs(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; }
function iso(ms) { return new Date(ms).toISOString(); }
function safeId(s) { return typeof s === 'string' && ID_RE.test(s) && !RESERVED.has(s); }

// ── Era resolution (OS-SR-6 visibility) ───────────────────────────────────────────────────────────────
// eras = [{owner, from:<ISO>, to:<ISO|null>}] sorted or not. Returns the owner whose [from,to) covers dateMs
// (to:null = open/current). Null if none (fail-closed for the caller).
function resolveEra(eras, dateMs) {
  if (!Array.isArray(eras) || !isFiniteMs(dateMs)) return null;
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
// sees the CURRENT era ONLY (OS-SR-6). A franchisee/HO account sees every era it owned.
function eraWindowsFor(eras, ownerId, deviceBound) {
  if (!Array.isArray(eras)) return [];
  if (deviceBound) {
    const cur = eras.find(e => e && e.to == null);
    return cur ? [{ from: cur.from, to: cur.to }] : [];
  }
  return eras.filter(e => e && e.owner === ownerId).map(e => ({ from: e.from, to: e.to }));
}

// ── Pricing resolution (OS-SR-3/11 — rate as-of a row's date, from the append-only history) ────────────
function resolvePricingRate(intervals, dateMs) {
  if (!Array.isArray(intervals) || !isFiniteMs(dateMs)) return null;
  for (const p of intervals) {
    if (!p || typeof p.rate !== 'number') continue;
    const f = toMs(p.from); if (f === null || dateMs < f) continue;
    const t = p.to == null ? Infinity : toMs(p.to);
    if (t === null) continue;
    if (dateMs < t) return p.rate;
  }
  return null;   // no rate in force ⇒ caller treats as no franchise loading (fail to no-discount, never guess)
}

// Append-only pricing change (OS-SR-12): CLOSE the open interval at nowMs, OPEN a new one from nowMs. NEVER
// mutates a prior interval. A rate === current open rate is a no-op (no spurious interval). Returns the new
// history or {error} on an immutability violation (e.g. a from earlier than the last closed interval).
function appendPricingInterval(history, rate, nowMs) {
  const h = Array.isArray(history) ? history.map(x => ({ ...x })) : [];
  const open = h.find(p => p && p.to == null);
  if (open && Number(open.rate) === Number(rate)) return { history: h };   // unchanged
  if (open) {
    const of = toMs(open.from);
    if (of !== null && nowMs < of) return { error: 'PRICING_BACKDATE' };    // can't close before it opened
    open.to = iso(nowMs);
  }
  if (rate != null) h.push({ rate: Number(rate), from: iso(nowMs), to: null });
  return { history: h };
}

// Close the open pricing interval (buy-back → no franchise rate going forward).
function closePricing(history, nowMs) {
  const h = Array.isArray(history) ? history.map(x => ({ ...x })) : [];
  const open = h.find(p => p && p.to == null);
  if (open) { const of = toMs(open.from); if (of !== null && nowMs < of) return { error: 'PRICING_BACKDATE' }; open.to = iso(nowMs); }
  return { history: h };
}

// ── Era transition: close the open era, open a new one under newOwner ──────────────────────────────────
function transitionEras(eras, newOwner, nowMs) {
  const e = Array.isArray(eras) ? eras.map(x => ({ ...x })) : [];
  const open = e.find(x => x && x.to == null);
  if (open) { const of = toMs(open.from); if (of !== null && nowMs < of) return { error: 'ERA_BACKDATE' }; open.to = iso(nowMs); }
  e.push({ owner: newOwner, from: iso(nowMs), to: null });
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
      out.push({ id: c.id, action: 'setStoreIds', StoreIds: next, active: true });   // left ACTIVE even if empty (D-OS-4)
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

// ── The planner ────────────────────────────────────────────────────────────────────────────────────────
function planTopologyChange(intent, state, nowMs) {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: 'BAD_INTENT' };
  if (!isFiniteMs(nowMs)) return { ok: false, reason: 'BAD_NOW' };
  const op = intent.op;
  const storeId = intent.storeId;
  if (!safeId(String(storeId))) return { ok: false, reason: 'BAD_STORE_ID' };
  const st = state && typeof state === 'object' ? state : {};
  const creds = Array.isArray(st.creds) ? st.creds : [];
  const franchisees = Array.isArray(st.franchisees) ? st.franchisees : [];
  const eras = Array.isArray(st.eras) ? st.eras : [];
  const pricing = Array.isArray(st.pricing) ? st.pricing : [];
  const rec = { op, storeId, ts: iso(nowMs) };

  const currentOwner = resolveEra(eras, nowMs);   // may be null for a brand-new store
  const franchiseeExists = (fid) => franchisees.some(f => f && f.franchiseeId === fid);

  // ---- create HO store ----
  if (op === 'create' && intent.type === 'HO') {
    if (st.store) return { ok: false, reason: 'STORE_EXISTS' };
    const e = transitionEras([], HO, nowMs); if (e.error) return { ok: false, reason: e.error };
    return { ok: true, plan: { eras: e.eras, pricing, fanout: [], createAccounts: [{ kind: 'storePOS', storeId }], snapshot: null, export: null, record: { ...rec, from: null, to: HO } } };
  }

  // ---- create born-franchise store (existing franchisee) OR add store to existing franchisee ----
  if ((op === 'create' && intent.type === 'franchise') || op === 'add') {
    const fid = intent.toFranchiseeId;
    if (!safeId(String(fid)) || !franchiseeExists(fid)) return { ok: false, reason: 'NO_SUCH_FRANCHISEE' };
    const wasHO = currentOwner && currentOwner.owner === HO;   // an existing HO store being handed over
    const e = transitionEras(eras, fid, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingInterval(pricing, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: fid, oldFranchiseeId: e.closedOwner !== HO ? e.closedOwner : null, cancelPersonal: wasHO });
    const createAccounts = st.store ? [] : [{ kind: 'storePOS', storeId }];
    return { ok: true, plan: { eras: e.eras, pricing: pr.history, fanout, createAccounts, snapshot: wasHO ? { store: storeId, cutoffMs: nowMs } : null, export: null, record: { ...rec, from: e.closedOwner, to: fid } } };
  }

  // ---- onboard NEW franchisee (+ first store, new or an existing HO store) ----
  if (op === 'onboard') {
    const nf = intent.newFranchisee;
    if (!nf || !safeId(String(nf.franchiseeId)) || franchiseeExists(nf.franchiseeId)) return { ok: false, reason: 'BAD_NEW_FRANCHISEE' };
    if (!safeId(String(nf.officeUsername))) return { ok: false, reason: 'BAD_OFFICE_USERNAME' };
    const wasHO = currentOwner && currentOwner.owner === HO;
    const e = transitionEras(eras, nf.franchiseeId, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingInterval(pricing, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const createAccounts = [{ kind: 'franchisee', franchiseeId: nf.franchiseeId, displayName: nf.displayName, officeUsername: nf.officeUsername }];
    if (!st.store) createAccounts.push({ kind: 'storePOS', storeId });
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: nf.franchiseeId, oldFranchiseeId: null, cancelPersonal: wasHO });
    return { ok: true, plan: { eras: e.eras, pricing: pr.history, fanout, createAccounts, snapshot: wasHO ? { store: storeId, cutoffMs: nowMs } : null, export: null, record: { ...rec, from: e.closedOwner, to: nf.franchiseeId } } };
  }

  // ---- convert HO store → franchise (existing franchisee) — the D-OS-1 case A when the franchisee exists ----
  if (op === 'convert') {
    if (!currentOwner || currentOwner.owner !== HO) return { ok: false, reason: 'NOT_HO_OWNED' };
    const fid = intent.toFranchiseeId;
    if (!safeId(String(fid)) || !franchiseeExists(fid)) return { ok: false, reason: 'NO_SUCH_FRANCHISEE' };
    const e = transitionEras(eras, fid, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = appendPricingInterval(pricing, intent.rate, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: fid, oldFranchiseeId: null, cancelPersonal: true });
    return { ok: true, plan: { eras: e.eras, pricing: pr.history, fanout, createAccounts: [], snapshot: { store: storeId, cutoffMs: nowMs }, export: null, record: { ...rec, from: HO, to: fid } } };
  }

  // ---- buy-back franchise → HO ----
  if (op === 'buyback') {
    if (!currentOwner || currentOwner.owner === HO) return { ok: false, reason: 'NOT_FRANCHISE_OWNED' };
    const oldFid = currentOwner.owner;
    const e = transitionEras(eras, HO, nowMs); if (e.error) return { ok: false, reason: e.error };
    const pr = closePricing(pricing, nowMs); if (pr.error) return { ok: false, reason: pr.error };
    const fanout = deriveFanout(creds, storeId, { newFranchiseeId: null, oldFranchiseeId: oldFid, cancelPersonal: false });
    // OS-SR-4: export the ex-franchisee's just-closed era [from,to) — server-generated later from this window.
    const closed = e.eras.find(x => x && x.owner === oldFid && x.to === iso(nowMs));
    return { ok: true, plan: { eras: e.eras, pricing: pr.history, fanout, createAccounts: [], snapshot: { store: storeId, cutoffMs: nowMs }, export: { franchiseeId: oldFid, storeId, from: closed ? closed.from : null, to: iso(nowMs) }, record: { ...rec, from: oldFid, to: HO } } };
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
app.http('topologyResolve', { methods: ['POST'], authLevel: 'function', handler: handlerFactory((b) => ({ owner: resolveEra(b.eras, b.dateMs), rate: resolvePricingRate(b.pricing, b.dateMs) })) });

module.exports = { resolveEra, eraWindowsFor, resolvePricingRate, appendPricingInterval, closePricing, transitionEras, deriveFanout, planTopologyChange, HO, PERSONAL_ROLES };
