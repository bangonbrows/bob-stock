const {
  resolveEra, eraWindowsFor, resolvePricingRate, resolvePricingForProduct,
  appendPricingInterval, appendPricingForKey, closePricing, closeAllPricing,
  transitionEras, deriveFanout, planTopologyChange, HO, PERSONAL_ROLES, PRICING_DEFAULT_KEY
} = require('../azure-functions/src/functions/topology.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch(e) {
    console.log(`  [FAIL] ${name} - ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) { if(!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(actual, expected) { if(JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`); }

console.log('== Adversarial Probes ==');

// 1. Era Boundaries & Dates
test('era resolution - strict [from, to) bounds', () => {
  const eras = [
    { owner: 'A', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
    { owner: 'B', from: '2026-02-01T00:00:00.000Z', to: null }
  ];
  const atBoundary = resolveEra(eras, new Date('2026-02-01T00:00:00.000Z').getTime());
  assert(atBoundary.owner === 'B', 'boundary exactly at "to" should resolve to the next era');
});

test('pricing - strict [from, to) bounds', () => {
  const intervals = [
    { rate: 10, from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' },
    { rate: 20, from: '2026-02-01T00:00:00.000Z', to: null }
  ];
  const rate = resolvePricingRate(intervals, new Date('2026-02-01T00:00:00.000Z').getTime());
  assert(rate === 20, 'rate at boundary should be 20');
});

// 2. Pricing Edge Cases
test('pricing - invalid rates', () => {
  const intervals = [
    { rate: 'twenty', from: '2026-01-01T00:00:00.000Z', to: null }
  ];
  const rate = resolvePricingRate(intervals, new Date('2026-01-15T00:00:00.000Z').getTime());
  assert(rate === null, 'non-numeric rate should be skipped');
});

test('pricing append - string rate parses correctly?', () => {
  const res = appendPricingInterval([], "15", 1000000000);
  assert(typeof res.history[0].rate === 'number' && res.history[0].rate === 15, 'string rate should become number');
});

// 3. Credential Fanout
test('fanout - malformed credential row', () => {
  const creds = [
    { id: 'pos1', isStorePOS: true, StoreIds: ['store1'] },
    null,
    { id: '__proto__' },
    { id: 'off1', isFranchiseOffice: true, franchiseeId: 'fran1', StoreIds: 'not-an-array' }
  ];
  const out = deriveFanout(creds, 'store1', { newFranchiseeId: 'fran1' });
  // Should handle malformed without throwing
  assert(Array.isArray(out), 'should return array');
});

// 4. Object Injection & Guards
test('planTopologyChange - proto pollution intent', () => {
  const intent = JSON.parse('{"op": "__proto__", "storeId": "store1"}');
  const res = planTopologyChange(intent, {}, 1000);
  assert(!res.ok && res.reason === 'UNKNOWN_OP', 'unknown op rejected');
});

test('planTopologyChange - intent missing storeId', () => {
  const res = planTopologyChange({ op: 'convert' }, {}, 1000);
  assert(!res.ok, 'rejected');
});

test('planTopologyChange - malicious __proto__ storeId', () => {
  const res = planTopologyChange({ op: 'convert', storeId: '__proto__' }, {}, 1000);
  assert(!res.ok && res.reason === 'BAD_STORE_ID', 'bad store id rejected');
});

test('planTopologyChange - malicious franchiseeId', () => {
  const res = planTopologyChange({ op: 'convert', storeId: 'valid', toFranchiseeId: '__proto__' }, { eras: [{owner:'HO', from:'2000', to:null}] }, 1000);
  assert(!res.ok, 'bad franchisee id rejected');
});

// 5. Spec & Atomicity alignment
test('planTopologyChange - buyback snapshot', () => {
  const res = planTopologyChange({ op: 'buyback', storeId: 'store1' }, { eras: [{owner:'fran1', from:'2000', to:null}] }, 1000);
  assert(res.plan.snapshot.store === 'store1', 'buyback must take snapshot for HO opening balance');
});

test('planTopologyChange - buyback closes ALL pricing', () => {
  const st = { 
    eras: [{owner:'fran1', from:'2000', to:null}],
    pricing: { '*': [{rate: 10, from: '2000', to: null}], 'prod1': [{rate: 12, from: '2000', to: null}] }
  };
  const res = planTopologyChange({ op: 'buyback', storeId: 'store1' }, st, 1000);
  assert(res.plan.pricing['*'][0].to !== null, 'default pricing closed');
  assert(res.plan.pricing['prod1'][0].to !== null, 'override pricing closed');
});

console.log(`\nResults: ${passed} PASS, ${failed} FAIL`);
