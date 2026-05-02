# Domain setup: engleashacademy.in for TV and mobile apps

Use one API subdomain for both apps, and optionally separate subdomains for TV/mobile (e.g. landing or future use).

---

## Recommended setup

| Subdomain | Purpose | Used by |
|-----------|---------|---------|
| **api.engleashacademy.in** | Backend API (Node server) | TV app + mobile app |
| **tv.engleashacademy.in** | Optional: same as API or TV landing page | — |
| **app.engleashacademy.in** | Optional: same as API or mobile landing page | — |

**Simplest:** Point **api.engleashacademy.in** to your server and use it in both apps. Use **tv.** and **app.** later for landing pages or redirects if you want.

---

## Step 1: DNS records

In your domain registrar (where you manage www.engleashacademy.in), add:

1. **API (required)**  
   - Type: **A** (or **CNAME** if your host gives you a hostname).  
   - Name: **api** (so it’s `api.engleashacademy.in`).  
   - Value: **your server’s public IP** (e.g. the one you use for `72.61.224.223` or your VPS IP).  
   - TTL: 300–3600.

2. **Optional – TV and app subdomains**  
   - **tv** → same IP as above.  
   - **app** → same IP as above.  

So you’ll have at least:

- `api.engleashacademy.in` → your server IP  
- (optional) `tv.engleashacademy.in` → same IP  
- (optional) `app.engleashacademy.in` → same IP  

Wait 5–30 minutes (or up to 48h) for DNS to propagate. Check with:

```bash
ping api.engleashacademy.in
```

---

## Step 2: Server – HTTPS with Nginx (reverse proxy)

Your Node app runs on the server (e.g. `localhost:3001`). Nginx will:

- Listen on **port 443 (HTTPS)** for `api.engleashacademy.in`.
- Terminate SSL (so the server has a certificate).
- Proxy requests to `http://127.0.0.1:3001`.

### 2.1 Install Nginx and Certbot (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2.2 Create Nginx config for the API

```bash
sudo nano /etc/nginx/sites-available/engleash-api
```

Paste (replace `api.engleashacademy.in` with your subdomain if different):

```nginx
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
```

Enable the site and test:

```bash
sudo ln -s /etc/nginx/sites-available/engleash-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 2.3 Get SSL certificate (Let’s Encrypt)

```bash
sudo certbot --nginx -d api.engleashacademy.in
```

Follow the prompts (email, agree to terms). Certbot will add HTTPS to the same server block and reload Nginx.

Optional (if you created tv/app subdomains):

```bash
sudo certbot --nginx -d api.engleashacademy.in -d tv.engleashacademy.in -d app.engleashacademy.in
```

### 2.4 Keep Node backend running

Your backend must listen on `localhost:3001` (or the port you proxy to). For example:

```bash
cd /path/to/EngLeash-Academy/backend
PORT=3001 node server.js
```

Or use PM2:

```bash
pm2 start server.js --name engleash-api
```

So in the end:

- **Browser/Apps** → `https://api.engleashacademy.in` (port 443) → **Nginx** → `http://127.0.0.1:3001` → **Node**.

---

## Step 3: Apps use the API URL

### TV app

- **Current:** `Api.kt` uses `http://72.61.224.223:3001`.
- **Change to:** `https://api.engleashacademy.in` (no port; 443 is default for HTTPS).

After changing, rebuild the APK so the TV app uses the new URL.

### Mobile app

- **Already set:** In production (`!__DEV__`) it uses `https://api.engleashacademy.in` (see `mobile-app/src/config.ts`).
- No code change needed; ensure you build/release with production config so `__DEV__` is false.

---

## Step 4: Optional – use tv.* and app.* for the same API

If you want the TV app to call **tv.engleashacademy.in** and the mobile app **app.engleashacademy.in** (both still serving the same backend):

1. **DNS:** Point `tv` and `app` to the same server IP (already in Step 1).
2. **Nginx:** Add two more server blocks (or one block with two `server_name`s) that proxy to `http://127.0.0.1:3001`, and run Certbot for `tv.engleashacademy.in` and `app.engleashacademy.in`.
3. **TV app:** Set BASE to `https://tv.engleashacademy.in`.
4. **Mobile app:** Set production `API_BASE` to `https://app.engleashacademy.in`.

Functionally it’s the same API; the subdomains are just different URLs. Many apps use a single **api.** subdomain for both.

---

## Checklist

- [ ] DNS: `api.engleashacademy.in` → your server IP (and optionally tv/app).
- [ ] Nginx installed and config for `api.engleashacademy.in` proxying to `127.0.0.1:3001`.
- [ ] Certbot run for `api.engleashacademy.in` (HTTPS).
- [ ] Node backend running on port 3001 (e.g. PM2).
- [ ] TV app: BASE URL updated to `https://api.engleashacademy.in`, APK rebuilt.
- [ ] Mobile app: already uses `https://api.engleashacademy.in` in production.

---

## Quick test

```bash
curl -I https://api.engleashacademy.in/api/health
```

You should get `200 OK` (and your backend’s JSON if you hit the right route).
