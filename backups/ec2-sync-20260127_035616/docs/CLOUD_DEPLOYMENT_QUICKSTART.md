# Quick Start: Deploy to Singapore Cloud Server

## 🚀 Fastest Way to Deploy

### 1. Create Server (Choose One)

**AWS Free Tier** (Recommended):
- Sign up: https://aws.amazon.com/free/
- Create EC2: Singapore region, t4g.small, Ubuntu 22.04
- Free for 12 months

**DigitalOcean**:
- Sign up: https://www.digitalocean.com/
- Create Droplet: Singapore, $12/month plan, Ubuntu 22.04
- $200 free credit (2-3 months free)

**Oracle Cloud**:
- Sign up: https://www.oracle.com/cloud/free/
- Create VM: Singapore region, Ampere A1
- Free forever (if you get capacity)

### 2. Connect to Server

```bash
ssh -i your-key.pem ubuntu@your-server-ip
```

### 3. Run Deployment Script

```bash
# Clone or upload your code
git clone your-repo-url
cd your-repo

# Or upload via SCP from local machine
# scp -r /path/to/Baselrpacrm ubuntu@server-ip:~/

# Run deployment script
cd ~/Baselrpacrm
bash scripts/deploy-to-cloud.sh
```

### 4. Configure Environment

```bash
# Edit .env file
nano .env

# Add your credentials:
# - Clinic Assist username/password
# - MHC Asia username/password
# - Supabase keys (if using)
# - Set HEADLESS=true
# - Set PROXY_ENABLED=false
```

### 5. Test

```bash
# Test login
npm run test-login

# Test workflow
npm run test-workflow
```

### 6. Run Automation

```bash
# Manual run
npm run extract-daily

# Or set up with PM2 (keeps running)
sudo npm install -g pm2
pm2 start src/examples/extract-daily.js --name claim-automation
pm2 save
pm2 startup
```

## ✅ Done!

Your automation is now running on a Singapore server and can access mhcasia.net!

## 📚 Full Documentation

See `docs/DEPLOY_TO_SINGAPORE_CLOUD.md` for detailed instructions.
