# RPA Flow Acceptance Criteria

This document defines the acceptance criteria for each RPA flow to ensure UI and data correctness.

## Flow 1: Extract Excel from Clinic Assist

### UI Requirements
- [x] Shows extraction time from `rpa_extraction_runs.started_at` (actual extraction time)
- [x] Displays date picker for selecting extraction date
- [x] Shows extraction status badges (In progress, Completed, Failed)
- [x] Displays metrics: Total Runs, Completed, Failed, Running
- [x] Shows activity log table with columns: Extraction Time, Status, Date, Records, Finished
- [x] Manual trigger button to start queue list extraction
- [x] Success/error notifications after triggering extraction

### Data Requirements
- [x] Filters `rpa_extraction_runs` by `run_type = 'queue_list'`
- [x] Orders by `started_at` descending (most recent first)
- [x] Displays `started_at` as primary extraction time
- [x] Shows `metadata.date` if available, otherwise date portion of `started_at`
- [x] Records count shows: `completed_count / failed_count / total_records`

### Functional Requirements
- [x] Date selection triggers extraction via `/api/rpa/extract-queue-list`
- [x] Extraction runs are tracked in `rpa_extraction_runs` table
- [x] Real-time status updates (polling or refresh)
- [x] Error handling with user-friendly messages
- [x] Demo mode support with mock data

## Flow 2: Enhance Data for Contract Organizations

### UI Requirements
- [x] Shows metrics: Total Visits, Pending, Completed, Failed, With PCNO
- [x] Filter buttons: All, Pending, In Progress, Completed, Failed, MHC, Alliance, Fullerton
- [x] Displays visits table with columns: Patient, Visit Date, Pay Type, PCNO, Status, Diagnosis, Last Updated
- [x] Status badges for extraction status
- [x] Diagnosis indicator (Present/Missing)
- [x] Manual trigger buttons: "Start Extraction" and "Retry Failed Only"
- [x] Shows pending count before triggering extraction

### Data Requirements
- [x] Filters `visits` by `source = 'Clinic Assist'`
- [x] Orders by `visit_date` descending, then `updated_at` descending
- [x] Status from `extraction_metadata.detailsExtractionStatus`
- [x] Last updated from `detailsExtractedAt` or `detailsExtractionLastAttempt` or `updated_at`
- [x] PCNO from `extraction_metadata.pcno`
- [x] Diagnosis from `extraction_metadata.diagnosisCode`

### Functional Requirements
- [x] Filter by contract organization (pay_type matching)
- [x] Trigger extraction via `/api/rpa/extract-visit-details`
- [x] Support retry failed only option
- [x] Real-time status updates
- [x] Error handling with RLS policy guidance
- [x] Demo mode support

## Flow 3: Fill Claim Forms

### UI Requirements
- [x] Shows aggregated metrics: Total Claims, Processed (draft), Processed (submitted), Not started, Error
- [x] Filter buttons: All, Processed (draft), Processed (submitted), Not started, Error
- [x] Displays claims table with columns: Patient, Visit Date, Portal, Status, Submitted At, Metadata
- [x] Status badges with proper labels:
  - "Processed (draft)" for draft status
  - "Processed (submitted)" for submitted status
  - "Not started" for null status (unsupported portals)
  - "Error" for error status
- [x] Portal badges: Green for supported, Amber for unsupported
- [x] Manual trigger buttons: "Submit All Pending" and "Save All as Draft"

### Data Requirements
- [x] Filters `visits` by `source = 'Clinic Assist'`
- [x] Orders by `visit_date` descending
- [x] Status determination follows precedence: `error > submitted > draft > not_started`
- [x] Unsupported portals (`IHP`, `GE`, `FULLERT`, `ALLIMED`, `ALL`) show as "Not started"
- [x] Supported portals (`MHC`, `AIA`, `AIACLIENT`) can have any status
- [x] `submission_status` values: `'draft'`, `'submitted'`, `'error'`, or `null`
- [x] `submission_metadata` includes portal name and draft flag

### Functional Requirements
- [x] Submit claims via `/api/rpa/flow3/submit-claims`
- [x] Support batch submission (all pending) or individual visits
- [x] Support save as draft option
- [x] Proper status tracking in database
- [x] Unsupported portals leave status as `null` (not updated)
- [x] Error handling with clear messages
- [x] Real-time status updates after submission
- [x] Demo mode support with mock submission data

## Cross-Flow Requirements

### Navigation
- [x] RPA accessible at `/rpa` (not `/crm/rpa`)
- [x] RPA removed from CRM sidebar navigation
- [x] Standalone RPA layout without CRM sidebar
- [x] Redirect from `/crm/rpa` → `/rpa` (if accessed)

### Authentication
- [x] Authentication required via `RequireAuth` component
- [x] Same auth system as CRM

### Error Handling
- [x] RLS policy errors show helpful guidance
- [x] Database errors show user-friendly messages
- [x] API errors show actionable feedback

### Demo Mode
- [x] All flows work in demo mode with mock data
- [x] Mock data includes all required fields
- [x] Demo data structure matches production schema

### Performance
- [x] Efficient queries with proper indexes
- [x] Pagination/limits on large datasets (200 rows max)
- [x] Real-time updates don't block UI

## Testing Checklist

- [x] RPA accessible at `/rpa`
- [x] RPA removed from CRM sidebar
- [x] All 3 flows visible and functional
- [x] API routes work correctly
- [x] Authentication still required
- [x] No broken links or references
- [x] Flow 1 shows actual extraction time
- [x] Flow 2 filters by contract organization
- [x] Flow 3 shows Draft vs Submitted vs Not Started
- [x] Unsupported portals show as "Not started"
- [x] Demo mode works for all flows
- [x] Error states display correctly
- [x] Status precedence works correctly
