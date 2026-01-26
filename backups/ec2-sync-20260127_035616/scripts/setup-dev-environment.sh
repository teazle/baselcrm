#!/bin/bash

# Setup development environment on Singapore server
# This sets up VS Code Server and VNC for remote development

set -e

echo "=== Setting Up Development Environment ==="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Install VS Code Server
echo -e "${YELLOW}Installing VS Code Server...${NC}"
curl -fsSL https://code-server.dev/install.sh | sh

# Install VNC Server
echo -e "${YELLOW}Installing VNC Server...${NC}"
sudo apt update
sudo apt install -y ubuntu-desktop-minimal
sudo apt install -y tigervnc-standalone-server tigervnc-common

# Install XFCE (lighter desktop for VNC)
sudo apt install -y xfce4 xfce4-goodies

# Set up VNC
echo -e "${YELLOW}Setting up VNC...${NC}"
mkdir -p ~/.vnc

# Create VNC startup script
cat > ~/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
/etc/X11/xinit/xinitrc
[ -x /etc/vnc/xstartup ] && exec /etc/vnc/xstartup
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
x-window-manager &
startxfce4 &
EOF

chmod +x ~/.vnc/xstartup

# Set VNC password
echo ""
echo -e "${YELLOW}Setting VNC password...${NC}"
echo "You will be prompted to set a VNC password (for remote desktop access)"
vncserver :1 -geometry 1920x1080

# Create systemd service for code-server
echo -e "${YELLOW}Creating code-server service...${NC}"
sudo tee /etc/systemd/system/code-server.service > /dev/null << EOF
[Unit]
Description=code-server
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080 --auth password
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Start code-server service
sudo systemctl enable code-server
sudo systemctl start code-server

# Get code-server password
CODE_PASSWORD=$(cat ~/.config/code-server/config.yaml | grep password: | awk '{print $2}')

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "VS Code Server:"
echo "  URL: http://$(hostname -I | awk '{print $1}'):8080"
echo "  Password: $CODE_PASSWORD"
echo ""
echo "VNC Server:"
echo "  Connect to: $(hostname -I | awk '{print $1}'):5901"
echo "  Use VNC viewer on your local machine"
echo ""
echo "To start VNC manually:"
echo "  vncserver :1 -geometry 1920x1080"
echo ""
echo "To stop VNC:"
echo "  vncserver -kill :1"
echo ""
echo "Security Note:"
echo "  - Use SSH tunnel for VS Code: ssh -L 8080:localhost:8080 user@server"
echo "  - Use SSH tunnel for VNC: ssh -L 5901:localhost:5901 user@server"
echo "  - Then connect to localhost:8080 (VS Code) or localhost:5901 (VNC)"
