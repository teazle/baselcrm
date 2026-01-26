#!/bin/bash

# Setup VNC Server for remote desktop access
# This allows viewing the browser automation live

set -e

echo "=== Setting up VNC Server ==="

# Update package list
sudo apt-get update -y

# Install VNC server and desktop environment
echo "Installing VNC server and XFCE desktop..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    tigervnc-standalone-server \
    tigervnc-common \
    xfce4 \
    xfce4-goodies \
    firefox \
    dbus-x11

# Create VNC directory
mkdir -p ~/.vnc

# Set VNC password (default: password123)
# User can change this later with: vncpasswd
echo "Setting VNC password..."
echo "password123" | vncpasswd -f > ~/.vnc/passwd
chmod 600 ~/.vnc/passwd

# Create VNC startup script
cat > ~/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
x-window-manager &
startxfce4 &
EOF

chmod +x ~/.vnc/xstartup

# Kill any existing VNC server
vncserver -kill :1 2>/dev/null || true

# Start VNC server on display :1 (port 5901)
echo "Starting VNC server on display :1 (port 5901)..."
vncserver :1 -geometry 1920x1080 -depth 24

# Create systemd service for auto-start
echo "Creating systemd service for VNC..."
sudo tee /etc/systemd/system/vncserver@.service > /dev/null << 'EOF'
[Unit]
Description=Start TigerVNC server at startup
After=syslog.target network.target

[Service]
Type=forking
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu

ExecStartPre=/bin/sh -c '/usr/bin/vncserver -kill :%i > /dev/null 2>&1 || :'
ExecStart=/usr/bin/vncserver :%i -geometry 1920x1080 -depth 24
ExecStop=/usr/bin/vncserver -kill :%i

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable vncserver@1.service
sudo systemctl start vncserver@1.service

# Check VNC status
echo ""
echo "=== VNC Server Status ==="
sudo systemctl status vncserver@1.service --no-pager | head -10

echo ""
echo "=== VNC Setup Complete ==="
echo ""
echo "VNC Server is running on display :1 (port 5901)"
echo ""
echo "To connect from your local machine:"
echo "1. Create SSH tunnel:"
echo "   ssh -L 5901:localhost:5901 -i ~/.ssh/baselrpa-singapore-key.pem ubuntu@54.169.85.216"
echo ""
echo "2. Connect with VNC client:"
echo "   - macOS: Use built-in Screen Sharing (vnc://localhost:5901)"
echo "   - Windows: Use TightVNC or RealVNC Viewer"
echo "   - Linux: Use Remmina or TigerVNC Viewer"
echo ""
echo "VNC Password: password123"
echo "(Change it with: vncpasswd)"
echo ""
echo "To view browser automation:"
echo "1. SSH into server"
echo "2. Set DISPLAY=:1"
echo "3. Run your test script"
echo ""
