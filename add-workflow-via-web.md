# Add Workflow File via GitHub Web Interface

Since workflow files require special permissions, add it through GitHub's web interface:

## Quick Steps:

1. **Go to your repository**: https://github.com/teazle/baselcrm

2. **Click "Add file" → "Create new file"**

3. **Enter path**: `.github/workflows/deploy-to-ec2.yml`
   - GitHub will automatically create the `.github/workflows/` folders

4. **Paste this content** (copy the entire file below):

```yaml
name: Deploy to EC2

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch: # Allows manual trigger

jobs:
  deploy:
    name: Deploy to EC2
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USERNAME }}
          key: ${{ secrets.EC2_SSH_KEY }}
          port: ${{ secrets.EC2_PORT || 22 }}
          script: |
            cd ${{ secrets.EC2_DEPLOY_PATH || '~/Baselrpacrm' }}
            
            # Pull latest changes
            echo "📥 Pulling latest changes from Git..."
            git fetch origin
            git reset --hard origin/main || git reset --hard origin/master
            
            # Install/update dependencies if package.json changed
            echo "📦 Checking for dependency updates..."
            if git diff HEAD@{1} HEAD --name-only | grep -q "package.json\|package-lock.json"; then
              echo "📦 Installing/updating dependencies..."
              npm install
              npm run install-browsers
            fi
            
            # Restart PM2 processes if running
            if command -v pm2 &> /dev/null; then
              echo "🔄 Restarting PM2 processes..."
              pm2 restart all || true
            fi
            
            echo "✅ Deployment complete!"
            
            # Show current status
            echo "📊 Current status:"
            git log -1 --oneline
            if command -v pm2 &> /dev/null; then
              pm2 status
            fi
```

5. **Click "Commit new file"** (bottom of page)

6. **Done!** The workflow will now trigger on the next push, or you can manually trigger it from the Actions tab.

---

## After Adding:

1. Go to **Actions** tab
2. You should see "Deploy to EC2" workflow
3. Click "Run workflow" → "Run workflow" to test it immediately
4. Or just push any change to trigger it automatically

---

## Test It:

After adding the workflow file, you can test by:

```bash
# Make a small change
echo "# Test" >> README.md
git add README.md
git commit -m "Test deployment"
git push origin main
```

The workflow should automatically run!
