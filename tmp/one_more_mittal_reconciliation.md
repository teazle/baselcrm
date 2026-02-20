# One-More MITTAL Reconciliation (Full Field-by-Field)

Generated: 2026-02-12T09:59:30.819Z

## Target
- Visit ID: 31b5a688-9104-4507-bd7a-347a9f9ce866
- Patient: MITTAL SACHIN KUMAR
- NRIC: M4539893L
- CRM Visit Date: 2026-02-02
- Submitted Reference: EV16085124

## Locked Rules Check
- Run result Drafts=1 Errors=0: FAIL
- CRM status is draft: FAIL
- Draft exists in Edit/Draft: FAIL
- Draft visit date == 2026-02-02 (02/02/2026): FAIL
- Field-by-field critical mismatches: PASS

## Final Verdict: **FAIL**

### Failure Reasons
- Run summary not successful (Drafts=0, Errors=1)
- CRM status is error not draft
- Draft not found in Edit/Draft
- Draft visit date mismatch (none vs expected 02/02/2026)

## Draft Truth
- draft_found: no
- draft_reference: (none)
- draft_visit_date: (none)
- portal_context: mhc|aia
- evidence_path: /Users/vincent/Baselrpacrm/screenshots/one-more-mittal/draft/31b5a688-9104-4507-bd7a-347a9f9ce866.png

## Field Diff Summary
- total keys: 319
- matches: 0
- mismatches: 0
- missing_in_draft: 319
- missing_in_submitted: 0

## High-Signal Fields
|key|submitted|draft|category|
|---|---|---|---|
|basicdrugnoofdays|-1||missing_in_draft|
|bsinpanel drugmaxpricecheck|N||missing_in_draft|
|checkdrugdiagnosis|N||missing_in_draft|
|cleardrug|C ||missing_in_draft|
|clearprocedure|C ||missing_in_draft|
|consultfee|120.00||missing_in_draft|
|diagnosis3desc|||missing_in_draft|
|diagnosis3idtemp|/NA||missing_in_draft|
|diagnosis4desc|||missing_in_draft|
|diagnosis4idtemp|/NA||missing_in_draft|
|diagnosispridesc|M25.511 - Pain in the right shoulder||missing_in_draft|
|diagnosispriid|1971ee360aa4||missing_in_draft|
|diagnosispriidtemp|/NA||missing_in_draft|
|diagnosissecdesc|||missing_in_draft|
|diagnosissecidtemp|/NA||missing_in_draft|
|drug amount|140.0||missing_in_draft|
|drug checkstr|-1,0.0||missing_in_draft|
|drug defaultunitprice|0.0||missing_in_draft|
|drug drugcode|CAPCELEB2940||missing_in_draft|
|drug drugname|CELEBREX CAP 200MG (CELECOXIB)||missing_in_draft|
|drug eligibleforadjusted|Y||missing_in_draft|
|drug eligibleforadjusted2|N||missing_in_draft|
|drug maxqty|60||missing_in_draft|
|drug maxunitprice|2.8||missing_in_draft|
|drug multiplier|-1.0||missing_in_draft|
|drug oldmultiplier|-1.0||missing_in_draft|
|drug pos|-1||missing_in_draft|
|drug quantity|40.0||missing_in_draft|
|drug unit|CAP||missing_in_draft|
|drug unitprice|3.5||missing_in_draft|
|drug version|1||missing_in_draft|
|drugfee|140.00||missing_in_draft|
|drugformulary|4||missing_in_draft|
|drugsetforworkmencomponly|N||missing_in_draft|
|exclconsultfee|0||missing_in_draft|
|extradrugcostperday|-1||missing_in_draft|
|freeconsult|N||missing_in_draft|
|freeconsultcount|0||missing_in_draft|
|freetextdrug|N||missing_in_draft|
|istier2consult|N||missing_in_draft|
|limitexclconsult|N||missing_in_draft|
|maxdrugnoofdays|-1||missing_in_draft|
|noofdaysdrugprescribed|0||missing_in_draft|
|noofdrugrows|1||missing_in_draft|
|noofprocedurerows|1||missing_in_draft|
|procedure amount|0.00||missing_in_draft|
|procedure amountb4copay|0.00||missing_in_draft|
|procedure copay|0.00||missing_in_draft|
|procedure pos|-1||missing_in_draft|
|procedure procedurename|||missing_in_draft|
|procedure version|1||missing_in_draft|
|procedurecopay|0.00||missing_in_draft|
|procedurefee|0.00||missing_in_draft|
|procedurefeeclaim|0.00||missing_in_draft|
|selectdiagnosisfrommaster|M  / M  / M  / M ||missing_in_draft|
|selectmasterdrug|M ||missing_in_draft|
|selectmasterprocedure|M ||missing_in_draft|
|show4diagnosis|Y||missing_in_draft|
|showclaimremarks|N||missing_in_draft|
|showdiagnosis|Y||missing_in_draft|
|showprocedurecopay|N||missing_in_draft|
|specialremarks|TCM:1 VISIT PER DAY SP:WAIVER OF REFERRAL LETTER PRESCRIBED BIRTH CONTROL PILLS IS COVERED. PLEASE SEND REQUEST TO MHC TO SUBMIT CLAIM.||missing_in_draft|
|tier2consult|N||missing_in_draft|
|voidremarks|||missing_in_draft|

## Artifacts
- Run log: /Users/vincent/Baselrpacrm/logs/one_more_mittal_save_draft_20260212_165520.log
- Draft truth CSV: /Users/vincent/Baselrpacrm/tmp/one_more_mittal_draft_truth.csv
- Draft truth JSON: /Users/vincent/Baselrpacrm/tmp/one_more_mittal_draft_truth.json
- Submitted snapshot JSON: /Users/vincent/Baselrpacrm/tmp/one_more_mittal_submitted_snapshot.json
- Field diff JSON: /Users/vincent/Baselrpacrm/tmp/one_more_mittal_field_diff.json
- Submitted screenshot: /Users/vincent/Baselrpacrm/screenshots/one-more-mittal/submitted/31b5a688-9104-4507-bd7a-347a9f9ce866.png
