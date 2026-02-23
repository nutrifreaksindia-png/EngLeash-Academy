# EngLeash Academy – Step-by-step (no coding needed)

Do these steps **in order**. You already have the backend running and did `npm install` in the app.

---

## Step 1: Find your computer’s IP address

On your Mac, open **Terminal** (search “Terminal” in Spotlight) and run:

```bash
ipconfig getifaddr en0
```

You’ll see something like **192.168.1.5** or **10.0.0.12**.  
**Write this number down** (you’ll need it in Step 2).

If that command shows nothing, try:

```bash
ipconfig getifaddr en1
```

Use whichever command gives you a number.

---

## Step 2: Set your IP in the app (one small edit)

1. On your Mac, open **Finder**.
2. Go to: **Documents** → **EngLeash-Academy** → **mobile-app** → **src**.
3. Double‑click the file **config.ts** (it will open in TextEdit or your editor).
4. Find this line (near the top):
   ```ts
   const DEV_API_HOST = '192.168.1.5';
   ```
5. **Replace** `192.168.1.5` with **the number you wrote down in Step 1** (your IP).  
   Keep the quotes. Example if your IP is 10.0.0.12:
   ```ts
   const DEV_API_HOST = '10.0.0.12';
   ```
6. **Save** the file (Cmd+S) and close it.

---

## Step 3: Install Expo Go on your phone

- **iPhone:** App Store → search **Expo Go** → Install.
- **Android:** Play Store → search **Expo Go** → Install.

Make sure your phone is on the **same Wi‑Fi** as your Mac.

---

## Step 4: Start the app (Expo) on your Mac

1. Leave the backend running in the first Terminal window (the one that says “EngLeash Academy API running on http://localhost:3001”). **Do not close it.**
2. Open a **new** Terminal window (File → New Window, or Cmd+N).
3. Run these two commands **one after the other** (copy and paste, then press Enter each time):

```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
```

Press **Enter**. Then:

```bash
npx expo start
```

Press **Enter**.

4. Wait until you see a **QR code** in the Terminal (and maybe a browser tab opens too). Leave this window open.

---

## Step 5: Open the app on your phone

- **iPhone:**  
  Open the **Camera** app → point it at the **QR code** on your Mac → tap the notification that appears → the app will open in **Expo Go**.

- **Android:**  
  Open the **Expo Go** app → tap **“Scan QR code”** → point at the **QR code** on your Mac.

The EngLeash Academy app should load on your phone.

---

## Step 6: Log in

On the app screen:

1. Choose a role: **Admin**, **Trainer**, or **Student**.
2. **Email:** `admin@engleash.com` (or `trainer@engleash.com` or `student@engleash.com`).
3. **Password:** `password123`
4. Tap **Sign In**.

You should see the home screen with “My Courses”.

---

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| “Network request failed” or can’t log in | Check Step 2: the IP in **config.ts** must be your Mac’s IP from Step 1. Phone and Mac must be on the same Wi‑Fi. Make sure the backend is still running (Step 4 note). |
| QR code doesn’t work | Confirm Expo Go is installed. Try typing the URL shown under the QR code into Expo Go’s “Enter URL” field. |
| “Unable to resolve module” or red error screen | In Terminal (in the mobile-app folder) run: `npx expo start --clear` then scan the QR code again. |

---

## Quick command list (for reference)

**Terminal 1 (backend – keep running):**
```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/backend
npm start
```

**Terminal 2 (start the app for your phone):**
```bash
cd /Users/manuelamalraj/Documents/EngLeash-Academy/mobile-app
npx expo start
```
Then scan the QR code with your phone.
