#!/usr/bin/env node
/*
 * access-policy-proof.js — AA-W2 logic-proof suite for azure-functions/src/functions/accessPolicy.js.
 * Runs the REAL function code (required module, not re-derived logic — blind-sentinel rule) against
 * adversarial fixtures. Every SR it proves is cited. Run: node test/access-policy-proof.js
 */
'use strict';
const path = require('path');
const AP = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'accessPolicy.js'));
const VU = require(path.join(__dirname, '..', 'azure-functions', 'src', 'functions', 'validateUser.js'));

const PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
const SECRET = 'test-proof-secret-0123456789abcdef0123456789';
const NOW = 1770000000000; // fixed clock — no Date.now in fixtures

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
const rowStaff = { UserId: 'u-boor', Username: 'booragoon', Role: 'staff', Active: 1, TokenVersion: 0, Salt: 's1', SecretHash: 'a'.repeat(64) };
const rowDir = { UserId: 'u-kunal', Username: 'kunal', Role: 'director', Active: 1, TokenVersion: 0, Salt: 's2', SecretHash: 'b'.repeat(64) };
const rowDead = { UserId: 'u-dead', Username: 'gone', Role: 'staff', Active: 0, TokenVersion: 0, Salt: 's3', SecretHash: 'c'.repeat(64) };
const ROWS = [rowStaff, rowDir, rowDead];

const POLICY = {
  version: 3,
  roles: {
    staff: { stockTakeCount: false, transferReceive: false, seeSellingPrice: true, recordDelivery: false },
    director: { stockTakeCount: true, transferReceive: true, editCost: true, recordDelivery: true, stockTakeApprove: true, editAccessPolicy: true },
  },
  overrides: {},
  sudo: { publish: 'password', approve: 'password', delivery: 'session' },
  pin: null,
};
const sessStaff = VU.mintProof(SECRET, rowStaff, 'session', 'booragoon', NOW).proof;
const sessDir = VU.mintProof(SECRET, rowDir, 'session', '__director', NOW).proof;
const sudoApprove = VU.mintProof(SECRET, rowDir, 'approve', '__director', NOW).proof;

console.log('== resolveCapability (SR-7 order) ==');
ok('role default allows (director editCost)', AP.resolveCapability(POLICY, 'editCost', 'u-kunal', 'director', false).ok === true);
// AA-01: resolveCapability's 3rd arg is now USERNAME (overrides keyed by username on both sides).
ok('role default denies (staff stockTakeCount)', AP.resolveCapability(POLICY, 'stockTakeCount', 'booragoon', 'staff', false).ok === false);
ok('PIN grant lifts staff transferReceive', AP.resolveCapability(POLICY, 'transferReceive', 'booragoon', 'staff', true).ok === true);
ok('PIN grant lifts staff stockTakeCount', AP.resolveCapability(POLICY, 'stockTakeCount', 'booragoon', 'staff', true).ok === true);
ok('PIN grant does NOT lift non-PIN caps (recordDelivery)', AP.resolveCapability(POLICY, 'recordDelivery', 'booragoon', 'staff', true).ok === false);
const P_OVR = { ...POLICY, pinEpoch: 1, overrides: { booragoon: { transferReceive: false, editCost: true } } };  // pinEpoch:1 so g1 (minted under P_PIN epoch 1) matches for the override-beats-pin test
ok('explicit override DENY beats PIN grant (SR-7, AGY R1)', AP.resolveCapability(P_OVR, 'transferReceive', 'booragoon', 'staff', true).ok === false);
ok('explicit override ALLOW beats role deny', AP.resolveCapability(P_OVR, 'editCost', 'booragoon', 'staff', false).ok === true);
ok('override for ANOTHER account is ignored', AP.resolveCapability(P_OVR, 'editCost', 'someoneelse', 'staff', false).ok === false);
ok('unknown capability denied (fail closed)', AP.resolveCapability(POLICY, 'launchMissiles', 'kunal', 'director', false).ok === false);
ok('unknown role denied (fail closed)', AP.resolveCapability(POLICY, 'editCost', 'x', 'super_admin', false).ok === false);
ok('no policy denied (SR-2 fail closed)', AP.resolveCapability(null, 'editCost', 'kunal', 'director', false).ok === false);
ok('__proto__ capability denied', AP.resolveCapability(POLICY, '__proto__', 'kunal', 'director', false).ok === false);

console.log('== sudoRequirement (D-AA-5 + SR-1 floor) ==');
ok('mapped session => session', AP.sudoRequirement(POLICY, 'delivery') === 'session');
ok('mapped password => password', AP.sudoRequirement(POLICY, 'publish') === 'password');
ok('UNKNOWN action => password (fail closed)', AP.sudoRequirement(POLICY, 'new-thing') === 'password');
ok('no policy => password (fail closed, AGY)', AP.sudoRequirement(null, 'publish') === 'password');
const LIAR = { ...POLICY, sudo: { 'access-policy': 'session', 'user-admin': 'session' } };
ok('floor absolute even if blob lies (access-policy)', AP.sudoRequirement(LIAR, 'access-policy') === 'password');
ok('floor absolute even if blob lies (user-admin)', AP.sudoRequirement(LIAR, 'user-admin') === 'password');

console.log('== policyMerge (SR-1 floor, schema, versioning) ==');
const good = { roles: POLICY.roles, overrides: { 'u-boor': { transferReceive: true } }, sudo: { publish: 'session' } };
const m1 = AP.policyMerge(PEPPER, { current: POLICY, proposed: good }, NOW);
ok('valid proposal accepted', m1.ok === true);
ok('version bumped SERVER-side (3 -> 4)', m1.ok && m1.blob.version === 4);
ok('floor keys forced present + password', m1.ok && m1.blob.sudo['access-policy'] === 'password' && m1.blob.sudo['user-admin'] === 'password');
const mFirst = AP.policyMerge(PEPPER, { current: null, proposed: good }, NOW);
ok('first-ever write => version 1', mFirst.ok && mFirst.blob.version === 1);
ok('FLOOR_VIOLATION rejected, not silently corrected (SR-1)', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, sudo: { 'access-policy': 'session' } } }, NOW).reason === 'FLOOR_VIOLATION');
ok('proposal without director role rejected', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, roles: { staff: { editCost: false } } } }, NOW).reason === 'NO_DIRECTOR_ROLE');
ok('proposal stripping director editAccessPolicy rejected (DIRECTOR_LOCKOUT)', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, roles: { ...POLICY.roles, director: { ...POLICY.roles.director, editAccessPolicy: false } } } }, NOW).reason === 'DIRECTOR_LOCKOUT');
ok('__proto__ override key rejected', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, overrides: JSON.parse('{"__proto__":{"editCost":true}}') } }, NOW).ok === false);
ok('non-boolean capability value rejected', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, roles: { director: { editCost: 'yes' } } } }, NOW).reason === 'BAD_ROLES');
ok('bad role-name charset rejected', AP.policyMerge(PEPPER, { current: POLICY, proposed: { ...good, roles: { director: { editCost: true }, "bad role'name": {} } } }, NOW).reason === 'BAD_ROLES');
const mPin = AP.policyMerge(PEPPER, { current: POLICY, proposed: good, pinPlain: '4321' }, NOW);
ok('pinPlain hashed server-side (64-hex, no plaintext)', mPin.ok && /^[0-9a-f]{64}$/.test(mPin.blob.pin.hash) && !JSON.stringify(mPin.blob).includes('4321'));
ok('bad pin format rejected', AP.policyMerge(PEPPER, { current: POLICY, proposed: good, pinPlain: 'abc' }, NOW).reason === 'BAD_PIN');
ok('pinClear removes pin', AP.policyMerge(PEPPER, { current: mPin.blob, proposed: good, pinClear: true }, NOW).blob.pin === null);
// AA-03: optimistic concurrency (baseVersion) — POLICY is v3.
ok('AA-03: matching baseVersion accepted', AP.policyMerge(PEPPER, { current: POLICY, proposed: good, baseVersion: 3 }, NOW).ok === true);
ok('AA-03: STALE baseVersion rejected (lost-update guard)', AP.policyMerge(PEPPER, { current: POLICY, proposed: good, baseVersion: 2 }, NOW).reason === 'STALE_VERSION');
ok('AA-03: omitted baseVersion still allowed (legacy)', AP.policyMerge(PEPPER, { current: POLICY, proposed: good }, NOW).ok === true);
// AA-18: poisoned current.version resets base to 0 rather than wedging publishes.
ok('AA-18: Infinity current version => next write is v1', AP.policyMerge(PEPPER, { current: { ...POLICY, version: Infinity }, proposed: good }, NOW).blob.version === 1);
ok('AA-18: NaN current version => next write is v1', AP.policyMerge(PEPPER, { current: { ...POLICY, version: 'oops' }, proposed: good }, NOW).blob.version === 1);
// AA-17: validatePin rejects an unparseable expiry (no NaN-exp grant).
ok('AA-17: unparseable PIN expiry rejected', AP.validatePin(PEPPER, SECRET, { pin: '4321', actorUsername: 'booragoon', deviceContext: 'booragoon', policy: { pin: { salt: mPin.blob.pin.salt, hash: mPin.blob.pin.hash, expiresAt: 'not-a-date' } }, rows: ROWS }, NOW).ok === false);

console.log('== validatePin (server-minted grant, matrix D5; AA-09 actorUsername contract) ==');
const P_PIN = mPin.blob; // pin '4321', expires NOW+24h
// AA-09: the acting account arrives as `actorUsername` (the client field). deviceContext is LA-supplied.
const g1 = AP.validatePin(PEPPER, SECRET, { pin: '4321', actorUsername: 'booragoon', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }, NOW);
ok('AA-09: correct PIN via actorUsername mints a grant', g1.ok === true && typeof g1.proof === 'string');
ok('AA-09: back-compat username field still works', AP.validatePin(PEPPER, SECRET, { pin: '4321', username: 'booragoon', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }, NOW).ok === true);
ok('grant expiry <= PIN expiry', g1.ok && g1.expiresAt <= Date.parse(P_PIN.pin.expiresAt));
ok('wrong PIN rejected', AP.validatePin(PEPPER, SECRET, { pin: '9999', actorUsername: 'booragoon', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }, NOW).ok === false);
ok('expired PIN rejected', AP.validatePin(PEPPER, SECRET, { pin: '4321', actorUsername: 'booragoon', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }, NOW + 25 * 3600 * 1000).ok === false);
ok('deactivated account cannot PIN-elevate', AP.validatePin(PEPPER, SECRET, { pin: '4321', actorUsername: 'gone', deviceContext: 'x', policy: P_PIN, rows: ROWS }, NOW).ok === false);
ok('no policy => no grant', AP.validatePin(PEPPER, SECRET, { pin: '4321', actorUsername: 'booragoon', deviceContext: 'booragoon', policy: null, rows: ROWS }, NOW).ok === false);
const gv = VU.verifyProofBody(SECRET, { proof: g1.proof, expectedPurposes: ['pin-grant'], deviceContext: 'booragoon', rows: ROWS }, NOW);
ok('minted grant verifies via verifyProofBody', gv.ok === true && gv.username === 'booragoon');
ok('grant bound to device context (wrong dc fails)', VU.verifyProofBody(SECRET, { proof: g1.proof, expectedPurposes: ['pin-grant'], deviceContext: 'karrinyup', rows: ROWS }, NOW).ok === false);
ok("pin-grant NOT mintable via password path", VU.evaluateUser(PEPPER, SECRET, { username: 'booragoon', password: 'whatever', purpose: 'pin-grant', deviceContext: 'booragoon', rows: ROWS }, NOW).userOk === false);

console.log('== evaluateAccess (end-to-end decision point, SR-2/SR-3/SR-8) ==');
const E = (body, t) => AP.evaluateAccess(PEPPER, SECRET, body, t || NOW);
ok('director session proof + editCost => ok', E({ proof: sessDir, capability: 'editCost', deviceContext: '__director', policy: POLICY, rows: ROWS }).ok === true);
ok('staff receive w/o PIN => NEED_PIN', E({ proof: sessStaff, capability: 'transferReceive', deviceContext: 'booragoon', policy: POLICY, rows: ROWS }).reason === 'NEED_PIN');
ok('staff receive WITH grant => ok via pin', E({ proof: sessStaff, pinProof: g1.proof, capability: 'transferReceive', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }).via === 'pin');  // P_PIN has pinEpoch 1, matching g1
// AA-20: a grant is stamped with the PIN epoch it was minted under; a policy whose pinEpoch advanced (PIN
// cleared/changed) rejects the stale grant immediately.
ok('AA-20: grant rejected when policy pinEpoch advanced (Clear PIN kill-switch)', E({ proof: sessStaff, pinProof: g1.proof, capability: 'transferReceive', deviceContext: 'booragoon', policy: { ...P_PIN, pinEpoch: 2 }, rows: ROWS }).reason === 'NEED_PIN');
ok('AA-20: same grant still valid at its own epoch', E({ proof: sessStaff, pinProof: g1.proof, capability: 'transferReceive', deviceContext: 'booragoon', policy: P_PIN, rows: ROWS }).ok === true);
ok('AA-20: policyMerge bumps pinEpoch on pinClear', AP.policyMerge(PEPPER, { current: P_PIN, proposed: good, pinClear: true }, NOW).blob.pinEpoch === 2);
ok('AA-20: policyMerge bumps pinEpoch on a new PIN', AP.policyMerge(PEPPER, { current: P_PIN, proposed: good, pinPlain: '5678' }, NOW).blob.pinEpoch === 2);
ok('AA-20: unrelated edit carries pinEpoch forward (live PINs survive)', AP.policyMerge(PEPPER, { current: P_PIN, proposed: good }, NOW).blob.pinEpoch === 1);
ok('AA-20: grant payload carries pe', (() => { try { const pl = JSON.parse(Buffer.from(g1.proof.split('.')[0].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString()); return pl.pe === 1; } catch(e){ return false; } })());
ok('override DENY beats presented grant (SR-7)', E({ proof: sessStaff, pinProof: g1.proof, capability: 'transferReceive', deviceContext: 'booragoon', policy: P_OVR, rows: ROWS }).ok === false);
ok('action publish + session proof, map=password => NEED_SUDO', E({ proof: sessDir, action: 'publish', deviceContext: '__director', policy: POLICY, rows: ROWS }).reason === 'NEED_SUDO');
ok('action delivery + session proof, map=session => ok', E({ proof: sessDir, action: 'delivery', deviceContext: '__director', policy: POLICY, rows: ROWS }).ok === true);
ok('action approve + sudo proof + capability both checked', E({ proof: sudoApprove, action: 'approve', capability: 'stockTakeApprove', deviceContext: '__director', policy: POLICY, rows: ROWS }).ok === true);
ok('floored action ignores lying map (session proof rejected)', E({ proof: sessDir, action: 'access-policy', deviceContext: '__director', policy: LIAR, rows: ROWS }).reason === 'NEED_SUDO');
ok('capability with NO policy => NO_POLICY (fail closed)', E({ proof: sessDir, capability: 'editCost', deviceContext: '__director', policy: null, rows: ROWS }).reason === 'NO_POLICY');
ok('action with NO policy => sudo required (fail closed)', E({ proof: sessDir, action: 'delivery', deviceContext: '__director', policy: null, rows: ROWS }).reason === 'NEED_SUDO');
ok('expired proof rejected', E({ proof: sessDir, capability: 'editCost', deviceContext: '__director', policy: POLICY, rows: ROWS }, NOW + 13 * 3600 * 1000).ok === false);
ok('someone ELSE\'s pin grant is not yours', E({ proof: sessDir, pinProof: g1.proof, capability: 'transferReceive', deviceContext: '__director', policy: { ...POLICY, roles: { ...POLICY.roles, director: { ...POLICY.roles.director, transferReceive: false } } }, rows: ROWS }).ok === false);
// AA-W4 hole-close: ANY account can mint an 'access-policy' proof with its own password — the CAPABILITY
// is what stops a non-director using one at the policy-write gate.
const apStaff = VU.mintProof(SECRET, rowStaff, 'access-policy', 'booragoon', NOW).proof;
const apDir = VU.mintProof(SECRET, rowDir, 'access-policy', '__director', NOW).proof;
ok('staff access-policy proof + editAccessPolicy capability => DENIED', E({ proof: apStaff, action: 'access-policy', capability: 'editAccessPolicy', deviceContext: 'booragoon', policy: POLICY, rows: ROWS }).ok === false);
ok('director access-policy proof + editAccessPolicy capability => ok', E({ proof: apDir, action: 'access-policy', capability: 'editAccessPolicy', deviceContext: '__director', policy: POLICY, rows: ROWS }).ok === true);

console.log(`\n== access-policy-proof: ${pass} PASS · ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
