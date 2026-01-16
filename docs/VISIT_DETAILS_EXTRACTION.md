# Visit Details Extraction Guide

This guide explains how to use the visit details extraction automation to extract diagnosis and services/drugs from Clinic Assist visit records and store them in the CRM.

## Overview

The visit details extraction system extracts additional information (diagnosis and services/drugs) from Clinic Assist visit records for patients already in the database. This automation:

- Processes visits that are missing diagnosis information
- Navigates to each patient's visit record in Clinic Assist
- Extracts diagnosis and services/drugs using the existing `extractClaimDetailsFromCurrentVisit()` method
- Stores the extracted data in the database
- Tracks progress and supports resume capability
- Handles errors gracefully and continues processing

## Prerequisites

- Node.js installed and configured
- Environment variables set in `.env` file:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (required for server-side automation)
  - Clinic Assist credentials (username, password, etc.)
  - Optional: `VISIT_DETAILS_MAX_RETRIES` (default: 3)
  - Optional: `VISIT_DETAILS_BATCH_SIZE` (default: 100)
- Browser dependencies installed: `npm run install-browsers`
- Visits must already exist in the database (from queue list extraction)

## Usage

### Basic Usage

Extract details for all visits missing diagnosis:

```bash
npm run extract-visit-details
```

Or directly:

```bash
node src/examples/extract-visit-details-batch.js
```

### Retry Failed Visits

Retry visits that previously failed:

```bash
npm run extract-visit-details -- --retry-failed
```

## Features

### Incremental Processing

- Only processes visits where `diagnosis_description IS NULL`
- Automatically skips visits that already have diagnosis information
- Efficient querying to find visits that need processing

### Resume Capability

- Tracks extraction status in `extraction_metadata` JSONB field
- Can resume interrupted runs by querying for pending/failed visits
- Status values:
  - `pending`: Not yet processed
  - `in_progress`: Currently being processed (may indicate interrupted run)
  - `completed`: Successfully extracted
  - `failed`: Extraction failed (can be retried)

### Progress Tracking

The system tracks detailed progress in the database:

```json
{
  "detailsExtractionStatus": "completed",
  "detailsExtractedAt": "2026-01-12T10:30:00Z",
  "detailsExtractionError": null,
  "detailsExtractionAttempts": 1,
  "detailsExtractionLastAttempt": "2026-01-12T10:30:00Z",
  "detailsExtractionSources": {
    "diagnosis": "visit_notes",
    "items": "dispense_payment_table"
  }
}
```

### Error Handling

- Continues processing if one visit fails (doesn't stop entire batch)
- Logs errors with context (patient name, visit date, error message)
- Tracks failed visits with error details in `extraction_metadata`
- Supports retry logic with configurable max retries

### Browser Session Reuse

- Logs in once to Clinic Assist
- Processes all visits in sequence (much faster than individual logins)
- Reuses the same browser session for all visits

## Configuration

### Environment Variables

Optional environment variables (with defaults):

- `VISIT_DETAILS_MAX_RETRIES`: Maximum retry attempts for failed visits (default: `3`)
- `VISIT_DETAILS_BATCH_SIZE`: Number of visits to process in one batch (default: `100`)

### Navigation Configuration

- **Branch**: Always uses `'__FIRST__'` (auto-selects the only branch "ssoc pte ltd")
- **Department**: Always uses `'Reception'`

No configuration needed for branch/dept - these are hardcoded as there's only one branch and we always use Reception department.

## How It Works

### Extraction Process

1. **Query Database**: Finds visits missing diagnosis (`diagnosis_description IS NULL`)
2. **Filter by Status**: For resume capability, filters out completed visits and handles failed visits based on retry count
3. **Login**: Logs into Clinic Assist once (browser session reuse)
4. **For Each Visit**:
   - Navigate to Queue page (Branch: `__FIRST__`, Dept: `Reception`)
   - Find and open the patient's visit record
   - Extract diagnosis and services/drugs using `extractClaimDetailsFromCurrentVisit()`
   - Update database with extracted data
   - Update progress status in `extraction_metadata`
5. **Continue on Errors**: If one visit fails, continues with the next visit
6. **Summary Report**: Shows statistics at the end

### Database Updates

The system updates the following fields in the `visits` table:

- `diagnosis_description` (text): Diagnosis text extracted from visit record
- `treatment_detail` (text): Services/drugs as newline-separated string
- `extraction_metadata` (JSONB): Progress tracking and extraction metadata

The `extraction_metadata` field uses JavaScript object merging to preserve existing metadata while updating progress tracking fields.

## Example Output

```
=== Visit Details Extraction Batch ===
Querying database for visits missing diagnosis...
Found 50 visits missing diagnosis
Processing 50 visits (0 skipped)

Initializing browser and logging in to Clinic Assist...

Starting batch extraction for 50 visits...
Max retries: 3, Batch size: 100

[VisitDetails] Processing visit 1/50: John Doe (2026-01-10)
[VisitDetails] Navigating to Queue for visit abc-123 (John Doe)
[VisitDetails] Opening visit record for patient: John Doe
[VisitDetails] Extracting claim details for visit abc-123
[VisitDetails] Successfully extracted details for visit abc-123
...

=== Extraction Summary ===
Total visits processed: 50
✅ Completed: 48
❌ Failed: 2
⏭️  Skipped: 0
Success rate: 96.0%
Time elapsed: 245.3s
Average time per visit: 5.1s

Failed visits (2):
  - Visit xyz-456: Jane Smith (2026-01-11) - Patient not found in queue
  - Visit def-789: Bob Johnson (2026-01-12) - Timeout waiting for visit record
```

## Resume Capability

The system automatically supports resume capability:

1. **Status Tracking**: Each visit has extraction status stored in `extraction_metadata.detailsExtractionStatus`
2. **Resume Logic**: When you run the script again, it automatically:
   - Skips visits with status `'completed'`
   - Retries visits with status `'failed'` (if attempts < maxRetries)
   - Treats visits with status `'in_progress'` as pending (for interrupted runs)
3. **Interruption Handling**: If the script stops (e.g., Ctrl+C, crash), visits marked `'in_progress'` will be treated as pending on the next run
4. **Retry Logic**: Failed visits can be retried up to `maxRetries` times (default: 3)

### Manual Retry

To manually retry failed visits:

```bash
npm run extract-visit-details -- --retry-failed
```

This will only process visits with status `'failed'`, regardless of retry count.

## Troubleshooting

### No Visits Found

If the script reports "No visits found that need diagnosis extraction":

- Check that visits exist in the database with `source = 'Clinic Assist'`
- Check that visits are missing diagnosis (`diagnosis_description IS NULL`)
- Verify that `patient_name IS NOT NULL` (required for navigation)

### Patient Not Found in Queue

If you see errors like "Patient not found in queue":

- The Queue page typically shows only current day's patients
- For historical visits, the patient may not be in the current day's queue
- **This is expected with the current implementation** - the navigation strategy needs to be updated to use Patient Page → TX History → Diagnosis Tab (see "Navigation Strategy" above)

### Browser Timeouts

If you see timeout errors:

- Check your internet connection
- Verify Clinic Assist credentials are correct
- Try reducing `VISIT_DETAILS_BATCH_SIZE` to process fewer visits at once

### Database Errors

If you see database errors:

- Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Check that the `visits` table exists and has the required columns
- Ensure the `extraction_metadata` column is JSONB type

## Navigation Strategy (Future Implementation)

The current implementation uses the Queue page approach, which has limitations for historical visits. The correct approach should be:

1. **Navigate to Patient Page**: Go to the patient search/page in Clinic Assist
2. **Search for Patient**: Search by patient name (or use patient number from visit record)
3. **Navigate to TX History**: Open the patient's Treatment History (TX History)
4. **Open Diagnosis Tab**: Within TX History, navigate to the Diagnosis tab
5. **Extract Diagnosis**: Extract the diagnosis for the specific visit
6. **Handle Missing Diagnosis**: If diagnosis is empty/missing:
   - Mark as "Missing diagnosis" (or similar placeholder), OR
   - Put a general diagnosis placeholder (to be edited by admin during review)

**Flow**: `Patient Page → Search Patient → TX History → Diagnosis Tab → Extract Diagnosis`

This approach will work for both current and historical visits, as it accesses the patient's treatment history directly rather than relying on the Queue page.

## Known Limitations

1. **Current Implementation Limitation**: The current implementation uses the Queue page approach, which only shows current day's patients. For historical visits (past dates), patients won't be in the queue, causing extraction failures. **This needs to be updated to use the TX History approach described above.**

2. **Sequential Processing**: Visits are processed one at a time (not in parallel) to avoid overwhelming the Clinic Assist system.

3. **Browser Session**: Requires an active browser session - cannot run headless in all cases (depends on Clinic Assist's detection mechanisms).

## Best Practices

1. **Navigation Strategy**: Once the TX History approach is implemented, this will work for both current and historical visits
2. **Monitor Failed Visits**: Check failed visits and retry them if needed
3. **Batch Size**: Use appropriate batch size (default 100) - smaller batches are safer for browser automation
4. **Resume**: Don't worry about interruptions - the system supports resume capability
5. **Error Review**: Review failed visits to identify patterns (e.g., specific patients, dates, or error types)
6. **Missing Diagnosis Handling**: When diagnosis cannot be found, mark as "Missing diagnosis" or use a general placeholder - admin will review and edit

## Integration with Other Automations

This automation is designed to work after the queue list extraction:

1. **Queue List Extraction** (`extract-date-range`, `extract-daily`): Extracts basic visit data (patient name, visit date, fees, etc.)
2. **Visit Details Extraction** (`extract-visit-details`): Extracts additional details (diagnosis, services/drugs) for visits missing this information

You can run them sequentially:

```bash
# Step 1: Extract queue list data
npm run extract-daily

# Step 2: Extract visit details
npm run extract-visit-details
```

Or set up cron jobs to run them in sequence.

## Technical Details

### Class Structure

- **`VisitDetailsExtractor`** (`src/core/visit-details-extractor.js`): Core extraction class
  - `extractForVisit(visit)`: Extract details for a single visit
  - `extractBatch(visits, options)`: Extract details for multiple visits

- **Batch Script** (`src/examples/extract-visit-details-batch.js`): Main automation script
  - Queries database for visits missing diagnosis
  - Initializes browser and logs in
  - Processes visits in batch
  - Provides progress logging and summary

### Database Schema

The system uses the following fields in the `visits` table:

- `id` (uuid): Primary key
- `patient_name` (text): Patient name (required for navigation)
- `diagnosis_description` (text): Diagnosis text (updated by extraction)
- `treatment_detail` (text): Services/drugs (updated by extraction)
- `extraction_metadata` (jsonb): Progress tracking and extraction metadata

### Progress Tracking Schema

The `extraction_metadata` JSONB field stores:

```json
{
  "detailsExtractionStatus": "pending" | "in_progress" | "completed" | "failed",
  "detailsExtractedAt": "2026-01-12T10:30:00Z",
  "detailsExtractionError": "Error message if failed",
  "detailsExtractionAttempts": 1,
  "detailsExtractionLastAttempt": "2026-01-12T10:30:00Z",
  "detailsExtractionSources": {
    "diagnosis": "visit_notes" | "dispense_payment_case_notes",
    "items": "dispense_payment_table"
  }
}
```

## Future Enhancements

Potential future improvements:

1. **Implement TX History Navigation**: Update navigation to use Patient Page → TX History → Diagnosis Tab approach (see "Navigation Strategy" section)
2. **Handle Missing Diagnosis**: Implement logic to mark empty diagnosis as "Missing diagnosis" or use general placeholder
3. Scheduled automation (daily after queue list extraction)
4. Reset stuck 'in_progress' visits (timeout-based)
5. Detailed progress report generation (CSV/JSON export)
6. Parallel processing (with rate limiting)
