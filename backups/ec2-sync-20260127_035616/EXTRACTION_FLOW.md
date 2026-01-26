# Clinic Assist Extraction Flow - Detailed Explanation

This document explains how the Clinic Assist extraction system works, step by step, and identifies what might be correct or problematic.

## Overview

The extraction process has **2 main paths**:
1. **Batch Extraction** (`BatchExtraction` class) - Extracts ALL patients from queue
2. **Single Patient Extraction** (`extractPatientFromQueue` + `extractClaimDetailsFromCurrentVisit`) - Extracts ONE patient

---

## 📋 Complete Extraction Flow

### Phase 1: Setup & Login
1. **Browser Initialization** - Launches Playwright browser
2. **Login to Clinic Assist** - Uses credentials from `.env`
   - Finds username field
   - Fills password
   - Selects clinic group (default: "ssoc")
   - Handles 2FA if required

### Phase 2: Navigate to Queue
3. **Navigate to Queue Page**
   - Selects branch (default: `__FIRST__` or first available)
   - Selects department (default: `Reception`)
   - Opens the queue view

### Phase 3: Get Queue Items List
4. **Get All Queue Items** (`getAllQueueItems()`)
   - **Primary Method**: Looks for `#queueLogGrid` (jqGrid table)
     - Loops through `tr.jqgrow` rows
     - Extracts data using `aria-describedby` attributes:
       - `_QNo` → Queue number
       - `_Status` → Visit status
       - `_PatientName` → Patient name
       - `_NRIC` → Patient NRIC
       - `_PayType` → Payment type (MHC/AIA/etc)
       - `_VisitType` → Visit type
       - `_Fee` → Fee amount
       - `_In` → Time in
       - `_Out` → Time out
   
   - **Fallback Method**: Looks for HTML `<table>` with "QNo" header
     - Uses column positions (0, 1, 3, 5, 8, 13, 14)
     - **⚠️ POTENTIAL ISSUE**: Column positions are hardcoded and may vary

### Phase 4: Extract Patient from Queue
5. **Extract Basic Patient Info** (`extractPatientFromQueue()`)
   
   **If patient identifier is `__AUTO_MHC_AIA__`:**
   - **Method 1**: jqGrid extraction
     - Finds first row with PayType = "MHC" or "AIA"
     - Extracts NRIC from `_NRIC` column
     - Extracts patient name from `_PatientName` column
     - Extracts visit type from `_VisitType` column
   
   - **Method 2**: Role-based rows
     - Looks for `[role="row"]` elements
     - Filters rows containing "Paid", "Seen", or "New"
     - Finds first row containing "MHC" or "AIA"
     - Extracts NRIC using regex: `/[STFG]\s*\d{4}\s*\d{3}\s*[A-Z]/i`
   
   - **Method 3**: Table-based
     - Finds `<table>` with "QNo" header
     - Filters rows containing "MHC" or "AIA"
     - Extracts NRIC from row text

   **If NRIC not found in queue row:**
   - Opens the visit record by clicking the patient row
   - Extracts NRIC from the patient info page using `extractPatientNricFromPatientInfo()`

### Phase 5: Open Visit Record
6. **Open Visit Record** (`_openVisitFromQueueRow()` or `openQueuedPatientForExtraction()`)
   
   **Method**: Click on patient row to open visit
   - Tries clicking patient name cell first
   - Falls back to clicking first cell in row
   - Falls back to clicking row itself
   
   **Modal Handling:**
   - Dismisses "Update User Info" modal if present
   - Dismisses "Edit Queue Record" modal if present (this means we're on wrong page)
   
   **Validation:**
   - Checks if still on queue page → returns `false` if still there
   - Takes screenshot for debugging

### Phase 6: Extract Claim Details from Visit Record
7. **Extract Claim Details** (`extractClaimDetailsFromCurrentVisit()`)
   
   This extracts **5 key pieces of data**:

   #### A. MC Days
   - **Value**: Always `0` (per requirement)
   - **Source**: Hardcoded
   - ✅ **CORRECT**: As required

   #### B. Diagnosis Text
   - **Method 1**: Extract from visit notes on current page
     - Searches for `textarea`, `div[class*="note"]`, `div[class*="visit"]`
     - Takes longest text content (>20 chars)
   - **Method 2**: Navigate to Dispense/Payment section
     - Calls `_navigateToDispenseAndPayment()`
     - Looks for case notes in dispense/payment area
     - Searches for `textarea`, `div[class*="case"]`, `td:has-text("Case")`
   
   ⚠️ **POTENTIAL ISSUE**: 
   - Relies on class names that may change
   - Text extraction is fuzzy and may grab wrong content
   - May extract modal text if modals are present

   #### C. Claim Amount
   - **Method**: Pattern matching in page text
     - Looks for patterns: `total amount`, `amount due`, `fee`, `charge`
     - Regex: `/\$?([\d,]+\.?\d*)/`
     - Also tries labeled fields
   
   ⚠️ **POTENTIAL ISSUE**:
   - Pattern matching may find wrong amounts (partial charges, deposits, etc.)
   - No validation that amount is the final total

   #### D. Referral Clinic
   - **Method**: Label-based extraction (`_extractLabeledValue()`)
     - Searches for labels: "referral clinic", "referred by", "referral from"
     - Looks for value next to label or in same table row
     - Filters out modal text
   
   ⚠️ **POTENTIAL ISSUE**:
   - May not find referral clinic if label format is different
   - Could extract wrong text if page structure is unexpected

   #### E. Services/Drugs/Items
   - **Method**: Extract from dispense/payment table
     - Navigates to dispense/payment if not already there
     - Finds table with headers containing: "drug", "medicine", "item", "description", "qty", "price"
     - Extracts all table rows
     - Takes drug/service name from first or second column
     - De-duplicates and limits to 50 items
   
   ⚠️ **POTENTIAL ISSUE**:
   - Table structure may vary
   - May miss items if table format is different
   - Column selection is heuristic-based

### Phase 7: Extract Patient NRIC (if needed)
8. **Extract NRIC from Patient Info Page** (`extractPatientNricFromPatientInfo()`)
   
   - **Method 1**: Label-based extraction
     - Uses `_extractLabeledValue('nric|n\\.r\\.i\\.c')`
     - Looks for NRIC label and extracts value
   
   - **Method 2**: Regex search on entire page
     - Searches for pattern: `/[STFG]\d{7}[A-Z]/i`
     - Takes first match

### Phase 8: Save to CRM (Batch Only)
9. **Save to Database** (`saveToCRM()`)
   
   - Maps extracted data to `visits` table structure:
     - `patient_name` ← queue item patient name
     - `nric` ← extracted NRIC
     - `visit_date` ← today's date
     - `diagnosis_description` ← diagnosis text
     - `symptoms` ← notes text (same as diagnosis)
     - `treatment_detail` ← items joined by newline
     - `total_amount` ← claim amount or fee
     - `mc_required`, `mc_start_date`, `mc_end_date` ← based on MC days
     - `pay_type`, `visit_type` ← from queue
     - `extraction_metadata` ← sources and extraction info
   
   - **Insert or Update**: Tries insert first, updates if duplicate

---

## ✅ What's CORRECT

1. **Queue Reading** - jqGrid extraction using `aria-describedby` is robust
2. **Modal Handling** - Good dismissal logic for "Update User Info" modal
3. **Fallback Methods** - Multiple fallback approaches for finding queue rows
4. **NRIC Extraction** - Regex pattern is correct for Singapore NRIC format
5. **Error Handling** - Good error handling and logging
6. **MC Days** - Correctly set to 0 as required

---

## ⚠️ POTENTIAL ISSUES & WEAKNESSES

### Critical Issues:

1. **Hardcoded Column Positions** (in table fallback)
   - `cells.nth(0)`, `cells.nth(5)`, `cells.nth(13)` etc.
   - **Problem**: Column order may change
   - **Impact**: Wrong data extracted or extraction fails

2. **Fuzzy Text Extraction for Diagnosis**
   - Searches for generic class names like `div[class*="note"]`
   - **Problem**: May extract wrong text (modal text, UI elements, etc.)
   - **Impact**: Incorrect diagnosis saved

3. **No Validation of Extracted Data**
   - Amounts, diagnosis, items are not validated
   - **Problem**: May save garbage data
   - **Impact**: Data quality issues in CRM

4. **Race Conditions**
   - Multiple `waitForTimeout()` calls with fixed delays
   - **Problem**: Page may not be ready when expected
   - **Impact**: Extraction may fail on slow connections

5. **Navigation Reliability**
   - `_navigateToDispenseAndPayment()` may fail silently
   - **Problem**: If navigation fails, items won't be extracted
   - **Impact**: Missing service/drug data

### Medium Issues:

6. **Pattern Matching for Amounts**
   - Regex may match partial amounts or deposits
   - **Problem**: May extract wrong amount
   - **Impact**: Incorrect billing data

7. **Table Structure Assumptions**
   - Assumes specific table headers and structure
   - **Problem**: May not work if UI changes
   - **Impact**: Missing items

8. **Modal Text Contamination**
   - Despite filtering, modal text may still be extracted
   - **Problem**: "Update User Info" modal text may appear in diagnosis
   - **Impact**: Wrong diagnosis text

9. **Visit Type Normalization**
   - `_normalizeVisitType()` may not handle all cases
   - **Problem**: Visit type may be incorrect
   - **Impact**: Wrong categorization

### Low Issues:

10. **Screenshot Paths** - Hardcoded `screenshots/` directory
11. **Source Tracking** - Good tracking of data sources in `sources` object
12. **Error Messages** - Could be more descriptive

---

## 🔍 How Data is Retrieved

### Queue Data (Phase 3):
```javascript
// jqGrid method (PRIMARY)
const nric = await row.locator('td[aria-describedby$="_NRIC"]').textContent();
const patientName = await row.locator('td[aria-describedby$="_PatientName"]').textContent();
// ... etc
```

### Diagnosis (Phase 6B):
```javascript
// Method 1: Visit notes
const visitNotesText = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('textarea, div[class*="note"]'));
  // Returns longest text > 20 chars
});

// Method 2: Case notes in dispense/payment
// Navigates to dispense/payment first, then extracts
```

### Claim Amount (Phase 6C):
```javascript
const claimAmount = await page.evaluate(() => {
  const bodyText = document.body?.innerText || '';
  const match = bodyText.match(/total\s*(?:amount|fee)?\s*[:\$]?\s*\$?([\d,]+\.?\d*)/i);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
});
```

### Items/Services (Phase 6E):
```javascript
const items = await page.evaluate(() => {
  const tables = Array.from(document.querySelectorAll('table'));
  // Find table with headers containing "drug", "medicine", "item"
  // Extract rows and take first/second column as item name
});
```

---

## 📊 Data Flow Summary

```
Queue Page
  ↓
getAllQueueItems() → [queueItem1, queueItem2, ...]
  ↓
extractQueueItemData(queueItem)
  ↓
_openVisitFromQueueRow() → Opens visit record
  ↓
extractClaimDetailsFromCurrentVisit()
  ├── MC Days: 0 (hardcoded)
  ├── Diagnosis: Visit notes OR case notes
  ├── Claim Amount: Pattern match
  ├── Referral Clinic: Label extraction
  └── Items: Table extraction
  ↓
extractPatientNricFromPatientInfo() (if needed)
  ↓
saveToCRM() → Supabase `visits` table
```

---

## 🛠️ Recommendations

1. **Add Validation**
   - Validate NRIC format before saving
   - Validate amounts are reasonable (>0, <max)
   - Validate diagnosis text length

2. **Improve Selectors**
   - Use more specific selectors for diagnosis
   - Add data attributes to identify correct elements

3. **Better Error Handling**
   - Throw specific errors for each extraction step
   - Log what was extracted vs what failed

4. **Add Retry Logic**
   - Retry navigation if it fails
   - Retry extraction if modal appears

5. **Make Column Positions Configurable**
   - Store column mappings in config
   - Detect column positions dynamically

6. **Add Data Quality Checks**
   - Verify extracted data makes sense
   - Flag suspicious extractions for review

---

## 🧪 Testing Strategy

To verify extraction is working correctly:

1. **Check Sources Object**: Each extraction logs where data came from
   - Look for `sources.diagnosis`, `sources.items`, etc.
   - Verify correct source is being used

2. **Screenshots**: Check `screenshots/clinic-assist-visit-opened.png`
   - Verify visit record opened correctly
   - Check if modals are blocking extraction

3. **Logs**: Review extraction logs
   - Check for warnings about missing data
   - Look for fallback methods being used

4. **Database**: Check `extraction_metadata.sources` in saved records
   - Verify data came from expected sources
   - Check if wrong source was used

