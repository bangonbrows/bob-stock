# OS-W4.2 — CLIENT PRICING LENS · INVOICE REWIRE · CONFIG ADOPTION

**Authority:** CONSOLIDATED, AUTHORITATIVE spec for the W4 client lens/invoice/adoption seam (split from the
frozen ledger `AZURE-CHUNK-ORG-W4-SCOPE.md` after R6; on conflict, THIS doc governs). Carries: W4-SR-1, 2,
5, 10, 11, 15, 16(chain), 21, 22, 27, 29, 31→74, 42, 45(client view), 46/50/63/65(seed consumption), 49,
51→74, 52 + R7 folds SR-80..83.
**Review status:** R10 FOLDED (Codex PASS — incl. verifying time-shift invariance and the ≥T granularity
relation; AGY BLOCK×1 → REAL, folded as SR-118). R11 PENDING — needs BOTH auditors PASS to freeze.

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

**P4 — adoption lifecycle (SR-27/29/31/74/80/81).** Adoption is DURABLE + MONOTONIC (Dexie +
`bob_pricing_ver`, the accessPolicy pattern). `bob_pricing_activated` is set on FIRST observation of the
pricing key (before/regardless of validation); activated + nothing adoptable ⇒ fail closed. A
newer-but-unadoptable version ⇒ durable `pricing_stale`, judged by the **HORIZON RULE (SR-74)**: resolutions
for row instants STRICTLY BEFORE the device's durable `lastConfirmedCurrentAt` remain valid; at/after ⇒ fail
closed. Sound because of the EFFECTIVE-NOW APPEND INVARIANT (LA §6): no post-activation writer backdates;
the one-time seed lives inside v1. **The horizon advances ONLY on SETTLED echoes (SR-80/102):** the version echo
carries `settled: true` only when NO pending pricing/topology journal (whose delayed publication could carry
an earlier effective boundary) exists — an unsettled echo confirms nothing. **RACE-FREE ORDERING from ONE time authority (SR-102/112):**
LA execution clocks are NEVER a boundary source (an LA can capture "now", stall, and write late — its
boundary would predate a settled echo issued in the gap; independent LA clock skew does the same). Pinned
mechanism: (a) every journaled interval's effective `from` = the RESERVATION's DATA-STORE-assigned write
timestamp (the claims-registry/journal row's server timestamp), finalized in two phases — plan first to
derive claims (boundaries provisional), reserve, then FINALIZE boundaries with the reservation row's
timestamp (re-invoking the pure planner with that instant as nowMs); (b) the settled echo's instant T is
derived from the SAME store's read — the claims registry's last-modified as observed by the check; and
(c) **`settled` requires NO ACTIVE CLAIMS in the registry (SR-118)** — a claim IS a reservation whose
boundary equals its own claim timestamp, which can be EARLIER than the registry's current last-modified (a
later non-overlapping claim advances it); pending-journal absence alone therefore proves nothing while any
claim is live. With claim TTLs (W4.1 SR-117), a crashed claim cannot hold `settled` false forever; brief
unsettled windows during topology/pricing operations are harmless (the echo still serves data — the horizon
simply doesn't advance). Any reservation landing after the check modifies the registry, so every boundary
it publishes is `>= T` — and equality is SAFE because the horizon admits only row instants STRICTLY before
T (Codex R10 note: the necessary relation is `>= T`, not `> T`). One clock (the data store's), one
ordering, no LA clocks anywhere in the proof.
**Trusted time (SR-81):** `lastConfirmedCurrentAt` stores the SERVER-issued instant carried in the settled
echo — never the device clock. (Row instants remain device-minted; a backdated row is the pre-existing
date-integrity class, unchanged by W4 — a FUTURE-clocked row lands at/after the horizon and fails closed,
the safe direction.)

**P5 — dormant-device gate (SR-49/81/103).** Pricing-sensitive COMMITS (HO→franchise submit) require a FRESH
server pricing-state observation: server says "no pricing config" ⇒ scalar path legitimate; pricing served ⇒
adopted config required; no fresh observation ⇒ the commit HOLDS (W3 hold pattern). Local absence alone
never selects the scalar path. **Freshness is EVENT-BOUNDED (SR-81/103), still no clock arithmetic:**
"fresh" = a settled echo observed SINCE the most recent invalidating event — page load/reload, tab
visibility RESUME (a sleeping tab wakes stale), network RECONNECT, and leader-tab handoff all INVALIDATE the
freshness fact; the commit path additionally requires the sync layer's connection state to be currently
healthy. A tab that slept from Monday to Friday must re-observe before it can commit.

**P5b — backup/restore (SR-104).** Pricing adoption state (adopted config, versions, activation flag, stale
state, held leading-scalar overlays) is EXCLUDED from backup exports (the accessPolicy scrub pattern — it is
server truth, re-fetched). RESTORE writes a durable `pricing_unresolved` marker: until the first successful
config fetch resolves the true state, pricing-sensitive commits are HELD (the P5 gate) and pricing-derived
report surfaces show a "sync required" state — a restored device can never treat an exported scalar as
pre-activation truth or resurrect a stale hold overlay.

**P6 — the invoice + every display (SR-1/2/15).** Invoice report + CSV resolve per-line rates via the lens
as-of each line's date; ALL text/% columns print the lens-resolved rate + source (live `p`/`office` objects
fully bypassed). `discMissing` becomes per-line-date. Views WITH a franchisee context use the lens for
"current"; generic global views (products CSV, catalogue editor) keep the dual-written scalar — coherent via
the server's atomic dual-write, and provably same-publication via `pricingVersion` riding master_data
(SR-52). **Coherence is EXACT-EQUALITY, both directions (SR-82):** a scalar whose pricingVersion TRAILS the
adopted history is superseded (stale hint, not a false parity failure); a master_data whose pricingVersion
LEADS the adopted config has its franchise-discount scalar fields HELD (the rest of the catalogue applies
normally) and triggers an immediate config fetch — no window where generic and contextual views disagree.

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

## R10 fold record (2026-07-14) — Codex PASS · AGY×1 REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-118** | AGY R10-1 (P1): a STALLED claim (reservation made, journal not yet written) is invisible to the pending-journal check, while a later non-overlapping claim advances the registry's last-modified — the echo emits settled with T PAST the stalled claim's boundary, breaking the horizon | P4: `settled` additionally requires NO ACTIVE CLAIMS in the registry; claim TTLs (SR-117) bound the unsettled window. Also folded: Codex's R10 granularity note — the proof relation is boundary `>= T`, safe because the horizon admits strictly-before-T only |

## R9 fold record (2026-07-14) — one CONVERGED finding
| # | Finding | Fold |
|---|---|---|
| **W4-SR-112** | AGY R9-1 + Codex R9-1 (CONVERGED, P1): the R8 "from = reservation instant" pin was anchored to LA execution time — a stalled LA (or the planner's pre-reservation nowMs, or inter-LA clock skew) publishes a boundary EARLIER than a settled echo issued in the gap, breaking the horizon proof | P4: boundaries take the DATA STORE's write timestamp (two-phase: plan→reserve→finalize boundaries with the reservation row's server timestamp); the echo instant T derives from the SAME store's claims-registry read at check time — reservation-after-check necessarily publishes boundaries > T. One time authority end to end |

## R8 fold record (2026-07-14) — AGY PASS · Codex×3 all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-102** | Codex R8-1 (P1): a reservation landing between the pending-journal check and the echo emission lets `settled:true` advance the horizon past a boundary v-next will publish | P4: instant captured BEFORE the journal check + a journaled interval's `from` = its reservation instant ⇒ post-check reservations only affect times > the echoed instant. Ordering, not locking |
| **W4-SR-103** | Codex R8-2 (P1): "observed this session" is unbounded — a tab sleeping Monday→Friday keeps a stale freshness fact | P5: freshness invalidated by reload, visibility resume, reconnect, and tab handoff + healthy-connection requirement at commit. Event-based, still no device-clock arithmetic |
| **W4-SR-104** | Codex R8-3 (P1): the held leading-scalar overlay has no backup/restore representation — a restored device could treat an exported scalar as pre-activation truth | P5b: adoption state excluded from backup (AA scrub pattern); restore ⇒ durable `pricing_unresolved` ⇒ commits held + surfaces gated until the first config fetch |

## R7 fold record (2026-07-14) — AGY PASS · Codex×4 all REAL
| # | Finding | Fold |
|---|---|---|
| **W4-SR-80** | Codex R7-1 (P1): a pull between a pricing journal and its (crash-delayed) publication confirms "current" while an EARLIER effective boundary is still pending — the horizon admits rows v-next later reprices | P4: `settled` echoes only — the server sets `settled:true` only with no pending pricing/topology journal; the horizon advances on settled echoes exclusively (LA §2 amended) |
| **W4-SR-81** | Codex R7-2 (P1): horizon + freshness derived from the DEVICE clock are unsafe (future-clocked device admits years of rows under stale) | P4/P5: `lastConfirmedCurrentAt` = the SERVER-issued instant from the settled echo; dormant-gate freshness is SESSION-SCOPED (event fact, no clock arithmetic). Row-instant caveat documented (pre-existing date-integrity class; future-clocked rows fail SAFE) |
| **W4-SR-82** | Codex R7-3 (P1): a LEADING master_data (scalar v8 before config v8) breaks coherence in the direction SR-52 didn't cover | P6: exact-equality both directions — leading scalar fields HELD + immediate config fetch; trailing = superseded |
| **W4-SR-83** | Codex R7-4 (P2): LA §6 still carried the superseded SR-51 closed-tier stale text alongside the SR-74 horizon | LA §6 text corrected to the horizon rule (doc bug — fixed in this fold) |

## Sentinels (client seam)
S-W4-1 parity (real server module) · S-W4-2 retro-immunity (both % and $) · S-W4-3 fallback regression
(no-config ⇒ byte-identical to today) · S-W4-4 boundary `[from,to)` · S-W4-6 malformed ⇒ fail closed ·
S-W4-9 cache coherence via pricingVersion · S-W4-11 uncovered-franchise-key ⇒ fail closed · S-W4-16
dormant-device hold · S-W4-17 frozen baseline (incl. legacy-0 billing identical pre/post activation, multi-
era store) · S-W4-18 stale horizon (before-horizon stands; at/after blocked; reachable with the writer-less
store tier; UNSETTLED echo does NOT advance the horizon; horizon stores the server instant, not the device
clock; leading master_data holds the scalar fields). Each sentinel gets its saboteur mutation.
