const { planTopologyChange } = require('../azure-functions/src/functions/topology.js');

const state = { store: null, eras: [], pricing: {}, creds: [], franchisees: [], office: { forId: 'O', store: null, eras: [], pricing: {} } };

const check = (s, o, f, u) => {
  const i = { op: 'onboard', storeId: s, officeStoreId: o, rate: 15, newFranchisee: { franchiseeId: f, officeUsername: u, displayName: 'X' } };
  state.office.forId = o;
  return planTopologyChange(i, state, 1700000000000).reason;
};

console.log('S=O:', check('A', 'A', 'B', 'C'));
console.log('S=F:', check('A', 'B', 'A', 'C'));
console.log('S=U:', check('A', 'B', 'C', 'A'));
console.log('O=F:', check('A', 'B', 'B', 'C'));
console.log('O=U:', check('A', 'B', 'C', 'B'));
console.log('F=U:', check('A', 'B', 'C', 'C'));
