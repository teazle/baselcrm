# PCNO-Based Visit Details Extraction Guide

## Overview

This automation process is called **"Visit Details Extraction"** or **"Diagnosis Extraction"**. It extracts diagnosis information, diagnosis codes, and NRIC from Clinic Assist visit records using **PCNO (Patient Number)** for more accurate patient identification.

## Process Name

**"Visit Details Extraction"** / **"Diagnosis Extraction"** / **"PCNO-Based Patient Search Extraction"**

## How to Start

### Quick Start

```bash
# Extract visit details (diagnosis, codes, NRIC) for all visits missing diagnosis
npm run extract-visit-details
```

Or directly:

```bash
node src/examples/extract-visit-details-batch.js
```

### Complete Workflow (2 Steps)

#### Step 1: Extract Queue List (Gets PCNO from Excel)

This extracts the basic visit data **including PCNO** from Clinic Assist Reports:

```bash
# Extract for a date range
npm run extract-date-range 2026-01-14 2026-01-14

# Or extract daily (yesterday's data)
npm run extract-daily
```

#### Step 2: Extract Visit Details (Uses PCNO for Search)

This extracts diagnosis, diagnosis codes, and NRIC using PCNO-based search:

```bash
npm run extract-visit-details
```

### Testing with Specific Date

To test extraction for a specific date:

```bash
npm run test-visit-details-date 2026-01-14 5
```

This will:
- Extract visit details for 5 visits from January 14, 2026
- Use PCNO-based search when available
- Show the process in console logs

## Available Scripts

### Main Automation Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| **Queue List Extraction** | `npm run extract-date-range [start] [end]` | Extract visit data from Clinic Assist Reports (includes PCNO) |
| **Daily Queue List** | `npm run extract-daily` | Extract yesterday's visits automatically |
| **Visit Details Extraction** | `npm run extract-visit-details` | Extract diagnosis/details using PCNO-based search |
| **Test Specific Date** | `npm run test-visit-details-date [date] [limit]` | Test visit details extraction for a date |

### Demo Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| **Demo Visit Details** | `npm run demo-visit-details` | Run extraction with visible browser (for debugging) |

## Complete Example

### Extract All Data for a Date

```bash
# Step 1: Extract queue list (gets PCNO from Excel)
npm run extract-date-range 2026-01-14 2026-01-14

# Step 2: Extract visit details using PCNO
npm run extract-visit-details
```

## What It Does

1. **Queries Database**: Finds visits missing diagnosis information
2. **Uses PCNO**: When available, searches for patients by PCNO (more accurate than name)
3. **Falls Back to Name**: If PCNO not available, uses patient name search
4. **Extracts Data**:
   - Diagnosis description
   - Diagnosis code (ICD-10 format, e.g., S83.6)
   - NRIC (from patient biodata page)
5. **Saves to CRM**: Updates the visit record in Supabase database

## PCNO-Based Search Flow

The automation uses this flow when PCNO is available:

```
1. Navigate to Patient Page
2. Search by PCNO (e.g., 76780)
3. Open patient record from search results
4. Extract NRIC from biodata page
5. Navigate to TX History → Diagnosis Tab
6. Extract diagnosis code and description
7. Save to database
```

## Daily Automation Setup

To run automatically every day:

### Option 1: Cron Job (Recommended)

```bash
# Edit crontab
crontab -e

# Add this line (runs at 2 AM daily):
0 2 * * * cd /path/to/Baselrpacrm && /usr/local/bin/node src/examples/extract-daily.js && /usr/local/bin/node src/examples/extract-visit-details-batch.js >> logs/daily-extraction.log 2>&1
```

This will:
1. Extract yesterday's queue list at 2 AM
2. Then extract visit details for all visits missing diagnosis

### Option 2: Manual Schedule

Run these commands daily:

```bash
# Morning: Extract yesterday's queue list
npm run extract-daily

# Then: Extract visit details
npm run extract-visit-details
```

## Monitoring

### Check Extraction Status

Query the database to see which visits have been processed:

```sql
SELECT 
  visit_date,
  COUNT(*) as total,
  COUNT(diagnosis_description) as with_diagnosis,
  COUNT(extraction_metadata->>'diagnosisCode') as with_code,
  COUNT(nric) as with_nric
FROM visits 
WHERE source = 'Clinic Assist'
  AND visit_date = '2026-01-14'
GROUP BY visit_date;
```

### Check PCNO Usage

```sql
SELECT 
  patient_name,
  extraction_metadata->>'pcno' as pcno,
  diagnosis_description,
  extraction_metadata->>'diagnosisCode' as diagnosis_code
FROM visits 
WHERE source = 'Clinic Assist'
  AND extraction_metadata->>'pcno' IS NOT NULL
  AND extraction_metadata->>'detailsExtractionStatus' = 'completed'
ORDER BY extraction_metadata->>'detailsExtractedAt' DESC
LIMIT 10;
```

## Environment Variables

Required in `.env`:

```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Clinic Assist
CLINIC_ASSIST_URL=https://clinicassist.sg:1080
CLINIC_ASSIST_USERNAME=your_username
CLINIC_ASSIST_PASSWORD=your_password

# Optional
VISIT_DETAILS_MAX_RETRIES=3
VISIT_DETAILS_BATCH_SIZE=100
```

## Key Features

✅ **PCNO-Based Search**: More accurate than name-based search  
✅ **Automatic Fallback**: Uses name search if PCNO not available  
✅ **Resume Capability**: Can resume interrupted runs  
✅ **Progress Tracking**: Tracks status in database  
✅ **Error Handling**: Continues processing even if some visits fail  
✅ **Batch Processing**: Processes multiple visits in one run  

## Troubleshooting

### "No visits found that need diagnosis extraction"

- Check that queue list extraction ran first (Step 1)
- Verify visits exist in database: `SELECT COUNT(*) FROM visits WHERE source = 'Clinic Assist';`

### PCNO not being used

- Check that queue list extraction included PCNO: `SELECT extraction_metadata->>'pcno' FROM visits LIMIT 5;`
- PCNO must be 4-5 digits to be used for search

### Search failing

- Check Clinic Assist credentials in `.env`
- Verify browser is working: `npm run install-browsers`
- Check network connectivity to Clinic Assist

## Success Indicators

When running, you should see:

```
[VisitDetails] Searching for patient by number: 76780 (PATIENT NAME)
[CA] Found patient row by number
[CA] Patient opened from search results by number
[VisitDetails] Successfully extracted details
```

This confirms PCNO-based search is working! 🎉
