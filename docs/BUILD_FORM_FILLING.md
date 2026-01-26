# Building MHC Asia Form Filling - Step by Step

## ✅ Current Status

- ✅ Singapore server created and running
- ✅ Code deployed to server
- ✅ Can access mhcasia.net (Singapore IP verified)
- ✅ Login to MHC Asia working
- ✅ Form filling methods exist but may need improvement

## 🔨 Building the Form Filling

### Step 1: Explore the Actual Form Structure

First, we need to see what the actual form looks like:

```bash
# On server
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216

# Run exploration script
cd ~/Baselrpacrm
node src/examples/explore-mhc-form.js
```

This will:
- Login to MHC Asia
- Navigate to the claim form
- Extract all form fields
- Save structure to `mhc-form-structure.json`
- Take screenshots

### Step 2: Review Existing Form Filling Methods

The code already has these methods in `src/automations/mhc-asia.js`:
- `fillMcDays()` - Fills MC days
- `fillDiagnosisFromText()` - Fills diagnosis
- `fillServicesAndDrugs()` - Fills services and drugs
- `fillVisitTypeFromClinicAssist()` - Fills visit type
- `setConsultationFeeMax()` - Sets consultation fee max
- `selectCardAndPatient()` - Selects card and patient
- `saveAsDraft()` - Saves as draft

### Step 3: Test Current Workflow

Test if the existing methods work:

```bash
# On server
npm run test-workflow
```

This will:
- Extract from Clinic Assist
- Fill MHC Asia form
- Show what works and what doesn't

### Step 4: Improve Form Filling

Based on the exploration results, improve the methods:

1. **Check `mhc-form-structure.json`** to see actual field names
2. **Update selectors** in form filling methods
3. **Add missing fields** if any
4. **Improve error handling**

### Step 5: Test and Iterate

```bash
# Test workflow
npm run test-workflow

# Check screenshots
ls -la screenshots/

# Fix issues and retry
```

## 📋 What Needs to Be Filled

Based on the workflow, these fields need to be filled:

1. **Card Selection** - Insurance card number
2. **Patient Selection** - Patient name
3. **Visit Type / Charge Type** - New or Follow Up
4. **MC Days** - Medical certificate days
5. **Diagnosis** - Primary diagnosis
6. **Consultation Fee** - Maximum consultation amount
7. **Services/Procedures** - X-ray, scans, procedures, etc.
8. **Drugs/Medicines** - Medications prescribed
9. **Special Remarks** - Any special notes
10. **Waiver of Referral** - Checkbox if applicable

## 🎯 Next Steps

1. **Run exploration script** to see actual form structure
2. **Test current workflow** to see what works
3. **Improve methods** based on findings
4. **Test again** until all fields fill correctly

## 🚀 Quick Start

```bash
# 1. Connect to server
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216

# 2. Explore form structure
cd ~/Baselrpacrm
node src/examples/explore-mhc-form.js

# 3. Review results
cat mhc-form-structure.json

# 4. Test workflow
npm run test-workflow

# 5. Check screenshots
ls -la screenshots/
```

Let's start by exploring the form structure to see what we're working with!
