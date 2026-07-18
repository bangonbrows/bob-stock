# REVIEW PACK — Org-Structure chunk, W4.3 build (commit-time money stamps) — round 1

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
  `SABOTEUR_ONLY=S-276,S-277,S-278,S-278b,S-279,S-280,S-281,S-281b,S-282,S-282b,S-282c,S-262,S-150b,S-70,S-174,S-185
  SABOTEUR_CONCURRENCY=5 node test/saboteur-runner.js` → **16/16 detected** expected. (Scoped only —
  the full mutation sweep is the engineer's local gate.)
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
