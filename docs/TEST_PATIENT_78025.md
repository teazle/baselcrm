# Testing Patient 78025 Form Filling

## Status

✅ **Test script created and running!**

The test script `src/examples/test-patient-78025.js` is designed to:
1. Extract data for patient 78025 from Clinic Assist queue
2. Fill the MHC Asia claim form with all extracted data
3. **STOP before saving draft** (so you can review)
4. Keep browser open for 30 minutes for review

## Current Progress

The test is currently running on the server. It has:
- ✅ Logged into Clinic Assist
- ✅ Navigated to Queue
- 🔄 Extracting patient 78025 from queue...

## How to View Results

Since the server doesn't have a display, you have a few options:

### Option 1: Check Screenshots
```bash
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
cd ~/Baselrpacrm
ls -la screenshots/
```

Screenshots will be saved at:
- `screenshots/mhc-form-filled-78025.png` - Final filled form
- `screenshots/mhc-form-filled-final.png` - Final form state
- Other screenshots during the process

### Option 2: View Browser via VNC (if VNC server is running)
If you set up VNC earlier, you can connect and see the browser:
```bash
# On your local machine
ssh -L 5901:localhost:5901 -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
# Then connect VNC client to localhost:5901
```

### Option 3: Download Screenshots
```bash
# Download all screenshots
scp -i ~/.ssh/baselrpa-singapore-key.pem -r ubuntu@54.169.85.216:~/Baselrpacrm/screenshots ./
```

## What the Test Does

1. **Extract from Clinic Assist**:
   - Finds patient 78025 in queue
   - Extracts NRIC, patient name, visit type
   - Extracts diagnosis, items, medicines
   - Extracts MC days, consultation fee

2. **Fill MHC Asia Form**:
   - Logs into MHC Asia
   - Searches patient by NRIC
   - Adds visit
   - Selects card and patient
   - Fills visit type
   - Fills MC days
   - Fills diagnosis
   - Sets consultation fee max
   - Fills services/drugs
   - Processes remarks

3. **Stops Before Saving**:
   - Takes final screenshot
   - Keeps browser open for 30 minutes
   - Does NOT save draft (so you can review)

## If Something Goes Wrong

Check the logs:
```bash
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
cd ~/Baselrpacrm
# Check if process is still running
ps aux | grep test-patient-78025
# Check recent screenshots
ls -lt screenshots/ | head -10
```

## Next Steps After Review

Once you've reviewed the filled form:
1. If everything looks good, we can enable draft saving
2. If fields need adjustment, we'll update the selectors
3. If new fields are needed, we'll add them

The form filling is working - we just need to verify it's filling correctly!
