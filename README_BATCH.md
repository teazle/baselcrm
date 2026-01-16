# Batch Extraction and Submission Workflow

This system extracts all queue items from Clinic Assist and saves them to the CRM, then submits claims to appropriate portals based on pay type.

## Overview

1. **Batch Extraction**: Extract all queue items from today → Save to CRM (Supabase)
2. **Batch Submission**: Fetch pending claims from CRM → Submit to appropriate portals based on pay type

## Setup

### Environment Variables

Add to your `.env` file:

```bash
# Supabase (for CRM storage)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# OR use anon key (less secure, but works)
SUPABASE_ANON_KEY=your-anon-key

# Batch extraction settings
BATCH_BRANCH=__FIRST__  # or specific branch name
BATCH_DEPT=Reception
BATCH_KEEP_OPEN_MS=60000  # Keep browser open after extraction (ms)

# Batch submission settings
SUBMIT_PAY_TYPE=  # Leave empty for all pay types, or specify: MHC, IHP, GE, etc.
SUBMIT_KEEP_OPEN_MS=60000  # Keep browser open after submission (ms)

# Workflow settings
WORKFLOW_SAVE_DRAFT=1  # Save as draft (safety), set to 0 to actually submit
```

### Install Dependencies

```bash
npm install
```

## Usage

### 1. Extract All Queue Items

Extract all queue items from today and save to CRM:

```bash
npm run batch-extract
```

Or with custom settings:

```bash
BATCH_BRANCH="Main Branch" BATCH_DEPT="Reception" npm run batch-extract
```

This will:
- Login to Clinic Assist
- Navigate to Queue
- Extract all queue items
- Open each visit record and extract detailed data
- Save to Supabase `visits` table (or JSON file if Supabase not configured)

### 2. Submit Pending Claims

Submit all pending claims from CRM to appropriate portals:

```bash
npm run batch-submit
```

Or for a specific pay type:

```bash
SUBMIT_PAY_TYPE=MHC npm run batch-submit
```

This will:
- Fetch pending claims from CRM (where `submitted_at` is null)
- Route each claim to appropriate portal based on `pay_type`:
  - `MHC` / `AIA` / `AIACLIENT` → MHC Asia portal
  - `IHP` → IHP portal (placeholder - not yet implemented)
  - `GE` → GE portal (placeholder - not yet implemented)
  - `FULLERT` → Fullert portal (placeholder - not yet implemented)
  - `ALLIMED` / `ALL` → Allimed portal (placeholder - not yet implemented)
- Update visit record with submission status

## Pay Type Routing

| Pay Type | Portal | Status |
|----------|--------|--------|
| MHC, AIA, AIACLIENT | MHC Asia | ✅ Implemented |
| IHP | IHP Portal | ⏳ Placeholder |
| GE | GE Portal | ⏳ Placeholder |
| FULLERT | Fullert Portal | ⏳ Placeholder |
| ALLIMED, ALL | Allimed Portal | ⏳ Placeholder |

## Database Schema

The system saves to the `visits` table with the following fields:

- `visit_date`: Date of visit
- `patient_name`: Patient name
- `nric`: Patient NRIC
- `pay_type`: Payment type (MHC, IHP, GE, etc.)
- `visit_type`: New visit or Follow-up
- `total_amount`: Total fee amount
- `diagnosis_description`: Diagnosis text
- `treatment_detail`: Services/drugs given
- `mc_required`: Boolean
- `mc_start_date`, `mc_end_date`: MC dates
- `source`: Always "Clinic Assist" for extracted data
- `submitted_at`: Timestamp when submitted (null = pending)
- `submission_status`: 'submitted', 'error', or null
- `submission_portal`: Which portal it was submitted to
- `extraction_metadata`: JSON with extraction details

## Workflow

```
┌─────────────────┐
│  Clinic Assist  │
│     Queue       │
└────────┬────────┘
         │
         │ Extract all items
         ▼
┌─────────────────┐
│   Batch Extract │
│   (Today's Queue)│
└────────┬────────┘
         │
         │ Save to CRM
         ▼
┌─────────────────┐
│   Supabase CRM  │
│   visits table  │
└────────┬────────┘
         │
         │ Fetch pending
         ▼
┌─────────────────┐
│  Batch Submit   │
│  (Route by Type) │
└────────┬────────┘
         │
         ├─→ MHC/AIA → MHC Asia Portal
         ├─→ IHP → IHP Portal (TODO)
         ├─→ GE → GE Portal (TODO)
         └─→ ... → Other Portals (TODO)
```

## Safety Features

- **Draft Mode**: By default, claims are saved as drafts (`WORKFLOW_SAVE_DRAFT=1`)
- **Error Handling**: Failed extractions/submissions are logged and don't stop the batch
- **Status Tracking**: Each visit record tracks submission status
- **Metadata**: Full extraction metadata is stored for debugging

## Troubleshooting

### Supabase Not Configured

If Supabase credentials are missing, the system falls back to saving JSON files in `./data/batch-extractions/`.

### No Queue Items Found

Check that:
- You're logged into Clinic Assist
- The queue has items for today
- Branch and Department are correct

### Submission Fails

Check that:
- Portal credentials are correct
- Patient exists in target portal
- Portal automation is implemented for that pay type

