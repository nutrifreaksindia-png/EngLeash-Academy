# Deploy steps – Session & back-button changes

Follow these in order. All paths are from the **EngLeash-Academy** project root.

---

## 1. Backend

### 1.1 Open a terminal and go to the backend

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/backend
```

### 1.2 (Optional) Create the `sessions` table via init script

Only needed if you want the table created by the init script. The server also creates it on start (see 1.4).

```bash
npm run init-db
```

You should see: `Database initialized at .../backend/data/academy.db`

### 1.3 Stop the running Node server (if it’s already running)

- If you started it in a terminal: press **Ctrl+C** in that terminal.
- If it runs under PM2 or another process manager: stop it there (e.g. `pm2 stop engleash-api` or your app name).

### 1.4 Install dependencies (if you haven’t already)

```bash
npm install
```

### 1.5 Start the backend

**Development (foreground):**

```bash
npm start
```

Or:

```bash
node server.js
```

You should see: `EngLeash Academy API running on http://localhost:3001`

**Production (example with PM2):**

```bash
pm2 start server.js --name engleash-api
```

Keep this terminal open if you’re running in the foreground. The `sessions` table is created automatically on server start if it doesn’t exist.

---

## 2. TV app (Android TV)

### 2.1 Open a terminal and go to the TV app

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/tv-app
```

### 2.2 Clean and build

If you have Gradle wrapper (e.g. from Android Studio):

```bash
./gradlew clean
./gradlew assembleDebug
```

If you don’t have `gradlew`, use **Android Studio**:

1. **File → Open** → select the `tv-app` folder.
2. **Build → Clean Project**.
3. **Build → Rebuild Project**.

### 2.3 Install on device or emulator

**From command line (device/emulator connected):**

```bash
./gradlew installDebug
```

**From Android Studio:**

1. Select your TV device or TV emulator in the device dropdown.
2. Click **Run** (green play) or **Run → Run 'app'**.

The app will install and launch. Log in and test: back from Courses should not log you out; only **Log out** should.

### 2.4 Get the APK file (for distribution or sideloading)

**Debug APK** (quick to build, for testing):

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/tv-app
./gradlew assembleDebug
```

APK location: `tv-app/app/build/outputs/apk/debug/app-debug.apk`

**Release APK** (for distribution; you can sign it later):

```bash
./gradlew assembleRelease
```

APK location: `tv-app/app/build/outputs/apk/release/app-release-unsigned.apk`

Copy the APK to a USB drive or share it; install on the TV via **Settings → Security → Install unknown apps** (or your TV’s file manager), or use `adb install app-debug.apk` with the TV on the same network.

---

## 3. Backend content → TV app (and mobile app)

Courses, course names, and lesson videos are **loaded from the backend**. When you:

- Add or remove courses
- Change course names or descriptions
- Add or edit lessons and upload lesson videos

…the TV app (and mobile app) will show the updated content **the next time** they load that screen (e.g. open Courses or a course’s lessons). No app update is required. Ensure the backend is running and reachable at the URL configured in the TV app (see `tv-app/.../Api.kt`: `BASE = "http://72.61.224.223:3001"`). If you move the API to another host/port, update that constant and rebuild the APK.

---

## 4. Mobile app (Expo / React Native)

### 4.1 Open a terminal and go to the mobile app

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
```

### 4.2 Install dependencies (if needed)

```bash
npm install
```

### 4.3 Start the Metro bundler (dev server)

In this terminal:

```bash
npm start
```

Or:

```bash
npx expo start --port 8082
```

Leave this running.

### 4.4 Run on a device or simulator

**Option A – Same terminal after `npm start`:**

- Press **`a`** for Android emulator.
- Press **`i`** for iOS simulator (Mac only).

**Option B – New terminal (with Metro already running):**

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
npm run android
```

or

```bash
npm run ios
```

**Option C – Physical device:**

1. Install **Expo Go** on your phone.
2. Ensure phone and Mac are on the same Wi‑Fi.
3. After `npm start`, scan the QR code with the Expo Go app (Android) or Camera (iOS).

The app will load. Test login, “Already logged in on another device” dialog, and that 401 session-replaced sends you back to login.

---

## Quick checklist

| Step | Where | Command / action |
|------|--------|-------------------|
| 1 | Backend | `cd backend` → (optional) `npm run init-db` → stop old server → `npm start` |
| 2 | TV app | `cd tv-app` → `./gradlew clean assembleDebug` → `./gradlew installDebug` (or build/run in Android Studio) |
| 3 | Mobile app | `cd mobile-app` → `npm install` → `npm start` → press `a` or `i` or scan QR |

---

## If something fails

- **Backend:** Ensure port `3001` is free and `backend/data` exists (created automatically). Check `backend/.env` if you use env vars (e.g. `JWT_SECRET`, `PORT`).
- **TV app:** Ensure `ANDROID_HOME` is set and a TV device/emulator is connected. If you only use Android Studio, do Clean + Rebuild and Run from there.
- **Mobile app:** If Metro fails, try `npx expo start --clear`. For “Unable to resolve module”, run `npm install` again.
