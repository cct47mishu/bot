#!/bin/bash
sudo chown -R $USER:$USER /home/ubuntu/bot
# Update system packages
sudo apt update && sudo apt upgrade -y
sudo apt install  nginx -y
# Install NVM (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

# Load NVM and install Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

nvm install 18

# Install required npm packages
npm i 
npm i ejs
# Install PM2 globally
 npm install pm2 -g

# Install Nginx


# Get the server's public IP address
SERVER_IP=$(curl -s ifconfig.me)

# Configure Nginx with the server's IP address
sudo bash -c "cat > /etc/nginx/sites-available/default" <<EOL
server {
    listen 80;

    server_name $SERVER_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOL

# Test Nginx configuration and reload
sudo nginx -t && sudo systemctl restart nginx

# Start your Node.js app with PM2
pm2 start gmaibot.js

# Auto-start PM2 on boot
pm2 startup systemd
pm2 save

echo "Setup complete. Your app is running on http://$SERVER_IP/"
