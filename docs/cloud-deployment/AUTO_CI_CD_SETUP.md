# Auto CI/CD Setup: Git to EC2

This guide shows you how to set up automatic deployment from Git to your EC2 instance. When you push code to Git, it will automatically deploy to your EC2 server.

---

## 🎯 Two Deployment Options

### Option 1: GitHub Actions
- **How it works**: GitHub Actions SSH into EC2 and pull/restart
- **Cost**: 
  - ✅ **FREE** for public repositories (unlimited)
  - ⚠️ **Private repos**: 2,000 minutes/month free, then $0.008/minute (~$0.48/hour)
  - Each deployment uses ~1-2 minutes, so ~1,000-2,000 free deployments/month
- **Pros**: 
  - No need to expose ports on EC2
  - Centralized in GitHub
  - Easy to see deployment logs
  - Free for public repos
- **Cons**: Uses GitHub Actions minutes (may cost for private repos with heavy usage)

### Option 2: Webhook Server (100% FREE) ⭐
- **How it works**: EC2 runs a webhook server that listens for GitHub webhooks
- **Cost**: 
  - ✅ **100% FREE** - No GitHub Actions minutes used
  - ✅ Works for both public and private repos
  - ✅ Unlimited deployments
- **Pros**: 
  - Completely free (no GitHub Actions costs)
  - No limits on deployments
  - More control over deployment process
  - Works for private repos without cost
- **Cons**: 
  - Need to expose webhook port (use security groups)
  - Need to configure GitHub webhook manually
  - Need to keep webhook server running on EC2

## 💰 Cost Comparison

| Feature | GitHub Actions | Webhook Server |
|---------|---------------|----------------|
| **Public Repos** | ✅ Free (unlimited) | ✅ Free |
| **Private Repos** | ⚠️ 2,000 min/month free, then $0.008/min | ✅ Free (unlimited) |
| **Deployments/month** | ~1,000-2,000 free | ✅ Unlimited |
| **Setup Complexity** | Easy | Medium |
| **Security** | No exposed ports | Need to secure webhook port |

**Recommendation**:
- **Public repo**: Either option works, GitHub Actions is easier
- **Private repo with frequent deployments**: Use **Webhook Server** (100% free)
- **Private repo with occasional deployments**: GitHub Actions (likely stays within free tier)

---

## 🚀 Option 1: GitHub Actions Setup

### Step 1: Prepare EC2 Instance

1. **SSH into your EC2 instance**:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

2. **Ensure Git is set up**:
   ```bash
   cd ~/Baselrpacrm  # or your project directory
   git remote -v  # Verify remote is configured
   ```

3. **Make sure deployment script is executable**:
   ```bash
   chmod +x scripts/auto-deploy.sh
   ```

### Step 2: Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:

   | Secret Name | Value | Description |
   |------------|-------|-------------|
   | `EC2_HOST` | `your-ec2-ip-or-domain` | EC2 public IP or domain |
   | `EC2_USERNAME` | `ubuntu` | EC2 username (usually `ubuntu` or `ec2-user`) |
   | `EC2_SSH_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | Your SSH private key (full content) |
   | `EC2_PORT` | `22` | SSH port (default: 22) |
   | `EC2_DEPLOY_PATH` | `~/Baselrpacrm` | Path to your project on EC2 |

   **To get your SSH private key**:
   ```bash
   cat ~/.ssh/your-key.pem
   # Copy the entire output including BEGIN and END lines
   ```

### Step 3: GitHub Actions Workflow

The workflow file is already created at `.github/workflows/deploy-to-ec2.yml`. It will:

1. ✅ Trigger on push to `main` or `master` branch
2. ✅ SSH into EC2
3. ✅ Pull latest code
4. ✅ Install dependencies if `package.json` changed
5. ✅ Restart PM2 processes

**To test manually**:
- Go to **Actions** tab in GitHub
- Click **Deploy to EC2** workflow
- Click **Run workflow** → **Run workflow**

### Step 4: Test Deployment

1. **Make a small change** and push:
   ```bash
   git add .
   git commit -m "Test auto-deployment"
   git push origin main
   ```

2. **Check GitHub Actions**:
   - Go to **Actions** tab
   - You should see a workflow run
   - Click to see deployment logs

3. **Verify on EC2**:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   cd ~/Baselrpacrm
   git log -1  # Should show your latest commit
   ```

---

## 🔧 Option 2: Webhook Server Setup (100% FREE - Recommended for Private Repos)

### Step 1: Set Up Webhook Server on EC2

1. **SSH into EC2**:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

2. **Install dependencies** (if not already):
   ```bash
   cd ~/Baselrpacrm
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   nano .env
   ```
   
   Add:
   ```bash
   WEBHOOK_PORT=9000
   WEBHOOK_SECRET=your-very-secure-secret-key-change-this
   DEPLOY_PATH=/home/ubuntu/Baselrpacrm
   DEPLOY_BRANCH=main
   ```

4. **Start webhook server with PM2**:
   ```bash
   pm2 start scripts/webhook-server.js --name webhook-server
   pm2 save
   pm2 startup  # Auto-start on reboot
   ```

5. **Or run directly** (for testing):
   ```bash
   node scripts/webhook-server.js
   ```

### Step 2: Configure EC2 Security Group

1. Go to **AWS Console** → **EC2** → **Security Groups**
2. Select your EC2 instance's security group
3. Click **Edit inbound rules**
4. Add rule:
   - **Type**: Custom TCP
   - **Port**: `9000` (or your `WEBHOOK_PORT`)
   - **Source**: `0.0.0.0/0` (or restrict to GitHub IPs for better security)
   - **Description**: GitHub webhook

### Step 3: Configure GitHub Webhook

1. Go to your GitHub repository
2. Navigate to **Settings** → **Webhooks**
3. Click **Add webhook**
4. Configure:
   - **Payload URL**: `http://your-ec2-ip:9000/webhook`
   - **Content type**: `application/json`
   - **Secret**: Same as `WEBHOOK_SECRET` in your `.env`
   - **Events**: Select **Just the push event**
   - **Active**: ✅ Checked
5. Click **Add webhook**

### Step 4: Test Webhook

1. **Make a small change** and push:
   ```bash
   git add .
   git commit -m "Test webhook deployment"
   git push origin main
   ```

2. **Check webhook server logs**:
   ```bash
   pm2 logs webhook-server
   # Or if running directly, check terminal output
   ```

3. **Verify deployment**:
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   cd ~/Baselrpacrm
   git log -1  # Should show your latest commit
   ```

---

## 🔒 Security Best Practices

### For GitHub Actions:
- ✅ Use GitHub Secrets (never commit SSH keys)
- ✅ Restrict SSH key permissions: `chmod 400 your-key.pem`
- ✅ Use a dedicated deployment user on EC2 (optional)
- ✅ Consider using AWS Systems Manager instead of SSH (more secure)

### For Webhook Server:
- ✅ Use a strong `WEBHOOK_SECRET`
- ✅ Restrict security group to GitHub IPs (see below)
- ✅ Use HTTPS with reverse proxy (nginx) for production
- ✅ Monitor webhook logs for unauthorized access

**Restrict to GitHub IPs** (optional but recommended):
```bash
# Get GitHub webhook IPs
# GitHub publishes their IP ranges: https://api.github.com/meta
# Add these to your security group instead of 0.0.0.0/0
```

---

## 📊 Monitoring Deployments

### Check Deployment Status

**GitHub Actions**:
- Go to **Actions** tab in GitHub
- View workflow runs and logs

**Webhook Server**:
```bash
pm2 logs webhook-server --lines 50
```

**EC2 Deployment**:
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
cd ~/Baselrpacrm
git log -1  # Latest commit
pm2 status  # PM2 processes
```

---

## 🔧 Troubleshooting

### GitHub Actions Issues

**Issue: "Permission denied (publickey)"**
```bash
# Verify SSH key format
# Make sure you copied the ENTIRE key including BEGIN/END lines
# Check EC2_USERNAME is correct (ubuntu vs ec2-user)
```

**Issue: "Host key verification failed"**
```bash
# Add EC2 host to known_hosts in GitHub Actions
# Or use: StrictHostKeyChecking=no (less secure)
```

**Issue: "Deployment succeeds but code not updated"**
```bash
# Check EC2_DEPLOY_PATH is correct
# Verify git remote is configured on EC2
# Check branch name matches (main vs master)
```

### Webhook Server Issues

**Issue: "Webhook not receiving requests"**
```bash
# Check security group allows port 9000
# Verify webhook URL in GitHub settings
# Check webhook server is running: pm2 status
# Test manually: curl -X POST http://your-ec2-ip:9000/webhook
```

**Issue: "401 Unauthorized"**
```bash
# Verify WEBHOOK_SECRET matches GitHub webhook secret
# Check .env file is loaded correctly
```

**Issue: "Deployment fails silently"**
```bash
# Check webhook server logs: pm2 logs webhook-server
# Verify DEPLOY_PATH is correct
# Check git permissions on EC2
```

---

## 🎯 Quick Start Checklist

### GitHub Actions:
- [ ] EC2 instance running
- [ ] SSH access working
- [ ] GitHub Secrets configured
- [ ] Workflow file exists (`.github/workflows/deploy-to-ec2.yml`)
- [ ] Test push triggers deployment
- [ ] Verify code updated on EC2

### Webhook Server:
- [ ] Webhook server script exists (`scripts/webhook-server.js`)
- [ ] `.env` configured with `WEBHOOK_SECRET` and `WEBHOOK_PORT`
- [ ] PM2 installed and webhook server running
- [ ] Security group allows webhook port
- [ ] GitHub webhook configured
- [ ] Test push triggers deployment
- [ ] Verify code updated on EC2

---

## 🚀 Advanced: Using nginx Reverse Proxy (Webhook Server)

For production, use nginx with HTTPS:

```nginx
# /etc/nginx/sites-available/webhook
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location /webhook {
        proxy_pass http://localhost:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then update GitHub webhook URL to: `https://your-domain.com/webhook`

---

## 📚 Additional Resources

- **GitHub Actions Docs**: https://docs.github.com/en/actions
- **GitHub Webhooks**: https://docs.github.com/en/developers/webhooks-and-events/webhooks
- **PM2 Docs**: https://pm2.keymetrics.io/docs/usage/quick-start/
- **AWS Security Groups**: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/working-with-security-groups.html

---

## ✅ Summary

You now have automatic CI/CD from Git to EC2! 

**Cost-Based Recommendation**:
- **Public Repository**: Use **GitHub Actions** (Option 1) - simpler and free
- **Private Repository**: Use **Webhook Server** (Option 2) - 100% free, unlimited deployments
- **Private Repo with <50 deployments/month**: Either works (GitHub Actions likely stays free)

**Quick Decision Guide**:
- Want 100% free with unlimited deployments? → **Webhook Server**
- Want easiest setup with no port exposure? → **GitHub Actions** (if public repo or low usage)

**Workflow**:
1. Make changes locally
2. Commit and push to Git
3. 🚀 Automatic deployment to EC2
4. Code is live!

Happy deploying! 🎉
