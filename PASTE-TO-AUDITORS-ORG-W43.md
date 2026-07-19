# REVIEW PACK — Org-Structure chunk, W4.3 build (commit-time money stamps) — round 4

> ## ROUND 4 — re-review after the round-3 fix
> Round-3 verdicts: AGY PASS (all three round-2 fixes verified) · Codex ×1 REAL: a PARTIAL transfer-ITEM
> tuple (money without versions) still billed as "transfer-stamped", with four helper sites defaulting
> the missing versions to zero. Fixed: ONE shared `_fullTuple` predicate at every consumer — the full
> tuple is copied literally or nothing is (no version defaults anywhere in the codebase); the invoice
> fails a partial ITEM closed exactly like a partial row; stamp-at-receive treats a partial as malformed
> and re-mints honestly. Ledger: the Round 3 table in `AZURE-CHUNK-ORG-W43-AUDIT-RESPONSE.md`. The
> scoped command now lists **26 cases → 26/26 detected** expected; smoke stays **273/273**. This round:
> verify the fix + the standing question — can ANY partial authority tuple, at any level (row, item,
> payload, wire), survive as billable data or gain fabricated fields?

> ## ROUND 3 — re-review after the round-2 fixes
> Round-2 verdicts: AGY PASS (all eight round-1 fixes verified) · Codex ×3, all real residuals, all
> fixed: (1) the direct-log path now carries the FULL four-field tuple, sync egress never fabricates
> versions (all-four-or-unstamped), and the invoice fails a partial row tuple closed; (2) a
> transfer-linked row derives its invoice origin SOLELY from its transfer record — an absent record
> fails closed and self-heals on arrival (the rows-before-steps window is sealed); (3) an explicit
> `submittedAt` now records the true submit instant at both submit moments (carried in payloads, folded
> from the step's own timestamp for pre-W4 steps, excluded from canonical hashing) and stamp-at-receive
> uses it — a stale draft submitted across a rate change stamps the SUBMIT-era rate, proven with a
> three-era fixture. Ledger: the Round 2 table in `AZURE-CHUNK-ORG-W43-AUDIT-RESPONSE.md`. The scoped
> command now lists **25 cases → 25/25 detected** expected; smoke stays **273/273**. Also fixed: the
> engineer's full sweep no longer runs during audit rounds (it held the runner lock and blocked your
> round-2 scoped run — apologies; scoped runs are now uncontended).

> ## ROUND 2 — re-review after the round-1 fixes
> Round-1 verdicts: AGY ×4 + Codex ×4 — ALL EIGHT REAL (one converged pair), all fixed; AGY's fifth item
> (the `_stableHash` equivalence claim) was upheld as true. The full ground-truth ledger with per-finding
> fixes is the Round 1 table in `AZURE-CHUNK-ORG-W43-AUDIT-RESPONSE.md`. Headlines: the FULL four-field
> authority tuple ({sellAtSupply, discAtSupply, pricingVersion, catalogueVersion}, all-four-or-none) now
> rides every surface — capture, step payloads, fold, rows, archive, conflict identity, canonical hashing;
> BACKFILL-only item stamps are untrusted (server-resolved row fields or a loud "valuation pending sync"
> line); a priceless RETAIL product fails the submit closed; delivery/stocktake get real strict-projected
> canonical forms; transfer-linked rows derive their invoice origin from the transfer record (never the
> reason text); a stamped 0% is loud; basis-unset and chosen-legacy hash differently. Numbers below
> updated: smoke stays **273/273** (assertions strengthened in place); the scoped mutation command now
> lists **24 cases → 24/24 detected** expected. This round: verify each fix against its finding + any
> runtime-provable residual.

**Context.** You are reviewing the OS-W4.3 build for our own internal stock-management app (ordinary
pre-release QA; the reviewers and the engineer all work for the owner — no third party, no
security-testing intent). It implements the specification you froze (`AZURE-CHUNK-ORG-W4.3-STAMPS-SCOPE.md`,
FULLY LOCKED including both approved amendments). This is the wave that freezes BOTH money numbers
(sell price + discount) onto every franchise supply line at commit time — the lens (W4.2) froze the
discount; the stamps close the remaining path where a catalogue PRICE edit could rewrite an old
invoice's dollars.

Branch `azure-phase-5-8-server`; review the LATEST commit. Work in your own copy; report findings only.

## Reviewer session hygiene (read FIRST — sessions have been interrupted before)
1. Name your own scripts/artifacts in neutral QA terms (`stamp-behaviour-check.js` — never words like
   unauthorized/exploit/probe/attack).
2. Do not print the mutation-harness source or raw comment blocks into the conversation — RUN the
   commands and read only their result lines; when inspecting source, strip comment lines first
   (`Get-Content <file> | Where-Object { $_ -notmatch '^\s*//' }`) and cite `file:line`.
3. Describe findings in plain engineering terms ("the row ingests without X", not attack language).
4. When cleaning up, only terminate processes running under your own copy folder.
5. If an automated filter interrupts you anyway, note WHERE you stopped in your report file first, so
   the next session resumes from a checkpoint.

## What was built (full detail + the engineer's honest notes: `AZURE-CHUNK-ORG-W43-AUDIT-RESPONSE.md`)
- **phase2.js:** `_stampItems` (capture at both submit moments, billing-predicate-scoped, reject on
  pricing error/out-of-policy), `_stampAtReceive` (P4 — submit-instant rate, receive-day price,
  both-or-neither ⇒ durable legacy), `_stampTxns` (every transfer-linked row inherits),
  `_enrichResolutions` (the resolve publishes the pinned stamps), step payloads carry per-line
  stamps + basis.
- **records.js:** fold maps stamps/basis explicitly with BASIS PRECEDENCE (SR-97 — submit-stamped is
  permanent; a basis-less receive downgrades only a stampless submit); money-aware conflict identity
  (SR-66 — equal qty + differing stamps = conflict; absence is not a claim); the CANONICAL DEEP HASH
  (SR-105 recursive serializer — also fixes a pre-existing Chunk-4 blindness to item-level backfill
  divergence), the v4 version-normalized semantic canonical form (SR-121/128 — cross-version
  same-reality identity + strict future-field projection), `resolvesBackfillHashes` convergence (SR-106).
- **sync.js:** `SellAtSupply`/`DiscAtSupply` + `UnitPriceAtTime` + `StockFrom/To` ids and labels in
  both row maps + the archive map, with the ONE ingest pin (JSON number type, finite, sell ≤ 1M,
  disc 0-100, both ≤ 2dp, both-or-neither — violation rejects the row).
- **index.html:** invoice VALUATION PRECEDENCE (row stamps → transfer-item stamps → lens; one-sided =
  fail-closed line); the direct-log HO-supply path gates + stamps at its own commit.

## Required checks (run them, don't just read)
- `cd test && node smoke-test.js` → **273/273** expected (S-276..S-282 are this wave's).
- `node test/topology-proof.js` (repo root) → **256/256** expected (no server change this wave).
- Scoped mutation testing:
  `SABOTEUR_ONLY=S-276,S-276b,S-277,S-278,S-278b,S-278c,S-279,S-279b,S-280,S-280b,S-281,S-281b,S-281c,S-281d,S-281e,S-281g,S-282,S-282b,S-282c,S-282d,S-108,S-262,S-150b,S-70,S-174,S-185
  SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js` → **26/26 detected** expected. (Scoped only —
  the full mutation sweep is the engineer's local gate, run at wave close.)
- `cd test && node static-check.js` and `node csp-check.js` → PASS.

## Focus areas
- The five engineer's honest notes in the response doc (billing-predicate scope · NOT-SET-as-0 seam ·
  durable-legacy vs awaiting normalization · the generic canonicalizer branch for non-transfer types ·
  the `_stableHash` flat-input equivalence claim) — attack those first.
- The frozen spec is the requirement; anything needing a SPEC change reopens W4.3's review — say so.
- Sentinel/mutation quality: does each mutation flip only via real behaviour?

## Verdict format
PASS / PASS-with-notes / BLOCK, numbered findings with concrete reproductions. The engineer
ground-truths every finding before acting on it.
