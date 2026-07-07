# AZURE CHUNK 6 — Master-data publish + catalogue write (SCOPE)

**Date:** 2026-07-04 · **Status:** SCOPING — no build started. Chunks 4 + 5 on HOLD.
**Sources:** `SERVER-SIDE-REQUIREMENTS.md` item 3 (Gemini CRIT-01 upstream half), `AZURE-PHASE-SCOPE.md`
Chunk 6 + D3, client `Sync._applyMasterData` (Wave F3, already built+audited), `_doAddProduct`/`_commitSettings`.
**Process:** `AZURE-CHUNK-PROCESS.md` — this doc → Kunal's decisions → GPT+AGY spec audit → build on staging.

---

## 1. The problem

The "catalogue" = products, stores, categories, product-types (+ prices). Today a Director/HO edits it through
the app (gated by `editRefData`/`editPricing`), but the edit writes to that **device's local database only**.
There is **no upward path to the cloud and no cross-device propagation** — add a product on the office PC and
it never appears on a store phone (Gemini CRIT-01: "catalogue islands", verified live). Two missing halves:

1. **Publish (down) — the server half of a path whose client half already exists.** The client already merges
   a versioned `master_data` item from AppConfig on every launch (`Sync._applyMasterData`, Wave F3: upsert-only,
   version-gated, keeps local cost, proto/money-guarded, durable-rollback — DONE + audited). But **nothing keeps
   that `master_data` item current or bumps its version.** Chunk 6 builds the server side that (re)composes
   `master_data` from the authoritative catalogue and bumps `version` (monotonic) so devices pull it.

2. **Catalogue write (up) — brand new.** A Director device has no way to send a new/changed product, price, or
   store to the cloud. Chunk 6 adds a **Director-gated catalogue-write endpoint** (born gated on Chunk 5's
   Director key) that accepts catalogue changes and updates the server's authoritative catalogue, then
   (re)publishes.

**What already exists server-side:** the `AppConfig` SharePoint list holds `ConfigType` items — including
`products`, `stores`, `categories`, `productTypes` (JSON-blob catalogue) and `master_data` (the merged,
versioned item the client actually reads). There are **no dedicated Products/Stores SharePoint lists** on the
live site (confirmed by list enumeration) — the catalogue lives as AppConfig JSON blobs.

## 2. Scope

IN: the publish path + the catalogue-write endpoint + client wiring for the upward push (Director settings
"Publish catalogue" action and/or auto), all on **staging**; boundary validation on the write endpoint (reuse
the Chunk-2/`_applyMasterData` hygiene: safe ids, money policy, reserved-key/proto guards, name required).
OUT: no changes to the already-audited client `_applyMasterData` down-merge; no per-user auth (Chunk 9); live
untouched.

## 3. Design decisions

### D3 — Publish trigger (the one Kunal must pick)
- **(a) Manual "Publish catalogue" button** *(Claude lean, per AZURE-PHASE-SCOPE)* — a Director makes all their
  edits, then presses one button to push + publish. Predictable; the Director controls exactly when stores see
  changes; no half-finished edits leak. Con: a Director must remember to press it.
- **(b) Auto-publish on change** — every catalogue edit immediately pushes + bumps version. No button to forget.
  Con: every in-progress edit propagates instantly (a mistyped price is live company-wide until corrected); more
  server writes; harder to batch.
- *Recommendation: (a) manual first — you're the main editor, it's low-frequency, and "make my changes then
  publish" matches how you'd actually work. Add auto later if the button is a nuisance.*

### D-SOURCE — where the authoritative catalogue lives + the conflict model (design Q for the auditors)
The deeper design question. Two shapes:
- **(a) AppConfig JSON blobs as master** (least change): the write endpoint updates the `products`/`stores`/…
  ConfigType items; publish composes `master_data` from them + bumps version. Simple, matches today's storage.
  **Con:** a blob is written whole → two Directors editing offline = last-writer-wins on the ENTIRE catalogue
  (one clobbers the other's unrelated edits). Fine while you + Shahin rarely edit at once; risky otherwise.
- **(b) Per-row upsert** (whether into the blob by id, or into a real Products/Stores list): the write endpoint
  merges changed ROWS by id, so two Directors editing DIFFERENT products don't clobber each other. More work;
  needs an id-keyed merge server-side. **Con:** two Directors editing the SAME product still last-writer-wins
  (acceptable for catalogue — low frequency, few editors).
- *Claude lean: (b) per-row upsert into the AppConfig blobs (merge by id, not whole-blob replace) — avoids the
  worst clobber with minimal infra, no new lists. Ask auditors to confirm this is enough vs a real list.*

### D-COST — cost publishes centrally to CORPORATE stores, but franchisees keep their OWN cost (Kunal, 2026-07-05)
`_applyMasterData` deliberately KEEPS local `costPrice` unless the server sends one. **KEY BUSINESS RULE
(Kunal): a franchisee's cost differs from BOB's — they buy at the price HO charges them (or their own
suppliers), so a single company-wide cost is WRONG for franchise stores and must never overwrite their cost.**
Model:
- **Corporate/HO-owned stores** (isFranchise=false): share ONE central cost, published from a Director; keeps
  margins consistent across the stores BOB owns.
- **Franchisee stores** (isFranchise=true): keep their OWN device-local cost (set from their own
  deliveries/entries). The central publish **must NOT set or overwrite costPrice on a franchisee device.**
  (Their cost is private to them — aligns with Chunk 10 store-scoping.)
- Sell-price + catalogue metadata (name/category/type/active) publish to EVERYONE regardless of tier.
- Cost still only ever ORIGINATES from a Director write (no store device pushes cost up).
**Implementation sketch (for the auditors):** published master_data carries the central (HO) cost; a device
applies the cost field ONLY when its own store is corporate (isFranchise=false); a franchisee device ignores
the master_data cost and retains its local cost. The client already knows its own store + the franchise flag.
OPEN Qs for auditors: is "cost applies only on corporate devices" the right split, or should cost be omitted
from the shared blob entirely and pushed per-tier? Does a franchisee's cost derive from the HO→franchisee
transfer price (so it could be computed) or is it franchisee-entered (kept as-is)? Interaction with Chunk 10.

### D-VERSION — version authority
`master_data.version` must be monotonic and server-owned (a client must never mint it). The publish step
reads the current version and increments it server-side. *No decision needed — stated for the auditors.*

## 4. Build shape (once decisions land)
1. Catalogue-write Logic App (staging), **born gated on the Chunk-5 Director key** (store key alone → 401/deny;
   Director key required — catalogue edits are Director/HO, and the server can only enforce the Director class).
   Validates every row (safe id, name, money policy, reserved/proto guards) → per-row upsert into the AppConfig
   catalogue blobs → returns an honest accepted/rejected contract like Chunk 2.
2. Publish step: recompose the `master_data` item from the catalogue blobs, bump `version` monotonically. Under
   D3(a) this runs at the end of the write endpoint (or a separate "publish" call the button triggers).
3. Client: a Director-gated "Publish catalogue" action in Settings that pushes the device's catalogue changes to
   the write endpoint and reports the honest result; surfaces 401 like Chunk 5.
4. Sentinels + saboteurs (client push path + gate) + staging cloud probes (write→publish→pull round-trip;
   non-Director blocked; bad-row rejected; version bumps; two-editor different-product no-clobber).
5. Full sweep (Claude) → wave review → GPT+AGY code audit → fix → converge → HOLD.

## 5. Decisions summary
| # | Question | Position after spec-audit round 1 |
|---|---|---|
| D3 | Publish trigger | AGREE both — manual button + dirty-state/diff/last-published UX |
| D-SOURCE | Authoritative store + conflict model | AppConfig blobs OK, but NEEDS concurrency control + DELTA rows (§6.1) |
| D-COST | Franchise cost | COUNTER both — corporate cost OUT of shared blob, served separately gated (§6.2) |
| D-VERSION | Version authority | server-owned; ETag/If-Match or concurrency=1 (§6.1); client never submits |
| D-HOAUTH | Can the HO store key publish, or Director-only? | **Director-only for Chunk 6 (Kunal 2026-07-05)** — start tight; widening to the HO store key later is a small, reversible one-endpoint change (no data migration). Revisit if HO data-entry proves a hassle. |

## 6. Spec-audit round 1 (2026-07-05) — GPT + AGY, CONVERGED on the big items; adopted

### 6.1 D-SOURCE — concurrency + delta (both auditors; GPT's point is the stronger one). ADOPTED.
AppConfig JSON blobs are fine for alpha (no dedicated Products/Stores lists) BUT "merge by id" alone does NOT
prevent lost updates two ways:
- **Write race:** two publishes read blob vN, merge different rows, both write the whole JSON → last wins,
  dropping the first. Fix: **serialize** the write Logic App (`concurrency = 1`, AGY) AND/OR **ETag/If-Match**
  on the blob item, refetch-recompose-retry on 412 (GPT). Adopt both belt-and-suspenders: concurrency=1 +
  If-Match.
- **Stale-snapshot clobber (GPT — the subtle one):** a device publishing its FULL local catalogue snapshot
  overwrites unrelated newer rows even under serialization. Fix: the client pushes **only CHANGED rows**
  (deltas) with a `baseRowVersion`/`modifiedAt` per row; the server upserts by id and **rejects/conflicts an
  overlapping stale edit** (row's server version moved since baseRowVersion). Never publish a full stale blob.

### 6.2 D-COST — SERVER-SCOPED cost, corporate cost NOT in the shared blob (both auditors COUNTER). ADOPTED.
The Kunal business rule stands (franchisee cost ≠ corporate cost, never overwritten). BUT "franchisee client
ignores the cost field" is a **privacy LEAK**: a franchisee can read the raw shared master_data and extract
BOB's corporate costs/margins (violates Chunk 10 goals). Fix:
- **Omit `costPrice` from the shared/public catalogue entirely.** The public master_data carries sell-price +
  metadata only (goes to everyone).
- **Corporate cost served separately + gated** (e.g. a `corporate_costs` payload/endpoint) available ONLY to
  corporate/HO/Director credentials, NEVER to a franchisee store key. (Full auth-filtering lands with Chunk 10;
  for now the separate payload is gated by key class.)
- **Franchisee cost = franchisee-entered**, kept local; HO→franchisee transfer `unitCost` usable as a
  SUGGESTED/default cost entry, not the only source.
- **Store-tier flip behavior (explicit):** corporate→franchise = stop receiving central cost + prompt a local
  cost review; franchise→corporate = start receiving central cost.

### 6.3 D-HOAUTH — the one OPEN decision for Kunal (auditors SPLIT)
`editRefData` (catalogue edit) is HO+Director in the app, but the server can only prove the **Director** key
class (Chunk 5). So who may PUBLISH catalogue changes to the cloud?
- **GPT: Director-key only for Chunk 6.** HO-originated catalogue edits stay local/unpublished until Chunk 9
  (per-user auth) gives HO real server identity. Cleanest; but if HO staff do the data entry, their edits don't
  propagate until a Director re-enters/publishes them (catalogue islands persist for HO-origin edits).
- **AGY: also allow the head_office STORE key** to write/publish non-pricing catalogue metadata (products,
  categories, names) — so office staff can do routine data entry without holding a Director key. Cost/pricing
  stays Director-only. More usable; slightly widens the server write surface to the shared HO-store credential.
- **Depends on: who actually does product/catalogue data entry** — Kunal/Shahin (→ Director-only is fine) or
  Head Office warehouse staff (→ AGY's HO path helps).

### 6.4 Other adopted findings (both auditors)
- **Validation (catalogue-specific, beyond generic hygiene):** duplicate ids within a request; dangling
  refs (product.catId exists, product.ptId exists); enums (store type, stockType); franchiseDiscount 0–100 or
  null; nullable-safe-int leadDays/weights; string length caps; **block deactivating (active:false) a
  product/store that still has non-zero stock or linked records.** Return the **Chunk-2 accepted/rejected/failed
  contract** — never partially publish invalid mixed rows without reporting exactly what landed.
- **D3 UX:** dirty-state ("you have unpublished changes"), a preview/diff before publish, show last-published
  version + time, hard success/failure messaging.
- **Build 9/10-ready now (no rework):** actorUserId reserved in write/publish logs, auth-context logs, per-row
  versions, target scopes, and the public-vs-cost-scoped split payload.
