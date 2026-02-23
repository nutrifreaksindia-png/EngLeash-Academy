# EngLeash Academy – Mobile & TV Apps

**EngLeash Academy** – Android app, Android TV app (Lab), and Node.js backend.  
iOS deferred.

---

## Project structure

```
EngLeash-Academy/
├── backend/          # Node.js API (SQLite dev; ready for Hostinger/MySQL)
├── mobile-app/       # React Native Android app (Admin, Trainer, Student)
├── tv-app/           # Kotlin Android TV app (Lab only – video lessons)
├── REQUIREMENTS.md
├── DEVELOPMENT_PLAN.md
└── HOSTINGER_SETUP.md
```

---

## Quick start (local)

### 1. Backend

```bash
cd backend
npm install
npm run init-db    # create DB and tables
npm run seed       # seed users + sample course (optional)
npm start          # http://localhost:3000
```

**Test users (after seed):**

| Role    | Email                 | Password   |
|--------|-----------------------|------------|
| Admin  | admin@engleash.com    | password123 |
| Trainer| trainer@engleash.com  | password123 |
| Student| student@engleash.com  | password123 |
| Lab (TV)| lab@engleash.com    | password123 |

### 2. Android mobile app

- **API URL:** In `mobile-app/src/config.ts`, `API_BASE` is `http://10.0.2.2:3000` for Android emulator. For a real device, use your machine’s IP (e.g. `http://192.168.1.x:3000`).
- Run:
  ```bash
  cd mobile-app
  npm install
  npx react-native start
  # In another terminal:
  npx react-native run-android
  ```
- Log in as Admin / Trainer / Student. Browse courses, enroll, open lessons, watch video (stream only for Trainer/Student), view/download notes and worksheets, take quizzes.

### 3. Android TV app (Lab)

- **API URL:** In `tv-app/app/src/main/java/com/engleash/academy/tv/Api.kt`, set `BASE` to your backend URL (e.g. `http://10.0.2.2:3000` for emulator, or your host IP for a real TV/device).
- Open `tv-app` in **Android Studio** and run on an Android TV emulator or TV device.
- Log in as **Lab** only. You’ll see enrolled courses → lessons → video playback only (no notes, quizzes, worksheets).

---

## Branding assets

Copy into the apps when you’re ready:

- **Logo:** `/Users/manuelamalraj/Work/EA/Images/WhatsApp Image 2025-05-07 at 12.01.54.jpeg`  
  → Use in splash/headers (e.g. `mobile-app/assets/`, `tv-app/res/drawable/`).
- **Icon:** `/Users/manuelamalraj/Work/EA/Images/EngLeash Academy Favicon.png`  
  → Use as app icon (mobile + TV).

---

## Docs

1. **[REQUIREMENTS.md](./REQUIREMENTS.md)** – Roles, flows, content types, restrictions.
2. **[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)** – Phases and implementation order.
3. **[HOSTINGER_SETUP.md](./HOSTINGER_SETUP.md)** – What to set up on Hostinger before deploying the API.

---

## Deploying to Hostinger

1. Complete [HOSTINGER_SETUP.md](./HOSTINGER_SETUP.md) (domain, DB, SSL, storage).
2. In `backend`, add a `.env` with `PORT`, `JWT_SECRET`, `API_URL`, `STORAGE_URL`, and (if you switch) MySQL vars.
3. Upload the backend (e.g. Git deploy or FTP), run `npm install --production`, `npm run init-db` (if using SQLite there), then start the app (e.g. `node server.js` or PM2).
4. In **mobile-app** and **tv-app**, set the API base URL to your Hostinger API (e.g. `https://api.engleashacademy.com`).
5. Rebuild and test the Android and TV apps against the live API.
