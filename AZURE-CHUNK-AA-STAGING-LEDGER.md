# Account Access chunk — STAGING APPLICATION LEDGER

Tracks applying `AZURE-CHUNK-AA-LA-CHANGES.md` to the staging cloud (RG `bob-stock-sync`, sub
`BOB-Stock-App`). Started 2026-07-09. The LAs are not in-repo; this is the authoritative record of what
was changed on staging, same role as the Chunk-5..10 wave reviews.

## Fix-round redeploy (2026-07-09, post internal audit)
After the internal deep audit's fixes (AA-01/09/03/17/18 server-side), the Function App was **redeployed**
(all 10 routes, additive) and `access-policy-write-staging` **redeployed** with the AA-03 `baseVersion`
passthrough. Both re-proven fail-closed (wrong device keys → 401). Items 1-4 below remain the applied set;
their server dependencies now carry the audited code.

## Applied ✅

1. **Function App `bob-stock-money-fn`** — zip-deployed the updated `azure-functions/` (additive: existing 7
   routes untouched). Now registers **10** routes; the 3 new ones confirmed live:
   `evaluateAccess`, `policyMerge`, `validatePin`. Per-function `default` keys generated for all three.
2. **`bob-stock-config-staging`** (LA-CHANGES §2) — Get_items `$filter` extended to also exclude
   `access_policy_secure` (the full policy blob with the PIN hash never reaches a device; the client copy
   `access_policy` — pin reduced to `expiresAt` — still delivers). Provisioning: Succeeded.
3. **`bob-stock-pull-v2-dual-staging`** (LA-CHANGES §2) — added `Get_policyver` (reads the tiny
   `access_policy_version` AppConfig item) and echoes `policyVersion` on BOTH the idcursor and legacy
   response bodies. Absent item ⇒ echoes '0' (pre-activation). Non-fatal on read failure. Provisioning:
   Succeeded.
4. **`bob-stock-access-policy-write-staging`** (NEW, LA-CHANGES §1) — created. Gate chain:
   Director device key (validateKeys) → `evaluateAccess` (action `access-policy` + capability
   `editAccessPolicy` when a policy exists; first-write falls to the `role==='director'` assertion) →
   `policyMerge` (schema/floor/version/PIN-hash) → upsert 3 AppConfig items (`access_policy_secure` full
   blob, `access_policy` client copy with pin→expiresAt only, `access_policy_version` echo item). Responds
   `{ok,version}` / 403 / 401 only.
   **PROVEN fail-closed on the real cloud:** wrong device keys → **401** `{authRequired:true}` (probe
   2026-07-09). Trigger URL captured (scratchpad, not committed).

## Tracked fix for the staging-apply step (server audit P3, 2026-07-09)
**SRV-P3 — non-atomic 3-item policy write.** The `access-policy-write` LA upserts `access_policy_secure` →
`access_policy` → `access_policy_version` sequentially (chained on Succeeded). A mid-sequence SharePoint
failure advances the secure blob's version while the client/version items lag; the client never sees `ok`,
retries with its old `baseVersion`, and the AA-03 CAS then returns `STALE_VERSION` → the Director is
temporarily blocked from republishing until reconciled. FAILS SAFE (no bad policy ships; devices keep the
last good one) — rated P3, confirmed by the independent server audit AND by the builder against the deployed
WDL. **Fix at staging-apply:** either (a) write `version` FIRST as an intent marker + a reconcile that
repairs a detected secure/version mismatch, or (b) allow a "repair republish" when the LA reads
secure.version > version-item (bypass CAS for the self-heal), or (c) make the write idempotent + retried
until all three converge (catalogue-write Until-loop pattern). Do NOT hand-fix now — folds into finalizing
the write LA at apply time.

## Remaining ⏳ (need staging test credentials — see below)

5. **push-v2 + recordsteps-push ingest validation** (LA-CHANGES §3-4) — the highest-care items: they sit on
   the LIVE-shared `sharepointonline` connection and gate the sync write path. Attach optional
   `{proof,pinProof,sudoProofs}` handling; classify row/step types → `evaluateAccess`. MUST be applied with
   the staged `_policyRequired` advertisement OFF first (inert), proven, then flipped. Deferred to the
   credentialled E2E pass so each can be driven end-to-end, not just deployed.
6. **corp-costs** (§5) — policy `seeCost` check replaces pure flag gating (default STRIP).
7. **archive-pull** (§6) — `seeArchive` + D10-5 StoreIds scope activation + `store_eras` cutoff floor.
8. **user-admin** (§7) — add `evaluateAccess` defence-in-depth (floor already keeps it password).
9. **catalogue-write** (§8) — per-cap `evaluateAccess` (editRefData/editCost/editPricing/editSuppliers).
10. **user-verify** (§9) — new `op:'pin'` → `validatePin` grant mint.
11. **Chunk-8 archive LA** (§10) — sudo map honour (no structural change).

## ✅ Staging DEVICE keys REGENERATED 2026-07-22 (partial unblock)
All six `StoreCredentials_Staging` rows re-keyed in place (ardross / karrinyup / whitford / head_office /
`__director` / franchtest — Version 1→2, fresh salt+HMAC per the validateKeys scheme, Active, no grace).
Done via a temporary SP passthru LA `bob-stock-tmp-rekey` (DELETED after use); runner
`audit-artifacts/rekey-staging.js` (Kunal executed; secrets never in chat). **Every new key verified
against the DEPLOYED validateKeys route (storeOk/directorOk true ×5) + negative control rejected.**
Plaintext keys: `audit-artifacts/.staging-keys-2026-07-22.txt` (gitignored; rotate + delete at cutover).
**Still pending:** the throwaway test DIRECTOR ACCOUNT (`srvaudit_` UserCredentials row) — needed for the
Director-sudo-gated routes (AA credentialled E2E + the W4.4 Contract-2 correction route), not for W4.4
Contract 1 (push-v2 row attestation), which only needs the device keys above.

## ✅ TEST DIRECTOR MINTED 2026-07-23 — THIS BLOCKER IS CLEARED (recorded 2026-07-29)

The section below was written 2026-07-22 and is **stale**. The throwaway staging test director
**`srvaudit_director` was minted the NEXT DAY** by `audit-artifacts/mint-test-director.js`, which:
mints server-side via the deployed `mintUserCredential` route (no hash computed outside the Function),
writes the `UserCredentials_Staging` row (Role director, Active **1** — the numeric column, a boolean
`true` left the row unusable on the first attempt), and then **proves it against the DEPLOYED
verifier**: a real login mints an `archive` sudo proof, `verifyProof` accepts it as director, a wrong
password is rejected, and the proof is rejected for a different purpose. `dedupe-test-director.js`
(same day) cleaned up a duplicate row. Password is in the gitignored
`audit-artifacts/.staging-keys-2026-07-22.txt` alongside the six device keys.

**Consequence: Account Access items 5-11 are NOT blocked on credentials.** They are simply not done.
The next session should plan the applies, not go hunting for a credential.

⚠ Not re-verified since 2026-07-23. Before driving the credentialled E2E, re-run
`mint-test-director.js` (idempotent — it rotates the password and re-proves the whole chain) rather
than assuming the account still works. `bob-stock-tmp-c9` and the runner's own temp passthru are the
seeding paths — **do not delete either during cutover cleanup until this E2E has run.**

## BLOCKER for the E2E proof: staging test credentials (⛔ SUPERSEDED — see above; kept as history)
The full end-to-end proof (seed a `__director` StoreCredentials row + a test director UserCredentials row →
publish the default policy via the new write LA → confirm `access_policy`/`access_policy_version` written and
`access_policy_secure` withheld from config delivery → confirm pull echoes the new version → drive a scoped
device) needs the staging director device key + a test director account, which are NOT in the current
scratchpad (Kunal flagged these need regenerating). The `bob-stock-tmp-c9` director-gated SharePoint passthru
still exists and is the seeding path used in Chunk 9.

**Kunal decision needed:** regenerate the staging test credentials (mint a `__director` staging device key +
seed a test director UserCredentials row) so the credentialled E2E pass + items 5-11 can be driven and
proven. Until then: items 1-4 are live and item 4 is proven fail-closed; nothing is on `main`; the client is
inert pre-activation; the LIVE app is untouched.

## Safety notes
- All changes are on `*-staging` resources; the LIVE Logic Apps (`bob-stock-config`, `push-v2`, `pull-v2`,
  etc.) are untouched.
- Function App deploy was additive; the live app on `main` does not call the Function App's new routes.
- No policy exists in staging AppConfig yet, so even the applied LAs behave exactly as before (config still
  serves the same items; pull echoes version 0).
