# BOB Stock App — Full Project Brief

**For:** Claude Code CLI onboarding
**Date:** 22 May 2026
**Prepared by:** Kunal Joshi & Claude (Cowork)

---

## 1. Business Context

Bang on Brows (BOB) is a beauty salon chain in Perth, Western Australia, co-owned by Kunal Joshi and Shahin. The business operates multiple store locations including Karrinyup, Whitford, Ardross, and a Head Office warehouse that supplies all stores.

The Stock App was built to replace a manual spreadsheet-based process for tracking product inventory across all stores. Staff use it daily to log stock movements, managers run stock takes and transfers, and directors review analytics and make purchasing decisions.

**Devices in stores:** Windows PCs, iPhones, Android phones. NOT iPads — this has been corrected multiple times.

---

## 2. Project History

### Phase 1 — Core App (Early 2026)

Built the single-page PWA from scratch with vanilla JavaScript. Core features: stock movement logging (IN/OUT), stock takes, role-based access (Staff, Store Manager, Franchisee, Director, Head Office), analytics dashboard, reports (sell-through, wastage, dead stock, store comparison), CSV export, cost management, optimum stock levels, user management with SHA-256 hashed passwords.

Initially deployed to GitHub Pages at `bangonbrows.github.io/bob-stock`.

### Phase 1.5 — Email Notifications (April 2026)

Migrated stock take email notifications from Power Automate (trial expiring) to Azure Logic App (`bob-stock-email`). Sends from `management@bangonbrows.com.au` to `logistics@bangonbrows.com.au`.

### Phase 2 — Bulk Transfers (April 2026)

Added the full transfer lifecycle in a separate `phase2.js` module: create draft, confirm items, submit (deducts from sender), receive (adds to receiver), flag discrepancies, director resolution (accept as-is, adjust, reject). Email notifications at each stage. Transit Void model — stock is deducted on submit, not receipt.

### Phase 3 — M365 Migration (April 2026)

Migrated the entire backend to the Microsoft 365 ecosystem over 4 working days:

- **Day 1-2:** Azure Static Web App (hosting), SharePoint Online Lists (data), Azure Logic Apps v2 (push-v2, pull-v2, config)
- **Day 3-4:** Rewrote the data layer from localStorage to IndexedDB (Dexie.js), rewrote sync.js for SharePoint list sync, updated service worker

The app moved from GitHub Pages to Azure SWA with auto-deploy from GitHub. All data now lives in SharePoint Online Lists.

### Triple Audit (April 2026)

After Phase 3, all three AI systems (Claude, Gemini, GPT) independently reviewed the entire codebase. This produced a prioritised list of 36 findings across 4 tiers.

### Tier 1 Fixes — 5 Critical Go-Live Blockers

Write-path contract mismatch, plaintext passwords in session state, atomic commit safety, sync mutex, SAS token handling. Deployed.

### Tier 2 Fixes — 9 High-Priority Items (3 Milestones: M1-M3)

Zero threshold bug, CSV export classifier, double DB.commit, sentQty mutation, cache integrity, atomic transfer writes with snapshot/restore. All deployed by 21 April 2026.

### Tier 3 Fixes — 6 Medium-Priority Items (3 Milestones: M1-M3)

move_out classifier, push retry lock gap, dead code removal, threshold Map cache, badge helper centralisation, transfer timestamps. All deployed.

### T3-M3 Revision (T3-M3r1) — Final Audit Round

GPT rejected T3-M3 with 5 findings, Gemini approved with 2 minor findings. After verification: 3 real bugs fixed, 4 false positives dismissed.

- **R1:** localStorage/sessionStorage mismatch in `_saveSyncConfig()` — fixed to use `Sync.saveConfig()`
- **R2:** `resolveFlag()` notification sent before atomic write — moved `_notifyCompleted()` after `atomicTransferWrite()`
- **R3:** XSS in `createdByName` template literal — wrapped in `UI.esc()`

All 3 auditors signed off. Final commit: `005caee`. GitHub Actions build #17. Deployed and smoke tested — all 14 checks passed.

---

## 3. Current Architecture

### Four Layers

```
STORE DEVICES          →  AZURE LOGIC APPS    →  SHAREPOINT ONLINE
(Windows PC,           ←  push-v2 | pull-v2   ←  StockTransactions |
 iPhone, Android)         | config                Products | Stores |
                                                  AppConfig
```

1. **Devices** — PWA runs in browser. Installable to home screen. No app store.
2. **IndexedDB (Dexie.js)** — Local database on each device. Offline-first. All reads/writes are local-first for speed.
3. **Azure Logic Apps (x3)** — Serverless middleware. Devices never talk to SharePoint directly.
   - `push-v2`: POST array of transactions → writes to StockTransactions list (server-side dedup)
   - `pull-v2`: POST `{since}` → returns transactions modified after that timestamp
   - `config`: POST `{}` → returns AppConfig (product catalogue, store directory, sync URLs)
4. **SharePoint Online** — Cloud source of truth. Four lists: StockTransactions, Products, Stores, AppConfig.

### Data Model

**Append-only transaction ledger.** Stock levels are never stored — they're computed from the sum of all movements:

```
Stock.qty(productId, storeId) = SUM(IN types) - SUM(OUT types)
```

Transaction classifier (`Txn.classify()`) determines direction and category for every transaction type. Threshold lookups use an O(1) Map cache (`Stock._thrMap`).

### Sync Flow

Staff logs movement → writes to IndexedDB instantly → debounced push sends to Logic App → Logic App writes to SharePoint (with dedup) → other devices pull on next sync cycle → merge into local IndexedDB.

### Nine Sync Safety Mechanisms

1. Server-side dedup (push-v2)
2. Client-side ID merge (pull)
3. Unified sync mutex (`_syncLock`)
4. Push retry with `_isRetry` flag (lock stays held)
5. Debounced push
6. `beforeunload` guard
7. Offline queue
8. Atomic transfer writes (`DB.atomicTransferWrite`)
9. Snapshot/restore on write failure

---

## 4. Codebase

### GitHub Repository

- **Repo:** `bangonbrows/bob-stock` (private)
- **Branch:** `main`
- **Latest commit:** `005caee` — T3-M3r1 (tri-audit approved)
- **CI/CD:** GitHub Actions → Azure Static Web Apps (auto-deploy on push to main)

### Files

| File | Size | Responsibility |
|------|------|----------------|
| `index.html` | ~165 KB (~4,754 lines) | Main app: UI, routing, auth, analytics, reports, settings, stock movements |
| `phase2.js` | ~67 KB (~1,500 lines) | Bulk transfers module: create, submit, receive, flag, resolve, notifications |
| `db.js` | ~18 KB (~500 lines) | Dexie data layer: schema, migrations, CRUD, atomic commit |
| `sync.js` | ~35 KB (~960 lines) | Sync engine: push/pull, field mapping, config, retry, mutex |
| `sw.js` | ~3 KB | Service worker: cache strategy, offline fallback |

### Key JavaScript Objects (in index.html)

- `DB` — Dexie database wrapper (also in db.js)
- `Stock` — Quantity calculation engine, threshold Map cache
- `Auth` — Login, roles, session management (sessionStorage)
- `UI` — Rendering, toast notifications, `UI.esc()` XSS sanitiser
- `Sync` — Cloud sync (also in sync.js)
- `Pages` — Page routing and rendering
- `Nav` — Navigation and sidebar
- `Txn` — Transaction classifier, badge/icon helpers

### Key JavaScript Objects (in phase2.js)

- `Transfer` — Transfer lifecycle: create, submit, receive, flag, resolve
- Uses `DB.atomicTransferWrite()` for atomic state changes
- Email notifications via hardcoded Logic App URLs (to be moved to runtime config)

---

## 5. Infrastructure

### Hosting

- **Azure Static Web App** (Free tier): `https://gray-island-05e673800.7.azurestaticapps.net/`
- CDN-backed, HTTPS enforced, auto-deploy from GitHub
- Custom domain planned: `stock.bangonbrows.com.au` (waiting for DNS migration from Crazy Domains to M365)

### Azure Resources (Resource Group: `bob-stock-sync`)

- Static Web App: `bob-stock`
- Logic Apps: `bob-stock-push-v2`, `bob-stock-pull-v2`, `bob-stock-config`, `bob-stock-email`
- API Connections: `sharepointonline` and `office365` → `management@bangonbrows.com.au`
- Subscription: `BOB-Stock-App` (ID: `1543b78c-8061-44f8-a119-61dee9a3172d`)

### SharePoint

- Site: `https://bangonbrows.sharepoint.com`
- Lists: StockTransactions, Products, Stores, AppConfig

### Cost

Effectively zero — Azure SWA Free tier ($0), Logic Apps Consumption (~$0 within free tier), SharePoint included in M365 Business, GitHub private repo (free).

---

## 6. Security Model

- **Password hashing:** SHA-256 on create and update. Never stored in plaintext.
- **Session tokens:** `crypto.randomUUID()` in sessionStorage. Clears on tab close.
- **PIN lock:** Auto screen lock after 10 minutes of inactivity.
- **XSS protection:** `UI.esc()` wraps all user-generated content in templates.
- **Data integrity:** Transaction and transfer IDs use `crypto.getRandomValues` suffix.
- **Notification safety:** Email notifications only fire after successful database writes.
- **SAS tokens:** Stored in sessionStorage only (not localStorage). Clear on logout/tab close.

### Known Limitations (Documented and Accepted)

- Client-side auth only — no server-side authentication (accepted trade-off for PWA without backend)
- SAS URLs in sessionStorage could theoretically be extracted by a determined attacker with DevTools access
- Email notification URLs currently hardcoded in JavaScript (planned: move to runtime config)
- No PII or financial data — app manages internal product inventory only

> **⚠ CLIENT-SIDE AUTHORIZATION IS NOT SECURITY ENFORCEMENT (permanent rule — framework P-13).**
> Client-side authorization protects against accidental misuse and catches regressions. **It is not tamper-proof security enforcement.** A determined user with browser DevTools can tamper with local state, role flags, store IDs, IndexedDB, the backup JSON, sync payloads, and can call the Logic App endpoints directly. The `Auth.can` permission matrix, store-scoping, the 29 sentinels and the saboteur harness are convenience + data-integrity + regression controls only.
> Acceptable for the trusted internal alpha (known staff, store devices, no PII/payments). **Before broader rollout / public beta / any hostile-user scenario, the following MUST move server-side:** authentication, authorization, store enforcement, audit logging, and sensitive sync operations. No audit report may describe browser-side role checks as "secure enforcement." See `Stock Audit Framework v1/EXTERNAL-STANDARDS-COVERAGE.md` (P0/P1 backlog).

---

## 7. Quality Assurance Process

### Three-Auditor Review

Every significant code change goes through independent review by three AI systems before deployment:

1. **Claude (Anthropic)** — Primary engineer. Writes code, builds review packs with diffs.
2. **Gemini (Google)** — Technical reviewer. Reviews every step before deploy. Catches edge cases, security patterns.
3. **GPT (OpenAI)** — Independent auditor. Reviews after Gemini. Strong on sync correctness, adversarial thinking.

**Rule: EVERY significant step (code, migration, deploy) must go to Gemini for review BEFORE executing. No exceptions.**

**Rule: After every major milestone, both Gemini AND GPT must audit before deploy. Three-auditor standard.**

### Deployment Process

1. Claude writes the fix and generates a review pack with diffs
2. Gemini reviews and approves or requests changes
3. GPT independently reviews and approves or flags issues
4. Code is pushed to GitHub → Azure SWA auto-deploys
5. Programmatic smoke test run against live deployment
6. All test data restored after testing (no residue)

### Audit History

- Full codebase audit produced 36 findings across 4 tiers
- Tiers 1-3 (20 items) fully remediated and deployed across 9 milestones
- Tier 4 (7 low-priority items) deferred to monolith split
- Final tri-audit sign-off: 21 April 2026 (all 3 auditors approved)

---

## 8. Working Practices

### How Kunal Works

- Show changes before applying them — don't silently modify
- Flag issues and concerns proactively
- Use todo lists to track progress
- Confirm before committing/deploying
- Kunal defers technical decisions to Claude and Gemini — wants safe, reliable, scalable results
- Challenge weak ideas — don't blindly agree
- Ask questions first before starting work

### Technical Practices

- **GitHub pushes:** Use `atob/btoa` for file encoding. Never mix with `utf8ToB64` (causes double-encoding).
- **Large file edits:** For files >4,000 lines (index.html), never use the Edit tool directly — use bash heredoc + head/tail split-merge to avoid truncation.
- **Devices:** Windows PCs, iPhones, Android. NOT iPads.

---

## 9. Current State (22 May 2026)

- **Codebase:** Fully audited, tri-approved, deployed
- **Commit:** `005caee` on `main` branch
- **Live URL:** `https://gray-island-05e673800.7.azurestaticapps.net/`
- **Status:** Ready for alpha testing → beta testing

### What's Been Completed

| Phase | Status |
|-------|--------|
| Phase 1 (Core App) | Complete |
| Phase 2 (Bulk Transfers) | Complete |
| Phase 3 Day 1-2 (Azure SWA, SharePoint, Logic Apps) | Complete |
| Phase 3 Day 3-4 (Dexie.js, sync.js, service worker) | Complete |
| Triple Audit (36 findings) | Complete |
| Tier 1 Fixes (5 critical) | Deployed |
| Tier 2 Fixes (9 high-priority, M1-M3) | Deployed |
| Tier 3 Fixes (6 medium-priority, M1-M3) | Deployed |
| T3-M3r1 Revision (3 final fixes) | Deployed, tri-audit approved |
| Akbar Technical Overview PDF V2 | Delivered |

---

## 10. What's Next

### Immediate — Alpha Testing (Kunal)

Kunal will walk through every feature and flow before giving the app to staff. Role-by-role testing: Staff, Store Manager, Director. Focus on real salon workflows, UX issues, and anything that would confuse staff.

### Short Term — Beta Testing (Staff)

Staff across all BOB stores start using the app in a live beta on the current Azure SWA URL. This will validate features, identify UX issues, and confirm the app works in real salon conditions.

### Medium Term — Monolith Split (T3-07)

The 4,754-line `index.html` will be broken into ~10 native ES6 modules (`auth.js`, `ui.js`, `pages.js`, `stock.js`, `nav.js`, etc.). This is a structural refactor with no functionality changes. Estimated 2-3 sessions. Must run on a **separate branch** while beta testing continues on stable `main`.

### Remaining Items

- **Tier 4 Items:** 7 low-priority improvements (test coverage, additional hardening) — address during or after monolith split
- **User Object Slimming:** Reduce `Auth.user()` footprint in transfer records to minimal audit snapshots (username, name, role)
- **Email Notification URLs → Runtime Config:** Move hardcoded Logic App URLs to AppConfig SharePoint list
- **Custom Domain:** `stock.bangonbrows.com.au` — waiting for DNS migration from Crazy Domains to M365
- **Background Sync Handler:** Service worker registers sync but no handler exists yet

---

## 11. Other BOB Projects

### BOB Roster App

Separate project to replace Excel-based staff rostering. Prior plan was React PWA + SharePoint + MSAL + 31-rule engine. Approach being reconsidered as of May 2026. Source-of-truth documents (Requirements V1.3, Design V2.0, data model, wireframe) are in the `BOB Roster App/` folder.

---

## 12. Key References

| Resource | Location |
|----------|----------|
| GitHub repo | `bangonbrows/bob-stock` (private) |
| Live app | `https://gray-island-05e673800.7.azurestaticapps.net/` |
| Azure portal | Resource group `bob-stock-sync` |
| SharePoint | `https://bangonbrows.sharepoint.com` |
| Technical Overview PDF | `BOB Stock App - Technical Overview V2.pdf` (in workspace folder) |
| T3-M3 Review Pack | OneDrive `BOB Stock App\99 History\2026-04 Build + Tier Fixes\T3-M3-Review-Pack\` (diffs, source files, revision notes) |
| T3-M1 Review Pack | OneDrive `BOB Stock App\99 History\2026-04 Build + Tier Fixes\T3-M1-Review-Pack\` (includes sync.js) |

---

*This document should be placed as `CLAUDE.md` in the root of the `bob-stock` repository when moving to Claude Code CLI.*
