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

const T_YEAR_2000 = new Date('2000-01-01T00:00:00.000Z').getTime();
const T_NOW = new Date('2026-07-10T00:00:00.000Z').getTime();

test('planTopologyChange - buyback snapshot', () => {
  const res = planTopologyChange({ op: 'buyback', storeId: 'store1' }, { eras: [{owner:'fran1', from:'2000-01-01T00:00:00.000Z', to:null}] }, T_NOW);
  assert(res.ok, 'must be ok, got: ' + res.reason);
  assert(res.plan.snapshot.store === 'store1', 'buyback must take snapshot for HO opening balance');
});

test('planTopologyChange - buyback closes ALL pricing', () => {
  const st = { 
    eras: [{owner:'fran1', from:'2000-01-01T00:00:00.000Z', to:null}],
    pricing: { '*': [{rate: 10, from: '2000-01-01T00:00:00.000Z', to: null}], 'prod1': [{rate: 12, from: '2000-01-01T00:00:00.000Z', to: null}] }
  };
  const res = planTopologyChange({ op: 'buyback', storeId: 'store1' }, st, T_NOW);
  assert(res.ok, 'must be ok');
  assert(res.plan.pricing['*'][0].to !== null, 'default pricing closed');
  assert(res.plan.pricing['prod1'][0].to !== null, 'override pricing closed');
});

console.log(`\nResults: ${passed} PASS, ${failed} FAIL`);
