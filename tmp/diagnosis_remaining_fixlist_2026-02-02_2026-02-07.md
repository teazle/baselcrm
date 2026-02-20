# Remaining Diagnosis Fixlist (2026-02-02 to 2026-02-07)

Generated: 2026-02-13T17:27:40Z

## Current status
- QA semantic mismatch bucket: 0 (`mismatch_should_not_save=0`)
- Remaining blocked rows: 5
- Missing answer sheet exceptions: 2 (`M4427511W`, `S0121655D`)

## Blocked rows requiring action

1. `60e0c382-d6cb-4d35-a5b9-e17ce5b20c73` | `S8570522I` | 2026-02-03 | `MHC`
- State: `missing` (`not_found_in_diagnosis_all_visit_pastnotes`)
- Flow 2: missing diagnosis
- Submitted answer sheet: `M79.672 / Left foot/heel pain`
- Action type: source-data gap (cannot infer safely from current clinic extraction sources)

2. `1e48b9cf-fe14-4c33-bbb3-f25c2b8e3bb7` | `S7839254A` | 2026-02-06 | `AVIVA`
- State: `ambiguous` (`generic_without_laterality`)
- Flow 2: `S83.6 / Sprain Of The Knee`
- Submitted answer sheet: `S934 / Sprain and strain of ankle`
- Action type: source conflict; keep blocked under strict gate

3. `a50239f6-9cd2-44a8-9bbf-4784e1dc51e1` | `S7030442B` | 2026-02-07 | `AVIVA`
- State: `ambiguous` (`diagnosis_source_too_old_for_on_before_policy`)
- Flow 2: `M54.5 / Low back pain` (source age 449 days)
- Submitted answer sheet: `S134 / Sprain and strain of cervical spine`
- Action type: date-policy/source mismatch; keep blocked under strict gate

4. `b19f4854-6445-4965-a695-befdc5f1c531` | `M4427511W` | 2026-02-02 | `MHC`
- State: blocked (`missing_answer_sheet`)
- Action type: accepted exception for now

5. `78f0430c-6d4f-4043-a54f-d529e7ef57fb` | `S0121655D` | 2026-02-05 | `MHC`
- State: blocked (`missing_answer_sheet`)
- Action type: accepted exception for now

## Newly improved in this pass
- `6eb5aa60-ee97-472b-a904-c4ccf2855b18` (`S8481103C`) moved from ambiguous to resolved (`S83.411A`) under MHC-family deterministic program rule.
- `0a1695ab-8ea3-4fba-b5a5-ec47ea933e40` (`S8635560D`) remains resolved with exact-date diagnosis and no QA semantic mismatch.
