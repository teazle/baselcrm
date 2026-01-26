# RPA Flow Data Contracts

This document defines the data contracts for each RPA flow to ensure UI logic consistency.

## Flow 1: Extract Excel from Clinic Assist

**Data Source**: `rpa_extraction_runs` table

**Filter**: `run_type = 'queue_list'`

**Key Fields**:
- `started_at` (timestamptz): **Actual extraction time** - displayed as "Extraction Time"
- `finished_at` (timestamptz): Completion time (optional)
- `status` (text): `'running'`, `'completed'`, `'failed'`
- `total_records` (int): Total queue items extracted
- `completed_count` (int): Successfully extracted items
- `failed_count` (int): Failed extractions
- `metadata.date` (jsonb): Report date (YYYY-MM-DD format)

**Display Rules**:
- Show `started_at` as the primary extraction time
- Use `metadata.date` if available, otherwise use date portion of `started_at`
- Status badges: `running` → "In progress", `completed` → "Completed", `failed` → "Failed"

## Flow 2: Enhance Data for Contract Organizations

**Data Source**: `visits` table

**Filter**: `source = 'Clinic Assist'`

**Key Fields**:
- `extraction_metadata.detailsExtractionStatus` (text): `'completed'`, `'failed'`, `'in_progress'`, or `null` (pending)
- `extraction_metadata.detailsExtractedAt` (timestamptz): When extraction completed
- `extraction_metadata.detailsExtractionLastAttempt` (timestamptz): Last attempt timestamp
- `extraction_metadata.pcno` (text): Patient card number (PCNO)
- `extraction_metadata.diagnosisCode` (text): Diagnosis code extracted
- `pay_type` (text): Contract organization (MHC, Alliance, Fullerton, etc.)

**Display Rules**:
- Status: `null` → "Pending", `'in_progress'` → "In progress", `'completed'` → "Completed", `'failed'` → "Failed"
- Last updated: Use `detailsExtractedAt` if available, otherwise `detailsExtractionLastAttempt`, otherwise `updated_at`
- Filter by contract org: Match `pay_type` against organization names (case-insensitive)

## Flow 3: Fill Claim Forms

**Data Source**: `visits` table

**Filter**: `source = 'Clinic Assist'`

**Key Fields**:
- `submission_status` (text): `'draft'`, `'submitted'`, `'error'`, or `null` (not started)
- `submitted_at` (timestamptz): When submission occurred (for draft or submitted)
- `submission_metadata` (jsonb): Additional submission data
  - `submission_metadata.portal` (string): Portal name
  - `submission_metadata.savedAsDraft` (boolean): Whether saved as draft
  - `submission_metadata.drafted_at` (string): Draft timestamp (ISO)
- `pay_type` (text): Portal/insurance type (MHC, AIA, IHP, etc.)

**Status Precedence** (Flow 3):
```
error > submitted > draft > not_started
```

**Status Determination Logic**:
1. If `submission_status = 'error'` → **Error**
2. Else if `submission_status = 'submitted'` → **Processed (submitted)**
3. Else if `submission_status = 'draft'` → **Processed (draft)**
4. Else if `submission_status IS NULL` AND `pay_type` is in unsupported portals → **Not started**
5. Else if `submission_status IS NULL` → **Not started** (even for supported portals not yet processed)

**Supported Portals** (implemented):
- `MHC`, `AIA`, `AIACLIENT`

**Unsupported Portals** (show as "Not started"):
- `IHP`, `GE`, `FULLERT`, `ALLIMED`, `ALL`

**Display Rules**:
- Show aggregated counts: Draft, Submitted, Not started, Error
- Filter by status: All, Draft, Submitted, Not started, Error
- Portal badge: Green for supported, Amber for unsupported
- Status badge: Color-coded by status type

## Database Schema

### `rpa_extraction_runs`
- `run_type`: `'queue_list'` | `'visit_details'` | `'claim_submission'`
- `status`: `'running'` | `'completed'` | `'failed'`
- `started_at`: timestamptz (required)
- `finished_at`: timestamptz (nullable)
- `metadata`: jsonb (default: `{}`)

### `visits`
- `source`: text (filter: `'Clinic Assist'`)
- `pay_type`: text (nullable)
- `extraction_metadata`: jsonb (nullable)
- `submission_status`: text (nullable, constraint: `'draft'` | `'submitted'` | `'error'`)
- `submitted_at`: timestamptz (nullable)
- `submission_metadata`: jsonb (nullable)

## Notes

- All timestamps should be displayed in Singapore timezone (GMT+8)
- Status precedence ensures error states are always visible
- Unsupported portals leave `submission_status` as `null` to indicate "Not started"
- Demo mode uses mock data from localStorage with same structure
