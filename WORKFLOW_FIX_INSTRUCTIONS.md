# Fix Workflow File - Quick Instructions

The workflow file has been improved locally. Update it on GitHub:

## Option 1: Via GitHub Web Interface (Easiest)

1. Go to: https://github.com/teazle/baselcrm/blob/main/.github/workflows/deploy-to-ec2.yml
2. Click the **pencil icon** (✏️) to edit
3. **Replace the entire content** with the improved version below
4. Click **"Commit changes"**

## Option 2: The file is already updated locally

The fixed version is in: `.github/workflows/deploy-to-ec2.yml`

Just copy it to GitHub via the web interface.

---

## What Was Fixed:

✅ **Path expansion**: Properly expands `~` to home directory  
✅ **Error handling**: Checks if directory exists and is a git repo  
✅ **Git commands**: Better error handling for git operations  
✅ **Package detection**: Improved logic to detect package.json changes  
✅ **Status reporting**: Better output showing what's happening  

The workflow will now:
- Properly find your git repository
- Handle errors gracefully
- Show clearer status messages
- Work even if some git commands fail

---

## Test After Updating:

After you update the file, it will automatically trigger on the next push, or you can manually trigger it from the Actions tab.
