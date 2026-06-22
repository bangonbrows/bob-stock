# WAVE M2 — BUILD STATUS (Group 2: money / data correctness)

**Branch:** `fix/cli-tri-audit-2026-05` · **Files:** `index.html`, `sync.js` (+ harness) · **Status:** BUILT + self-proven; NOT committed, NOT deployed (held with M1 for tonight's full sweep).

**Spec-audit gate (before any code):** AGY = APPROVE; GPT = APPROVE-WITH-CHANGES. Both refinements folded in (below). Packs: `audit-artifacts/WAVE-M2-SCOPE.md`, `PASTE-TO-AUDITORS-WAVE-M2.txt`.

**Code-review gate (post-implementation) — PASS:** GPT = **APPROVE (no findings)**; AGY = **PASS (APPROVE)**, ran the harness locally (143/143 + 4/4). Both confirm M2 safe to commit. Pack: `audit-artifacts/PASTE-TO-AUDITORS-WAVE-M2-REVIEW.txt`. → Both M1 + M2 now fully signed off (spec + code, both auditors). Only remaining gate = tonight's full saboteur sweep, then Kunal authorises commit.

## Fixes implemented
| # | Finding | What changed | Where |
|---|---------|--------------|-------|
| 1 | **GPTa-41** clearing a franchise discount stored 0% → full price | Setter: blank → `null` (inherit), value → clamped number (0 also → null, no UI 0% option). PLUS treat a stored 0 as "not set" at every read site (display, franchise billing, CSV) so existing polluted rows inherit too | `_setProductFranDisc`; index.html:2968 (display), 4139 (billing), 4156 (export) |
| 2 | **GPTa-38** same product twice in one delivery muddled the cost | Block-on-duplicate at `_saveDelivery` (after `validLines`), clear message, nothing saved. Always a typo (manual Director entry, no PO system). DELIVERY only — transfers record no cost | `_saveDelivery` |
| 3 | **GPTa-24** new device acts on seed before first sync | `Sync.init` leader branch: never-synced (`_lastSyncAt===0`) → immediate `pull()` + "Syncing latest data…" indicator; success shown ONLY if the cursor advanced; offline → "couldn't sync, showing local data" + polling retries. Non-blocking | `sync.js` Sync.init (~1288) |

## GPT change-requests — how handled
- **GPTa-41 existing-0 gap:** GPT noted the setter fix alone leaves already-polluted `franchiseDiscount===0` rows billing at full price. Fixed at the **read sites** — display (2968 `(p.franchiseDiscount||null)??…`), franchise billing (4139 `(p && p.franchiseDiscount)`), CSV export (4156) now treat 0 as inherit. No migration needed; robust to a 0 from any source. (1639 + 3304 already truthy-safe.)
- **GPTa-24 false "Up to date":** GPT + AGY both flagged that `pull()` doesn't reliably throw, so `catch + unconditional success` could show "Up to date" on seed. Fixed: success status only when `_lastSyncAt > 0` after the pull; otherwise an explicit "could not sync" notice.

## Harness
- New sentinels **S-150, S-151, S-152** → suite now **143 sentinels**, all CLEAN-PASS (`143/143`). S-150 also proves the billing normalization on a legacy stored 0 (owed 750 not 1000). S-152 drives the real `Sync.init()` first-run pull (leader election stubbed — covered by S-124/S-128).
- New saboteurs (4): **S-150** (clear→0), **S-150b** (billing treats 0 as real 0%), **S-151** (drop dup guard), **S-152** (drop never-synced pull).
- Targeted saboteur sweep: **4 CAUGHT / 0 BLIND / 0 skipped / 0 INFRA-FAIL of 4** (S-150, S-150b, S-151, S-152; baseline re-confirmed 143/143). Full-suite sweep = tonight, with M1.
- Duplicate-def sweep on edited methods: clean.

## Out of scope (later)
- GPTa-38 merge flow — deliberately NOT built (always a typo).
- Group 3 (M3): backup/resilience GPT-9/10, Ca-M17, GPT-5b/5c, GPT-18, date-preset.
- Server-side trio (W5, GCLI-2, Ca-M15) → Azure.

## Next
Targeted saboteur PASS → tonight: full 143-sentinel saboteur sweep covering M1 **and** M2 → Kunal authorises → commit both. No deploy without explicit OK + milestone audit.
