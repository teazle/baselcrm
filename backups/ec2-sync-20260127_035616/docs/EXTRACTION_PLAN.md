# Data Extraction Plan for MHC Form Filling

## Overview

Plan to extract Diagnosis and Services/Drugs from Clinic Assist visit records for each patient in our queue list, so we can fill MHC portal forms automatically.

## What We Know

### Card Number
- **Purpose**: Insurance card/policy number used in MHC portal dropdown
- **Status**: Optional - we can select patient by name only (cardNumber can be null)
- **Recommendation**: Leave as null initially, can extract later if needed

### MC Days
- **Status**: Always set to 0 (user requirement)
- **Action**: No extraction needed, just hardcode to 0

### Diagnosis & Services/Drugs
- **Status**: Already have extraction logic in `extractClaimDetailsFromCurrentVisit()`
- **Location in Clinic Assist**:
  - **Diagnosis**: Found in "Visit Notes" section OR "Dispense/Payment" → "Case Notes"
  - **Services/Drugs**: Found in "Dispense/Payment" → Table with drugs/medications

## Current Extraction Code

The `extractClaimDetailsFromCurrentVisit()` method already:
1. Extracts diagnosis from visit notes (or falls back to dispense/payment case notes)
2. Extracts services/drugs from dispense/payment table
3. Validates the extracted data
4. Returns structured data

## How to Extract for Each Patient

### Correct Approach: Use Patient Page → TX History → Diagnosis Tab

For each patient from queue list:
1. Navigate to Patient Page in Clinic Assist
2. Search for patient by name (or use patient number from visit record)
3. Navigate to TX History (Treatment History)
4. Open the Diagnosis Tab within TX History
5. Extract diagnosis for the specific visit
6. If diagnosis is empty/missing:
   - Mark as "Missing diagnosis" (or similar placeholder), OR
   - Put a general diagnosis placeholder (to be edited by admin during review)
7. Store diagnosis and services/drugs in database

**Flow**: `Patient Page → Search Patient → TX History → Diagnosis Tab → Extract Diagnosis`

This approach works for both current and historical visits, as it accesses the patient's treatment history directly rather than relying on the Queue page.

### Previous Approaches (Not Recommended)

**Approach 1: Queue Page (Current Implementation - Has Limitations)**
- Queue page only shows current day's patients
- Historical visits won't be in the queue
- Causes extraction failures for past dates

**Approach 2: Direct Visit Record Navigation**
- Would require visit record number navigation (if available)
- May not work for all visit types

## Implementation Steps

### Step 1: Create Extraction Function

**File**: `src/core/visit-details-extractor.js` (new)

```javascript
/**
 * Extract detailed visit information from Clinic Assist
 * Opens visit record and extracts diagnosis, services/drugs
 */
async function extractVisitDetailsFromClinicAssist(visitRecordNo, patientName, visitDate) {
  // 1. Navigate to visit record (need to implement navigation by visit_record_no)
  // 2. Open visit record
  // 3. Call clinicAssist.extractClaimDetailsFromCurrentVisit()
  // 4. Return { diagnosis, services, drugs }
}
```

### Step 2: Navigation Methods Needed

We need methods in `clinic-assist.js`:
- `navigateToVisitByRecordNumber(visitRecordNo)` - Navigate directly to a visit record
- OR `openVisitRecordFromQueue(patientName, visitDate)` - Open from queue

### Step 3: Batch Extraction Script

**File**: `src/examples/extract-visit-details-batch.js` (new)

```javascript
/**
 * Batch extract diagnosis and services/drugs for all visits
 * Reads from database, opens each visit in Clinic Assist, extracts data
 */
async function batchExtractVisitDetails() {
  // 1. Query visits from database (source = 'Clinic Assist', diagnosis IS NULL)
  // 2. For each visit:
  //    - Login to Clinic Assist (reuse session)
  //    - Open visit record
  //    - Extract diagnosis and services/drugs
  //    - Update database
  // 3. Log progress
}
```

## Database Schema Updates Needed

We need to store extracted diagnosis and services/drugs:

**Option 1: Use existing columns**
- `diagnosis_description` - Store diagnosis text
- `treatment_detail` - Store services/drugs (or create new column)

**Option 2: Add new columns**
- `extracted_diagnosis` - Text field for diagnosis
- `extracted_services` - JSONB array for services/drugs
- `extraction_metadata` - Already exists, can store source info

**Option 3: Use extraction_metadata JSONB**
```json
{
  "diagnosis": "text",
  "services": ["item1", "item2"],
  "drugs": ["drug1", "drug2"],
  "extracted_at": "2026-01-12T...",
  "extraction_source": "visit_notes" | "dispense_payment"
}
```

## Navigation Strategy (Updated)

The correct navigation approach is:

1. **Navigate to Patient Page**: Go to patient search/page in Clinic Assist
2. **Search for Patient**: Search by patient name (or use patient number)
3. **Navigate to TX History**: Open the patient's Treatment History
4. **Open Diagnosis Tab**: Within TX History, navigate to the Diagnosis tab
5. **Extract Diagnosis**: Extract diagnosis for the specific visit

**Benefits of TX History Approach:**
- Works for both current and historical visits
- Access patient's complete treatment history
- Diagnosis tab provides structured diagnosis information
- No dependency on Queue page (which only shows current day)

**Handling Missing Diagnosis:**
- If diagnosis is empty/missing, mark as "Missing diagnosis" or use general placeholder
- Admin will review and edit during review process

## Next Steps

1. **Investigate Navigation**: Use browser to see if we can navigate directly to visit records
2. **Test Extraction**: Test `extractClaimDetailsFromCurrentVisit()` on a sample visit
3. **Create Extraction Script**: Build batch extraction script
4. **Update Database**: Add fields/update schema to store extracted data
5. **Integrate with MHC Filling**: Use extracted data to fill MHC forms
