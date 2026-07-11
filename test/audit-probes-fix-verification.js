const {
  resolveEra, eraWindowsFor, resolvePricingRate, resolvePricingForProduct,
  appendPricingInterval, appendPricingForKey, closePricing, closeAllPricing,
  transitionEras, deriveFanout, planTopologyChange, HO, PERSONAL_ROLES, PRICING_DEFAULT_KEY
} = require('./azure-functions/src/functions/topology.js');

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

console.log('== Post-Fix Adversarial Probes ==');
const T_YEAR_2000 = new Date('2000-01-01T00:00:00.000Z').getTime();
const T_NOW = new Date('2026-07-11T00:00:00.000Z').getTime();

// OS-A-F1: PERSONAL_ROLES now includes 'staff'
test('OS-A-F1: staff role is cancelled on convert/buyback', () => {
  assert(PERSONAL_ROLES.includes('staff'), "staff must be in PERSONAL_ROLES");
  const fanout = deriveFanout([{id: 's1', Role: 'staff', StoreIds: ['store1']}], 'store1', { cancelPersonal: true });
  assert(fanout.length === 1 && fanout[0].action === 'setStoreIds' && fanout[0].StoreIds.length === 0, "staff without isStorePOS loses store");
});

// OS-A-F2: BUYBACK sets cancelPersonal to true
test('OS-A-F2: Buyback severs prior personal staff', () => {
  const st = { eras: [{ owner: 'fran1', from: '2000-01-01T00:00:00.000Z', to: null }], creds: [{id: 's1', Role: 'store_manager', StoreIds: ['store1']}] };
  const res = planTopologyChange({ op: 'buyback', storeId: 'store1' }, st, T_NOW);
  assert(res.ok, res.reason);
  const f = res.plan.fanout.find(c => c.id === 's1');
  assert(f && f.action === 'setStoreIds' && f.StoreIds.length === 0, 'manager loses store');
});

// OS-A-F3: Malformed rates
test('OS-A-F3: Malformed/missing rates rejected', () => {
  let res = planTopologyChange({ op: 'add', storeId: 'store1', toFranchiseeId: 'fran1', rate: 'nope' }, { franchisees: [{franchiseeId: 'fran1'}] }, T_NOW);
  assert(!res.ok && res.reason === 'BAD_RATE', 'string rate rejected');
  res = planTopologyChange({ op: 'add', storeId: 'store1', toFranchiseeId: 'fran1' }, { franchisees: [{franchiseeId: 'fran1'}] }, T_NOW);
  assert(!res.ok && res.reason === 'BAD_RATE', 'missing rate rejected');
});

// OS-A-F4: Pricing append backdate
test('OS-A-F4: Backdated append overlapping closed interval', () => {
  const history = [{ rate: 10, from: '2000-01-01T00:00:00.000Z', to: '2020-01-01T00:00:00.000Z' }];
  const res = appendPricingInterval(history, 15, new Date('2010-01-01T00:00:00.000Z').getTime());
  assert(res.error === 'PRICING_BACKDATE', 'backdated append rejected');
});

// OS-A-F5: Malformed multi-open eras
test('OS-A-F5: Malformed eras (multi-open) fail closed', () => {
  const eras = [{owner: 'HO', from: '2000-01-01T00:00:00.000Z', to: null}, {owner: 'fran1', from: '2010-01-01T00:00:00.000Z', to: null}];
  const owner = resolveEra(eras, T_NOW);
  assert(owner === null, 'must resolve to null (fail closed)');
  const res = planTopologyChange({ op: 'convert', storeId: 'store1', toFranchiseeId: 'fran1', rate: 10 }, { eras, franchisees: [{franchiseeId: 'fran1'}] }, T_NOW);
  assert(!res.ok && res.reason === 'MALFORMED_STATE', 'must reject topology change');
});

// OS-A-F6: safeId checks for undefined
test('OS-A-F6: safeId(undefined) rejected', () => {
  const res = planTopologyChange({ op: 'buyback' }, { eras: [{owner: 'fran1', from: '2000-01-01T00:00:00.000Z', to: null}] }, T_NOW);
  assert(!res.ok && res.reason === 'BAD_STORE_ID', 'undefined storeId rejected');
});

// OS-A-F8: Direct fran->fran
test('OS-A-F8: Direct fran->fran add/onboard rejected', () => {
  const st = { eras: [{owner: 'fran1', from: '2000-01-01T00:00:00.000Z', to: null}], franchisees: [{franchiseeId: 'fran2'}] };
  const res = planTopologyChange({ op: 'add', storeId: 'store1', toFranchiseeId: 'fran2', rate: 10 }, st, T_NOW);
  assert(!res.ok && res.reason === 'DIRECT_TRANSFER_FORBIDDEN', 'add fran->fran forbidden');
  
  const res2 = planTopologyChange({ op: 'onboard', storeId: 'store1', rate: 10, newFranchisee: { franchiseeId: 'fran3', officeUsername: 'test' } }, st, T_NOW);
  assert(!res2.ok && res2.reason === 'DIRECT_TRANSFER_FORBIDDEN', 'onboard fran->fran forbidden');
});

console.log(`\nResults: ${passed} PASS, ${failed} FAIL`);
