# Testing the mobile app with Expo Go

**Expo SDK 54** – Use the version of Expo Go that matches SDK 54 (check in the app store / Expo Go splash).

Follow these steps to run the EngLeash Academy app in **Expo Go** on your phone.

---

## Prerequisites

- Backend is running (you already did step 1).
- **Expo Go** installed on your phone: [Android](https://play.google.com/store/apps/details?id=host.exp.exponent) | [iOS](https://apps.apple.com/app/expo-go/id982107779).
- Phone and computer on the **same Wi‑Fi network**.

---

## Step 1: Backend must be running

In a terminal:

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/backend
npm start
```

Leave this running. You should see: `EngLeash Academy API running on http://localhost:3001`.

---

## Step 2: Set the API URL for your phone (important)

The app on your phone must call your **computer’s IP** (not `localhost`).

1. Find your computer’s IP on the same Wi‑Fi as your phone:
   - **Mac:** System Settings → Network → Wi‑Fi → Details → IP (e.g. `192.168.1.5`).
   - Or in Terminal: `ipconfig getifaddr en0` (often `192.168.x.x`).
2. Open **`mobile-app/src/config.ts`**.
3. Set `DEV_API_HOST` to that IP (no `http://`, no port). The app uses port **3001** by default (see `DEV_API_PORT` in `src/config.ts` if you change the backend port):

   ```ts
   const DEV_API_HOST = '192.168.1.5'; // ← Your computer’s IP
   ```

4. Save the file.

---

## Step 3: Install dependencies (if you haven’t)

In a **new** terminal:

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
npm install
```

Wait until it finishes.

---

## Step 4: Start Expo

In the same terminal (inside `mobile-app`):

```bash
npx expo start
```

You should see a QR code and options in the terminal.

---

## Step 5: Open the app in Expo Go

- **Android:** Open the **Expo Go** app → “Scan QR code” → scan the QR from the terminal (or from the browser tab that opened).
- **iOS:** Open the **Camera** app → point at the QR code → tap the banner to open in Expo Go.

The app will load. If you see a connection error, check:

- Backend is still running (`npm start` in `backend`).
- `DEV_API_HOST` in `src/config.ts` is your computer’s IP.
- Phone and computer are on the same Wi‑Fi.

---

## Step 6: Log in and test

Use the seeded users:

| Role     | Email                  | Password    |
|----------|------------------------|-------------|
| Admin    | admin@engleash.com     | password123 |
| Trainer  | trainer@engleash.com   | password123 |
| Student  | student@engleash.com   | password123 |

1. Choose **Admin**, **Trainer**, or **Student** and sign in.
2. You should see **My Courses** (sample course if you ran `npm run seed`).
3. Tap **Browse course catalog** to see all courses and enroll.
4. Open a course → open a lesson (e.g. Day 01) → try **Lesson video**, **Class notes**, **Quiz**, **Worksheet**.

---

## Troubleshooting

| Problem | What to do |
|--------|-------------|
| “Network request failed” or can’t log in | Set `DEV_API_HOST` in `src/config.ts` to your computer’s IP and ensure backend is running. |
| QR code doesn’t open in Expo Go | Make sure Expo Go is installed and phone is on the same Wi‑Fi. |
| Video doesn’t play | Sample lessons may have placeholder video URLs. Upload a real video via the API or test with a public MP4 URL. |
| Metro bundler errors | In `mobile-app` run `npx expo start --clear` and try again. |

---

## Summary (copy‑paste)

```bash
# Terminal 1 – backend
cd /Users/manuelamalraj/Documents/EngLeash-Academy/backend
npm start

# Terminal 2 – app (after editing src/config.ts with your computer’s IP)
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
npm install
npx expo start
# Then scan the QR code with Expo Go on your phone.
```
