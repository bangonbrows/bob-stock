# AZURE CHUNK 7 — Hardening / cleanup — WAVE REVIEW

**Date:** 2026-07-05 · **Status:** BUILT + self-proven; client NOT committed, live UNTOUCHED.
**Spec:** `AZURE-CHUNK7-SCOPE.md` (spec-audit round 1 converged; both corrections adopted).
**Process:** `AZURE-CHUNK-PROCESS.md`. Wave pack for the GPT+AGY code audit.

---

## What shipped (Group A client + Group C code; Group B = cutover checklist, NOT built)

**A1 — self-host Dexie + Chart.js.** Vendored `vendor/dexie-3.2.7.min.js` + `vendor/chart-4.4.0.umd.min.js`
(downloaded from jsdelivr), index.html + sw.js now load them same-origin, jsdelivr URLs + SRI dropped
(same-origin = SRI moot). Now CORE precache (always cached, not optional).
**A2 — self-host Google Fonts.** `fonts/fonts.css` + 10 latin woff2 faces (Playfair Display, Inter, Dancing
Script) served from the repo; the fonts.googleapis.com `<link>` replaced with the local CSS; gstatic dropped.
Latin subset only (WA English app) — 10 files vs Google's 54 unicode-range splits.
**A3 — tighten CSP** (staticwebapp.config.json): removed jsdelivr (script-src), googleapis (style-src),
gstatic (font-src) → script/style/font-src are now `'self'` + `'unsafe-inline'`. **KEPT `'unsafe-inline'` on
script-src AND style-src** (both auditors COUNTER — the app uses inline scripts/onclick/style throughout; a
nonce/hash CSP is a separate future refactor). connect-src keeps `*.logic.azure.com`; img-src keeps `data:`.
Net: the last 3 third-party origins are gone.
**A4 — emailUrl** confirmed only ever `Sync._emailUrl` (from AppConfig); no hardcoded fallback (grep-verified).
sw.js CACHE_NAME → v14.

**C1 — per-step-type ledger allowlist (from C5).** recordsteps-push `L_okrows` (the C6 ledger-context check)
now ALSO requires each referenced ledger row's TYPE to fit the step (full audited map: submit→transfer_out,
receive→transfer_in, cancel→transfer_in, resolve→adjustment_in/out+transfer_in). Wrong type → BAD_LEDGER_CONTEXT.
**PROVEN on staging:** a resolve referencing a plain `in` row → BAD_LEDGER_CONTEXT; referencing an
`adjustment_in` row → accepted.

**C2 — deletion propagation + inactive semantics (from C6).**
- Client: `_deleteCat` / `_deletePT` now DEACTIVATE (active:false) + mark dirty (publishes) instead of
  hard-delete (which never propagated). Inactive cat/PT HIDDEN from the new-product / add+edit-category
  selectors (edit selectors keep the currently-selected ref even if inactive, so an edit can't lose it);
  the row + label persist for historical display.
- Server (catalogueMerge): ref sets built from ACTIVE rows only → a product attaching to an INACTIVE category,
  or a category to an INACTIVE product-type → DANGLING_CATID / DANGLING_PTID. Client already blocks
  deactivating an IN-USE ref, so this only catches direct-API bypass/races. **Unit-tested** (attach-to-inactive
  rejected, active accepted, deactivate accepted).

**C3 — partial-writeback:** LEFT self-healing (Until-retry loop from C6), doc-only per the spec. No build.

## Harness
- **Smoke: 192/192 PASS** (added S-199 deactivate-not-hard-delete, S-200 inactive-hidden-from-selector,
  S-201 no-third-party-origin-in-DOM). Also UPDATED S-147 (pre-existing): its 3rd assertion tested the OLD
  hard-delete ("unused cat is gone") — C2 changed that to deactivate, so it now asserts the unused cat is
  DEACTIVATED (active:false), not removed. (Two test-only fixes this round: S-199 needed to await the
  un-awaited confirm callback; S-147 re-pointed to the new behaviour — no code defects.)
- **Scoped saboteur S-147,199,200,201: 4 CAUGHT / 0 BLIND** (baseline 192/192). C1 is server-side (proven by
  the cloud probe above, like the C4/5/6 WDL pieces — no client saboteur).
  - HARNESS FIX (self-inflicted, caught by the INFRA-FAIL guard): self-hosting the vendor JS meant index.html
    now needs `./vendor/dexie…` to BOOT, but the saboteur's isolated-copy routine (`copyRepoTo`) only copied
    the SRC_FILES list — so every mutated run failed to load Dexie (na/na INFRA-FAIL) while the in-place
    baseline passed. Fixed `copyRepoTo` to also copy `vendor/` + `fonts/`. Also re-pointed S-147: C2 made
    "delete" = deactivate (row preserved), so its old "row is gone" discriminator went BLIND — now it asserts
    the in-use category stays ACTIVE (the bug wrongly deactivates it).
- **Full sweep: 210 CAUGHT / 0 BLIND / 0 SKIPPED / 0 INFRA-FAIL of 210** (2026-07-05). The sweep first
  reported 209 CAUGHT / 1 BLIND — S-147b (the product-type twin of S-147): C2's delete→deactivate made the
  sentinel's "row still exists" discriminator blind for BOTH the cat and PT paths. Fixed the PT check to assert
  the in-use PT stays ACTIVE (matching the cat fix); S-147 + S-147b both re-verified CAUGHT (baseline 192/192).
  No product code changed for the fix (test-only), so the other 209 in-sweep results stand. Net: every mutation
  S-01..S-201 caught.

## Build notes / for the auditors
- The self-host is implicitly proven by the whole suite booting (the app needs Dexie loaded from ./vendor/);
  S-201 adds an explicit DOM check.
- CSP: exactly the both-auditor guidance — drop the 3 external origins, RETAIN inline. Verify nothing renders
  broken (Chart canvas, fonts, the Logic App fetches via connect-src, the service worker).
- C1 map matches the audited emissions (phase2.js submit/receive/cancel/resolve). It ADDS the type constraint
  on TOP of the C6 store+transfer binding (both must hold).
- Cleanup done: C1 test rows removed, build passthru (tmp-c7) deleted.

## Code audit round 1 (2026-07-05) — BOTH PASS clean (first round) → CONVERGED → HOLD
GPT (the strict gate — re-blocked repeatedly on C5/C6) AND AGY both signed off on the FIRST round, no blockers.
- Harness: both 192/192 smoke, scoped saboteur S-199/200/201 = 3 CAUGHT / 0 BLIND.
- Cloud: GPT ran 42 namespaced probes (gpt_c7_…) — C1 allowed-map held + disallowed types → BAD_LEDGER_CONTEXT
  + the C6 foreign-store/wrong-transfer/untagged bindings still hold; C2 active refs accepted, attach-to-inactive
  → DANGLING_CATID/PTID, deactivation accepted. AGY confirmed the same.
- CSP/self-host: rendered under the ACTUAL staticwebapp.config.json CSP — no violations/errors/request failures,
  no third-party DOM origins; Dexie + Chart loaded, Chart rendered to canvas, all 3 self-hosted font faces
  loaded. BOTH byte-verified (SHA-256) the vendored Dexie + Chart.js against the jsdelivr package = exact match.
- Agreed: C1 map complete, C2 semantics close hard-delete propagation + block dangling, self-host integrity ok,
  Group B deferral ok. **NOTE (GPT + AGY): latin-only font subset is fine for current app/brand data — EXPAND
  before launch ONLY IF non-Latin staff/store/catalogue names become a requirement** (banked to the cutover
  checklist). No residual findings. **CHUNK 7 = CONVERGED → HOLD for the end-of-phase 6-way.**

## Group B (DEFERRED — cutover, not this wave)
See `AZURE-CUTOVER-SECURITY-CHECKLIST.md`: rotate SWA deploy token (Kunal chose wait-for-go-live), Function
secrets → Key Vault/MI (mint a FRESH prod pepper + re-seed StoreCredentials with fresh keys — AGY), Logic App
SAS rotation. Executed as the last step before the single live deploy.
