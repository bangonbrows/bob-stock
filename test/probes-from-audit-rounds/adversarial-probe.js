const { planTopologyChange } = require('../azure-functions/src/functions/topology.js');

const nowMs = 1700000000000;
const intent = {
  op: 'onboard',
  storeId: 'STORE_X',
  officeStoreId: 'OFFICE_X',
  rate: 15,
  newFranchisee: {
    franchiseeId: 'STORE_X', // SAME AS storeId!
    officeUsername: 'USER_X',
    displayName: 'Store X Franchisee'
  }
};

const state = {
  store: null,
  eras: [],
  pricing: {},
  creds: [],
  franchisees: [],
  office: {
    store: null, // UNOCCUPIED
    eras: [],
    pricing: {}
  }
};

const res = planTopologyChange(intent, state, nowMs);
console.log(JSON.stringify(res, null, 2));
