# REVIEW PACK — Org-Structure chunk, W4.4 build (buy-back settlement export engine)

> ## STATUS BANNER (read this first)
> The engine has had TWO correctness rounds since the build + one owner decision. If you reviewed a
> prior version, the full round-by-round ledger is in `AZURE-CHUNK-ORG-W44-AUDIT-RESPONSE.md` (read
> only the "Audit rounds" table — top two rows).
> - **R1 (2 fixes):** a committed flush record with no presented-row manifest could finalize; a
>   correction could be placed at a different date than the movement it replaces.
> - **R2 (3 fixes):** a received-stock row with a transferId but no backing records + stripped source
>   labels could be silently dropped instead of held; a committed flush record missing its expected-
>   records list accepted a suppressed record; a correction that itself corrected another correction
>   double-counted. All now hold the settlement "provisional" / fail closed.
> - **Owner decision (N9):** retail-profit revenue is now NET of customer refunds; stock returned to
>   Head Office is NOT credited against the supply bill (treated as fresh HO arrival).
> - **R3 (4 fixes):** valuation now binds to the SERVER transfer records, not client-editable row
>   fields — a delivery relabelled to a peer store (previously free stock), a row billed to the wrong
>   store or for a product not in its transfer, and a row skipped via a mutated `type` are all now held.
>   Only CUSTOMER returns net revenue. A "corrected" bad-version row must actually be present to
>   finalize. An in-build regression (pre-epoch legacy transfers) was caught by the proof suite + fixed.
> - **Current gate numbers are in "Required checks" below** — they supersede any earlier pack.
> A FRESH reviewer can ignore this banner and read the whole pack normally.

**Context.** You are reviewing the OS-W4.4 build for our own internal stock-management app (ordinary
pre-release QA; the reviewers and the engineer all work for the owner — no third party, no
security-testing intent). It implements the specification you froze at R25
(`AZURE-CHUNK-ORG-W4.4-EXPORT-SCOPE.md`, "the ledger is mathematically sealed" — ALL FOUR W4 parts
locked). This wave builds the PURE settlement engine + its proof suite; the HTTP route + Logic App
wiring are staging-apply items per the spec's own split.

What the engine is: when a franchise store is bought back, `buildBuybackExport()` computes the
ex-franchisee's settlement for the closed era `[from,to)` — usage rows, HO-supply cost lines, and the
retail-profit summary — from ATTESTED INPUTS ONLY, refusing FINAL (or the whole export) itself when
the evidence doesn't prove what the route claims.

Branch `azure-phase-5-8-server`; review the LATEST commit. Work in your own copy; report findings only.

## Reviewer session hygiene (read FIRST — sessions have been interrupted before)
1. Name your own scripts/artifacts in neutral QA terms (`settlement-behaviour-check.js` — never words
   like unauthorized/exploit/probe/attack).
2. Do not print the mutation-harness source or raw comment blocks into the conversation — RUN the
   commands and read only their result lines; when inspecting source, strip comment lines first
   (`Get-Content <file> | Where-Object { $_ -notmatch '^\s*//' }`) and cite `file:line`.
3. Describe findings in plain engineering terms ("the row is billed without X", not attack language).
4. When cleaning up, only terminate processes running under your own copy folder.
5. If an automated filter interrupts you anyway, note WHERE you stopped in your report file first, so
   the next session resumes from a checkpoint.

## What was built (full detail + the engineer's honest notes: `AZURE-CHUNK-ORG-W44-AUDIT-RESPONSE.md`)
- **azure-functions/src/functions/buybackExport.js (NEW, ~450 lines):** the pure engine. Envelope +
  coverage/lease validation (P4), row validation + window binding (P2/P7), dual-identity dedup (P3),
  typed controls with the per-target-head FINAL comparison (P2/SR-151), the steps→item-stamp
  projection mirroring the client fold (P6 tier 2), the full W4.3 valuation precedence with tier-1
  authority BY PROVENANCE (SR-152/153/155), epoch provenance for stepless legacy rows (SR-129),
  BAD_VERSION derived-view coverage (SR-168/170), drain/presented-manifest accounting (SR-94/171),
  PROVISIONAL vs FINAL (P5), money policy (P7). Clock-free and RNG-free — identical inputs give an
  identical settlement.
- **azure-functions/src/functions/topology.js:** ONE additive line — `reqId` joins the export list
  (the engine imports it; no re-derivation). Zero behaviour change; topology suite unchanged 256/256.
- **test/buyback-export-proof.js (NEW):** 122 probes over the REAL required module — the spec's whole
  proof plan (window boundaries, wrong-store, pricing shape, coverage/lease/continuity, dedup
  conflicts, cross-list controls, head mismatches, supersede/withdraw head semantics, every valuation
  tier + its refusals, epoch corners, classification fixtures, PROVISIONAL/FINAL matrix, money
  rejects, determinism).
- **test/smoke-test.js:** FOUR new parity sentinels — S-283 (client `_readRowStamps` == engine
  `readTuple` verdict table), S-284 (client fold == engine item-stamp projection over shared step
  fixtures), S-285 (client invoice line valuation == engine cost-line valuation across all six VALID
  tier classes), S-286 (client lens chain == engine `rateAsOf` incl. tier source). 277/277.
- **test/saboteur-runner.js:** four matching mutations (S-283..S-286), each drifting the CLIENT half
  of a parity pair (the engine half is covered by the proof suite; the runner copies client files only).
- **test/anchor-scan.js (NEW, banked from the previously ad-hoc tool):** evaluates the runner's own
  MUTATIONS table and asserts every anchor still matches its file — 322/322.
- **NO client-file changes this wave** (index.html/sync.js/records.js/phase2.js/db.js untouched).

## Required checks (run them, don't just read) — CURRENT gate numbers
- `node test/buyback-export-proof.js` → **142/142** expected (this wave's core gate; 122 build + 4 R1 + 7 R2 + 2 N9 + 7 R3).
- `node test/topology-proof.js` → **256/256** expected (proves the additive export changed nothing).
- `cd test && node smoke-test.js` → **277/277** expected (S-283..S-286 are this wave's parity sentinels).
- Scoped mutation testing:
  `SABOTEUR_ONLY=S-283,S-284,S-285,S-286 SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js`
  → **4/4 detected** expected. (Scoped only — the full mutation sweep is the engineer's local gate,
  run at wave close.)
- `node test/anchor-scan.js` → **322/322** expected.
- `cd test && node static-check.js` and `node csp-check.js` → PASS.

## Focus areas
- The engineer's honest notes N1–N9 in the response doc — attack those first. In particular:
  N3 (the item tier also demands an attested minting step — an engineering extension of the tier-1
  rationale, not a spec pin), N7 (unstamped TRANSFERLESS rows take the lens with NO epoch assertion —
  the spec scopes the origin assertion to transfer-linked rows and the client does the same, but say
  so if you think the class is exploitable-in-effect), and N9 (the engine-defined
  usage/retail-profit aggregation formulas — D-OS-6 named the deliverable without pinning arithmetic).
- Input-shape definitions the spec left to the build (coverage/controls/drain/badVersionEvidence
  forms, documented in the engine header): is any check satisfiable by a malformed-but-shaped input?
- Parity completeness: the S-285 fixture set covers the six VALID tier classes; the malformed classes
  deliberately diverge (client surfaces STAMP_ERROR per line, engine refuses the export — stricter).
  Is any VALID class missing from the parity net?
- The frozen spec is the requirement; anything needing a SPEC change reopens W4.4's review — say so.
- Sentinel/mutation quality: does each mutation flip only via real behaviour?

## Verdict format
PASS / PASS-with-notes / BLOCK, numbered findings with concrete reproductions. The engineer
ground-truths every finding before acting on it.
