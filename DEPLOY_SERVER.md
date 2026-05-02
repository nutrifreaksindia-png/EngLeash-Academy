# Deploy EngLeash Academy backend on your server

Use this guide after you SSH into your server (e.g. `ssh root@72.61.224.223`). All commands below are meant to be run **on the server** unless noted.

---

## 1. Install Node.js on the server

```bash
# Option A: Using NodeSource (recommended, LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Option B: If you already have Node 18+:
node -v   # should show v18 or v20
```

---

## 2. Create a folder for the backend

```bash
mkdir -p /var/www/engleash-academy
cd /var/www/engleash-academy
```

---

## 3. Copy the backend code to the server

**From your Mac** (in a new terminal, not on the server), run:

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy
scp -r backend/* root@72.61.224.223:/var/www/engleash-academy/
```

Or, if the project is in a Git repo, **on the server** you can instead:

```bash
cd /var/www/engleash-academy
git clone <your-repo-url> .
# then copy only the backend folder contents into /var/www/engleash-academy
```

Make sure the server has these under `/var/www/engleash-academy/`:
- `server.js`
- `db.js`
- `upload.js`
- `package.json`
- `routes/`
- `middleware/`
- `scripts/`

---

## 4. Create the `.env` file on the server

**On the server:**

```bash
cd /var/www/engleash-academy
nano .env
```

Paste the following and **edit** the values:

```env
PORT=3001
JWT_SECRET=put-a-long-random-secret-here-at-least-32-characters
API_URL=http://72.61.224.223:3001
STORAGE_URL=http://72.61.224.223:3001/uploads
```

- Replace `72.61.224.223` with your **domain** if you have one (e.g. `https://api.engleashacademy.in`), and use `https` if you set up SSL.
- For `JWT_SECRET`, use a long random string (e.g. run `openssl rand -base64 32` and paste the result).

Save and exit (Ctrl+O, Enter, Ctrl+X in nano).

---

## 5. Install dependencies and set up the database

**On the server:**

```bash
cd /var/www/engleash-academy
npm install --production
npm run init-db
npm run seed
```

- `init-db` creates the SQLite database and tables.
- `seed` creates test users (admin@engleash.com, trainer@engleash.com, student@engleash.com, lab@engleash.com, all with password `password123`). Change or remove seed after first use if you prefer.

---

## 6. Run the backend (and keep it running with PM2)

**Install PM2 (keeps the API running after you disconnect):**

```bash
npm install -g pm2
```

**Start the API:**

```bash
cd /var/www/engleash-academy
pm2 start server.js --name engleash-api
pm2 save
pm2 startup
```

Follow the command `pm2 startup` prints (run it as root if needed). Then the API will restart on server reboot.

**Useful PM2 commands:**

```bash
pm2 status          # see if engleash-api is running
pm2 logs engleash-api   # view logs
pm2 restart engleash-api   # restart after you change code or .env
```

---

## 7. Open the API port in the firewall

**On the server:**

```bash
# If using ufw:
ufw allow 3001/tcp
ufw reload

# If using firewalld:
firewall-cmd --permanent --add-port=3001/tcp
firewall-cmd --reload
```

If your server is behind a hosting panel (e.g. Hostinger), open port **3001** there as well.

---

## 8. Test the API

From your Mac (or any machine):

```bash
curl http://72.61.224.223:3001/api/health
```

You should get: `{"ok":true}`.

---

## 9. Upload lesson videos

Videos are stored in `/var/www/engleash-academy/uploads/` on the server. You can add them in two ways.

### Option A: Upload via API (recommended)

1. **Get an Admin token** – from your Mac or Postman:

   ```bash
   curl -X POST http://72.61.224.223:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@engleash.com","password":"password123","role":"Admin"}'
   ```

   Copy the `token` from the response.

2. **Upload a video for a lesson** (replace `YOUR_TOKEN` and `LESSON_ID`):

   ```bash
   curl -X POST http://72.61.224.223:3001/api/uploads/lesson/1/video \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -F "file=@/path/on/your/mac/to/your-video.mp4"
   ```

   Use lesson id `1` for Day 01, `2` for Day 02, etc. (from the seed data).

### Option B: Copy video files to the server, then point lessons to them

1. **From your Mac**, copy a video to the server:

   ```bash
   scp /path/to/your/lesson-video.mp4 root@72.61.224.223:/var/www/engleash-academy/uploads/lesson-1.mp4
   ```

2. **On the server**, update the database so the lesson uses this file:

   ```bash
   cd /var/www/engleash-academy
   node -e "
   const db = require('./db.js');
   db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run('/uploads/lesson-1.mp4', 1);
   console.log('Lesson 1 video_url updated');
   "
   ```

   Use lesson id `1`, `2`, `3` for Day 01, Day 02, Day 03. Then restart the API if needed: `pm2 restart engleash-api`.

---

## 10. Point the mobile app to your server

On your Mac, edit the mobile app config:

- **File:** `EngLeash-Academy/mobile-app/src/config.ts`
- Set the production API base URL. For example, if using the IP:

  - Change the production URL from `https://api.engleashacademy.in` to `http://72.61.224.223:3001`,  
  **or**
  - If you later use a domain and HTTPS, set it to `https://your-domain.com`.

Then rebuild or restart Expo and test the app against the server.

---

## Quick reference – server commands

| Task | Command (on server) |
|------|----------------------|
| Go to app folder | `cd /var/www/engleash-academy` |
| Restart API | `pm2 restart engleash-api` |
| View logs | `pm2 logs engleash-api` |
| Status | `pm2 status` |

---

## Optional: Use a domain and HTTPS

If you have a domain (e.g. `api.engleashacademy.in`) pointing to `72.61.224.223`:

1. Install Nginx and a certificate (e.g. Certbot for Let’s Encrypt).
2. Configure Nginx as a reverse proxy to `http://127.0.0.1:3001`.
3. In `.env` set `API_URL=https://api.engleashacademy.in` and `STORAGE_URL=https://api.engleashacademy.in/uploads`.
4. Restart the API: `pm2 restart engleash-api`.

Then use `https://api.engleashacademy.in` in the mobile app config for production.
