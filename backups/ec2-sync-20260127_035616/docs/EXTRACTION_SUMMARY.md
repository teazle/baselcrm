# Data Extraction Summary

## What We Need to Extract

### 1. Card Number
- **Purpose**: Insurance card/policy number for MHC portal dropdown
- **Status**: ✅ Optional - can be `null`
- **Action**: Leave as null, select patient by name only

### 2. MC Days  
- **Status**: ✅ Always 0 (user requirement)
- **Action**: Hardcode to 0, no extraction needed

### 3. Diagnosis ✅
- **Location in Clinic Assist**: 
  - Primary: "Visit Notes" section (on visit record page)
  - Fallback: "Dispense/Payment" → "Case Notes" section
- **Extraction Method**: Already implemented in `extractClaimDetailsFromCurrentVisit()`
- **Code Location**: `src/automations/clinic-assist.js` line 769-883

### 4. Services/Drugs ✅
- **Location in Clinic Assist**: 
  - "Dispense/Payment" section → Table with drugs/medications
- **Extraction Method**: Already implemented in `extractClaimDetailsFromCurrentVisit()`
- **Code Location**: `src/automations/clinic-assist.js` line 947-996

## Current Implementation Status

✅ **Extraction code exists**: `extractClaimDetailsFromCurrentVisit()` method already extracts:
- Diagnosis text (from visit notes or case notes)
- Services/drugs (from dispense/payment table)
- MC days (hardcoded to 0)
- Claim amount
- Referral clinic

## The Challenge

To extract this data for each patient from our queue list, we need to:

1. **Navigate to each patient's visit record in Clinic Assist**
   - Current code opens visits from Queue page by clicking patient name
   - We need to: Navigate to Queue → Find patient by name → Click to open visit

2. **Call extraction method**
   - Once on visit record page, call `extractClaimDetailsFromCurrentVisit()`

3. **Store in database**
   - Save diagnosis and services/drugs to database

## Next Steps

### Option 1: Use Existing Queue Navigation (Recommended)
- Navigate to Queue page (need branch/dept - we may need to store this)
- Use `openQueuedPatientForExtraction(patientName)` to open visit
- Call `extractClaimDetailsFromCurrentVisit()` to extract data
- Update database

### Option 2: Navigate by Visit Record Number
- If Clinic Assist has a way to navigate directly to visit by record number
- This would be more efficient but may not be available

### Option 3: Use Queue List Report
- Navigate to Reports → Queue List
- Find patient in the report
- However, Queue List Report may not allow opening individual visits

## Test Script Created

File: `src/examples/test-extract-visit-details.js`

This script will:
1. Fetch a visit from database
2. Login to Clinic Assist  
3. Navigate to queue/reports
4. Stay open for manual inspection

Run: `node src/examples/test-extract-visit-details.js [patient_name]`
