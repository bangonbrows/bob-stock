# Account Access chunk — P-13 ENFORCEMENT MATRIX (SR-3 required build artifact)

**Status:** AUTHORED 2026-07-09 (Wave AA-W1: discovery + matrix). Ground-truthed against the live tree
(branch `azure-phase-5-8-server`) by two full code sweeps — server surface (5 Azure Functions in-repo +
staging LA behaviours per wave-review docs + `sync.js` call sites) and client capability gates (every
`Auth.can` / direct-role-check call site). This matrix GOVERNS Waves AA-W2..W5. Companion spec:
`AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md` (D-AA-1..5 + SR-1..11 + R2).

## 0. Discovery findings that shape the build (Wave AA-W1)

- **D1 — cap drift is real (confirms R10-L30-1, bigger than logged):** only 9/15 caps route through
  `Auth.can`; `transferCreate/Receive/Cancel`, `resolveDiscrepancy`, `stockTakeApprove` are enforced by
  DUPLICATE hard-coded role sets (`phase2.js:43-47`, `index.html:2431/2463`) that have already diverged once
  (D-044 cancel tightening). **W3 routes ALL of them through `Auth.can`** — precondition for an editable
  matrix.
- **D2 — the 5 view toggles barely exist:** cost visibility = direct `Auth.is('director')`
  (`index.html:3256`); archive = ad-hoc 3-role check (`index.html:3086/3093`); charts/comparison = per-role
  sidebar-link emission only, comparison has NO top-of-page guard (contrast reports `index.html:4816`);
  **selling price has NO gate at all.** These become real caps in W3/W4.
- **D3 — proof machinery is ready:** server sudo purposes already include
  `approve, resolve, delivery, adjustment` (`validateUser.js:30`) with NO client call sites — the ingest
  validation below mostly wires EXISTING machinery.
- **D4 — Chunk-9 D9-8 residual confirmed:** privileged ledger rows (approve/resolve/delivery/adjustment)
  reach push-v2 / recordsteps-push with DEVICE auth only (`sync.js:1148,1751`) — the specced person-proof
  ingest validation was never wired. **This chunk closes it** (it's the same mechanism the sudo policy and
  PIN-to-receive need anyway).
- **D5 — the 24h PIN is client-only today:** hash compare against config `d.stockTakePin`
  (`index.html:5419-5432`); grants stock-take ONLY, not receive. Server-enforced PIN (below) replaces the
  local compare with a server-minted grant proof.
- **D6 — `sync-v2.js` is a FOSSIL** (last commit Apr 2026; not loaded by index.html; all chunk work is in
  `sync.js`). Delete at wave review (duplicate-engine hazard).
- **D7 — Chunk-10 scope lifecycle (`sync.js:1682-1716`: sig compare → atomic purge → fail-closed pending
  lock → cursor reset → re-bootstrap → stamp) is the TEMPLATE for the accessPolicyVersion lifecycle (SR-4).**

## 1. Policy object model (server-owned, SR-2)

One AppConfig item `access_policy` (SharePoint AppConfig list, served ONLY via gated delivery), JSON blob:

```
{
  version: <int, SERVER-bumped on every accepted write — the accessPolicyVersion>,
  roles:     { <roleName>: { <capability>: true|false, ... }, ... },   // type defaults (seeded from Auth._caps + view toggles)
  overrides: { <accountUserId>: { <capability>: true|false, ... } },   // D-AA-2: per-ACCOUNT, FINAL (SR-7)
  sudo:      { <action>: 'password'|'session', ... },                  // D-AA-5; FLOOR keys server-locked
  pin:       { hash, salt, expiresAt }                                 // Director-set 24h PIN (moves here from d.stockTakePin)
}
```

Plus one AppConfig item `store_eras` (R2-1 baseline + SR-6; grows into the org chunk's era model):
```
{ <storeId>: [ { owner:'HO'|'<franchiseeAccountId>', from:<ISO>, to:<ISO|null> } ] }
```
Seeded at cutover for EVERY franchise store (born-franchise ⇒ from = store-creation/epoch — they own their
whole history). Archive/cost-bearing reads for a franchise-scoped account FAIL CLOSED with no era record.

**Resolution order (SR-7):** explicit per-account override (allow OR deny — FINAL) → 24h-PIN grant (only for
`stockTakeCount`/`transferReceive`, only lifts a type-default deny) → role/type default. Same algorithm client
(`Auth.can`) and server (`evaluateAccess`) — one function, two hosts.

**Floor (SR-1, server-enforced invariants in the policy-write path — a write violating them is REJECTED):**
`access-policy` edits, `sudo`-map edits, Director add/remove/role-change are ALWAYS `'password'`; the floor
keys cannot be set to `'session'` and the write itself always requires a fresh sudo proof
(purpose=`access-policy`).

## 2. Server components (built in W2; LAs on staging, Functions in-repo)

| Component | Kind | What it does | Fail mode |
|---|---|---|---|
| `evaluateAccess` route (new, in `validateUser.js`) | Function | `POST {proof, capability, policyBlob, userRow, pinProof?}` → `{ok}` — verifies proof (existing path), then runs the SR-7 resolver against the SERVER-read policy blob. Pure; LA supplies the rows. | FAIL CLOSED: missing/unparseable policy blob, bad proof, unknown capability ⇒ `{ok:false}` |
| `policyMerge` route (new Function) | Function | Validates a proposed `access_policy` write: schema, FLOOR invariants (rejects floor violations), role-name sanity; bumps `version` SERVER-side. | FAIL CLOSED: invalid ⇒ rejected, nothing written |
| `access-policy-write` LA (new, staging) | Logic App | Director DEVICE key + sudo proof purpose=`access-policy` (verifyProof) → `policyMerge` → If-Match write of `access_policy`. | FAIL CLOSED (401/403/write_failed ⇒ no change) |
| Gated policy DELIVERY | config/pull LA change | `access_policy` + `store_eras` are served to authenticated devices (policy minus `pin.hash` for non-Director accounts); `version` echoed on every pull page (like the Chunk-10 scope echo) so clients detect bumps. | Missing policy ⇒ client keeps last adopted + server still enforces server-side |
| `pin-grant` minting (validateUser extension) | Function + user-verify LA | Store-account device + PIN → verify against `access_policy.pin` → mint proof purpose=`pin-grant`, dc=storeId, exp=PIN's expiresAt (≤24h). Replaces the client-local hash compare. | FAIL CLOSED: wrong/expired PIN or missing policy ⇒ no proof |
| Ingest validation (push-v2 + recordsteps-push LA change) | Logic App | D4/D9-8 closure: privileged row/step types require a valid person proof, checked via `evaluateAccess` (which consults the sudo map: `'password'` ⇒ purpose-bound sudo proof required; `'session'` ⇒ session proof accepted). Staff-role stock-take/receive steps require a `pin-grant` proof per §3. | FAIL CLOSED: reject/quarantine the rows (never silently drop the batch) |

## 3. THE MATRIX — every capability → server truth

Class key: **SERVER** = server-enforced fail-closed (P-13 real gate). **SCOPE** = already materially bounded by
Chunk-10 row scoping; the toggle adds intra-scope control, enforced at ingest where it writes.
**CLIENT** = client-only convenience (P-13: tamperable, accepted, labelled).

| # | Capability | Default roles (seed) | Client gate (today → W3/W4) | Server surface & proof | Policy lookup | Failure mode | Class |
|---|---|---|---|---|---|---|---|
| 1 | `recordDelivery` | director | `Auth.can` ✓ (5130/5323/4823) | recordsteps-push + push-v2 ingest: delivery steps/rows require person proof, sudo map key `delivery` | `evaluateAccess(recordDelivery)` at ingest | reject rows (quarantine) | SERVER |
| 2 | `editCost` | director | `Auth.can` ✓ (4916/4959) | catalogue-write `costChanges` (Director key + `publish` sudo today) | `evaluateAccess(editCost)` before merge | 403, nothing written | SERVER |
| 3 | `editPricing` | director | `Auth.can` ✓ (3267/3311) | catalogue-write (franchiseDiscount is a product field) | `evaluateAccess(editPricing)` | 403 | SERVER |
| 4 | `stockTakeCount` | mgr+ (+staff w/ PIN) | `Auth.can` ✓ (2344) + PIN special-case | recordsteps-push: stock-take steps from a staff-role account require `pin-grant` proof | role/override via `evaluateAccess`; staff ⇒ pin-grant | reject steps | SERVER |
| 5 | `stockTakeApprove` | director | hard-coded (2431/2463) → `Auth.can` | ingest validation: approve step + adjustment rows require sudo-map key `approve` | `evaluateAccess(stockTakeApprove)` | reject rows | SERVER |
| 6 | `transferCreate` | franchisee+ | hard-coded (phase2:43) → `Auth.can` | recordsteps-push already scope-checks FromStoreId∈scope (C10); adds capability check at ingest | `evaluateAccess(transferCreate)` | reject step | SCOPE+SERVER |
| 7 | `transferReceive` | everyone (staff needs PIN — **BEHAVIOUR CHANGE**) | hard-coded (phase2:44/264/268) → `Auth.can` | recordsteps-push receive step + push-v2 transfer_in rows: ToStoreId∈scope (C10) **+ staff-role ⇒ `pin-grant` proof** | `evaluateAccess(transferReceive)`; staff ⇒ pin-grant | reject step/rows | SERVER |
| 8 | `transferCancel` | director | hard-coded (phase2:47/530/1692) → `Auth.can` | ingest validation: cancel step requires person proof, sudo map key `cancel` (NEW purpose, add to `validateUser.js:30`) | `evaluateAccess(transferCancel)` | reject step | SERVER |
| 9 | `resolveDiscrepancy` | director | hard-coded (phase2:45/358/422/456) → `Auth.can` | ingest validation: resolve step + adjustment rows, sudo map key `resolve` | `evaluateAccess(resolveDiscrepancy)` | reject rows | SERVER |
| 10 | `manageUsers` | director | `Auth.can` ✓ (3422..4053) | user-admin LA (Director key + `user-admin` sudo — EXISTS). FLOOR: add/remove/role-change sudo cannot be relaxed | `evaluateAccess(manageUsers)`; floor server-locked | 401/403 | SERVER |
| 11 | `editRefData` | HO, director | `Auth.can` ✓ (3304..3417) | LOCAL edits are client; PROPAGATION is catalogue-write (Director key + publish). Capability checked at merge for the submitting account | `evaluateAccess(editRefData)` per change row | change rejected in `rejected[]` | SERVER (at publish) |
| 12 | `editSuppliers` | director | `Auth.can` ✓ (4124) | catalogue-write (supplier fields on products) | `evaluateAccess(editSuppliers)` | rejected | SERVER (at publish) |
| 13 | `viewReports` | director | `Auth.can` ✓ (4816) | none directly — BUT cost-bearing report inputs come from corp-costs (SERVER, #16) and archive (#18); a device without those grants cannot compute the sensitive figures | client resolver only | UI hides; data absent anyway | CLIENT (data via #16/#18) |
| 14 | `viewTransferHistory` | mgr+ | `Auth.can` ✓ (phase2:48/984/1634) | none — history rows are already scope-limited (C10 either-end curated view) | client resolver only | UI hides | CLIENT (SCOPE-bounded) |
| 15 | `deleteMovement` | mgr+ | `Auth.can` ✓ (2093/2098/2118) | push-v2 ingest: `deleted` tombstone rows from a staff-role account rejected (row-type gate); scope already enforced | `evaluateAccess(deleteMovement)` at ingest | reject rows | SERVER |
| 16 | `seeCost` (NEW) | director (+corporate HO per Chunk-6 rules) | direct `Auth.is('director')` (3256) → `Auth.can` | corp-costs LA: policy check REPLACES pure isFranchise-flag gating; SR-10 default STRIP — no grant / missing policy ⇒ 403; archive cost-bearing rows behind era cutoff (SR-6) | `evaluateAccess(seeCost)` | 403 (fail-private) | SERVER |
| 17 | `seeSellingPrice` (NEW) | all (today: ungated) | NO gate → `Auth.can` on the sell-price columns/exports | none — sell price ships in public `master_data` to every device; withholding it server-side = per-account catalogue delivery (OUT OF SCOPE, noted) | client resolver only | UI hides only | CLIENT (labelled) |
| 18 | `seeArchive` (NEW; D10-5) | director, HO, TM (today) + grantable | 3-role ad-hoc (3086/3093) → `Auth.can` | archive-pull LA: policy check + Chunk-10 StoreIds clause (pre-wired) + **`store_eras` cutoff floor — never serve rows older than the requesting account's era start** (SR-6/R2-1); fail closed w/o era record | `evaluateAccess(seeArchive)` + era lookup | 403 / rows filtered to era | SERVER |
| 19 | `seeCharts` (NEW) | all except staff (today: nav emission) | nav emission → `Auth.can` + page guard | none — charts render local in-scope data | client resolver only | UI hides | CLIENT |
| 20 | `seeComparativeCharts` (NEW) | HO/dir/TM + multi-store franchisee (D10-4) | nav emission, NO page guard → `Auth.can` + top-of-page guard (fixes D2) | none — comparison across stores is materially bounded by C10 scope (a device HAS no out-of-scope data) | client resolver only | UI hides; data absent | CLIENT (SCOPE-bounded) |

**Meta-actions (sudo map, D-AA-5):** `publish` (SERVER, exists), `archive` run (SERVER, exists — Chunk 8 LA),
`user-admin` (SERVER, exists), `backup` export/restore (client action; proof required by client flow — CLIENT,
labelled), `access-policy` (SERVER, new — FLOOR), local stock in/out sudo toggles (CLIENT — cosmetic, SR-11).
Sudo-map semantics at every gated LA: policy `'password'` ⇒ verifyProof expects the purpose-bound sudo proof;
`'session'` ⇒ session proof accepted; policy unreadable ⇒ `'password'` (fail-closed, SR-2/AGY).

## 4. Behaviour changes needing covering sentinels FIRST (P-12)

1. **PIN-to-receive** (staff/store account receive now needs a valid pin-grant; today free) — sentinel on the
   old behaviour BEFORE the change, then flipped with the change.
2. **PIN verification moves server-side** (local hash compare → server-minted grant proof). CONSEQUENCE (flag
   to Kunal at wave review): a store account doing a PIN stock-take/receive needs INTERNET AT THE MOMENT of
   PIN entry (same D9-8 trade-off Kunal accepted for Director actions; the grant then lasts to PIN expiry).
3. **Ingest validation (D4)** — approve/resolve/delivery/adjustment/cancel rows now require proofs at push:
   these actions already prompt or will prompt for sudo per the sudo map; queued offline rows minted BEFORE
   the feature ships must not brick a device (migration: grace-tag pre-policy rows at cutover, then enforce).
4. **The 6 drifted caps re-route through `Auth.can`** — behaviour-preserving refactor, sentinel-covered
   (S-10/23/24/25/26/130 already cover several; W3 adds the missing ones).

## 5. What is explicitly OUT of scope (unchanged posture)

- Per-account catalogue delivery (would be needed to server-withhold SELLING price) — noted, not built.
- Server-performed writes for stock-take approval / resolution (full D9-7) — ingest VALIDATION ships here;
  the server still doesn't originate the rows.
- validateMoney stays fail-open (documented exception, client backstop).
- Org-structure tools (sibling chunk) — `store_eras` here only gets the BASELINE records + enforcement;
  the wizard that sets them going forward is the org chunk.
