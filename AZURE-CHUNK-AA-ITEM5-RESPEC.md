# ITEM 5 — CORRECTED SPECIFICATION (Account Access ingest validation)

**Supersedes §3 and §4 of `AZURE-CHUNK-AA-LA-CHANGES.md`.** Written 2026-07-30 against Logic App
definitions captured from the live staging cloud the same day, then independently re-derived by three
reviewers, each trying to find a counter-example, then corrected 2026-07-31. **NOT YET EXTERNALLY AUDITED — this document is the subject
of that audit.**

Item 5 = the two write doors every stock movement passes through (`push-v2-validate`,
`recordsteps-push`). They run on the `sharepointonline` connection SHARED WITH THE LIVE APPS.
This is the one item in the chunk worth being slow about.

---

## ⚠ FOUR CORRECTIONS APPLIED 2026-07-31 — read before the edits

Three independent attacks failed to break the Stage-1 inertness property, so the DESIGN holds.
What they found was a **document** problem: statements that describe the real Logic Apps wrongly.
**An implementer follows the words, not the intent**, so these are corrected here, not just noted.

### C1 — SECURITY. `AA_actor` must be COPIED VERBATIM, never described.

The spec called `AA_actor` the deployed `Read_actor` "copied verbatim … filtered on actorUsername".
The deployed action does **not** use a plain filter — it strips single quotes out of the username
first. Every credential read in this estate that interpolates a client-supplied name uses that
guard. The prose dropped it, and the edit immediately before hands over a plain literal query, so
the natural reading produces a query **without that quote-stripping step**, on the connection shared
with the live application.

**This is the action, extracted mechanically from the deployed
`bob-stock-catalogue-write-staging > Read_actor`. Copy it exactly. The `replace(...)` around the
username IS the guard — do not paraphrase it, do not "tidy" it:**

```json
{
  "inputs": {
    "body": {
      "headers": {
        "Accept": "application/json;odata=nometadata"
      },
      "method": "GET",
      "uri": "@{concat('_api/web/lists/getbytitle(''UserCredentials_Staging'')/items?$select=Id,Username,Role,GraceUntil,Active,LockedUntil,TokenVersion&$filter=Username eq ''', replace(coalesce(triggerBody()?['actorUsername'],''),'''',''), '''')}"
    },
    "host": {
      "connection": {
        "name": "@parameters('$connections')['sharepointonline']['connectionId']"
      }
    },
    "method": "post",
    "path": "/datasets/@{encodeURIComponent(encodeURIComponent('https://bangonbrows.sharepoint.com'))}/httpRequest"
  },
  "runAfter": {
    "Call_verify": [
      "Succeeded",
      "Failed",
      "TimedOut"
    ]
  },
  "runtimeConfiguration": {
    "secureData": {
      "properties": [
        "inputs",
        "outputs"
      ]
    }
  },
  "type": "ApiConnection"
}
```

Its field list is already exactly what the verifier needs (Username / Role / TokenVersion for
`verifyProofBody`; Active / LockedUntil / GraceUntil for `rowUsable`), so this is a straight copy
with no edits at all. ⚠ Note it also carries `secureData` on inputs AND outputs — keep that.

### C2 — COUNT. Stage 1a adds **15** new actions per Logic App, not 13.

Counted from the edit lists below. The 39→67 and 64→94 totals were right; the halves were wrong.

### C3 — FALSE PREMISE, the same class as the bug this respec exists to fix.

Edit 9 justified its failure posture with *"unlike the pre-existing Quarantine_loop edge"*. That is
a **recordsteps** fact pasted into a **push-v2** edit — push-v2's Invariant already tolerates
`Quarantine_loop` failing. **The clause is struck below.** Judge edit 9 on its own merits.

### C4 — AZURE SEMANTICS. Strike every *"with the switch off the gate is Skipped"*.

An Azure `If` whose condition evaluates FALSE completes **Succeeded**; only the actions inside it
are Skipped. The four-status tolerance on `AA_gate` is still required — but for the case where the
switch READ errors, which is the one case the probe does not yet contain. **Add that case.**

---

## PLAIN ENGLISH

WHAT ITEM 5 IS FOR, IN ONE PARAGRAPH. Today the cloud accepts a stock movement, or a stock-take / transfer / delivery step, because the DEVICE is trusted. It never checks which PERSON did it. So a phone with valid store keys can push "stock take approved" or "discrepancy resolved" even though only a Director is meant to do that. Item 5 teaches the two write doors — the one stock rows go through (push-v2) and the one record-steps go through (recordsteps-push) — to also check the person against the permission list a Director publishes.

WHY THIS IS THE ONE ITEM WORTH BEING SLOW ABOUT. These two Logic Apps are how every stock movement reaches the cloud, and they run on the same SharePoint connection as the live apps. The previous version of this spec was reviewed clean three times and was still wrong three ways, because the reviews checked the DESIGN while the edits had been written against a day-old picture of the actual machine. All three mistakes would have misbehaved on ordinary, everyday traffic with no permission list published at all.

WHAT CHANGES, AND WHAT DOES NOT. Nothing changes in Stage 1. That is the point, and it is now provable rather than argued: the new machinery is installed switched off, and when it is off it removes zero rows, adds zero to the workflow's own arithmetic check, and returns a response that is identical field-for-field to today's. I ran the arithmetic and the response merges through the real captured expressions and got byte-identical results (script output: "AA_insertable is element-for-element IDENTICAL to ToInsert2 in Stage 1", "AA_removed is [] in Stage 1", "the if(empty(...)) guard returns the live expression BYTE-FOR-BYTE"). Stage 1 adds exactly one small SharePoint read per push — the switch itself — and if that read fails, or the row is missing, or I named the wrong list, the answer is "off", i.e. behave exactly as today. There is no way for the switch read to make things worse.

WHAT CHANGES WHEN YOU FLIP IT (Stage 2, a separate day). Privileged rows and steps then need a logged-in person with permission. A person who lacks the permission gets a permanent refusal (the row is quarantined and reported). A person who HAS the permission but whose proof arrived late or expired in transit gets a "try again" — the row stays on the device and re-pushes. Nothing is silently lost either way. Ordinary stock IN and OUT are not gated at all.

TWO THINGS I MUST FLAG BEFORE YOU AGREE. First, a permanent refusal is DURABLE ON THE DEVICE: flipping the switch back off does not un-quarantine a row that was already refused. So flip in a quiet window, watch the first few pushes, and roll back fast. Second, ordinary stock IN is deliberately NOT gated here, because the app writes the same row type for a Director's warehouse delivery and for a staff member logging stock in at a salon, and the cloud genuinely cannot tell them apart. Gating it as the old spec said would have refused every staff stock-in the moment you flipped. That is a deviation from the agreed §3 and it needs your sign-off.

HONEST SIZE. This is not small. push-v2 goes from 39 actions to 67; recordsteps-push from 64 to 94. Four existing actions are edited on each. I have split Stage 1 into 1a (the inert spine, 13 new actions, where all the safety lives) and 1b (the decision machinery, which only ever runs when the switch is on), so you get a probe run after each half instead of one big leap. Realistically five sittings: 5a-1a, 5a-1b, 5b-1a, 5b-1b, then the flip. Stage 1a also gives you a free rehearsal of the flip itself: with 1a installed you can turn the switch ON and nothing changes at all, because there is no decision machinery behind it yet.

## STAGE 1 — install everything with enforcement OFF (26 edits)

### Edit 1 — repo gate — audit-artifacts/check-name-collisions.js (not a Logic App)

BEFORE any cloud edit, replace the seeded manifest entry PLANNED_ADDITIONS['bob-stock-recordsteps-push-staging'] = ['ToInsert2','Proof_gate','Classify_steps'] with the real 30-name list below, and fill PLANNED_ADDITIONS['bob-stock-push-v2-validate-staging'] (currently [], which the gate itself reports as 'declared unchecked') with the real 28-name list. Then `node audit-artifacts/check-name-collisions.js` must exit 0. The seed entry exists to fail on purpose; leaving it there after the re-spec trains everyone to ignore a red gate. Keep the self-test intact — I ran it: 9/9 including N9 (the live ToInsert2 incident).

**Why this is inert with no policy and no switch:** Changes no cloud resource. It is the gate that stops BREAK 1 recurring; a green run here is a precondition of every edit below, not a change in itself.

### Edit 2 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_init_deny`, `AA_init_retry` — collision-checked against the live capture: **YES**

ROOT: add two InitializeVariable actions and re-point ONE existing runAfter. AA_init_deny {type:InitializeVariable, runAfter:{"Init_failed":["Succeeded"]}, inputs:{variables:[{name:'aaDeny',type:'array',value:[]}]}}; AA_init_retry {runAfter:{"AA_init_deny":["Succeeded"]}, variables:[{name:'aaRetry',type:'array',value:[]}]}. Then EXISTING EDIT: Get_creds.runAfter := {"AA_init_retry":["Succeeded"]} (was {"Init_failed":["Succeeded"]}). Chain serially — do NOT hang the Inits off Init_failed in parallel with Get_creds, because a variable read before its InitializeVariable has run is a runtime error and 'it is always fast enough' is not a proof.

**Why this is inert with no policy and no switch:** Two empty arrays that nothing reads yet, plus one runAfter hop that preserves the existing serial order Init_accepted→Init_duplicates→Init_failed→…→Get_creds. Verified from the capture: Get_creds.runAfter is today {"Init_failed":["Succeeded"]}. InitializeVariable must be at root — the existing three are, and Ctx_ids inside Authorized[then] already reads @variables('ctx') initialized at root, so workflow-scope reads are proven by the deployed graph.

### Edit 3 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_flag` — collision-checked against the live capture: **YES**

THE SWITCH. Add AA_flag inside Authorized[then], runAfter {} (a new parallel entry point beside Get_products and Match_cred). Copy the read shape VERBATIM from the deployed bob-stock-access-policy-write-staging action Read_secure, changing only the $filter: type ApiConnection, method post, path /datasets/@{encodeURIComponent(encodeURIComponent('https://bangonbrows.sharepoint.com'))}/httpRequest, host.connection @parameters('$connections')['sharepointonline']['connectionId'], body {method:'GET', headers:{Accept:'application/json;odata=nometadata'}, uri:"_api/web/lists/getbytitle('AppConfig_Staging')/items?$select=Id,ConfigType,ConfigData&$filter=ConfigType eq 'access_policy_enforce'&$top=1"}. AppConfig_Staging is the list the policy writer actually writes (I read its three actions: Read_client/Read_ver/Read_secure all on AppConfig_Staging) and is therefore the only list where one row can govern both doors per D-AA-A. Note push-v2 will then read TWO AppConfig lists — 'AppConfig' for the catalogue, 'AppConfig_Staging' for the switch. That asymmetry is deliberate and must be recorded, not tidied.

**Why this is inert with no policy and no switch:** It is a read. Its ONLY consumer is AA_enforce (edit 4), which treats every non-'1' outcome — row absent, list absent, 404, timeout, wrong list name, malformed value — as 'off'. So the switch read cannot change behaviour in either direction; the worst a wrong list name can do is make the Stage-2 flip do nothing. runAfter {} means it runs in parallel with the existing catalogue reads, so it adds no measurable latency on the insert path.

### Edit 4 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_enforce` — collision-checked against the live capture: **YES**

AA_enforce (Compose), runAfter {"AA_flag":["Succeeded","Failed","TimedOut"]}, inputs: "@if(not(equals(actions('AA_flag')?['status'],'Succeeded')),'off',if(equals(trim(string(coalesce(first(coalesce(body('AA_flag')?['value'],json('[]')))?['ConfigData'],'0'))),'1'),'on','off'))". TWO states only, and 'cannot tell' collapses to 'off'. This is a deliberate reversal of the old plan's three-state 'unknown ⇒ defer' design: deferring on a transient SharePoint error would be a real behaviour change on everyday traffic in Stage 1, which is exactly the class of break this re-spec exists to remove. The fail-closed-on-unknown posture is a STAGE-3 hardening item with its own audit, listed in the open questions.

**Why this is inert with no policy and no switch:** Total expression: every index is coalesce-guarded, so it cannot throw whether or not Logic Apps short-circuits if(). With no row it yields 'off'. The double coalesce mirrors the deployed Match_cred pattern (@coalesce(body('Get_creds')?['value'],json('[]'))).

### Edit 5 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_gate`, `AA_set_deny`, `AA_set_retry` — collision-checked against the live capture: **YES**

AA_gate (If). NOTE THE JSON SHAPE: an If action carries a TOP-LEVEL "expression" key — there is no inputs.expression. I checked this on the capture (Respond and L_decide both have keys [actions, else, expression, runAfter, type]); the old text's 'Quarantine_loop.inputs.from' was the same class of unapplyable instruction. AA_gate = {type:'If', runAfter:{"AA_enforce":["Succeeded"],"ToInsert":["Succeeded"]}, expression:{and:[{equals:["@equals(outputs('AA_enforce'),'on')",true]}]}, actions:{ AA_set_deny, AA_set_retry }}. In Stage 1a the gate contains ONLY: AA_set_deny {type:SetVariable, runAfter:{}, inputs:{name:'aaDeny', value:"@json('[]')"}} and AA_set_retry {type:SetVariable, runAfter:{"AA_set_deny":["Succeeded"]}, inputs:{name:'aaRetry', value:"@json('[]')"}}.

**Why this is inert with no policy and no switch:** With the row absent the condition is false and the whole gate is Skipped, so both variables stay at []. AND — this is the free rehearsal — with the row set to '1' the gate RUNS and sets both to [] anyway, so Stage 1a is byte-identical with the switch either ON or OFF. That lets Kunal rehearse the exact Stage-2 mechanics (create the row, watch a push, delete the row) at zero risk before any decision machinery exists.

### Edit 6 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_deny_ids`, `AA_retry_ids` — collision-checked against the live capture: **YES**

THE SPINE, part 1 — the two id lists. AA_deny_ids {type:Select, runAfter:{"AA_gate":["Succeeded","Failed","Skipped","TimedOut"]}, inputs:{from:"@variables('aaDeny')", select:"@item()?['row']?['TransactionId']"}}; AA_retry_ids {type:Select, runAfter:{"AA_deny_ids":["Succeeded"]}, inputs:{from:"@variables('aaRetry')", select:"@item()?['row']?['TransactionId']"}}. The four-status tolerance on the gate edge is mandatory, not defensive: with the switch off the gate is Skipped, and if the spine did not tolerate Skipped it would stall, the Invariant would never run, no Response action would run at all, and every push would get a bare 502.

**Why this is inert with no policy and no switch:** Reads a variable, which is always readable regardless of what was skipped — that is the whole reason the classification result is carried in variables rather than in action bodies. Select over [] is []. Both actions are total (they cannot throw), which is what lets edits 7-11 depend on their bodies. 'Skipped' in runAfter is not a guess: the deployed push-v2 Invariant already uses {"Insert_loop":["Succeeded","Skipped"],"Set_failed_attest":["Succeeded","Skipped"]}, and since those two parents are mutually exclusive one of them is Skipped in every successful run.

### Edit 7 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_signable`, `AA_removed` — collision-checked against the live capture: **YES**

THE SPINE, part 2 — two COMPLEMENTARY Queries over the same source, so what is removed and what is counted can never disagree. AA_signable {type:Query, runAfter:{"AA_retry_ids":["Succeeded"]}, inputs:{from:"@body('ToInsert')", where:"@and(not(contains(body('AA_deny_ids'),item()?['row']?['TransactionId'])),not(contains(body('AA_retry_ids'),item()?['row']?['TransactionId'])))"}}. AA_removed {type:Query, runAfter:{"AA_retry_ids":["Succeeded"]}, inputs:{from:"@body('ToInsert')", where:"@not(and(not(contains(body('AA_deny_ids'),item()?['row']?['TransactionId'])),not(contains(body('AA_retry_ids'),item()?['row']?['TransactionId']))))"}}. AA_removed's where MUST be the literal not() of AA_signable's where — same text inside — so complementarity is textually checkable by an auditor rather than argued via De Morgan.

**Why this is inert with no policy and no switch:** contains(<empty array>, x) is false, so in Stage 1 AA_signable's predicate is true for every item and AA_removed is []. I ran it: 'AA_insertable is element-for-element IDENTICAL to ToInsert2 in Stage 1' and 'AA_removed is [] in Stage 1, so the new Invariant term adds exactly 0'. Counting the REMOVED set rather than |aaDeny|+|aaRetry| also kills a whole family of arithmetic bugs — e.g. a batch containing two rows with the same TransactionId where only one is denied would make an id-count and a row-count disagree, and disagreement here means HTTP 500 with nothing acked.

### Edit 8 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_deny_map`, `AA_retry_map` — collision-checked against the live capture: **YES**

THE SPINE, part 3 — the two report maps, shaped to the contracts sync.js actually reads (I read them: rejected[] is consumed as r.reasonCode/r.reason and drives DB.markTransactionsRejected; failed[] is consumed as f.TransactionId and left unsynced for retry; both are filtered by batchIds.has(...)). AA_deny_map {type:Select, runAfter:{"AA_retry_ids":["Succeeded"]}, inputs:{from:"@variables('aaDeny')", select:{TransactionId:"@item()?['row']?['TransactionId']", reason:"@item()?['verdict']", reasonCode:'ACCESS_DENIED'}}}. AA_retry_map {type:Select, runAfter:{"AA_deny_map":["Succeeded"]}, inputs:{from:"@variables('aaRetry')", select:{TransactionId:"@item()?['row']?['TransactionId']", reason:"@item()?['verdict']", retryable:true}}}.

**Why this is inert with no policy and no switch:** Select over [] is []. Both are unconditional and total, so edits 10 and 11 may read their bodies with no skip-handling. Deliberate design point: retry rows are NOT appended into the existing `failed` variable. Set_failed_attest is a whole-variable SetVariable (value @body('Attest_failed_map')) with no ordering relationship to a new append, so an append would be silently eaten on any attestation blip and the Invariant would under-count. Keeping retries in their own variable removes that hazard entirely and means Set_failed_attest is never touched.

### Edit 9 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

**New action names:** `AA_q_loop`, `AA_q_insert` — collision-checked against the live capture: **YES**

THE DENY QUARANTINE — a SEPARATE Foreach, never an extension of Quarantine_loop. AA_q_loop {type:Foreach, runAfter:{"AA_deny_map":["Succeeded"]}, runtimeConfiguration:{concurrency:{repetitions:1}}, foreach:"@variables('aaDeny')", actions:{AA_q_insert}}. AA_q_insert copies the deployed Quarantine_insert verbatim except that every item() becomes items('AA_q_loop') and the two reason fields are explicit: {DeviceId:"@items('AA_q_loop')?['row']?['DeviceId']", Title:"@items('AA_q_loop')?['row']?['TransactionId']", TransactionId:"@items('AA_q_loop')?['row']?['TransactionId']", rawRowJson:"@string(items('AA_q_loop')?['row'])", reason:"@items('AA_q_loop')?['verdict']", reasonCode:'ACCESS_DENIED', receivedAt:"@utcNow()", workflowRunId:"@workflow()?['run']?['name']"}, same host/method/path to StockTransactions_Quarantine. Do NOT mutate Quarantine_loop.foreach: a Foreach has a `foreach` key and NO `inputs` key (verified on the capture), so the old 'Quarantine_loop.inputs.from' instruction was unapplyable, and merging item shapes would have written reason:null / reasonCode:null quarantine rows because Quarantine_insert reads item()?['reason'] into both fields.

**Why this is inert with no policy and no switch:** Iterates an empty array: zero iterations, zero SharePoint writes, status Succeeded. Its Invariant edge (edit 10) is failure-tolerant, so unlike the pre-existing Quarantine_loop edge a quarantine write failure here cannot leave the run with no Response at all.

### Edit 10 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

THE C1 RE-PARENT — EXACTLY ONE EXISTING ACTION, and this is the corrected EDIT 13. Attest_rows.inputs.from := "@body('AA_signable')" and Attest_rows.runAfter := {"AA_signable":["Succeeded"]}. Attest_failed_map.inputs.from MUST REMAIN "@body('Attest_rows')" and its select MUST REMAIN {TransactionId:"@item()?['TransactionId']", reason:'ATTEST_UNAVAILABLE', retryable:true}. I enumerated the live graph: exactly ONE action reads body('ToInsert') — Attest_rows — and body('Attest_rows') has four reader sites (Attest_failed_map, Call_attest, Zip twice). Re-parenting Attest_failed_map as the old EDIT 13 said makes every ATTEST_UNAVAILABLE entry carry a null id (I ran it: live and corrected both give ["TX-A","TX-B"], EDIT-13-as-written gives [null,null]), which the client's batchIds filter then discards, turning 'these 2 rows could not be sealed' into an anonymous 'sync incomplete' on the money-seal path.

**Why this is inert with no policy and no switch:** In Stage 1 AA_signable is element-identical to ToInsert, so Attest_rows receives the same array in the same order, Call_attest signs the same rows, Zip pairs the same indexes, Belt still matches SigTid to row.TransactionId, and every inserted row still carries a populated EconSig. Nothing in the Zip/Belt/SIG_ZIP_MISMATCH logic is touched.

### Edit 11 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

THE INVARIANT — one new term, and the runAfter map RESTATED IN FULL, never summarised. Invariant.inputs := "@equals(length(coalesce(triggerBody()?['data']?['transactions'],json('[]'))),add(add(add(length(variables('accepted')),length(variables('duplicates'))),add(length(body('Rejected')),length(variables('failed')))),length(body('AA_removed'))))". Invariant.runAfter := {"Insert_loop":["Succeeded","Skipped"],"Map_rejected":["Succeeded"],"Quarantine_loop":["Succeeded","Failed"],"Set_failed_attest":["Succeeded","Skipped"],"AA_removed":["Succeeded"],"AA_retry_map":["Succeeded"],"AA_q_loop":["Succeeded","Failed","Skipped","TimedOut"]} — all four existing entries verbatim plus three new ones.

**Why this is inert with no policy and no switch:** length([]) = 0, so the arithmetic is unchanged in Stage 1. I ran the algebra on both attestation forks with removed=0 and removed=2 and it balances in all four cases: inputCount = accepted+duplicates+|Rejected|+|failed|+|AA_removed|, because AA_signable and AA_removed partition ToInsert and Rejected/ToInsert partition Validate. Note the rejected TERM is length(body('Rejected')) — the envelope array — so edit 12's response change cannot affect the arithmetic. Honest residual: AA_removed is required Succeeded, so if it somehow failed the run would reach no Response and the client would get a 502, retry three times then poll — the same fail-safe class as invariant_failed (nothing acked, nothing lost). That is why edits 6-8 insist every spine action is total.

### Edit 12 — bob-stock-push-v2-validate-staging (5a, Stage 1a)

THE RESPONSE — two keys, guarded for EXACT identity. Response_ok.body.failed := "@if(empty(body('AA_retry_map')),variables('failed'),union(variables('failed'),body('AA_retry_map')))". Response_ok.body.rejected := "@if(empty(body('AA_deny_map')),body('Map_rejected'),union(body('Map_rejected'),body('AA_deny_map')))". union(), NEVER concat() — concat() is for strings and integers, all 8 concat() uses on this LA are string builds, and recordsteps already merges arrays with union() twice. The other six keys (accepted, catalogueCheck, duplicates, inputCount, rejected via Map_rejected, serverTimestamp, status) are untouched, as are Response_invariant_fail {reason:'invariant_failed',status:'error'} 500 and Response_401 {authRequired:true,status:'unauthorized'} 401 with runAfter {"Q_authreject":["Succeeded","Failed","TimedOut"]}.

**Why this is inert with no policy and no switch:** When nothing is denied or deferred the guard returns the ORIGINAL expression, so the response is byte-identical rather than merely equivalent. The guard is not cosmetic: union() de-duplicates, and Map_rejected can legitimately contain two identical entries (two rows sharing a TransactionId, both rejected with the same reason), which a bare union() would silently collapse. I ran that case. Both branches are total, so eager evaluation of if() is harmless.

### Edit 13 — bob-stock-push-v2-validate-staging (5a, Stage 1b)

**New action names:** `AA_policy`, `AA_actor`, `AA_parse`, `AA_ready`, `AA_dc` — collision-checked against the live capture: **YES**

THE POLICY AND ACTOR READS, all INSIDE AA_gate so they cost nothing while the switch is off. AA_policy = the deployed access-policy-write Read_secure copied VERBATIM (AppConfig_Staging, $filter ConfigType eq 'access_policy_secure', $top=1) with runAfter {}. Use the SECURE blob, not the client copy: evaluateAccess needs pinEpoch and the full sudo map. AA_actor = the deployed archive-staging Read_actor copied verbatim INCLUDING runtimeConfiguration.secureData {properties:['inputs','outputs']}, runAfter {}, reading UserCredentials_Staging filtered on triggerBody()?['actorUsername'] with $select=Id,Username,Role,GraceUntil,Active,LockedUntil,TokenVersion. AA_parse (Compose, runAfter {"AA_policy":["Succeeded","Failed","TimedOut"]}) = "@json(coalesce(first(coalesce(body('AA_policy')?['value'],json('[]')))?['ConfigData'],'null'))" — isolated in its own action because json() THROWS on malformed text. AA_ready (Compose, runAfter {"AA_parse":["Succeeded","Failed","Skipped","TimedOut"],"AA_actor":["Succeeded","Failed","TimedOut"]}) = "@and(equals(actions('AA_parse')?['status'],'Succeeded'),equals(actions('AA_actor')?['status'],'Succeeded'),not(equals(string(coalesce(outputs('AA_parse'),'null')),'null')))". AA_dc (Compose, runAfter {}) = "@if(equals(coalesce(body('Call_verify')?['directorOk'],false),true),'__director',coalesce(triggerBody()?['auth']?['storeId'],''))" — AA-09: derived from the VALIDATED device keys, never from a client field, and it must byte-match the dc the user-verify LA stamps into a session proof or every correct proof fails closed. The client already sends actorUsername and proof at the TOP level of the ingest body (sync.js _withPerson/_withIngestProofs), and the Request trigger schema declares only {data}, so no trigger-schema change is needed or wanted.

**Why this is inert with no policy and no switch:** All five live inside AA_gate, which is Skipped while the switch is off — zero SharePoint reads, zero cost. PREREQUISITE I could not settle from the captures: whether Logic Apps short-circuits if()/and(), and what body()/outputs() return for a Failed, TimedOut or Skipped action. Those semantics decide this half's failure posture, so Stage 1b must be preceded by a four-question semantics experiment on a THROWAWAY new workflow that touches no shared list (see the open items). Stage 1a's inertness deliberately depends on none of that.

### Edit 14 — bob-stock-push-v2-validate-staging (5a, Stage 1b)

**New action names:** `AA_eval_approve`, `AA_eval_resolve`, `AA_eval_adjustment`, `AA_eval_delete`, `AA_eval_txin` — collision-checked against the live capture: **YES**

THE FIVE evaluateAccess CALLS, inside AA_gate, UNCONDITIONAL (no inner If), runAfter {"AA_ready":["Succeeded"],"AA_dc":["Succeeded"]}, each shaped like the deployed Call_verify: POST, Content-Type application/json, runtimeConfiguration.secureData {properties:['inputs']}, uri https://bob-stock-money-fn.azurewebsites.net/api/evaluateAccess?code=<REDACTED> (take the key from the deployed access-policy-write LA; never retype a key). Common body: deviceContext "@{outputs('AA_dc')}", policy "@outputs('AA_parse')", rows "@coalesce(body('AA_actor')?['value'],json('[]'))". AA_eval_approve {action:'approve', capability:'stockTakeApprove', proof from sudoProofs.approve else proof}; AA_eval_resolve {action:'resolve', capability:'resolveDiscrepancy'}; AA_eval_adjustment {action:'adjustment', capability:'stockTakeApprove'}; AA_eval_delete {capability:'deleteMovement', proof only — capability-only means evaluateAccess expects purpose 'session'}; AA_eval_txin {capability:'transferReceive', proof + pinProof}. UNCONDITIONAL is a correctness choice, not laziness: a per-class If makes the classifier read the body of a Skipped action, which is precisely the semantics I could not settle. Cost, stated honestly: up to five Function calls per enforced push even when no gated row is present.

**Why this is inert with no policy and no switch:** Inside the skipped gate. Verified against the deployed Function (accessPolicy.js): evaluateAccess takes ONE {capability, action, proof, pinProof, deviceContext, policy, rows} per call and returns {ok, reason} with reason ∈ NO_POLICY | NEED_SUDO | BAD_PROOF | NEED_PIN | DENIED | BAD_REQUEST — there is no batch mode, which is why the call count is what it is. Also verified: adjustment_* rows are ALREADY director-gated by the deployed Validate ladder ('DIRECTOR_REQUIRED' fires for any Type starting adjustment_ unless directorOk), so this check is defence-in-depth on that class; 'deleted' is NOT director-gated today and is the class that genuinely changes for store devices at Stage 2.

### Edit 15 — bob-stock-push-v2-validate-staging (5a, Stage 1b)

**New action names:** `AA_classify`, `AA_q_deny`, `AA_q_retry` — collision-checked against the live capture: **YES**

THE CLASSIFIER, inside AA_gate. AA_classify {type:Select, runAfter:{ every AA_eval_* : ["Succeeded","Failed","TimedOut"] }, inputs:{from:"@body('ToInsert')", select:{row:"@item()?['row']", verdict:<nested if>}}} producing verdict '' (allowed) | 'RETRY:<code>' | 'DENY:<reason>'. Rules: if AA_ready is false ⇒ 'RETRY:POLICY_UNAVAILABLE' for every GATED class (covers a failed policy or actor read, an absent or unparseable blob); adjustment_in/adjustment_out ⇒ allowed if ANY of the three purpose-bound checks returned ok; 'deleted' ⇒ AA_eval_delete; 'transfer_in' ⇒ AA_eval_txin with NEED_PIN ⇒ 'RETRY:NEED_PIN'; every other Type ⇒ '' unconditionally, INCLUDING Type 'in' (see must-not-do). Reason mapping: ONLY 'DENIED' is permanent ⇒ 'DENY:DENIED'; NEED_SUDO / BAD_PROOF / NEED_PIN / NO_POLICY / a missing proof field ⇒ 'RETRY:<reason>'. Then AA_q_deny {Query over AA_classify where "@startsWith(item()?['verdict'],'DENY')"} and AA_q_retry {where "@startsWith(item()?['verdict'],'RETRY')"} — complementary prefixes over the same array, so no row can be counted twice. Finally RE-POINT the two Stage-1a SetVariables: AA_set_deny.inputs.value := "@body('AA_q_deny')", AA_set_retry.inputs.value := "@body('AA_q_retry')", with runAfter on the two Queries.

**Why this is inert with no policy and no switch:** Inside the skipped gate; the SetVariables only ever run when the switch is on. The deny/retry sets are computed over body('ToInsert') — the SAME array the edit-7 Queries filter — so they are subsets of it by construction and the arithmetic in edit 11 cannot double-count. Two owner-visible consequences of the reason mapping, both inherited from the deployed Function and both already on record: a forged proof is indistinguishable from an expired one (verifyProofBody returns a bare {ok:false}), so a misbehaving device retries forever instead of being set aside; and a permanent DENY is durable on the device — DB.markTransactionsRejected does not un-quarantine when the switch goes back to 0.

### Edit 16 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

**New action names:** `AA_init_deny`, `AA_init_retry` — collision-checked against the live capture: **YES**

ROOT: AA_init_deny {InitializeVariable, runAfter:{"Init_ctx":["Succeeded"]}, variables:[{name:'aaDeny',type:'array',value:[]}]}; AA_init_retry {runAfter:{"AA_init_deny":["Succeeded"]}, variables:[{name:'aaRetry',type:'array',value:[]}]}. EXISTING EDIT: Get_creds.runAfter := {"AA_init_retry":["Succeeded"]} (was {"Init_ctx":["Succeeded"]}, read from the capture). Same serial-chain rule as 5a.

**Why this is inert with no policy and no switch:** Identical to edit 2. The existing root chain Init_accepted→Init_duplicates→Init_failed→Init_ctx→Get_creds is preserved with two links inserted before Get_creds; the `ctx` variable and its initialization are untouched.

### Edit 17 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

**New action names:** `AA_flag`, `AA_enforce` — collision-checked against the live capture: **YES**

AA_flag and AA_enforce, identical to edits 3 and 4 including the AppConfig_Staging read shape copied from access-policy-write's Read_secure. AA_flag.runAfter {} makes it a THIRD entry point of Authorized[then] beside the existing Call_money and Match_cred. This LA reads no AppConfig list today, so this is its first — which is exactly what D-AA-A's single shared row requires, and the reason the row must live in AppConfig_Staging rather than in the 'AppConfig' list push-v2 happens to read for its catalogue.

**Why this is inert with no policy and no switch:** Same argument as 5a: every non-'1' outcome is 'off'. Because AA_flag runs in parallel with the whole Ctx pipeline (which itself does several SharePoint reads inside two serial loops), the added latency on the insert path is effectively zero.

### Edit 18 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

**New action names:** `AA_gate`, `AA_set_deny`, `AA_set_retry` — collision-checked against the live capture: **YES**

AA_gate (If, top-level `expression` key), runAfter {"AA_enforce":["Succeeded"],"ToInsert2":["Succeeded"]}, expression {and:[{equals:["@equals(outputs('AA_enforce'),'on')",true]}]}, containing AA_set_deny/AA_set_retry = "@json('[]')" exactly as in edit 5. THE CRUCIAL DESIGN POINT: the gate hangs off ToInsert2 and everything downstream classifies over body('ToInsert2') — i.e. the access check sits BELOW the Chunk-9/10 context hold-back, never beside it or above it. ToInsert2 is READ and never redefined; adding a runAfter edge lives on the new action, so ToInsert2's own JSON is byte-unchanged.

**Why this is inert with no policy and no switch:** Skipped while the switch is off. Working downstream of ToInsert2 is what makes the new deny/retry sets provably disjoint from Ctx_rejects and Ctx_pendings — they are subsets of ToInsert2, which is already ToInsert minus every ctx id. I ran the counter-case: classify over ToInsert instead and deny a step that ctx had already held back, and the Invariant goes 8 vs 7 → HTTP 500 with nothing acked. That is mutation M-A.

### Edit 19 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

**New action names:** `AA_deny_ids`, `AA_retry_ids`, `AA_insertable`, `AA_removed`, `AA_deny_map`, `AA_retry_map` — collision-checked against the live capture: **YES**

THE SPINE — as edits 6-8 with StepId in place of TransactionId and ToInsert2 in place of ToInsert. AA_deny_ids / AA_retry_ids: Select over @variables('aaDeny') / @variables('aaRetry'), select "@item()?['row']?['StepId']", first one runAfter {"AA_gate":["Succeeded","Failed","Skipped","TimedOut"]}. AA_insertable {Query, from "@body('ToInsert2')", where "@and(not(contains(body('AA_deny_ids'),item()?['row']?['StepId'])),not(contains(body('AA_retry_ids'),item()?['row']?['StepId'])))"}. AA_removed {Query, from "@body('ToInsert2')", where the literal not() of that same conjunction}. AA_deny_map → {StepId, reason:"@item()?['verdict']", reasonCode:'ACCESS_DENIED'}; AA_retry_map → {StepId, reason:"@item()?['verdict']", retryable:true} — matching the deployed Map_ctx_pending shape and what sync.js pushSteps reads (_idOf = r.StepId || r.stepId; rejected → markStepsRejected, failed → retry). NAME DISCIPLINE: use AA_insertable here and AA_signable on push-v2; do NOT share invented names across the two LAs. ToInsert2 is free on push-v2 and TAKEN on recordsteps — that asymmetry IS the trap that produced BREAK 1, and I re-confirmed both halves with the gate.

**Why this is inert with no policy and no switch:** contains([], id) is false, so AA_insertable is element-for-element identical to ToInsert2 and AA_removed is [] — both run and asserted. Every spine action reads only variables or always-Succeeded bodies, so none can throw and none can be skipped.

### Edit 20 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

**New action names:** `AA_q_loop`, `AA_q_insert` — collision-checked against the live capture: **YES**

THE DENY QUARANTINE — AA_q_loop {Foreach over @variables('aaDeny'), concurrency repetitions 1, runAfter {"AA_deny_map":["Succeeded"]}} containing AA_q_insert, copied from the deployed Q2_insert (which I read) with items('AA_q_loop') substituted: {DeviceId:"@items('AA_q_loop')?['row']?['DeviceId']", Title:"@items('AA_q_loop')?['row']?['StepId']", TransactionId:"@items('AA_q_loop')?['row']?['StepId']", rawRowJson:"@string(items('AA_q_loop')?['row'])", reason:"@items('AA_q_loop')?['verdict']", reasonCode:'ACCESS_DENIED', receivedAt:"@{utcNow()}", workflowRunId:"@{workflow()?['run']?['name']}"} to StockTransactions_Quarantine. A THIRD loop, never an extension of Q2_loop or Quarantine_loop. Note Q2_loop is ALREADY TAKEN on this LA (Foreach over @body('Ctx_rejects'), with Invariant depending on it) — the gate caught that too.

**Why this is inert with no policy and no switch:** Zero iterations over []. Its Invariant edge is failure-tolerant, so unlike the two existing quarantine edges (both ['Succeeded'] only) a failed write here cannot skip the Invariant and leave the run with no Response at all. That pre-existing hazard on Q_insert/Q2_insert is real but OUT OF SCOPE — do not 'fix' it inside this item; record it.

### Edit 21 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

THE ONE EXISTING RE-PARENT ON THE INSERT PATH. Insert_loop.foreach := "@body('AA_insertable')" and Insert_loop.runAfter := {"Map_rejected":["Succeeded"],"ToInsert2":["Succeeded"],"AA_insertable":["Succeeded"]} — both existing edges kept verbatim, one added. Insert_loop is a Foreach: it has a `foreach` key and NO `inputs` key, so 'Insert_loop.inputs.from' is unapplyable as written. I enumerated the graph: exactly ONE existing action consumes body('ToInsert2'), and it is Insert_loop. Nothing else changes: Outcome, the accepted/duplicates/failed tree, Map_rejected, Quarantine_loop, Q2_loop, and every Ctx_* action are untouched.

**Why this is inert with no policy and no switch:** AA_insertable is a Query over ToInsert2, so it is a SUBSET of ToInsert2 by construction — every step the hold-back held back stays held back, and in Stage 1 the subset is the whole set in the same order. The hold-back is strengthened, never bypassed.

### Edit 22 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

THE INVARIANT — one new term, existing map restated in full. Invariant.inputs := "@equals(length(coalesce(triggerBody()?['data']?['steps'],json('[]'))),add(add(add(length(variables('accepted')),length(variables('duplicates'))),add(add(length(body('Rejected')),length(body('Ctx_rejects'))),add(length(variables('failed')),length(body('Ctx_pendings'))))),length(body('AA_removed'))))". Invariant.runAfter := {"Insert_loop":["Succeeded"],"Q2_loop":["Succeeded"],"Quarantine_loop":["Succeeded"],"AA_removed":["Succeeded"],"AA_retry_map":["Succeeded"],"AA_q_loop":["Succeeded","Failed","Skipped","TimedOut"]} — the three existing entries EXACTLY as deployed (Succeeded-only; do not 'improve' them here) plus three new.

**Why this is inert with no policy and no switch:** length([]) = 0. The seven-basket conservation law now telescopes: inputCount = |Rejected| + |ToInsert|; |ToInsert| = |ctx| + |ToInsert2|; |ToInsert2| = |AA_removed| + |AA_insertable|; |AA_insertable| = accepted+duplicates+failed. I ran it on a fixture with ctx=4 (two pendings, two rejects) and it balanced at 7 vs 7 both with deny/retry empty and with a real deny plus a real retry.

### Edit 23 — bob-stock-recordsteps-push-staging (5b, Stage 1a)

THE RESPONSE — two keys, guarded, with the EXISTING two-way unions preserved verbatim in the false branch. Response_ok.body.failed := "@if(empty(body('AA_retry_map')),union(variables('failed'),body('Map_ctx_pending')),union(variables('failed'),body('Map_ctx_pending'),body('AA_retry_map')))". Response_ok.body.rejected := "@if(empty(body('AA_deny_map')),union(body('Map_rejected'),body('Map_ctx_rejected')),union(body('Map_rejected'),body('Map_ctx_rejected'),body('AA_deny_map')))". The other six keys — accepted, authClass, duplicates, inputCount, serverTimestamp, status — are untouched, as are Response_invariant_fail (500) and Response_401 (401).

**Why this is inert with no policy and no switch:** With nothing denied or deferred each expression returns the deployed expression character-for-character. union() with a third argument, never concat(): this LA is where the union() precedent lives (these two keys are its only two array merges) and all six concat() uses here are string builds.

### Edit 24 — bob-stock-recordsteps-push-staging (5b, Stage 1b)

**New action names:** `AA_policy`, `AA_actor`, `AA_parse`, `AA_ready`, `AA_dc` — collision-checked against the live capture: **YES**

AA_policy / AA_actor / AA_parse / AA_ready / AA_dc — identical to edit 13, inside AA_gate, same verbatim copies and same isolation of json(). Same prerequisite: the four-question Logic Apps semantics experiment must be done first.

**Why this is inert with no policy and no switch:** All inside the skipped gate; zero reads and zero cost while the switch is off.

### Edit 25 — bob-stock-recordsteps-push-staging (5b, Stage 1b)

**New action names:** `AA_eval_create`, `AA_eval_receive`, `AA_eval_resolve`, `AA_eval_cancel`, `AA_eval_delivery`, `AA_eval_count`, `AA_eval_approve` — collision-checked against the live capture: **YES**

THE SEVEN evaluateAccess CALLS, inside AA_gate, unconditional, shaped as in edit 14: AA_eval_create {capability:'transferCreate'} for transfer/submit; AA_eval_receive {capability:'transferReceive', proof+pinProof} for transfer/receive; AA_eval_resolve {action:'resolve', capability:'resolveDiscrepancy'}; AA_eval_cancel {action:'cancel', capability:'transferCancel'}; AA_eval_delivery {action:'delivery', capability:'recordDelivery'} for delivery/record and delivery/packaging_edit; AA_eval_count {capability:'stockTakeCount', proof+pinProof} for stocktake/count; AA_eval_approve {action:'approve', capability:'stockTakeApprove'} for stocktake/approve and stocktake/reject. ALL THREE backfill step types stay UNGATED (records.js emits them as an automatic one-time migration snapshot from any device; gating them would brick migration).

**Why this is inert with no policy and no switch:** Inside the skipped gate. The step vocabulary is CLOSED and I read it out of the deployed Validate ladder — transfer ∈ submit|receive|resolve|cancel|backfill, delivery ∈ record|packaging_edit|backfill, stocktake ∈ count|approve|reject|backfill — so 'everything else' is fully enumerable here, unlike push-v2 where row types are ambiguous. Also read from the same ladder and worth knowing before you price the risk: transfer/resolve, transfer/cancel, stocktake/approve, stocktake/reject, delivery/record and delivery/packaging_edit ALREADY require a director key today (DIRECTOR_REQUIRED), so for those six the person check is defence-in-depth. transfer/submit, transfer/receive and stocktake/count are the classes that genuinely change at Stage 2.

### Edit 26 — bob-stock-recordsteps-push-staging (5b, Stage 1b)

**New action names:** `AA_classify`, `AA_q_deny`, `AA_q_retry` — collision-checked against the live capture: **YES**

AA_classify / AA_q_deny / AA_q_retry as edit 15, but from "@body('ToInsert2')" (NOT ToInsert — this is the single most dangerous word in the whole item) and keyed on RecordType+StepType, which are unambiguous on the wire. Same verdict vocabulary, same 'only DENIED is permanent' mapping, then re-point AA_set_deny/AA_set_retry to the two Query bodies.

**Why this is inert with no policy and no switch:** Inside the skipped gate. Classifying over ToInsert2 is what keeps the new sets disjoint from the ctx baskets; classifying over ToInsert instead is mutation M-A and must make the probe fail with HTTP 500.

## STAGE 2 — the flip

STAGE 2 IS ONE ROW OF DATA AND NOTHING ELSE. No definition edit, no redeploy, no restart, no client release.

THE FLIP: create ONE item in the SharePoint list AppConfig_Staging with ConfigType = access_policy_enforce and ConfigData = 1. Both Logic Apps read that single row (D-AA-A), so the two doors arm together and there is no window in which one is enforcing and the other is not. UNDO: set the same item's ConfigData to 0, or delete it. The next push run reads the new value.

WHAT MUST BE TRUE BEFORE YOU CREATE THAT ROW — all five, and none of them is part of Stage 1:
1. Both LAs applied and both inertness probes green (5a and 5b, Stage 1a AND 1b).
2. The Stage-1a flip rehearsal done and green: with only the 1a spine installed, set the row to 1, run the probe, get a byte-identical result, delete the row. That rehearses the exact mechanics of the flip with no decision machinery behind it.
3. A Director has published the default policy through the already-applied access-policy-write LA. With the switch on and no blob, evaluateAccess returns NO_POLICY, which this design maps to RETRY — safe, nothing lost, but nothing privileged lands either.
4. Item 10 (user-verify op:'pin') applied, or no staff-role account can mint a PIN grant and stocktake/count plus transfer/receive become un-pushable for them.
5. Person auth actually live in the delivered sync_config, so devices are really carrying a 12h session proof. Without it every gated class defers forever after the flip.

WHAT THE FLIP DOES NOT COVER, and must not be smuggled into it: SRV-P3 (the non-atomic three-item policy write) should be fixed before ingest starts READING the policy; the client-side _policyRequired advertisement is a separate, EARLIER, client-side flip that warns humans and changes no server behaviour; and the fail-closed-on-unknown posture (what happens when the switch read itself fails while enforcement is on) is deliberately NOT in this flip — see the open items.

THE ONE-WAY DOOR IN THE FLIP, stated plainly because it is the only part that is not reversible in seconds: a row or step that comes back in rejected[] is DURABLY quarantined on the device (DB.markTransactionsRejected / markStepsRejected — I read both). Setting the row back to 0 does NOT un-quarantine it. Rows in failed[] with retryable:true recover by themselves. So: flip in a quiet window, watch the first few push responses, and roll back at the first unexpected ACCESS_DENIED rather than after it.

## MUST NOT DO

- BREAK 1 — NEVER add an action whose name is already used on the target LA, and never assume a name is free on both LAs because it is free on one. `ToInsert2` is FREE on push-v2 and TAKEN on recordsteps (the Chunk-9/10 hold-back); `Q2_loop` is likewise free on one and taken on the other. Logic App actions are a JSON object keyed by name, so a second definition OVERWRITES the first. Run `node audit-artifacts/check-name-collisions.js <la> <name>…` and require exit 0 before every apply, and put the final names in PLANNED_ADDITIONS so the no-argument run is meaningful. I ran the gate on all 33 planned names against BOTH captures (exit 0 both) and mutation-tested it on each LA (Attest_rows on push-v2, Insert_loop on recordsteps — exit 1, dependents named).
- BREAK 2 — NEVER re-parent Attest_failed_map. Exactly ONE existing action reads body('ToInsert') on push-v2: Attest_rows. Attest_failed_map.inputs.from is @body('Attest_rows') and must stay that way, with its select unchanged. Re-parenting it makes every ATTEST_UNAVAILABLE entry carry a null TransactionId; I ran the three chains and got live=[TX-A,TX-B], EDIT-13-as-written=[null,null], corrected=[TX-A,TX-B]. The batch is not lost, but the money-seal failure stops being attributable to specific rows.
- BREAK 3 — NEVER merge arrays with concat(). Use union(), and wrap it in @if(empty(<the new array>), <the original expression>, union(…)) so Stage 1 is byte-identical rather than merely equivalent — union() de-duplicates, and Map_rejected can legitimately hold two identical entries. All 8 concat() uses on push-v2 and all 6 on recordsteps are string builds; recordsteps' only two array merges are union().
- THE BLIND PROBE — NEVER write a recordsteps fixture that leaves ctx empty. transfer/backfill + stocktake/approve matches neither Context_steps.where nor LedgerSteps.where; I ran it and got ctx=0, and with ctx=0 the hold-back defects M1/M2 balance the invariant and are invisible. A fixture must produce entries in BOTH ctx baskets.
- NEVER go near the Ctx machinery. Do not redefine, rename, re-order or re-parent ToInsert, ToInsert2, Context_steps, Context_loop, Batch_genesis, Get_genesis, Ctx_has_genesis, Ctx_match, Append_ctx_*, Ctx_pre_ids, LedgerSteps, Ledger_loop, any L_*, Ctx_ids, Ctx_rejects, Ctx_pendings, Map_ctx_*, Q2_loop or Quarantine_loop. Ctx_match's then-branch must stay EMPTY and L_pend_if must stay without an else — those absences ARE the pass cases. LedgerSteps' trailing not(contains(body('Ctx_pre_ids'),StepId)) must stay, or resolve/cancel steps get appended to ctx twice and double-counted. Concurrency repetitions:1 stays on all five existing Foreach actions. READING body('ToInsert2') is the safe interface; redefining it is the incident.
- NEVER remove a step or row from the insert path without adding it to a COUNTED Invariant term. inputCount must equal accepted+duplicates+Rejected+Ctx_rejects+failed+Ctx_pendings+AA_removed. Otherwise: HTTP 500 {status:error, reason:invariant_failed}, no acknowledgement, and the device retries a batch whose rows are already durable. I ran the omission (M3): sum 6 vs 7, invariant false, on the very first denial.
- NEVER count |aaDeny|+|aaRetry| when you mean 'how many rows did the filter remove'. Count length(body('AA_removed')), the literal complement Query over the same source, so the removed set and the counted set cannot drift.
- NEVER classify or filter over ToInsert on recordsteps. It must be ToInsert2. I ran the slip (M1): deny a step ctx had already held back and the sum goes 8 vs 7 → 500, nothing acked.
- NEVER append access-retry rows into the existing `failed` variable on push-v2. Set_failed_attest is a whole-variable SetVariable (failed := @body('Attest_failed_map')) with no ordering relationship to a new append, so on any attestation blip the appended rows vanish and the Invariant under-counts. Keep retries in their own variable and merge only into the response body — then Set_failed_attest never has to be touched.
- NEVER express an edit against a key that does not exist. A Foreach has `foreach` and NO `inputs` key (so 'Quarantine_loop.inputs.from' / 'Insert_loop.inputs.from' are unapplyable). An If carries a TOP-LEVEL `expression` key and no inputs.expression — I hit this today reading L_decide and Respond off the capture. Check the actual key before writing the instruction.
- NEVER summarise a runAfter map — restate it in full. push-v2's Invariant has four parents ({Insert_loop:[Succeeded,Skipped], Map_rejected:[Succeeded], Quarantine_loop:[Succeeded,Failed], Set_failed_attest:[Succeeded,Skipped]}); recordsteps' has three, all Succeeded-only. The old EDIT 16 named two of push-v2's four.
- NEVER let a new action be reachable from AA_gate only via ['Succeeded']. With the switch off the gate is Skipped; a spine that does not tolerate Skipped stalls, the Invariant never runs, no Response action runs at all, and every push gets a bare 502. Every spine edge from the gate downward is ['Succeeded','Failed','Skipped','TimedOut'].
- NEVER write an expression that can throw. Index only through coalesce, because I could NOT settle from the captures whether Logic Apps short-circuits if() or what body()/outputs() return for a Failed/TimedOut/Skipped action. A throwing expression on this path means no Response, not a graceful failure.
- NEVER gate Type 'in' at push-v2. Pages._saveDelivery writes {type:'in', storeId:'head_office'} under Auth.can('recordDelivery') and Pages._submitLog writes type:'in' for an ordinary staff Stock IN with no capability gate, and Sync._toSharePoint sends no trustworthy field distinguishing them. The default seed has roles.staff.recordDelivery=false, so gating all 'in' rows would permanently ACCESS_DENIED every staff stock-in the moment you flip. Enforce recordDelivery at the recordsteps delivery/record + delivery/packaging_edit steps instead (deviation from §3 and matrix row 1 — needs Kunal's sign-off).
- NEVER flip with only one LA applied. A stock-take approval writes BOTH a stocktake/approve step and adjustment ledger rows; a receive writes a receive step and transfer_in rows. Enforcing on one door lets half of each pair land — exactly the step-vs-ledger divergence the records fold exists to detect.
- NEVER add or remove a key in Response_ok, Response_invariant_fail or Response_401 in Stage 1. Those three bodies are the entire inertness baseline and there is no Terminate action anywhere. In particular do not add an 'enforcement state' key for observability — read it from run history instead.
- NEVER treat 'the switch read failed' as 'enforcement is on' in Stage 1. Unknown collapses to off. And never treat a policy blob merely EXISTING as enforcement: publishing and enforcing are two separate acts (D-AA-A), which is also why §7, §8 and §10 each need the same guard before they land.
- NEVER apply item 5 first in the batch, and never apply 5a and 5b in the same sitting. It is the only item on the shared sharepointonline connection and it gates the sync write path; rehearse the apply/rollback mechanics on the six low-risk items first.

## THE INERTNESS PROBE

THE PROBE THAT WOULD HAVE CAUGHT ALL THREE BREAKS. Runner: a new audit-artifacts/probe-item5-inert.js in the shape of the existing apply-c1-staging.js — az CLI in-process, keys from the gitignored staging-keys file, no shell pipes, nothing printed but verdicts. Run it as BASELINE before any edit, then after 5a-1a, after 5a-1b, after 5b-1a, after 5b-1b, and once more with the flag temporarily at 1 during the Stage-1a rehearsal.

WHY THE OLD FIXTURE SAW NOTHING, PROVEN: the old recordsteps fixture (one transfer/backfill + one stocktake/approve) matches neither Context_steps.where (transfer AND resolve|cancel) nor LedgerSteps.where. I ran it: ctx=0, so ToInsert2 equals ToInsert and an overwritten or bypassed hold-back is arithmetically indistinguishable from the real one (M4 in my output: sum 2 vs 2, holds=true, defect invisible).

RECORDSTEPS FIXTURE — 7 steps, ONE batch, pushed with the DIRECTOR key. The director key is not a convenience: I ported the deployed Validate ladder and ran it, and a transfer/resolve pushed on a store key comes back DIRECTOR_REQUIRED, lands in Rejected, and NEVER REACHES the Ctx pipeline at all. A store-key fixture cannot exercise Ctx_match no matter what else it does.
  S1 stocktake/count, OwnerStoreId in scope                                  → expect accepted, row present
  S2 transfer/submit, Payload.expectedLedgerKeys = ['tx_<probe>_missing']     → expect Ctx_pendings / LEDGER_CONTEXT_PENDING, retryable, ABSENT from RecordSteps_Staging
  S3 transfer/submit, 201 bogus expectedLedgerKeys (trips L_decide's >200)    → expect Ctx_rejects / BAD_LEDGER_CONTEXT + one quarantine row, ABSENT
  S4 transfer/resolve for a RecordId with no genesis in the batch or the list → expect Ctx_pendings / TRANSFER_CONTEXT_PENDING, ABSENT
  S5 transfer/resolve whose in-batch genesis S5g has a DIFFERENT FromStoreId  → expect Ctx_rejects / BAD_TRANSFER_CONTEXT + quarantine row, ABSENT
  S5g transfer/submit genesis for S5, expectedLedgerKeys []                   → expect accepted, row present
  S6 stocktake with a bogus StepType                                          → expect Rejected / BAD_STEPTYPE + quarantine row, ABSENT
I ran this fixture through the captured predicates: inputCount=7, Rejected=1, ToInsert=6, ctx=4 ([S4 pending, S5 reject, S2 ledger_pending, S3 ledger_reject]) — all four ctx kinds — Ctx_rejects=2, Ctx_pendings=2, ToInsert2=[S1,S5g]. The hold-back is genuinely doing work in this fixture, which is the whole requirement.

PUSH-V2 FIXTURE — 5 rows, ONE batch, run twice (director key, then store key): R1 type 'out' (ungated); R2 'adjustment_in' (already director-gated today, so the store-key run must return DIRECTOR_REQUIRED for it); R3 'deleted' tombstone with Qty 0 and a valid TargetTransactionId (NOT director-gated today — the class that really changes at Stage 2); R4 'transfer_in'; R5 a deliberately invalid Type (expect BAD_TYPE + quarantine). Plus the ATTEST-OUTAGE CASE: re-run the same batch with Call_attest's URI temporarily invalidated on the STAGING LA only, and assert every failed[] entry carries a REAL TransactionId — that is the standing regression test for BREAK 2 — then restore from the PRE capture.

ASSERTIONS (all must hold; A5 and A6 are the ones the old probe lacked):
  A1  HTTP 200, body.status 'ok'.
  A2  every fixture id is in exactly the expected bucket, and inputCount is right.
  A3  the response arrays reconcile: accepted+duplicates+|rejected|+|failed| = inputCount (recordsteps: the union'd rejected[] and failed[] carry the ctx entries too).
  A4  READ BACK the target list. RecordSteps_Staging contains ONLY S1 and S5g; StockTransactions_Validate contains only the rows that were accepted, each with a POPULATED EconSig (that proves the Attest_rows re-parent did not break the seal).
  A5  RUN HISTORY, per action status and output — this is the part that makes the probe able to see the Ctx machinery at all: length(body('Ctx_ids')) > 0 (proof the hold-back actually ran, not that it happened to be a no-op); body('AA_removed') == []; outputs('AA_enforce') == 'off'; AA_gate status == Skipped; and from 1b onward AA_policy, AA_actor and every AA_eval_* status == Skipped. Read with az rest GET .../runs then .../runs/<runId>/actions and assert properties.status.
  A6  the AFTER response equals the BASELINE response field-for-field except serverTimestamp and the probe ids. Diff it mechanically; do not eyeball it.
  A7  StockTransactions_Quarantine gained rows for S3, S5, S6 only — nothing for S1, S2, S4 (a deferred step must never be quarantined).
  A8  CLEANUP: delete every probe step, row and quarantine row and re-assert zero residue (house rule — earlier chunk audits left 21 orphans).
  A9  For 24h after each apply, watch the LIVE push/pull/config/email run history for ActionThrottled/429 on the shared sharepointonline connection, not just the staging app's. Stage 1 adds exactly one small OData GET per push run.

## THE MUTATION THAT MUST MAKE THE PROBE FAIL

EVERY MUTATION BELOW IS APPLIED TO THE STAGING DEFINITION ONLY AND REVERTED FROM THE PRE CAPTURE IMMEDIATELY. A gate you have never seen fail is not a gate — if the inertness probe stays green under these, it is measuring nothing.

M-A — THE NEW DESIGN'S OWN WORST MISTAKE (recordsteps, lead with this one). Change AA_insertable.inputs.from from @body('ToInsert2') to @body('ToInsert') — a one-word slip that no reviewer's eye catches. The probe MUST FAIL: S2, S3, S4 and S5 appear in RecordSteps_Staging, the Invariant goes false, the LA returns HTTP 500 {status:error, reason:invariant_failed}, nothing is acked, and A4/A5 both trip. Simulated result from my run: 11 vs 7, holds=false, 6 steps inserted where 2 should have been. Variant M-A2: leave the source right but deny a step that ctx had already held back (classify over ToInsert) — sum 8 vs 7, also 500. If the probe passes either of these, the fixture is not exercising Ctx and the whole probe is worthless.

M-B — THE ORIGINAL BREAK 1, REPRODUCED. Add an action literally named ToInsert2 to recordsteps with where '@true'. Two things must happen, in this order: (1) `node audit-artifacts/check-name-collisions.js bob-stock-recordsteps-push-staging ToInsert2` must exit 1 and name the dependents BEFORE anything reaches the cloud (I ran it: it does, citing Authorized [then] > ToInsert2, body('ToInsert2') is read, runAfter dependent Insert_loop); (2) if it is applied anyway, the probe must fail exactly as in M-A. This is the standing regression test for the incident that caused the re-spec.

M-C — THE ARITHMETIC. Delete length(body('AA_removed')) from the Invariant, set the flag to 1, and deny one row. Expect HTTP 500 invariant_failed and no ack. Simulated: 6 vs 7, holds=false. Variant: count length(variables('aaDeny'))+length(variables('aaRetry')) instead of length(body('AA_removed')) and feed a batch with two rows sharing one id where only one is denied — the counts drift and the run 500s, which is why the counted term is the complement Query.

M-D — BREAK 2 (push-v2). Re-parent Attest_failed_map.inputs.from to @body('AA_signable') as the old EDIT 13 said, then force a Call_attest failure. The probe's attest-outage assertion must FAIL because every failed[] entry comes back with TransactionId null. I ran the item shapes: live and corrected give real ids, EDIT-13-as-written gives nulls.

M-E — IS THE SWITCH REAL (this is the Stage-2 gate, run before any real flip). With the full 1a+1b installed and NO policy blob, create AppConfig_Staging ConfigType access_policy_enforce / ConfigData 1 and re-run the identical batch. The inertness probe MUST FAIL, and in a SPECIFIC direction: ungated rows/steps still land in accepted; every gated-class row/step comes back in failed[] with retryable:true and a RETRY: reason; none of them is in the target list; none of them is quarantined; the response is still HTTP 200, not 500. Then set ConfigData back to 0 and re-run — the probe must go green again and the deferred rows must land. If the probe passes UNCHANGED with the flag at 1, the gate was never wired in and everything else in this item is decoration.

M-F — CONTROL, so you know the probes measure THIS deploy. Restore the PRE-ITEM5 capture and re-run M-E. With the old definition the flag is ignored, everything is accepted, and M-E stops failing. Also run the reverse control during Stage 1a: with only the spine installed, set the flag to 1 — the probe must stay GREEN, because there is no decision machinery behind the switch yet. That green is the flip rehearsal, and a red there means the spine is not value-inert.

M-G — THE DENY PATH BITES (needs the seeded default policy and a re-proven srvaudit_ test director; run before any real flip). Push one gated row with a VALID session proof from an account whose policy entry denies the capability: expect rejected[] with reasonCode ACCESS_DENIED, a quarantine row, and nothing in the target list. Then the same row with a fresh purpose-bound sudo proof from the test director: expect accepted with a populated EconSig. If the denied case lands, the check is cosmetic.

## INDEPENDENCE OF THE TWO LOGIC APPS

YES FOR THE TWO DEFINITION APPLIES; NO FOR THE SWITCH. This is a definitive answer, and I checked the coupling rather than assuming it.

THE DEFINITIONS ARE INDEPENDENT. I enumerated both graphs: recordsteps-push reads StockTransactions_Validate (that is the ledger check its hold-back is built on) and push-v2-validate contains ZERO references to RecordSteps. The dependency is one-way, pre-existing, and at the SharePoint data layer, not between the workflows. Each item-5 edit set is inert on its own by construction — the deny/retry sets are empty, the new filter is element-identical to its source, the new Invariant term is 0, and the guarded response merges return the original expressions. So push-v2 can be applied, probed and left running for days with recordsteps untouched, and vice versa. Do exactly that: four separate sittings (5a-1a, 5a-1b, 5b-1a, 5b-1b), each with its own fresh capture, its own rollback artifact and its own probe run. Splitting halves the blast radius of any single sitting on the shared connection and costs nothing.

THE FLIP IS NOT INDEPENDENT AND MUST NOT BE SPLIT. It is ONE AppConfig row read by both LAs (D-AA-A), which is a feature: it makes arming atomic across both doors. A stock-take approval writes BOTH a stocktake/approve step (recordsteps) and adjustment_in/out ledger rows (push-v2); a transfer receive writes a receive step and transfer_in rows; a delivery writes a record step and 'in' rows. Enforcing on one door and not the other lets half of each pair land — the approve step accepted while its adjustment rows are refused, or worse the step held indefinitely as LEDGER_CONTEXT_PENDING. That is precisely the step-versus-ledger divergence the records fold exists to detect, and it is harder to reason about than either extreme. So: apply separately, prove separately, flip once, and only after BOTH sides are armed and probed.

ONE FURTHER SEQUENCING FACT: the flip also depends on items outside item 5 — item 10 (user-verify op:'pin') must be applied first or staff-role accounts cannot mint a PIN grant, and a Director must have published the default policy. Those are prerequisites of Stage 2, not of Stage 1.

## ROLLBACK

FOUR LEVELS, CHEAPEST FIRST. Levels 1 and 2 are seconds and need no redeploy; that asymmetry is the main argument for a data-row switch over a definition constant.

LEVEL 0 — DON'T START WITHOUT THE ARTIFACT. The fresh captures ARE the rollback artifacts and they already exist: audit-artifacts/bob-stock-push-v2-validate-staging-PRE-2026-07-30.json (39 actions) and bob-stock-recordsteps-push-staging-PRE-2026-07-30.json (64 actions). Re-capture immediately before each sitting anyway and commit it, because the captures are only trustworthy while nothing else has been applied — a day-old picture of the machine is exactly what caused this re-spec. Note the captures are DEFINITION-ONLY: parameters.$connections is {defaultValue:{},type:'Object'} with no connection resource ids, so a restore must go through the same az resource create shape apply-c1-staging.js already uses, which preserves the existing connection binding.

LEVEL 1 — UNDO THE FLIP (Stage 2). Set the AppConfig_Staging item ConfigType access_policy_enforce ConfigData to 0, or delete the item. Seconds, no redeploy, no restart; the next push run reads the new value, and both doors disarm together because it is one row. LIMITATION, stated plainly: rows and steps the client has already recorded as rejected[] / ACCESS_DENIED are DURABLY quarantined on the device (DB.markTransactionsRejected, DB.markStepsRejected) and do NOT un-quarantine when the row goes back to 0. Entries in failed[] with retryable:true recover by themselves on the next cycle. So flip in a quiet window and roll back at the first unexpected refusal, not after a day of them.

LEVEL 2 — UNDO ONE APPLY (Stage 1b or 1a) BY REDEPLOYING ITS PRE CAPTURE. az resource create -g bob-stock-sync -n <la> --resource-type Microsoft.Logic/workflows --location australiaeast --properties @audit-artifacts/<la>-PRE-<date>.json. No SharePoint schema or data is touched by any Stage-1 edit, so there is nothing else to reverse; the only data artifact this whole item creates is the single enforce row, which is safe to delete outright. Then RE-RUN THE BASELINE PROBE to confirm the restore actually landed — a restore you have not probed is a hope.

LEVEL 3 — IF SOMETHING IS WRONG AND THE CAUSE IS UNCLEAR. Do level 1 first (it is instant and it disarms both doors), then level 2 on BOTH LAs, not one. A half-reverted pair can split a stock-take approval — step gated, ledger rows not — and that state is harder to reason about than either extreme.

WHAT ROLLBACK CANNOT UNDO, so it must not happen: a denied row already quarantined on a device (level 1 limitation above); a quarantine row already written to StockTransactions_Quarantine (harmless but must be cleaned up by the probe's own cleanup step); and a device that already retried a 500-ing batch (harmless — nothing was acked, the rows are idempotent on TransactionId/IdempotencyKey and come back as duplicates on the next push).
