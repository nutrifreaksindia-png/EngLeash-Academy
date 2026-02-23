# Hostinger Setup Checklist – EngLeash Academy Backend

Use this list to create everything needed on Hostinger **before** backend development starts.

---

## 1. Domain / Subdomain

- [ ] Decide API base URL, e.g. `https://api.engleashacademy.com` or `https://academy.yourdomain.com`
- [ ] In Hostinger: create **subdomain** or point domain to your hosting
- [ ] Ensure **SSL (HTTPS)** is enabled (Let’s Encrypt or Hostinger SSL)

---

## 2. Hosting Type

- [ ] **Shared hosting:** Check if it supports **Node.js** (many shared plans are PHP-only)
- [ ] If Node.js not supported: use **VPS** or **Cloud** plan on Hostinger so you can run Node.js
- [ ] Note: PHP is possible for API too, but Node.js is assumed in the development plan

---

## 3. Database

- [ ] Create **MySQL** or **PostgreSQL** database in Hostinger panel
- [ ] Note down:
  - **Host** (e.g. `localhost` or `mysql.hostinger.xxx`)
  - **Database name**
  - **Username**
  - **Password**
- [ ] Keep these for backend `.env`; do not commit to git

---

## 4. Storage for Files

- [ ] Plan where to store:
  - **Lesson videos** (streaming; can be large)
  - **Class notes** (PDFs)
  - **Worksheets** (PDFs)
- [ ] Options:
  - **Same server:** e.g. folder `public/uploads/` or `storage/` served via API or nginx
  - **Hostinger File Manager:** upload via API to a dedicated folder; serve via URL
- [ ] Note the **base URL** for files (e.g. `https://api.engleashacademy.com/uploads/` or a separate subdomain)

---

## 5. Environment Variables (for backend)

When you build the backend, you will need at least:

| Variable   | Example                    | Description        |
|-----------|----------------------------|--------------------|
| `DB_HOST` | `localhost`                | Database host      |
| `DB_USER` | `u123_engleash`            | Database user      |
| `DB_PASSWORD` | `***`                  | Database password  |
| `DB_NAME` | `u123_academy`            | Database name      |
| `JWT_SECRET` | long random string     | Signing key for JWT |
| `API_URL` | `https://api.engleashacademy.com` | Public API base (for CORS / links) |
| `STORAGE_URL` | `https://api.engleashacademy.com/uploads` | Base URL for files |

- [ ] Generate a strong **JWT_SECRET** (e.g. 32+ random characters)
- [ ] In Hostinger: find where to set **environment variables** for your Node/PHP app (e.g. `.env` file or panel)

---

## 6. Node.js Version (if using Node)

- [ ] Check Hostinger panel for **Node.js version** (e.g. 18 or 20 LTS)
- [ ] Backend will be written to match this version

---

## 7. Summary – What You Need to Provide

Before starting backend development, have ready:

1. **API base URL** (e.g. `https://api.engleashacademy.com`)
2. **Database:** host, name, user, password
3. **JWT_SECRET** (generated and stored safely)
4. **Storage path / URL** for videos and PDFs
5. **SSL** confirmed working (HTTPS)

No code is required on Hostinger until the backend is built; then you will deploy the API and point the domain to it.
