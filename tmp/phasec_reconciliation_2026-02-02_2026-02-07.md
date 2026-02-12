# Phase C Reconciliation (2026-02-02 to 2026-02-07)

Generated: 2026-02-12T03:04:39.864Z

## Inputs
- Canonical run targets: `/Users/vincent/Baselrpacrm/tmp/phasec_run_targets_2026-02-02_2026-02-07.csv`
- Truth sheet: `/Users/vincent/Baselrpacrm/tmp/view_submitted_claim_truth_2026-02-02_2026-02-07.csv`

## Summary Counts
- CRM draft (attempted set): 8
- Portal truth rows checked: 12
- Portal truth pending: 0
- Mismatches: 6
- Final verdict: **Needs fix**

## Per-Visit Reconciliation
|#|Visit ID|Patient|NRIC|Date|Pay Type|CRM Status|Portal Found|Portal Status|Portal Ref|Mismatch|Notes|
|-:|---|---|---|---|---|---|---|---|---|---|---|
|1|6eb5aa60-ee97-472b-a904-c4ccf2855b18|FAN HONGYI|S8481103C|2026-02-02|MHC|draft|no|not_found_in_view_submitted||CRM draft but portal not found|auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|2|dcbbe4e8-586c-45c4-905a-c76bacfcd860|CAROLINE ADRIANA ARCHER|S7288611I|2026-02-04|MHC|error|no|not_found_in_view_submitted|||auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|3|6af6ea13-14d9-43c6-917e-d0ca5da4ab0f|HASLINA BINTE HASSAN BASRI|S7349449D|2026-02-02|MHC|draft|no|not_found_in_view_submitted||CRM draft but portal not found|auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|4|60e0c382-d6cb-4d35-a5b9-e17ce5b20c73|ENG CHAI PIN ELYNE XANDRIA|S8570522I|2026-02-03|MHC|error|no|not_found_in_view_submitted|||auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|5|0a1695ab-8ea3-4fba-b5a5-ec47ea933e40|CHEW SIEW LING|S8635560D|2026-02-03|MHC|draft|yes|submitted:Visit|EV16085316||auto-check:mhc; result_rows=1; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|6|a50239f6-9cd2-44a8-9bbf-4784e1dc51e1|LIM CHUI KIOW|S7030442B|2026-02-07|AVIVA|draft|yes|submitted:Visit|EV7116058||auto-check:singlife; result_rows=1; url=https://www.pcpcare.com/pcpcare/ClinicIECAvivaEmpVisitListSubmit.ec|
|7|b19f4854-6445-4965-a695-befdc5f1c531|SZENTIRMAY IBOLYA MARGARET|M4427511W|2026-02-02|MHC|null|no|not_found_in_view_submitted|||Accepted exception candidate: member not found in portal (verify again in View Submitted Claim); auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec; Accepted exception confirmed: member not found in View Submitted Claim|
|8|416a02fb-3feb-435b-b3f8-3f3197a60e0f|TJIA NATHANAEL THOMAS|T1208937B|2026-02-06|MHC|draft|no|not_found_in_view_submitted||CRM draft but portal not found|auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|9|31b5a688-9104-4507-bd7a-347a9f9ce866|MITTAL SACHIN KUMAR|M4539893L|2026-02-02|MHC|draft|yes|submitted:Visit|EV16085124||auto-check:mhc; result_rows=1; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|10|1e48b9cf-fe14-4c33-bbb3-f25c2b8e3bb7|YEONG MEI-YI|S7839254A|2026-02-06|AVIVA|error|yes|submitted:Visit|EV7116057|Portal has claim/draft but CRM is not draft|auto-check:singlife; result_rows=1; url=https://www.pcpcare.com/pcpcare/ClinicIECAvivaEmpVisitListSubmit.ec|
|11|c3c483d2-83d4-46be-936e-77767dd568b3|FAN HONGYI|S8481103C|2026-02-03|MHC|draft|no|not_found_in_view_submitted||CRM draft but portal not found|auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
|12|78f0430c-6d4f-4043-a54f-d529e7ef57fb|YIP CHOI YEAN|S0121655D|2026-02-05|MHC|draft|no|not_found_in_view_submitted||CRM draft but portal not found|auto-check:mhc; result_rows=0; url=https://www.mhcasia.net/mhc/ClinicEmpVisitPlusAListSubmit.ec|
