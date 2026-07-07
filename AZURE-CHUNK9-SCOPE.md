# Azure Chunk 9 — Per-user server-side auth (the password/PIN redesign)

**Status:** SCOPE DRAFT (2026-07-07) — for Kunal's decisions, then the Codex+AGY spec review, then build.
**Phase-scope mandate (agreed 2026-07-04, PRE-BETA BLOCKER):** app-managed users exactly as today (NO M365
accounts / licences — Kunal's hard constraint); passwords salted + verified server-side via the existing
Function + Logic App + SharePoint plumbing (no new cost); server-side lockout. Upgrades Chunk 5's key-CLASS
enforcement (store/HO/Director device keys) to real per-PERSON enforcement of sensitive actions.

---

## 1. The problem (what's broken today)

Discovery (2026-07-07, live code):

1. **All person-auth is client-side (P-13).** Login = `sha256(password)` compared against a LOCAL user row in
   the browser (`index.html` Auth.login). Roles are enforced by `Auth._caps` in the browser only. Anyone with
   DevTools can set `Auth._user = {role:'director'}` and the UI grants everything. Chunk 5 closed the CLOUD
   half (a tampered device still can't call Director-gated endpoints without the Director device key), but any
   person who knows a store device's key class can act as any role ON that device.
2. **Users are trapped per device.** The `users` table lives only in each device's IndexedDB (seed / created
   locally / backup import). There is NO cloud users list: add a staff member on the Karrinyup PC and the
   Karrinyup phone doesn't know them; change a password and it changes on ONE device. Same class of defect as
   the pre-Chunk-6 catalogue islands.
3. **No lockout, no salt, no pepper on person credentials.** Unlimited guesses at both password and PIN;
   `sha256(password)` unsalted means identical passwords hash identically and a leaked backup exposes them to
   rainbow tables. (Backups keep password/PIN hashes by design — D-039 alpha-accepted — that acceptance ends
   with this chunk.)
4. **Person vs device conflated.** Chunk 5 authenticates the DEVICE (store key) or the key-CLASS (Director key
   on 4 personal devices). It cannot distinguish Kunal from a staff member holding Kunal's unlocked phone, and
   the Director key being IN a device's localStorage means the device, not the person, is what's really vouched.

## 2. What we already have to build on (Chunk 5, reuse everything)

- `validateKeys` Function: HMAC-SHA256(pepper, id + "\0" + salt + "\0" + secret), constant-time compare,
  authLevel function, FAIL CLOSED at every caller, batched verify, grace windows for rotation.
- `StoreCredentials` SharePoint list + the gated-Logic-App pattern (secureData, 401 fail-closed, central
  client pause on 401).
- The catalogue-publish / archive Logic Apps as the template for Director-gated admin flows.

## 3. The model (proposal)

**Two layers, cleanly separated:**

- **Layer 1 — device authorization (Chunk 5, unchanged):** every sync call keeps carrying the store/Director
  device key. This is "this hardware is allowed to talk to our cloud for store X". Chunk 10 will hang row-level
  read scoping off this layer.
- **Layer 2 — person authentication (NEW, this chunk):** a cloud `UserCredentials` list + per-person
  server-side verification for SENSITIVE actions, riding the same Function/LA plumbing.

### 3.1 Cloud user directory (fixes "users trapped per device")
- New SharePoint list `UserCredentials` (staging: `_Staging`): `UserId, Username, DisplayName, Role,
  StoreIds (json), Salt, SecretHash, Version, GraceUntil, Active, FailedCount, LockedUntil`.
- The public **directory** (username, display name, role, storeIds, active — NEVER Salt/SecretHash) is
  published into the existing `master_data` payload (Chunk 6 machinery), so every device converges on the same
  staff list automatically. The local `users` table becomes a mirror of the directory + local-only PIN.
- User management (create / deactivate / role change / password reset) becomes a **Director-gated Logic App**
  (`user-admin`), same auth pattern as catalogue-write. Password set/reset: the new secret travels HTTPS to the
  gated LA → Function computes salt+HMAC server-side → LA writes the row. The RESPONSE never contains hash
  material (keeps Chunk 5's "no hash-emitting route" rule — hashes go IN, never OUT).

### 3.2 Server-verified person actions (fixes "browser-only roles")
- A new Function route `validateUser` (same file/pattern as validateKeys): POST
  `{username, password, rows}` → `{userOk, role}` booleans/enums only. Constant-time, peppered,
  FAIL CLOSED, and **enforces lockout server-side**: on failure the LA increments `FailedCount` and sets
  `LockedUntil` past the threshold; on success it resets. A locked row verifies false even with the right
  password until `LockedUntil` passes.
- **Which calls carry person credentials:** the SENSITIVE, already-online-only admin actions —
  catalogue publish, corp-costs read, archive run, archive-pull, user-admin, stock-take approve + discrepancy
  resolution IF/where those get server endpoints (today they're client-side ledger writes — see D9-1). Each
  gated LA verifies BOTH the device key (Chunk 5) AND the person (Chunk 9): device may talk + person may act.
- **Client credential handling:** the app never stores the password. On login it keeps the password in MEMORY
  ONLY for the session (never localStorage/sessionStorage/Dexie/backup — extend the Chunk 5 scrubbers to the
  new fields), attaching it to sensitive requests. Lock-screen/logout wipes it. Everyday offline flows (log
  movement, receive transfer, stock-take count) keep working exactly as today on local login — they ride the
  ledger push which is device-key authorized; the ledger itself stays append-only + auditable.

### 3.3 Offline + local login (what does NOT change)
- The app is offline-first; staff MUST be able to log in and work with no signal. Local login (against the
  mirrored directory + a locally-cached verifier) stays as the UI gate. Sensitive server actions are already
  online-only, so "person verification requires the cloud" costs nothing new. FAIL CLOSED: no cloud = no
  sensitive action (same as Chunk 5 behaviour today).
- **PIN:** UNTOUCHED this chunk (D9-5, Kunal). Both existing PIN flows stay exactly as-is — the 10-min
  inactivity unlock and the 24h stock-take code (the one actually used operationally). PIN never travels to the
  cloud and, after this chunk, gates nothing sensitive (admin actions require the server-verified password via
  the D9-6 sudo re-prompt).

### 3.4 What the local password check becomes
- The local mirror stores a DERIVED local verifier (salted hash, per-device salt) purely for offline UI login —
  not the cloud SecretHash (which never leaves SharePoint). A stolen backup/device therefore exposes only a
  salted local verifier, not the server credential. Server actions always re-verify server-side regardless.

## 4. What gets built where

| Piece | What |
|---|---|
| SharePoint | `UserCredentials_Staging` list (+ index on Username) |
| Function | `validateUser` route (verify + role) — pure logic, no SP access, same file pattern as validateKeys |
| Logic Apps | `user-admin-staging` (Director-gated CRUD + password set/reset + unlock); lockout counter updates in the verify path of each gated LA (or a small `user-verify` LA the others call — build detail) |
| Existing gated LAs | catalogue-write, corp-costs, archive, archive-pull gain the person check alongside the device check |
| Client (sync.js) | attach person credentials to sensitive calls; memory-only handling; scrubbers extended; 401/403 handling (locked vs wrong vs unauthorized) |
| Client (index.html) | login reworked to mirror-directory + local verifier; user-management screens re-pointed at the gated endpoint; sudo-mode re-prompt (D9-6); PIN untouched (D9-5) |
| Migration | mint fresh user rows at cutover (fresh salts/hashes under the prod pepper — aligns with the existing cutover re-seed) |

## 5. Decisions — KUNAL DECIDED 2026-07-07 (these govern the build)

- **D9-0 — build now: YES** (phase-scope pre-beta blocker, confirmed by starting the scope).
- **D9-1 — person server-verification on the admin/online actions only (3.2 list): CONFIRMED.** Everyday
  store flows (movements, receives, counts) stay device-key-only — offline work never blocked.
- **D9-2 — user management is Director-only: CONFIRMED.** HO can view.
- **D9-3 — lockout 5 wrong → 15 min, doubling; Director can unlock early: CONFIRMED, PLUS (Kunal's addition)
  LOCKOUT VISIBILITY: a lockout must be SURFACED to the Directors, not silent** — "I need to know this has
  happened to someone, so if it is malicious I can do something about it." Build: (a) the user-admin screen
  shows per-user Locked/FailedCount/last-failed-at live from the cloud list; (b) a lockout fires a notification
  email via the EXISTING bob-stock-email Logic App (management@ → logistics@, zero new infra) naming the
  username, store/device context available, and the time. Auditors: attack the notification path for spoof/
  flood (a wrong-password loop must not email-bomb — e.g. notify once per lockout event, not per attempt).
- **D9-4 — passwords: Kunal SETS and KEEPS everyone's passwords. NO self-service, NO MustChange flow.**
  Directors (Kunal) create/reset every password via the gated user-admin endpoint; staff never choose their
  own; "I always know everyone's passwords." Minimum length: 8 for everyone, 10 for Kunal + Shahin (Director
  accounts). *(Deliberate business decision — the auditors should treat "Director knows all passwords" as an
  accepted trust model for this business, not a finding; per-person accountability vs the Director is provided
  by the append-only ledger, not password secrecy.)*
- **D9-5 — PIN: LEAVE AS-IS, no redesign.** Kunal: the only PIN actually used operationally is the existing
  24h stock-take unlock code for store accounts (covers manager-away); that flow is already built and stays
  unchanged. The 10-min inactivity PIN overlay also stays as-is. PIN gates nothing sensitive after this chunk
  (all admin actions require the server-verified password + D9-6 re-prompt), so the walk-away risk is covered
  by sudo-mode, not by PIN hardening.
- **D9-6 — sudo mode: YES.** The app re-prompts for the PASSWORD (verified server-side) immediately before the
  most sensitive actions — catalogue publish, archive run, user-admin — even mid-session.
- **D9-7 — stock-take approval + discrepancy resolution server-side: DEFERRED, but tracked as a REAL
  commitment.** Kunal: "keep a note of this as I really do want it — I ultimately don't want anything in the
  browser that is not in the cloud." Banked in SERVER-SIDE-REQUIREMENTS.md (P0 list) + memory. In THIS chunk
  they get the D9-6 person re-prompt at the UI level; the residual (a tampered device can still forge the
  underlying ledger rows) is the documented P-13 acceptance, shrunk further by Chunk 10 scoping.

## 5b. ACCOUNT MODEL — KUNAL CLARIFICATION (2026-07-07) — GOVERNS the seeding + scope

Accounts are per-ROLE-AND-SCOPE, NOT per-individual. No individual staff logins. Each account = username +
password (KUNAL sets all) + role + StoreIds scope. This maps onto the app's EXISTING role matrix — no auth
rework needed; it clarifies what accounts get SEEDED at cutover + the role→caps mapping.

| Account | Role | Scope (StoreIds) | Capabilities |
|---|---|---|---|
| **Store account** (basic, shared staff use) | `staff` | its one store | stock IN/OUT + today's movements ONLY. **+24h PIN grant → stock take + receive HO transfers** (manager-away cover). |
| **Store manager** (separate from the store account) | `store_manager` | its one store | store ops: stock transfers, stock take + submit |
| **Territory manager** | `territory_manager` | THEIR stores (not all) | their stores |
| **Franchisee** | `franchisee` | their stores + their franchise HO/office | their stores + office |
| **Company HO** | `head_office` | HO / all | company-wide |
| **Director** (Kunal, Shahin) | `director` | all | full access |

- Two SEPARATE accounts per store: the basic **store account** AND the **store manager** account.
- The **24-hour PIN** is the EXISTING stock-take grant (D9-5, untouched) — it temporarily elevates the basic
  store account to (a) do a stock take AND (b) receive transfers from HO. **OPEN Q (behaviour): today `staff`
  can receive transfers freely (caps `transferReceive` includes 'staff'); Kunal wants receive-HO-transfer gated
  behind the 24h PIN for the store account — confirm + covering sentinel before changing (discover-before-touch).**
- WHO-did-it record: staff still TYPE their name per movement (StaffName label, NOT a login — Kunal confirmed);
  the authenticated actor is the ACCOUNT (shared store account), reinforcing the "no individual non-repudiation"
  audit language (Codex P2).
- Total accounts ~15–40 (Kunal). Sizing is fine for the UserCredentials list + Director-only management screen.
- **Scoped directory (adopted #3 / AGY-9-3) mostly DISSOLVES:** no individual staff directory to distribute;
  store/franchise devices log into their ONE account and never need a roster. Only Directors/HO see the account
  LIST (already Director-gated user-admin 'list'). Row-level data SCOPING by the account's StoreIds = Chunk 10.

## 6. ADOPTED DESIGN-REVIEW CHANGES (R1 — Codex SOUND-WITH-CHANGES + AGY CONVERGE, folded 2026-07-07)

These amendments GOVERN the build wherever they conflict with §3 above.

1. **Auth PROOF, not password-per-request (Codex P1 — supersedes §3.2's "attach password to sensitive
   requests").** The password transits ONLY at login and at sudo prompts, to the verify path. On success the
   Function mints a SHORT-LIVED signed proof — HMAC-signed blob `{userId, role, exp, authTime, deviceContext
   (storeId/key-class), tokenVersion, purpose}` — and THAT is what sensitive requests carry. Each gated LA
   forwards the proof to a `verifyProof` Function route (fail-closed). Sudo mints short-TTL PURPOSE-BOUND
   proofs (purpose='publish'|'archive'|'user-admin'|'backup'|...). Password never sits in memory beyond
   minting; wiped on lock/logout; never service-worker cached; never BroadcastChannel'd. Proof is bound to the
   device context so it can't be replayed from another device/key-class. Token invalidation via tokenVersion
   (bumped on password reset — old proofs die immediately; NO grace window on password change, Codex #6).
2. **Queued privileged ledger rows carry a person proof (Codex P1).** Director-only actions that create
   ledger/record rows (stock-take approve, transfer resolve/cancel, delivery record, adjustments) require a
   sudo purpose-proof AT ACTION TIME; the proof (or its id) is attached to the queued rows, and push-v2 /
   recordsteps-push VALIDATE it server-side when the rows arrive — reject/quarantine Director-only row types
   arriving without a valid person proof. Consequence: these actions need INTERNET AT THE MOMENT OF ACTION
   (see D9-8 below — Kunal decision). This partially delivers the D9-7 commitment early (server-side validation
   at ingest; the full server-performed write stays in SERVER-SIDE-REQUIREMENTS 4b).
3. **User directory is GATED + SCOPED, not public master_data (both auditors COUNTER; supersedes §3.1).**
   The directory moves out of the public master_data payload into a gated directory delivery (Chunk-5
   authenticated): Director/HO devices receive all active users; a store/franchise device receives ONLY users
   whose StoreIds touch that store (+ minimal HQ role labels needed for UI). No hashes ever. (AGY-9-3 / Codex P2.)
4. **Lockout — converged mechanics (AGY-9-1 + Codex P2, reconciled).**
   - CHECK ORDER: device key FIRST; failed person attempts are counted ONLY from requests that passed the
     device gate. A store key can never reach Director person-verification, so it can never lock Kunal
     (kills AGY's lockout-as-DoS WITHOUT a blanket Director bypass).
   - Director accounts STILL lock (Codex): a stolen Director device gets 5 attempts, then lockout + email.
   - Break-glass runbook (Codex): second Director unlocks via user-admin; if BOTH Directors are locked, the
     documented owner path is a manual SharePoint edit (clear LockedUntil) via the M365 admin account —
     outside the app, written into the runbook.
   - Counter writes (FailedCount/LockedUntil/LastFailedAt/LastLockoutNotifiedAt) use If-Match + retry
     (AGY-9-5/Codex); reset-on-success only after verified success; notify ONCE per lockout TRANSITION.
   - Anti-enumeration: dummy KDF work on unknown usernames + generic wrong-credential responses (no
     user-exists oracle); person error taxonomy distinct from device 401 (locked vs wrong vs device) but
     externally oracle-safe.
5. **Local verifier pinned (both):** WebCrypto PBKDF2-HMAC-SHA-256, per-device random 128/256-bit salt,
   stored KDF params, iterations calibrated to ~250-500ms on the low-end target devices. Deleted verifier =
   NO fallback (offline login unavailable until re-derived online). Stale mirror: offline local access may
   continue until next sync; online sensitive actions fail the moment the cloud deactivates/locks the user.
   Verifier + salt EXPLICITLY scrubbed from backups (AGY-9-2 — extend the backup scrubber + a sentinel).
6. **Sudo re-prompt also covers backup export/import (AGY-9-4).** purpose='backup'.
7. **Password set/reset hardening (Codex #6):** secureData on trigger+action inputs; Function-side hashing;
   no hash material in any response; requires Director DEVICE key + Director PERSON sudo proof; If-Match
   versioned write + idempotency key; tokenVersion bump invalidates the user's outstanding proofs immediately.
8. **Honest audit language (Codex P2, D9-4 corollary):** every email/report/export/admin-screen and the final
   6-way security language says "authenticated as account X from authenticated device/store Y" — NEVER "person
   X personally did it". Password secrecy from Directors is explicitly NOT claimed.
9. **Bootstrap + rollout (Codex #9):** the FIRST Director row is seeded by a one-time bootstrap (outside
   user-admin) which is then disabled/deleted; a new client with no user list FAILS CLOSED for sensitive
   actions; old clients are excluded by the existing rollout gate (no device gets the app pre-cutover).

### D9-8 — ACCEPTED (Kunal, 2026-07-07)
Director-only stock actions (approve a stock take, resolve/cancel a transfer, record a delivery, adjustments)
require INTERNET AT THE MOMENT of action: a sudo person-check mints a purpose proof, the proof attaches to the
queued rows, and push-v2 / recordsteps-push validate it server-side on ingest (Director-only row types without
a valid proof are rejected/quarantined). Normal store flows unaffected. This partially delivers D9-7 early;
the full server-performed write remains SERVER-SIDE-REQUIREMENTS 4b.

## 7. Explicitly OUT of scope
- M365/MSAL/Entra accounts (hard constraint: no licences, no cost).
- Row-level read scoping per store — that's Chunk 10 (next), which builds on the device-key layer.
- Moving every ledger write behind person auth (breaks offline-first; the ledger's integrity model is
  append-only + audit + Chunk 10 scoping).
- Email/SMS password reset infrastructure.

## 8. Audit plan
Per the standing cadence: this scope → Kunal's D9 decisions → spec/design review by Codex + AGY (paper review,
attack the model, esp. the offline/local-verifier split, lockout race conditions, credential handling in
memory, and the device-vs-person layering) → build on staging (Mode A) → sentinels/saboteurs (extend S-186..191
class) → full local sweep → wave review → Codex+AGY code audit → converge → HOLD with chunks 5-8.
