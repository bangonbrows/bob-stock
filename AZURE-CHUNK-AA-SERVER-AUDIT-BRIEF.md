# SERVER-SIDE DEEP AUDIT BRIEF — Account Access chunk (fresh-session Claude)

**Commissioned by Kunal 2026-07-09.** A separate, fresh Claude session audits the SERVER side of the Account
Access chunk — the deployed Azure Functions AND the staging Logic Apps — the way the earlier client-side deep
audit was done: **independently, adversarially, and against DEPLOYED REALITY — not by trusting the builder's
results.** You have real Azure access; use it. If a claim in this repo can be checked against the live cloud,
CHECK IT.

## Prime directive
- **RUN, don't read.** For every server claim, exercise the DEPLOYED artifact and observe the actual response.
  The Functions are pure and take their data `rows` **in the request body**, so you can drive the *live*
  decision engine end-to-end with real crypto and NO secrets (Method A below). Do that — don't infer from
  source.
- **Trust nothing from the builder.** The files `audit-artifacts/AA-INTERNAL-AUDIT-REPORT.md` and
  `audit-artifacts/AA-INTERNAL-AUDIT-RESPONSE.md` describe what was found and claimed-fixed. Treat them as
  claims to falsify, not facts. Re-derive.
- **Report-only.** You fix nothing. Produce `audit-artifacts/AA-SERVER-AUDIT-REPORT.md` with findings
  (P0/P1/P2/P3 + evidence + exact repro) and a per-axis verdict, even where clean ("checked, clean, how").
- **Leave no residue.** Prefix every test artifact `srvaudit_`. Delete any test rows/functions/policies you
  create. Never run load tests (the staging LAs share one `sharepointonline` connection with LIVE sync —
  functional probes only).

## Your access (confirmed working this session)
- **Azure CLI is logged in** as `management@bangonbrows.com.au`, subscription `BOB-Stock-App`
  (`1543b78c-8061-44f8-a119-61dee9a3172d`), resource group `bob-stock-sync`. `az` is allow-listed in
  `.claude/settings.local.json` for this project, so `Bash(az *)` / `PowerShell(az *)` run without prompts.
- You do NOT have the raw `BOB_AUTH_PEPPER` / `BOB_PROOF_SECRET` and do not need them — retrieve function
  keys and LA callback URLs live (below) and drive the deployed artifacts.
- There is a **read-only** Graph auditor app (`0ccf2a39`, expires 2026-07-29) for reading SharePoint lists if
  you want to inspect stored rows; it CANNOT write.

## The server surface (audit ALL of it)
**In-repo Functions** (`azure-functions/src/functions/`, deployed to Function App `bob-stock-money-fn`, 10
routes): `validateKeys`, `validateUser`, `verifyProof`, `mintUserCredential`, `validateMoney`,
`catalogueMerge`, `snapshotCompute`, and the Account-Access trio **`evaluateAccess`, `policyMerge`,
`validatePin`**. All `authLevel:'function'`, none touch SharePoint (I/O is in the wrapping LA).

**Staging Logic Apps** (NOT in the repo — deployed WDL only; `az resource show` to read them). The AA chunk
touched/added: `bob-stock-config-staging`, `bob-stock-pull-v2-dual-staging`,
`bob-stock-access-policy-write-staging` (NEW), and specifies (not-yet-applied) changes to
`push-v2-validate-staging`, `recordsteps-push-staging`, `corp-costs-staging`, `archive-pull-staging`,
`user-admin-staging`, `catalogue-write-staging`, `user-verify-staging`. `bob-stock-tmp-c9` is a
director-gated SharePoint passthru (Chunk-9 seeding tool). Governing spec: `AZURE-CHUNK-AA-LA-CHANGES.md`.
Applied-so-far record: `AZURE-CHUNK-AA-STAGING-LEDGER.md`.

**Read these first:** `AZURE-CHUNK-AA-ENFORCEMENT-MATRIX.md` (the SR-3 contract), `AZURE-CHUNK-AA-LA-CHANGES.md`
(LA spec), `AZURE-CHUNK-ACCOUNT-ACCESS-SCOPE.md` (D-AA-1..5 + SR-1..11 + R2), `AZURE-CHUNK-AA-WAVE-REVIEW.md`
(residuals), and the two audit-artifacts files (as claims). Branch: `azure-phase-5-8-server`.

---

## METHOD A — drive the DEPLOYED functions for real (no secrets, real crypto). THIS IS THE CORE.
The functions verify their own crypto and take synthetic `rows` in-band, so you can exercise the entire
deployed decision engine end-to-end. Recipe:

1. **Get a function key** (per route) via ARM REST:
   ```
   az rest --method post --uri "https://management.azure.com/subscriptions/1543b78c-8061-44f8-a119-61dee9a3172d/resourceGroups/bob-stock-sync/providers/Microsoft.Web/sites/bob-stock-money-fn/functions/<FN>/listkeys?api-version=2022-03-01" --query default -o tsv
   ```
   for `<FN>` in evaluateAccess / policyMerge / validatePin / validateUser / verifyProof / mintUserCredential.
   Call the function at `https://bob-stock-money-fn.azurewebsites.net/api/<FN>?code=<key>` (POST JSON).
2. **Bootstrap a real credential** (server-side hashing, no pepper needed):
   `POST mintUserCredential {username:'srvaudit_dir', password:'Srvaudit-Pass-123', role:'director'}` →
   `{ok, salt, hash}`. Build `row = {UserId:'srvaudit_dir', Username:'srvaudit_dir', Role:'director',
   Salt:<salt>, SecretHash:<hash>, Active:1, TokenVersion:0}`.
3. **Mint a real proof:** `POST validateUser {username:'srvaudit_dir', password:'Srvaudit-Pass-123',
   purpose:'session', deviceContext:'__director', rows:[row]}` → `{userOk:true, proof}`. (Also mint sudo
   proofs: purpose `access-policy`, `approve`, `delivery`, etc.)
4. **Attack `evaluateAccess`** with that proof + a crafted `policy` blob + `rows`. Verify the SR-7 order, the
   fail-closed defaults, and the AA fixes against the LIVE function. Independently reconstruct the expected
   answer and diff. At minimum, adversarially probe:
   - **AA-01 (identity):** overrides are keyed by USERNAME. Confirm an override under the account's Username
     binds, and one under a `u_…` id-style key does NOT. Confirm the resolver never consults `UserId`.
   - **SR-2/SR-8 fail-closed:** missing/unparseable `policy` ⇒ deny; a capability the blob omits ⇒ deny even
     for director; unknown role ⇒ deny.
   - **SR-7 order:** explicit override (allow AND deny) is FINAL and beats a valid `pinProof`; the PIN lifts
     ONLY `stockTakeCount`/`transferReceive`.
   - **RESERVED:** capability names `__proto__`/`constructor`/`prototype` denied.
   - **Sudo map + SR-1 floor:** `access-policy` and `user-admin` always demand a purpose-bound sudo proof even
     if the blob's `sudo` map lies (`session`). A session proof on a floored action ⇒ NEED_SUDO.
   - **Proof binding:** a proof for device context A rejected under context B; an expired proof rejected; a
     `tokenVersion` bump kills a proof; `verifyProof` returns the CURRENT row's role, not the proof's.
5. **Attack `policyMerge`:** floor invariants REJECT (not silently correct) a blob that relaxes a floored key
   (`FLOOR_VIOLATION`) or strips director `editAccessPolicy` (`DIRECTOR_LOCKOUT`); `__proto__`/bad-charset
   keys rejected; non-boolean cap values rejected; server-side version bump is monotonic; **AA-03**
   `baseVersion` mismatch ⇒ `STALE_VERSION` (and omitted baseVersion still allowed); **AA-18** a poisoned
   `current.version` (Infinity/NaN/float/huge) resets base to 0 rather than wedging; `pinPlain` hashed
   server-side, plaintext never echoed.
6. **Attack `validatePin`:** **AA-09** the acting account is read from `actorUsername`; a correct PIN mints a
   grant bound to the account+deviceContext, expiring ≤ min(PIN expiry, 24h); wrong/expired PIN ⇒ no grant; a
   deactivated account can't elevate; **AA-17** an unparseable `expiresAt` ⇒ no grant (no NaN-exp); the grant
   is NOT mintable via the password path (`validateUser` with purpose `pin-grant`).
7. **Regression on the pre-AA functions:** confirm `validateKeys`/`validateUser`/`verifyProof`/`catalogueMerge`
   /`snapshotCompute`/`validateMoney` still behave (the AA deploy was additive — prove it didn't break them;
   e.g. `validateMoney` still fail-OPEN by design, `validateKeys` still fail-closed).

There is a committed logic-proof suite `test/access-policy-proof.js` (61 probes) — RUN it, but do not trust it;
write your OWN adversarial probes against the DEPLOYED endpoints (the suite runs the local module; you want the
cloud). Note any behaviour where deployed ≠ local module (a stale deploy is itself a finding).

## METHOD B — audit the DEPLOYED Logic App WDL vs the spec
`az resource show -g bob-stock-sync --resource-type Microsoft.Logic/workflows -n <LA> -o json` returns the live
`properties.definition`. For each AA-touched LA, compare the DEPLOYED logic to `AZURE-CHUNK-AA-LA-CHANGES.md`:
- **config LA:** does the `Get_items $filter` exclude BOTH `corporate_costs` AND `access_policy_secure`? (a
  device must never receive the PIN-hash-bearing secure blob).
- **pull-v2-dual:** is `policyVersion` actually echoed on BOTH response branches? Does it read the
  `access_policy_version` AppConfig item and coalesce to 0 when absent?
- **access-policy-write-staging (NEW):** trace the full gate chain in the deployed WDL — Director device key
  (validateKeys) → `evaluateAccess` (action `access-policy` + capability `editAccessPolicy`; first-write role
  assertion) → `policyMerge` (with `baseVersion` passthrough) → upsert of the THREE AppConfig items
  (`access_policy_secure` full, `access_policy` client-copy with pin reduced to `expiresAt` only,
  `access_policy_version`). Confirm the client copy CANNOT contain the pin hash. Confirm the function-key
  query-string codes in the WDL point at the right functions.
- The **not-yet-applied** LAs (§3–10 of LA-CHANGES): confirm they are indeed NOT yet carrying enforcement
  (so the app is inert pre-activation), and review the SPEC for gaps — especially the **AA-07/AA-08**
  retryable-vs-permanent classification (proof-absent/expired must be RETRYABLE, only proof-INVALID
  permanent) and the **AA-09** LA-derived `deviceContext` (never from the client body).

## METHOD C — live deny-path probing (needs NO valid creds)
Get an LA trigger URL:
`az rest --method post --uri ".../workflows/<LA>/triggers/When_an_HTTP_request_is_received/listCallbackUrl?api-version=2016-06-01" --query value -o tsv`
(the tmp-c9 trigger is named `manual`, not `When_an_HTTP_request_is_received`). Then POST crafted payloads and
assert the REAL response:
- **access-policy-write:** wrong/missing device keys ⇒ 401; valid-shape but no sudo proof ⇒ the write is
  refused (403 / NEED_SUDO) and NOTHING is written. A store key (non-director) ⇒ 401/403.
- **OData injection (commit 3dbc3c5 hardening):** on pull / recordsteps-pull / archive-pull, a StoreId scope
  value containing a quote/paren/space/operator/`*` must yield NO clause (fail-closed 200/0 rows), never break
  out of the literal. Re-verify against the DEPLOYED LAs.
- Confirm every gated read/write LA fail-CLOSES on missing/unreadable auth (empty scope ⇒ nothing).

## METHOD D — credentialled POSITIVE end-to-end (the one gap; coordinate with Kunal)
Verifying a *successful* publish through the real `access-policy-write` LA (device key + sudo proof → real
SharePoint write of the 3 AppConfig items → config withholds the secure blob → pull echoes the new version)
needs a KNOWN staging `__director` device key value + a test director UserCredentials row. Kunal flagged these
as needing regeneration. **Do NOT fabricate or skip this — flag it:** ask Kunal to either provision a
`srvaudit_`-prefixed test director device key + account (SharePoint write is outside your access), or accept
that the positive LA E2E is verified later at the shared staging-apply step. Methods A–C already give real,
independent verification of the entire decision engine, the deployed WDL, and all deny/security paths without
it — so a missing Method D does NOT block a rigorous server verdict; it just scopes the one positive-path
assertion.

## Specifically re-verify these builder claims (falsify them)
- AA-01 overrides-by-username (server `resolveCapability`/`evaluateAccess`): really keyed by Username, UserId
  never consulted.
- AA-09 `validatePin` reads `actorUsername`; deviceContext LA-derived in the deployed write/verify LAs.
- AA-03 `baseVersion` CAS actually rejects stale writes in the DEPLOYED policyMerge + is passed through by the
  DEPLOYED write LA.
- AA-17 numeric PIN-expiry guard; AA-18 finite/integer version guards — in the DEPLOYED functions.
- SR-1 floor / DIRECTOR_LOCKOUT truly REJECT (not silently correct) in the DEPLOYED policyMerge.
- The deployed Function App matches the repo source (diff the deployed behaviour against
  `azure-functions/src/functions/accessPolicy.js` — a stale deploy is a P1).
- Cost-strip default-STRIP (SR-10) and archive era-cutoff fail-closed (SR-6) — as SPEC in LA-CHANGES §5/§6
  (not yet applied; review the spec + confirm inert).

## Pass criteria
- A per-method verdict (A–D) with evidence.
- Zero P0/P1 left standing at the end of YOUR pass (findings → builder session → your re-check → externals).
- Every `srvaudit_`-prefixed artifact deleted; confirm the staging lists/functions are as you found them.

## After you finish
Report to Kunal in plain English (he does not read code). Findings → builder session fixes → your re-check →
ONLY THEN the external pack (Codex + AGY). Do NOT send anything to externals.
