# Card Number Explanation

## What is Card Number?

**Card Number** is the insurance card/policy number used in the MHC portal to select which specific insurance policy to use for a patient visit.

## Why is it needed?

- Patients may have multiple insurance cards/policies (e.g., different employers, family members)
- The MHC portal form requires selecting which card/policy to use for the claim
- It appears as a dropdown/select field in the MHC form

## Is it required?

**No, it's optional:**
- The MHC portal form allows selecting the patient by name alone
- If card number is not provided, the system can:
  - Select the patient name (which may auto-select the first/default card)
  - Or leave card selection for manual selection
  - The `selectCardAndPatient()` method handles both cases

## Current Implementation

From `mhc-asia.js`:
- If `cardNumber` is provided: Selects the specific card from dropdown
- If `cardNumber` is `null` or empty: Selects patient by name only
- The method can also auto-select the first available card if needed

## For Our Use Case

Since we're extracting from Clinic Assist queue lists (not full visit records), we likely won't have card numbers initially. Options:
1. **Leave it null** - Let the system select patient by name (simplest)
2. **Extract from Clinic Assist** - If card number is visible in visit records
3. **Manual selection** - User selects card when reviewing drafts

**Recommendation:** Start with option 1 (null), extract card number later if needed.
