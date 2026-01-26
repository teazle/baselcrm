# MHC Portal Form Filling Plan (Dry Run)

## Overview

Plan to fill MHC Asia portal forms with patient data extracted from Clinic Assist queue lists. This document outlines the approach for a dry-run implementation.

## Data Available vs Data Required

### Data We Have (from Clinic Assist Queue List Extraction)

From the `visits` table (extracted from Clinic Assist):
- `patient_name` - Patient full name
- `nric` - Patient NRIC (if available)
- `visit_date` - Date of visit
- `visit_record_no` - Clinic Assist visit record number
- `total_amount` - Total visit amount
- `visit_type` - Type of visit (New/Follow-up)
- `pay_type` - Payment type
- `source` - Source system (always "Clinic Assist")

### Data We Need (for MHC Portal Forms)

Based on `mhc-asia.js` and `claim-workflow.js`, MHC portal requires:

**Required Fields:**
1. **Patient NRIC** - For patient search ✅ (we have this)
2. **Patient Name** - For card/patient selection ✅ (we have this)
3. **Visit Date** - Visit date ✅ (we have this)

**Optional but Important Fields:**
4. **Card Number** - Insurance card number ❌ (not in queue list data)
5. **Consultation Fee/Max** - Consultation amount ✅ (we have `total_amount`)
6. **Visit Type/Charge Type** - New/Follow-up ✅ (we have `visit_type`)
7. **MC Days** - Medical certificate days ❌ (not in queue list data)
8. **Diagnosis** - Diagnosis text ❌ (not in queue list data)
9. **Services/Drugs** - List of services and medications ❌ (not in queue list data)
10. **Portal** - Which portal (aiaclient, GE, etc.) - Determined during search

## Data Mapping Strategy

### Direct Mappings (Available)

| Clinic Assist Field | MHC Portal Field | Mapping Method |
|---------------------|------------------|----------------|
| `nric` | Patient search | `searchPatientByNRIC(nric)` |
| `patient_name` | Patient selection | `selectCardAndPatient(null, patient_name)` |
| `visit_date` | Visit date | Auto-filled by portal (current date) |
| `total_amount` | Consultation fee max | `setConsultationFeeMax(total_amount)` |
| `visit_type` | Charge type | `fillVisitTypeFromClinicAssist(visit_type)` |

### Missing Data Handling

**Card Number:**
- Strategy: Leave as `null`, let user select manually OR use first available card
- Impact: Low - card selection can be manual or auto-select first available

**MC Days:**
- Strategy: Default to 0 (no MC) if not provided
- Impact: Low - many visits don't require MC

**Diagnosis:**
- Strategy: Leave empty or use generic placeholder
- Impact: Medium - may require manual entry later

**Services/Drugs:**
- Strategy: Leave empty (services not in queue list data)
- Impact: Medium - detailed services require full visit record access

## Dry Run Implementation Plan

### Phase 1: Data Preparation Script

**File:** `src/examples/prepare-mhc-dry-run.js`

**Purpose:** 
- Fetch visits from database that haven't been submitted to MHC
- Filter visits with required data (NRIC present)
- Map data to MHC form structure
- Log what would be filled

**Key Features:**
1. Query visits: `SELECT * FROM visits WHERE source = 'Clinic Assist' AND nric IS NOT NULL AND submitted_at IS NULL`
2. Data validation: Check for required fields
3. Data mapping: Convert to MHC form format
4. Logging: Output what would be filled for each visit

### Phase 2: Dry Run Script (Browser-Based)

**File:** `src/examples/mhc-dry-run-fill.js`

**Purpose:**
- Open browser and login to MHC
- For each visit:
  - Search patient by NRIC
  - Navigate to visit form
  - Fill available fields
  - **STOP before saving/submitting**
  - Take screenshots
  - Log filled values

**Key Features:**
1. Browser automation with screenshots
2. Fill only available data (don't fill missing fields)
3. Stop before `saveAsDraft()` or submit
4. Comprehensive logging of what was filled
5. Error handling for missing fields/patients

### Phase 3: Validation & Testing

**Approach:**
1. Test with 1-2 sample visits first
2. Verify data mapping is correct
3. Check if portal navigation works
4. Validate form field selectors still work
5. Review screenshots to ensure forms are filled correctly

## Dry Run Script Structure

```javascript
// Pseudo-code structure

async function dryRunMHCFormFilling() {
  // 1. Fetch visits from database
  const visits = await fetchUnsubmittedVisits();
  
  // 2. Filter and validate
  const validVisits = visits.filter(v => v.nric && v.patient_name);
  
  // 3. Initialize browser
  const browser = await launchBrowser({ headless: false });
  const mhcPage = await browser.newPage();
  const mhc = new MHCAsiaAutomation(mhcPage);
  
  // 4. Login to MHC
  await mhc.login();
  
  // 5. For each visit (dry run - limited count)
  for (const visit of validVisits.slice(0, 3)) { // Test with 3 visits
    try {
      // 5a. Log what we're about to fill
      console.log(`\n=== Dry Run: ${visit.patient_name} (${visit.nric}) ===`);
      console.log(`Visit Date: ${visit.visit_date}`);
      console.log(`Amount: ${visit.total_amount}`);
      console.log(`Visit Type: ${visit.visit_type}`);
      
      // 5b. Navigate to AIA program search
      await mhc.navigateToAIAProgramSearch();
      
      // 5c. Search patient by NRIC
      const searchResult = await mhc.searchPatientByNRIC(visit.nric);
      if (!searchResult.found) {
        console.log(`⚠️ Patient not found in MHC portal`);
        continue;
      }
      
      // 5d. Open patient and add visit
      await mhc.openPatientFromSearchResults(visit.nric);
      await mhc.addVisit(searchResult.portal);
      
      // 5e. Select card/patient (card number = null for dry run)
      await mhc.selectCardAndPatient(null, visit.patient_name);
      
      // 5f. Fill available fields
      if (visit.visit_type) {
        await mhc.fillVisitTypeFromClinicAssist(visit.visit_type);
      }
      
      if (visit.total_amount) {
        await mhc.setConsultationFeeMax(visit.total_amount);
      }
      
      // 5g. MC Days - default to 0
      await mhc.fillMcDays(0);
      
      // 5h. Take screenshot
      await mhcPage.screenshot({ 
        path: `screenshots/dry-run-${visit.nric}-${Date.now()}.png` 
      });
      
      // 5i. Log what was filled
      console.log(`✅ Form filled (dry run - NOT saved)`);
      console.log(`   - Visit Type: ${visit.visit_type || 'Not filled'}`);
      console.log(`   - Consultation Max: ${visit.total_amount || 'Not filled'}`);
      console.log(`   - MC Days: 0 (default)`);
      
      // 5j. Navigate back (don't save!)
      // Navigate away from form or close browser session
      
    } catch (error) {
      console.error(`❌ Error processing ${visit.patient_name}:`, error.message);
    }
  }
  
  // 6. Close browser
  await browser.close();
}
```

## Limitations & Considerations

### Missing Data Impact

1. **Card Number Missing:**
   - May need manual selection or use first available card
   - Could be extracted from full visit record (future enhancement)

2. **Diagnosis Missing:**
   - Forms can be saved as draft without diagnosis
   - Diagnosis can be added later manually

3. **Services/Drugs Missing:**
   - Queue list doesn't contain detailed service items
   - Would require opening full visit record in Clinic Assist
   - Can be added manually after draft is created

### Safety Features

1. **Dry Run Mode:**
   - Never call `saveAsDraft()` or submit buttons
   - Take screenshots for verification
   - Log all actions

2. **Error Handling:**
   - Continue processing if one visit fails
   - Log errors for review
   - Don't crash on missing fields

3. **Validation:**
   - Check for required fields before processing
   - Validate NRIC format
   - Verify patient exists in MHC before attempting form fill

## Next Steps

1. **Create dry run script** - Implement `mhc-dry-run-fill.js`
2. **Test with sample data** - Run with 1-2 visits first
3. **Review screenshots** - Verify forms are filled correctly
4. **Iterate on mapping** - Adjust field mappings based on results
5. **Plan full automation** - After dry run validation, plan actual submission workflow

## Future Enhancements

1. **Extract Full Visit Records:**
   - Open visit records in Clinic Assist to get diagnosis, services, drugs
   - This would require additional automation steps

2. **Card Number Extraction:**
   - Extract card numbers from Clinic Assist visit records
   - Store in database for future use

3. **Batch Processing:**
   - Process multiple visits in sequence
   - Track submission status in database
   - Handle errors gracefully

4. **Submission Tracking:**
   - Add `submitted_at` timestamp after successful submission
   - Track submission status per visit
   - Support re-submission on failure
