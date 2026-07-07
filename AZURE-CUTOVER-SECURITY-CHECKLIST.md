# Azure Cutover Security Checklist (execute at the SINGLE live deploy, before staff/beta)

**Status:** DEFERRED from Chunk 7 (Kunal, 2026-07-05) — rotate secrets AT the boundary we're protecting
against (leaving single-owner alpha), not months early. Everything below is a LAST-STEP action at the live
cutover, run in order, before any non-owner uses the app.

Rule of thumb: rotate every secret that has ever touched git history or a shared file, and relocate the ones
that sit in plaintext config, at the moment the trust boundary widens.

## B1 — SWA deploy token
- [ ] Regenerate the Static Web App deployment token in Azure.
- [ ] Store it as a GitHub Actions **Secret** (e.g. `AZURE_STATIC_WEB_APPS_API_TOKEN`); reference it via
      `${{ secrets.* }}` in the workflow.
- [ ] Remove the plaintext token from `.github/workflows/*.yml`. (Note: it remains in git HISTORY — the
      regeneration is what neutralises it; optionally history-scrub if required.)

## B2 — Function secrets → Key Vault / Managed Identity
- [ ] **Generate a BRAND-NEW production `BOB_AUTH_PEPPER`** and store it in Key Vault — do NOT carry the staging
      pepper into prod (the staging value has been in audit transcripts + git; spec-audit round 1, AGY COUNTER).
      Because the pepper is baked into every StoreCredentials hash, a fresh pepper REQUIRES re-seeding all
      StoreCredentials with freshly-minted store/Director keys (which we do at cutover anyway — production keys
      are new). So: mint fresh prod store keys + Director key → hash them under the NEW pepper → seed the LIVE
      StoreCredentials list. (GPT's nuance: relocating a pepper unchanged is fine for a pure move, but since we
      want a clean prod hashing chain free of staging secrets, mint fresh — this is a deliberate rotation.)
- [ ] Move the validateKeys / validateMoney / catalogueMerge **function keys** to Key Vault references, OR
      switch the Logic App→Function calls to **Managed Identity** (drop the `?code=` key-in-URL entirely).
- [ ] Verify each gated Logic App still verifies/validates after the move (re-run the harness cloud probes).

## B3 — Logic App SAS rotation
- [ ] Regenerate the callback SAS for every gated Logic App: push-v2-validate, pull-v2 (dual+idcursor),
      recordsteps-push, recordsteps-pull, config, email, catalogue-write, corp-costs, + the set/util apps.
- [ ] Re-publish the new callback URLs into the LIVE AppConfig `sync_config` (the client reads them from there).
- [ ] The OLD SAS in git history (commits 2c78faf / ad6e3b4) are neutralised by regeneration.
- [ ] Document a rotation cadence (e.g. rotate on staff turnover / suspected exposure / annually).

## Font subset (from the Chunk 7 audit)
- [ ] The self-hosted fonts (`fonts/`) are LATIN-ONLY (Chunk 7 A2). If any non-Latin staff/store/product name
      ever needs to render (accented/CJK/etc.), regenerate the subset to include the needed unicode-range
      blocks before launch. Fine as-is for the current WA/English data (both auditors confirmed).

## Audit-access teardown (after the phase 5-8 integration audit; hard requirement at cutover)
- [ ] Delete the scoped reset Logic App `bob-stock-archtest-reset-staging` (audit-only write path).
- [ ] Delete `StockTransactions_ArchTest` + any leftover `StockTransactions_Archive` test rows; reset
      `stock_snapshot`→v0 / `archive_state`→idle (or just drop the staging lists).
- [ ] Treat `AUDITOR-ACCESS-BUNDLE.txt` secrets as EXPOSED (shared with external AI auditors): the staging
      Director key + all store keys, the config/archive/archive-pull/reset callback SAS, and the validateKeys +
      snapshotCompute function keys are all rotated/replaced by the steps below — confirm none carry into prod.

## Verify at cutover (from the phase 5-8 integration audit — Codex coverage boundaries)
- [ ] Inspect the DEPLOYED Static Web App RESPONSE headers and confirm the CSP is served exactly as
      `staticwebapp.config.json` specifies (the audit validated the config header locally, not the live SWA
      response — a proxy/SWA quirk could drop or alter it).

## Also at cutover (from the broader backlog)
- [ ] Delete the read-only auditor Graph credential(s) if any remain.
- [ ] Remove ALL staging test rows/fixtures ONLY IF live and staging share a site (they do — same SharePoint;
      staging uses *_Staging lists, so live lists are unaffected, but delete leftover test rows in shared lists
      like StockTransactions_Quarantine).
- [ ] Confirm `emailUrl` served only via config (Chunk 7 A4 verifies this in the client).
