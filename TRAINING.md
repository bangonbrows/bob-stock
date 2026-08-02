# BOB Stock App — What it does, and how to use it

> **GENERATED FILE — DO NOT EDIT.** Built from `register/features.json`.

A plain-English guide to every part of the Stock app, for salon staff, store managers and
Head Office. No technical knowledge assumed.

**This guide only covers what actually works today.** Anything still being built is listed
separately at the end, so nobody is ever trained on a button that is not connected yet.

*234 working features, current as at 2026-08-02.*

---

## Logging in, roles and permissions

### Log in with a username and password

The app opens on a sign-in card asking for a username and a password. Type them in, press enter, and you land on your Dashboard. On the version that is live today the password is checked entirely inside the browser against the account list stored on that device — nothing is sent anywhere.

**Who uses it:** everyone: staff, store manager, franchisee, director, head office

> **Worth knowing:** On the LIVE site the password check is 100% in the browser. Anyone who can open the browser's developer tools can bypass it. That is a known, accepted limit for the trusted internal alpha (CLAUDE.md §6, framework rule P-13) — it is not security, it is a convenience gate. There is no 'forgot password' and no self-service reset: a Director resets it in User Management.

### Old-style fallback login (first-run migration window)

If there is no cloud and no remembered offline copy yet, the app accepts the original built-in password list stored on the device, then immediately creates the offline copy. This is what keeps a brand-new device working on day one.

**Who uses it:** everyone, in practice this is the only path that runs today

> **Worth knowing:** This is the login path every real user will actually hit right now, on both `main` and the branch, and it is the least covered by tests. There is NO limit on wrong password attempts in the browser — the 5-strikes lockout lives only in the cloud Logic App.

### Staying signed in (and being signed out when the tab closes)

Once you sign in, the app remembers you while that browser tab stays open — refresh the page and you are still in. Close the tab or the browser and you must sign in again. It remembers you with a random one-time ticket, never with your password.

**Who uses it:** everyone

> **Worth knowing:** There is no 'remember me'. On a shared store PC that is the right behaviour; on a phone it means signing in every session. The ticket is matched against a copy held in the device database, so signing out on one tab invalidates the ticket for other tabs of the same account.

### Sign Out (and it clears half-finished work)

A Sign Out button at the bottom of the side menu, and another on the mobile top bar. Signing out doesn't just return you to the login screen — it wipes any half-typed movement, stock-take counts, delivery lines and transfer drafts, so the next person on a shared store computer can never accidentally submit the previous person's work under their own name.

**Who uses it:** everyone; matters most on a shared store computer

> **Worth knowing:** Signing out also wipes every in-memory cloud credential (session ticket, PIN grant, action approvals) and the 24-hour stock-take unlock.

### Screen lock after 10 minutes idle, unlocked with a 4-digit PIN

If nobody touches the device for 10 minutes, a dark 'Session Locked — Enter PIN' screen drops over everything with a number keypad. Tap your 4-digit PIN and you are straight back where you were, still signed in. Any tap, keypress, scroll or mouse move restarts the 10-minute clock.

**Who uses it:** everyone, designed for the shared salon computer

> **Worth knowing:** Two gotchas. (1) The lock screen has NO 'sign out' or escape — if the PIN is wrong or missing, the only way out is to close the tab. (2) On the working branch, accounts created through the cloud path get no local PIN at all (index.html:3714), so those users would hit 'No PIN set. Contact admin.' and be stuck behind an un-dismissable overlay. Unlimited PIN guesses, no lockout, 4 digits.

### Locking the screen also throws away your cloud credentials  *(partly working)*

When the screen locks — by idle timeout or manually — the app deliberately throws away the invisible cloud passes it was holding (your 12-hour session pass, any 24-hour stock-take unlock, and any recent approval passes). A device left on the counter overnight holds nothing reusable.

**Who uses it:** everyone; a control for Head Office / Director peace of mind

> **Worth knowing:** The lock and the clearing both run today; there is simply nothing to clear, because no cloud passes are ever issued (see cloud login). Side effect once it is on: after an idle lock, staff must re-enter the 24-hour stock-take PIN, not just the screen PIN.

### The six job types (roles)

Every account is one of six types: Store account (staff), Store manager, Franchisee, Territory manager, Head office, Director. The type decides which menu items appear and what each person is allowed to do. Head office and Director accounts see every store; the other four are tied to specific stores.

**Who uses it:** everyone; a Director assigns the type

> **Worth knowing:** There is NO seeded Territory manager account — the role exists everywhere in the code and menus but nobody has ever been one. `Auth.isAtLeast()` at index.html:943 ranks franchisee BELOW store manager, which is wrong for this business; the code comment at :994 warns never to use it and nothing does, but it is a live trap for the next engineer. `Auth.canSeeStore()` at :984 is written and never called anywhere.

### The permission list (who can do what)

One central list says which job types may do each action — record a delivery, approve a stock take, cancel a transfer, delete a logged movement, manage users, edit products, and so on. Every button in the app asks that one list rather than each screen deciding for itself.

**Who uses it:** everyone (invisibly); Director configures it

> **Worth knowing:** BROWSER-ONLY today. It stops honest mistakes and catches regressions; it does not stop a determined person with developer tools. The five extra entries on the branch are the view controls: see cost prices, see selling prices, see older/archived data, see store-comparison charts, edit the access policy. One gate is still hard-coded outside the list: the transfer hub's 'New Transfer' button checks a fixed role list at phase2.js:1208, so changing the policy would not change that button.

### The 24-hour Stock Take PIN

A Director generates a numeric PIN that is valid for 24 hours across all stores. A store account tapping 'Stock Take 🔒' hits a locked screen and must key that PIN in to get through; it shows roughly how many minutes are left. Clear the PIN and the door shuts again.

**Who uses it:** director sets it; store accounts (staff) use it

> **Worth knowing:** The LOCAL version (PIN scrambled and stored on the device) is switched on and works today. The CLOUD version — where the PIN lives only on the server, is checked online, and issues a signed unlock pass that the server can verify on every stock-take row — is built and proven but off, and item 10 of the staging ledger (the Logic App route that mints the pass) is not applied. Note the cloud version needs internet at the moment the PIN is typed; Kunal accepted that trade-off.

### Which menu each role sees

The side menu is rebuilt for each job type. A store account sees only Log Movement, Current Stock and Stock Take. A store manager adds My Movements, Alerts and four reports. A franchisee gets a Head-Office-style menu but limited to their own locations. Head Office adds product/store/threshold settings; a Director adds Cost Management, Reorder List, Audit Log, Login Audit, Franchise Invoicing and Settings. Phones get a cut-down bottom bar with the same rules.

**Who uses it:** everyone

> **Worth knowing:** Menus are cosmetic only — hiding a link does not stop someone typing the page name. The real protection is the guard at the top of each page. Every signed-in person can reach the Transfers Hub (so anyone can receive), but 'New Transfer' only appears for franchisee and above.

### Page-level guards (typing a page name doesn't get you in)

Each screen re-checks permission when it opens and bounces you back if you shouldn't be there. Audit Log, Login Audit, Reorder List, Franchise Invoicing and User Management all send a non-Director back to the Dashboard; Cost Management, Store Comparison and stock-take approval do the same off the permission list.

**Who uses it:** everyone (invisibly)

> **Worth knowing:** The router does not gate anything — each page gates itself, so a page that forgets is silently open. That is exactly the bug fixed on the Store Comparison page (AA-02) and it is why the guard pattern matters.

### Store scoping — which shops a person can see

Every non-Head-Office account is tied to one or more stores. A store manager sees their one shop; the Cockburn franchisee sees Cockburn plus the Cockburn Franchise Office; Head Office and Directors see everything. Stock overviews, alerts, reports, CSV exports and the transfer store pickers are all filtered to those stores.

**Who uses it:** staff, store manager, franchisee, territory manager

> **Worth knowing:** Browser-only filtering today: a live device still HOLDS every store's data, it just doesn't show it. Gap worth knowing: a Territory manager is not treated as 'store level' at index.html:2778, so Stock Overview shows them ALL stores regardless of which stores they were assigned. Nobody is a Territory manager today, so it has never bitten.

### User Management screen (add / edit / deactivate accounts)

A Director-only screen listing every account with name, username, job type and assigned stores, plus Add User, Edit and Delete/Deactivate buttons and the Stock Take PIN panel underneath. Adding someone asks for a full name, username, password, 4-digit PIN, job type and which stores. Choosing Head Office or Director hides the store list, because they see everything.

**Who uses it:** director only

> **Worth knowing:** Guardrails that work today: you cannot delete your own account, cannot delete or demote the last Director, cannot reuse a username, and the PIN must be exactly 4 digits — all checked BEFORE anything is changed. On the live version accounts are created purely on that one device, so a new account must be created on every device or arrive by backup restore.

### Login Audit — who signed in, on what device

A Director-only page listing sign-ins with the time, username, device type (iPhone / Windows PC / Android), a short device fingerprint, and a 🆕 flag the first time an account is used on a new device — which also raises a small toast at the time. It says plainly on the page that it only covers logins made on THIS device.

**Who uses it:** director

> **Worth knowing:** Easy to over-read. It is a per-device diary held in that browser, capped at 500 entries; it is never sent anywhere and never combined across devices. It also cannot see failed attempts. The page says so honestly.

### Audit Log — deleted movements with reason and author

A Director-only page listing every deleted stock movement with who deleted it, when, and the reason they gave, filterable by store. It is the counterweight to letting managers delete movements at all.

**Who uses it:** director

> **Worth knowing:** Staff cannot delete at all — they get a 5-minute Undo instead. Store managers and above can delete, which is why the log exists.

### Passwords, PINs and passes are kept out of backups  *(partly working)*

When a Director downloads a backup file, the app strips out anything reusable: sign-in tickets, cloud keys and web addresses, the live 24-hour stock-take PIN, the account access sheet, and (on the newer version) the password and PIN scrambles too. Importing a backup can therefore never restore someone else's active login or smuggle in a permission sheet.

**Who uses it:** director

> **Worth knowing:** IMPORTANT DIFFERENCE between live and branch. On the LIVE site the deny-list (main index.html:3295) does NOT include password or pin, so hashes still travel in a backup and a restore keeps everyone able to log in. On the branch they ARE stripped — which means restoring a backup there leaves every account with no password and no screen-lock PIN, and anyone without a cached offline copy cannot sign back in. Also note the code comment at index.html:3886 still claims hashes are 'intentionally kept'; the code disagrees and the code wins.

---

## Logging stock movements

### Log Movement wizard (the 4-step form)

The main screen staff use every day. Four steps across the top: (1) what are you doing — Stock In, Stock Out or Return In; (2) pick the product; (3) enter how many, where it came from or went to, why, and your name; (4) a Confirm screen that shows everything back before you press the button. You can go Back at any step. If you walk away and log out, the half-finished form is thrown away — nothing is saved until you press Confirm.

**Who uses it:** staff, store manager, franchisee, territory manager, head office, director — every role has 'Log Movement' in the left menu

> **Worth knowing:** No permission check at all on logging — every logged-in role can log a movement. The only per-role difference is that staff do not see the RETURN IN button (index.html:1922). Confirmed present on the live site's branch (main).

### Location picker (which store am I logging for?)

If you only work at one salon, the page just says your salon's name and every movement is recorded there. If you cover several places — Head Office, a franchisee with more than one store, or an area manager — a 'Location' dropdown appears at the top and you choose which store the stock is moving at. Head Office also gets 'Head Office (Warehouse)' in that list.

**Who uses it:** head office, director, franchisee, territory manager, any store manager attached to more than one store

> **Worth knowing:** The dropdown lists only ACTIVE stores, and hides warehouses unless they are a Franchise Office. Ardross and Bunbury were DELETED from the seed on 2026-08-02 (33 practice movements, 12 threshold entries and both store rows removed); test/check-seed-integrity.js now fails if either reappears.

### Step 1 — Stock IN / Stock OUT / Return In

Three big buttons. STOCK IN = something arrived. STOCK OUT = something left. RETURN IN = a customer or another store gave something back. Staff only see the first two; Return In is hidden from them.

**Who uses it:** everyone (Return In: store manager and above)

> **Worth knowing:** Underneath, these are the movement 'types' in/out/return_in. Six more types exist that this screen never creates — see the classifier entry.

### Step 2 — find the product (type chips, category chips, search)

Filter by product type (e.g. Retail / Professional), then by category, or just type a few letters into the search box. Tap a product card to select it. The Next button stays greyed out until you have picked something.

**Who uses it:** everyone

> **Worth knowing:** Only products marked active appear. Search matches the product name OR its reference code.

### Step 3 — quantity, with a whole-number guard

A box for how many units. It only accepts a plain whole number of 1 or more — no decimals, no negatives, no scientific notation, and nothing silly like a billion. Anything else gets a red 'Please enter a valid quantity' message and the form will not move on.

**Who uses it:** everyone

> **Worth knowing:** The screen also shows the current stock on hand at that location, floored at zero so staff never see a negative number (index.html:1947).

### Step 3 — 'Stock Coming From' (for INs and Returns)

For a Stock IN you say where it came from: Supplier, HO Warehouse, Another Store, Franchise Office, or Other. For a Return In: Customer, Another Store, Franchise Store, or Supplier. This choice is what later tells the reports whether the stock was a supplier delivery or an internal transfer.

**Who uses it:** everyone

> **Worth knowing:** Stock OUT has NO 'coming from' — the source is always the location you selected at the top. Verified by running the classifier: 'HO Warehouse', 'Another Store', 'Franchise Office' all classify a Stock IN as a transfer; 'Supplier', 'Other' or blank classify it as a delivery.

### Step 3 — 'Stock Going To' (for OUTs)

For a Stock OUT you say where it went: Same Store (In-House Use), Customer Sale, Store Transfer, Franchise Transfer, Wastage/Damage, HO Warehouse, or Other. This is the single most important field in the whole app for reporting — it is what decides whether the movement counts as a sale, as wastage, as a transfer, or as in-house use.

**Who uses it:** everyone

> **Worth knowing:** If someone picks 'Other', the movement lands in an 'unclassified' bucket — deliberately, so it is never silently counted as a sale.

### Which store? — the second dropdown for transfers

If you say the stock went to 'Store Transfer' or 'Franchise Transfer', a second dropdown appears asking exactly which store. Same on the way in if you pick 'Another Store' or 'Franchise Store'. You cannot move on without answering it.

**Who uses it:** everyone

> **Worth knowing:** GAP, verified by running the option lists: 'Franchise Office' is offered as a Stock IN source but is NOT in the picker list, so the app never asks WHICH franchise office — the counterparty is left blank. 'HO Warehouse' and 'Supplier' also get no picker (fine — they are unambiguous). Also, the store list offered excludes the Head Office warehouse entirely, so you can never name Head Office as the specific source store.

### Reason dropdown that changes with your answer

The reason list is not fixed — it changes to match what you just said. Choose 'Customer Sale' and the only sensible reason offered is 'Sold Retail'. Choose 'Wastage/Damage' and you get 'Damaged/Expired' or 'Wastage'. Choose 'Same Store (In-House Use)' and you get 'Used in Treatment', 'Used for Training', 'Opened for Demo'. There is always an 'Other' option that opens a free-text box. A reason is compulsory.

**Who uses it:** everyone

> **Worth knowing:** Dead config: REASONS_MAP.in has a 'Franchise Store' entry (index.html:1826) that can never be reached, because 'Franchise Store' is not offered as a Stock IN source. Harmless, but it is a leftover.

### Return Condition (Returns only)

When you log a Return In, you must also say what state it came back in: Resalable, Damaged — Write Off, or Damaged — Return to Supplier. It is written on the movement and shown in the day's list.

**Who uses it:** store manager, franchisee, territory manager, head office, director (staff cannot log returns)

> **Worth knowing:** IMPORTANT: the condition is recorded but changes NOTHING. A return marked 'Damaged — Write Off' still ADDS a unit back to the shelf count, and does not appear in the wastage report. Someone must log a separate Stock Out to Wastage/Damage to take it back off. Grep-verified: returnCondition is referenced only in the wizard and in the display, nowhere in the stock maths or reports.

### 'Your Name' on every movement

Every movement is signed with a typed name, which shows on the day's list and on all reports. It is compulsory.

**Who uses it:** everyone

> **Worth knowing:** It is FREE TEXT — anyone can type anyone's name. It is not the logged-in account. (For deletions the app does record the verified account separately — see the Delete entry.)

### Step 4 — Confirm screen

A read-back card before anything is saved: type, location, product, quantity in big numbers, who is logging it, the reason, and the from/to. Then a green Confirm button.

**Who uses it:** everyone

### Franchise Transfer Pricing banner on the Confirm screen

When Head Office is logging a Stock Out and the selected location is a franchise store, a purple box appears showing the sell price, the franchise discount %, the unit transfer price and the total transfer value — so the person can see what the franchisee will be charged.

**Who uses it:** head office, director

> **Worth knowing:** TWO problems. (1) The variable is called destStore but it is actually the location selected at the top of the page — so if Head Office selects 'Cockburn' and logs a normal Customer Sale, this 'Franchise Transfer Pricing' banner still appears. Misleading. (2) It reads the flat franchiseDiscount number off the product or the store, NOT the dated era-aware Pricing lens, so the figure it displays can differ from what the invoice would actually bill. It also cannot express Kunal's decided model (universal rate → product-type rate → per-product rate) because the by-type tier does not exist.

### 'Not enough stock' block on a Stock Out

If you try to take out more than the system thinks is on the shelf, it refuses and tells you exactly how many are available. Nothing is saved.

**Who uses it:** everyone

> **Worth knowing:** Only applies to OUT movements. There is no equivalent ceiling on Stock In or Returns (correct — those add). If a product is already sitting at a negative number, every Out will be blocked until it is corrected by a stock take.

### Double-tap protection on Confirm

On a touchscreen it is easy to tap Confirm twice. The app locks the button while it saves so one tap = one movement. Without this, a double tap recorded the stock twice — each save gets its own unique ID so nothing else could catch it.

**Who uses it:** everyone

> **Worth knowing:** Found in a blind audit (Wave G) after it happened for real in testing.

### THE APPEND-ONLY LEDGER — pressing Confirm writes one line, forever

This is the single idea the whole app is built on. The app does NOT keep a number called 'stock on hand' anywhere. It keeps a diary. Every time anyone logs a movement, one new line is added to the bottom of that diary: date, store, product, in-or-out, how many, who, why. Lines are never edited and never overwritten — like a bank statement. When the app needs to show you 'we have 14 of these at Booragoon', it adds up every IN and subtracts every OUT for that product at that store, right there and then. That is why a mistake is fixed by adding a correcting line (or by Undo, which writes a cancelling line) rather than by changing history — and why you can always see exactly how a number came to be.

**Who uses it:** everyone (this is what happens every time anyone presses Confirm)

> **Worth knowing:** The write is DURABLE — if the device's storage refuses it, the movement is rolled back and the user gets a hard 'could not be saved' error rather than a false success. It also works with no internet: the line is saved locally and would sync later.

### ONE-SIDED movements — a transfer logged here only moves one end

Very important for training. If Booragoon logs 'Stock Out → Store Transfer → Karrinyup', that ONLY takes the stock off Booragoon. It does NOT put it on Karrinyup. Karrinyup has to log their own Stock In. If they forget, the units vanish from the company's total. The proper two-sided flow is the separate Transfers feature (send / receive / confirm), which creates both lines automatically.

**Who uses it:** everyone — this is the number one thing to teach

> **Worth knowing:** Not a bug — it is the design. But it is the single easiest way for staff to make the numbers wrong, and there is no warning on screen telling them the other store still has to receive it.

### Sale price frozen at the moment of logging

When a movement is a customer sale (or a customer return), the app copies the product's current sell price onto that line and keeps it. So if a Director changes the price next month, last month's sales reports do not silently change value.

**Who uses it:** director, head office (they see the effect in reports)

> **Worth knowing:** The in-code comment at index.html:2191-2193 says this is 'local-only, NOT pushed to SharePoint yet'. THE COMMENT IS STALE — sync.js:1309 does send UnitPriceAtTime, and the staging cloud has the column (AZURE-CHUNK-ORG-STAGING-LEDGER.md:25). But that newer sync.js is only on the working branch; the live site's sync.js does NOT send it.

### Today's Movements list (under the wizard)

A table under the form showing the last 10 movements logged today at the selected location: time, product, an IN/OUT/RETURN badge, quantity, who logged it, the reason and the from/to. Instant feedback that it saved.

**Who uses it:** everyone

> **Worth knowing:** 'Today' is the Perth calendar date, not UTC — proven by S-19. Only the selected location's movements appear.

### Undo within 5 minutes

An orange 'Undo' button sits next to each of today's movements for five minutes after it was logged, then disappears. Anyone can use it, including staff. It asks for confirmation, reverses the stock, and records who undid it and why.

**Who uses it:** everyone, including staff

> **Worth knowing:** Undo does not silently erase the line: it writes a 'tombstone' — a cancelling marker that other devices can see, so the movement disappears everywhere rather than only on this device.

### Delete a movement (managers and above, with a reason)

Store managers, franchisees, area managers, Head Office and Directors get a red Delete button. It opens a box demanding your name and a reason (Mistake / Double Entry / Wrong Entry / Other) and warns that the deletion goes on the audit log. Staff do not get this button — they are told to use the 5-minute Undo instead.

**Who uses it:** store manager, franchisee, territory manager, head office, director

> **Worth knowing:** The permission check is done twice — on the button and again on the actual delete — so it cannot be bypassed by poking at the page. The audit row records the typed name AND the real logged-in account.

### The movement classifier — direction (this is what moves the stock)

Every movement line has a type, and the classifier turns that type into one word: in, out, or none. 'In' adds to the shelf count, 'out' subtracts, 'none' means the line is ignored (a deleted line, or a type the app doesn't recognise). Nine types exist: in, return_in, transfer_in and adjustment_in all add; out, move_out, transfer_out, wastage and adjustment_out all subtract; deleted is ignored. The wizard itself only ever creates three of them (in / out / return_in) — the transfer types come from the Transfers screen and the adjustment types come from an approved Stock Take.

**Who uses it:** nobody directly — this runs behind every stock number in the app

> **Worth knowing:** 'move_out' is a dead type — nothing in the app creates it any more (only the classifier, a legacy reversal rule at db.js:928, and one sentinel still mention it). Harmless, but it exists purely for old data.

### The movement classifier — category (this is what the reports use)

Direction only tells you whether stock went up or down. Category tells you WHAT actually happened, and it works it out from where the stock went. The same 'out' movement is a sale, wastage, a transfer or in-house use depending on the destination you picked at step 3. The destination always wins — a wastage-sounding reason on a transfer does not turn it into wastage. And if the destination is missing or 'Other', the line lands in an 'unclassified' bucket rather than being silently counted as a sale.

**Who uses it:** director, head office, franchisee (through every report)

> **Worth knowing:** Added in Wave K after a blind audit found wastage and transfers were all being counted as SALES. Deliberately forward-only: old lines with no destination stay 'unclassified' rather than being retro-guessed. Two separate functions on purpose — changing category can never change a stock number.

### Stock levels are calculated, never stored

There is no 'stock on hand' field anywhere in this app. Every number you see — the shelf count on the logging screen, the Current Stock table, low-stock alerts, reports — is worked out by replaying the movement diary. If Head Office has filed away old history, the app starts from the filed-away opening balance and only replays the movements since. That is why the numbers can never quietly drift away from the paperwork: the paperwork IS the number.

**Who uses it:** everyone (invisibly)

### The quantity cache (why it is instant)

Replaying thousands of movement lines every time a screen draws would be slow, so the app keeps a running total per store-and-product in memory. On start-up it replays everything once. After that, each new movement just nudges its one total up or down. Anything risky — a delete, a filed-away archive, a failed save — throws the running totals away and replays from scratch rather than trying to be clever.

**Who uses it:** nobody directly

> **Worth knowing:** A deliberate rule at db.js:1145: deletes NEVER try to reverse a nudge, they always force a full replay — reversing was the source of an old bug.

### Defences against bad or hostile movement data

Before a movement line is allowed to affect a stock number it has to pass checks: the store and product names must be safe words (not special reserved words that could break the app), and the quantity must be a plain non-negative whole number. Anything failing is skipped rather than guessed at.

**Who uses it:** nobody directly

### Negative stock — raw for managers, floored for staff

If more went out than ever came in, the true total goes below zero. Staff never see a negative number — every screen shows 0 or 'OUT'. Directors DO see the true negative on a dedicated banner, because a negative means someone has been logging wrong and it needs fixing.

**Who uses it:** director sees the truth; everyone else sees the floored version

### Low-stock warning right after logging

If the movement you just logged pushed that product to or below its minimum level for that store, a red '⚠️ Low stock alert triggered' message pops up straight away.

**Who uses it:** everyone

> **Worth knowing:** Only fires if a Director has actually set a minimum for that product/store. No thresholds set = no warning ever.

### Half-finished forms are wiped on logout

On a shared salon iPad, if one person half-fills the movement form and logs out, the next person does not inherit it — and cannot accidentally submit someone else's half-typed movement under their own name. Same for stock-take counts, delivery lines and transfer drafts.

**Who uses it:** everyone on a shared device

> **Worth knowing:** Found in a blind audit (Wave G).

---

## Stock takes

### Stock Take counting sheet

The main Stock Take screen. It lists every active product as a row with three columns: what the system thinks you have, an empty box to type what you actually counted on the shelf, and the difference. There is a short colour key at the top: green means the count matched, red means you have less than the system thought (shortage), amber means you have more (surplus).

**Who uses it:** staff (PIN required), store manager, franchisee, territory manager, head office, director

> **Worth knowing:** Pure client screen. It is on the live 'main' branch, so it is the version a user would get today. The app has never actually been used, so no real count has ever been entered. Every product with active=true is listed, whether or not it has stock, so the untrimmed list is long — the filters below are how you make it manageable.

### Choose which store you are counting

If you look after more than one store (head office, director, franchisee, territory manager), a dropdown at the top of Stock Take lets you pick which store you are counting. A line under the filters says 'Taking stock for: <store>' so you cannot count the wrong shop by accident. Changing the store wipes any numbers you already typed.

**Who uses it:** franchisee, territory manager, head office, director (single-store staff and store managers never see the dropdown)

> **Worth knowing:** IMPORTANT GAP: the store list is d.stores.filter(s=>s.active && (s.type!=='warehouse' || s.isFranchiseOffice)) — so the Head Office warehouse (type 'warehouse', not a franchise office) is EXCLUDED. Nobody, not even a director, can run a stock take on the HO warehouse from this screen. The Cockburn Franchise Office IS included because it is flagged isFranchiseOffice. Also note the store list is drawn from the seed, which still lists 11 stores including the closed Ardross and Bunbury.

### Count only part of the shop (Product Type and Category filters)

Two rows of clickable chips above the counting sheet — Product Type (e.g. Retail vs Professional) and Category — let you narrow the list down. This is how you do a partial stock take: filter to Lashes, count just those, and submit. Whatever you leave blank is simply not part of that stock take.

**Who uses it:** anyone who can do a stock take

> **Worth knowing:** There is NO concept of a 'full' stock take in the code — no completeness check, no 'you missed 40 products' warning, no all-products-required mode. A take records only the products where a number was typed. Numbers you have already typed survive switching filters (they are held in Pages._stData keyed by product), but they are wiped if you change store or leave the page.

### Live difference badge as you type

The moment you type a count, the Difference column updates instantly: a green '✓ Match', an amber '+3 surplus', or a red '-2 shortage'. You see the problem before you submit anything.

**Who uses it:** anyone doing the count

> **Worth knowing:** Cosmetic only — nothing is saved until Submit.

### Counts must be whole numbers, no negatives

If you type something that is not a plain whole number (a decimal, a minus, letters, a paste of junk), Submit refuses with 'Counts must be whole numbers'. You cannot record half a bottle or minus three.

**Who uses it:** anyone doing the count

> **Worth knowing:** The input box also carries min="0", but that is only a browser hint — the real gate is safeInt at submit.

### Submit a clean stock take (everything matched)

If every number you typed matches the system, hitting 'Submit Stock Take' finishes there and then. You get 'Stock take complete — all N items matched'. No approval needed, nothing changes, because there is nothing to change.

**Who uses it:** staff (with PIN), store manager, franchisee, territory manager, head office, director

> **Worth knowing:** The record is saved with status 'clean' and is then effectively invisible — see the 'no stock take history list' gap. Clean takes never appear in Discrepancy History (that report only shows approved takes with differences).

### Explain the differences before submitting

If any count does not match, a pop-up called 'Explain Discrepancies' appears listing each mismatched product with the system number, your number and the difference. For each one you pick a reason from a dropdown — Miscount, Damaged, Expired, Theft/Loss, Used as sample, Supplier short, Other — and can add a short note. The pop-up says in bold that stock is NOT changed until a director approves.

**Who uses it:** whoever is doing the count

> **Worth knowing:** The reason list is hard-coded in the source — head office cannot add or rename reasons without a code change. The note field is capped at 200 characters.

### Submit for director approval (stock unchanged)

After giving reasons you press 'Submit for Approval'. The count is saved as pending, and you are told how many discrepancies are pending. Crucially, the shop's stock numbers do NOT move — nothing is adjusted until a director signs it off.

**Who uses it:** staff (with PIN), store manager, franchisee, territory manager, head office

> **Worth knowing:** Guarded against a double-tap by the _stSubmitting flag (index.html:2538). The saboteur harness attacks this (test/saboteur-runner.js:323).

### Pending Stock-Take Approvals panel (director)

When a director opens the Stock Take page, a yellow box sits at the top listing every count waiting for sign-off: store, date, who counted it, how many differences, and a Review button.

**Who uses it:** director

> **Worth knowing:** BIG PRACTICAL PROBLEM: directors and head office have NO 'Stock Take' link in their sidebar (index.html:6025-6078) and no 'Take' button in the phone bottom bar (index.html:6145-6161). The only way a director reaches this panel is the 'Stock Take' quick-action button on the Dashboard (index.html:4504). There is no badge, no count, no alert anywhere telling a director that approvals are waiting.

### Review a pending count

Clicking Review opens a table of just the mismatched lines — product, system figure, counted figure, difference, and the reason the counter gave. Two buttons: Reject, or 'Approve & Adjust'. Text at the top spells out that approving will create adjustment entries so the system matches the count.

**Who uses it:** director

> **Worth knowing:** Read-only view — the director cannot edit a counted figure or a reason, only accept or reject the whole take.

### Approve & Adjust — makes the system match the shelf

When a director approves, the app writes one stock movement per mismatched product ('adjustment in' for a surplus, 'adjustment out' for a shortage) so the system total lands exactly on what was counted. Each movement carries the reason and note the counter gave, and the director's name. The take is stamped approved with who and when.

**Who uses it:** director only

> **Worth knowing:** Permission comes from the central matrix cap stockTakeApprove = director only (index.html:966). The saboteur harness deliberately breaks this to check the sentinel bites (test/saboteur-runner.js:108).

### Reject a stock take

A director can reject a count instead. A confirmation box explains that no stock adjustments will be made and the count will simply be marked rejected. Nothing about the shop's stock changes.

**Who uses it:** director only

> **Worth knowing:** A rejected take is never re-openable and there is no way for the counter to correct it and resubmit — they have to start a fresh count.

### Double-tap and double-approve protection

On a touchscreen it is easy to hit a button twice. Three separate guards stop that turning into two stock takes or two sets of adjustments: one on the clean-take submit, one on the discrepancy submit, one on approve.

**Who uses it:** everyone (invisible)

> **Worth knowing:** The clean-take guard was added later than the discrepancy one — it was a real bug found in the Wave G audit (a double-tap appended two stock-take records a millisecond apart).

### Approval cannot double-apply or resurrect a rejected count

Before writing adjustments the app checks three things: is this take still pending, has it already been approved, and do adjustment entries for it already exist. If a previous approval half-finished, it will not post the adjustments a second time.

**Who uses it:** director (invisible)

> **Worth knowing:** The idempotency check relies on a field called stockTakeId written onto the adjustment movements. That field is NOT part of the cloud sync contract (sync.js:1287-1320 and 1366-1420 — there is no StockTakeId column), so a device that only received those movements from the cloud would not see the link. Harmless today because stock takes do not sync at all, but it is a live trap for later.

### Nothing is 'saved' unless it really hit the device

Every stock-take write — the count itself, the adjustments, the approval, the rejection — is checked to confirm it actually landed in the device's storage. If the save fails you get a hard, unmissable error rather than a quiet loss.

**Who uses it:** everyone (invisible)

> **Worth knowing:** On failure the app also calls DB.refresh() so the screen does not keep showing a change that was not stored.

### The 24-hour Stock Take PIN — set and clear

A director can generate a 4-8 digit PIN that unlocks Stock Take for shop-floor staff for 24 hours. It is shown once in a green toast when you set it, then never displayed again — the panel only says 'PIN is active' and the expiry time. There is a Clear PIN button to kill it early.

**Who uses it:** director sets it; staff use it

> **Worth knowing:** MAJOR PRACTICAL GOTCHA: today the PIN is stored ONLY on the device where it was set (a hash in the local 'meta' table — db.js:92, 135, 270, 288). It does not sync anywhere. So a PIN a director sets on their own phone does nothing for the store computer — in practice a director has to walk to each store device and set it there. The cloud version (one PIN, all devices) is built but off. The director should also write the PIN down when the toast appears; it is never shown again.

### Stock Take locked behind the PIN for shop-floor staff

For a 'staff' account, the Stock Take menu item shows a padlock. Tapping it opens a lock screen: a big PIN box, a note saying roughly how many minutes are left on the PIN, and Cancel / Unlock. Enter the right PIN and Stock Take opens. If no PIN is set at all, the screen says 'Stock Take Locked — ask your Store Manager or Director'.

**Who uses it:** staff on a shared store computer

> **Worth knowing:** The lock only applies to the literal role 'staff'. Store managers, franchisees, TMs, head office and directors go straight in with no PIN. This is a convenience/regression control, not tamper-proof security — a determined person with browser developer tools can bypass it (the project's permanent rule P-13).

### The PIN grants a temporary permission, not a bypass  *(partly working)*

Unlocking with the PIN does one narrow thing: it grants that account permission to do a stock take (and, in the newer design, to receive a transfer) for the life of the PIN. It does not unlock anything else — not costs, not deliveries, not approvals.

**Who uses it:** staff (invisible)

> **Worth knowing:** The client half runs today. The server half (the identical rule inside the deployed Function) is on the STAGING Function App only and is never consulted, because no access policy has ever been published.

### PIN unlock dies on logout, on the idle lock, and when the PIN changes  *(partly working)*

An unlocked Stock Take does not stay unlocked. Logging out clears it. The 10-minute idle screen lock clears it. And if a director clears or changes the PIN, any device that had unlocked with the old one is dropped immediately rather than staying open until the 24 hours run out.

**Who uses it:** everyone (invisible)

> **Worth knowing:** The logout and idle-lock clearing works today. The instant kill-switch on Clear PIN needs the cloud policy, which is off. Worth telling Kunal: this answers AA-20, which is DECIDED and built.

### Who is allowed to count and who is allowed to approve

Counting is open to store managers, franchisees, territory managers, head office and directors — plus shop-floor staff holding a valid 24h PIN. Approving is directors only. These are set in one central list rather than scattered through the app, so they can be changed in one place.

**Who uses it:** all roles

> **Worth knowing:** The permission list on the live branch is the same for stock takes. The editable-by-a-director version of this matrix, and the matching server enforcement, are built but off. Reminder: these are browser-side checks — good against mistakes and regressions, not against a determined person with developer tools.

### Discrepancy History report

A report for spotting patterns: which products keep going missing, at which store, and why. Filter by store and by period (90 days / 12 months / 2 years / all time). It shows three headline numbers — how many discrepancies, the net units, and the dollar impact — then a chip for each reason ('Theft/Loss: 4'), a by-product table ranked by dollar impact with its most common reason, and the latest 200 individual lines.

**Who uses it:** franchisee (own stores), territory manager, head office, director

> **Worth knowing:** Two things to tell Kunal. First, it only shows APPROVED takes with differences (index.html:2638) — pending and rejected counts are invisible here, and clean takes never appear. Second, the '$ impact' is calculated at the RETAIL selling price (index.html:2644 uses the product's price field), not at what the stock cost you — so it reads as lost revenue, not lost cost. There is no CSV export on this page.

### Stock Reconciliation report

Answers 'has anything drifted since our last count?'. For each store it takes the most recent stock take, adds every movement logged since that date, and compares that expected figure against what the system says now. Anything that does not line up is listed, biggest gap first. A tick-box shows the matching lines too.

**Who uses it:** store manager, franchisee, territory manager, head office, director

> **Worth knowing:** DEFECT: it picks the latest stock take with no filter on status (index.html:4797) — so a PENDING or REJECTED count is used as the baseline just as readily as an approved one. Since a pending or rejected count was never applied to stock, the whole report would then show phantom discrepancies for that store. Also, 'latest' is decided on the date string only, so two takes on the same day tie and the first one found wins.

### Negative-stock warning that points at a stock take

If the ledger has gone negative for a product (more sold than ever came in — always a logging mistake), directors get a red banner listing each one and saying plainly that a stock take is the fix. Staff just see those products as 0 / OUT.

**Who uses it:** director only

> **Worth knowing:** Deliberately does not rewrite the ledger — the underlying history stays intact and the correction goes through a stock take, which leaves an audit trail.

### Stock-take PIN stripped out of a backup file

When a director downloads a backup of the app's data, the live 24-hour stock-take PIN is deliberately removed from the file, so the backup cannot be used by someone else to unlock Stock Take.

**Who uses it:** director

> **Worth knowing:** Password and PIN hashes for user accounts ARE still kept in the backup by design (an accepted alpha-stage decision) and the export warns about it.

### Backup restore checks and store-scopes stock takes

When a backup file is loaded back in, stock takes are checked for damaged or dangerous record IDs (the whole file is rejected if any are found), and a restore is trimmed to only the stores that account is allowed to see.

**Who uses it:** director

> **Worth knowing:** Note the surrounding comment: stock-take records are deliberately NOT sanitised on load, because stripping characters would orphan them from the movements they created.

### Half-finished counts cleared when someone logs out

On a shared store computer, logging out throws away any half-typed stock take, so the next person cannot inherit or accidentally submit the previous person's numbers.

**Who uses it:** staff, store manager (shared devices)

> **Worth knowing:** The flip side is there is no save-and-resume: leave the Stock Take page mid-count, or change store, and your numbers are gone. For a long count on a phone that is a real risk.

---

## Transfers between stores

### Transfers Hub (the transfer list screen)

One screen listing every transfer this person is allowed to see, newest first, with a coloured status tag (Draft, In Transit, Received, Completed, Cancelled). Tabs across the top filter it: All, In Transit, Needs Receiving, Flagged, Completed, Drafts. 15 per page with Prev/Next. Tapping a row opens the right screen for whatever that transfer needs next — receive it, resolve it, or just view it.

**Who uses it:** staff (to receive) / store manager / franchisee / territory manager / head office / director

> **Worth knowing:** 'Needs Receiving' means 'in transit AND going to one of MY stores'. A Director/Head Office account normally has no stores attached, so that tab shows nothing for them — by design, but it surprises people. No badge colour exists for the newer statuses (conflict / stock_pending / stock_mismatch) so those rows render with an unstyled grey tag.

### New Transfer screen (pick stores, pick products, send)

Choose a From store and a To store, choose Standard Transfer or Return/Dead Stock, then work down a product list. For each product you see how many the sending store has, how many the receiving store has, that store's optimum level, and the shortfall — then use plus/minus buttons to set how many to send. A search box filters the product list. A summary bar shows products selected and total units, and the Submit Transfer button sends it.

**Who uses it:** franchisee / territory manager / head office / director (staff and store managers cannot create)

> **Worth knowing:** The From store defaults to Head Office for a Director/HO login, otherwise the user's own first store. A non-HO user only sees stores they own in both dropdowns, matching the rule the save enforces. There is no 'Save as draft' button anywhere on this screen — see the Drafts entry.

### Transit Void — stock leaves the sending store the moment you press Submit

This is the single most surprising rule in the whole transfer feature. When you submit a transfer, the units are subtracted from the sending store IMMEDIATELY — not when the receiving store confirms them. Between submit and receipt the stock belongs to nobody: it has left one shelf and not yet landed on the other. That is deliberate (the sending store must not be able to sell stock that is physically in a box), but it means the total across all stores dips while goods are on the road, and a transfer that is never received leaves the stock nowhere until someone cancels it or receives it.

**Who uses it:** everyone — it changes what the stock numbers mean for staff, store managers, franchisees and directors

> **Worth knowing:** Cancelling an in-transit transfer is the only way to put the stock back without receiving it, and only a Director can do that.

### Standard Transfer vs Return / Dead Stock

A toggle on the New Transfer screen. Return/Dead Stock asks for a reason (Damaged, Expired, Excess, Wrong Product, Other) plus free-text notes, and tags the transfer as a Return so the hub shows 'Return' instead of 'Standard'. Mechanically it moves stock exactly the same way — the difference is the label and the reason on the record.

**Who uses it:** store manager sending goods back / franchisee / head office / director

> **Worth knowing:** The reason is mandatory for a Return — Submit is refused without it.

### Cannot send more than the sending store has

If Head Office only has 4 of something on record, the app refuses to send 10 and tells you the real number, suggesting a sync or a stock take first. Because stock leaves on submit, allowing this would push a store negative. The plus/minus control on the screen already caps you, but the rule is enforced again in the save so a stale screen or a tampered-with browser cannot get past it.

**Who uses it:** anyone creating or submitting a transfer

> **Worth knowing:** This is a check on the device only. Two devices going offline and each sending the same units can still over-send; the real fix is the server-side ledger rule, which is built on the working branch but not live.

### Quantity rules on every transfer line

Every line must be a whole number of 1 or more. Blank, zero, '2.9', negative or nonsense text is refused with a message naming the product — and nothing is saved. Before this was tightened, a blank box quietly became a zero-unit line on the record.

**Who uses it:** anyone creating, submitting or receiving a transfer

> **Worth knowing:** Receiving is different: 0 IS allowed there (nothing turned up), but more than was sent is refused.

### Receive Transfer screen (count it in)

The receiving store sees what was sent, one product per row with a plus/minus counter pre-filled with the sent quantity. For each line you press Match — a green tick if the count agrees, an orange warning if it does not. Changing a count after matching un-matches it so you have to look again. Submit Receipt only lights up once every line has been matched, and the confirmation message tells you plainly whether you are about to flag mismatches.

**Who uses it:** staff / store manager / franchisee / territory manager at the receiving store (head office and director can also receive)

> **Worth knowing:** You can only receive a transfer addressed to one of your own stores — checked in the save, not just hidden on screen.

### Receiving more than was sent is refused

If 5 were sent and you count 7, the app refuses and tells you to record the extra 2 as a stock adjustment instead. A transfer receipt can never invent stock that was never sent. Counting fewer than sent is fine — that becomes a flagged discrepancy.

**Who uses it:** whoever receives at the destination store

> **Worth knowing:** The plus/minus control on screen still lets you type a higher number — the refusal comes at Submit Receipt with a clear message.

### A short receipt still credits what actually arrived, straight away

If 10 were sent and only 7 turned up, those 7 go onto the receiving store's shelf immediately and only the missing 3 wait for a Director's decision. This matters day to day: before this change a flagged line credited nothing at all, so real stock sitting on the shelf showed as out-of-stock and triggered false reorders.

**Who uses it:** receiving store staff and manager; the Director who resolves it later

> **Worth knowing:** The record remembers how much was credited at receipt (creditedAtReceive) so the Director's decision only ever moves the difference — no double counting.

### Same transfer cannot be received twice  *(partly working)*

If a transfer has already been received — possibly on the other shop computer — a second attempt is refused with 'This transfer was already received. Sync and reopen it.' Without this, two devices that had not synced could each receive the same box and double the stock.

**Who uses it:** any store with more than one device, or a phone plus the shop PC

> **Worth knowing:** Two layers. The device-side refusal is LIVE today. The authoritative server-side layer (a unique key per transfer+store+product, so the cloud rejects the duplicate even if the two devices never saw each other) is built and proven on the STAGING cloud only (AZURE-CHUNK4-WAVE-REVIEW.md: IdempotencyKey Enforce-Unique on StockTransactions_Validate) and is on the working branch, not the live site.

### Flagging a discrepancy

If any counted quantity differs from what was sent, the transfer does not simply complete — it goes to a 'received' state with those lines flagged, and waits for a Director. Lines that matched are accepted and finished. If nothing was flagged the transfer completes there and then.

**Who uses it:** receiving store; escalates to director

> **Worth knowing:** There is no free-text flag note captured at receive time — the note is entered by the Director on the resolve screen.

### Director resolution — Accept As-Is / Adjust / Reject

The Resolve Flags screen shows each disputed line with sent, received and the difference, and three buttons. Accept As-Is: believe the count, the receiving store keeps what arrived and the missing units go back onto the sending store's books. Adjust: the Director types the number they believe is correct (useful when the count itself was wrong), and stock moves up or down to match. Reject: the whole line is refused — anything already credited at the destination is taken back off and the full quantity returns to the sender. An optional note can be added to each line. When every flagged line has a decision the transfer completes.

**Who uses it:** director only

> **Worth knowing:** An 'Adjust' downward writes a stock adjustment-out, deliberately NOT a sale — so it never pollutes sales reporting. Adjust is capped at the quantity originally sent.

### All flagged lines resolved in one all-or-nothing save

Pressing Complete Transfer settles every disputed line in a single save. If the device fails halfway through, nothing at all is written — you never end up with a half-resolved transfer where two products were settled and three were not.

**Who uses it:** director

> **Worth knowing:** Replaced an older loop that saved each line as it went.

### Cancel a transfer (Director only)

A Director can cancel a transfer that is still a draft or still in transit. A draft is simply discarded. An in-transit one returns all the stock to the sending store, and the confirmation message says so in plain words before you commit. Once anyone has received it, cancelling is refused — you would be reversing stock that has legitimately landed somewhere else.

**Who uses it:** director only

> **Worth knowing:** The Cancel button only renders for a Director, and the rule is re-checked in the save.

### All-or-nothing saves with snapshot and restore

Every step that moves stock (submit, receive, resolve, cancel) writes the stock movements AND the updated transfer in one single database operation. Before touching anything the app takes a copy of the transfer; if the save fails, that copy is put back exactly as it was and the user is shown a hard 'could not be saved on this device' message rather than being allowed to carry on with a half-written record.

**Who uses it:** everyone — invisible safety net

> **Worth knowing:** The 'fatal save' overlay forces a reload rather than letting the app continue on a lie (S-72).

### Who is allowed to do what with transfers

Create a transfer: franchisee, territory manager, head office, director. Receive: everyone including basic staff. Cancel: director only. Resolve a discrepancy: director only. View completed transfer history: everyone except basic staff (a shared shop computer should not be a browsable archive). All of these now read from one central permission table rather than being hard-coded in five places.

**Who uses it:** all roles

> **Worth knowing:** Because these now route through the central table, a Director will be able to edit them per account once the Account Access feature is switched on. That editing is built but off.

### You only see and touch your own stores' transfers

A store-level user only sees transfers where one end is a store they are attached to, and can only create a transfer between two stores they manage. A franchisee with two locations sees both. The store dropdowns on the New Transfer screen are filtered the same way, so the screen never offers a store the save would reject.

**Who uses it:** staff / store manager / franchisee / territory manager (head office and director see everything)

> **Worth knowing:** On-device only — it stops accidents and regressions, not a determined person with browser developer tools. The real server-side isolation (Chunk 10) is built and converged on the working branch, not live. Note Transfer.list() itself is only exercised by the test harness; the hub does its own filtering.

### Read-only transfer view

If a transfer is not yours to act on — completed, or flagged when you are not a Director, or in transit to someone else's store — tapping it opens a simple pop-up showing the route, date, status, who created it, and a sent-vs-received table, with just a Close button. No dead buttons that do nothing when pressed.

**Who uses it:** all roles

> **Worth knowing:** This pop-up also carries the two warning banners about stock that has not landed yet (see the reconciliation entry) — but those statuses can only occur once cross-device transfer sync is on, which it is not.

### Optimum Stock Levels screen

A Director or Head Office sets, for every product, the minimum level and the ideal level — either globally for all stores or as a per-store override, with the store's current on-hand shown alongside so you can sanity-check. Save All writes the lot. These numbers are what drive the Optimum and Shortfall columns on the New Transfer screen, which is how you decide what to send.

**Who uses it:** director / head office

> **Worth knowing:** Validation: whole non-negative numbers, and the optimum cannot be below the minimum. It preserves the reorder lead-time set on the Settings screen — an earlier version silently wiped it on every Save All.

### Completed transfers are automatically cleared after 30 days

Completed and cancelled transfers older than 30 days are dropped from the transfer list to keep it manageable. The stock movements they created are never touched — only the transfer paperwork disappears.

**Who uses it:** everyone (affects how far back the hub goes)

> **Worth knowing:** SURPRISE, two parts. (1) Kunal should know transfer history self-deletes at 30 days — if he wants a longer paper trail, that number is a one-line change. (2) The automatic version at load looks incomplete: it filters the in-memory list then calls DB.commit(), but DB.commit() rewrites only the reference tables and deliberately excludes the transfers table (db.js:518-531 and db.js:111-131) — so the pruned transfers can reappear after a page reload. The manual pruneCompleted() explicitly deletes them from the device database (phase2.js:787) precisely because of that; the automatic one never got the same fix. Nothing tests either path.

### Protection against double-tapping the big buttons

Create Transfer, Cancel Transfer, Submit Receipt, Complete Transfer, Resolve Conflict and Save All are all guarded so a shaky tap or a slow phone cannot produce two transfers, two receipts or two adjustments.

**Who uses it:** everyone, especially on phones

> **Worth knowing:** Draft submit is protected differently — by two status checks rather than a flag — and that is documented in the code as deliberate, not an oversight.

### Half-finished transfer work is wiped at logout

On a shared shop computer, logging out clears every part-built transfer, part-counted receipt and unsaved threshold edit, so the next person never inherits someone else's half-finished work.

**Who uses it:** any store sharing one device between staff

> **Worth knowing:** An earlier version reset only some of the fields — the store selections, transfer type, return reason and threshold edits were missed and were added later.

### The plus/minus quantity control used on every transfer screen

The counter used everywhere in transfers: tap plus or minus for one at a time, hold it down for three seconds and it starts jumping in tens, or tap the number and type it directly. It clamps to the allowed range — on the New Transfer screen the maximum is however many the sending store actually has.

**Who uses it:** everyone using transfers on a phone or shop PC

> **Worth knowing:** On the Receive, Draft and Adjust screens the maximum is 9999 rather than the sent quantity — the real limits are enforced when you press the submit button, with a message.

---

## Reports, analytics and exports

### Dashboard (home screen)

The first screen after signing in. Shows a greeting, quick-action buttons, and tiles for stock value, low-stock alerts, movements logged today, and (for a Director) HO warehouse value, wastage this month at cost, franchise store count and deliveries recorded. Below that: the last 5 movements and the top 5 low-stock alerts. It changes shape by role - staff see fewer tiles than a Director.

**Who uses it:** staff / store manager / franchisee / head office / director (everyone)

> **Worth knowing:** 'Total Stock Value' here is at RETAIL price (Stock.totalValue, index.html:1568-1576) - the SAME words on the Reports page mean cost. Tiles will read 0 / empty because no real movements exist yet.

### Reports page - date, store, category and product-type filters

The filter bar at the top of the Reports page: a From date, a To date, a location dropdown, a category dropdown and a product-type dropdown, then an Apply Filters button. It opens defaulted to the last 90 days. The location list is automatically cut down to only the stores you are allowed to see.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** The page itself has NO permission check at the top - the only thing stopping a staff member is that no menu link is shown to them. Client-side only (framework P-13).

### Reports > Overview tab (stat tiles + two charts)

Answers 'how is the business doing right now?'. Four tiles: stock value, number of active alerts, units in and units out for the chosen period. Plus a doughnut chart of stock by category and a line chart of the last 6 months of stock in vs out.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** SURPRISE: the tile labelled 'Total Stock Value' here is valued at COST (Stock.currentCost, index.html:3284), while the identically-labelled tile on the Dashboard and Stock Overview is valued at RETAIL. Two screens, same words, different number. Also this tile silently includes the HO warehouse and the franchise office when no store filter is set.

### Reports > Transaction Log tab

A plain list of every movement matching the filters - date, store, product, category, in/out badge, quantity, who logged it and the reason.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** Silently capped at the newest 500 rows with no 'showing 500 of N' message. Deleted movements (tombstones) still appear here as a blank '—' row; they do not affect any total (S-80 in test/smoke-test.js proves they are inert in the maths).

### Reports > Stock Snapshot tab

A grid of every product down the side and every store across the top, showing how many units are sitting in each store right now, with a colour badge for low/out, and a total column.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** Ignores the From/To dates entirely - it is always 'now', which is easy to misread when a date range is set above it.

### Reports > Category Analysis tab

Answers 'which product categories are moving?'. A table per category showing how many products it has, current stock, and units in and out for the period. When you pick a store, category or product type it also draws a pie chart of stock going OUT by category.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** The pie only appears once a filter is chosen - with no filter you get the table only, which looks like a missing chart.

### All Transactions CSV export

The '⬇ All Transactions CSV' button on the Reports page (and the '⬇ CSV' button on All Movements). Downloads a spreadsheet of every movement in the chosen store and date range.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** GOTCHA: this CSV only honours the STORE and DATE filters. The category and product-type filters on screen are ignored, so the spreadsheet can contain rows the screen was hiding. It also includes deleted tombstone rows.

### Current Stock CSV export  *(partly working)*

The '⬇ Current Stock CSV' button. Downloads one row per product with a column per store showing units on hand, plus the HO warehouse and a total.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** The file itself is live today. The seeSellingPrice gate that hides the price column (S-248) is only on the working branch and only bites once the access policy is switched on - which needs the cloud config channel that has never worked.

### Movements CSV export (full ledger)

A richer movements spreadsheet than the Reports one - adds direction, the real category (sale / wastage / transfer / delivery), from, to and notes columns. Reached from the Data & Backup area rather than the Reports page.

**Who uses it:** director

> **Worth knowing:** Unlike the Reports CSV, this one correctly drops deleted tombstones and exports ALL dates with no filter at all.

### Products CSV export

Downloads the product catalogue - id, name, category, type, sell price, franchise discount, supplier, contact and lead days.

**Who uses it:** director

> **Worth knowing:** Exports the per-product franchise discount, so this is the closest thing to a printable record of the discount rules.

### Print report

A '🖨 Print' button on the Reports Overview that prints the page. Print styling hides the sidebar, mobile bars, popups and all buttons so you get a clean sheet.

**Who uses it:** store manager / franchisee / head office / director

> **Worth knowing:** Only the Reports page has a print button; no other report offers one.

### Store Comparison (period A vs period B)

Answers 'is this store doing better or worse than before?'. You set two date ranges - Period A and Period B - or use the quick buttons (last 3 months vs prior 3 months, 6 months, 12 months, or same period last year). Then tick which stores to include. You get a units bar chart, a value bar chart, a 24-month trend, and a table with the percentage change for each store.

**Who uses it:** franchisee / territory manager / head office / director

> **Worth knowing:** CAUTION: the 'Value' charts and the A/B Value columns multiply units by the CURRENT catalogue price, so raising a price today changes what last year appears to have been worth. The Director-only Gross Sales column does it properly (frozen price). Only a Director sees the Gross Sales / Total Cost / on-hand-at-cost columns; everyone else sees units and retail value only.

### Store Comparison IN / OUT / BOTH toggle and QTY / VALUE trend switch

Two small switches on the Store Comparison page: one flips the whole comparison between stock coming IN, stock going OUT, or both; the other flips the 24-month trend chart between counting units and counting dollars.

**Who uses it:** franchisee / territory manager / head office / director

> **Worth knowing:** Defaults to OUT and to QTY.

### Sell-Through Rate report

Answers 'of the stock we brought in, how much actually sold?'. Per product it shows units received, units sold to customers, the percentage, and a Strong / Moderate / Slow rating with a bar. You can pick 30, 60 or 90 days and a store.

**Who uses it:** store manager / franchisee / head office / director

> **Worth knowing:** Deliberately excludes consumables (professional products used in treatments) because they are used, never sold. Table capped at 200 rows.

### Wastage & Damage report + CSV

Answers 'what did we throw away and what did it cost us?'. Lists every movement marked as wastage or damage, with a store filter, and totals events, units lost, cost of the loss, and how many products were affected. There is an Export CSV button.

**Who uses it:** director only

> **Worth knowing:** Items with no cost recorded are shown as '— no cost' and counted in a warning, never quietly treated as $0. Director-only: index.html:4428 redirects everyone else.

### Dead Stock / Aging report

Answers 'what is sitting on the shelf not selling?'. Lists every product that has stock on hand but no outgoing movement in the last 30, 60 or 90 days, sorted by how long it has been stagnant, with the retail value tied up. Days over 90 go red.

**Who uses it:** store manager / franchisee / head office / director

> **Worth knowing:** Values stock at RETAIL price ('Est. Retail Value Tied Up') while the Wastage report values at cost - the two reports are not comparable. Table capped at 200 rows. Any OUT counts as movement, including a transfer out, so shipping stock away makes a dead item look alive.

### Stock Reconciliation report

Answers 'does the app still match what we physically counted?'. Takes the last approved stock take for each store, adds every movement since, and compares that expected figure to what the app says now. Anything that does not match is listed as a surplus or a shortage. A tick box shows the matching lines too.

**Who uses it:** store manager / franchisee / head office / director

> **Worth knowing:** Only uses the single most recent take per store. Table capped at 200 rows.

### Discrepancy History report

Answers 'which products keep coming up short, and where?'. Pulls every approved stock-take difference over the last 90 days / 12 months / 2 years / all time, groups it by product with the count, net units, dollar impact and the most common reason given, then lists the latest 200 individual differences.

**Who uses it:** store manager / franchisee / head office / director

> **Worth knowing:** Only counts APPROVED stock takes - a pending or rejected one never appears. Values at current retail price.

### Stock Overview (all locations on hand)

The 'how much stock have we got, and where' screen. Three value tiles (HO warehouse, in-store total, whole portfolio) that re-calculate as you filter, then a grid of products against stores. Filter by store chips, product type, category, or search by name.

**Who uses it:** franchisee / territory manager / head office / director

> **Worth knowing:** Valued at RETAIL price. A franchisee only ever sees their own stores and never the HO warehouse column.

### Current Stock (single store view)

The simple stock list a store manager or staff member uses: every product with units on hand, a coloured level bar, the minimum, and the price. Search box, product-type chips, and a 'Low Stock Only' filter.

**Who uses it:** staff / store manager

> **Worth knowing:** If the account covers more than one store this page politely refuses and points at Comparison / Alerts / Reports (index.html:2314-2322).

### All Movements (movement history, all stores)

The full transaction log with filters: location, type (Stock IN / Stock OUT / Returns), a from and to date, and a product search. Includes a CSV button.

**Who uses it:** franchisee / territory manager / head office / director

> **Worth knowing:** Opens defaulted to the last 90 days and shows the newest 500 rows only, with no warning that it is truncated. The type filter matches the raw type only, so 'Stock OUT' misses wastage and transfer-out rows.

### Transaction History (single store)

The same idea as All Movements but locked to one store - date range, type, product search - for a store manager reviewing their own shop.

**Who uses it:** store manager

> **Worth knowing:** Not shown to staff. Refuses to load for a multi-store account.

### Low Stock Alerts + Copy Summary

Answers 'what do we need to order right now?'. Lists everything at or below its minimum, split into Out of Stock and Running Low, with a store filter and tiles for how many stores and products are affected. A Director also gets a 'Copy Summary' button that puts a tidy plain-text order list on the clipboard, ready to paste into an email or WhatsApp.

**Who uses it:** store manager / franchisee / territory manager / head office / director

> **Worth knowing:** Copy Summary always copies ALL stores, ignoring the store filter you have selected on screen (index.html:2737).

### Negative stock banner (Director)

A red warning at the top of Stock Overview when the app has calculated a negative quantity - i.e. a counting error. It names the products and tells the Director to fix it with a stock take rather than editing the numbers.

**Who uses it:** director

> **Worth knowing:** Deliberately Director-only - staff and franchisees see those products as simply out of stock.

### Reorder List + CSV

Answers 'what do I order and from whom?'. Everything at or below its minimum, grouped by supplier with their contact, showing current quantity, the minimum, a suggested order quantity and the lead time. One Export CSV button gives you the whole order sheet.

**Who uses it:** director only

> **Worth knowing:** Suggested quantity is a simple formula (top back up to twice the minimum, never less than the minimum) - it is not based on sales speed. Only products that have a threshold set for that store appear at all.

### Margin Report

Answers 'how much do we make on each product?'. Sell price against cost price per product, the dollar margin and the percentage, plus averages across everything that has cost data. Lives as the 'Margins' tab inside Settings.

**Who uses it:** director

> **Worth knowing:** Hidden inside Settings rather than under Analytics, so it is easy to miss. Shows 'No data' for any product with no recorded delivery cost, and tells you to record deliveries in Cost Management.

### FRANCHISE INVOICE REPORT (the money report)

Answers 'what does the franchisee owe Head Office this period?'. Pick a From and To date. For each franchise office it lists every item Head Office supplied - date, product, quantity, sell price, the discount percentage, the full retail value, the discount given and the amount owed - with a total per office and four grand-total tiles across the top. Returns and credits are handled separately, not on this report.

**Who uses it:** director only

> **Worth knowing:** ⚠ THE LIVE VERSION IS THE OLD ONE. On the live site every line is priced from TODAY's catalogue price and TODAY's discount, so changing Cockburn's discount or a product price silently rewrites every past invoice (verified: main branch index.html:4120-4145 has no dated pricing at all). Also: it bills the Cockburn Franchise OFFICE only - anything Head Office ships straight to the Cockburn shop never appears on any invoice.

### Franchise Invoice CSV export

The '⬇ Export CSV' button on the Franchise Invoice screen. Downloads the same invoice as a spreadsheet - office, product, date, quantity, sell price, the discount percentages, the discount applied, full value, discount amount and amount owed.

**Who uses it:** director only

> **Worth knowing:** Refuses with 'Open the report first' if you have not loaded the report - it reads the dates the screen stashed (index.html:4976).

### Money definitions shared by every report (Gross Sales, Total Cost, on-hand at cost)

The single agreed meaning of the money words, so two reports can never disagree. 'Gross Sales' = real customer sales minus customer refunds, at the price frozen when the sale was logged, retail products only. 'Total Cost' = what the stock actually used (sold, used in-house, or wasted) cost us at the time. 'On-hand at cost' = today's stock at today's cost.

**Who uses it:** director (these drive the Store Comparison money columns and the Dashboard wastage tile)

> **Worth knowing:** Deliberately NO profit or P&L figure anywhere - an earlier version wrongly counted every outflow as profit and that was removed. The blue 'Updated Jun 2026' notes on the Comparison, Wastage and Sell-Through pages explain this to users.

### Audit Log (deleted movements)

Answers 'who deleted what, and why?'. Every deleted movement with the time it was deleted, who deleted it, their account and role, the reason they typed, plus the original movement's details. Filter by store.

**Who uses it:** director only

> **Worth knowing:** No CSV export and no date filter - store filter only.

### Login Audit

A list of sign-ins recorded on THIS device, with time, user, device type, a device fingerprint, and a 🆕 flag for a device that has not been seen before.

**Who uses it:** director only

> **Worth knowing:** Per-device only - it does NOT show logins made on other devices, and the screen says so.

### Spreadsheet safety on every CSV

Every CSV the app produces is written so a cell that starts with =, +, - or @ cannot run as a formula when the file is opened in Excel, and commas or quotes inside a name cannot break the columns.

**Who uses it:** anyone who exports

> **Worth knowing:** One shared helper, so a new export gets the protection for free.

---

## Products, categories and stock levels

### The product list (catalogue)

The master list of everything the business stocks — 192 products, each with a short reference code (like EXT_1), a name, and a category. Every other screen in the app (logging a movement, a stock take, a report) picks products from this one list. It is the same list for every store.

**Who uses it:** Everyone reads it; only head office and directors can change it

> **Worth knowing:** All 192 products are practice data. Only 51 of them have a sell price filled in — the other 141 show an amber "⚠ Missing" warning on the Products screen.

### Product Management screen (list, filter, search)

The screen where a director or head office sees every active product in a table — reference, name, category, type, sell price — and can narrow it down by product type, by category, or by typing part of a name or code into the search box.

**Who uses it:** Director (Settings > Products tab), head office (Settings > Products in the sidebar)

> **Worth knowing:** The header says "N active products" — deactivated (removed) products are hidden from this table but still exist in the data.

### Add a product

The "+ Add Product" button opens a small form: product code, name, category, sell price, whether it is Retail (sold to customers) or Consumable (used in the salon), and an optional franchise discount. If you type a name that already exists it warns you and asks "Add anyway?" — a duplicate code is refused outright.

**Who uses it:** Head office and directors (the franchise-discount part is director-only)

> **Worth knowing:** Codes are forced to CAPITALS and may only use letters, numbers, _ and -. If a head-office user (not a director) sets a franchise discount, it is silently dropped — a director must set it later (index.html:3480).

### Edit a product

The Edit button on each row lets you change the product's name, its category, its sell price and whether it is Retail or Consumable. You cannot change the product's code once created.

**Who uses it:** Head office and directors

> **Worth knowing:** The edit form deliberately does NOT show supplier, lead days, minimum levels or cost — those live on other screens.

### Remove a product

"Remove" asks you to confirm, then hides the product everywhere. It does not erase past movements — the stock history stays intact — but it does wipe that product's minimum-stock settings, its purchase-cost history, and its lines out of past stock-take records.

**Who uses it:** Head office and directors

> **Worth knowing:** TWO gotchas. (1) It is more destructive than it sounds — cost history and stock-take lines for that product are permanently deleted from the device. (2) It is never sent to the cloud: unlike removing a category or a product type, this action does not flag the change for publishing, so other devices would keep showing the product forever.

### Retail (sell) price

Each product can carry the price customers pay. It shows on the Products screen, the store stock screen and stock reports, and it drives the value of stock on hand. A product with no price shows an amber "⚠ Missing" flag so someone notices.

**Who uses it:** Everyone sees it; directors and head office set it

> **Worth knowing:** Prices are capped at $1,000,000 on the device, and refused if they have more than 2 decimal places. The cloud checker allows up to $10,000,000, so the device is the stricter of the two.

### Retail vs Consumable (stock type)

Every product is marked as either Retail (sold to a customer) or Consumable (used in the salon — wax, disposables, treatment product). Consumables are deliberately kept out of sales and sell-through reports so they don't look like lost sales; they still count in stock value, wastage and stock takes.

**Who uses it:** Set by head office / directors; affects what every manager sees in reports

> **Worth knowing:** None of the 192 seeded products has this set, so today every product behaves as Retail by default. An older "internal use" tick box was retired — the dropdown is now the only thing that matters.

### Product Types (Retail / Treatment / Cleaning / Stationery)

The top level of the catalogue: four groupings a category belongs to. You can add, rename or remove a product type from the Categories & Types screen. A product type in use by any category cannot be removed until those categories are moved or removed first.

**Who uses it:** Head office and directors

> **Worth knowing:** A product's type is NOT set on the product — it comes from its category. To move a product between types you change its category. Also: "Remove" only deactivates, and the row keeps appearing in this list looking identical to a live one.

### Categories

The 14 groupings products sit in — Lashes, Tinting, Extensions, Make Up, Face Waxing and so on. Each category belongs to one product type. You can add, rename, re-point or remove a category, and the app refuses to remove one that still has products in it, telling you how many.

**Who uses it:** Head office and directors

> **Worth knowing:** Same gotcha as product types: a "removed" category still shows in the Categories list with Edit and Remove buttons. It only disappears from the dropdowns where you would pick it.

### Minimum and optimum stock levels per store (Reorder Thresholds screen)  *(partly working)*

This is where a manager says "Karrinyup should never drop below 5 glue, ideally hold 12, and it takes 3 days to arrive." You pick a store at the top, then type a Minimum, an Optimum and Lead Days against each product. These numbers are what turn the low-stock warnings on.

**Who uses it:** Head office and directors (Settings > Thresholds)

> **Worth knowing:** THE BIG ONE: these numbers never leave the device. "thresholds" appears nowhere in the sync engine — set minimums on the office PC and the Karrinyup phone will not see them, ever. Also, the Lead Days column on this screen does NOT exist on the live site (it is only on the unreleased working branch) — today lead days can only be set on the Suppliers screen, per product, not per store.

### Optimum Stock Levels bulk editor (a second, separate screen)

A different screen that edits the same minimum/optimum numbers but in bulk: pick "Global (all stores)" or one store, type minimums and optimums down a long list, then press Save All once.

**Who uses it:** Directors and head office (sidebar: Optimum Levels)

> **Worth knowing:** Confusing by design: two screens edit the same numbers with slightly different rules, and this one can set a "Global" level that applies to every store. Also device-local — nothing here syncs.

### How the app decides which minimum applies

When the app needs a minimum for a product at a store, it first looks for a number set specifically for that store; if there isn't one it falls back to the global "all stores" number; if there is neither, the product simply has no alert at that store.

**Who uses it:** Invisible — it drives every badge, alert and reorder line

> **Worth knowing:** A product with no minimum set anywhere is silently excluded from low-stock alerts and the reorder list — it can run to zero with no warning at all. On the Stock Overview screen it is at least labelled "No threshold".

### Low-stock colour badges

The little coloured pill next to a stock number: green means healthy, amber says "N — LOW" when it is at or under the minimum, red says "0 — OUT". If the maths ever goes negative (more sold than received) it shows red OUT rather than a confusing minus number.

**Who uses it:** Everyone, on every stock screen

> **Worth knowing:** A grey badge with a bare number means "no minimum has been set for this product here".

### Low Stock Alerts screen

One page listing every product at or under its minimum, worst first, with four tiles at the top: Out of Stock, Running Low, Stores Affected, Products Affected. A store manager sees only their own store; head office and directors get a store filter with the alert count against each store name.

**Who uses it:** Store managers, franchisees, head office, directors

> **Worth knowing:** The Head Office warehouse is excluded from these alerts (only shops and the franchise office are included). Because the minimums never sync, two devices can legitimately show completely different alert lists.

### Copy low-stock summary to clipboard

A "📋 Copy Summary" button on the alerts page that copies a tidy, dated plain-text report — Out of Stock first, then Running Low, with the store and quantity for each — ready to paste into an email or WhatsApp.

**Who uses it:** Directors only

> **Worth knowing:** It copies alerts for ALL stores regardless of the store filter currently selected on screen.

### Low-stock badge on the dashboard and store screens

The store's own stock page opens with a red banner listing the products that are low, and the dashboard counts low-stock items across the stores you are responsible for.

**Who uses it:** Store managers, franchisees, directors

### Store stock filters (type chips, Low Stock Only, level bar)

On a store's Current Stock page you can search by product name or code, tap a product-type chip (Retail / Treatment / Cleaning / Stationery) to narrow the list, or tap "Low Stock Only" to see just the problems. Each row has a small progress bar showing how full that product is against its minimum.

**Who uses it:** Store staff and store managers

> **Worth knowing:** The progress bar is scaled against three times the minimum, so a product exactly on its minimum shows about a third full.

### Stock Overview status column (head office / director view)

The all-stores stock screen shows a plain-English status per product — OK, Low, Out of Stock, or "No threshold" when nobody has set a minimum — plus the dollar value of what is on the shelf, and a grid of every store side by side.

**Who uses it:** Head office, directors, territory managers

> **Worth knowing:** Negative stock is shown as zero dollars rather than negative dollars, on purpose.

### Reorder List (what to order, grouped by supplier)

A director-only page listing every product at or under its minimum, grouped under the supplier who provides it with their contact details, and a suggested order quantity (roughly enough to get back to double the minimum). Four tiles at the top: items to reorder, number of suppliers, out-of-stock count, total units. There is an Export CSV button to send to a supplier.

**Who uses it:** Directors

> **Worth knowing:** Only products with a minimum set appear here. Products with no supplier name land under a "No Supplier" heading. Lead days prefer the product-level value, falling back to the store-level one.

### Supplier Management (supplier, contact, lead days per product)

One long table of every active product where a director types the supplier's name, a phone or email, and how many days that product takes to arrive. Each row has its own Save button.

**Who uses it:** Directors only

> **Worth knowing:** Saved to the device only — this screen does not flag the change for publishing, so supplier details never reach other devices on their own. They only travel if someone later edits that product's name, price or category, which flags the whole row.

### Products list CSV export  *(partly working)*

A "🏷 Products List" button that downloads a spreadsheet of every active product: code, name, category, type, sell price, franchise discount, supplier, contact and lead days.

**Who uses it:** Directors (Settings > Data & Backup)

> **Worth knowing:** The export itself is live; the price-hiding rule attached to it is only on the unreleased working branch.

### Franchise discount per product  *(partly working)*

A dropdown on each product row (5%, 10%, 20%, 25%, 50%, 75%, 100% or blank) that says how much off the retail price a franchisee pays for THAT product. Blank means "use whatever the store's own discount is." Next to it the app shows the resulting franchise price in purple so you can sanity-check it.

**Who uses it:** Directors only (only they can change pricing)

> **Worth knowing:** Two gaps. (1) Kunal's decided model is store rate → PRODUCT TYPE rate → product rate. The product-type tier does not exist at all; there is only store rate then per-product. (2) Setting a discount is saved to the device but is never flagged for publishing, so on its own it never reaches another device.

### Cost Price column on the product screen  *(partly working)*

For directors, each product row also shows what the business paid for it — worked out from the most recent delivery — or a red "Not set" badge if there is no cost recorded yet.

**Who uses it:** Directors only

> **Worth knowing:** It is display-only here — cost is actually set on the Deliveries / Cost screens. Cost is deliberately never included in the shared product catalogue: the cloud strips it out of every published product row (catalogueMerge.js:69-79, verified by running it today).

### Guards that stop the catalogue breaking itself

Small safety rules woven through the catalogue screens: you cannot remove a category that still has products in it (it tells you how many), you cannot remove a product type still used by categories, removed categories vanish from the pick-lists but their name is kept so old records still read correctly, product codes are restricted to safe characters, and a backup file containing dodgy product or category codes is refused outright.

**Who uses it:** Head office and directors, whenever they tidy the catalogue

> **Worth knowing:** The in-use check is deliberately run twice — once when you click, once again just before saving — so leaving the confirm box open while someone else adds a product cannot slip through.

---

## Costs and pricing

### Cost price on a product (the current cost)

Every product can carry a cost price — what one unit costs Bang on Brows to buy. The app always uses the newest one, and that single number feeds margins, stock value at cost, and the value of anything thrown away.

**Who uses it:** director (only a Director can see or set it today)

> **Worth knowing:** Live on the site today, but EVERY one of the 192 seeded products has costPrice: null — so there is no cost on file for anything, and every margin/cost figure currently reads $0 or 'No cost'. Server side: cost can be delivered by the gated corporate-costs route on staging, but that route's account-level permission check has not been applied yet.

### Cost history — the dated record of what things used to cost

Whenever a cost changes, the old cost is kept with the date it applied from. So a report about March uses March's cost, not today's. This is the dated cost record that genuinely works — unlike the dated FRANCHISE pricing, which is built but switched off.

**Who uses it:** director

> **Worth knowing:** SURPRISE: cost history never leaves the device. Nothing pushes or pulls it, and when a delivery syncs to another device the fold rebuilds the delivery record but NOT the cost-history rows (records.js:604-608). Two devices would end up with different dated cost histories. Only the single current cost can travel, via the corporate-costs blob.

### Add a cost entry by hand (+ Cost)

On Cost Management a Director can type in a cost for a product with an effective date and a note, e.g. 'Jan shipment from ABC Supplier'. Used when a cost is known but no delivery was recorded in the app.

**Who uses it:** director

> **Worth knowing:** Also flags the product as needing a catalogue publish (Sync._markCatalogueDirty('cost', ...)) — but that publish path does not exist on the live site.

### View and remove cost history for a product

A History button next to each product opens the list of past costs, newest first, with a Remove button on each. Removing the newest one falls back to the next most recent.

**Who uses it:** director

> **Worth knowing:** Removal is permanent and there is no undo — it just asks for confirmation. Deleting a product also silently wipes that product's whole cost history (index.html:3520).

### Cost Management screen

A Director-only screen with two tabs — Product Costs and Delivery History — plus four counters at the top: how many products have a cost, how many cost entries exist, how many deliveries were recorded, and how many products are still missing a cost. You can filter by product type, category or search by name.

**Who uses it:** director

> **Worth knowing:** Entry is gated on the viewReports permission (Director only). Today the counters would read '0/192 products with cost data' and '192 products missing cost'.

### Record a Delivery — the landed-cost calculator

The Director records a shipment arriving at the Head Office warehouse: supplier, date, invoice number, the shipment-wide charges, then one line per product with quantity, unit cost, weight, packaging and labelling. The app works out what each unit truly cost once every charge is spread across the lines, adds the stock into the HO warehouse, and files a dated cost entry.

**Who uses it:** director

> **Worth knowing:** Always lands the stock into 'head_office' — you cannot record a delivery straight into a shop. Saving is one atomic write: stock, delivery, cost history and product cost all land together or none do.

### Shipment-wide charges: Shipping, Freight, and Tax & Duty

Three boxes on the delivery form for the charges that apply to the whole shipment rather than one product. The app splits them across the lines so each unit carries its fair share.

**Who uses it:** director

> **Worth knowing:** There is NO separate 'Customs' box — customs is meant to be entered inside 'Tax & Duty'. Older records could carry a customs value and the screens still display it if present (index.html:5617, :5668-5669), but nothing can create one any more.

### Packaging and labelling cost per product line

Each line of a delivery can carry its own packaging and labelling cost — the boxes, bags and stickers for that product — and those go straight into that product's landed cost.

**Who uses it:** director

### Split freight by weight (or by value if weights are missing)

If you enter a weight for every line, freight and shipping are split by weight — heavy things carry more of the freight. If any weight is blank, the app falls back to splitting by dollar value and shows a small amber warning under the landed cost. Tax is always split by value.

**Who uses it:** director

### Deliveries in a foreign currency

Pick USD, EUR or GBP on the delivery form and an exchange-rate box appears. You type every figure in the foreign currency; the app converts everything to Australian dollars and stores AUD as the real number, keeping the original foreign amounts alongside so you can tie it back to the supplier's invoice.

**Who uses it:** director

> **Worth knowing:** The rate is typed in by hand — there is no live exchange-rate lookup. If you later edit packaging on a foreign delivery, the edit must be entered in AUD; the screen warns you (index.html:5667).

### Higher-wins cost rule

When a delivery arrives, the app only raises a product's cost — it never lowers it. If the new shipment landed cheaper, the old (higher) cost is kept and the delivery detail shows 'No (kept existing)'.

**Who uses it:** director

> **Worth knowing:** SURPRISE worth Kunal's confirmation: this means a genuinely cheaper supplier will never bring the recorded cost down, so margins stay pessimistic forever until someone adds a manual cost entry.

### Edit Packaging & Labelling on a past delivery

If packaging or labelling costs come in after the delivery was recorded, you can go back and enter them; the app recalculates the landed cost and re-applies the higher-wins rule. It refuses the whole edit if any line is invalid, so you never get half a change.

**Who uses it:** director

> **Worth knowing:** Only packaging and labelling can be changed after the fact. Unit cost, freight, tax, shipping, quantity and weight are fixed once the delivery is saved.

### Money guardrails on every cost field

One shared rule checks every money box in the app: it must be a plain number, not negative, no more than $1,000,000, at most two decimal places — and it also refuses odd notations like '5e2' that would silently become 500. If the total landed cost of a line would blow the ceiling, the whole delivery is refused before anything is saved.

**Who uses it:** director (invisible; it just stops bad numbers)

> **Worth knowing:** The exchange rate deliberately uses a different rule from money (more decimal places, own upper bound of 100,000) because rounding a rate like 0.6523 to two decimals would corrupt the conversion.

### Margins tab (Settings > Margins)

A table of every product showing sell price, cost, the dollar margin and the margin percentage, green for profit and red for loss, with totals at the bottom. Products with no cost on file just show 'No data'.

**Who uses it:** director

> **Worth knowing:** With no cost data on file today, the whole table reads 'No data' and the prompt at index.html:4370 tells you to record deliveries first.

### Margin badge on the Cost Management table

Next to each product's sell price and cost, a coloured badge shows the margin percent — green above 40%, amber above 20%, red below.

**Who uses it:** director

> **Worth knowing:** A past bug read a field called sellPrice that never existed, so margins were always blank; the sentinel exists to stop that coming back.

### Franchise discount — per product

On Settings > Products a Director can pick a discount off the sell price for a single product when it is supplied to a franchise: 5, 10, 20, 25, 50, 75 or 100% (100% means free). The screen shows the resulting Franchise Price. This overrides the store-wide rate.

**Who uses it:** director (Head Office can add products but the discount is stripped out for them)

> **Worth knowing:** There is no 0% option — a blank means 'inherit the store rate', so a genuine 0% (full price) discount cannot be expressed at product level. On the working branch this edit becomes a server call once dated pricing is switched on; today it just saves locally.

### Franchise discount — the store/office-wide rate

Each franchise store and franchise office carries a single universal discount that applies to everything HO supplies it, unless a specific product overrides it. Cockburn and the Cockburn Franchise Office are set to 25%.

**Who uses it:** director / head office (this is what the franchise invoice bills off)

> **Worth knowing:** SURPRISE: there is NO screen anywhere to set or change this. The 25% on Cockburn is hard-coded seed data. Any new franchise store is created with no rate, and the invoice then bills it at 0% (loudly flagged as 'NOT SET', never silently). Also: Kunal's decided model has a middle tier — a rate per PRODUCT TYPE (retail 50% vs professional ~25%) — and that tier does not exist in the code at all.

### Franchise transfer pricing preview on Log Movement

When Head Office logs stock OUT to a franchise store, a purple panel on the confirm step shows the sell price, the franchise discount, the unit transfer price and the total value of that movement — so whoever sends it can see what will be billed.

**Who uses it:** head office / director

> **Worth knowing:** If no sell price or no discount is configured it just says 'No sell price or discount configured — set in Products & Stores'.

### Franchise Invoice Report

For a chosen date range, this lists everything Head Office actually supplied to each franchise office, line by line: product, date, quantity, sell price, the discount applied, the full value, the discount amount and the amount owed — plus totals. Anything the franchise bought elsewhere, returned, or received from another shop is excluded.

**Who uses it:** director

> **Worth knowing:** An office with no discount set is billed at 0% but is LOUDLY flagged as 'NOT SET' — never silently full price. Returns and credits are explicitly out of scope and handled separately.

### Cost-based management reports

Four money views that all read the dated cost record: Total Cost of stock actually used in a period (sales, in-house use and wastage only — moving stock between our own shops is not a cost); On-hand value at cost per store; Wastage valued at what it cost us rather than at retail; and the Store Comparison table's Gross Sales / Total Cost / On-hand columns.

**Who uses it:** director

> **Worth knowing:** Deliberately no profit or P&L figure anywhere — an earlier version wrongly counted every outflow as profit and it was removed. Items with no cost on file are counted as missing and flagged ('⚠ N w/o cost'), never as $0. With no cost data today every one of these reads zero.

### Sell price frozen at the moment of sale

When a sale or a customer refund is logged, today's sell price is written onto that movement and frozen, so raising a price next month does not retrospectively inflate last month's sales figures.

**Who uses it:** staff / store manager log it; director sees the effect

> **Worth knowing:** The code comment at index.html:2192 is now out of date — it says the snapshot is 'NOT pushed to SharePoint yet', but the UnitPriceAtTime column WAS added to the staging lists on 2026-07-23 (AZURE-CHUNK-ORG-STAGING-LEDGER.md, W4.4 Contract 1). Doc vs code disagreement worth fixing.

### Stock value — at retail on most screens, at cost on one

The Dashboard, Stock Overview and Settings > Stores all show a 'Stock Value' worked out at the SELL price. Reports > Overview shows a 'Total Stock Value' worked out at COST. Two different numbers under near-identical labels.

**Who uses it:** head office / franchisee / director

> **Worth knowing:** SURPRISE: this will confuse anyone comparing the Dashboard with Reports. Both say 'Total Stock Value'. Neither says which basis it is on.

### Suppliers and lead times

A Settings tab where a Director records who supplies each product, a contact, and how many days it takes to arrive. The Reorder List then groups everything that needs ordering by supplier and shows the lead time.

**Who uses it:** director

> **Worth knowing:** The Reorder List shows no money at all — quantities and lead days only, no cost of the suggested order.

---

## Managing users and stores

### User Management screen (Settings → Users)

A list of everyone who has a login: their name, username, role and which shops they are attached to, with an Edit and a Delete button on each row and an "+ Add User" button at the top. Only a Director can open it.

**Who uses it:** director only

> **Worth knowing:** Head Office CANNOT open this — there is no Users link in the Head Office menu and the page bounces you to Log Movement if you try. When cloud accounts are eventually switched on the screen gains a Status column (OK / failed attempts / 🔒 Locked / Inactive) and refreshes itself from the cloud; today that whole column is hidden.

### Add a user

Director types a full name, a username, a password and an optional 4-digit personal PIN, picks one of six roles, and ticks the shops that person works at. The account appears in the list immediately.

**Who uses it:** director

> **Worth knowing:** THREE gotchas. (1) If the PIN box is left blank the app silently sets that person's PIN to 1234 (index.html:3701) — no warning, no note on screen. (2) There is no minimum password length and no check on what characters a username may contain; those rules exist only on the not-yet-live cloud path (8 characters, 10 for Directors). (3) The new account exists only on the device that created it — adding a user does not send them to any other device.

### Edit a user (name, username, password, PIN, role, shops)

Change any detail of an existing account. Leaving the password or PIN box blank keeps the current one. You can move someone between roles and re-tick which shops they cover.

**Who uses it:** director

> **Worth knowing:** Taking a username someone else already holds is refused, and the last remaining Director cannot be demoted. Gotcha: promoting someone to Director or Head Office hides the shop tick-boxes but does NOT clear ticks already made — the old shop list is quietly saved with the account.

### Delete a user (becomes Deactivate once cloud accounts are on)

Removes someone's access. On the live app today the button says Delete and wipes the account row for good. Once cloud accounts are switched on the same button says Deactivate — the person can no longer log in but stays visible in the history and can be turned back on.

**Who uses it:** director

> **Worth knowing:** You cannot delete your own account, and you cannot delete the last Director. The delete only affects the device you are standing at — it does not remove anything from the cloud, and nothing stops that person logging in on another device.

### The six roles and what each one can do

Every account is one of: Store account (staff), Store Manager, Franchisee, Territory Manager, Head Office, or Director. The role decides the menu they see and roughly twenty separate permissions — who can do a stock take, who can create or receive a transfer, who can see cost prices, who can edit products, and so on.

**Who uses it:** everyone — it decides what each person sees

> **Worth knowing:** The six role names are fixed in the code — a Director cannot invent a new role from the app. "Staff" really means the shared shop computer, not an individual person. Also worth knowing: these checks live in the browser, so they stop honest mistakes, not a determined person with developer tools — that is exactly what the server phase is for.

### Assigning which shops a person can see

A tick-list of shops on the Add/Edit User form. Ticking nothing means "all shops". Head Office and Director accounts always see every shop regardless.

**Who uses it:** director sets it; everyone is affected by it

> **Worth knowing:** Warehouses are deliberately kept out of the tick list, so nobody can be attached to the Head Office warehouse. The Cockburn Franchise Office is the one exception, because it carries the special "franchise office" flag.

### Screen lock after 10 minutes, opened with a personal 4-digit PIN

If nobody touches the screen for ten minutes the app covers itself with a keypad and the person has to tap their own 4-digit PIN to get back in. Stops a walked-away shop computer being used by anyone.

**Who uses it:** everyone

> **Worth knowing:** Real gotcha: the lock screen has NO way out except the correct PIN — no Logout, no Cancel. If a person has no PIN it just says "No PIN set. Contact admin." and they are stuck (reloading the page is the only escape). And note that when cloud accounts are switched on, users created that way get NO personal PIN at all (index.html:3715) — so every one of them would hit that dead end on the first idle lock.

### Logging in  *(partly working)*

Username and password on the opening screen. The session lasts until the tab is closed.

**Who uses it:** everyone

> **Worth knowing:** The login screen is live. The cloud half of it — the server confirming who you are and telling the app what role you hold — is built, deployed to the staging cloud and tested, but never runs on a device.

### Login Audit

A Director-only list of every login made on this device, with the date, the person, what kind of device it was, and a 🆕 flag the first time a new device is used.

**Who uses it:** director

> **Worth knowing:** It only shows logins made on the device you are looking at — the on-screen banner says so. It is not a company-wide login log. The menu link existed for a long time with no page behind it; the route was only wired up in Wave G.

### 24-hour Stock Take PIN

A Director or Manager types a 4-8 digit number into Settings → Stock Take PIN and presses "Set PIN (24h)". Shop staff then have to enter that number to open Stock Take, and it stops working the next day. There is a Clear PIN button to end it early.

**Who uses it:** director / store manager set it; staff type it in

> **Worth knowing:** Big practical limit today: the PIN is saved and checked on the ONE device that set it. A PIN set on the Booragoon computer does not reach Claremont's computer. The all-shops version (PIN kept in the cloud, checked online) is built and tested but off. Also note the panel says "Current PIN: PIN is active" — it deliberately never shows you the number again, so write it down.

### Store Management screen

The list of every location: name, type, Active or Inactive, the current value of stock sitting there, plus Edit and Activate/Deactivate buttons and an "+ Add Store" button.

**Who uses it:** director and head office

> **Worth knowing:** Head Office reaches it from their own "Stores" menu item; Directors reach it from Settings → Stores. Both can add, edit and deactivate.

### Add a store

Type a short ID, a name, and pick a type from a dropdown (Inline, Kiosk, Franchise, Online, Warehouse). The app refuses a duplicate ID or a duplicate name.

**Who uses it:** director and head office

> **Worth knowing:** THIS IS THE WHOLE FORM — three fields. You cannot set a franchise discount, cannot mark it as a franchise office, and cannot say who owns it. New shops are created with no discount at all. Second gotcha: the ID rules on the device are looser than the cloud's (the cloud only accepts letters, numbers, _ and -, catalogueMerge.js:44), so an ID containing a full stop or an accent saves happily on the device and is then silently refused when you publish.

### Edit a store

Opens a box with exactly two things: the shop's name, and its type. That is all a Director can change about a shop from the app.

**Who uses it:** director and head office

> **Worth knowing:** SERIOUS GOTCHA. The save line recomputes "is this a franchise?" purely from the type dropdown (index.html:3552). The Cockburn Franchise Office has type Warehouse but IS a franchise. So opening Edit on the Cockburn Franchise Office and pressing Save — even changing nothing — turns its franchise flag OFF, and it drops out of Franchise Invoicing. Also: the shop's ID can never be changed, and the franchise discount is not on the form at all.

### Activate / deactivate a store

One button per row that switches a shop off (it disappears from every dropdown and from reports) or back on. There is no Delete.

**Who uses it:** director and head office

> **Worth knowing:** There is no way to permanently delete a shop from inside the app — the Store Management screen only offers Deactivate. Ardross and Bunbury were removed on 2026-08-02 by editing the seed directly, which is only safe because the app has never been used and they had no real history. Once the app is live, closing a shop must mean deactivate, never delete. Separately: once cloud delivery of the shop list works, removing a shop from the cloud list will NOT remove it from a device — the merge only adds and updates.

### Store types (Inline / Kiosk / Franchise / Online / Warehouse)

A label on each location. In practice only two of the five change anything: Warehouse hides a location from most shop dropdowns, and Franchise turns on the franchise badge and franchise billing. Inline, Kiosk and Online are just words on the screen.

**Who uses it:** director and head office

> **Worth knowing:** Worth saying out loud in training: choosing Kiosk instead of Inline changes nothing about how the app behaves. Choosing Warehouse does — that location vanishes from staff-facing shop pickers.

### The "is a franchise" flag

Marks a location as belonging to a franchisee rather than the company. It puts a purple "Franchise" badge next to the name, shows a 🔗 in dropdowns, feeds the "Franchise Stores" count on the dashboard, and decides who can be billed on the Franchise Invoicing screen.

**Who uses it:** director; visible to head office and franchisees

> **Worth knowing:** It cannot be ticked on its own — it is set automatically from the type dropdown, which is what causes the Franchise Office bug above.

### The "franchise office" flag — the entity you actually invoice

A separate marker that says "this is the franchisee's own warehouse / the business entity we send the invoice to", as opposed to the shop floor. The Cockburn Franchise Office is the only one. It is what makes Franchise Invoicing bill the office for stock Head Office supplied, rather than billing the shop.

**Who uses it:** director (billing); the franchisee sees their office in their own lists

> **Worth knowing:** THE BIG GAP IN THIS AREA. Nothing anywhere in the app can create or set a franchise office — not the Add Store form, not the Edit Store form, not the cloud. The single one that exists was typed into the starting data. So a new franchisee cannot be onboarded from the app at all today. The cloud's shop validation does not even know the field exists (catalogueMerge.js:59-64).

### Per-product franchise discount

The one discount a Director CAN change today. On Settings → Products there is a dropdown on each product row: —, 5%, 10%, 20%, 25%, 50%, 75%, 100% (free). Setting it overrides the shop's rate for that product; leaving it blank means "use the shop's rate".

**Who uses it:** director only

> **Worth knowing:** Fixed steps only — you cannot type 12.5%. A red ⚠ appears next to any product where neither the product nor the shop has a rate, because that line would bill at zero discount.

### Backup file — what happens to users and stores inside it

Settings → Data & Backup downloads the whole database as one file, and can restore one. Shops come back exactly as they were. Passwords and PINs do NOT come back — the app deliberately strips them out of the file.

**Who uses it:** director

> **Worth knowing:** REAL GOTCHA. Because password and PIN scrambles are stripped, restoring a backup onto a BRAND NEW device gives you the full user list with no way for anyone to log in (the device keeps its own login check separately, which is why restoring onto the same device is fine). The comment in the code at line 3928 still claims the hashes are "intentionally kept" — that comment is out of date; the code strips them. Worth testing before relying on a backup as the disaster plan.

### The stores and accounts the app starts with

A brand-new device loads a built-in starting list: 11 locations and 16 practice logins (kunal, shahin, logistics, a manager and a shop account per shop, and a Cockburn franchisee).

**Who uses it:** everyone — it is what a new device shows on day one

> **Worth knowing:** This list is WRONG and it is live on both branches. It still includes Ardross and Bunbury, both closed. It does not include the store-ownership facts. Every one of the 16 accounts already has a password and a PIN set. None of this is real data — nothing in the app has ever been used in anger.

---

## Sync, offline and backup

### Offline-first: the app saves to the device before it saves to the cloud

Everything staff type — a sale, a wastage, a delivery, a stock take — is written into a small database inside the browser on that phone or tablet first. The screen updates instantly and nothing waits for the internet. The cloud is a second step that happens quietly afterwards. That is why the app keeps working in a salon with bad wifi, and why nothing is lost if the wifi drops mid-shift.

**Who uses it:** staff / store manager / franchisee / director / head office — everyone, all the time

> **Worth knowing:** The local database is IndexedDB via Dexie. Reference lists (products, stores, users) are rewritten whole on each save because they are small; movement rows are added one at a time so it stays fast as the ledger grows.

### 'You are offline' red bar

A red strip appears across the top of the screen the moment the device loses internet, saying changes are saved locally and will sync when reconnected. It disappears by itself when the connection returns.

**Who uses it:** staff / store manager / franchisee / director

> **Worth knowing:** It reacts to the browser's own online/offline flag, which reports 'online' when the wifi is joined but the internet is actually dead. So the bar can say you are online when sync is in fact failing. The 'Retry' button on the bar just reloads the page.

### Manual cloud address entry, Test Connection, Force Push Now (Settings → Cloud Sync)

A Director can paste the two Power Automate web addresses in by hand, press Test Connection to check both directions work, and press Force Push Now to send everything immediately. This is the manual back-up route for when the automatic self-setup is not available.

**Who uses it:** director

> **Worth knowing:** This is the ONLY route by which the live app could sync today — and it is fragile: the pasted addresses go into session storage, so they are wiped the moment the tab or browser is closed and must be re-pasted every session. The on-screen setup guide still describes an old two-flow SharePoint-file design that does not match what the server actually does now.

### Offline app shell — the app opens with no internet

A small background program (a service worker) keeps a copy of the app's files on the device. If the network is down, the app still opens from that copy. It always tries the network first so staff get the newest version when they can, and falls back to the stored copy only when the network fails.

**Who uses it:** staff / store manager / franchisee

> **Worth knowing:** Network-first means that on a slow-but-alive wifi, every file waits for the network to time out before the stored copy is used — the app can feel very slow on bad wifi rather than instantly falling back. Cloud calls are deliberately never cached. The live site runs an older cache version (bob-stock-v10) that still pulls one library from an outside CDN; the working branch hosts everything itself.

### 'A new version is ready — refresh to update'

The app checks hourly for a newer version of itself. When one is downloaded it shows a small note asking the user to refresh. It does not force a refresh mid-shift.

**Who uses it:** staff / store manager / franchisee / director

> **Worth knowing:** If a user never refreshes, they keep running the old version indefinitely.

### Install to the home screen (add the app to a phone/tablet)

A banner offers 'Install BOB Stock — Add to home screen for quick access' with an Install button. Once installed it opens like a normal app with the Bang on Brows icon and colours, with no browser address bar.

**Who uses it:** staff / store manager / franchisee / director

> **Worth knowing:** The banner only appears once someone is logged in, and only in browsers that offer the install prompt — on iPhone/iPad Safari there is no such prompt, so staff must use Share → Add to Home Screen manually and will never see this banner.

### Ask the browser not to throw the data away

At startup the app asks the device to treat its local database as permanent. Without this, phones (especially iPhones) can silently delete a web app's stored data when space runs low.

**Who uses it:** staff / store manager / franchisee

> **Worth knowing:** It is a request, not a guarantee — the browser can refuse, and the app does not check the answer or warn anyone if it is refused.

### Manual backup: Download Backup (Settings → Data & Backup)

A Director can download the whole database as one JSON file. Before it saves, the app strips out anything reusable — login sessions, cloud addresses and keys, the live stock-take PIN — and stamps the file with a fingerprint so a later restore can tell if it has been edited or corrupted.

**Who uses it:** director

> **Worth knowing:** IMPORTANT DIFFERENCE between the live site and the working branch. LIVE (main): the export is NOT password-confirmed and it still INCLUDES staff password and PIN hashes — the toast even says so. Working branch: it asks for the Director's password first, and strips password/PIN hashes, head-office cost when not permitted, and the access policy. Until the working branch ships, a downloaded backup file is a sensitive document.

### Restore from a backup file, with an undo

A Director can pick a backup file and replace everything with it. The app first checks the file really is a BOB Stock backup, not a newer version, not corrupted, and that every product/store/quantity/price in it is sane — a single bad number rejects the whole file rather than being quietly rounded. It saves a safety snapshot of the current data first, so an '↩ Undo Last Restore' button appears afterwards.

**Who uses it:** director

> **Worth knowing:** Two limits worth knowing: the file must be under 5 MB, and the safety snapshot is kept in browser storage which is usually 5-10 MB total — so on a device with a long history a restore can refuse with 'could not save a safety snapshot first'. Also, the restore works by writing the file into the OLD storage location and reloading, letting the app's one-time upgrade routine import it (db.js:1298). It works, but it is indirect and would break if that upgrade routine were ever removed.

### Diagnostics log and download

The app keeps the last 200 errors and sync/storage failures on the device, with all PINs, passwords, tokens and web addresses blanked out. A Director can download it as a plain text file and send it to support without leaking anything.

**Who uses it:** director

> **Worth knowing:** The version stamp inside the diagnostics file is hard-coded to 'bob-stock-v10' (index.html:6311) while the app's actual cache version is v14 — so a support file will report the wrong version.

### 'Your changes may not have been saved' banner and the leaving-the-page warning

If a save to the device fails, the app retries three times with a growing wait, and if it still fails it puts a red banner across the top saying changes may not have been saved and not to close the tab. Separately, if someone tries to close the tab while a save or a sync is still in flight, the browser asks them to confirm.

**Who uses it:** staff / store manager / franchisee / director

### Recovery mode if the local database will not open

If the device's database cannot be opened at all, the app falls back to the last plain-text copy it kept and shows a blocking warning that the numbers shown are an old backup and must not be relied on. It never silently presents stale stock as current.

**Who uses it:** staff / store manager / director

---

## The local database and data safety

### The app's own database on each phone or PC

Every device the app is opened on keeps its own complete copy of the stock data inside the browser — products, stores, staff logins, stock movements, transfers, stock takes, deliveries and cost history. This is why the app is instant and why it still works with no internet. There are 13 separate lists (tables) in there today.

**Who uses it:** staff / store manager / franchisee / director / head office — everyone, invisibly

> **Worth knowing:** VERIFIED TODAY by downloading db.js from the live site: it is byte-identical to branch 'main' (1064 lines) and contains none of the newer server-phase features. The working branch adds a 14th table (recordSteps) that is NOT on the live site.

### Database upgrades that don't lose data  *(partly working)*

When we add a new list to the database, the app upgrades the existing one on the device in place rather than wiping it. Version 1 is what everyone has now; version 2 (which adds the transfer/delivery step diary) is written and waiting on the unreleased branch.

**Who uses it:** nobody directly — it runs silently the first time a device loads a new app version

> **Worth knowing:** Version 1 is live. Version 2 is built but not shipped. The upgrade itself has never been rehearsed on a device that already holds data — worth one deliberate test before the branch ships.

### First-run starter data (the seeded product and store list)

The very first time the app opens on a device with no data, it loads a built-in starting list of stores, product types, categories, products and user logins. After that it never seeds again.

**Who uses it:** whoever sets up a new device

> **Worth knowing:** The seeded store list is now 9 stores and matches the business. Cockburn's franchise discount is still seeded as a single flat 25 rather than the Retail 50% / everything-else 25% split Kunal decided on 2026-08-02, so any device set up fresh today still gets the wrong discount. Ardross and Bunbury were DELETED from the seed on 2026-08-02 (33 practice movements, 12 threshold entries and both store rows removed); test/check-seed-integrity.js now fails if either reappears.

### One-time move from the old storage format

Very old versions of the app kept everything in one big lump of browser storage. On first launch the app moves that lump into the proper database and keeps the original as a safety copy rather than deleting it. If the move fails it deliberately stops instead of quietly booting an empty app.

**Who uses it:** nobody directly — legacy devices only

> **Worth knowing:** This same code path is what makes 'Restore from backup' work: restore writes the backup into the old-format key and reloads, and this migration picks it up. So it is not really legacy — it is load-bearing for restore, and it is untested.

### Everything held in memory for instant screens

The whole database is loaded into memory before the first screen draws, so opening a report or a stock list is instant and never shows a spinner. Saving writes to memory immediately and to the device's disk in the background.

**Who uses it:** staff / store manager / franchisee / director / head office

> **Worth knowing:** The trade-off: memory and disk can briefly disagree. Most of db.js exists to make sure memory is rolled back whenever a disk write fails, so the screen never shows something that wasn't actually saved.

### Automatic retry when a save fails

If the device refuses a save (storage full, browser hiccup), the app tries three more times, waiting longer each time. If it still fails, a red bar appears across the top saying 'Your changes may not have been saved. Please do not close this tab.'

**Who uses it:** staff / store manager — anyone who saves anything

> **Worth knowing:** Four attempts total, at 0 / 0.5s / 1s / 2s.

### Full-screen 'SAVE FAILED — DO NOT CONTINUE' stop screen

If a save genuinely cannot be written to the device, the app throws up a dark red full-screen message telling the person to stop working and contact their administrator, with a Reload button. It is deliberately impossible to ignore.

**Who uses it:** staff / store manager / franchisee / director

> **Worth knowing:** Also used at startup if the database cannot be opened at all (index.html:6336) and in recovery mode.

### 'Data is still saving' warning when closing the tab

If someone closes the browser tab while a save or a sync is still in flight, the browser asks them to confirm first.

**Who uses it:** staff / store manager

> **Worth knowing:** Modern browsers show their own generic wording, not ours, and some ignore it entirely on mobile. Treat it as a courtesy, not a guarantee.

### Nothing is confirmed on screen until it is really saved

Every important action (log a movement, submit a stock take, record a delivery, delete a movement, save thresholds) waits for the device to confirm the save before it shows a success message, sends an email or moves the screen on. If the save fails, the change is undone in memory too, so the screen and the stored data never disagree.

**Who uses it:** staff / store manager / franchisee / director / head office

> **Worth knowing:** This is the single most important data-safety property in the app. It was added after an audit found the app was reporting success on writes that had not landed.

### All-or-nothing transfer save

When a transfer is received, several stock movements and the transfer record itself all have to be saved together. The app writes them as one unit — either they all save or none of them do, so you can never end up with stock added but the transfer still showing as in transit.

**Who uses it:** store manager / franchisee / head office

> **Worth knowing:** If it fails, the transfer object is restored from a snapshot the caller took before touching it.

### All-or-nothing delivery save

Recording a delivery updates stock movements, the delivery record, the cost history and the product cost prices. All four are saved as one unit; if any part fails, everything is put back the way it was.

**Who uses it:** director / head office

> **Worth knowing:** On failure it reloads the whole cache from disk rather than unpicking individual changes — safe but slow.

### Never records the same movement twice

Before anything is added, the app checks it isn't already there — both against what's already stored and against the rest of the same batch. This stops a double-tap, a retried sync, or a paginated download from creating duplicate stock.

**Who uses it:** staff / store manager / head office

### Deleting a movement leaves a permanent record

Deleting a stock movement doesn't just remove it — it writes a small 'this was deleted' record saying who deleted it, when and why. That record is saved in the same instant as the deletion, and it travels to the cloud so other devices learn about the deletion too.

**Who uses it:** store manager / director / head office

> **Worth knowing:** Works offline: a delete made with no internet still leaves a durable record queued for the next sync.

### Old delete-records tidied away after 30 days

Once a delete record has safely reached the cloud and is more than 30 days old, the app quietly removes it from the device so the database doesn't grow forever. The cloud copy is kept, so nothing is actually lost.

**Who uses it:** nobody directly — housekeeping at app start

> **Worth knowing:** Only prunes records already confirmed as synced — an unsynced delete is never touched.

### Ticking off what has reached the cloud

When the cloud confirms it has received a batch of movements, the app marks exactly those rows as 'sent' — it does not rewrite the whole database. If that marking fails, the rows stay marked unsent and get sent again next time (the cloud ignores duplicates).

**Who uses it:** nobody directly — runs during sync

> **Worth knowing:** This replaced an earlier version that rewrote all 12 tables on every successful push — a real performance bug found in audit.

### Cleaning risky characters out of names and IDs

Every time reference data is saved, the app strips angle brackets, quotes and backticks out of product, store, category, product-type and user names and IDs. This stops a booby-trapped name from doing anything when it is later shown on screen.

**Who uses it:** director / head office (they type the names)

> **Worth knowing:** GOTCHA FOR TRAINING: this silently removes apostrophes. A store or supplier called "Kunal's" will be stored as "Kunals". Nobody is told; the character just disappears.

### A product with no on/off setting counts as ON

If a product or store record arrives without an active/inactive flag, the app treats it as active. Only an explicit 'deactivated' hides it. This exists because a fresh install once showed 192 products and zero visible ones.

**Who uses it:** staff / store manager (they'd see an empty catalogue otherwise)

> **Worth knowing:** Both the seed loader and the every-load normaliser go through one shared function so the test can break a single point and prove the check bites.

### Rows with dangerous IDs are hidden from the screen

If a movement, transfer or delivery with a booby-trapped ID somehow got stored on a device before the checks existed, the app keeps it out of everything shown on screen. It does not delete it from disk — deleting would orphan whatever points at it — it just refuses to display it.

**Who uses it:** nobody directly — safety net

> **Worth knowing:** Because it is memory-only, the bad rows reload from disk on every start and are re-filtered each time. That is deliberate.

### Reloading from disk after a cloud sync

After the app downloads changes from the cloud, it re-reads the whole database from the device's disk and rebuilds the stock figures, rather than trusting what was in memory. That keeps the numbers on screen honest after a merge.

**Who uses it:** nobody directly — after every sync

### Download a full backup (Settings → Data & Backup)

A Director can download the entire database as a single JSON file. Before it is written, the app strips out anything reusable — login sessions, sync web addresses, password and PIN hashes, the live stock-take PIN — and stamps the file with a fingerprint so tampering can be detected later.

**Who uses it:** director

> **Worth knowing:** Requires a password re-prompt first. Export is deliberately blocked while a store-scope or policy clean-out is still pending, so a backup can never smuggle out data the device was told to drop. The file still contains full internal business data — it must be handled as sensitive.

### Restore from a backup file, with a gauntlet of checks

A Director can replace all data from a backup file. Before anything is touched the app checks the fingerprint, checks the file is ours and not from a newer version, checks every product/store/category ID is sane, checks every product points at a category that exists, checks every quantity and price is a legal number, and strips out any login material. Any single failure rejects the whole file — it never half-imports.

**Who uses it:** director

> **Worth knowing:** Max file size 5MB. Restore works by writing the backup into the old-format storage key and reloading — the startup migration then rebuilds the real database from it. That means a large restore can hit the browser's ~5MB storage-key limit before the database limit.

### Undo the last restore

Immediately before a restore overwrites anything, the app saves a snapshot of the current data. If the restore was a mistake, a Director can press 'Undo Last Restore' and get the old data back. If the safety snapshot cannot be saved, the restore is cancelled rather than done unsafely.

**Who uses it:** director

> **Worth knowing:** Only one level of undo, and only the most recent restore. The undo button only appears when a snapshot exists.

### Backup file tamper / corruption check

Each backup file carries a fingerprint of its own contents. On restore the app recalculates it; if someone edited the file in a text editor, or it got corrupted, the restore is refused with a clear message. Older backups made before this existed are still accepted.

**Who uses it:** director

> **Worth knowing:** It detects accidental corruption and casual editing. It is not a security seal — anyone who edits the file can recompute the fingerprint.

### The running stock number (how 'on hand' is worked out)

The app never stores a stock level. It adds up every movement to get the number, and keeps a running total in memory so screens are instant. That total is rebuilt from scratch whenever data is reloaded or a save is rolled back, so it can't drift away from the underlying movements.

**Who uses it:** staff / store manager / franchisee / director / head office

> **Worth knowing:** Quantities that are negative, fractional, absurdly large or not a number are skipped rather than silently coerced — a tampered row cannot poison the total.

### Disaster recovery if the database won't open

If the device's database is damaged and cannot be opened, the app falls back to the last full copy sitting in simple browser storage, and immediately shows a blocking warning that the numbers may be badly out of date and not to rely on them.

**Who uses it:** staff / store manager (they see the warning)

> **Worth knowing:** The fallback copy is whatever was there at the last migration or restore — it could be months old. The warning is deliberately alarming for that reason. Untested.

### Ask the browser not to throw our data away

At startup the app asks the browser to mark its storage as important, because phones (iPhones especially) can silently delete a website's stored data when space runs low.

**Who uses it:** nobody directly — protects every device

> **Worth knowing:** It is a request, not a guarantee — the browser can refuse, and it is fire-and-forget so we never find out whether it was granted. There is no low-storage warning anywhere in the app.

### Device-only by default — nothing leaves unless sync is set up  *(partly working)*

On the live app, data only reaches the cloud if a Director has typed the sync web addresses into the Settings screen — and those addresses are stored in a way that is wiped the moment the browser tab closes. So in practice each device is an island holding its own data until someone sets it up again that session.

**Who uses it:** director (sets it up); everyone (affected by it)

> **Worth knowing:** CRITICAL FOR TRAINING. Combined with the fact that the app has never been used, treat every device today as holding data that exists nowhere else. Exporting a backup file is currently the only reliable way to get data off a device.

### What survives a reinstall, and what does not

Uninstalling the app, clearing browser data, or the phone reclaiming space wipes EVERYTHING on that device: the whole database, the sync position markers, and the login. What survives is only (a) whatever had already been pushed to the cloud, and (b) any backup file that was downloaded and stored somewhere else. Closing the tab alone always wipes the login and the sync settings, but not the data.

**Who uses it:** staff / store manager / franchisee / director / head office

> **Worth knowing:** There is no warning anywhere in the app about this, and no reminder to take a backup. For alpha this is the single biggest data-loss risk: a staff member 'clearing their browser' to fix a slow phone destroys that store's history.

---

## The access policy system

### Built-in defaults when no policy exists (pre-activation)

Until a policy is ever published, the app behaves exactly as it always has, using the permissions built into the code. Nothing about the new system is visible or active. The instant a policy arrives, the built-in list stops being used entirely.

**Who uses it:** every role

> **Worth knowing:** This is the ONLY part of the whole area that is live today — and it is live because it is the old behaviour, not the new feature.

---

## Not working yet

These are built or part-built but are **not switched on**. Do not train staff on them and
do not rely on them. They are listed so everyone knows they exist and nobody rebuilds them.

**Logging in, roles and permissions**

- **Cloud-checked login (each account verified on the server)** — The newer version of login sends the username and password to the cloud, which checks it against the real account list held in SharePoint and sends back a signed 'pass' ticket. Your job title (role) comes back from the server, so someone editing their own device cannot promote themselves. If the server is reachable and says no, the login fails — it does not quietly fall back to the device copy.
- **Logging in with no internet (device-local password check)** — After one successful cloud login, the device quietly remembers a scrambled, deliberately slow-to-guess copy of the password so the same person can still sign in when the shop's internet is down. It is a one-way scramble — the real cloud password never leaves SharePoint — and it is left out of backups on purpose.
- **Cloud-published Account Access policy (overrides the built-in list)** — A Director can publish a permission sheet from the cloud that replaces the built-in defaults on every device. It answers each question in a fixed order: is there a specific exception for this person? then, do they hold the 24-hour PIN? then, what does their job type allow? Anything the sheet does not mention is refused — it errs on the side of saying no.
- **Per-account exceptions ('always allow' / 'always block' one person)** — Beyond the job-type defaults, a Director can pin an exception on one named account — e.g. Booragoon's store account is always allowed to do stock takes, or one account is always blocked from receiving transfers. An exception is final: it beats both the job-type default and the 24-hour PIN.
- **Account Access screen (Settings → Account Access)** — A Director-only tab showing a tick-box grid: capabilities down the side, job types across the top. Tick a box, add a per-person exception, choose which actions should re-ask for your password, then press 'Activate access policy' (or 'Publish changes'). A banner tells you whether the policy is live yet, and it warns in plain words that activating makes the basic store account need the 24-hour PIN to receive Head Office transfers.
- **Server-side permission decision (the real gate)** — The cloud has its own copy of the permission logic and makes the real decision when the app tries to write anything sensitive. Even if someone tampered with the app on their laptop, the cloud checks their signed pass against the current account record and refuses. A missing or unreadable policy means refuse, not allow.
- **Server-side policy validation and safety floors** — When a Director publishes a permission sheet, the cloud checks it before storing it: it refuses a sheet that would take permission-editing away from Directors (you cannot lock yourself out), refuses to relax the two settings that always require a password, refuses one that arrives out of date because another Director published in between, and stamps the version number itself so the app can never forge one.
- **Password re-prompt before dangerous actions (sudo)** — Before a small set of serious actions — publishing the catalogue, running the ledger archive, adding or changing a user, downloading or restoring a backup, changing account access — the app pops up 'Confirm your password'. That gives the cloud a fresh, single-purpose, 5-minute pass for that one action. Your password itself is never stored.
- **'Ask for my password again when…' settings** — On the Account Access screen a Director chooses which actions re-ask for the password and which are covered by simply being signed in. Two rows have a padlock and cannot be switched off: editing access policy, and user management. It is one shared setting for all Directors.
- **Clearing the PIN instantly kills every live unlock** — When a Director clears or changes the 24-hour PIN, every device that had already unlocked with the old one is shut out immediately rather than staying open until the 24 hours run out. Unrelated permission changes do NOT disturb a live PIN unlock.
- **Store account needs the PIN to receive a Head Office transfer** — Kunal's decision of 7 July 2026: once the cloud permission sheet is published, a basic store account can no longer receive a Head Office delivery on its own — it must key in the 24-hour PIN. The app offers the PIN box right there rather than a dead end. If a Director has explicitly blocked that account from receiving, it says so plainly instead of looping.
- **Server-enforced store isolation (Chunk 10)** — The newer work makes the cloud itself decide which stores a device may hold. When a device's store list changes, the app first pushes anything it hasn't sent yet, then physically deletes the other stores' records off the device and re-downloads only what it is entitled to. If that clean-out fails, the app locks backup exports rather than pretend it worked.
- **Cloud-managed accounts, lockout and Unlock** — When cloud accounts are switched on, this same screen changes character: it shows a green 'Accounts are managed in the cloud' notice, a live Status column (OK / 3 failed / 🔒 Locked / Inactive), and Unlock and Reactivate buttons. Five wrong passwords lock the account for 15 minutes, then 30, 60, 120, and Head Office gets an email. Deleting becomes Deactivating, so the audit trail keeps the person.
- **Price and cost visibility controls** — Four newer switches control what a person can SEE rather than do: cost prices, selling prices, older/archived data, and the cross-store comparison charts. Turning off 'see selling prices' hides the price column on screen AND leaves it out of the CSV downloads, so the two never disagree.
- **Automatic clean-up when someone loses access** — If a Director publishes a change that takes cost visibility or archive access away from an account, the device does not just hide the numbers — it deletes the cost figures and old records it had already downloaded. If that deletion fails, backup downloads are blocked until it succeeds, and it retries every sync.
- **Cross-tab pass relay** — If a manager approves something in one browser tab while a different tab is the one actually talking to the cloud, the approval pass is handed across in memory so the record isn't sent without it. Nothing is written to disk.
- **Device keys as the first door (Sync Keys screen)** — Before any person is checked, the DEVICE has to be recognised: a Director types a store id and store key (and, on a Director's own device, a Director key) into Settings → Sync Keys. Those keys also decide which store a cloud pass is tied to, so a pass minted on the Booragoon PC cannot be replayed from anywhere else.

**Logging stock movements**

- **Franchise price stamps when Head Office supplies a franchise directly** — Intended so that when Head Office pushes stock straight to a franchise store (without using the Transfers screen), the sell price, the discount and the pricing version are frozen onto that line at the moment it is logged — so a later price change cannot rewrite an old invoice. If the pricing information is stale or broken, the whole logging attempt is refused rather than guessed.
- **Archived movements can no longer be undone or deleted** — Once old movements have been rolled up and filed away by Head Office (the archive process), they are locked. Trying to Undo or Delete one gives 'This movement has been archived and can no longer be deleted.'
- **Cache-integrity health check** — A self-audit that re-counts every store and product from the movement diary the slow way and compares it against the fast running totals. If anything disagrees it reports the drift; it also cleans out totals for products or stores that no longer exist. A deactivated-but-still-existing product is left alone — its stock is real.
- **Sending a logged movement to the cloud** — Once saved on the device, a movement is supposed to be sent up to the company's shared list so other stores and Head Office can see it, and so the numbers are the same everywhere. The newer code also sends the from/to labels and the frozen sale price, which is what lets Head Office tell a sale from wastage centrally.
- **Server-side tamper seal on a movement row (EconSig)** — When a movement reaches the cloud, the server stamps an unforgeable seal across its economic details — quantity, product, type, dates, prices, source and destination. If anyone later edits the row directly in SharePoint, the seal stops matching and the row is exposed as altered.
- **Store-isolation guard at the moment of writing** — A safety catch: if a device somehow logs a movement for a store that account is not supposed to touch, the app flags itself for a data purge rather than quietly keeping the row.

**Stock takes**

- **Email the stock take to Logistics** — Every submitted stock take is supposed to email a formatted report to logistics@bangonbrows.com.au — store, date, who counted, total items, how many discrepancies, and a full product-by-product table with differences in red.
- **Server-checked PIN (one PIN for the whole company)** — The newer design moves the PIN to the cloud: the secret is kept on the server, the store device only ever learns when it expires, and typing the PIN is checked online. That means one PIN set once by a director works on every store device — which is what a salon manager would actually expect.
- **Password re-confirm before approving a stock take** — A design where approving a stock take asks the director to re-enter their password at the moment of approval, so a walked-away unlocked device cannot be used to sign off adjustments.
- **Stock takes shared between devices** — A design where a count done on the store computer also appears on the director's phone — the count, the approval and the rejection each travel to the cloud as their own small record, and every device rebuilds the same picture from them.
- **Server-side check that the person was allowed to count / approve** — A design where the cloud itself, not just the app on the device, checks that whoever sent a count actually had permission — and that an approval really came from a director.
- **Out-of-scope stock takes purged from a device** — If a person's store access is narrowed (say a manager stops covering a store), the app removes that store's stock takes from their device — but it refuses to do so while any of that device's work is still waiting to be sent to the cloud, so nothing is lost.
- **Stock take record IDs made collision-proof** — Each stock take gets a unique identifier. On the newer branch this is made from the time plus a random code so two devices cannot possibly mint the same one.

**Transfers between stores**

- **Draft transfers (build it now, send it later)** — A transfer can be parked as a draft: nothing leaves the shelf, the sender ticks Confirm on each line, adjusts quantities, then presses Submit & Send. Only confirmed lines are sent; unconfirmed ones are dropped. The screen and all the plumbing exist and work.
- **Auto-build a restock transfer from a stock take** — Intended to work like this: finish a stock take, and the app builds a draft transfer from Head Office topping every product back up to its optimum level. The logic is written and correct.
- **Email notification when a transfer is sent** — When a transfer is submitted, an email is meant to go to logistics listing the from store, to store, who sent it, every product and quantity, and the totals.
- **Email notification when a transfer completes** — When a transfer finishes — either cleanly received or after a Director settles the discrepancies — an email summarising sent vs received per product, plus every flagged line with the Director's decision, note and name, is meant to go out.
- **Transfers appearing on other devices (cross-device transfer sync)** — Today a transfer only exists on the device that created it plus whatever the stock movements carry. This feature makes the transfer record itself travel: each step (sent, received, resolved, cancelled) is published to the cloud, and any other device rebuilds the whole transfer from those steps in the right order regardless of which one arrives first. That is what lets the receiving store see an incoming transfer that was created on a Head Office laptop.
- **Two devices received the same transfer with different counts (conflict) + the Director's Resolve Receive Conflict screen** — If the shop PC counts 8 and someone's phone counts 6 for the same delivery, the app does not silently pick one. The transfer is marked as a conflict and a Director gets a screen showing each device's count side by side per product, with a note that stock currently reflects whichever count synced first. The Director picks the correct number for each line and only the difference is adjusted — no double counting. If both devices counted the same, it is treated as a harmless duplicate and nobody is bothered. A cancel racing a receive is also treated as a conflict.
- **Warning when a receipt is recorded but the stock has not landed** — A transfer is never shown as cleanly 'Completed' if its stock movements have not actually reached this device or were rejected by the server. Instead it shows an amber 'stock hasn't synced yet — this clears itself' note, or a red 'the stock did NOT land, contact your administrator, do not rely on these numbers' warning. The point is that the app must never claim stock is on the shelf when the underlying movement failed.
- **The franchise supply gate — a Head Office to Cockburn transfer can be BLOCKED at submit** — Sending stock from the Head Office warehouse to a franchise store is the moment the franchise gets charged for it, so the app refuses to send until it is certain it knows the current franchise pricing. It blocks ONLY that direction: sender must be the Head Office warehouse (or any non-franchise warehouse-type store) and the destination must be flagged as a franchise — so Head Office to Cockburn, or Head Office to the Cockburn Franchise Office, is gated, while Cockburn sending anything back, and any shop-to-shop move, is completely untouched. It blocks when: the device is offline; the device has not had a successful, confirmed pricing check since the last thing that could have changed pricing ('This device needs a fresh sync before sending stock to a franchise store'); the device was restored from a backup and has not synced since ('needs one successful sync before franchise supply can be sent'); or the pricing setup is out of date or broken ('a Director should check the pricing setup'). It does NOT block on a device that has confirmed with the server that franchise pricing simply is not set up yet — that is a legitimate answer, and the old flat-percentage method is used.
- **Freezing the franchise price on the transfer at the moment it is sent** — When Head Office supplies a franchise, each line records the sell price and the franchise discount that applied on that day, and locks them onto the record forever, so a price change next month never rewrites what the franchisee was already billed. If the price or discount cannot be worked out, the transfer is refused rather than freezing a wrong or zero value. A transfer that was already in transit when this was introduced gets its prices worked out at receipt, using the rates that applied on the day it was SENT (not the day it arrived).
- **PIN unlock to receive a transfer on a shared store computer** — Under the future per-account access rules, a basic shared store account will not be able to receive a Head Office transfer without a manager entering a 24-hour PIN. Instead of a dead-end 'no access' message, the app offers the PIN box right there and carries on with the receipt once it is entered. If a Director has explicitly switched receiving off for that account, the PIN cannot override it and the app says so plainly instead of looping.
- **Password re-confirmation before resolving a discrepancy** — Settling a discrepancy moves stock and money, so under the future access rules the Director is asked to re-enter their password to confirm the action. Cancelling that prompt abandons the resolution and nothing is written.
- **Incoming transfers survive a store-access change** — When a device's list of permitted stores changes (a franchisee sale, a store closing) the app clears out data for stores it should no longer hold — but it deliberately KEEPS any transfer where either end is still one of your stores, so a box already on its way to you is still receivable.

**Reports, analytics and exports**

- **Era-aware (dated) franchise discount on the invoice** — The fix for the biggest money problem: instead of one current discount, each franchise discount has a dated history, and each invoice line is priced at the discount that applied ON ITS OWN DATE. Change Cockburn's rate today and last quarter's invoice does not move. It also falls back safely: if the rate for a date is missing or corrupt, the line is billed at 0% and flagged in red rather than silently guessed.
- **Frozen price and discount stamps on supplied stock** — When Head Office submits a transfer to a franchise, the app freezes the sell price and the discount onto that transfer then and there. The invoice bills those frozen figures forever, so editing a price months later cannot rewrite an old bill. If only half the frozen figures are present the line is refused loudly rather than guessed.
- **Archive-aware reporting (banner + Load archived data)** — Once old movements are archived off the device, any report whose date range reaches back that far shows an amber warning saying the totals do NOT include the older movements, with a 'Load archived data' button for anyone allowed to see archived history. Once loaded it turns green and confirms the totals now include them.
- **Buy-back settlement export (server engine)** — The money report for when Head Office buys a franchise back: it works out exactly what is owed for stock, usage and retail profit over an ownership period. It refuses to produce a final number if the evidence is incomplete - it either returns a 'provisional' figure with the blockers named, or refuses outright, but never a quietly wrong number.
- **Who can see which report (the permission gates)** — The rules that decide which reports each role sees: only a Director sees cost prices, margins and the profit-bearing reports; franchisees and above see the store-comparison charts; territory managers and above can load archived history; selling prices are visible to everyone by default. A Director can change these on the Account Access screen.

**Products, categories and stock levels**

- **Dated / era-aware franchise pricing (the "pricing lens")** — The grown-up version of franchise discounts: instead of one number that overwrites history, every rate change is recorded with the date it started, so an invoice for March is always worked out at March's rate even if the rate changed in June. It also refuses to guess — if the pricing information is missing or out of date it stops rather than billing at the wrong rate.
- **Who is allowed to see prices and costs on the product screen** — The Sell Price column can be hidden from people who shouldn't see it, and the Cost Price / Franchise Discount / Franchise Price columns only appear for someone allowed to see cost — today that means directors only.
- **Publish Catalogue (sending product changes to every device)** — A director-only "Review & Publish" button that shows how many unpublished changes are waiting, lists exactly which products/stores/categories will go out, asks for the director's password, then sends them to the cloud so every other phone and PC picks them up. It reports honestly — if the server rejects a row, that row stays in the waiting list.
- **Cloud checks on published catalogue changes** — Before a product change is accepted into the shared catalogue, the cloud re-checks it: the code must be sensible, the name must not be blank, the price must be a real amount with at most 2 decimals, the category must actually exist and still be active, the Retail/Consumable value must be one of the two allowed, and a franchise discount must be between 0 and 100. It also refuses a change if someone else edited the same product in the meantime, and it always strips cost out before the product goes public.
- **Receiving catalogue updates from the cloud** — When the app starts it is supposed to fetch the shared product list and quietly fold in any new or changed products, prices, categories and stores — without ever deleting something a director added locally, and without letting a bad row through.
- **Unused fields carried on every product record** — Every product record quietly carries a weight, freight, customs and tax field, plus a retired "internal use" tick. Nothing in the app ever shows, edits or reads any of them.

**Costs and pricing**

- **Delivery History and delivery detail** — The second tab of Cost Management lists every delivery — date, supplier, invoice number, how many lines, the total shipment charges and who recorded it. A View button opens the full breakdown per product: quantity, unit cost, packaging, labelling, its share of the shipment charges, the final landed cost and whether it updated that product's cost.
- **Server-side delivery money check** — When a delivery is sent to the cloud, a small server program re-checks every money figure on it before it is allowed to be stored — so a tampered or broken device cannot push negative or nonsense costs into the company record.
- **Frozen invoice pricing (price and discount stamped at the moment of supply)** — When stock is sent to a franchise, the app writes today's sell price AND today's discount onto that movement and freezes them. That way, changing a price or a discount next month can never rewrite what an old invoice said. If it cannot work out a trustworthy pair of numbers it refuses to send the stock rather than guessing.
- **Dated / era-aware franchise pricing (the pricing lens)** — The proper version of franchise discounts: instead of one current percentage, the discount is a dated history, so every past invoice line is priced with the rate that applied on ITS OWN date. Changing a discount today opens a new period and leaves the past alone. It looks up a store-and-product rate first, then a company-wide product rate, then the store's default rate.
- **Server pricing engine (as-of rates, append-only history, era alignment)** — The cloud half of dated franchise pricing: it works out which rate applied on a given date, adds a rate change by closing the old period and opening a new one (never editing the past), refuses backdating, and checks that franchise rates only ever cover the periods a store was actually a franchise.
- **Pricing commit gate — blocks franchise supply from a stale device** — Before Head Office can send stock to a franchise, the app checks that this device has a genuinely fresh, connected view of the current pricing. If it has been offline, or was just restored from a backup, or the pricing data looks wrong, it blocks the send with a plain message telling you to sync first — rather than billing the franchisee off stale numbers.
- **Publish a pricing change to the server** — The route a discount change is meant to take once dated pricing is on: the change goes to the server, which adds the new dated period, and the app only reports success once it has read the new pricing back. If it cannot reach the server it refuses the edit outright rather than saving a local number that would disagree with the company record.
- **Who can see cost prices, and who can see selling prices** — Two separate switches. 'See cost prices' is Director-only and controls the Cost Price and franchise-pricing columns. 'See selling prices' is on for everyone by default and controls the Sell Price column — including in the exported spreadsheet, so the screen and the export can never disagree.
- **Cost is stripped out of the shared product catalogue** — When the Director publishes product changes to all devices, cost prices are deliberately removed from that shared update — both by the app before sending and again by the server before storing. Cost travels only on its own private, permission-checked channel, so a franchise device can never pick up Head Office's buying prices from the ordinary catalogue.
- **Corporate costs served separately and permission-checked** — Company cost prices are held in their own protected cloud item and handed out only to a Head Office / Director device. A franchise store's device never even asks for it, and the server refuses it anyway — so a franchisee keeps their own costs and never sees ours.
- **Cost is wiped from a device when cost access is taken away** — If a Director publishes a change that removes someone's permission to see costs, the cost figures already sitting on that device are scrubbed from it, not just hidden. Until the scrub succeeds, downloading a backup is blocked so the costs cannot escape in a file. Backups also strip costs for anyone without cost access.
- **Buy-back export — the money owed when Head Office takes a franchise store back** — A server-side export that, for a date range, lists what Head Office supplied a franchise and what is owed, plus an informational retail-profit summary (their sales revenue less the supply cost). The profit part is clearly marked as informational because sale prices come from the shop's device and cannot be independently proven.

**Managing users and stores**

- **Unlock a locked-out account / Reactivate a switched-off account** — If someone types their password wrong too many times the cloud locks the account; the Director sees a red 🔒 Locked badge and an Unlock button. A deactivated person gets a Reactivate button.
- **Passwords** — Passwords are never stored as readable text. Today the app scrambles the password on the device and compares it with the scrambled copy kept in that device's own database. A stronger version — the password checked by the cloud, with a slow-to-crack offline copy for when there is no internet — is fully written and tested but not running anywhere.
- **"Confirm your password" re-prompt before risky actions** — Before adding or removing a user, publishing changes, taking a backup or changing access rules, the app is meant to ask the Director to type their password again.
- **Account Access screen — the permission grid** — A Director-only screen with a grid: every job ("Do stock takes", "See cost prices", "Receive transfers"…) down the side, every role across the top, and a tick box in each square. Underneath it you can add per-person exceptions ("Booragoon's shop account is always allowed to do stock takes") and choose which actions should re-ask for your password.
- **A store's franchise discount (what the franchisee pays)** — The percentage off retail that a franchisee is charged when Head Office supplies them stock. Cockburn is set to 25%.
- **Dated franchise pricing — a rate history instead of one number** — Built so that each invoice line is priced at the rate that applied on the day of that movement. Change the rate today and last month's invoices stay exactly as they were. Rates can be set for a whole shop, or for one product at one shop.
- **The store / franchise change wizard (server half only — no screen)** — The rules for the five real business events: open a new company shop, hand a shop to a brand-new franchisee, add another shop to an existing franchisee, convert a company shop into a franchise, and buy a shop back. It works out which logins to cancel, which to create, and where the ownership line falls.
- **Store isolation — a device only holds its own shop's data** — The cloud tells each device which shops it is allowed to keep, and anything belonging to another shop is wiped off that device. If a shop changes hands, the old owner's device is emptied of that shop's history. Any unsent work is pushed up first so nothing is lost.
- **Sync Keys — authorising a device for a shop** — On Settings → Cloud Sync a Director picks which shop this device belongs to and types in that shop's key once. Directors' own phones/laptops get a Director key instead and need no shop key. Keys are never shown back on screen.
- **Publishing store changes out to every device** — "Review & Publish" on Settings → Cloud Sync sends the Director's product, price and SHOP changes out to all the other devices. It shows how many changes are waiting and when you last published.
- **Cloud account administration (the server side of user management)** — The cloud service that actually owns accounts: create a person, set their password, deactivate, reactivate, change their role and shops, unlock them, and list everyone. Passwords are scrambled on the server and never leave it.
- **Why none of the cloud user/store features are on — the settings channel** — There is one channel that is supposed to hand each device the addresses of all the cloud services, plus the shop list, the permission grid and the pricing rates. That channel has never worked. Every cloud feature above is waiting behind it.

**Sync, offline and backup**

- **Automatic background sync (save → 0.8s pause → send; plus a check every 30 seconds)** — After anyone records something, the app waits about a second (so a burst of quick entries goes as one batch) and then sends it up. Separately, one tab on the device checks the cloud for other stores' changes every 30 seconds. Nobody has to press anything.
- **'Sync now' button and the 'Stock last synced' label** — A ⟳ Sync now button in the sidebar (and a ⟳ Sync button in the mobile top bar) forces an immediate send-and-fetch. Underneath it a line reads 'Stock last synced: 4m ago' so a manager can see at a glance whether the numbers on screen are current.
- **Auto-sync the moment the internet comes back** — When the device reconnects, the app waits 2.5 seconds (so a flapping connection cannot trigger a storm) and then automatically sends everything that piled up while offline.
- **Sending work up (push) with an honest receipt from the server** — When the app sends movements up, the server replies row by row: accepted, already had it, permanently rejected, or temporarily failed. The app only ticks a row off as 'sent' when the server actually confirms it. If the reply is vague, contradictory, or leaves any row unaccounted for, the app refuses to tick anything off and tries again — it will never show 'Synced ✓' over work that did not land.
- **Junk never leaves the device (egress check)** — Before anything is sent to the cloud the app re-checks each row against the same rules it uses when data arrives: sensible quantity, a real product, a real store. Anything that fails is held back and flagged, so one corrupted row on one tablet can never poison every other store's numbers.
- **Fetching other stores' work down (pull), paged safely** — The app asks the cloud 'what is new since row number X?' and walks forward a thousand rows at a time. It freezes a ceiling at the start of each round so rows arriving mid-fetch cannot make the walk go on forever, and it deliberately re-reads the last hundred rows each time in case one was still being written last round. It only moves its bookmark forward once every page has been safely saved to the device — so a failure mid-fetch loses nothing, it just re-fetches.
- **Bad data arriving from the cloud is quarantined, not swallowed** — If a row comes down with a negative quantity, a nonsense product, or an ID containing characters that could break the app, it is put aside and logged rather than merged. The app never quietly rounds or 'fixes' a bad number, because a silently fixed number is a wrong number nobody notices.
- **Deletes travel between devices (tombstones), including deletes made offline** — When someone deletes a movement, the app does not just remove it — it writes a small 'this was deleted' marker that syncs like any other row. That is how the delete reaches the other stores' devices. It works offline too: the marker sits in the queue until there is internet. Old markers that have already synced are tidied away after 30 days.
- **The offline queue survives closing the app** — There is no separate 'outbox' screen — unsent work is simply every row on the device not yet ticked as sent. A flag is kept on the device saying 'something is still waiting', so if a manager closes the app on Friday with unsent work and reopens it Monday, the app pushes it at launch before doing anything else.
- **Retry with a growing wait, so a flaky connection heals itself** — If a send fails, the app retries after 2 seconds, then 4, then 6, showing 'Sync failed, retrying (1/3)'. After three tries it stops and leaves the work queued for the next cycle. A separate three-second nudge covers the rarer cases where the send worked but the device could not record that it worked.
- **One operation at a time (the sync lock)** — Sending and fetching are never allowed to run on top of each other on one device — the second one waits or is queued. Without this, two half-finished operations could leave the device's bookmark in the wrong place and skip rows permanently.
- **Only one browser tab does the syncing (leader election)** — If someone has the app open in three tabs, only one of them talks to the cloud. The tabs elect a leader by messaging each other; the leader announces itself every 4 seconds, and if it goes quiet for 10 seconds (tab closed, phone backgrounded) another tab takes over. The other tabs just refresh their screen when the leader brings new data down.
- **Tabs keep each other up to date** — When the syncing tab brings down new data it tells the other tabs, which reload their view. When a non-syncing tab records something, it tells the leader so the work gets sent promptly instead of waiting for the next 30-second cycle.
- **'Not authorised' pause — no retry storm** — If the cloud refuses the device (wrong or rotated keys), the app stops syncing entirely instead of hammering the server every 30 seconds. It shows 'Sync not authorised — enter sync keys in Settings' and stays paused until a Director enters new keys. Work already queued stays queued and is not lost.
- **Device sync keys (Settings → Cloud Sync → Sync Keys)** — A Director enters a key on each device once, and picks which store that device belongs to. Store tablets get their store's key; the Director's own devices get a Director key. The keys are stored on the device and never shown back on screen, never included in a backup, and blanked out of the diagnostics file.
- **Cloud config channel — the app's self-setup line** — On startup the app is meant to phone one fixed address and be told everything else: where to send data, where to fetch it, the master product/store/price list, who can see what, the franchise discount rates, and the opening stock snapshot. It is the pipe that carries almost every centrally-controlled setting to every device.
- **Record-steps sync — transfers, deliveries and stock takes travel too** — Beyond raw stock movements, the lifecycle of a transfer (submitted → received → conflict → resolved) is synced as its own stream of small immutable steps, so any device can rebuild the same picture of a transfer. Critically, a step that claims stock moved is held back until the actual stock rows it depends on are confirmed in the cloud — so a receipt can never claim stock arrived before the stock itself landed.
- **Store-scope reconcile — a device only holds data for its own stores** — Each time it fetches, the device is told which stores it is allowed to see. If that list changes (a store is sold, a device is reassigned, or isolation is switched on for the first time), the device first pushes anything still waiting, then wipes the data it is no longer entitled to and re-fetches from scratch. If it cannot push first, it refuses to wipe and locks backups until it succeeds — it would rather stay unreconciled than lose a shift's work.
- **'Store update in progress' hold** — When Head Office is mid-way through a store ownership change, the cloud tells devices for that store to pause fetching. Staff see a calm 'Store update in progress — syncing will resume shortly' rather than errors, and the device's bookmark is left untouched so nothing is skipped. Sending work up still works.
- **Head-office cost prices fetched separately (and only to head-office devices)** — Cost prices are not sent out with the public product list. A separate, gated fetch delivers them, and only to company-owned/Director devices — a franchise device skips it entirely and keeps its own cost figures.
- **On-demand archive fetch for old movements** — Once old movements have been archived out of devices to keep them fast, a Director or Head Office can still pull a date range back from the cloud archive to run a full-history report. Deleted rows and their delete-markers are stripped out on the way in so report totals still add up.
- **Background sync and push-notification hooks** — The app asks the browser to nudge it to send queued work even when the app is not open. There is also unused plumbing for push notifications ('Stock data updated').

**The local database and data safety**

- **Rows the cloud permanently refuses are parked, not retried forever** — If the cloud rejects a row outright (bad shape, unknown product, dangerous ID), the app marks it as refused with the reason and stops resending it, instead of hammering the cloud forever in silence. An administrator can see why.
- **The transfer / delivery / stock-take step diary** — Instead of only storing 'this transfer is now received', the app stores each step as its own permanent entry — created, submitted, received, flagged, resolved — and rebuilds the current state from those steps. Two devices can act at once and the history still rebuilds correctly.
- **Shrinking the device once Head Office archives old history** — Once Head Office archives old movements into the cloud and publishes an opening-balance summary, the device can drop the individual old movements it no longer needs and just start from the summary. Stock totals stay identical; the device just carries less. It only ever drops rows it has confirmed are safely in the cloud.
- **Clearing out a store's data when a device no longer covers it** — If a device's list of stores changes — a franchise is sold, a store is handed over — the app deletes that store's movement data from the device so it can't be seen any more. Shared things like the product catalogue stay. Transfers touching a store you still have are kept, so an incoming delivery doesn't vanish mid-flight.
- **The clean-out refuses to run if anything hasn't reached the cloud** — Before deleting a store's data off a device, the app checks that nothing it is about to delete is still waiting to be sent to the cloud. If anything is pending, it refuses, changes nothing, and tries again after the next successful sync. That means a franchise handover can never silently destroy movements a store logged offline.
- **Locking a device that writes to a store it no longer owns** — If someone has an old screen open and saves something for a store the device no longer covers, the app notices at the moment of the save and arms the clean-out, rather than letting the stray data sit there. It also re-checks on every sync cycle.
- **Stock-cache health check** — There is a self-check that recounts every product in every store the slow way and compares it with the fast running total, reporting any disagreement and clearing out entries for products or stores that no longer exist.
- **Wipe the local database** — There is a function that deletes the whole on-device database and reloads the app fresh.

**The cloud brain (Azure Functions)**

- **Store device key check (validateKeys)** — When a tablet in a salon tries to send or fetch stock data, the cloud first checks the secret key that device was set up with. It answers a plain yes/no for the store's own key and for the Head Office 'Director' key. It never tells the caller anything else — no hints an attacker could use to guess a key. If the checker is broken or unreachable, the answer is treated as NO, so a broken check locks people out rather than letting them in.
- **Person login check + 12-hour session pass (validateUser)** — Checks a person's username and password against the staff list held in the cloud, and if correct hands back a short-lived digital 'pass'. A normal login pass lasts 12 hours. For anything risky — publishing prices, archiving, adding users, approving a correction — it instead issues a single-use pass that lasts only 5 minutes and only works for that one job. Locked or deactivated accounts are refused, and a made-up username takes exactly as long to reject as a real one, so nobody can fish for valid usernames.
- **Pass checker (verifyProof)** — Every later request carries the pass instead of the password. This route confirms the pass is genuine, has not expired, was issued for the job being attempted, and was issued to this device. It means a password only ever travels at login time, never again.
- **Create a login / set a password (mintUserCredential)** — When Head Office creates a new staff login or resets a password, this route does the password scrambling on the server rather than on a laptop. It enforces a minimum password length (10 characters for a director, 8 for everyone else) and hands back the scrambled value to be stored.
- **The one permission decision point (evaluateAccess)** — The single place the cloud decides 'is this person allowed to do this?'. It works through the rules in a fixed order: a specific permission set for that individual person wins outright; otherwise a temporary 24-hour PIN can unlock stock-take counting and transfer-receiving only; otherwise the default for their role applies. If no rulebook has been published, or the request is malformed, the answer is NO. The permission tickboxes inside the app are only a preview of this — this is the real gate.
- **Publish the permission rulebook (policyMerge)** — When the director changes who can do what and hits publish, this route checks the new rulebook before it goes out. It refuses a rulebook that would delete the director role, refuses one that would lock directors out of editing permissions ever again, and refuses one that would downgrade the two protected jobs (editing permissions, managing users) from 'must re-enter your password' to anything weaker. It also stamps the version number itself so a device can never fake one, and blocks a save if someone else published in the meantime.
- **24-hour stock-take PIN (validatePin)** — The director can set a short PIN that lets ordinary staff count stock and receive transfers for up to 24 hours without a manager present. This route checks the PIN and issues a pass tied to that specific account and device, expiring when the PIN does. Clearing the PIN is an instant kill switch — every pass already handed out stops working immediately, but ordinary permission edits do not disturb a PIN unlock in progress.
- **Tamper seal on every stock movement (attestRows)** — Every stock movement — a sale, a transfer, an adjustment — gets a cryptographic wax seal stamped by the server the moment it arrives. The seal covers 19 details: which store, which product, how many, the date and time, the reason, where it came from and went to, and the pricing that applied. If anyone later edits any of those directly in the underlying spreadsheet, the seal breaks and the money engine can see it. If the sealing service is down, the whole batch is refused and the device retries — a movement is never allowed to land unsealed.
- **Extra seal types for corrections and archiving (attestRows new frames)** — Four additional kinds of wax seal, built to support the correction feature: one for a correction record itself, one for the archive 'era' marker, and two others. They stamp different sets of details but work the same way.
- **Franchise buy-back settlement engine (buybackExport)** — When Head Office buys a store back from a franchisee, this works out exactly what is owed. It walks every stock movement in the window, applies the franchise discount that was in force on each individual date, and produces a line-by-line bill plus totals, a usage tally, and a separate informational retail-profit view. Crucially it will NOT sign off a final number it cannot stand behind: it either refuses outright (something is corrupt), marks the result PROVISIONAL and names exactly what is blocking it, or declares it FINAL. There is no 'quietly a bit wrong' outcome.
- **Product and store list publishing (catalogueMerge)** — When Head Office adds a product, renames a category, changes a price or adds a store, this route checks and merges the change before it goes out to every device. It rejects prices that are negative, absurdly large or have more than two decimals, rejects a franchise discount over 100%, rejects a product pointing at a category that does not exist, and rejects a store type that is not one of inline, kiosk, franchise, online or warehouse. It detects two people editing the same row at once, and it stamps the version number itself.
- **Correction and deletion brain (correctionCompute)** — The decision engine behind a director correcting or deleting a stock movement after the fact — working out what the corrected quantity should be, minting the replacement record, deciding whether a correction can legally be made in the current state, and making sure the same correction submitted twice does not apply twice. It is a pure calculator: it never touches the data itself, it just decides.
- **Archive the old ledger safely (snapshotCompute)** — The stock ledger cannot grow forever, so old movements get moved to an archive. Before anything is moved, this route calculates the opening balance to carry forward and then PROVES the maths adds up: for every store-and-product combination, opening balance plus what is left must equal what was there before. If a single pair is off by one, it returns a refusal and nothing is archived — the live ledger is left untouched.
- **Ownership change planner (topologyPlan)** — The single brain behind the store wizard. Give it one instruction — create a store, onboard a brand new franchisee, add another store to an existing franchisee, convert a Head Office store to a franchise, or buy a franchise back — and it works out everything that must happen: who owns the store from when, which franchise rate starts, which logins gain or lose access to that store, which personal staff logins get cancelled, whether an opening stock snapshot is needed, and whether a buy-back settlement must run. It refuses anything that does not add up, such as converting a store to a franchisee whose office login has been deactivated.
- **Who owned it, and at what rate, on that date (topologyResolve)** — A lookup the reports use: for any date, who owned this store then, and what franchise discount applied to this product then. Rates are kept as a dated history that is only ever added to, so a report about last March uses last March's rate even if the rate changed since. The discount can be set as one rate for the whole store, with a per-product rate overriding it for specific items.
- **Delivery money checker (validateMoney)** — When a delivery is recorded with costs — freight, tax, shipping, customs, unit costs, a foreign-currency rate — this route checks every money figure before it is saved: it must be a real number, not negative, no more than 10 million, and at most two decimal places. Any delivery step that fails comes back flagged and is rejected.
- **Every route is locked behind a key** — None of the 15 routes can be called by an anonymous stranger on the internet. Each one requires a secret function key that only the Head Office workflows hold. There is no public endpoint anyone could poke at to guess passwords or fish for data.
- **Broken security service = locked out, not let in** — If the secret used to check passwords or seals is missing or misconfigured, the route returns an error rather than a yes — and the calling workflow treats any error as a refusal. So a misconfiguration or an outage stops work; it never silently waves people through. The one deliberate exception is the delivery money checker, because the app double-checks that itself.
- **Anti-guessing protections** — Password and PIN checks always take the same amount of work whether the username exists or not, and always return the same unhelpful answer, so nobody can tell a real login from a fake one by timing or wording. Comparisons are done in a way that cannot be probed character by character. Seal-verification answers are a bare yes/no with no detail attached.
- **Request size limits** — Each route caps how much it will accept in one go, so a single bad or malicious request cannot tie the cloud up. Login-type routes take at most 50 records; the key checker at most 20; the sealing route takes up to 5,000 stock movements because a tablet that has been offline for weeks pushes its whole backlog at once.
- **Seal key rotation (key ring)** — The secret used to stamp tamper seals can be replaced without invalidating anything already sealed. Each seal records which key stamped it, so old seals keep verifying against the old key while new movements are stamped with the new one. Retiring a key deliberately invalidates its seals, which fails safe.
- **Cost price never leaves the server for ordinary devices** — What Head Office paid for a product is stripped out of the product list before it is sent to any device, and travels only in a separately locked file that a permission check guards. A salon tablet physically does not have the buy-in cost on it.
- **Refuse, provisional or final — never a quietly wrong number** — The money-critical routes are built so there are only three possible outcomes: a flat refusal because something is corrupt, a result marked PROVISIONAL with every blocking reason named, or a genuinely FINAL result. There is no fourth outcome where a number comes out looking finished but is silently short or mis-valued.

**Archiving and long-term data**

- **Archive run — filing away old stock movements** — Every stock number in the app is worked out by adding up every movement ever recorded. That list grows forever, so eventually phones get slow and the cloud list hits a size limit. The archive run fixes that: it works out the closing balance for every product in every store up to a chosen point, copies the old movements to a separate 'archive' list, and then removes them from the working list. Stock totals stay exactly the same — the app just starts from the balance instead of re-adding a decade of history.
- **The stock-neutrality proof (the safety catch on archiving)** — Before anything is archived or deleted, the system proves to itself that the maths still adds up: for every single store-and-product pair, the archived balance plus the movements left behind must equal the old grand total. If even one pair is off, the whole run stops — nothing is published, nothing is copied, nothing is deleted, and the live data is untouched.
- **Cutoff by row number, not by date** — The archive boundary is 'everything up to cloud row number N', not 'everything before a date'. That matters because a staff member who logs a movement while offline for a week gets a brand-new, higher row number when it finally uploads. So a backdated movement lands on the LIVE side of the line and is still counted — it can never be silently swallowed by an already-closed archive.
- **Keep-recent window** — Even when older movements are archived, you can tell the run to leave the last few weeks alone so staff can still scroll back through recent history in the app. Those recent rows stay live regardless of how old their row number is.
- **Deleted movements stay deleted after archiving** — When someone deletes a stock movement the app does not really erase it — it writes a 'this one is cancelled' marker next to it. The archive maths understands those markers, so a cancelled movement contributes nothing to the archived balance, exactly like it contributes nothing on a staff member's screen today.
- **Copy-fidelity check before anything is deleted** — After copying old movements to the archive, the system reads them back out of the archive and fingerprints them, then compares that fingerprint to one taken from the originals. If a single field got mangled in the copy — the quantity, the store, the price stamps, the transfer link — the fingerprints differ and the run refuses to delete the originals.
- **Archive keeps the price and supply stamps on the row** — When a movement is filed away, the archived copy now keeps everything that gives it money meaning: the supply price and franchise discount frozen at the time, the catalogue version, the sale price, and where the stock came from and went to. Without those, an archived year could never be re-priced or re-invoiced correctly.
- **One-run-at-a-time lock and safe restart** — Only one archive run can be in progress at a time — a second attempt is turned away rather than allowed to interleave. If a run crashes half way, restarting it skips rows already copied instead of duplicating them, and the lock is released on every failure path.
- **Publish the new balances LAST** — Devices must never see a half-finished archive — old balances with a shrunken movement list would show wrong stock. So the run copies and verifies everything first, and only flips the switch that tells devices 'new balances are available' at the very end, right before deleting the originals.
- **Run size limit — max 5,000 movements per archive run** — One run can only read 5,000 movements at a time. If there are more waiting, the run refuses rather than quietly archiving only part of them.
- **Devices adopt the published opening balances** — Each device picks up the new opening balances the next time it checks in with the cloud, and from then on it works out stock as 'that opening balance, plus only the movements since'. Same answer, far less work for the phone.
- **Catch-up safety gate (a device won't use balances it isn't ready for)** — A device only starts using the new opening balances once it has downloaded everything up to the archive line. Until then it quietly goes back to the old method of adding up every movement — slower, but always right. A phone that has been in a drawer for a month can never produce a wrong number because of this.
- **Balances survive an offline start-up** — The opening balances are saved on the device itself, so if a store opens with the internet down the app still shows correct stock instead of a wrong low number.
- **Device clean-up — old movements dropped from the phone** — Once a device is caught up, it deletes its own local copy of the movements the balances already cover. That is the whole point of archiving: the phone holds a small recent window instead of the entire history. It only ever drops rows it has confirmed are safely in the cloud.
- **Cloud row numbers stamped on every movement (and back-filled)** — Each movement gets stamped with its cloud row number when it syncs, which is how the app later knows which side of the archive line it falls on. Movements a device created itself never came back down from the cloud, so the app back-fills their numbers on the next sync and saves them properly — otherwise those movements would be double-counted the first time archiving happened.
- **You cannot delete or undo an archived movement** — Once a movement has been rolled into the opening balances, the delete and undo buttons refuse it with a plain message: 'This movement has been archived and can no longer be deleted.' Allowing it would leave the stock count permanently wrong, because there is no longer an original row to cancel.
- **Reports warn you when they cannot see far enough back** — If someone runs a report over a period that reaches back before the archive line, a banner appears saying older movements are archived and NOT included — so nobody quietly reads a sales or wastage figure that is missing half its history. Directors and Head Office get a 'Load archived data' button on that banner; everyone else is told to ask a Director.
- **'Load archived data' — pulling old movements back for a report** — A Director or Head Office user can pull archived movements for the report's date range back into the screen so the totals are complete. Those rows are temporary: they are not saved to the device, not counted into the stock-on-hand figure, and not included in a backup file.
- **Old transfers and deliveries stay 'completed' after archiving** — A transfer or delivery record remembers which stock movements it created. After those movements are archived off the device they look missing, and without a fix an old completed transfer would flip back to 'waiting for stock'. The app keeps a small list of which of those references it archived, so a genuinely old record stays confirmed while a movement that never actually arrived still correctly shows as pending.
- **Franchise stores only get their own opening balances** — When opening balances are handed out, a store account only ever takes on the balances for its own stores. If someone's store access changes, balances for stores they no longer have are stripped off the device.
- **Losing the 'see archived data' permission wipes it from the device** — If a Director's permission to view archived history is taken away, any archived movements already loaded onto that device are dropped immediately rather than lingering on screen.
- **Backups never contain temporarily-loaded archived rows** — When a Director exports a backup, the archived movements they had loaded for a report are left out — they live in the cloud archive, and including them would bloat the file and confuse a restore.
- **New/returning device catch-up (the pull-hardening upgrade)** — The way a device downloads history was rebuilt. The old method breaks once there are more than about 5,000 movements to catch up on — which is exactly what a brand-new phone, or one that has been off for months, has to do. The new method walks the list by row number in pages, which works at any size. It was tested against 20,048 rows and walked all of them cleanly in 21 pages.
- **Catch-up safety rules (frozen ceiling, look-back, stop-on-nonsense)** — Three protections inside the new catch-up. First, each download run fixes a ceiling at the start so movements arriving mid-download can't make it run forever. Second, it deliberately re-reads the last 100 rows each time, because the cloud can make a later row visible before an earlier one — without this, a movement could be skipped permanently. Third, if the server ever returns a page that doesn't move forward, the app stops and changes nothing rather than looping or half-applying.
- **Old-and-new-at-once download endpoint (safe cutover)** — So that installing the new catch-up doesn't strand phones that haven't updated yet, the cloud endpoint was rebuilt to understand both the old and new request styles and answer each correctly. That removes the risky moment where everyone must update at exactly the same time.
- **Standing rule: never edit the movements list directly in SharePoint** — Because the new catch-up walks forward by row number and never looks back, a row edited or deleted by hand in SharePoint would simply never reach the devices. All changes must go through the app.
- **Buy-back settlement export engine** — When Head Office buys a franchise back, someone has to work out what the franchisee owes for stock supplied and what the store actually sold. This engine does that calculation for a closed trading period, pulling from both the live and the archived movements, using the supply price and discount frozen on each individual movement rather than today's rate. It produces a line-by-line statement with a total owed.
- **Settlement verdicts: FINAL, PROVISIONAL, or refused** — The settlement never guesses. It returns one of three answers: FINAL (everything accounted for, safe to invoice), PROVISIONAL (a real number, but something is still open — and it names exactly what), or a refusal (the underlying data is broken or unproven, so no number at all rather than a wrong one). Nobody can accidentally invoice from a half-complete picture.
- **Retail profit shown but marked 'information only'** — The settlement also shows what the store sold and its retail profit — but that figure is explicitly flagged as informational and is NOT part of what is owed. The reason: sale prices are typed in on the shop floor and have no independent server record backing them, while the supply cost does.
- **Correction-aware archiving (built, deliberately parked)** — A newer layer teaches the archive maths about formally corrected movements — so a movement that was officially corrected or withdrawn contributes its corrected value, not its original one. It is written and it is switched off by design: the archive run does not send the correction information, so the maths behaves exactly as it did before.
- **Build-mismatch belt on the archive run** — The archive run checks that the same version of the calculation answered both before and after the copy step. If the cloud swapped versions mid-run, it aborts with a retryable error instead of reporting a false copy failure on a perfectly good copy.
- **Archive cadence rule (decided, not built)** — The agreed rule is: archive when the live movement list reaches about 5,000 rows, or every six months, whichever comes first. Nothing in the system actually watches for either condition or starts a run.
- **Era cutoff — a new franchisee cannot read the old owner's history** — When a store changes hands, the new owner should only be able to pull archived history from their own trading period, not the previous owner's. This is written up as a requirement and does not exist.

**The access policy system**

- **Account Access screen (Settings → Account Access tab)** — A Director-only screen inside Settings where you decide what each kind of account is allowed to do — instead of those rules being fixed in the app. It shows a grid: every job the app can do down the left, every account type across the top, and a tick box where they meet. Only a Director sees the tab at all.
- **The permission grid (20 jobs × 6 account types)** — The tick-box table itself. 20 things the app can do (record a delivery, edit cost prices, do a stock take, receive a transfer, see cost prices, and so on) against the 6 account types (Store account, Store manager, Franchisee, Territory manager, Head office, Director). Tick or untick and it changes who can do what.
- **Per-account exceptions ("Always allow" / "Always block")** — Under the grid you can single out one person or one store account and override the rule for them — e.g. let the Booragoon store account do stock takes without the PIN, or block one manager from deleting movements. An exception always wins: it beats both the role default and the 24-hour PIN.
- **"Ask for my password again when…" list (the sudo map)** — A short list of serious actions — publish catalogue, run the ledger archive, user management, backup, approve stock takes, resolve discrepancies, record deliveries, stock adjustments, cancel transfers, edit access policy — each with a tick box for whether the app should make you re-type your password at that moment, or trust that you're already logged in.
- **Locked items that can never be switched off (the floor)** — Two things are padlocked on the screen and cannot be relaxed: editing the access policy itself, and user management. Those always demand your password. This is what stops someone who finds an unlocked Director device from first loosening the lock and then walking through it.
- **Directors can't be locked out of the lock** — The screen won't let you untick "Edit this access policy" for Directors, and the server refuses any policy that removes it. Without this, one bad publish could permanently brick the ability to change permissions ever again.
- **Publish / Activate button** — One button at the bottom. Before there is any policy it says "Activate access policy"; after that it says "Publish changes". Pressing it asks for your password, sends your draft to the cloud, and the cloud (not your device) decides whether to accept it.
- **Publishing and enforcing are two separate acts** — Writing the rules down and turning them on are deliberately different steps. You publish the policy, check every part of the system can read it, and only then flip the switch that makes the cloud actually refuse things. If it goes wrong you flip back and the policy itself survives.
- **The master enforcement switch (access_policy_enforce)** — The intended single on/off switch for the whole permission system — one row of data in the cloud that every gated door reads, so all the doors arm together and none is left half-on. Undo is setting it back to zero.
- **The policy itself (the blob) and its version number** — All the rules live in one document in the cloud. Every time it's accepted, the cloud stamps it with the next version number — your device never invents one. Devices only ever move forward: an older version arriving is ignored, so a stale copy can't quietly undo a tightening.
- **Two Directors can't overwrite each other** — When you publish, your device says which version you started editing from. If another Director published in the meantime, the cloud refuses yours rather than silently wiping their change.
- **The cloud checks the policy before saving it** — The cloud refuses a policy that is malformed, oversized, uses dangerous reserved names, has a permission set to something other than yes/no, deletes the Director role, or tries to unlock the padlocked items. It tells you it refused rather than quietly fixing it up.
- **The one place the cloud decides yes or no (evaluateAccess)** — A single cloud service answers the question "is this person allowed to do this?". It checks who they really are, then applies the rules in a fixed order: a personal exception wins outright, then a live 24-hour PIN, then their account type's default. Anything it doesn't recognise is a no.
- **The same rule engine on the device (Auth.can)** — Your device runs an identical copy of the yes/no logic so buttons and menus can hide instantly without waiting for the internet. The device copy is a convenience only — the cloud is the real gate.
- **The starting policy (what Activate actually publishes)** — Pressing Activate the first time publishes a policy generated from today's built-in permissions, so nothing changes — with ONE deliberate exception you chose on 7 July 2026: from then on the basic store account needs the 24-hour PIN to receive a Head Office transfer.
- **See cost prices / See selling prices / See older data / See store-comparison charts** — Four view switches that decide what someone can even look at: cost prices, selling prices, archived history, and the cross-store comparison report. Cost is Director-only by default, archived data is Territory Manager and above, comparison charts are Franchisee and above, and selling price is currently visible to everyone.
- **CSV exports respect the selling-price switch** — If someone isn't allowed to see selling prices on screen, the price column is also missing from the spreadsheets they export — so the toggle isn't trivially side-stepped by hitting Export.
- **Taking a permission away cleans up what's already on the device** — If you publish a policy that removes someone's access to cost prices or archived history, their device doesn't just hide it — it wipes the copy it had already downloaded. If that wipe fails, backups are blocked until it succeeds, so the data can't escape in an export.
- **Backups never carry the access policy or hidden costs** — The exported backup file has the permission rules stripped out, so a tampered backup file can't be used to hand a device fake permissions. If the person exporting isn't allowed to see cost prices, the costs are blanked out of the file too.
- **24-hour Stock Take PIN — Director sets and clears it** — The Director generates a numeric PIN that is valid for 24 hours and works across all stores. Before the policy is on, that PIN is stored on the device. Once the policy is on, setting or clearing the PIN becomes a policy publish — it's scrambled in the cloud and never stored in readable form anywhere.
- **PIN checked by the cloud, not the device** — Once the policy is on, typing the PIN is verified in the cloud and the cloud hands the device a time-limited pass. That pass is what the cloud looks for when the device later uploads the stock take or the received transfer. Trade-off you accepted: the device needs internet at the moment the PIN is typed (not afterwards).
- **PIN-to-receive (the store account needs the PIN to receive an HO transfer)** — Your 7 July decision: a plain store account can log stock in and out freely, but to RECEIVE a delivery transferred from Head Office it must first enter the 24-hour PIN. A manager can grant a specific store a permanent exemption through the per-account exceptions.
- **"Clear PIN" is an instant kill switch** — Clearing or changing the PIN doesn't just stop new unlocks — it immediately kills every pass already handed out, on every device, rather than leaving them alive until they expire. Unrelated permission edits do NOT kill live passes, so ordinary edits don't lock staff out mid-shift.
- **Password re-prompts at the moment of a serious action** — Before approving a stock take, resolving a discrepancy or recording a delivery, the app can ask you to re-type your password, and it attaches proof of that to the record when it uploads. Before any policy exists it never asks — behaviour is unchanged.
- **Policy delivery to devices (and the PIN never leaving the cloud)** — Devices receive the rules as part of their normal settings download. The version WITH the scrambled PIN in it is filtered out and never leaves the cloud; devices get a copy where the PIN is reduced to just an expiry time.
- **Devices notice a new policy quickly** — Every time a device pulls new stock data, the cloud tells it which policy version is current. If that's newer than what the device holds, it goes and fetches the new rules straight away instead of waiting for the next restart. Follower browser tabs pick it up too.
- **Privileged actions done in a second browser tab still count** — Only one browser tab does the uploading. If you approve something in a different tab, the password proof is handed across to the uploading tab in memory so the record isn't rejected later for having no proof.
- **The cloud door that saves a policy (access-policy-write)** — The one cloud door in this whole area that is actually built, deployed and tested. It checks the device is a Director device, checks the person's password proof, checks they hold the 'edit access policy' permission, validates the policy, and only then writes it.
- **The cloud doors that do NOT check the policy yet** — Seven of the eight doors that were supposed to enforce these rules have not been changed in the cloud at all: the two doors every stock movement goes through, the cost-price door, the archived-history door, user management, catalogue publishing, and the PIN-pass door. Right now those doors still only check that the device has a valid key — not who the person is or what they're allowed to do.
- **The archive era floor (never show a franchisee history from before they owned the store)** — The design says a franchisee asking for archived history should never be served rows from before their ownership started. This exists on paper only.
- **The safety nets around the rule engine (fail-closed behaviour)** — When anything is missing or unreadable, the answer is no, not yes. No policy means no permission. An unknown job name or an unknown account type is a no. A dangerous name is a no. A bad or expired password proof is a no. Someone else's PIN pass is a no.

