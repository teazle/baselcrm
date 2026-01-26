# Singapore EC2 Server Setup - Ready for Development!

## ✅ Server Created Successfully!

**Instance Details:**
- **Instance ID**: `i-0ed0c032da89b5718`
- **Public IP**: `54.169.85.216`
- **Region**: `ap-southeast-1` (Singapore)
- **Instance Type**: `t4g.small` (Free tier - 2GB RAM, 2 vCPU)
- **OS**: Ubuntu 22.04 LTS (ARM64)
- **SSH Key**: `~/.ssh/baselrpa-singapore-key.pem`

## 🚀 Quick Start

### Step 1: Connect to Server

```bash
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
```

### Step 2: Deploy Your Automation

Once connected, run:

```bash
# Clone your repository (or upload via SCP)
git clone your-repo-url
cd your-repo

# Or upload from local machine:
# scp -i ~/.ssh/baselrpa-singapore-key.pem -r /path/to/Baselrpacrm ubuntu@54.169.85.216:~/

# Run deployment script
cd ~/Baselrpacrm
bash scripts/deploy-to-cloud.sh
```

### Step 3: Configure Environment

```bash
# Edit .env file
nano .env

# Add your credentials:
# - Clinic Assist username/password
# - MHC Asia username/password
# - Set HEADLESS=true (for server)
# - Set PROXY_ENABLED=false (server is already in Singapore)
```

### Step 4: Set Up Development Environment

```bash
# Set up VS Code Server and VNC for remote development
bash scripts/setup-dev-environment.sh
```

This will:
- Install VS Code Server (access via browser)
- Install VNC (remote desktop)
- Set up development tools

### Step 5: Test Access to MHC Asia

```bash
# Test that you can access mhcasia.net
npm run test-login

# Should work now (server is in Singapore!)
```

## 💻 Development Options

### Option A: VS Code Server (Recommended)

After running `setup-dev-environment.sh`:

1. **Access VS Code in browser**:
   ```bash
   # On server, VS Code Server runs on port 8080
   # Use SSH tunnel from local machine:
   ssh -i ~/.ssh/baselrpa-singapore-key.pem -L 8080:localhost:8080 ubuntu@54.169.85.216
   ```
   
2. **Open browser**: `http://localhost:8080`
3. **Enter password** (shown when code-server starts)
4. **Develop directly on server!**

### Option B: VS Code Remote SSH

1. **Install "Remote - SSH" extension** in VS Code
2. **Connect to**: `ubuntu@54.169.85.216`
3. **Use SSH key**: `~/.ssh/baselrpa-singapore-key.pem`
4. **Open folder**: `/home/ubuntu/Baselrpacrm`

### Option C: VNC Remote Desktop

1. **Connect with VNC viewer** to `54.169.85.216:5901`
2. **Or use SSH tunnel**: 
   ```bash
   ssh -i ~/.ssh/baselrpa-singapore-key.pem -L 5901:localhost:5901 ubuntu@54.169.85.216
   ```
3. **VNC to**: `localhost:5901`

## 🔨 Building MHC Asia Form Filling

Now that you have a Singapore server, you can:

1. **Access mhcasia.net** (server IP is Singapore)
2. **Develop form filling** directly on the server
3. **Test in real-time** with Singapore IP

### Development Workflow

```bash
# On server
cd ~/Baselrpacrm

# Test login
npm run test-login

# Explore MHC Asia form structure
node explore-mhc-form.js

# Build form filling method
# Edit: src/automations/mhc-asia.js

# Test workflow
npm run test-workflow
```

## 📝 Server Information

**SSH Command:**
```bash
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
```

**Instance Details:**
- Free tier eligible (12 months free)
- 2GB RAM, 2 vCPU (enough for browser automation)
- Singapore IP automatically
- Can access mhcasia.net

## 🔧 Useful Commands

```bash
# Check instance status
aws ec2 describe-instances \
  --profile baselrpa \
  --region ap-southeast-1 \
  --instance-ids i-0ed0c032da89b5718

# Stop instance (when not using)
aws ec2 stop-instances \
  --profile baselrpa \
  --region ap-southeast-1 \
  --instance-ids i-0ed0c032da89b5718

# Start instance
aws ec2 start-instances \
  --profile baselrpa \
  --region ap-southeast-1 \
  --instance-ids i-0ed0c032da89b5718

# Get new IP (if instance was stopped/started)
aws ec2 describe-instances \
  --profile baselrpa \
  --region ap-southeast-1 \
  --instance-ids i-0ed0c032da89b5718 \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text
```

## ✅ Next Steps

1. **Wait 1-2 minutes** for instance to fully boot
2. **SSH to server**: `ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216`
3. **Deploy code**: Run `bash scripts/deploy-to-cloud.sh`
4. **Set up dev environment**: Run `bash scripts/setup-dev-environment.sh`
5. **Start developing** MHC Asia form filling!

## 🎯 You're Ready!

Your Singapore server is ready. You can now:
- ✅ Access mhcasia.net (Singapore IP)
- ✅ Develop form filling functionality
- ✅ Test automation in real-time
- ✅ Deploy and run automation

Let's start building the MHC Asia form filling! 🚀
