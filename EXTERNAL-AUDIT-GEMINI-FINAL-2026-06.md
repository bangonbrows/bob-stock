# BOB Stock App — External Audit Report (Final)
**Date:** 10 June 2026  
**Auditor:** Gemini CLI Agent  
**Status:** **NOT READY FOR LAUNCH (CRITICAL BLOCKERS)**

---

## 1. Executive Summary
The BOB Stock App is a well-designed PWA with a robust local data model. However, the current build contains **architectural failures in synchronization** and **critical security gaps** that will cause immediate data fragmentation and operational failure if deployed to a multi-store environment.

**Key Verdict:** The app currently functions as a "Single-Store" app that happens to have a cloud backup. It does not yet function as a "Multi-Store" synchronized system.

---

## 2. Critical Issues (Launch Blockers)

### [BOB-CRIT-01] Master Data (Catalogue) Synchronization is Missing
*   **Severity:** P0 (Total Architectural Failure)
*   **Root Cause:** The `Sync` module pushes and pulls transactions, but it has no mechanism to sync the `products`, `stores`, `categories`, or `users` tables. Local changes made by a Director remain trapped on their device.
*   **Business Impact:** If a Director adds a new product at Head Office, no salon staff will see it. If they update a price, staff will continue selling at the old price. This leads to immediate data "islands" and prevents the app from functioning as a chain-wide system.
*   **Recommendation:** Implement a "Master Data" sync cycle where the full catalogue is pulled from `AppConfig` and merged into IndexedDB on app launch.

### [BOB-CRIT-02] Sync Race: The "Double Receive" Stock Glitch
*   **Severity:** P1 (Data Integrity)
*   **Root Cause:** The `Transfer.receive` logic in `phase2.js` only checks the *local* status of a transfer.
*   **Repro:** Two staff members open the same transfer on different phones. Both submit a receipt for 10 units. Two `transfer_in` transactions are created.
*   **Business Impact:** Stock levels will be accidentally doubled in the ledger with no easy way to detect or revert the error.
*   **Recommendation:** Implement a server-side check (Logic App) to reject a second `transfer_in` record for the same Transfer ID.

### [BOB-CRIT-03] Database Performance Bottleneck (Full Rewrites)
*   **Severity:** P1 (Stability/UX)
*   **Root Cause:** `DB.save()` calls `_persistAllToDexie()`, which clears and rewrites the *entire* database (including 10,000+ transactions) every time a single record is marked as "synced."
*   **Business Impact:** Within 2-3 weeks of data entry, the app will experience "freeze" events during sync cycles, eventually leading to browser storage timeouts and data loss.
*   **Recommendation:** Refactor `DB.markSynced(ids)` to perform a targeted update on specific rows instead of a full database wipe.

### [BOB-CRIT-04] ID Detachment via Post-Persistence Sanitization
*   **Severity:** P1 (Data Loss)
*   **Root Cause:** `DB._sanitizeNames` strips characters from IDs *after* they are used in transactions.
*   **Repro:** Create a product with ID `BR-1 <Red>`. The sanitizer changes the ID to `BR-1 Red`.
*   **Business Impact:** All existing transactions still point to `BR-1 <Red>`. The product "detaches" from its history, causing stock to drop to zero and movement history to vanish.
*   **Recommendation:** Remove ID sanitization from the DB layer; enforce strict ID validation (Regex) in the UI forms.

---

## 3. High-Risk Issues

### [BOB-HIGH-01] Credential Exposure in Ledger & Backups
*   **Severity:** High (Security)
*   **Finding:** Transaction rows (`by` field) and Backup JSON files contain SHA-256 hashes of staff passwords and PINs.
*   **Impact:** Offline brute-force cracking of staff credentials.
*   **Recommendation:** Use `Auth.actor()` (returning only name/role) in all transaction builders. Remove hashes from backups.

### [BOB-HIGH-02] Stock "Transit Void"
*   **Severity:** High (Operational)
*   **Finding:** If a transfer receipt is "flagged" due to a discrepancy, **zero stock is credited** locally until a Director resolves the flag.
*   **Impact:** Stock that physically arrived is invisible to the system, causing false "Out of Stock" alerts and unnecessary reordering.
*   **Recommendation:** Credit the `receivedQty` immediately; flag only the *discrepancy* for later review.

---

## 4. Medium & Low Risk Issues

*   **[BOB-MED-01] Financial Rounding:** Using `toFixed(2)` and JS floats will cause "Penny Drift" in valuation reports over time. Use an integer-based (cents) model for financial totals.
*   **[BOB-MED-02] Diagnostic URL Leak:** The URL scrubber is too specific to `logic.azure.com` and may fail if the backend infrastructure changes, leaking SAS "Master Keys" into logs.
*   **[BOB-LOW-01] Service Worker Stickiness:** No "Update Available" prompt means UI/DB schema mismatches could occur during version cutovers (e.g., v7 to v8).

---

## 5. Architectural Concerns
*   **SharePoint Threshold:** The 5,000-item limit in SharePoint lists will break `Sync.pull()` unless indexes are explicitly created on the backend.
*   **iOS Storage Eviction:** iOS/Safari may nuke the database if the app isn't used for 7 days. The app needs a "Cloud Sync Status" indicator that clearly shows the last successful cloud-persist.

---

## 6. Final Launch-Readiness Opinion
**VERDICT: REJECTED**

The application is unsafe for multi-store deployment in its current state. The engineering team must prioritize the **Master Data Sync** and **Idempotent Receive** logic before the system can be considered reliable for business-critical stock tracking.

---
**Auditor Signature:**  
*Gemini CLI (Auto-Edit Mode)*  
*Report Code: G-BOB-FINAL-2026-06*
