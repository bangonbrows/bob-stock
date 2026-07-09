# INTERNAL DEEP AUDIT BRIEF — Account Access chunk (fresh-session Claude)

**Commissioned by Kunal 2026-07-09:** *"this is a bigger chunk of work than we initially thought — before we
ask Codex and AGY for a local audit, a NEW session of yours must do a deep thorough audit of the whole app to
make sure we didn't break anything."* You are that new session. You are AUDITING, with fresh eyes — assume
the builder made mistakes; your job is to find them, not to confirm the work.

## Ground rules
- **RUN things, don't just read** (framework rule: static-only review misses runtime-scope bugs). Real
  Chromium via the harness patterns in `test/smoke-test.js`; Node for the Function suites.
- **Report only** — you fix nothing without Kunal's go. Produce a findings list (P0/P1/P2/P3 + evidence +
  repro), written to `audit-artifacts/AA-INTERNAL-AUDIT-REPORT.md`.
- Branch: `azure-phase-5-8-server`. The chunk = commits `5fe0ca6..` (W1) through the W6 sentinel commit —
  `git log --oneline 3dbc3c5..HEAD` is the exact change set under audit ( everything after the Chunk-10
  injection-hardening commit).
- The Logic Apps are NOT in-repo and NOT yet updated for this chunk — client/Function behaviour is what you
  can prove locally. `AZURE-CHUNK-AA-LA-CHANGES.md` is spec; flag anything in it that the client/Function
  contract contradicts.

## What changed (full inventory — attack all of it)
Read first: `AZURE-CHUNK-AA-WAVE-REVIEW.md` (wave-by-wave + 9 disclosed residuals),
`AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md`, `AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md` (D-AA-1..5, SR-1..11, R2).

1. **azure-functions/src/functions/accessPolicy.js** (NEW): resolveCapability (SR-7), sudoRequirement,
   evaluateAccess, policyMerge (floor/DIRECTOR_LOCKOUT/version/PIN-hash), validatePin.
   `validateUser.js`: purposes +cancel/+access-policy; VERIFIABLE vs mintable pin-grant split.
2. **index.html**: `Auth._caps` +6 caps (5 view toggles + editAccessPolicy); `Auth.can` policy-overlay
   resolver + legacy fallback; adoptPolicy/policyVersion/defaultPolicyBlob; login/restore adoption; stock-take
   approve/reject re-routed to Auth.can; archive gates → seeArchive; cost columns → seeCost; the whole
   Account Access screen (`_dirAccessPolicy` + `_ap*` helpers); PIN rework (`_pinSource`, `_verifyPinValue`,
   `_pinUnlockModal`, `_pinModalSubmit`, `_actionSudo`); `_setStockTakePin`/`_clearStockTakePin` policy path;
   `_saveDelivery`/`_approveStockTake` action-sudo; backup-export policy privacy lock.
3. **phase2.js**: `_canCreate/_canReceive/_canResolve/_canCancel/_canSetThresholds` → Auth.can;
   `submitReceive` PIN unlock hook; 3 resolve entries action-sudo.
4. **sync.js**: `_applyAccessPolicy` (adopt + SR-4 purge + privacy lock); policyVersion pull echo;
   `publishAccessPolicy`; `pinUnlock` + `_pinGrantProof`; `_actionProofs`/`holdActionProof`;
   `_withIngestProofs` on push + steps-push; `_fetchCorporateCosts` policy gate; `accessPolicyWriteUrl`
   wiring; `clearPersonProofs` widened.
5. **db.js**: `accessPolicy` meta persistence (2 persist sites + load).
6. **test/**: access-policy-proof.js (54 probes); smoke S-229..S-240; saboteur mutations S-229..S-240;
   verify-app size bounds raised (db 130k, sync 240k).
7. **Deleted**: sync-v2.js, migrate-v2.js (dead, Kunal-approved).

## Audit axes (minimum — go beyond)
A. **REGRESSION (Kunal's core question):** with NO adopted policy, is the app byte-for-byte behaviourally
   identical to pre-chunk? Drive the real flows per role (staff/manager/franchisee/TM/HO/director): log
   movement, stock-take incl. 24h-PIN local path, transfers create→submit→receive→flag→resolve, delivery,
   CSV exports, backup export/import, reports/archive banner, user admin, publish. The 6 re-routed gates
   (D1) are the top regression risk — old set vs new seed for EVERY role × cap.
B. **Resolver correctness under policy:** client `Auth.can` vs server `resolveCapability` PARITY on
   adversarial fixtures (override maps with __proto__/constructor keys, roles missing, caps missing, string
   'true' values, override for a DIFFERENT user, PIN grant on non-PIN caps, custom role names). Any
   divergence between the two implementations is a finding.
C. **Policy lifecycle:** adoption ordering (config fetch vs login vs pull echo), version replay/rollback,
   persist-failure paths (commitDurable false), the SR-4 purge (does revoke REALLY remove the data —
   check Dexie after reload, not just the in-memory cache), privacy-lock lifecycle (set/clear/blocked
   export), multi-tab (leader vs non-leader adoption).
D. **PIN machinery:** local path pre-activation unchanged (incl. expiry, lockout via wrong entries?);
   server path routing; grant expiry vs PIN expiry; grant on deactivated account; pin-grant proof
   dc-binding; submitReceive hook (does the retry-after-unlock re-enter cleanly? double-submit guard?);
   PIN set/clear policy path (does the draft it publishes accidentally clobber concurrent matrix edits?).
E. **Screen/XSS/injection:** the Account Access screen renders user names, role names, capability keys from
   the policy blob — a MALICIOUS blob (crafted role name/override key with markup or quotes) must not
   execute or break the onclick wiring. Also floor rendering vs draft state, discard-draft state leaks.
F. **Proof plumbing:** _withIngestProofs on every push shape (empty batch, retry path `_isRetry`, offline
   queue flush); proofs in backups/Diag/localStorage (MUST be memory-only — extend the S-219 discipline);
   action-proof TTL edge (minted at 4m59s).
G. **Fossil deletion fallout:** anything that referenced sync-v2/migrate-v2 (grep again yourself).
H. **The 54-probe Function suite:** attack the tests themselves — what ISN'T covered? (e.g. policyMerge
   with `current` malformed, evaluateAccess with rows >50 at the handler, unicode role names, pin '0000',
   negative expiresAt). Run your own adversarial probes against the module.

## Pass criteria
- Zero P0/P1 findings open at the end (fix list goes back to the builder session — you do NOT fix).
- Full smoke 231/231 + full saboteur sweep (ALL mutations, concurrency 10 — you are the local gate; do NOT
  hand the full sweep to externals) with 0 BLIND.
- A written verdict per audit axis A–H, even where clean ("checked, clean, how" — no silent coverage).

## After you finish
Report to Kunal in plain English (he does not read code). Findings → builder session fixes → your re-check →
ONLY THEN the external pack goes to Codex + AGY (paper/local per `AZURE-CHUNK-AA-WAVE-REVIEW.md` §Next gates).
