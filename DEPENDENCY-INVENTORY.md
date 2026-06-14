# Dependency Inventory — BOB Stock App

Provenance for every third-party resource (shipped + dev). "No npm in dist" ≠ "no supply chain" — every CDN asset and vendored lib is a dependency. Enforced by `test/verify-release.js` (framework P-11). Banked: D-047 (Wave C / C4).

## Shipped (production) dependencies
| Dependency | Version | Source | Integrity (SRI) | Licence | Pinned | Why | Status |
|---|---|---|---|---|---|---|---|
| **Dexie** | 3.2.7 | `cdn.jsdelivr.net/npm/dexie@3.2.7/dist/dexie.min.js` | `sha384-xjSPK8bO…` ✅ | Apache-2.0 | ✅ | IndexedDB wrapper — the local data layer | ACTIVE · precached in sw.js |
| **Chart.js** | 4.4.0 | `cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js` | `sha384-e6nUZLBk…` ✅ | MIT | ✅ | Analytics/report charts | ACTIVE · precached in sw.js |
| **Google Fonts** (Playfair Display, Inter, Dancing Script) | family+weight pinned | `fonts.googleapis.com` → `fonts.gstatic.com` | ❌ none (UA-tailored CSS — SRI impractical) | OFL-1.1 / Apache-2.0 | family/weight pinned | Brand typography | ACTIVE · **WARN** — self-host pre-beta to remove 2 external origins + enable offline/SRI |
| ~~Tailwind CSS~~ | — | ~~`cdn.tailwindcss.com` (dev CDN)~~ | — | MIT | — | **REMOVED (Wave C / C2)** — app uses 0 Tailwind utilities + its own CSS/reset | REMOVED |

## Dev / test only (NOT shipped to devices)
| Dependency | Version | Source | Integrity | Licence | Pinned | Why | Status |
|---|---|---|---|---|---|---|---|
| **Playwright** | 1.60.0 | npm (`test/package.json`, `^1.40.0`) | sha512 in `test/package-lock.json` | Apache-2.0 | via lockfile | Real-browser sentinel + saboteur harness | DEV ONLY |

## Rules (enforced by verify-release.js)
- No dev CDN (`cdn.tailwindcss.com`) in production.
- Every shipped external `<script>` is version-pinned + SRI + `crossorigin`, and appears in `sw.js` PRECACHE_URLS.
- `test/package-lock.json` is committed (node_modules git-ignored) for reproducible test installs.
- New external origin → add a row here + justify, or the gate flags it.
- **Pre-beta:** self-host Google Fonts (kills the last 2 unpinned external origins) and run a dependency-vulnerability scan over the test lockfile.
