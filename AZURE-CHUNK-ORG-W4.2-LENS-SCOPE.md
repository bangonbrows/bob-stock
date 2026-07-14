# OS-W4.2 — CLIENT PRICING LENS · INVOICE REWIRE · CONFIG ADOPTION

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 client lens/invoice/adoption seam (split from the
frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-1, 2,
5, 10, 11, 15, 16(chain), 21, 22, 27, 29, 31→74, 42, 45(client view), 46/50/63/65(seed consumption), 49,
51→74, 52. **Review status:** R7 PENDING.

## The bug this kills (GAP-1)
`Pages._franchiseInvoiceData` (index.html:4758) prices EVERY invoice line — any historical range — from the
LIVE scalars (`office.franchiseDiscount`, `p.franchiseDiscount`, `p.price`). A Director editing a rate today
silently rewrites every PAST invoice. The lens gives every line its own date's rate.

## Pinned design

**P1 — the resolution chain (R4 model).** Canonical pricing key = the STORE id (offices carry their own
`'*'`). Chain, most-specific first: `billingStore[productId] → global[productId] → billingStore['*']`,
where billingStore = the row's own storeId. `[from,to)` exclusive. The store per-product tier is WRITER-LESS
until W5 (SR-23) — in the chain, validated, always uncovered. NO resolver map exists.

**P2 — validation before resolution (SR-22/42).** WHOLE-CONFIG schema+series validation FIRST (exact root
fields `{version, global, stores}`; reqId-safe keys; `global` = product keys only, no `'*'`; every series
`validPricingSeries` — imported semantics, parity-proven). Any deviation ⇒ the whole config is rejected at
adoption (prior config kept). After validation, a tier's null = genuinely uncovered ⇒ fall through; all
uncovered ⇒ NOT SET.

**P3 — fail-closed pins (SR-5/10/21).** The scalar fallback applies ONLY when NO pricing config was ever
served (pre-activation). Present-but-malformed, or an uncovered FRANCHISE billing key once any config
exists ⇒ PRICING DATA ERROR (0%, loud banner) — NEVER the scalar. At SUBMIT, a pricing error REJECTS the
HO→franchise commit (null is never stamped, W4.3's input).

**P4 — adoption lifecycle (SR-27/29/31/74).** Adoption is DURABLE + MONOTONIC (Dexie + `bob_pricing_ver`,
the accessPolicy pattern). `bob_pricing_activated` is set on FIRST observation of the pricing key
(before/regardless of validation); activated + nothing adoptable ⇒ fail closed. A newer-but-unadoptable
version ⇒ durable `pricing_stale`, judged by the **HORIZON RULE (SR-74)**: resolutions for row instants
STRICTLY BEFORE the device's durable `lastConfirmedCurrentAt` (advanced on every pull/config echo that
confirms the adopted version is the server's latest) remain valid; at/after ⇒ fail closed. Sound because of
the EFFECTIVE-NOW APPEND INVARIANT (LA §6): no post-activation writer backdates; the one-time seed lives
inside v1.

**P5 — dormant-device gate (SR-49).** Pricing-sensitive COMMITS (HO→franchise submit) require a FRESH
server pricing-state observation (bounded age): server says "no pricing config" ⇒ scalar path legitimate;
pricing served ⇒ adopted config required; no fresh observation ⇒ the commit HOLDS (W3 hold pattern). Local
absence alone never selects the scalar path.

**P6 — the invoice + every display (SR-1/2/15).** Invoice report + CSV resolve per-line rates via the lens
as-of each line's date; ALL text/% columns print the lens-resolved rate + source (live `p`/`office` objects
fully bypassed). `discMissing` becomes per-line-date. Views WITH a franchisee context use the lens for
"current"; generic global views (products CSV, catalogue editor) keep the dual-written scalar — coherent via
the server's atomic dual-write, and provably same-publication via `pricingVersion` riding master_data
(SR-52): a scalar whose pricingVersion trails the adopted history is treated as superseded (stale hint, not
a false parity failure).

**P7 — seed semantics the lens relies on (SR-46/50/63/65, runbook write, LA §6).** Per store, one `'*'`
interval PER FRANCHISE ERA (closed eras closed, open era open) at the seed-time scalar — the FROZEN-LEGACY
baseline (freezes exactly what today's app would bill; pre-activation scalar edits are pinned
unrecoverable). `global[productId]` seeded ONLY for legacy discounts > 0 (legacy 0 = inherit — never seeded
as an authoritative 0%). HO interludes uncovered by construction.

**P8 — writers (SR-6/16/23).** Post-activation, ALL THREE scalar writers (`_setProductFranDisc` →
`global[productId]`; the office-default editor → office `'*'` with server-side FAN-OUT to the franchisee's
retail stores, SR-45; `_doAddProduct` → initial `global[productId]`) route through the server (LA §6);
the client NEVER writes history locally. Pre-activation: exactly today's behaviour.

## Interfaces to other seams
- W4.1 produces planner-side series; the LENS ALGORITHM IS THE SERVER'S — the parity sentinel (S-W4-1)
  requires the REAL `topology.js` in the harness across the fixture matrix.
- W4.3 consumes P3's submit-reject and stamps from lens values; W4.4 re-implements the SAME chain
  engine-side (shared fixtures prove engine == lens).

## Sentinels (client seam)
S-W4-1 parity (real server module) · S-W4-2 retro-immunity (both % and $) · S-W4-3 fallback regression
(no-config ⇒ byte-identical to today) · S-W4-4 boundary `[from,to)` · S-W4-6 malformed ⇒ fail closed ·
S-W4-9 cache coherence via pricingVersion · S-W4-11 uncovered-franchise-key ⇒ fail closed · S-W4-16
dormant-device hold · S-W4-17 frozen baseline (incl. legacy-0 billing identical pre/post activation, multi-
era store) · S-W4-18 stale horizon (before-horizon stands; at/after blocked; reachable with the writer-less
store tier). Each sentinel gets its saboteur mutation.
