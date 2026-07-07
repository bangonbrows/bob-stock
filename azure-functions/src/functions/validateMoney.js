// BOB Stock — Azure Function: server-side delivery MONEY validator (A7 / D4-K).
// GPT Chunk-4 code audit BLOCK #4: recordsteps-push validated the step envelope but NOT the money inside a
// delivery Payload, so negative/garbage costs landed. Pure-WDL JSON-walking is brittle (both auditors), so
// per Kunal's decision this small serverless validator owns delivery money/currency shape validation. The
// recordsteps-push Logic App POSTs the batch's steps here BEFORE insert; any StepId returned in `bad` is
// rejected server-side with reasonCode BAD_MONEY.
//
// Mirrors the client UI.money policy: finite, >= 0 (rate > 0), <= MONEY_MAX (10,000,000), at most 2 decimals.

const { app } = require('@azure/functions');

const MONEY_MAX = 10000000;

// returns true when v is BAD money. optional=true allows null/empty; positive=true requires > 0.
function badMoney(v, opts) {
  opts = opts || {};
  if (v == null || v === '') return !opts.optional;
  const n = Number(v);
  if (!Number.isFinite(n)) return true;
  if (opts.positive ? n <= 0 : n < 0) return true;
  if (n > MONEY_MAX) return true;
  if (Math.round(n * 100) !== Math.round(n * 1000) / 10) return true;   // more than 2 decimal places
  return false;
}

function validateDelivery(payload) {
  if (!payload || typeof payload !== 'object') return 'BAD_MONEY:payload';
  const hc = payload.headerCosts || {};
  for (const f of ['freight', 'tax', 'shipping', 'customs']) {
    if (hc[f] != null && badMoney(hc[f], { optional: true })) return 'BAD_MONEY:headerCosts.' + f;
  }
  const cur = payload.currency || {};
  if (cur.rate != null && badMoney(cur.rate, { positive: true })) return 'BAD_MONEY:currency.rate';
  const fhc = cur.foreignHeaderCosts || {};
  for (const f of ['freight', 'tax', 'shipping']) {
    if (fhc[f] != null && badMoney(fhc[f], { optional: true })) return 'BAD_MONEY:foreignHeaderCosts.' + f;
  }
  if (cur.foreignTotal != null && badMoney(cur.foreignTotal, { optional: true })) return 'BAD_MONEY:currency.foreignTotal';
  for (const ln of (payload.lines || [])) {
    if (!ln || typeof ln !== 'object') return 'BAD_MONEY:line';
    for (const f of ['unitCost', 'landedCostPerUnit', 'packaging', 'labelling', 'headerCostShare', 'appliedCost', 'previousCost',
                     'foreignUnitCost', 'foreignPackaging', 'foreignLabelling']) {
      if (ln[f] != null && badMoney(ln[f], { optional: true })) return 'BAD_MONEY:line.' + f;
    }
  }
  return '';
}

app.http('validateMoney', {
  methods: ['POST'],
  // Chunk 5: function-key gated (was anonymous on staging pre-Chunk-5). R2 spec audit: money + verify
  // routes BOTH keyed from day 1; the recordsteps-push Logic App carries the key in its Call_money URL.
  authLevel: 'function',
  handler: async (request) => {
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const steps = Array.isArray(body.steps) ? body.steps : [];
    const bad = [];
    for (const s of steps) {
      if (s && s.RecordType === 'delivery' && (s.StepType === 'record' || s.StepType === 'packaging_edit')) {
        let pl = {};
        try { pl = typeof s.Payload === 'string' ? JSON.parse(s.Payload) : (s.Payload || {}); }
        catch (e) { bad.push({ StepId: s.StepId, reason: 'BAD_MONEY:unparseable' }); continue; }
        const reason = validateDelivery(pl);
        if (reason) bad.push({ StepId: s.StepId, reason });
      }
    }
    return { jsonBody: { bad } };
  }
});

module.exports = { validateDelivery, badMoney };  // exported for unit/sentinel tests
