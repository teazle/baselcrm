---
name: RPA Automation Dashboard Page
overview: Create a comprehensive RPA automation dashboard page at `/crm/rpa` that displays automation metrics, extraction status, activity logs, manual trigger buttons, and real-time monitoring. Use `visits.extraction_metadata` as the source of truth and a required `rpa_extraction_runs` table for run-level activity tracking.
todos:
  - id: create_rpa_page
    content: Create main RPA page at apps/crm/src/app/(crm)/crm/rpa/page.tsx with PageHeader and layout structure
    status: pending
  - id: add_navigation_link
    content: Add RPA link to navigation menu in apps/crm/src/components/layout/nav.ts (after Reports, before Settings)
    status: pending
  - id: add_extraction_runs_table
    content: Add `rpa_extraction_runs` table with indexes and RLS policy (admin read)
    status: pending
  - id: add_extraction_runs_logging
    content: Add run logging in `src/core/batch-extraction.js` and `src/core/visit-details-extractor.js`
    status: pending
  - id: create_status_badge
    content: Create reusable StatusBadge component for displaying extraction status (completed, failed, pending, in_progress) using shadcn Badge variants
    status: pending
  - id: create_dashboard_metrics
    content: Create RpaDashboard.tsx component with 6 metric cards (total visits, success rate, PCNO coverage, pending, failed, today's extractions) using visits table queries
    status: pending
    dependencies:
      - create_rpa_page
      - add_extraction_runs_table
  - id: create_visits_status_table
    content: Create VisitsStatusTable.tsx component with filtered DataTable showing visits by extraction status. Include tabs for All/Pending/Completed/Failed and columns for patient, date, PCNO, status badge, diagnosis presence, diagnosis code
    status: pending
    dependencies:
      - create_status_badge
  - id: create_activity_log
    content: Create ExtractionActivityLog.tsx component showing recent extraction runs from `rpa_extraction_runs` (start/end, type, status, counts)
    status: pending
    dependencies:
      - create_status_badge
      - add_extraction_runs_table
  - id: create_manual_triggers
    content: Create ManualTriggers.tsx component with action buttons for queue list and visit details extraction. Include date picker for queue list. Show placeholder/instructions initially (API integration later)
    status: pending
    dependencies:
      - create_rpa_page
  - id: create_real_time_status
    content: Create RealTimeStatus.tsx component showing active runs and recent activity feed with polling from `rpa_extraction_runs`
    status: pending
    dependencies:
      - add_extraction_runs_table
  - id: create_statistics_charts
    content: Create StatisticsCharts.tsx component with extraction trends and success rate charts from `rpa_extraction_runs`
    status: pending
    dependencies:
      - add_extraction_runs_table
  - id: integrate_components
    content: Integrate all components into main RPA page with proper layout, data fetching using sbList/supabaseBrowser pattern, loading/error states, and responsive grid layout
    status: pending
    dependencies:
      - add_extraction_runs_logging
      - create_dashboard_metrics
      - create_visits_status_table
      - create_activity_log
      - create_manual_triggers
      - create_real_time_status
      - create_statistics_charts
---

# RPA Automation Dashboard Frontend Plan

## Overview

Build a comprehensive RPA automation monitoring and control dashboard page at `/crm/rpa` using Next.js App Router, React, and Tailwind CSS. The page will display automation metrics, extraction status, activity logs, manual trigger capabilities, and real-time monitoring.

## Authoritative Data Model (Decision)

- **Source of truth for extraction status + timestamps**: `visits.extraction_metadata`
  - `detailsExtractionStatus`: `in_progress` | `completed` | `failed` | `null` (pending)
  - `detailsExtractedAt`: timestamp when details extraction completes
  - `detailsExtractionLastAttempt`: timestamp for last attempt
  - `detailsExtractionAttempts`: integer retry count
  - `detailsExtractionError`: last error message (if failed)
  - `pcno`, `diagnosisCode`: stored in `extraction_metadata`
- **Diagnosis text**: `visits.diagnosis_description` (may be "Missing diagnosis" even when completed)
- **Queue list ingestion time**: `extraction_metadata.extractedAt`

**Status definitions used across metrics + tables:**

- `pending`: `detailsExtractionStatus IS NULL`
- `in_progress`: `detailsExtractionStatus = 'in_progress'`
- `failed`: `detailsExtractionStatus = 'failed'`
- `completed`: `detailsExtractionStatus = 'completed'`

**Scope all automation metrics/tables to**: `source = 'Clinic Assist'`

## File Structure

```
apps/crm/src/app/(crm)/crm/rpa/
├── page.tsx                    # Main RPA dashboard page
├── ui/
│   ├── RpaDashboard.tsx        # Main dashboard component with metrics cards
│   ├── ExtractionActivityLog.tsx  # Activity log table component
│   ├── VisitsStatusTable.tsx   # Visits by extraction status table
│   ├── ManualTriggers.tsx      # Manual extraction trigger buttons
│   ├── RealTimeStatus.tsx      # Real-time extraction monitoring
│   └── StatisticsCharts.tsx    # Statistics and charts component
```

## Components to Create

### 1. Main Page (`apps/crm/src/app/(crm)/crm/rpa/page.tsx`)

- Use `PageHeader` component with title "RPA Automation" and subtitle
- Layout similar to other CRM pages (follow `apps/crm/src/app/(crm)/crm/visits/page.tsx` pattern)
- Sections: Dashboard metrics, Activity log, Real-time status, Manual triggers, Statistics

### 2. Dashboard Metrics (`ui/RpaDashboard.tsx`)

**Metric Cards** (using existing Card component pattern from `apps/crm/src/app/(crm)/crm/page.tsx`):

- **Total Visits**: Count from `visits` where `source = 'Clinic Assist'`
- **Details Extraction Success Rate**: `completed / (completed + failed)` using `detailsExtractionStatus` (exclude `pending` and `in_progress`; if denominator is 0, show `--` or `0%`)
- **PCNO Coverage**: Percentage with `extraction_metadata->>'pcno'` present (optionally validate 4-5 digits)
- **Pending Details**: `detailsExtractionStatus IS NULL`
- **Failed Details**: `detailsExtractionStatus = 'failed'`
- **Today's Details Extractions**: `detailsExtractedAt::date = CURRENT_DATE` (optional: show queue list ingestions via `extractedAt`)

Each metric card follows the pattern:

```tsx
<div className="rounded-2xl border border-border bg-card p-5">
  <div className="text-xs text-muted-foreground">{label}</div>
  <div className="mt-2 text-2xl font-semibold">{value}</div>
</div>
```

### 3. Activity Log (`ui/ExtractionActivityLog.tsx`)

**DataTable** component showing recent extraction activities:

- **Columns**:
  - Start/End time (run started/finished)
  - Type (Queue List / Visit Details)
  - Status (Badge: completed, failed, in_progress, pending)
  - Records Processed (total)
  - Success/Failed counts
  - Actions (View details, Retry)

- **Status Badges**: Use Badge component with variants:
  - `completed`: Green/secondary variant
  - `failed`: Destructive variant
  - `in_progress`: Outline variant with Spinner
  - `pending`: Outline variant

- **Data Source**: `rpa_extraction_runs` table (one row per run) for accurate activity history

### 4. Visits Status Table (`ui/VisitsStatusTable.tsx`)

**Tabbed or Filtered DataTable** showing visits by extraction status:

- **Tabs/Filters**:
  - All
  - Pending (`detailsExtractionStatus IS NULL`)
  - In Progress (`detailsExtractionStatus = 'in_progress'`)
  - Completed (`detailsExtractionStatus = 'completed'`)
  - Failed (`detailsExtractionStatus = 'failed'`)
  - With PCNO / Without PCNO

- **Columns**:
  - Patient Name
  - Visit Date
  - PCNO (from `extraction_metadata->>'pcno'`)
  - Status Badge (from `detailsExtractionStatus`, map null -> pending)
  - Diagnosis (badge: "Present" vs "Missing"; treat `null` or "Missing diagnosis" as missing)
  - Diagnosis Code (from `extraction_metadata->>'diagnosisCode'`)
  - Last Updated

- Use existing `DataTable` component from `apps/crm/src/components/ui/DataTable.tsx`
- Keep the initial fetch small (limit 50-200) and optionally filter to last 30-60 days

### 5. Manual Triggers (`ui/ManualTriggers.tsx`)

**Action Buttons** to manually trigger extractions:

- **Extract Queue List**: Button to trigger queue list extraction for a date range
  - Date picker/input for target date
  - Triggers API endpoint or shows instructions

- **Extract Visit Details**: Button to trigger visit details extraction
  - Shows pending count
  - Start/Stop extraction controls

- **Status Indicators**: Show if extraction is currently running (Spinner + Badge)

- Use Button component with variants (primary for actions, outline for secondary)
- When API is implemented, create/update `rpa_extraction_runs` rows for each trigger

### 6. Real-Time Status (`ui/RealTimeStatus.tsx`)

**Status Monitor** for active extractions:

- Show runs with `status = 'running'` and basic progress numbers
- Poll `rpa_extraction_runs` every 30-60 seconds
- Query: `SELECT * FROM rpa_extraction_runs WHERE status = 'running' ORDER BY started_at DESC`

### 7. Statistics Charts (`ui/StatisticsCharts.tsx`)

**Visual Statistics** using shadcn/ui Chart components:

- Extraction trends (records over time)
- Success rate over time
- Status distribution

## Data Queries (Supabase)

### Metrics Queries

1. **Total Visits**: `SELECT COUNT(*) FROM visits WHERE source = 'Clinic Assist'`
2. **Success Rate**: `completed / (completed + failed)` using `detailsExtractionStatus` with `source = 'Clinic Assist'`
3. **PCNO Coverage**: `extraction_metadata->>'pcno' IS NOT NULL AND <> '' AND source = 'Clinic Assist'` (optionally enforce 4-5 digits)
4. **Pending Details**: `extraction_metadata->>'detailsExtractionStatus' IS NULL AND source = 'Clinic Assist'`
5. **Failed Details**: `extraction_metadata->>'detailsExtractionStatus' = 'failed' AND source = 'Clinic Assist'`
6. **Today's Details Extractions**: `(extraction_metadata->>'detailsExtractedAt')::date = CURRENT_DATE AND source = 'Clinic Assist'`

### Activity Log Query (`rpa_extraction_runs`)

```sql
SELECT
  id,
  run_type,
  status,
  started_at,
  finished_at,
  total_records,
  completed_count,
  failed_count,
  error_message
FROM rpa_extraction_runs
ORDER BY started_at DESC
LIMIT 30
```

### Charts Queries (`rpa_extraction_runs`)

**Runs per day (last 30 days)**

```sql
select
  date_trunc('day', started_at) as day,
  sum(total_records) as total_records,
  sum(completed_count) as completed_count,
  sum(failed_count) as failed_count
from rpa_extraction_runs
where started_at >= now() - interval '30 days'
group by date_trunc('day', started_at)
order by day desc;
```

**Status distribution (last 30 days)**

```sql
select
  status,
  count(*) as run_count
from rpa_extraction_runs
where started_at >= now() - interval '30 days'
group by status
order by run_count desc;
```

### Visits Status Query

```sql
SELECT 
  id,
  patient_name,
  visit_date,
  diagnosis_description,
  extraction_metadata->>'pcno' as pcno,
  extraction_metadata->>'detailsExtractionStatus' as status,
  extraction_metadata->>'diagnosisCode' as diagnosis_code,
  extraction_metadata->>'detailsExtractedAt' as details_extracted_at,
  extraction_metadata->>'detailsExtractionLastAttempt' as last_attempt,
  COALESCE(
    extraction_metadata->>'detailsExtractedAt',
    extraction_metadata->>'detailsExtractionLastAttempt',
    updated_at::text
  ) as last_updated
FROM visits
WHERE source = 'Clinic Assist'
ORDER BY visit_date DESC, updated_at DESC
LIMIT 200
```

## Backend Table (Required)

Create `rpa_extraction_runs` table for run-level tracking with start/finish times, exact counts, and error messages. This enables real-time status monitoring and accurate activity logs.

**Create table (SQL)**

```sql
create table if not exists public.rpa_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_records int not null default 0,
  completed_count int not null default 0,
  failed_count int not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists rpa_runs_started_at_idx on public.rpa_extraction_runs (started_at desc);
create index if not exists rpa_runs_status_idx on public.rpa_extraction_runs (status);
create index if not exists rpa_runs_type_started_idx on public.rpa_extraction_runs (run_type, started_at desc);
```

**Logging hook locations**

- Queue list extraction: add run start/end updates in `src/core/batch-extraction.js`
- Visit details extraction: add run start/end updates in `src/core/visit-details-extractor.js`
- Use `run_type = 'queue_list'` for queue extraction and `run_type = 'visit_details'` for details extraction
- Insert a run row on start (`status = 'running'`, `run_type`, `started_at`, `metadata`)
- Update counts during/after run (`total_records`, `completed_count`, `failed_count`)
- On finish, set `status = 'completed'` or `failed`, set `finished_at`, and `error_message` if any

**RLS note**

- If RLS is enabled, add a policy to allow admin users to read `rpa_extraction_runs`.

## Navigation Update

Add RPA link to `apps/crm/src/components/layout/nav.ts`:

```typescript
{ href: "/crm/rpa", label: "RPA Automation" },
```

Place after "Reports" and before "Settings".

## UI Components Needed

### From shadcn/ui (may need to add):

1. **Badge**: Status indicators (completed, failed, pending, in_progress)
2. **Alert**: Error/warning messages
3. **Progress**: Progress bars for active extractions
4. **Spinner**: Loading indicators
5. **Button**: Already available, use for manual triggers
6. **Card**: Already available in `apps/crm/src/components/ui/Card.tsx`

### Custom Components:

1. **StatusBadge**: Wrapper for Badge with status-specific variants
2. **MetricCard**: Reusable metric card component
3. **ActivityRow**: Activity log row component with status badge

StatusBadge mapping:

- `completed`: `secondary` or green class
- `failed`: `destructive`
- `in_progress`: `outline` + spinner
- `pending`: `outline`

## Styling

- Follow existing CRM design patterns (rounded-2xl, border-border, bg-card)
- Use consistent spacing (gap-4, gap-6, p-5, p-6)
- Match typography (text-xs, text-sm, text-2xl for metrics)
- Use Tailwind CSS classes matching existing pages

## Real-Time Updates

- Polling: Use `useEffect` with `setInterval` to refresh run data every 30-60 seconds
- Loading states: Show loading spinners while fetching data

## Implementation Order

1. Create `rpa_extraction_runs` table
2. Add run logging hooks in `src/core/batch-extraction.js` and `src/core/visit-details-extractor.js`
3. Create page structure and layout (`page.tsx`)
4. Add navigation link to `nav.ts`
5. Create StatusBadge component (reusable)
6. Build dashboard metrics cards (6 key metrics from visits table)
7. Build visits status table with tabs/filters
8. Build activity log (from `rpa_extraction_runs`)
9. Build real-time status panel (polling `rpa_extraction_runs`)
10. Build statistics charts (from `rpa_extraction_runs`)
11. Add manual trigger buttons (UI only, show placeholder/instructions)
12. Integrate all components with proper data fetching and error handling

## API Integration (Future)

Manual triggers will need API endpoints:

- `POST /api/rpa/extract-queue-list` - Trigger queue list extraction
- `POST /api/rpa/extract-visit-details` - Trigger visit details extraction
- `GET /api/rpa/status` - Get current extraction status

Endpoints should create/update `rpa_extraction_runs` rows so the dashboard shows accurate activity in real time.

For now, buttons can show UI with placeholder functionality or link to documentation.

## Data Fetching Pattern

Use the existing browser client helpers (same pattern as `VisitsTable`):

```tsx
import { supabaseBrowser } from '@/lib/supabase/browser'

const supabase = supabaseBrowser()
const { data, error } = await supabase
  .from('visits')
  .select('...')
```

- For simple lists, prefer `sbList` in `apps/crm/src/lib/supabase/table.ts`
- For aggregates/filters, use `supabaseBrowser()` directly with JSON-path filters (e.g. `eq('extraction_metadata->>detailsExtractionStatus', 'completed')`)
- Handle the case where `supabaseBrowser()` returns null (show a short "Supabase not configured" state)

## Validation Checklist

- Metrics counts match SQL results for a known day/run
- Activity log shows latest `rpa_extraction_runs` rows and updates when a run completes
- Real-time status shows running runs and progress numbers update on polling
- Visits table filters match `detailsExtractionStatus` values (including null as pending)
- Manual trigger buttons render and show placeholder or API response state