# Browser Inspection Notes - Clinic Assist Visit Records

## Purpose
To identify where Diagnosis and Services/Drugs are located in Clinic Assist visit records.

## Steps to Inspect

1. **Login to Clinic Assist**
   - URL: https://clinicassist.sg:1080/
   - Username: Vincent
   - Password: Testing123!!!
   - Clinic Group: ssoc

2. **Navigate to a Visit Record**
   - Option A: Go to Queue → Find patient → Click to open visit
   - Option B: Go to Reports → Queue List → Find patient → (may need different navigation)
   
3. **Locate Diagnosis**
   - Check "Visit Notes" section
   - Check "Dispense/Payment" → "Case Notes"
   - Note: The code already extracts from these locations

4. **Locate Services/Drugs**
   - Check "Dispense/Payment" section
   - Look for table with drugs/medications
   - Note: The code extracts from dispense/payment table

## Current Extraction Code

The `extractClaimDetailsFromCurrentVisit()` method in `clinic-assist.js` already:
- Extracts diagnosis from visit notes OR dispense/payment case notes
- Extracts services/drugs from dispense/payment table
- Validates extracted data

## Test Script

Run: `node src/examples/test-extract-visit-details.js [patient_name]`

This will:
1. Login to Clinic Assist
2. Navigate to queue/reports
3. Stay open for manual inspection
