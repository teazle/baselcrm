# Flow 2 vs Answer Sheet Gap Analysis

- Generated at: 2026-02-14T08:52:16.941Z
- Truth visits: 12
- Found in DB: 12
- Missing in DB: 0
- Diagnosis code mismatches: 1
- Diagnosis text mismatches: 1
- Fee mismatches: 0
- MC day mismatches: 0
- Flow 2 diagnosis not resolved: 4

## Primary Gaps

- none: 8
- flow2_diagnosis_resolution_ambiguous: 3
- flow2_wrong_diagnosis_mapping: 1

## Rows

|visit_id|patient|date|pay_type|answer_diag|flow2_diag|diag_match|answer_fee|flow2_amount|fee_match|answer_mc|flow2_mc|mc_match|primary_gap|
|---|---|---|---|---|---|---|---:|---:|---|---:|---:|---|---|
|6eb5aa60-ee97-472b-a904-c4ccf2855b18|FAN HONGYI|2026-02-02|MHC|S83.411A - Sprain of the knee|S83.411A - Sprain of the knee|yes||130.8||0|0|yes|none|
|dcbbe4e8-586c-45c4-905a-c76bacfcd860|CAROLINE ADRIANA ARCHER|2026-02-04|MHC|M54.5 - Low back pain (Loin pain; Low back strain; Lumbago NOS)|M54.5 - Low back pain|yes||0||0|0|yes|none|
|6af6ea13-14d9-43c6-917e-d0ca5da4ab0f|HASLINA BINTE HASSAN BASRI|2026-02-02|MHC|S83.411A - Sprain of the knee|S83.411A - Sprain of the knee|yes||239.8||0|0|yes|none|
|60e0c382-d6cb-4d35-a5b9-e17ce5b20c73|ENG CHAI PIN ELYNE XANDRIA|2026-02-03|MHC|M79. 672 - Left foot/heel pain|R69 - Illness, unspecified|no||130.8||0|0|yes|flow2_wrong_diagnosis_mapping|
|0a1695ab-8ea3-4fba-b5a5-ec47ea933e40|CHEW SIEW LING|2026-02-03|MHC||S83.6 - Sprain Of The Knee||87.2|87.2|yes|0|0|yes|none|
|a50239f6-9cd2-44a8-9bbf-4784e1dc51e1|LIM CHUI KIOW|2026-02-07|AVIVA||M54.5 - Low back pain||87.2|87.2|yes|0|0|yes|flow2_diagnosis_resolution_ambiguous|
|b19f4854-6445-4965-a695-befdc5f1c531|SZENTIRMAY IBOLYA MARGARET|2026-02-02|MHC||Pain in right hip|||87.2||0|||flow2_diagnosis_resolution_ambiguous|
|416a02fb-3feb-435b-b3f8-3f3197a60e0f|TJIA NATHANAEL THOMAS|2026-02-06|MHC|S635 - Sprain and strain of wrist|S63.5 - Sprain and strain of wrist|yes||0||0|0|yes|none|
|31b5a688-9104-4507-bd7a-347a9f9ce866|MITTAL SACHIN KUMAR|2026-02-02|MHC||M25.51 - Pain in right shoulder||283.4|283.4|yes|0|0|yes|none|
|1e48b9cf-fe14-4c33-bbb3-f25c2b8e3bb7|YEONG MEI-YI|2026-02-06|AVIVA||S83.6 - Sprain Of The Knee|||20||0|0|yes|flow2_diagnosis_resolution_ambiguous|
|c3c483d2-83d4-46be-936e-77767dd568b3|FAN HONGYI|2026-02-03|MHC|S83.411A - Sprain of the knee|S83.411A - Sprain of the knee|yes||343.35||0|0|yes|none|
|78f0430c-6d4f-4043-a54f-d529e7ef57fb|YIP CHOI YEAN|2026-02-05|MHC||Pain in left hip|||0||0|0|yes|none|
