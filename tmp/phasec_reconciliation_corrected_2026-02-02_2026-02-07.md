# Phase C Reconciliation (Corrected Semantics, 2026-02-02 to 2026-02-07)

Generated: 2026-02-13T03:02:39.948Z

## Validation Semantics
- Draft save integrity uses portal `Edit/Draft Visits`.
- `View Submitted Claim` is admin answer-sheet reference only.

## Summary
- CRM draft rows: 2
- CRM draft found in Edit/Draft: 1
- CRM draft missing in Edit/Draft: 1
- Edit/Draft found but CRM not draft: 1
- CRM error rows: 8
- Admin submitted found (reference): 4
- Defects: 10
- Final verdict: **Needs fix**

## Per-Visit
|#|Visit ID|Patient|NRIC|Date|Pay Type|CRM Status|Draft Found|Draft Ref|Admin Submitted Found|Admin Ref|Issue|
|-:|---|---|---|---|---|---|---|---|---|---|---|
|1|31b5a688-9104-4507-bd7a-347a9f9ce866|MITTAL SACHIN KUMAR|M4539893L|2026-02-02|MHC|draft|yes|EV16090142|yes|EV16085124||
|2|dcbbe4e8-586c-45c4-905a-c76bacfcd860|CAROLINE ADRIANA ARCHER|S7288611I|2026-02-04|MHC|error|no||no||CRM error: save-draft failed|
|3|0a1695ab-8ea3-4fba-b5a5-ec47ea933e40|CHEW SIEW LING|S8635560D|2026-02-03|MHC|null|yes|EV16089253|yes|EV16085316|Portal Edit/Draft has draft but CRM status is not draft|
|4|416a02fb-3feb-435b-b3f8-3f3197a60e0f|TJIA NATHANAEL THOMAS|T1208937B|2026-02-06|MHC|draft|no||no||CRM draft missing in portal Edit/Draft|
|5|60e0c382-d6cb-4d35-a5b9-e17ce5b20c73|ENG CHAI PIN ELYNE XANDRIA|S8570522I|2026-02-03|MHC|error|no||no||CRM error: save-draft failed|
|6|78f0430c-6d4f-4043-a54f-d529e7ef57fb|YIP CHOI YEAN|S0121655D|2026-02-05|MHC|error|no||no||CRM error: save-draft failed|
|7|6eb5aa60-ee97-472b-a904-c4ccf2855b18|FAN HONGYI|S8481103C|2026-02-02|MHC|error|no||no||CRM error: save-draft failed|
|8|6af6ea13-14d9-43c6-917e-d0ca5da4ab0f|HASLINA BINTE HASSAN BASRI|S7349449D|2026-02-02|MHC|error|no||no||CRM error: save-draft failed|
|9|b19f4854-6445-4965-a695-befdc5f1c531|SZENTIRMAY IBOLYA MARGARET|M4427511W|2026-02-02|MHC|null|no||no||Accepted exception: member not found|
|10|c3c483d2-83d4-46be-936e-77767dd568b3|FAN HONGYI|S8481103C|2026-02-03|MHC|error|no||no||CRM error: save-draft failed|
|11|a50239f6-9cd2-44a8-9bbf-4784e1dc51e1|LIM CHUI KIOW|S7030442B|2026-02-07|AVIVA|error|yes|EV7116404|yes|EV7116058|CRM error: save-draft failed|
|12|1e48b9cf-fe14-4c33-bbb3-f25c2b8e3bb7|YEONG MEI-YI|S7839254A|2026-02-06|AVIVA|error|no||yes|EV7116057|CRM error: save-draft failed while admin submitted claim exists|
