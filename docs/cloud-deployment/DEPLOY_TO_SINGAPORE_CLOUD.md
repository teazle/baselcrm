# Deploying Claim Automation to Singapore Cloud Server

This guide shows you how to deploy your claim form filling automation to a cloud server in Singapore (AWS/DigitalOcean/Oracle Cloud) so you can access mhcasia.net.

## 🎯 Overview

The automation will:
1. Extract claim data from Clinic Assist
2. Fill and submit claim forms to MHC Asia
3. Run automatically on a Singapore cloud server

---

## 📋 Prerequisites

- Cloud server account (AWS/DigitalOcean/Oracle Cloud)
- SSH access to your server
- Your automation code (this repository)
- Environment variables (.env file)

---

## 🚀 Step-by-Step Deployment

### Step 1: Create Cloud Server in Singapore

#### Option A: AWS Free Tier (Recommended for Reliability)

1. **Sign up**: https://aws.amazon.com/free/
2. **Create EC2 Instance**:
   - Region: **Asia Pacific (Singapore) - ap-southeast-1**
   - Instance: **t4g.small** (2GB RAM, 2 vCPU) - Free for 12 months
   - OS: **Ubuntu 22.04 LTS**
   - Storage: 30GB (free tier)
3. **Configure Security Group**:
   - Allow SSH (port 22) from your IP
   - Allow HTTP/HTTPS if needed (ports 80, 443)
4. **Create/Download SSH Key Pair**
5. **Note the Public IP** of your instance

#### Option B: DigitalOcean

1. **Sign up**: https://www.digitalocean.com/ (get $200 credit)
2. **Create Droplet**:
   - Region: **Singapore (SGP1)**
   - Plan: **Basic $12/month** (2GB RAM, 1 vCPU) - Minimum for automation
   - OS: **Ubuntu 22.04 LTS**
   - Authentication: SSH keys
3. **Note the IP address**

#### Option C: Oracle Cloud Free Tier

1. **Sign up**: https://www.oracle.com/cloud/free/
2. **Choose Singapore as home region**
3. **Create Always Free VM**:
   - Shape: Ampere A1 (ARM)
   - OCPUs: 2-4 cores
   - Memory: 12-24GB
   - OS: Ubuntu 22.04
4. **Note**: May have capacity issues, retry if needed

---

### Step 2: Connect to Your Server

```bash
# Connect via SSH
ssh -i your-key.pem ubuntu@your-server-ip

# Or for DigitalOcean/Oracle
ssh root@your-server-ip
```

---

### Step 3: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x
npm --version

# Install Git (if not already installed)
sudo apt install -y git

# Install required system dependencies for Playwright
sudo apt install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2
```

---

### Step 4: Deploy Your Code

#### Option A: Clone from Git Repository

```bash
# Clone your repository
cd ~
git clone https://github.com/your-username/your-repo.git
cd your-repo

# Or if you have a private repo
git clone git@github.com:your-username/your-repo.git
cd your-repo
```

#### Option B: Upload via SCP

```bash
# From your local machine
scp -i your-key.pem -r /path/to/Baselrpacrm ubuntu@your-server-ip:~/

# Then on server
cd ~/Baselrpacrm
```

---

### Step 5: Install Project Dependencies

```bash
# Install npm packages
npm install

# Install Playwright browsers (Chromium)
npm run install-browsers

# Or manually
npx playwright install chromium
npx playwright install-deps chromium
```

---

### Step 6: Configure Environment Variables

```bash
# Create .env file
nano .env
```

Add your configuration:

```bash
# Clinic Assist Credentials
CLINIC_ASSIST_URL=https://clinicassist.sg:1080/
CLINIC_ASSIST_USERNAME=Vincent
CLINIC_ASSIST_PASSWORD=Testing123!!!

# MHC Asia Credentials
MHC_ASIA_URL=https://www.mhcasia.net/mhc/
MHC_ASIA_USERNAME=SSP000170
MHC_ASIA_PASSWORD=KY08240

# Browser Settings
HEADLESS=true
SLOW_MO=500
TIMEOUT=30000
CLINIC_ASSIST_CLINIC_GROUP=ssoc

# Supabase Configuration (if using CRM)
SUPABASE_URL=https://xeovkxexfacsjtcwokrt.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://xeovkxexfacsjtcwokrt.supabase.co
SUPABASE_ANON_KEY=your-key-here
SUPABASE_SERVICE_ROLE_KEY=your-key-here

# Proxy Configuration (DISABLED - using Singapore server directly)
PROXY_ENABLED=false
USE_PERSISTENT_CONTEXT=false
```

**Important**: 
- Set `HEADLESS=true` for server (no GUI)
- Set `PROXY_ENABLED=false` (server is already in Singapore)
- Save and exit (Ctrl+X, then Y, then Enter)

---

### Step 7: Test the Setup

```bash
# Test login to both portals
npm run test-login

# Test full workflow
npm run test-workflow
```

If tests pass, your automation is ready!

---

### Step 8: Run Automation

#### Manual Run

```bash
# Run single workflow
npm run test-workflow

# Or run batch extraction
npm run batch-extract

# Or run daily extraction
npm run extract-daily
```

#### Automated Scheduling (Cron)

```bash
# Edit crontab
crontab -e

# Add schedule (example: run daily at 2 AM Singapore time)
0 2 * * * cd /home/ubuntu/Baselrpacrm && /usr/bin/node src/examples/extract-daily.js >> /home/ubuntu/automation.log 2>&1

# Or run every hour
0 * * * * cd /home/ubuntu/Baselrpacrm && /usr/bin/node src/examples/extract-daily.js >> /home/ubuntu/automation.log 2>&1
```

---

### Step 9: Set Up Process Management (Optional but Recommended)

Install PM2 to keep automation running and auto-restart on crashes:

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start automation with PM2
cd ~/Baselrpacrm
pm2 start src/examples/extract-daily.js --name "claim-automation"

# Or start with schedule
pm2 start src/examples/extract-daily.js --name "claim-automation" --cron "0 2 * * *"

# Save PM2 configuration
pm2 save

# Set PM2 to start on boot
pm2 startup
# Follow the instructions it prints

# Monitor
pm2 status
pm2 logs claim-automation
```

---

## 🔧 Troubleshooting

### Issue: Playwright browsers not installing

```bash
# Install dependencies manually
sudo apt install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2

# Reinstall Playwright
npm run install-browsers
```

### Issue: Out of memory

```bash
# Check memory usage
free -h

# If low on memory, use swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Issue: Automation fails with timeout

```bash
# Increase timeout in .env
TIMEOUT=60000  # 60 seconds

# Or check network connectivity
curl -I https://www.mhcasia.net/mhc/
```

### Issue: Screenshots not saving

```bash
# Create screenshots directory
mkdir -p screenshots
chmod 755 screenshots
```

---

## 📊 Monitoring & Logs

### View Logs

```bash
# If using PM2
pm2 logs claim-automation

# If using cron, check log file
tail -f /home/ubuntu/automation.log

# Check system logs
journalctl -u your-service-name
```

### Monitor Resources

```bash
# CPU and memory
htop

# Disk space
df -h

# Network
iftop
```

---

## 🔄 Updating Your Code

```bash
# Pull latest changes
cd ~/Baselrpacrm
git pull

# Reinstall dependencies if package.json changed
npm install

# Restart PM2 if using it
pm2 restart claim-automation
```

---

## 🛡️ Security Best Practices

1. **Keep .env secure**:
   ```bash
   chmod 600 .env
   ```

2. **Use SSH keys** (not passwords)

3. **Keep system updated**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

4. **Set up firewall**:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw enable
   ```

5. **Regular backups** of your .env and important data

---

## 📝 Quick Reference Commands

```bash
# Connect to server
ssh -i key.pem ubuntu@server-ip

# Navigate to project
cd ~/Baselrpacrm

# Run test
npm run test-login

# Run automation
npm run extract-daily

# Check logs
pm2 logs claim-automation

# Restart automation
pm2 restart claim-automation

# Check status
pm2 status
```

---

## ✅ Verification Checklist

- [ ] Server created in Singapore region
- [ ] SSH access working
- [ ] Node.js installed (v20.x)
- [ ] Code deployed
- [ ] Dependencies installed (`npm install`)
- [ ] Playwright browsers installed (`npm run install-browsers`)
- [ ] .env file configured
- [ ] Test login successful (`npm run test-login`)
- [ ] Automation runs successfully
- [ ] Cron/PM2 scheduled (if needed)
- [ ] Logs accessible

---

## 🎯 Next Steps

1. **Test the deployment** with a single workflow
2. **Set up monitoring** (PM2 or cron logs)
3. **Schedule automation** (cron or PM2)
4. **Monitor for errors** and adjust as needed
5. **Set up alerts** (optional - email notifications on errors)

Your automation is now running on a Singapore server and can access mhcasia.net! 🎉
