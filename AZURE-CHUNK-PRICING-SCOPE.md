# Franchise Pricing — Scope

**Status:** SPEC, for design review. **No code has been written.**
**Written 2026-08-02.** Branch `azure-phase-5-8-server`.
**Reviewers:** Codex and Antigravity, both receiving this same complete document.

---

## 1. The problem, in one paragraph

Bang on Brows supplies stock from its Head Office warehouse to Cockburn, a franchise store
trading today. Cockburn is invoiced for that stock at a discount off retail. **Today that
discount is a single current number with no record of when it applied.** Change it and every
invoice ever produced silently recalculates at the new rate. The business cannot answer "what did
we bill Cockburn in March" once the rate moves, and a rate change quietly rewrites history.

A second franchise conversion (Southlands) is expected around September–October 2026, which will
make this worse, not better.

---

## 2. What already exists — verified by reading and running, not assumed

This section matters more than usual, because a previous handover document asserted that **no**
dated pricing history existed anywhere. That was wrong, and the error propagated across several
work sessions. What follows was verified on 2026-08-02.

| Capability | Where | Proven by | Switched on? |
|---|---|---|---|
| Dated rate resolution in the app — `{from, to, rate}` periods, resolved as-of any date | `index.html:1162-1252` (`Pricing`) | `test/smoke-test.js` S-261…S-275 | **No** |
| The same primitives on the server | `azure-functions/src/functions/topology.js` | `test/topology-proof.js` — **256 pass / 0 fail** | **No** |
| Config adoption: version-monotonic, durable, fails closed | `sync.js:482-546` (`_applyPricingConfig`) | S-272, S-273, S-274 | **No** |
| Freezing price + discount onto a transfer at the moment it is sent | `phase2.js:134-163` | S-276…S-284 | **No** |
| The invoice preferring frozen stamps over any live rate | `index.html:4908-4943` | S-106 and the stamp sentinels | **No** |
| A parity check binding the app's copy to the real server module | `test/smoke-test.js` S-261 | itself | runs at gate time only |

**The engine is built, tested and correct. It is switched off.** Nothing about this chunk is a
request to design a dated-pricing system — that exists. This chunk is about *storing*, *serving*
and *authoring* the data it needs.

### 2a. The precedence chain as built

`index.html:1234-1236` resolves in this order, first match wins:

1. `stores[storeId][productId]` — this store, this product → `store-override`
2. `global[productId]` — every store, this product → `global`
3. `stores[storeId]['*']` — this store, everything else → `store-default`

### 2b. The pattern the app already uses for dated history

**Cost history already works this way and is switched on.** `Stock.costAtDate(productId, date)`
(`index.html:1593-1599`) returns the most recent cost entry on or before a date, with a `+ Cost`
button and a `History` button on the Cost Management screen (`index.html:5258-5259`, `_addCostModal`
at `:5264`, `_viewCostHistory` at `:5301`).

**This is the single most important design input in this document.** Directors already understand
"add a new cost, see the history, old records keep their old cost". Franchise pricing should
present the same way. Modelling the new screens on the existing ones reduces both build risk and
training burden, and it means the register's training document can describe one concept rather
than two.

---

## 3. What is missing — verified

1. **Nothing writes a dated rate.** `topology.js` exposes `topologyPlan` and `topologyResolve` and
   both are pure calculators. `appendPricingInterval` / `appendPricingForKey` / `closePricing` are
   written and proven but have **no production caller**. The Function App serves 14 routes; none
   persists a rate.
2. **Nothing serves a rate.** `sync.js:718` looks for an AppConfig item named `pricing_config`.
   Nothing anywhere creates one, so `bob_pricing_activated` is never set and the lens never
   engages.
3. **There is no screen to set a store's franchise discount at all.** Cockburn's 25% is a
   hard-coded seed value. `_saveNewStore` always writes `null`; the edit-store form has no
   discount field. Only the *per-product* override is editable today.
4. **There is no product-type tier** — see §4, this is the main new design work.
5. **There is no screen to author a dated period.** Every discount control is a bare percentage.
6. **`publishPricingChange` (`sync.js:584-615`) is finished and wired to nothing** — it returns
   `no-endpoint` on every call because no URL is ever served for it.
7. **`editPricing` is not a server-side step-up purpose**, so a pricing route could not enforce a
   director check even if it existed.

### 3a. Blocker that is not ours but sits in front of us

`sync.js:64` ships the literal placeholder `CONFIG_URL: '%%CONFIG_URL%%'`; no CI step ever
substitutes it, and it is still unsubstituted on the live site (verified by fetching it
2026-08-02). `_fetchRemoteConfig` therefore returns `false` on every boot and **the cloud config
channel has never delivered anything to any device.**

Two consequences:

- Nothing in this chunk can work until that is fixed, because `pricing_config` arrives through
  that channel.
- **`Pricing.commitGate` (`index.html:1241-1251`) requires `Sync._pricingFresh === true`**, which
  is only ever set by a successful config fetch. On the day this branch ships, every Head Office →
  Cockburn transfer would be **refused at the submit button** with *"This device needs a fresh sync
  before sending stock to a franchise store"* (`phase2.js:73-93`). This is a shop-floor stoppage
  and it is independent of whether pricing is ever switched on. Tracked by
  `test/check-publish-safety.js` as a cutover obligation.

---

## 4. What the owner has decided (locked — do not re-open)

| # | Decision |
|---|---|
| D-P-1 | **Three tiers**: a store-wide rate, overridden by a **product-type** rate, overridden by a **per-product** rate. |
| D-P-2 | Setting the franchise discount must be available **when creating or editing a product type**. |
| D-P-3 | Cockburn: **Retail 50%**, Treatment / Cleaning / Stationery **25%**. |
| D-P-4 | **It must stay flexible.** Every tier, for every store, editable by the owner from inside the app, with no code change and no developer. Acceptance test: *the owner can add a new franchise store and set all its rates end-to-end without anyone touching code.* |
| D-P-5 | The entity invoiced is the **Franchise Office** (`cockburn_office`), not the shop floor. |

D-P-4 is emphatic and repeated. The failure mode to avoid is hard-coding today's simple shape
(one store rate plus one Retail override) as a special case.

### 4a. What D-P-3 means in practice

| Product type | Count | Rate |
|---|---|---|
| Treatment | 203 | 25% |
| Cleaning | 21 | 25% |
| Retail | 20 | **50%** |
| Stationery | 11 | 25% |

Only Retail differs. Encoded well, that is **one store rate of 25% plus one type override of 50%
for Retail** — two entries, not twenty. Encoded badly (per-product overrides on the 20 retail
items) a newly added Retail product silently inherits 25% and the franchisee is over-charged with
nobody noticing. **This is the concrete reason the type tier is worth building.**

---

## 5. The design decision that needs review

The config schema is validated **strictly and identically on both sides** — `validConfig`
(`index.html:1189-1205`) requires the root to be *exactly* `{version, global, stores}`, and
`topology.js` mirrors it. The parity sentinel S-261 runs the real server module against the app's
copy, so the two cannot drift. **Adding a type tier changes that schema.** Two candidate designs:

### Option A — a fourth root key

```
{ version, global, types: { <productTypeId>: [ {from,to,rate} ] }, stores }
```
Precedence: store+product → global product → **store+type → global type** → store default.

*For:* reads naturally; a type rate is genuinely a first-class concept.
*Against:* changes the root shape, so `validConfig` and its server mirror both change, and every
existing sentinel that asserts "exactly three root keys" must be revisited. Also ambiguous: should
a type rate be settable **per store** as well as globally? Cockburn's 50% Retail is store-specific,
so it probably must be.

### Option B — namespaced keys inside the existing store map

```
stores: { cockburn_office: { "*": [...], "type:pt_retail": [...], "MKU_1": [...] } }
```
Precedence: store+product → global product → **store+type** → store default.

*For:* **no root-schema change**; `validConfig`'s per-key series validation already applies; the
existing "exactly three root keys" assertions stay true; store-specific type rates fall out for
free.
*Against:* a magic key prefix; `_reqId` currently rejects `:` so the key format needs widening or
a different separator, and widening an id validator is exactly the kind of change this project has
previously refused to make casually.

**Recommendation: Option B with a separator that `_reqId` already permits.** This is not an
argument — it was checked by running the real server module on 2026-08-02:

```
type.pt_retail   reqId -> true      <- accepted as-is, no validator change
type:pt_retail   reqId -> false     <- would require widening the id validator
pt_retail        reqId -> true
*                reqId -> false     <- the existing store-default key stays special-cased
```

Both sides use the identical pattern `/^[A-Za-z0-9_.-]{1,64}$/` (`index.html:1164`,
`topology.js:31`), so `type.pt_retail` is already a legal key on the client and the server with
**no change to either validator**. Option B therefore delivers store-specific type rates without
touching the root schema and without loosening an id rule the whole server phase depends on.
**This is the primary question for review.**

---

## 6. Trap found during discovery — must be designed for, not discovered later

**The submit gate and the invoice resolve different keys.** `_pricingSubmitGate` (`phase2.js:73-93`)
calls `Pricing.commitGate(toStoreId)` with the **destination store** (`cockburn`), while the
invoice resolves against the **office** (`cockburn_office`, `index.html:4920-4987`).

`rateAsOf` fails **closed** for an uncovered franchise store: once any config exists, a store row
with `isFranchise: true` that the config does not cover returns `PRICING_DATA_ERROR`
(`index.html:1230`). So publishing a config that covers `cockburn_office` but not `cockburn`
**stops staff receiving Head Office stock into the Cockburn shop.**

Both keys must be covered, or the resolution must be redirected through the office. A
publish-time completeness check plus a sentinel is the minimum. **This is how switching pricing on
stops the shop floor, so it needs an explicit answer.**

---

## 7. Decisions only the owner can make

| # | Question | Why it must be answered before building |
|---|---|---|
| K-1 | **Can a past rate be corrected?** `appendPricingInterval` returns `PRICING_BACKDATE` if the new period starts before an existing boundary — today the model is *effective now, append-only, no backdating*. D-P-4 demands flexibility. Does that include fixing a rate that was wrong last month? | The two readings produce **different server contracts**. Building the wrong one wastes a wave. |
| K-2 | **What is Cockburn's starting date?** A dated history can only begin when it is switched on. Do we seed the current rates as effective from Cockburn's trading start, or from switch-on day? | Determines whether existing practice invoices reprice. The app has never been used, so the practical answer is probably "switch-on day" — but it should be stated, not assumed. |
| K-3 | **Who may change a rate?** Director only, or Head Office too? | Sets the permission and whether `editPricing` needs a step-up prompt. |

---

## 8. Questions for the reviewers

Numbered, bounded, one pass each. **Both reviewers get all of them.**

1. **§5 — Option A or Option B?** Is the recommendation (namespaced type keys inside the store map,
   using a separator the existing id validator already permits) sound? Specifically: does it keep
   the client/server parity sentinel meaningful, and does it leave `validConfig` able to reject a
   malformed config as strictly as it does today? If you prefer Option A, say what makes the root
   schema change worth it.

2. **§6 — the two-key trap.** Is a publish-time completeness check sufficient, or should
   `commitGate` resolve through the franchise office rather than the destination store? Is there a
   third case neither of us has considered — for example a franchise store with no office, or an
   office with two stores?

3. **§4 D-P-4 — flexibility.** Given the acceptance test (*the owner can add a new franchise store
   and set all its rates end-to-end with no code change*), does anything in §2's existing engine
   prevent it? Look particularly at whether `validConfig`'s strictness, the fail-closed behaviour
   at `index.html:1230`, and the version-monotonic adoption in `sync.js:482-546` combine to make a
   *first* publish for a *new* store awkward or unsafe.

4. **§3a — sequencing.** The config channel has never worked, and fixing it arms `commitGate`,
   which can block Head Office → franchise transfers. What is the safe order: fix the channel
   first and risk the gate, or land pricing data first? Is there an inert intermediate state where
   the channel works but the gate cannot refuse anything?

---

## 9. What would prove it

Nothing here is accepted on argument. Before this chunk can close:

- A sentinel driving `_fetchRemoteConfig` with a **realistic cloud response shape**, not a mock
  that only matches what the app expects. The existing pricing sentinels all feed the adopter
  directly or through a stubbed route, so the literal item name `pricing_config` and its payload
  encoding are currently **unverified against the real config Logic App**. This project has
  already been bitten by a mock that did not match the deployed server.
- A sentinel for the §6 two-key case, in both directions.
- A sentinel proving a **newly added Retail product inherits 50%** without anyone touching it —
  this is the money leak the type tier exists to close.
- A mutation test for each new sentinel — a deliberate small fault introduced to confirm the
  sentinel actually notices. A check never seen to fail is not a check.
- The `topology-proof` suite still at 256/256, and the client/server parity sentinel still green,
  after the schema change.
- A real end-to-end publish against the staging cloud — which requires staging to hold a **real
  franchise store**. It currently does not (see §10).

---

## 10. Dependency

**Staging does not contain Cockburn.** It holds credentials for `ardross` (a store that no longer
exists), `karrinyup`, `whitford`, `head_office`, a director, and an invented store called
`franchtest`. No franchise path has ever been exercised against a real franchise store, and the
entity that actually gets invoiced — `cockburn_office` — has no staging identity at all.

The end-to-end proof in §9 cannot be run until staging matches the business. That work is small
and is queued ahead of this chunk.

---

## 11. Out of scope

- The ownership-era work for Southlands — separate scope document, shares the `topology.js` module.
- The correction route (Contract 2) — parked.
- Expiry and batch tracking — separate scope document.
- Fixing `%%CONFIG_URL%%` — a cutover task tracked by `test/check-publish-safety.js`; noted here
  only because this chunk cannot be proven end-to-end until it is done.
