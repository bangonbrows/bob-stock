# BOB Stock App External Audit - GPT - Wave A/B/C - 2026-06

## Sign-off

SIGN-OFF STATUS: FULL SIGN-OFF FAILED

Reason: the requested full-floor audit completed with substantially more than the 1,210-probe minimum, and runtime evidence found multiple correctness/data-integrity blocker classes. No app code was edited. This report is the only file written by this audit.

## Scope And Frozen Target

- App under audit: `C:\Users\joshi\repos\bob-stock`
- Audit brief read first: `Stock Audit Framework v1\PASTE-TO-EXTERNAL-AUDITORS-WAVE-ABC.md`
- Framework material folded in: `STOCK-AUDIT-FRAMEWORK.md`, `LENS-CATALOGUE.md`, `CANONICAL-INVARIANTS.md`, `AUDIT-DECISION-LOG.md`, `EXTERNAL-STANDARDS-COVERAGE.md`, `ROUND-10-EVIDENCE-BASELINE.md`
- Decision log authority applied: D-001 through D-047, especially D-043, D-044, D-046, D-047
- Git commit recorded for provenance: `005caeef08d56021a1ea7890860207ad1dad118a`
- Branch observed: `fix/cli-tri-audit-2026-05`
- Worktree note: app files were already modified in the working tree before this report was written. The audit target is therefore frozen by file hash below, not by a clean commit.

### SHA256 Hashes Of 5 App Files

| File | SHA256 |
|---|---|
| `index.html` | `02C224C0004FD43EDBBE1E7976AAE1B5F2782E65CB99C8CB39C44B8CD0A66C8D` |
| `db.js` | `EF3FE6783405ECF8A89C3B64EBD3A035710033F25CE768566643F26F8AF8A84D` |
| `sync.js` | `9278184EC4D6F01CCD5E29ECAC059B68408AD630B48ED4A73AFA97272FF6712C` |
| `phase2.js` | `38D808B79D1D8E135E2A2ED238E83ED572C13F94ED335A2DA9DE7909ADD40A71` |
| `sw.js` | `27D8BAED60279ED74A7B891E55E931715CA9E26B7F2D2A2ED7D76F3774592C84` |

## Baseline First - Harness Verification

| Command | Result |
|---|---|
| `npm.cmd install` in `test` | Success. Used `npm.cmd` because PowerShell policy blocked `npm.ps1`; package set already up to date; 0 vulnerabilities. |
| `node smoke-test.js` | PASS: 31/31 clean-pass. |
| `node saboteur-runner.js` | PASS: baseline 31/31, 31 CAUGHT, 0 BLIND, 0 skipped. Runtime was about 42.4 minutes after increasing timeout. |
| `node verify-release.js` | RELEASE-GATE PASS. One warning remains: external Google Fonts stylesheet without SRI is documented as an exception. |
| `node csp-check.js` | CSP-CHECK PASS: header present, booted under CSP, 0 CSP violations. |
| `node static-check.js` | Missing functions: none. |
| `node verify-app.js` | Non-release scaffold check failed only its stale `index.html` size range: current 919,015 bytes vs expected 120,000-320,000. Required functions, forbidden patterns, load order, hardcoded Logic App URL check, and XSS static sentinel passed. Treat as harness drift, not an app defect. |

Logic App rule: every browser probe routed `*.logic.azure.com` and any `sig=` request to a local mock. No live endpoint was called. This report does not print any real Logic App URL or SAS signature.

## Runtime Probe Ledger

These are real browser/runtime probes, not static-only counts. The core fuzz block executed app functions in Chromium under `Australia/Perth` timezone.

| Probe block | Count | Result |
|---|---:|---|
| Smoke baseline | 31 | 31 pass |
| Saboteur mutation probes | 31 | 31 caught, 0 blind |
| Core invariant/runtime fuzz: roles, transaction classifier, safe qty/int, stock delta, escaping, backup scrub, month boundary | 39,236 | 39,233 pass, 3 fail |
| Original route map, roles x routes | 168 | 168 pass |
| Phase 2 transfer route patch, roles x routes | 18 | 18 pass |
| Controller and workflow probes: stores, backup, deliveries, packaging, thresholds, transfers | 15 | 9 pass, 6 fail |
| Handler-root resolution across rendered routes | 3,543 | 3,543 pass |
| Isolated optimum-level durability/validation check | 2 | 2 fail |

Total recorded runtime/browser probes used for decision: at least 43,045 distinct probes. Static file review and framework/decision-log review were additional and not counted as runtime probes.

## Findings

### GPT-ABC-001 - Reserved store/product IDs can cross trusted boundaries and silently break stock math

- Severity: P1
- Classification: pre-public-beta-blocker
- Class closed: reserved-key/catalogue-boundary integrity, not one instance.
- Surfaces: store settings, backup restore, stock cache, stock reports, transactions.
- Code locations:
  - `index.html:995-1019` - `Stock._isSafeKey()` rejects `__proto__`, `constructor`, `prototype`; `_applyDelta()` skips unsafe keys.
  - `index.html:2861-2862` - `_saveNewStore()` normalizes and accepts arbitrary store IDs, with no reserved-key rejection.
  - `index.html:3103-3113` - `_validateAndScrubBackup()` validates array shape and required fields but does not reject reserved product/store IDs.
- Runtime evidence:
  - UI store creation accepted store ID `constructor`.
  - A transaction for that accepted store with qty 7 was then ignored by stock cache rebuild; `Stock.qty(product, 'constructor')` returned `0`.
  - Backup import validation accepted `store.id='__proto__'` and `product.id='constructor'`.
  - Core backup fuzz also failed `BACKUP:reserved-store` and `BACKUP:reserved-product`: both returned `ok=true`.
- Existing protection:
  - Cache-write guard correctly prevents prototype pollution at stock-cache write time.
  - That guard is not enough because the catalogue/import boundary still allows IDs that make later stock transactions invisible.
- Test exists?
  - Partial. Smoke/runtime tests cover unsafe cache keys directly, but not store creation or backup import accepting reserved IDs.
- Risk:
  - Wrong stock numbers: the ledger can contain stock-affecting rows for an accepted store/product while all stock views read zero because the cache silently skips the key.
  - This violates I-02, I-11, I-70, I-83, L2, L35, and P-12.
- Required fix:
  - Centralize ID validation for all catalogue entities and backup restore.
  - Reject exact reserved keys at every ID entry point before commit/import.
  - Add smoke/saboteur cases for store UI, product UI if relevant, backup import, and stock cache rebuild with reserved IDs.

### GPT-ABC-002 - Delivery/cost paths accept negative line costs and packaging/labelling, creating negative landed/product costs

- Severity: P1
- Classification: pre-public-beta-blocker
- Class closed: delivery/cost numeric validation, not one field.
- Surfaces: deliveries, landed cost, cost history, product cost, stock-in transaction, delivery history edit.
- Code locations:
  - `index.html:4175-4227` - `_saveDelivery()` rejects negative header costs but does not reject negative `unitCost`, `packaging`, `labelling`, or `weightGrams` from line state.
  - `index.html:4308-4311` - packaging/labelling inputs have `min="0"` only as UI hint.
  - `index.html:4319-4348` - `_saveDeliveryPackaging()` parses and writes packaging/labelling with no non-negative validation.
- Runtime evidence:
  - Contrast probe passed: `freight=-1` was rejected; delivery count stayed unchanged.
  - `unitCost=-10` was accepted. Delivery line recorded `unitCost=-10`, `landedCostPerUnit=-10`, and product `costPrice=-10`.
  - Packaging edit accepted `packaging=-99`, `labelling=-1`, recalculating `landedCostPerUnit=-40`.
- Existing protection:
  - Header cost validation exists.
  - Quantity > 0 validation exists.
  - Browser `min="0"` is not a controller or data-integrity protection.
- Test exists?
  - No complete class test. Existing smoke covers some delivery basics but not negative line-cost or packaging edit cases.
- Risk:
  - Negative landed/product costs corrupt cost reports, delivery history, reorder economics, franchise pricing context, and stock valuation.
  - This violates L3, L4, L21, L22, L27, J/report correctness, and P-12.
- Required fix:
  - Validate every numeric delivery line field in the controller before write.
  - Reject negative and non-finite `unitCost`, `packaging`, `labelling`, `weightGrams`.
  - Add smoke and saboteur sentinels proving header, line, and post-delivery edit validations all fail closed.

### GPT-ABC-003 - Optimum-level workflow has broken global durable save and accepts invalid store-scoped thresholds

- Severity: P1
- Classification: pre-public-beta-blocker
- Class closed: threshold/optimum validation and durable persistence.
- Surfaces: transfer optimum levels, reorder thresholds, IndexedDB threshold keying, Head Office/Director settings.
- Code locations:
  - `db.js:25-33` - `thresholds` primary key is `[storeId+productId]`.
  - `phase2.js:1211-1223` - global scope reads thresholds with `storeId === null || '*'`.
  - `phase2.js:1270-1273` - UI onchange uses `parseInt(this.value)||0`.
  - `phase2.js:1517-1539` - `saveOptimumLevels()` writes `storeId:null` for global scope and writes `minQty/optimumQty` without non-negative or `optimum >= min` validation.
- Runtime evidence:
  - Global optimum save for product `BDW_1` reached the fatal durable-save path: `Thresholds could not be saved to this device.`
  - Store-scoped optimum save accepted and cached/persisted `minQty=-2`, `optimumQty=1`.
  - Contrast probe passed for the older settings threshold screen: `_saveThr()` rejected `min=5`, `optimum=4`.
- Existing protection:
  - The older Settings -> Thresholds save path validates with `UI.safeInt`, non-negative minimum, and `optimum >= min`.
  - The Phase 2 optimum workflow bypasses those checks and uses a different persistence shape.
- Test exists?
  - No. Current baseline did not catch global optimum save failure or invalid store-scoped values.
- Risk:
  - Global optimum levels cannot be reliably saved.
  - Invalid store thresholds can make reorder/shortfall recommendations wrong.
  - This violates I-120, durable write invariants I-20/I-21/I-88/I-133, L3, L17, L21, L23, and J.
- Required fix:
  - Reuse the existing `_saveThr()` validation semantics or centralize threshold validation.
  - Decide whether global thresholds are represented by `'*'` or another valid non-null store key and make read/write paths match the IndexedDB schema.
  - Add tests for global save success, store save validation, negative/fractional inputs, `optimum < min`, and durable reload.

### GPT-ABC-004 - 24-month comparison report uses UTC slices for local Perth month boundaries

- Severity: P2
- Classification: pre-public-beta-blocker
- Class closed: timezone/date boundary reporting, not one month.
- Surfaces: reports, store comparison, monthly IN/OUT trends.
- Code location:
  - `index.html:2533-2539` - local month `Date` objects are converted with `toISOString().slice(...)` for `from` and `to`.
- Runtime evidence:
  - Under `Australia/Perth`, local `new Date(2026, 2, 1)` labelled `Mar 26` produced `{ from: "2026-02-01", to: "2026-03-30" }`.
- Existing protection:
  - Other areas use `UI.todayLocal()` and local-date handling; this report path does not.
- Test exists?
  - No. CSP/release/smoke passed but did not assert Perth month boundary report filters.
- Risk:
  - Monthly trend charts can include/exclude the wrong dates and label the wrong month around local month boundaries.
  - This violates I-86, I-87, L14, L21, and J/report correctness.
- Required fix:
  - Use a local date-key formatter for `YYYY-MM-DD` and `YYYY-MM-01`; never derive local business date filters from UTC `toISOString()`.
  - Add timezone-fixed report tests for first/last day of month in `Australia/Perth`.

### GPT-ABC-H001 - Supplemental scaffold `verify-app.js` has stale size expectations

- Severity: P2
- Classification: alpha-accepted
- Class closed: harness drift.
- Surface: test harness.
- Evidence:
  - `node verify-app.js` reported 56 PASS, 1 FAIL, 1 EXPECTED-FAIL, 1 WARN.
  - The only hard fail was `index.html` size range: actual 919,015 bytes, expected 120,000-320,000.
  - Release gate still passed via `verify-release.js`.
- Risk:
  - Teams may ignore or distrust the supplemental harness because it fails on an obsolete file-size guard.
- Required fix:
  - Either remove the static size threshold or replace it with a bundle-budget rule that reflects current architecture and is tied to release risk.

## Accepted / Deferred Security Classes From Decision Log

These remain accepted for alpha per D-047/D-046 but are not acceptable for broader/public beta unless resolved or replaced with explicit server controls:

| Class | Severity | Current disposition |
|---|---|---|
| Client-side auth is not a security boundary | P1 | alpha-accepted; pre-public-beta-blocker |
| Server-side authorization/store-scope enforcement for sync endpoints | P1 | alpha-accepted; pre-public-beta-blocker |
| Logic App endpoint auth/rate-limit/schema/idempotency | P1 | alpha-accepted; pre-public-beta-blocker |
| PIN/password hash design and server-side lockout | P1 | alpha-accepted; pre-public-beta-blocker |
| Server-side append-only audit trail | P1 | alpha-accepted; pre-public-beta-blocker |
| Observability/alerting for sync failures and suspicious operations | P1 | alpha-accepted; pre-public-beta-blocker |
| Secret rotation/runtime config hardening | P1 | alpha-accepted; pre-public-beta-blocker |
| Sync conflict authority and multi-device merge authority | P1 | alpha-accepted; pre-public-beta-blocker |
| Google Fonts self-host/SRI warning | P2 | alpha-accepted hardening item |
| `_approveStockTake` uses `Auth.is('director')` instead of `Auth.can('stockTakeApprove')` | P2 | alpha-accepted drift item because current behavior still matches director-only approval |
| Transfer private gate helpers do not route through `Auth.can` | P2 | alpha-accepted drift item because runtime role behavior passed, but centralized policy drift risk remains |

## Feature x Abuse-Case Matrix

| Feature / flow | Abuse case driven | Code location | Protection observed | Test exists? | Risk after audit |
|---|---|---|---|---|---|
| Login/auth/session | wrong role, stale session, local client trust | `index.html:859-933`, `index.html:867-889` | Role caps map, session restore/logout, backup scrub | Partial smoke; accepted server gap | P1 accepted-alpha server-boundary risk |
| Stock movements | negative/huge/fractional qty, duplicate IDs, deleted rows | `index.html:949-1023`, `db.js` transaction APIs | `Txn` classifier, `_safeQty`, durable add/remove, dedupe smoke | Yes | No new blocker found |
| Stock takes + 24h PIN | staff bypass, invalid counts, double approval | `index.html:1914-2027`, `index.html:4354-4397` | `Auth.can('stockTakeCount')`, `UI.safeInt`, approval idempotency | Partial | No new blocker found; policy drift noted |
| Transfers create/submit/receive/flag/resolve/cancel | role misuse, wrong store receive, short receipt, cancel reversal | `phase2.js:43-253`, `phase2.js:290-310` | Runtime create, receive, flag, resolve, cancel all completed; staff create denied | Yes smoke plus external probes | No new blocker found |
| Deliveries + cost | negative cost fields, landed-cost corruption | `index.html:4175-4227`, `index.html:4319-4348` | Header-cost reject only | Missing class test | P1 blocker GPT-ABC-002 |
| Products/categories/stores | reserved IDs, duplicate names, inactive refs | `index.html:2782-2865` | Duplicate checks; missing reserved-key guard for store IDs | Missing store reserved test | P1 blocker GPT-ABC-001 |
| Thresholds/optimum | negative/fractional, optimum < min, global durable save | `index.html:2905`, `phase2.js:1211-1539`, `db.js:32` | Old settings path validates; Phase 2 path does not | Missing Phase 2 tests | P1 blocker GPT-ABC-003 |
| Suppliers | unauthorized edits, invalid supplier fields | `index.html:3291` and supplier handlers | Director gate observed statically | Partial | No new blocker found |
| Users + PINs | weak password/PIN model, unauthorized management | `index.html:2911-3015` | Director gate; accepted alpha weak-hash/PIN model | Partial | P1 accepted-alpha server/security risk |
| Reports | date boundary, permission, wrong math | `index.html:2363-2736`, `index.html:3896` | Director report gate; CSV escaping paths exist | Partial | P2 blocker GPT-ABC-004 |
| CSV export | formula injection / escaping / filename dates | `index.html:2726-2736`, `index.html:3047-3083`, `index.html:3480` | CSV export functions covered by static/runtime handler resolution | Partial | No new blocker found |
| Settings/backup/restore/diagnostics | secret/session injection, malformed restore, reserved IDs | `index.html:3086-3145` | Secret/session scrub works; app/future-version reject works | Partial | P1 blocker GPT-ABC-001 for reserved IDs |
| Sync push/pull/leader/cursor/offline | live endpoint leak, cursor advance before durable write | `sync.js`, `db.js` | Release gate; endpoints mocked; decision-log accepted server gap | Partial | P1 accepted-alpha server/sync authority risk |
| PWA/service worker/cache | stale cache, unsafe CSP, source integrity | `sw.js`, `staticwebapp.config.json` | Release gate PASS, CSP PASS, service worker aligned | Yes release/CSP | P2 accepted hardening for Google Fonts only |
| UI navigation/buttons/layout | dead routes, unresolved handlers, page errors | `index.html:4695-4750`, `phase2.js:397-416` | 186 role-route renders clean; 3,543 handler roots clean | External runtime probes | No new blocker found |

## Lens Coverage L1-L39

Surface set used below:

- S1 auth/login/session
- S2 stock movement ledger/cache
- S3 stock-take/PIN
- S4 transfers
- S5 deliveries/cost
- S6 products/categories/stores
- S7 thresholds/suppliers/users
- S8 reports/CSV
- S9 settings/backup/restore/diagnostics
- S10 sync/config endpoints
- S11 PWA/service worker/cache
- S12 durable DB/IndexedDB
- S13 roles/store scoping
- S14 UI routes/handlers/layout
- S15 hostile local state/import
- S16 release/test harness

| Lens | Coverage statement | Result |
|---|---|---|
| L1 Auth/session | S1, S13, S15, S16 | Runtime role matrix passed; server-boundary accepted-alpha risk remains. |
| L2 Authorization/store scope | S1, S4, S6, S7, S13 | Runtime transfer gates passed; reserved store ID blocker found. |
| L3 Numeric validation | S2, S3, S5, S7, S8 | Delivery and optimum blockers found. |
| L4 Cost/price correctness | S5, S8 | Negative landed/product cost blocker found. |
| L5 Duplicate/idempotency | S2, S3, S4, S10, S12 | Smoke/saboteur plus transfer flows passed; sync idempotency server risk accepted. |
| L6 Durable writes | S2, S3, S4, S5, S7, S12 | Transfer/delivery durable paths mostly passed; global optimum durable save failed. |
| L7 Atomicity/rollback | S2, S4, S5, S12 | Transfer atomic paths passed in runtime; delivery negative values still accepted before write. |
| L8 Deleted/reversal semantics | S2, S4 | Smoke covered delete/reversal; transfer cancel passed. |
| L9 Role lifecycle | S1, S7, S13 | Client caps passed; server role lifecycle deferred. |
| L10 Store visibility | S1, S4, S8, S13 | Route and transfer receive gates passed. |
| L11 Stock equation | S2, S4, S6, S15 | Cache fuzz passed except allowed reserved IDs create silent stock loss. |
| L12 Dedupe/double count | S2, S4, S10 | Smoke/saboteur passed. |
| L13 Offline/failure recovery | S10, S11, S12 | Release/CSP/harness passed; server conflict authority deferred. |
| L14 Timezone/date | S3, S8, S9 | Perth month-boundary report blocker found. |
| L15 Empty/error states | S8, S14 | Route render pass found no page-error dead ends. |
| L16 UX workflow completion | S3, S4, S5, S7, S14 | Transfer workflows completed; threshold global save fatal found. |
| L17 Threshold/reorder | S7, S8 | Optimum blocker found; old settings threshold path passed contrast. |
| L18 Supplier/product refs | S5, S6, S7 | No new blocker except reserved ID class. |
| L19 Backup/restore | S9, S15 | Secret scrub passed; reserved ID restore blocker found. |
| L20 Diagnostics/logging | S9, S16 | Diagnostic presence verified; observability deferred. |
| L21 Reports correctness | S5, S7, S8 | Date boundary and negative cost blockers found. |
| L22 Franchise/cost boundaries | S5, S8 | Negative cost risk affects downstream valuation/franchise context. |
| L23 Transfer thresholds | S4, S7 | Optimum invalid threshold blocker found. |
| L24 PIN/temporary unlock | S1, S3 | Stock-take gate checked; stronger PIN model deferred. |
| L25 CSV export | S8 | Handler/static coverage passed; no new blocker found. |
| L26 Navigation/dead handlers | S14 | 186 route renders + 3,543 handler roots clean. |
| L27 Data model/schema | S6, S7, S12, S15 | Dexie global threshold/null-key and reserved ID blockers found. |
| L28 PWA/cache | S11, S16 | Release/CSP passed. |
| L29 Dependency/supply chain | S11, S16 | Release gate passed; Google Fonts warning accepted. |
| L30 Server-side enforcement/client trust | S1, S10, S13 | Accepted-alpha/pre-beta blocker per decision log. |
| L31 Credential/secret handling | S1, S9, S10, S16 | Source hardcoded Logic URL check passed; secret rotation still deferred. |
| L32 Backend API | S10 | All runtime endpoints mocked; backend auth/rate limit/schema still deferred. |
| L33 CSP/supply chain | S11, S16 | CSP PASS, release PASS, warning for Google Fonts. |
| L34 Observability | S9, S10 | Deferred P1 accepted-alpha. |
| L35 Hostile local state | S2, S6, S9, S15 | Reserved ID blocker found. |
| L36 Backup boundary | S9, S15 | Secret scrub passed; reserved ID blocker found. |
| L37 PWA/cache/version skew | S11, S16 | Release gate passed; APP_VERSION expected-fail remains in supplemental scaffold. |
| L38 Field privacy | S1, S8, S9 | No PII/payments scope; internal hashes/backup warning accepted-alpha. |
| L39 Sync/idempotency/role lifecycle | S10, S12, S13 | Client sentinels passed; server authority remains deferred. |

No lens was intentionally skipped. Cells involving server enforcement are marked covered as accepted/deferred risk because this client-side PWA does not itself contain the server-side controls.

## Pass A-J Summary, False-Negative Risks, And Honesty Notes

| Pass | Focus | Result | Top false-negative risks / honesty note |
|---|---|---|---|
| A | Baseline, target freeze, release/CSP | Completed | Frozen by hashes because worktree was dirty. Supplemental `verify-app.js` has stale size fail. |
| B | Auth/roles/store scope | Completed | Client role matrix passed; cannot sign off server security because P-13 says client auth is not a boundary. |
| C | Stock ledger/cache/data integrity | Failed | Reserved IDs create a ledger/cache mismatch. Other stock delta fuzz passed after 39k combinations. |
| D | Transfers end-to-end | Completed | Create, receive, short receipt, resolve, cancel, staff denial passed. Remaining risk is server/sync authority, not local flow. |
| E | Delivery/cost/pricing | Failed | Negative cost fields accepted. Header negative reject could have hidden this class if line fields were not separately tested. |
| F | Ref data/settings/thresholds | Failed | Store ID boundary and Phase 2 optimum threshold path fail; old settings threshold path passing is not sufficient. |
| G | Reports/CSV | Failed | Perth month-boundary report defect found. CSV handler coverage passed, but report math still needs domain-specific expected-output tests. |
| H | Backup/restore/hostile local state | Failed | Secret/session scrub passed; reserved IDs accepted by import. Backup validation must validate semantic IDs, not only shape. |
| I | Sync/offline/PWA/supply chain | Completed with accepted risks | CSP/release passed and endpoints were mocked. Live backend auth/rate-limit/idempotency not proven by this client audit. |
| J | Harness/meta-audit/regression sentinels | Failed | Baselines are strong, but missing sentinels for the blocker classes above and stale `verify-app.js` size bound reduce harness trust. |

Top false-negative classes still worth future scrutiny:

1. Real multi-device conflict races with two browser contexts and mocked remote state.
2. Durable write failure injection inside IndexedDB transaction boundaries beyond existing saboteur mutations.
3. Exact report expected-output fixtures for every report tab, not just render/no-error.
4. Backup restore with large but valid datasets near 5 MB and mixed legacy schema versions.
5. Franchise invoice calculations with discounts, missing prices, deleted products, and negative cost contamination.
6. Supplier lead-time effects on reorder suggestions after threshold fixes.
7. Service-worker stale-cache behavior after schema changes using an old SW controlling a new app shell.
8. Auth/session behavior after user role/store changes while a device keeps an older session.
9. CSV formula-injection assertions with every export surface and every field position.
10. Logic App schema/rate-limit/auth tests once non-live test endpoints are available.

## Final Decision

The app is not ready for broader/public beta sign-off. It has strong recent gains in CSP, release gating, transfer workflows, handler resolution, and saboteur coverage, but the blocker classes above can still produce wrong stock, cost, threshold, or report numbers. Fix the four app findings, update the harness sentinel gaps, then rerun the full A-J floor with the same file-hash freeze discipline.
