# VNC Setup Guide - View Browser Automation Live

## ✅ VNC Server Setup Complete

VNC server is now installed and running on the Singapore server, allowing you to view the browser automation live.

## 🔌 How to Connect

### Step 1: Create SSH Tunnel

On your local machine, run:

```bash
ssh -L 5901:localhost:5901 -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
```

This creates a secure tunnel from your local port 5901 to the server's VNC port.

**Keep this terminal open** - the tunnel needs to stay active.

### Step 2: Connect with VNC Client

#### macOS (Built-in Screen Sharing)

1. Open **Finder**
2. Press `Cmd + K` (or Go → Connect to Server)
3. Enter: `vnc://localhost:5901`
4. Click **Connect**
5. Enter password: `password123`

#### Windows

1. Download **TightVNC Viewer** or **RealVNC Viewer**
2. Connect to: `localhost:5901`
3. Enter password: `password123`

#### Linux

1. Install VNC viewer:
   ```bash
   sudo apt-get install tigervnc-viewer  # Ubuntu/Debian
   ```
2. Connect:
   ```bash
   vncviewer localhost:5901
   ```
3. Enter password: `password123`

## 🖥️ What You'll See

Once connected, you'll see:
- XFCE desktop environment
- Terminal windows
- **Browser windows** when automation runs (visible in real-time!)

## 🚀 Running Tests with VNC

The test script automatically detects VNC and runs in headed mode:

```bash
# SSH into server
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216

# Run test (browser will be visible via VNC)
cd ~/Baselrpacrm
node src/examples/test-patient-78025.js
```

The browser will open in the VNC session, and you can watch it fill the form in real-time!

## 🔒 Change VNC Password

To change the VNC password:

```bash
ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
vncpasswd
```

## 🛠️ VNC Server Management

### Check Status
```bash
sudo systemctl status vncserver@1.service
```

### Restart VNC
```bash
sudo systemctl restart vncserver@1.service
```

### Stop VNC
```bash
sudo systemctl stop vncserver@1.service
```

### Start VNC
```bash
sudo systemctl start vncserver@1.service
```

## 📝 Notes

- **Default VNC Password**: `password123` (change it for security!)
- **Display**: `:1` (port 5901)
- **Resolution**: 1920x1080
- **Desktop**: XFCE (lightweight, fast)

## 🎯 Quick Start

1. **Terminal 1** - Create SSH tunnel:
   ```bash
   ssh -L 5901:localhost:5901 -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
   ```

2. **Terminal 2** - Connect VNC:
   - macOS: `open vnc://localhost:5901`
   - Or use your VNC client

3. **Terminal 3** - Run test:
   ```bash
   ssh -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216
   cd ~/Baselrpacrm
   node src/examples/test-patient-78025.js
   ```

4. **Watch the browser** fill the form in the VNC window! 🎉

## 🔍 Troubleshooting

### Can't connect to VNC

1. Check SSH tunnel is running (Terminal 1)
2. Verify VNC server is running:
   ```bash
   sudo systemctl status vncserver@1.service
   ```
3. Check firewall (should allow port 5901 via SSH tunnel)

### Browser not visible

1. Make sure `DISPLAY=:1` is set:
   ```bash
   export DISPLAY=:1
   ```
2. Check browser is running in headed mode (not headless)

### VNC connection is slow

- Reduce resolution in `setup-vnc-server.sh`
- Use a faster internet connection
- Close other applications on server

## ✅ You're All Set!

Now you can watch the browser automation fill forms in real-time via VNC! 🎬
