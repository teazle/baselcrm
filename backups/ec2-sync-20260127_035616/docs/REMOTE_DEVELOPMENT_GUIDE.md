# Remote Development Guide: Building MHC Asia Form Filling

## 🎯 The Challenge

- You're in Thailand (can't access mhcasia.net)
- Need to build MHC Asia form filling automation
- Solution: Develop on Singapore server where you CAN access the site

---

## 🚀 Quick Setup

### 1. Create Singapore Server

```bash
# AWS Free Tier (recommended)
# - Region: ap-southeast-1 (Singapore)
# - Instance: t4g.small
# - OS: Ubuntu 22.04
```

### 2. Connect and Set Up

```bash
# Connect
ssh -i key.pem ubuntu@server-ip

# Run setup script
git clone your-repo
cd your-repo
bash scripts/setup-dev-environment.sh
```

### 3. Access Development Environment

**Option A: VS Code Server (Recommended)**
```bash
# On server, VS Code Server is running
# Access from browser: http://server-ip:8080
# Or use SSH tunnel (more secure):
ssh -L 8080:localhost:8080 -i key.pem ubuntu@server-ip
# Then access: http://localhost:8080
```

**Option B: VS Code Remote SSH**
- Install "Remote - SSH" extension in VS Code
- Connect to: `ubuntu@server-ip`
- Open folder: `/home/ubuntu/Baselrpacrm`

**Option C: VNC Remote Desktop**
```bash
# Connect with VNC viewer
# Server: server-ip:5901
# Or use SSH tunnel:
ssh -L 5901:localhost:5901 -i key.pem ubuntu@server-ip
# Then VNC to: localhost:5901
```

---

## 🔨 Building Form Filling Step by Step

### Step 1: Explore the Form

```bash
# On server, create exploration script
cat > explore-mhc-form.js << 'EOF'
import { BrowserManager } from './src/utils/browser.js';
import { MHCAsiaAutomation } from './src/automations/mhc-asia.js';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

// Login
await mhc.login();

// Navigate to claim form (adjust URL)
await page.goto('https://www.mhcasia.net/mhc/claim-form');

// Take screenshot
await page.screenshot({ path: 'screenshots/mhc-form.png', fullPage: true });

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

node explore-mhc-form.js
```

### Step 2: Build Form Filling Method

```javascript
// In src/automations/mhc-asia.js

/**
 * Fill claim form with extracted data
 * @param {Object} claimData - Claim data from Clinic Assist
 */
async fillClaimForm(claimData) {
  try {
    this._logStep('Fill claim form', { patientName: claimData.patientName });
    
    // Navigate to claim form
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
        // Add item row (if form has dynamic rows)
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
    
    // Take screenshot before submit
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
    await this.page.waitForTimeout(200); // Small delay
  } catch (error) {
    logger.warn(`Could not fill field ${selector}:`, error.message);
    // Try alternative selectors
    const alternatives = [
      selector.replace('[name=', '[id='),
      `input[placeholder*="${value}"]`,
    ];
    // Try alternatives...
  }
}
```

### Step 3: Integrate with Workflow

```javascript
// In src/core/claim-workflow.js
// After extracting from Clinic Assist:

// Step 7: Fill MHC Asia form
this.steps.step(7, 'MHC Asia: fill claim form');
const mhcFormData = {
  patientName: patientInfo.patientName,
  nric: patientInfo.nric,
  mcDays: clinicClaimDetails.mcDays,
  diagnosis: clinicClaimDetails.diagnosisText,
  items: clinicClaimDetails.items || []
};

await this.mhcAsia.fillClaimForm(mhcFormData);
this.steps.step(7, 'MHC Asia: form filled', { 
  itemsCount: mhcFormData.items.length 
});
```

---

## 🧪 Testing Workflow

### Test Individual Steps

```bash
# On server
cd ~/Baselrpacrm

# Test login
npm run test-login

# Test form exploration
node explore-mhc-form.js

# Test form filling
node -e "
import('./src/automations/mhc-asia.js').then(async (m) => {
  const { BrowserManager } = await import('./src/utils/browser.js');
  const browser = new BrowserManager();
  await browser.init();
  const page = await browser.newPage();
  const mhc = new m.MHCAsiaAutomation(page);
  
  await mhc.login();
  
  // Test with sample data
  await mhc.fillClaimForm({
    patientName: 'Test Patient',
    nric: 'S1234567A',
    mcDays: 3,
    diagnosis: 'Test Diagnosis',
    items: [{ name: 'Consultation', amount: 100, quantity: 1 }]
  });
  
  await browser.close();
});
"
```

### Test Full Workflow

```bash
# Test complete workflow
npm run test-workflow
```

---

## 📝 Development Tips

1. **Use HEADLESS=false** during development to see browser
2. **Take screenshots** at every step
3. **Inspect HTML** to find correct selectors
4. **Test one field at a time**
5. **Handle dynamic content** (wait for elements)
6. **Check for iframes** (MHC Asia might use them)
7. **Add delays** if needed (but prefer waiting)
8. **Log everything** for debugging

---

## 🔍 Finding Form Selectors

```javascript
// In browser console (when HEADLESS=false) or via code:

// Get all form fields
const fields = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    value: el.value,
    label: el.labels?.[0]?.textContent
  }));
});

console.log(fields);
```

---

## ✅ Development Checklist

- [ ] Server set up in Singapore
- [ ] VS Code Remote or VNC configured
- [ ] Can access mhcasia.net from server
- [ ] Can login to MHC Asia
- [ ] Form structure explored
- [ ] Form fields identified
- [ ] Form filling code written
- [ ] Tested with sample data
- [ ] Integrated with Clinic Assist
- [ ] Full workflow tested
- [ ] Error handling added

---

## 🚀 Next Steps

1. Set up Singapore server
2. Set up remote development environment
3. Explore MHC Asia form structure
4. Build form filling method
5. Test and iterate
6. Integrate with Clinic Assist data

You can now develop the form filling functionality even from Thailand! 🎉
