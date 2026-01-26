# GitHub Actions Setup Checklist

Use this checklist to set up automatic deployment from GitHub to your EC2 instance.

---

## 📋 Step 1: Get Your EC2 Information

Before adding secrets, you need to gather this information:

### 1. EC2 Host (IP or Domain)
```bash
# Option A: Get from AWS Console
# EC2 Dashboard → Your Instance → Public IPv4 address

# Option B: If you have domain
# your-domain.com
```

**Your EC2_HOST**: `_________________`

---

### 2. EC2 Username
```bash
# Usually:
# - ubuntu (for Ubuntu/Debian)
# - ec2-user (for Amazon Linux)
# - admin (for some AMIs)
```

**Your EC2_USERNAME**: `_________________`

---

### 3. EC2 SSH Port
```bash
# Default is 22, but check your security group
```

**Your EC2_PORT**: `22` (or `_________________` if different)

---

### 4. EC2 Deploy Path
```bash
# The full path to your project on EC2
# Usually: /home/ubuntu/Baselrpacrm
# Or: ~/Baselrpacrm
```

**Your EC2_DEPLOY_PATH**: `_________________`

---

### 5. SSH Private Key
```bash
# Get your SSH private key content
# On your local machine:
cat ~/.ssh/your-key.pem

# Or wherever your EC2 key is stored
# Copy the ENTIRE output including:
# -----BEGIN RSA PRIVATE KEY-----
# ... (all the content) ...
# -----END RSA PRIVATE KEY-----
```

**Your EC2_SSH_KEY**: 
```
-----BEGIN RSA PRIVATE KEY-----
[Paste entire key content here]
-----END RSA PRIVATE KEY-----
```

---

## 🔐 Step 2: Add GitHub Secrets

1. Go to your GitHub repository
2. Click **Settings** (top menu)
3. Click **Secrets and variables** → **Actions** (left sidebar)
4. Click **New repository secret** for each secret below

### Secret 1: EC2_HOST
- **Name**: `EC2_HOST`
- **Value**: Your EC2 IP address or domain (from Step 1.1)
- **Example**: `54.123.45.67` or `ec2.example.com`

### Secret 2: EC2_USERNAME
- **Name**: `EC2_USERNAME`
- **Value**: Your EC2 username (from Step 1.2)
- **Example**: `ubuntu` or `ec2-user`

### Secret 3: EC2_SSH_KEY
- **Name**: `EC2_SSH_KEY`
- **Value**: Your entire SSH private key (from Step 1.5)
- **Important**: Include the BEGIN and END lines
- **Example**:
  ```
  -----BEGIN RSA PRIVATE KEY-----
  MIIEpAIBAAKCAQEA...
  (entire key content)
  ...
  -----END RSA PRIVATE KEY-----
  ```

### Secret 4: EC2_PORT (Optional - defaults to 22)
- **Name**: `EC2_PORT`
- **Value**: SSH port number (from Step 1.3)
- **Example**: `22`
- **Note**: Only add this if your port is NOT 22

### Secret 5: EC2_DEPLOY_PATH (Optional - defaults to ~/Baselrpacrm)
- **Name**: `EC2_DEPLOY_PATH`
- **Value**: Full path to project on EC2 (from Step 1.4)
- **Example**: `/home/ubuntu/Baselrpacrm` or `~/Baselrpacrm`
- **Note**: Only add this if your path is NOT `~/Baselrpacrm`

---

## ✅ Step 3: Verify Setup

### Check Your Secrets
You should have these secrets configured:
- [ ] `EC2_HOST`
- [ ] `EC2_USERNAME`
- [ ] `EC2_SSH_KEY`
- [ ] `EC2_PORT` (optional)
- [ ] `EC2_DEPLOY_PATH` (optional)

### Test SSH Connection Locally
```bash
# Test that your SSH key works
ssh -i ~/.ssh/your-key.pem ubuntu@your-ec2-ip

# If this works, GitHub Actions will work too
```

---

## 🚀 Step 4: Test Deployment

1. **Make a small test change**:
   ```bash
   echo "# Test deployment" >> README.md
   git add README.md
   git commit -m "Test auto-deployment"
   git push origin main
   ```

2. **Check GitHub Actions**:
   - Go to your repo → **Actions** tab
   - You should see "Deploy to EC2" workflow running
   - Click on it to see deployment logs

3. **Verify on EC2**:
   ```bash
   ssh -i ~/.ssh/your-key.pem ubuntu@your-ec2-ip
   cd ~/Baselrpacrm
   git log -1  # Should show your test commit
   ```

---

## 🔍 Quick Reference: How to Get Each Value

### EC2_HOST
```bash
# Method 1: AWS Console
# EC2 → Instances → Your Instance → Public IPv4 address

# Method 2: If you're already connected
ssh -i your-key.pem ubuntu@your-ec2-ip
# The IP is what you use after @
```

### EC2_USERNAME
```bash
# Try these common ones:
# - ubuntu (most common for Ubuntu)
# - ec2-user (Amazon Linux)
# - admin (some AMIs)

# Or check your AMI documentation
```

### EC2_SSH_KEY
```bash
# Find your key file (usually .pem)
ls ~/.ssh/*.pem

# Get full content
cat ~/.ssh/your-key.pem

# Copy everything including BEGIN/END lines
```

### EC2_DEPLOY_PATH
```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@your-ec2-ip

# Find where your project is
pwd  # If you're in the project directory
# Or
find ~ -name "Baselrpacrm" -type d
```

---

## 🛠️ Troubleshooting

### "Permission denied (publickey)"
- ✅ Check `EC2_SSH_KEY` includes BEGIN/END lines
- ✅ Check `EC2_USERNAME` is correct (ubuntu vs ec2-user)
- ✅ Verify key file permissions locally: `chmod 400 your-key.pem`

### "Host key verification failed"
- This is usually fine, GitHub Actions handles it
- If persistent, the workflow will retry

### "Deployment succeeds but code not updated"
- ✅ Check `EC2_DEPLOY_PATH` is correct
- ✅ Verify git remote is configured on EC2
- ✅ Check branch name (main vs master)

---

## 📝 Template: Copy This to Fill Out

```
EC2_HOST: _________________
EC2_USERNAME: _________________
EC2_PORT: 22 (or _________________)
EC2_DEPLOY_PATH: ~/Baselrpacrm (or _________________)
EC2_SSH_KEY: 
-----BEGIN RSA PRIVATE KEY-----
[Paste here]
-----END RSA PRIVATE KEY-----
```

---

## ✅ Final Checklist

Before your first deployment:
- [ ] All 3 required secrets added (EC2_HOST, EC2_USERNAME, EC2_SSH_KEY)
- [ ] Optional secrets added if needed (EC2_PORT, EC2_DEPLOY_PATH)
- [ ] SSH connection tested locally
- [ ] Git remote configured on EC2
- [ ] Project path verified on EC2
- [ ] Ready to push and test!

---

Once you've added all the secrets, just push to `main` branch and watch the magic happen! 🚀
