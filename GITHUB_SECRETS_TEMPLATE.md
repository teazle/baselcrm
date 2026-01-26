# GitHub Secrets - Fill This Out

Copy the values below and add them to GitHub → Settings → Secrets and variables → Actions

---

## Required Secrets (Must Add All 3)

### 1. EC2_HOST
**Secret Name**: `EC2_HOST`
**Value**: Your EC2 public IP address or domain
**How to get it**: 
- AWS Console → EC2 → Your Instance → Public IPv4 address
- Or if you already SSH: `ssh ubuntu@[THIS_IS_YOUR_IP]`

**Your value**: `_________________`


---

### 2. EC2_USERNAME  
**Secret Name**: `EC2_USERNAME`
**Value**: Your EC2 username (usually `ubuntu` or `ec2-user`)
**How to get it**: 
- Usually `ubuntu` for Ubuntu instances
- Usually `ec2-user` for Amazon Linux
- Check what you use when SSH: `ssh [THIS_IS_USERNAME]@your-ip`

**Your value**: `_________________`


---

### 3. EC2_SSH_KEY
**Secret Name**: `EC2_SSH_KEY`
**Value**: Your entire SSH private key (the .pem file content)
**How to get it**: 
```bash
# On your local machine, run:
cat ~/.ssh/your-key.pem

# Copy EVERYTHING including these lines:
# -----BEGIN RSA PRIVATE KEY-----
# ... (all content) ...
# -----END RSA PRIVATE KEY-----
```

**Your value**: 
```
-----BEGIN RSA PRIVATE KEY-----
[PASTE YOUR ENTIRE KEY HERE - INCLUDING BEGIN AND END LINES]
-----END RSA PRIVATE KEY-----
```


---

## Optional Secrets (Only Add If Different From Default)

### 4. EC2_PORT (Optional)
**Secret Name**: `EC2_PORT`
**Value**: SSH port (default is 22)
**Only add if**: Your SSH port is NOT 22

**Your value**: `22` (or `_________________` if different)


---

### 5. EC2_DEPLOY_PATH (Optional)
**Secret Name**: `EC2_DEPLOY_PATH`
**Value**: Full path to your project on EC2
**Default**: `~/Baselrpacrm` (so you don't need this if that's your path)
**Only add if**: Your project is in a different location

**Your value**: `~/Baselrpacrm` (or `_________________` if different)


---

## Quick Steps to Add Secrets

1. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions`
2. Click **"New repository secret"** for each secret above
3. Copy the **Secret Name** and **Value** from above
4. Click **"Add secret"**
5. Repeat for all 3 required secrets

---

## After Adding Secrets

1. Make a test commit and push:
   ```bash
   git add .
   git commit -m "Test auto-deployment"
   git push origin main
   ```

2. Check GitHub Actions:
   - Go to **Actions** tab in your repo
   - You should see "Deploy to EC2" workflow running
   - Click to see logs

3. Done! 🎉
