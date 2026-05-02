#!/bin/bash
# Run as root on the server (72.61.224.223). No prompts.

set -e
DOMAIN="api.engleashacademy.in"

echo "=== Installing Nginx and Certbot ==="
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "=== Creating Nginx config for $DOMAIN ==="
cat > /etc/nginx/sites-available/engleash-api << 'NGINX_EOF'
server {
    listen 80;
    server_name api.engleashacademy.in;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_EOF

echo "=== Enabling site and reloading Nginx ==="
ln -sf /etc/nginx/sites-available/engleash-api /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

echo "=== Getting SSL certificate ==="
certbot --nginx -d api.engleashacademy.in --non-interactive --agree-tos --register-unsafely-without-email

echo "=== Done ==="
echo "Test: curl -I https://api.engleashacademy.in/api/health"
