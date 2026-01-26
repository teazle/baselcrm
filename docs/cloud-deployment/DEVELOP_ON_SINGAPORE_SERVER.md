# Developing MHC Asia Form Filling on Singapore Server

## 🎯 The Problem

- You're in Thailand (can't access mhcasia.net)
- Need to build MHC Asia form filling automation
- Need Singapore IP to access the site
- Solution: Develop directly on Singapore AWS server

---

## 🚀 Setup: Development Environment on Singapore Server

### Step 1: Create and Connect to Singapore Server

```bash
# Create AWS EC2 instance in Singapore
# - Region: ap-southeast-1 (Singapore)
# - Instance: t4g.small (2GB RAM, 2 vCPU) - Free for 12 months
# - OS: Ubuntu 22.04 LTS

# Connect via SSH
ssh -i your-key.pem ubuntu@your-server-ip
```

### Step 2: Set Up Development Environment

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Git
sudo apt install -y git

# Install system dependencies for Playwright
sudo apt update
sudo apt install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2

# Install VS Code Server (for remote development)
curl -fsSL https://code-server.dev/install.sh | sh

# Or use the automated script
bash scripts/deploy-to-cloud.sh
```

---

## 💻 Development Options

### Option A: VS Code Remote Development (Recommended)

#### 1. Install VS Code Server on Remote Server

```bash
# On your Singapore server
curl -fsSL https://code-server.dev/install.sh | sh

# Start code-server
code-server --bind-addr 0.0.0.0:8080 --auth password

# It will show you a password - save it!
# Access at: http://your-server-ip:8080
```

#### 2. Access from Your Local Machine

1. **Open browser**: `http://your-server-ip:8080`
2. **Enter password** (shown when code-server started)
3. **Open your project folder**
4. **Develop like normal** - but running on Singapore server!

#### 3. Security (Important!)

```bash
# Use SSH tunnel instead (more secure)
# On your local machine:
ssh -i your-key.pem -L 8080:localhost:8080 ubuntu@your-server-ip

# Then access: http://localhost:8080
```

---

### Option B: VS Code Remote SSH Extension

#### 1. Install Extension Locally

- Install "Remote - SSH" extension in VS Code
- Connect to server via SSH

#### 2. Connect

1. Press `F1` → "Remote-SSH: Connect to Host"
2. Enter: `ubuntu@your-server-ip`
3. Select SSH config file
4. VS Code opens on remote server!

#### 3. Open Project

- File → Open Folder → `/home/ubuntu/Baselrpacrm`
- Develop normally - all code runs on Singapore server

---

### Option C: SSH + Terminal + File Sync

#### 1. Use SSH Terminal

```bash
# Connect
ssh -i your-key.pem ubuntu@your-server-ip

# Edit files with nano/vim
nano src/automations/mhc-asia.js
```

#### 2. Sync Files (rsync)

```bash
# From your local machine, sync files to server
rsync -avz -e "ssh -i your-key.pem" \
  /path/to/Baselrpacrm/ \
  ubuntu@your-server-ip:~/Baselrpacrm/

# Or use Git
# On server: git pull
```

---

## 🔨 Building MHC Asia Form Filling

### Step 1: Test Access to MHC Asia

```bash
# On Singapore server
cd ~/Baselrpacrm

# Test if you can access MHC Asia
curl -I https://www.mhcasia.net/mhc/

# Should return 200 OK (not blocked!)
```

### Step 2: Run Browser with Visible UI (for Development)

```bash
# Edit .env
nano .env

# Set HEADLESS=false temporarily for development
HEADLESS=false

# But we need X11 forwarding for GUI
# Connect with X11 forwarding:
ssh -i your-key.pem -X ubuntu@your-server-ip

# Install X11 and VNC for remote desktop (better option)
```

### Step 3: Use VNC for Remote Desktop (Better for Development)

```bash
# On server, install VNC
sudo apt install -y ubuntu-desktop-minimal
sudo apt install -y tigervnc-standalone-server tigervnc-common

# Set up VNC password
vncserver

# Create VNC startup script
cat > ~/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
/etc/X11/xinit/xinitrc
[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
x-window-manager &
EOF

chmod +x ~/.vnc/xstartup

# Start VNC server
vncserver :1 -geometry 1920x1080

# On your local machine, use VNC viewer
# Connect to: your-server-ip:5901
```

### Step 4: Develop Form Filling Code

```bash
# On server (via SSH or VS Code Remote)
cd ~/Baselrpacrm

# Install dependencies
npm install
npm run install-browsers

# Edit MHC Asia automation
nano src/automations/mhc-asia.js

# Or use VS Code Remote to edit
```

---

## 🧪 Testing and Development Workflow

### Development Workflow

1. **Edit code** (via VS Code Remote or SSH)
2. **Test login**:
   ```bash
   npm run test-login
   ```
3. **Test specific MHC Asia functions**:
   ```bash
   # Create test script
   node -e "
   import('./src/automations/mhc-asia.js').then(async (m) => {
     const { BrowserManager } = await import('./src/utils/browser.js');
     const browser = new BrowserManager();
     await browser.init();
     const page = await browser.newPage();
     const mhc = new m.MHCAsiaAutomation(page);
     await mhc.login();
     // Test your form filling code here
     await browser.close();
   });
   "
   ```
4. **Run full workflow**:
   ```bash
   npm run test-workflow
   ```
5. **Take screenshots** (saved in `screenshots/` folder)
6. **Check logs** for errors
7. **Iterate** on form filling logic

---

## 📝 Building the Form Filling Step by Step

### Step 1: Understand MHC Asia Form Structure

```javascript
// In src/automations/mhc-asia.js
// After login, navigate to claim form
async fillClaimForm(claimData) {
  // 1. Navigate to claim submission page
  await this.page.goto('https://www.mhcasia.net/mhc/claim-form');
  
  // 2. Fill each field
  // Example:
  await this.page.fill('input[name="patientName"]', claimData.patientName);
  await this.page.fill('input[name="nric"]', claimData.nric);
  await this.page.selectOption('select[name="diagnosis"]', claimData.diagnosis);
  
  // 3. Submit or save as draft
  await this.page.click('button[type="submit"]');
}
```

### Step 2: Map Clinic Assist Data to MHC Asia Form

```javascript
// In src/core/claim-workflow.js
// After extracting from Clinic Assist:
const clinicData = await this.clinicAssist.extractClaimDetailsFromCurrentVisit();

// Transform to MHC Asia format
const mhcFormData = {
  patientName: clinicData.patientName,
  nric: clinicData.nric,
  mcDays: clinicData.mcDays,
  diagnosis: clinicData.diagnosisText,
  items: clinicData.items.map(item => ({
    description: item.name,
    amount: item.amount,
    quantity: item.quantity
  }))
};

// Fill MHC Asia form
await this.mhcAsia.fillClaimForm(mhcFormData);
```

### Step 3: Test Each Field Individually

```javascript
// Create test script: test-mhc-form-fields.js
import { BrowserManager } from './src/utils/browser.js';
import { MHCAsiaAutomation } from './src/automations/mhc-asia.js';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const mhc = new MHCAsiaAutomation(page);

// Login
await mhc.login();

// Test filling one field at a time
await page.goto('claim-form-url');
await page.fill('input[name="testField"]', 'test value');
await page.screenshot({ path: 'screenshots/after-fill-test.png' });

// Check if field was filled correctly
const value = await page.inputValue('input[name="testField"]');
console.log('Field value:', value);
```

---

## 🔍 Debugging on Remote Server

### View Browser (Headless Mode)

```bash
# Set HEADLESS=false in .env
# Use VNC to see browser
# Or use X11 forwarding (slower)
```

### Take Screenshots

```javascript
// Screenshots are automatically saved
await page.screenshot({ path: 'screenshots/debug-step-1.png' });
```

### Check Logs

```bash
# View logs in real-time
tail -f combined.log

# Or if using PM2
pm2 logs
```

### Inspect Page HTML

```javascript
// In your code
const html = await page.content();
console.log(html);

// Or save to file
const fs = require('fs');
fs.writeFileSync('page-html.html', html);
```

---

## 📦 Recommended Development Setup

### Best Setup: VS Code Remote + VNC

1. **VS Code Remote SSH** - Edit code easily
2. **VNC Desktop** - See browser when HEADLESS=false
3. **Git** - Sync code between local and server

```bash
# On server
git clone your-repo
cd your-repo

# On local machine
# Use VS Code Remote SSH to connect
# Edit files directly on server
# Run tests on server
# See browser via VNC
```

---

## 🎯 Step-by-Step Development Plan

### Phase 1: Setup (One Time)

1. ✅ Create Singapore AWS server
2. ✅ Install Node.js, Playwright
3. ✅ Set up VS Code Remote or VNC
4. ✅ Clone your code
5. ✅ Configure .env

### Phase 2: Explore MHC Asia Form

1. ✅ Login to MHC Asia (test on server)
2. ✅ Navigate to claim form
3. ✅ Take screenshots of form
4. ✅ Inspect HTML structure
5. ✅ Identify all form fields

### Phase 3: Build Form Filling

1. ✅ Create `fillClaimForm()` method
2. ✅ Fill one field at a time
3. ✅ Test each field
4. ✅ Handle dropdowns, checkboxes, etc.
5. ✅ Add validation

### Phase 4: Integrate with Clinic Assist Data

1. ✅ Map Clinic Assist data to MHC format
2. ✅ Test full workflow
3. ✅ Handle errors
4. ✅ Add retry logic

### Phase 5: Test and Refine

1. ✅ Test with real data
2. ✅ Fix edge cases
3. ✅ Add error handling
4. ✅ Optimize performance

---

## 🛠️ Quick Start Commands

```bash
# 1. Connect to server
ssh -i key.pem ubuntu@server-ip

# 2. Set up (if not done)
bash scripts/deploy-to-cloud.sh

# 3. Configure
nano .env  # Add credentials, set HEADLESS=false for dev

# 4. Test access
npm run test-login

# 5. Start developing
# Use VS Code Remote or edit files directly
nano src/automations/mhc-asia.js

# 6. Test your changes
npm run test-workflow

# 7. View screenshots
ls -la screenshots/
```

---

## 💡 Tips for Development

1. **Use HEADLESS=false** during development to see browser
2. **Take lots of screenshots** at each step
3. **Test one field at a time** - don't try to fill everything at once
4. **Use page.waitForSelector()** before filling fields
5. **Check for iframes** - MHC Asia might use iframes
6. **Handle dynamic content** - fields might load after page load
7. **Add delays** if needed (but prefer waiting for elements)
8. **Log everything** - use console.log() and logger.info()

---

## ✅ Development Checklist

- [ ] Server created in Singapore
- [ ] VS Code Remote or VNC set up
- [ ] Code deployed to server
- [ ] Can access mhcasia.net from server
- [ ] Can login to MHC Asia
- [ ] Can navigate to claim form
- [ ] Form structure understood
- [ ] Form fields identified
- [ ] Form filling code written
- [ ] Tested with sample data
- [ ] Integrated with Clinic Assist data
- [ ] Full workflow tested
- [ ] Error handling added

---

## 🚀 Next Steps

1. **Set up your Singapore server** (AWS/DigitalOcean)
2. **Set up VS Code Remote** or VNC
3. **Deploy your code** to server
4. **Start building** the form filling functionality
5. **Test iteratively** - one field at a time
6. **Integrate** with Clinic Assist extraction

You can now develop the MHC Asia form filling even though you're in Thailand! The server in Singapore can access the site, and you can develop remotely. 🎉
