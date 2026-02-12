# RPA Phase Control (Lock Document)

Last updated: 2026-02-11 (Phase C complete for 2026-02-02..2026-02-07)
Owner: RPA team

## Purpose
Use this file as the single source of truth for what is frozen, what can change, and what must pass before moving phases.

## Current Phase State
- Phase A (Flow 1 + Flow 2): LOCKED
- Phase B (Flow 3 per TPA): COMPLETE (MHC/AIA/AVIVA-Singlife path validated)
- Phase C (Batch + Save Draft): COMPLETE (range pass with one accepted member-not-found record)

## Latest Phase B/C Validation (2026-02-11)
Portal-only fill run:
- command: `node -r dotenv/config src/examples/submit-claims-batch.js --from 2026-02-02 --to 2026-02-07 --portal-only`
- log: `logs/phasec_full_rerun_after_aiafix_20260211_175134.log`
- result: total=10, filled_only=9, errors=0, not_started=1

Save-as-draft run:
- command: `node -r dotenv/config src/examples/submit-claims-batch.js --from 2026-02-02 --to 2026-02-07 --portal-only --save-as-draft`
- log: `logs/phasec_save_draft_run_20260211_175903.log`
- result: total=10, drafts=9, errors=0, not_started=1

Accepted not-started record:
- patient: SZENTIRMAY IBOLYA MARGARET
- ID/FIN: `M4427511W`
- reason: member not found in portal (manual check also unable to find); accepted to skip.

## Phase A Freeze Decision
Flow 1 and Flow 2 are frozen with this accepted rule:
- If diagnosis is not found in ClinicAssist after checking Diagnosis, All, Visit, and Past Notes tabs, leave diagnosis blank.

Latest Phase A validation for 2026-02-02 to 2026-02-07:
- rows: 53
- detailsExtractionStatus: completed=53
- missingNric: 0
- missingMeds: 0
- junkMeds: 0
- missingDiagnosis: 9 (accepted as source-missing)
- notCompleted: 0

## Do-Not-Change Scope (Frozen)
Do not modify these unless Phase A is explicitly reopened:
- `src/automations/clinic-assist.js`
- `src/core/visit-details-extractor.js`
- `src/core/batch-extraction.js`
- `src/examples/extract-visit-details-batch.js`
- `src/examples/validate-extraction-range.js`
- `src/utils/extraction-validator.js`

## Allowed Changes Now (Phase B)
Only Flow 3 portal submit/fill behavior can change:
- MHC/AIA/Singlife routing and form filling
- Portal navigation speed/reliability
- Portal field mapping and dialog handling
- Save-as-draft behavior (only after Phase C gate)

## Required Gate Before Any Save-As-Draft
Run:
- `node src/examples/validate-extraction-range.js --from 2026-02-02 --to 2026-02-07`

Must be true:
- `detailsExtractionStatus`: all completed
- `missingNric = 0`
- `missingMeds = 0`
- `junkMeds = 0`
- `notCompleted = 0`
- `missingDiagnosis`: allowed only for accepted source-missing records

## Known Accepted Source-Missing Diagnosis Records (Phase A)
- `6af6ea13-14d9-43c6-917e-d0ca5da4ab0f` (MHC)
- `c69e5c5f-f4d8-4a12-8016-bd137643deef` (ALLIANZ)
- `60e0c382-d6cb-4d35-a5b9-e17ce5b20c73` (MHC)
- `9e97289d-510e-46bf-a02c-e52e77508b2d` (FULLERT)
- `78f0430c-6d4f-4043-a54f-d529e7ef57fb` (MHC)
- `6fa8d049-029f-4cc0-ae66-5ba8bf84c9ee` (FULLERT)
- `feaccfe2-3159-4abd-b9f0-24af662b9f68` (FULLERT)
- `b4d2ecf8-c330-4edd-9a80-600884bf38eb` (IHP)
- `911fe388-b1bc-408f-a490-4861168d515a` (ALLIANZ)

## Working Rules
- No browser stack/toolchain changes during Phase B/C (no Playwright install/reinstall changes).
- One issue at a time: reproduce, fix, retest, then move to next.
- Use explicit date ranges in all test commands.
- If a run fails mid-way, rerun only failed IDs first before re-running full range.
- Do not run unscoped claim batch from CLI. Use `--from/--to` (and usually `--portal-only`) unless `--all-pending` is explicitly intended.

## Incident Guardrails (2026-02-11)
- `src/examples/submit-claims-batch.js` now supports `--help` properly and exits without running.
- Unscoped CLI runs are blocked unless `--all-pending` is provided explicitly.
- `src/core/claim-submitter.js` excludes null/empty `pay_type` rows from pending-claims query.

## Reopen Procedure (Only if needed)
If Phase A must be reopened:
1. Mark this file: `Phase A = REOPENED`.
2. Record reason and exact failing evidence.
3. Apply minimal patch.
4. Re-run full Phase A gate.
5. Set Phase A back to `LOCKED`.
