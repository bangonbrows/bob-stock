# REVIEW PACK — Franchise Pricing · SPEC REVIEW · ROUND 1

**Context.** Routine internal pre-release QA on our own stock-management app (Bang on Brows, a
six-salon beauty chain in Perth). Reviewers and engineer all work for the owner; this is our own
first-party code, reviewed before we build. **Nothing is deployed and no code has been written for
this piece of work.** This is a design review of a specification.

**Branch** `azure-phase-5-8-server`, commit **`fcbbd8e`** (pushed).

---

## THE ONE FACT THAT FRAMES EVERYTHING

**The dated-pricing engine already exists, is covered by tests, and is switched off.**

A previous internal handover document stated that no dated pricing history existed anywhere in the
app or the cloud functions. **That statement was wrong**, and it was inherited by several work
sessions before anyone checked. The engine is real: dated `{from, to, rate}` periods, resolution
as-of any date, strict schema validation, a staleness horizon, and a client/server parity check.
`test/topology-proof.js` passes 256 of 256.

So the review question is **not** "how should we build dated pricing" — that is built. It is:

- where should the rates be **stored**, given a schema that is validated identically on both sides,
- and what breaks when we **switch it on**.

If you find the specification restating the old error anywhere, that is a finding.

---

## The business problem

Head Office supplies stock to Cockburn, a franchise store trading today, at a discount off retail.
That discount is currently a single number with no record of when it applied, so changing it
silently recalculates every invoice ever produced. A second franchise conversion is expected around
September–October 2026.

The owner has decided the discount must have **three levels** — a store-wide rate, overridden by a
**product-type** rate, overridden by a per-product rate — and that all three must remain editable by
him from inside the app with no code change. The product-type level does not exist yet. Adding it is
the main new design work, and it changes a schema that both halves of the system validate.

---

## 1. WHAT TO READ, IN THIS ORDER

Exact paths, at commit `fcbbd8e`. Read them in this order.

1. **`AZURE-CHUNK-PRICING-SCOPE.md`** — the specification under review. Everything else is support.
2. **`index.html` lines 1162–1252** — the `Pricing` component: schema validation, as-of resolution,
   the three-step precedence chain at 1234–1236, and the commit gate at 1241–1251.
3. **`azure-functions/src/functions/topology.js`** — the server-side counterpart, especially
   `validPricingSeries` (line 94), `resolvePricingRate` (131), `resolvePricingForProduct` (149) and
   `appendPricingForKey` (177). `ID_RE` at line 31 is load-bearing for question 1.
4. **`phase2.js` lines 73–93** — the gate that can refuse a Head Office → franchise transfer.
5. **`index.html` lines 4908–4987** — the invoice: how it values a line, and which store id it uses.
6. **`sync.js` lines 482–546 and 584–615** — how a published configuration is adopted, and the
   client-side writer that currently has nowhere to send anything.

## 2. WHAT NOT TO READ

**These are the only files in scope.** Do not survey the repository. There are roughly 100 markdown
files at the root; nearly all are records of past moments and several contain statements that are no
longer true. Do not open other `AZURE-CHUNK-*` documents, and do not read the `audit-artifacts/`
folder — it is excluded from version control and you will not have it.

`REGISTER.md` exists and is current, but it is 800 KB. Use it only to look something up; do not read
it through.

## 3. WHERE GROUND TRUTH IS

**The code wins.** Where the specification and the code disagree, the code is correct and the
disagreement is the finding. This is not a formality — the framing error described above survived
because several documents agreed with each other and nobody opened the file.

Two claims in the specification were verified by running the real module rather than by reading. You
are welcome to re-run them:

```
node -e "const T=require('./azure-functions/src/functions/topology.js'); \
  ['type.pt_retail','type:pt_retail','pt_retail','*'].forEach(k=>console.log(k, T.reqId(k)))"
```

## 4. WHAT NOT TO RUN

- **`test/smoke-test.js`** — drives a real browser and takes several minutes.
- **the mutation-testing runners** (`test/saboteur-runner.js` and
  `audit-artifacts/check-gates-mutation.js`) — these deliberately introduce small faults into the
  working files to confirm the tests notice, and they spawn around 90 processes. It looks like a
  hang. Do not start either.

Fast and safe: `node test/topology-proof.js` (about a second, 256 checks). Skipping anything and
saying so plainly is the right choice.

---

## 5. THE QUESTIONS — two only, in order, one pass each

### Q1 — Where should a product-type rate live?

The configuration schema is validated strictly and **identically on both sides**: the root must be
exactly `{version, global, stores}` (`index.html:1189-1205`, mirrored in `topology.js`), and a parity
check runs the real server module against the app's copy so the two cannot drift apart.

Adding a product-type level changes that schema. Section 5 of the specification sets out two options
and recommends the second:

- **Option A** — a fourth root key, `types`.
- **Option B** — namespaced keys inside the existing per-store map, e.g. `type.pt_retail`, which the
  existing id rule already accepts on both sides, so no validator changes.

**Is the recommendation sound?** Specifically: does Option B keep the parity check meaningful, and
does it leave the schema validator able to reject a malformed configuration as strictly as it does
today? If you prefer Option A, say what makes changing the root shape worth it.

### Q2 — The two-key problem

The submit gate calls `Pricing.commitGate(toStoreId)` with the **destination store** (`cockburn`),
while the invoice resolves against the **franchise office** (`cockburn_office`). Resolution fails
**closed** for an uncovered franchise store: once any configuration exists, a store marked as a
franchise that the configuration does not cover returns an error rather than falling back
(`index.html:1230`).

So a configuration covering the office but not the shop would stop staff receiving Head Office stock
into the Cockburn shop entirely.

**Is a publish-time completeness check sufficient**, or should the gate resolve through the franchise
office instead of the destination store? **Is there a third case neither of us has considered** — a
franchise store with no office, an office serving two stores, or a store that changes ownership
mid-period?

*(Two further questions — the flexibility acceptance test, and the safe order of switching this on
given a related gate — are deliberately held for round 2. Please do not attempt them.)*

---

## 6. TIME BOX

**Stop at about 90 minutes and report what you have.** A partial answer at a checkpoint is worth more
than a complete one tomorrow. If you only get through Q1, say so and stop.

## 7. VERDICT FORMAT

For each question: **PASS**, **PASS WITH NOTES**, or **BLOCK**, then the reasoning. For every
specific finding give the file and line, what is wrong, and what you would change. Please state
plainly which of your findings you verified by reading or running, and which are judgement.

If you believe the specification is sound, say so plainly — a clean pass is a useful result and we
would rather have that than a manufactured concern.

## 8. SESSION HYGIENE

- Work from **your own copy** of the repository at commit `fcbbd8e`, never a shared working tree.
- **Report only. Do not edit any file**, including to demonstrate a fix — describe it instead.
- Nothing here is deployed; there is no environment to be careful of.
