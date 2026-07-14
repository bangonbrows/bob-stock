# OS-W4.3 — COMMIT-TIME MONEY STAMPS · TRANSPORT · PRICING BASES

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 stamps/transport seam (split from the frozen
ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-3, 7, 12,
13, 18, 19→67, 20, 38, 39, 40, 58, 59, 60, 62→73, 66, 67 + R7 folds SR-84..89.
**Review status:** ✅ **FROZEN 2026-07-14 — BOTH AUDITORS PASS at R12** (AGY: "no fresh attack surface
remains viable"; Codex: "freeze candidate", strict projection verified against both-or-neither + money
validation). The spec is LOCKED; any future change reopens the part's review. Fold history: SR-97, 105,
106, 113, 114, 121, 128 (+ the R1-R6 ledger folds this doc consolidates).

## What stamps are for
The lens (W4.2) freezes the DISCOUNT per date; nothing freezes the PRICE (`p.price` is live — a price edit
still rewrites old invoices' dollars). Stamps freeze BOTH numbers on the row forever: `sellAtSupply` +
`discAtSupply`, written at COMMIT time (Kunal-confirmed W4-D1). Belt and braces with the lens.

## Pinned design

**P1 — capture (SR-3/7/12/21).** Stamps are captured at SUBMIT (the pricing-commitment moment — the durable
submit/dispatch transition, never draft creation) onto the transfer's item lines; direct delivery-category
HO-supply entries stamp at their own commit. A PRICING DATA ERROR at submit REJECTS the commit (null is
never stamped). The invoice PREFERS stamps; lens for legacy rows.

**P2 — one item, one basis (SR-67/84/88, amends SR-19).** The folded transfer ITEM carries a durable
canonical `basis`: `submit-stamped` (post-W4 submits) | `receive-stamped` (P4 below) | `legacy-lens`
(receive under pricing error/stale, or a receive step written by a pre-W4 build — see P3). EVERY
`transfer_in`-creating path — receive(), the discrepancy top-up, the remainder-return row, conflict
corrections, AND the in-transit CANCEL's return rows (SR-88; phase2.js:556) — inherits the ITEM's canonical
basis + stamps. **The PRIMARY receive step's stamps ARE the item stamps; every later unit of that item
inherits them regardless of when it lands (SR-84** — receive is once-per-transfer, F2-CRIT02; the
"remaining units" path is the resolve top-up, which inherits; duplicate receives are the P5 conflict
surface**).** One supply is never split across pricing bases. A conflicting later stamp = a P5 conflict,
never a silent switch.

**P3 — transport: stamps + basis ride EVERY channel (SR-13/18/20/38/40/58/86/87).**
- Step payloads: `Payload.items[].sellAtSupply/discAtSupply` **+ per-line `basis` (SR-86)** in submit +
  receive + resolve steps (phase2.js `_submitPayload`, records.js fold reconstruct). There are NO Transfers
  columns (deleted scaffold). **BASIS PRECEDENCE (SR-97, corrects the R7 absence rule):** a valid
  `submit-stamped` basis (stamps present on the submit step) is PERMANENT — nothing a later step omits can
  downgrade it. A receive step LACKING the basis field sets `legacy-lens` ONLY when the submit is ALSO
  stampless (both pre-W4 ⇒ genuinely legacy, deterministic everywhere). A stale pre-W4 RECEIVER of a
  W4-stamped submit therefore leaves the item submit-stamped; its unstamped `transfer_in` rows are handled
  by VALUATION PRECEDENCE (below) — no silent downgrade, no row mutation.
- **VALUATION PRECEDENCE (SR-97/114):** the invoice and the export value a transfer-linked row as: row
  stamps → the transfer ITEM's canonical stamps (via transferId lookup) → lens. An unstamped row created by
  a stale receiver of a stamped transfer bills at the SUBMIT stamps on every device, by construction — the
  one-item-one-basis invariant holds at valuation without repairing synced rows. **CROSS-SEAM CONTRACT
  (SR-114):** the export engine CANNOT skip the middle tier — W4.4's signature gains a `steps` input
  (the RecordSteps rows for the window's transferIds, enumeration-attested) and derives the item-stamp
  projection with the SAME fold precedence as the client (shared fixtures prove client fold == engine
  projection). Client invoice and server settlement value the same row identically, always.
- **BACKFILL + FOLD ENUMERATION (SR-87/105):** the backfill snapshot already embeds the whole record; the
  FOLD reconstruct's item enumeration (records.js:321) and `_applyReceive`/`_applyResolve` map stamps + basis
  explicitly (today they drop unlisted fields). **The content hash becomes a CANONICAL DEEP hash (SR-105):**
  the current `_stableHash` passes `Object.keys(obj).sort()` as a stringify REPLACER, which drops
  nested-object fields at EVERY level — item stamps, and TODAY even item content, are invisible to it
  (⚠ LATENT PRE-EXISTING CHUNK-4 BUG: backfill divergence detection has been blind to item-level
  differences since D4-I — two transfers differing only inside `items[]` hash identically and the second
  silently 409-converges, first-writer-wins, the exact behaviour D4-I was built to prevent; flagged
  Kunal-visible, fixed here with its own sentinel + re-verification). W4.3 replaces it with a recursive
  sorted-key serializer; divergent-stamp (or divergent-item) backfills then surface via hash-in-id.
  **MIGRATION SEMANTICS (SR-113/121):** historical backfill steps carry old-algorithm hashes in their
  stepIds; new steps carry the deep hash (version-prefixed, `payload.hashVersion`). The two algorithms'
  outputs must NEVER be compared as divergence evidence: the fold decides backfill divergence by RECOMPUTING
  the deep hash over a **VERSION-NORMALIZED SEMANTIC CANONICAL FORM (SR-121)** of each snapshot — the
  canonicalizer materializes every snapshot to the pinned W4 shape via the SAME fold/default rules before
  hashing (legacy field ABSENCE maps to the exact W4 defaults, e.g. a stampless legacy item gains
  `basis:'legacy-lens'`; explicit-null vs absent collapse to one form) — so a pre-W4 snapshot and a W4
  snapshot of the SAME economic reality hash IDENTICALLY, while meaningful stamp/basis differences are
  PRESERVED and still conflict. Shared fixtures include the cross-version same-reality pair and a
  genuinely-divergent-stamps pair. **STRICT PROJECTION + VERSION OBLIGATION (SR-128):** the v4 canonicalizer
  additionally performs strict SCHEMA PROJECTION — keys unknown to the pinned W4 schema are STRIPPED before
  hashing — so a down-level device folding a FUTURE-version snapshot of the same economic reality still
  converges (a W5 `taxRate` field cannot falsely diverge a W4 fold). Pinned obligation for every future
  schema change (per Codex's R11 note): introduce a NEW immutable canonical-form version + extend the shared
  fixtures — never mutate the W4 form. The embedded hash remains only the stepId dedup mechanism. (Nothing
  re-validates payload against the id hash — AGY's R9 "bricking" mechanism doesn't exist in the code; the
  real failures were Codex's cross-version false divergence, records.js:292, and the R10 schema-evolution
  variant both auditors found.)
- **BACKFILL DIVERGENCE RESOLUTION (SR-106):** the resolve payload gains `resolvesBackfillHashes` — a
  resolve that names the divergent hashes SETTLES them: the fold's divergence check (records.js:292-296)
  excludes covered hashes (mirroring `resolvesAttemptIds`), so a Director-resolved backfill divergence
  actually CONVERGES instead of re-flagging forever (also a pre-existing gap for qty divergences —
  same fix covers both).
- Row sync both directions: `SellAtSupply`/`DiscAtSupply` in `_toSharePoint`/`_fromSharePoint` + ingest
  validation; SharePoint columns on StockTransactions AND StockTransactions_Archive; `_fromArchive` maps
  them (archived rows round-trip stamps bit-exact).
- ALSO carried (the export's inputs): `UnitPriceAtTime` (K4), `StockFromStoreId`/`StockToStoreId`, and the
  `StockFrom`/`StockTo` TEXT labels (bounded strings — the ACTUAL sale-vs-wastage classification inputs;
  store-id fields are null for manual movements, index.html:2090-2093).

**P4 — stamp-at-receive for stampless submits (SR-59/60; replaces the DELETED SR-41 migration).** A W4-build
receive of a transfer whose submit step carries NO stamps mints them at receive: `discAtSupply` = lens as-of
the transfer's SUBMIT timestamp (pre-activation dates ⇒ the frozen baseline — deterministic);
`sellAtSupply` = the current catalogue price at receive (exactly what today's system would bill, then frozen).
Published via the receive step (immutable steps — no step is ever mutated or replayed; any future stamp
repair must be a NEW audited step type). Lens failure ⇒ both-or-neither ⇒ the item's basis = `legacy-lens`,
durably. Covers the whole class: in-transit at cutover AND stampless submits from stale PWA builds after.

**P5 — conflict identity includes money, and the RESOLVE carries the pinned stamps (SR-66/85).** The
receive-step summary + `_detectReceiveConflict` identity extend beyond `receivedQty` to the financial
payload (per-line stamps + basis): equal quantities with DIFFERING stamps ⇒ a D4-F CONFLICT — billing is
never sync-order-dependent. **The resolve step's `resolutions[]` gains per-line `{sellAtSupply,
discAtSupply, basis}` (SR-85** — the current payload, phase2.js:497, carries only qty/attempts/keys**);
`_applyResolve` writes the chosen stamps into item state, so the pinned outcome actually PUBLISHES
cross-device; the conflict-resolution UI presents stamp disagreement exactly like qty disagreement.**

**P6 — validation (SR-39/62/73/89).** BOTH-OR-NEITHER at ingest AND in the engine/invoice (one stamp without
the other = malformed row: rejected at ingest, fail-closed line client-side; legacy = neither). Money
policy, ONE canonical pin at EVERY surface: JSON NUMBER type (strings rejected — no `Number()` coercion),
finite, ≥ 0, ≤ 1,000,000 (the client `Validate.MONEY_MAX`), ≤ 2dp (reject). **`DiscAtSupply` = number,
0–100, AND ≤ 2dp at every surface (SR-89** — `validRate` alone accepts 12.345; the STAMP field gets the 2dp
cap; the W2 pricing-series validator is untouched — series writers are integer-option editors**).** Shared
parity fixture matrix proves client/ingest/engine verdict-identical. (The pre-existing
`badMoney`↔`Validate.money` divergence on Chunk-4 delivery costs is out of scope, flagged in LA §6.)

## Interfaces to other seams
- W4.2 supplies lens values at submit/receive and the submit-reject rule; the invoice's stamp-preference
  order is pinned there (stamps → lens → fail-closed surfacing).
- W4.4 consumes stamped rows + `UnitPriceAtTime` + the text labels; its both-or-neither + money validation
  must be THIS doc's rules (shared fixtures).
- Cutover: NO migration exists. The pricing-change route may enable immediately at activation; stampless
  in-transit transfers are handled by P4 at their receive.

## R11 fold record (2026-07-14) — Codex PASS · AGY×1 folded
| # | Finding | Fold |
|---|---|---|
| **W4-SR-128** | AGY R11-1 (P1): a W4 device folding a W5 snapshot (new field, e.g. taxRate) falsely diverges — the canonicalizer default-maps legacy ABSENCE but doesn't strip UNKNOWN future fields. Codex PASSed W4.3 with the aligned note that future fields are a new-canonical-version obligation | P3: strict schema projection (unknown keys stripped for divergence hashing) + the pinned version obligation (new immutable canonical-form version + fixture extension per schema change; never mutate the W4 form) |

## R10 fold record (2026-07-14) — 2 distinct (both converged pairs), both REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-121** | AGY R10-1 + Codex R10-1 (CONVERGED, P1): recomputing raw snapshot content still falsely diverges ACROSS SCHEMA VERSIONS — a W4 device's snapshot carries the injected basis/stamp fields a pre-W4 snapshot of the same reality lacks | P3: a versioned SEMANTIC CANONICALIZER materializes every snapshot to the pinned W4 shape (same fold/default rules) before hashing; same reality ⇒ same hash; meaningful differences preserved |
| **W4-SR-122** | AGY R10-2 + Codex R10-2 (CONVERGED, P1; blocks W4.4 too): the export's item-stamp projection can't distinguish a GENUINELY LEGACY transfer from a LOST/UNINGESTED step (ledger and steps push separately, ledger first — a grace flush can commit rows while its steps push fails); silent lens fallback ⇒ invoice/settlement divergence | W4.4 P6: ORIGIN ASSERTION — every transfer-linked economic row must project a valid origin (submit or backfill step); steps-present-but-no-origin ⇒ fail closed; NO steps at all ⇒ legacy ONLY if the row predates the Chunk-4 steps epoch (server-known cutover id), else fail closed; grace records BIND the expected stepIds of the flushing device so drain proves step ingest, not just row ingest. Projection suite gains the backfill-only case |

## R9 fold record (2026-07-14) — 2 distinct (both converged pairs), both REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-113** | AGY R9-2 + Codex R9-2 (CONVERGED, P1): the hash-algorithm change makes an old-hash backfill and a NEW-hash backfill of IDENTICAL content read as divergence (records.js:292 compares embedded hash strings). AGY's specific "re-hash validation bricks the fold" mechanism does NOT exist in the code — Codex's cross-version false-divergence does | P3: hash versioning + divergence decided on RECOMPUTED canonical content over the snapshots; embedded hashes are dedup-only |
| **W4-SR-114** | AGY R9-3 + Codex R9-1 (CONVERGED, P1): R8's valuation precedence handed the export engine a middle tier it physically cannot compute — no transfer items in its signature; client invoice and server settlement would bill the SAME row differently (my R8 fold created this interface break) | P3 here + W4.4 P1/P6: engine gains attested `steps` input + a shared-precedence item-stamp projection; parity fixtures client fold == engine projection |

## R8 fold record (2026-07-14) — 3 distinct, all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-97** | AGY R8-1 + Codex R8-1 (CONVERGED, P1): the R7 basis-absence rule let a PRE-W4 receiver silently DOWNGRADE a valid W4 submit-stamped item to legacy-lens — my fold error, both auditors caught it | P3: basis PRECEDENCE (submit-stamped is permanent; absence sets legacy-lens only when the submit is also stampless) + VALUATION PRECEDENCE (row stamps → item stamps → lens) so the stale receiver's unstamped rows still bill at submit stamps with no row mutation |
| **W4-SR-105** | Codex R8-2 (P1): `_stableHash` (records.js:611) passes top-level keys as a stringify replacer — nested item fields are dropped at every level; $100 vs $150 item stamps hash identically (Codex ran the probe). REAL — and a LATENT PRE-EXISTING Chunk-4 bug: backfill divergence has been blind to item-level diffs since D4-I | canonical recursive sorted-key serializer replaces the replacer trick; own sentinel + re-verification of the D4-I divergence behaviour; flagged Kunal-visible as a pre-existing-surface fix |
| **W4-SR-106** | Codex R8-3 (P1): a detected backfill divergence can never converge — the divergence check re-flags on every fold and the resolve payload cannot name backfill hashes. REAL (records.js:292-296 unconditional; pre-existing for qty divergences too) | resolve payload gains `resolvesBackfillHashes`; the divergence check excludes covered hashes (the `resolvesAttemptIds` pattern) |

## R7 fold record (2026-07-14)
| # | Finding | Ground truth → fold |
|---|---|---|
| **W4-SR-84** | AGY R7-1 (P1): two partial receives at different prices fracture the item basis | **ALREADY COVERED** — receive is once-per-transfer (double-receive guard F2-CRIT02); the "remaining units" arrive via the resolve top-up, which SR-67 already pins to inherit the item basis; genuine duplicate receives are the SR-66 conflict. Fold: P2 text tightened ("the PRIMARY receive step's stamps ARE the item stamps") + AGY's exact repro added as a sentinel |
| **W4-SR-85** | Codex R7-1 (P1): the resolve payload (phase2.js:497) carries no stamps — a resolved conflict can't publish its pinned outcome; billing stays device-order-dependent after "resolution". REAL | P5: `resolutions[]` gains per-line `{sellAtSupply, discAtSupply, basis}`; `_applyResolve` writes them into item state; UI surfaces stamp disagreement |
| **W4-SR-86** | Codex R7-2 (P1): the basis marker had no transport contract — "legacy-lens chosen" vs "awaiting stamp-at-receive" indistinguishable cross-device. REAL | P3: per-line `basis` field in submit/receive/resolve payloads + fold mapping; a receive step WITHOUT the field ⇒ basis = `legacy-lens` durably (deterministic everywhere) |
| **W4-SR-87** | Codex R7-3 (P1): backfill/fold enumeration drops stamps (snapshot embeds the record but the fold's item enumeration, records.js:321, rebuilds without them). REAL | P3: fold reconstruct + `_applyReceive`/`_applyResolve` map stamps+basis; backfill hash covers them (divergence surfaces via hash-in-id) |
| **W4-SR-88** | Codex R7-4 (P2): the in-transit CANCEL creates `transfer_in` return rows (phase2.js:556) outside the "every path" list. REAL | P2: cancel-return rows inherit the item's canonical basis/stamps (they reverse the submit deduction at the same value; the cancelling device derives them from folded item state) |
| **W4-SR-89** | Codex R7-5 (P1): `validRate` accepts 12.345 — ingest vs canonical-fixture verdicts diverge on DiscAtSupply precision. REAL | P6: DiscAtSupply = 0–100 AND ≤2dp at every surface; LA §6 aligned; W2 series validator untouched |

## Sentinels (stamps seam)
S-W4-7 draft-before/commit-after (stamp = commit-day; uses Codex's submit→change→receive repro; received
row carries submit-day stamps) · S-W4-12 sync round-trip bit-exact · S-W4-10(part) archived-shape round-trip
· top-up/remainder/correction/CANCEL-return rows inherit the item basis (legacy receive→top-up shares
receive stamps; error-basis receive→top-up stays legacy on both; AGY's partial-receive-then-price-change
repro, SR-84) · S-W4-20 stamp-at-receive (later price/discount edit leaves the received line bit-stable) ·
equal-qty different-stamp receives ⇒ conflict AND the resolve publishes the pinned stamps cross-device
(SR-85) · basis-less receive step folds as legacy-lens ONLY on a stampless submit; a stamped submit
survives a pre-W4 receive and its unstamped rows VALUE at the submit stamps (SR-97) · backfill round-trip
preserves stamps+basis (SR-87) · the deep hash distinguishes item-level divergence ($100 vs $150 stamps ⇒
distinct hashes ⇒ surfaced conflict) and a resolve naming the hashes CONVERGES the record (SR-105/106) ·
both-or-neither + money-policy rejects (1e308, string '1e3', 3dp incl. DiscAtSupply 12.345, >1M). Each with
its saboteur mutation.
