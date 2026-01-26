# Complete Guide: Deploying Claim Automation to Singapore Cloud

## 🎯 What We're Building

A complete automation system that:
1. **Extracts** claim data from Clinic Assist
2. **Fills and submits** claim forms to MHC Asia
3. **Runs automatically** on a Singapore cloud server
4. **Accesses mhcasia.net** (requires Singapore IP)

---

## 📋 Complete Deployment Flow

### Phase 1: Choose Your Cloud Provider

**Recommended Options**:

1. **AWS Free Tier** (12 months free)
   - Singapore region: ap-southeast-1
   - Instance: t4g.small (2GB RAM, 2 vCPU)
   - Cost: Free for 12 months, then ~$5-10/month

2. **DigitalOcean** ($200 credit)
   - Singapore region: SGP1
   - Plan: $12/month (2GB RAM, 1 vCPU) - Minimum for automation
   - Cost: Free for 2-3 months, then $12/month

3. **Oracle Cloud Free Tier** (Free forever)
   - Singapore region (must choose at signup)
   - Resources: 24GB RAM, 4 cores (if you get capacity)
   - Cost: Free forever (but capacity issues)

---

### Phase 2: Set Up Server

#### Quick Setup Commands

```bash
# 1. Connect to server
ssh -i your-key.pem ubuntu@your-server-ip

# 2. Run deployment script (automates everything)
git clone your-repo-url
cd your-repo
bash scripts/deploy-to-cloud.sh

# 3. Configure .env
nano .env
# Add your credentials

# 4. Test
npm run test-login
npm run test-workflow
```

---

### Phase 3: Configure Environment

Your `.env` file should look like:

```bash
# Clinic Assist
CLINIC_ASSIST_URL=https://clinicassist.sg:1080/
CLINIC_ASSIST_USERNAME=your-username
CLINIC_ASSIST_PASSWORD=your-password

# MHC Asia
MHC_ASIA_URL=https://www.mhcasia.net/mhc/
MHC_ASIA_USERNAME=your-username
MHC_ASIA_PASSWORD=your-password

# Browser (IMPORTANT for server)
HEADLESS=true              # Must be true on server
SLOW_MO=500
TIMEOUT=30000

# Proxy (DISABLED - server is already in Singapore)
PROXY_ENABLED=false        # No proxy needed
USE_PERSISTENT_CONTEXT=false

# Supabase (if using CRM)
SUPABASE_URL=your-url
SUPABASE_ANON_KEY=your-key
```

**Key Points**:
- `HEADLESS=true` - Required for server (no GUI)
- `PROXY_ENABLED=false` - Server is already in Singapore, no proxy needed
- All credentials must be set

---

### Phase 4: Run Your Automation

#### Option A: Manual Run

```bash
# Test single workflow
npm run test-workflow

# Run daily extraction
npm run extract-daily

# Run batch extraction
npm run batch-extract
```

#### Option B: Automated with PM2 (Recommended)

```bash
# Install PM2
sudo npm install -g pm2

# Start automation
pm2 start src/examples/extract-daily.js --name claim-automation

# Or with schedule (daily at 2 AM)
pm2 start src/examples/extract-daily.js --name claim-automation --cron "0 2 * * *"

# Save configuration
pm2 save

# Auto-start on boot
pm2 startup
# Follow instructions it prints

# Monitor
pm2 status
pm2 logs claim-automation
```

#### Option C: Automated with Cron

```bash
# Edit crontab
crontab -e

# Add (runs daily at 2 AM Singapore time)
0 2 * * * cd /home/ubuntu/Baselrpacrm && /usr/bin/node src/examples/extract-daily.js >> /home/ubuntu/automation.log 2>&1
```

---

## 🔄 How the Automation Works

### Complete Flow:

```
1. Server starts (Singapore IP automatically)
   ↓
2. Automation runs (extract-daily.js or test-workflow.js)
   ↓
3. BrowserManager.init()
   - Launches Chromium (headless)
   - No proxy needed (server is in Singapore)
   ↓
4. Clinic Assist Automation
   - Login to Clinic Assist
   - Navigate to Queue
   - Extract patient data
   - Extract claim details (MC days, diagnosis, items, etc.)
   ↓
5. MHC Asia Automation
   - Login to MHC Asia (Singapore IP allows access)
   - Search for patient
   - Fill claim form with extracted data
   - Submit or save as draft
   ↓
6. Save to CRM (if configured)
   - Save extracted/submitted data
   - Track workflow status
   ↓
7. Complete
   - Logs saved
   - Screenshots saved (for debugging)
   - Results returned
```

---

## 🛠️ What Gets Deployed

### Files Deployed:
- `src/` - All automation code
- `package.json` - Dependencies
- `.env` - Configuration (credentials)
- `node_modules/` - Installed on server
- Playwright browsers - Installed on server

### What Runs:
- Node.js runtime
- Playwright/Chromium browser
- Your automation scripts
- Logging and error handling

---

## 📊 Monitoring & Maintenance

### Check Status

```bash
# If using PM2
pm2 status
pm2 logs claim-automation --lines 50

# Check system resources
htop
df -h  # Disk space
free -h  # Memory
```

### View Logs

```bash
# PM2 logs
pm2 logs claim-automation

# Cron logs (if using cron)
tail -f /home/ubuntu/automation.log

# Application logs
tail -f combined.log
```

### Update Code

```bash
# Pull latest changes
git pull

# Reinstall if dependencies changed
npm install

# Restart if using PM2
pm2 restart claim-automation
```

---

## 🔧 Troubleshooting

### Common Issues

**1. "Out of memory" errors**
```bash
# Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

**2. Playwright browsers not installing**
```bash
# Install system dependencies
sudo apt install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2

# Reinstall Playwright
npm run install-browsers
```

**3. "Cannot access mhcasia.net"**
```bash
# Verify IP is Singapore
curl https://ipinfo.io/json

# Should show country: "SG"
```

**4. Automation fails/timeouts**
```bash
# Increase timeout in .env
TIMEOUT=60000  # 60 seconds

# Check network
curl -I https://www.mhcasia.net/mhc/
```

---

## ✅ Verification Checklist

Before going live:

- [ ] Server created in Singapore region
- [ ] SSH access working
- [ ] Node.js installed (v20.x)
- [ ] Code deployed
- [ ] Dependencies installed
- [ ] Playwright browsers installed
- [ ] .env configured with credentials
- [ ] HEADLESS=true in .env
- [ ] PROXY_ENABLED=false in .env
- [ ] Test login successful
- [ ] Test workflow successful
- [ ] IP verified as Singapore
- [ ] Automation scheduled (PM2 or cron)
- [ ] Logs accessible
- [ ] Monitoring set up

---

## 🎯 Quick Start Summary

```bash
# 1. Create server (AWS/DigitalOcean/Oracle) in Singapore
# 2. Connect
ssh -i key.pem ubuntu@server-ip

# 3. Deploy
git clone your-repo
cd your-repo
bash scripts/deploy-to-cloud.sh

# 4. Configure
nano .env  # Add credentials, set HEADLESS=true, PROXY_ENABLED=false

# 5. Test
npm run test-login
npm run test-workflow

# 6. Run
npm run extract-daily

# 7. Automate (optional)
sudo npm install -g pm2
pm2 start src/examples/extract-daily.js --name claim-automation
pm2 save
pm2 startup
```

---

## 📚 Additional Resources

- **Full Deployment Guide**: `docs/DEPLOY_TO_SINGAPORE_CLOUD.md`
- **Quick Start**: `docs/CLOUD_DEPLOYMENT_QUICKSTART.md`
- **Deployment Script**: `scripts/deploy-to-cloud.sh`

---

## 💡 Key Points

1. **No VPN/Proxy Needed**: Server is already in Singapore, so IP is automatically Singapore
2. **Headless Mode**: Must set `HEADLESS=true` for server (no GUI)
3. **Process Management**: Use PM2 to keep automation running
4. **Monitoring**: Check logs regularly for errors
5. **Updates**: Pull code updates and restart PM2

Your automation will now run on a Singapore server and can access mhcasia.net! 🚀
