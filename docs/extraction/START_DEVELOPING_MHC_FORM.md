# Start Developing MHC Asia Form Filling

## ✅ Server is Ready!

Your Singapore EC2 server is set up and ready for development:

- **Server IP**: `54.169.85.216`
- **SSH**: `ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216`
- **Code deployed**: ✅
- **Dependencies installed**: ✅
- **Playwright browsers installed**: ✅
- **Environment configured**: ✅

## 🚀 Quick Start Development

### Option 1: VS Code Remote SSH (Recommended)

1. **Install "Remote - SSH" extension** in VS Code
2. **Connect to server**:
   - Press `F1` → "Remote-SSH: Connect to Host"
   - Enter: `ubuntu@54.169.85.216`
   - Select SSH config file
   - Use key: `~/.ssh/baselrpa-singapore-key.pem`
3. **Open folder**: `/home/ubuntu/Baselrpacrm`
4. **Start developing!**

### Option 2: VS Code Server (Browser)

1. **SSH to server**:
   ```bash
   ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
   ```

2. **Start VS Code Server**:
   ```bash
   code-server --bind-addr 0.0.0.0:8080 --auth password
   ```
   
3. **Create SSH tunnel** (from local machine):
   ```bash
   ssh -i ~/.ssh/baselrpa-singapore-key.pem -L 8080:localhost:8080 ubuntu@54.169.85.216
   ```

4. **Open browser**: `http://localhost:8080`
5. **Enter password** (shown when code-server started)

## 🔨 Building MHC Asia Form Filling

### Step 1: Test Access to MHC Asia

```bash
# On server
cd ~/Baselrpacrm

# Test login (should work now - Singapore IP!)
npm run test-login
```

### Step 2: Explore Form Structure

Create a script to explore the MHC Asia form:

```bash
# Create exploration script
cat > explore-mhc-form.js << 'EOF'
import { BrowserManager } from './src/utils/browser.js';
import { MHCAsiaAutomation } from './src/automations/mhc-asia.js';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

// Login
await mhc.login();

// Navigate to claim form (adjust URL as needed)
await page.goto('https://www.mhcasia.net/mhc/claim-form');

// Take screenshot
await page.screenshot({ path: 'screenshots/mhc-form-structure.png', fullPage: true });

// Get all form fields
const fields = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
  return inputs.map(el => ({
    type: el.tagName.toLowerCase(),
    name: el.name || el.id,
    id: el.id,
    placeholder: el.placeholder,
    label: el.labels?.[0]?.textContent
  }));
});

console.log('Form fields:', JSON.stringify(fields, null, 2));

await browser.close();
EOF

# Run it
node explore-mhc-form.js
```

### Step 3: Build Form Filling Method

Edit `src/automations/mhc-asia.js` and add:

```javascript
/**
 * Fill claim form with extracted data from Clinic Assist
 * @param {Object} claimData - Claim data from Clinic Assist
 */
async fillClaimForm(claimData) {
  try {
    this._logStep('Fill claim form', { patientName: claimData.patientName });
    
    // Navigate to claim form
    // (Adjust URL based on actual MHC Asia structure)
    await this.page.goto(this.config.url + 'claim-form', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait for form to load
    await this.page.waitForSelector('form', { timeout: 10000 });
    
    // Fill patient information
    await this._fillField('input[name="patientName"]', claimData.patientName);
    await this._fillField('input[name="nric"]', claimData.nric);
    
    // Fill claim details
    await this._fillField('input[name="mcDays"]', claimData.mcDays);
    await this._fillField('textarea[name="diagnosis"]', claimData.diagnosis);
    
    // Fill items/services
    if (claimData.items && claimData.items.length > 0) {
      for (let i = 0; i < claimData.items.length; i++) {
        const item = claimData.items[i];
        // Add item row if needed
        if (i > 0) {
          await this.page.click('button:has-text("Add Item")');
          await this.page.waitForTimeout(500);
        }
        
        // Fill item fields
        await this._fillField(`input[name="items[${i}].description"]`, item.name);
        await this._fillField(`input[name="items[${i}].amount"]`, item.amount);
        await this._fillField(`input[name="items[${i}].quantity"]`, item.quantity);
      }
    }
    
    // Take screenshot
    await this.page.screenshot({ 
      path: 'screenshots/mhc-form-filled.png', 
      fullPage: true 
    });
    
    this._logStep('Form filled successfully');
    return true;
    
  } catch (error) {
    this._logStep('Form filling failed', { error: error.message });
    await this.page.screenshot({ 
      path: 'screenshots/mhc-form-error.png', 
      fullPage: true 
    });
    throw error;
  }
}

/**
 * Helper to fill a field safely
 */
async _fillField(selector, value) {
  try {
    await this.page.waitForSelector(selector, { timeout: 5000 });
    await this.page.fill(selector, String(value));
    await this.page.waitForTimeout(200);
  } catch (error) {
    logger.warn(`Could not fill field ${selector}:`, error.message);
    // Try alternative selectors if needed
  }
}
```

### Step 4: Integrate with Workflow

The workflow already extracts data from Clinic Assist. Now integrate form filling:

```javascript
// In src/core/claim-workflow.js
// After extracting from Clinic Assist, fill MHC Asia form:

const mhcFormData = {
  patientName: patientInfo.patientName,
  nric: patientInfo.nric,
  mcDays: clinicClaimDetails.mcDays,
  diagnosis: clinicClaimDetails.diagnosisText,
  items: clinicClaimDetails.items || []
};

await this.mhcAsia.fillClaimForm(mhcFormData);
```

### Step 5: Test Iteratively

```bash
# Test one field at a time
npm run test-workflow

# Check screenshots
ls -la screenshots/

# Fix and retry
```

## 📋 Development Checklist

- [ ] Server accessible via SSH
- [ ] Code deployed to server
- [ ] Dependencies installed
- [ ] Can login to MHC Asia (test: `npm run test-login`)
- [ ] Form structure explored
- [ ] Form fields identified
- [ ] Form filling method created
- [ ] Tested with sample data
- [ ] Integrated with Clinic Assist data
- [ ] Full workflow tested

## 🎯 Next Steps

1. **Connect to server** (VS Code Remote or SSH)
2. **Test login** to MHC Asia (`npm run test-login`)
3. **Explore form structure** (create exploration script)
4. **Build form filling** method
5. **Test and iterate**

You're ready to start building! The server has Singapore IP and can access mhcasia.net! 🚀
