# Account Access Model — configurable permissions (SCOPE STUB — design WITH Kunal before building)

**Status:** ✅ SPEC CONVERGED 2026-07-09 — BUILD-READY. Decisions D-AA-1..5 locked (Kunal); spec review R1
(Codex BLOCK ×8 + AGY) folded as §SR-1..SR-11; **R2 verdicts: Codex PASS-with-notes + AGY all-R1-closed** —
every R1 finding confirmed closed, R2 notes folded below (§R2) and into `AZURE-CHUNK-ORG-STRUCTURE.md`.
Decisions + SR + R2 govern the build. Next: BUILD this chunk (on Kunal's go), per-wave audits as usual.
Org-structure tools (§C) were SPLIT OUT to their own sibling chunk (D-AA-4). Originally captured 2026-07-07.

## R2 NOTES (folded 2026-07-09 — the parts that land in THIS chunk)
- **R2-1 (Codex) — a baseline cutoff/visibility record is REQUIRED for EVERY franchise store, not only
  conversions.** Born-franchise stores get one at creation (= store creation date); EXISTING franchise stores
  get one SEEDED as part of the end-of-phase cutover migration. SR-6's fail-closed rule stays the backstop
  (no record ⇒ no pre-scope history served). Enforcement + cutover seeding = THIS chunk; the wizard setting
  records going forward = the org chunk.
- **R2-2 (AGY, acknowledged limitation)** — a fully OFFLINE device retains already-pulled sensitive data after
  a revoke until it reconnects and sees the accessPolicyVersion bump (the SR-4 purge fires on reconnect;
  SR-8's proof-binding blocks all server interaction meanwhile). Standard offline-PWA limitation, same family
  as SR-11 — recorded so no audit mistakes it for a gap.
- Codex R2-2/R2-3 + AGY's Tool-4/wizard gaps target the ORG chunk's design session — folded into
  `AZURE-CHUNK-ORG-STRUCTURE.md` (ownership-ERA model, all-affected-credentials, franchisee-to-franchisee
  sale).

## What Kunal wants
A **screen where the Director edits account access levels** — a UI over the permission matrix — with:

1. **Per-account-TYPE capabilities.** Edit what each account type (store account / store manager / territory
   manager / franchisee / HO / director) is allowed to do. E.g. toggle whether the basic *store account* can do
   stock takes at all.
2. **Per-STORE overrides.** Grant/revoke a capability for a SPECIFIC store, independent of the type default.
   Kunal's example: *"if I think stores can handle stock take on their own, I should be able to just tick one
   box for the store account and choose Booragoon, and Booragoon can take stock at all times without the PIN."*
   So: a per-(store, capability) override that exempts a store from the default (e.g. Booragoon store account
   can stock-take / receive without the 24h PIN).

## The confirmed DEFAULT this system encodes (Kunal 2026-07-07)
- The basic **store account** requires the **24-hour PIN** to (a) do a stock take AND (b) **receive HO
  transfers**. *(Point (b) is a behaviour CHANGE from today — currently `staff` can receive transfers freely;
  needs a covering sentinel when built.)*
- The per-store override lets Kunal turn OFF the PIN requirement for a chosen store (e.g. Booragoon) so it can
  stock-take / receive at all times.

## FULL vision (Kunal 2026-07-07, expanded) — the screen must do ALL of this

### A. Granular capability toggles (long, EXTENSIBLE list) — give/take per account (type or specific account)
A long list of individually toggleable permissions, e.g. (not exhaustive — must be easy to ADD more):
- Do stock take
- Receive stock (HO transfers)
- See **cost** price
- See **selling** price
- See **older / archived** data (ties to Chunk 8 archive-pull, currently Director/HO-only)
- See charts
- See **comparative** charts (store-comparison reports)
- Edit products
- Edit other reference data (categories, product types, stores, thresholds, suppliers, pricing…)
- …etc. — essentially every gate in `Auth._caps` PLUS view-level toggles (cost/price/reports/charts) becomes a
  switch. The list must be extensible without a code change where possible.

### B. Create NEW account TYPES (custom roles)
Not limited to the fixed staff / store-manager / territory / franchisee / HO / director set — the Director can
DEFINE a new account type with its own capability set. So roles become DATA-DRIVEN, not hard-coded.

### C. Org-structure management (the account/store topology) — SPLIT OUT (D-AA-4) → `AZURE-CHUNK-ORG-STRUCTURE.md`
- **Convert a store → franchise store** (flip a company store to a franchise; the existing `isFranchise` /
  `isFranchiseOffice` store flags are the seed).
- **Add a new franchisee + create their HO/office account** (onboard a franchisee: their store(s) + their
  franchise HO account).
- **Existing franchisee acquires ANOTHER store** → that store is added to the SAME franchisee's scope under the
  SAME franchise HO (franchisee scope = a growing set of stores, one HO).

### D. SUDO POLICY — "which actions require the Director's password" (Kunal 2026-07-07)
A DISTINCT axis from A-C: A/B/C decide whether an account CAN do an action; this decides, for actions a
Director CAN do, WHICH ones re-prompt for the password (the D9-6 sudo second-factor / walk-away protection).
- A Director-set list of app actions, each with a checkbox "requires my password": e.g. stock in/out = OFF,
  change settings = ON, add store = ON, add staff/user = ON, publish catalogue = ON, run archive = ON,
  backup/restore = ON, edit pricing/cost = ON, ... (extensible, same spirit as the capability list).
- Replaces the current HARD-CODED sudo set (publish/archive/user-admin/backup, D9-6) with this editable policy;
  those become the DEFAULTS the Director can add to / remove from.
- **Security FLOOR (must-always-require-password, NOT unable to be unchecked):** editing this sudo policy
  itself + Director add/remove/role-change. Otherwise someone on an unlocked device weakens the lock on the
  lock. Flag at design.
- **Server interaction:** for cloud-enforced actions (publish/archive/user-admin), "no password" = the client
  uses the logged-in SESSION proof instead of a fresh 5-min SUDO proof — still authenticated, just no re-type.
  So the gated LAs must accept EITHER a session or a sudo proof for an action whose policy is "no password",
  and REQUIRE a sudo proof when the policy is "password". Purely-local actions (stock in/out) have no server
  gate — the toggle is client-only convenience there. The policy itself is published/gated like the access
  policy so every device (and the LAs) agree on it.
- Scope: is it a GLOBAL business policy (one setting all Directors share) or PER-Director-account? Kunal said
  "a setting in Director's account" — CONFIRM at design (global is simpler + safer; per-director allows Shahin
  vs Kunal to differ). Leaning global.

### Interactions (why this is big + must be designed carefully)
- **Subsumes Chunk 6 cost-privacy:** "see cost" / "see selling price" become toggles — generalising the
  hard-coded franchise→no-corporate-cost rule. Server cost-strip must honour the toggle, not just role.
- **Subsumes parts of Chunk 8:** "see older/archived data" becomes a toggle over the archive-pull gate.
- **Leans on Chunk 10:** store-scoping (which rows a device receives) is enforced by the account's StoreIds;
  franchise conversion + multi-store franchisee change those scopes.
- **P-13:** client toggles are UX; every capability that WRITES or reveals sensitive data (cost, archive) must
  be enforced SERVER-SIDE too (the gated LAs / scoping), not just hidden in the UI.

## Decisions — KUNAL DECIDED 2026-07-09 (these govern the build)

- **D-AA-1 — v1 toggle list: the 15 existing `Auth._caps` gates + 5 NEW view toggles** (see cost price, see
  selling price, see older/archived data, see charts, see comparative charts). Kunal: current set is enough for
  v1, BUT the list must stay EXTENSIBLE — adding a capability later must be cheap (data-driven where possible,
  no screen redesign).
- **D-AA-2 — overrides are PER-ACCOUNT only.** An override targets a SPECIFIC ACCOUNT (not a store, not a
  type×store group): pick any account (a store's POS account, a particular manager, a territory manager, a
  franchisee) and force a capability on/off for it, overriding its type default. Store accounts are one-per-store
  (Chunk 9 account model), so the Booragoon example = an override on the Booragoon POS account. NO group rules
  ("all managers at store X") in v1 — expressible by ticking the individual accounts; addable later without
  redesign because the matrix is data-driven. Resolution order: *(as first written:* type default → per-account
  override → 24h-PIN temp grant — **ORDER SUPERSEDED by SR-7**: an explicit per-account override is FINAL and
  beats the PIN grant.*)*
- **(standing, 2026-07-07) the 24h-PIN-to-RECEIVE default** (store account needs the PIN to receive HO
  transfers — a behaviour CHANGE from today) lands as part of this chunk, with a covering sentinel.
- **D-AA-3 — custom account types: PLUMBING now, UI deferred.** Roles become data-driven in this chunk (the
  matrix keys on role NAMES as data, server included), but the "create a new type" screen/button is DEFERRED to
  a later unit. No hard-coded assumption anywhere that the role set is exactly the current six.
- **D-AA-4 — org-structure tools (§C) SPLIT into their own sibling chunk**, designed + built IMMEDIATELY AFTER
  this one and BEFORE the 6-way milestone blind audit (so the audit covers both). TIMELINE DRIVER: Kunal is
  onboarding a NEW FRANCHISEE in ~2–3 months (≈Sep–Oct 2026). Fallback if the build slips: Claude onboards them
  manually (accounts/stores set up directly); the tools then serve the next one. **D10-9 (franchise-takeover
  opening-balance cost cutoff) MOVES to that chunk** — it fires on store→franchise conversion, which is that
  chunk's job. **D10-5 (scoped archive) STAYS HERE** as the "see older/archived data" toggle + scoped archive
  pull.
- **D-AA-5 — sudo policy: GLOBAL, floor fixed, current defaults.** (a) ONE business-wide policy shared by all
  Directors (not per-Director). (b) Security floor confirmed: editing the sudo policy itself + Director
  add/remove/role-change ALWAYS require the password — cannot be unchecked. (c) Defaults: the current hard-coded
  set (publish / archive / user-admin / backup + the §D list) starts ON; day-to-day stock in/out OFF. FUTURE
  (Kunal): possibly extend the re-prompt policy to non-Director account types — capture, don't build.

## ADOPTED SPEC-REVIEW CHANGES (R1 — Codex BLOCK ×8 + AGY, folded 2026-07-09)
Both auditors reviewed the paper spec; every finding triaged REAL. These GOVERN the build alongside the
Decisions. Where an SR conflicts with earlier sketch text, the SR wins.

- **SR-1 (Codex-1 BLOCK + AGY convergent) — security floor EXTENDED to access-policy edits.** Editing the
  capability matrix itself — type defaults, per-account overrides, role definitions, the PIN defaults — is
  ALWAYS-password (sudo), non-disableable, exactly like editing the sudo policy and Director add/remove/
  role-change. Rationale: the matrix IS the lock; an unlocked Director session must not be able to grant itself
  (or any account) capabilities without re-auth. Extends D-AA-5(b).
- **SR-2 (Codex-2 BLOCK + AGY convergent) — policy source of truth = SERVER-owned rows, fail-CLOSED.** The
  Chunk-10 rule applied to policy: the gated LAs read the access policy AND the sudo policy ONLY from
  server-owned `AccessPolicy` state — NEVER from client payloads, client-cached copies, or claims in the
  request. Missing / stale / unparseable policy ⇒ FAIL CLOSED (deny the capability; for sudo evaluation, demand
  a full sudo proof). The client's copy of the policy is display/UX only.
- **SR-3 (Codex-3 + AGY convergent) — a per-capability P-13 ENFORCEMENT MATRIX is a REQUIRED build artifact.**
  Before build, the spec must map EVERY capability (15 gates + 5 view toggles) to: server endpoint(s) touched,
  proof purpose required, policy lookup performed, and failure mode (fail-closed). Capabilities with no server
  surface are explicitly labelled CLIENT-ONLY-CONVENIENCE (per P-13, tamperable — accepted). Concrete hole
  named by both auditors, closed here: **24h-PIN-to-receive is enforced SERVER-side** — the receive write path
  must validate a server-issued PIN/capability grant, not just Chunk 10's ToStoreId scope check.
- **SR-4 (Codex-4) — `accessPolicyVersion` lifecycle, mirroring Chunk 10's scopeVersion.** Every policy edit
  bumps the version. On a NARROWING change (revoke of see-cost / see-selling / see-archive / comparative
  charts / etc.), devices must PURGE the now-unauthorized cached data — cost fields, archive rows/overlays,
  snapshots, report caches — and block the affected surface until a clean re-pull. Revoke must mean GONE, not
  hidden.
- **SR-5 (Codex-5) — doc contradiction fixed: the resolver is per-ACCOUNT, not per-store.** Policy overlay keys
  on accountId (+ role name as the type-default key). `Auth.can(cap)` needs no storeId parameter for override
  identity; StoreIds remain ROW-scope only (Chunk 10) and never identify an override. The superseded "per-store
  override / `Auth.can(cap, storeId)`" sketch below is corrected.
- **SR-6 (Codex-6 + AGY convergent) — D10-9 cutoff ENFORCEMENT ships in THIS chunk; the org chunk only ships
  the tool that SETS cutoffs.** Archive-pull (and any cost-bearing history read) FAILS CLOSED for a franchise
  store with no takeover-cutoff record: serve nothing older than the store's cutoff (or nothing pre-scope if no
  cutoff exists). Granting "see older/archived data" to a franchisee must be INCAPABLE of exposing pre-takeover
  corporate cost history, even before the org chunk exists.
- **SR-7 (AGY, NEW) — explicit per-account override BEATS the 24h PIN.** Corrected resolution order:
  **explicit per-account override (allow OR deny — FINAL) → 24h-PIN temp grant → type default.** The PIN lifts
  a type-default restriction; it must never trump a Director's explicit deny. Supersedes the order first
  written in D-AA-2.
- **SR-8 (Codex-7) — proofs bind account + policy version; LAs evaluate CURRENT server policy.** Chunk-9 proofs
  carry userId/role/purpose/device; under data-driven roles the LAs' authorization model is "evaluate the
  current server-side policy for this action" — hard-coded role allowlists in LAs are demoted to
  defense-in-depth only, never the real gate. Role STRINGS in a request are never trusted as authorization.
- **SR-9 (Codex-8) — the manual-onboarding fallback is a CONTROLLED runbook, not hand edits.** Folded into
  `AZURE-CHUNK-ORG-STRUCTURE.md`: if Claude onboards the new franchisee manually, it is via a scripted admin
  path that updates StoreIds, scopeVersion, access-policy defaults, and the D10-9 cutoff ATOMICALLY. Direct
  ad-hoc SharePoint row edits are forbidden under this model.
- **SR-10 (AGY) — Chunk-6 cost-strip under a dynamic matrix defaults to STRIP.** When "see cost" becomes a
  toggle, the server cost-strip's safe default is STRIP unless the policy explicitly grants see-cost;
  missing/unreadable policy ⇒ strip (fail-closed). Sentinel coverage required for the strip-under-dynamic-policy
  path (a misconfig must fail private, not fail exposed).
- **SR-11 (AGY, acknowledged) — sudo toggles on purely-LOCAL actions are cosmetic.** Already the stated P-13
  posture (§D): no server gate exists for local stock in/out, so a DevTools user can bypass the client prompt.
  Recorded explicitly so no audit ever mistakes the local toggle for enforcement.

## Design shape (sketch — corrected per SR-5/SR-7)
- Persist an editable capability matrix + PER-ACCOUNT overrides in a dedicated `AccessPolicy` config item,
  published like the catalogue (Director-gated write, sudo-floored per SR-1, converges to devices),
  version-stamped per SR-4.
- The existing `Auth._caps` becomes the DEFAULT seed keyed by role name; the screen edits an overlay keyed by
  accountId; `Auth.can(cap)` consults: explicit per-account override (FINAL) → 24h-PIN temp grant → type
  default. StoreIds are row-scope only (Chunk 10), never override identity.
- CLIENT enforcement is UX/convenience (P-13); the SERVER (Chunk 10 scoping + the gated LAs reading
  server-owned policy per SR-2/SR-8) is the real gate — every sensitive capability per the SR-3 matrix.
- Interacts with Chunk 10 (row-level store scoping by the account's StoreIds).

## Sequencing (LOCKED 2026-07-09)
Chunks 5/6/8/9/10 are all built + dual-audited; design decisions above are locked. Order from here:
1. Spec review of THIS chunk with Codex + AGY (paper review — both in parallel per the audit-parallel rule).
2. Build + per-wave audits (this chunk).
3. Design + build `AZURE-CHUNK-ORG-STRUCTURE.md` (D-AA-4; carries D10-9). Deadline pressure: new franchisee
   ≈Sep–Oct 2026.
4. Full 6-way milestone blind audit (covers both chunks).
5. End-of-phase cutover (merge `azure-phase-5-8-server` → main, rotate secrets, mint prod accounts, delete test
   rows).
The 24h-PIN-to-receive default lands as part of THIS unit (not hard-coded earlier).
