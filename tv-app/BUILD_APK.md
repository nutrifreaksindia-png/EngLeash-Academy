# Build TV app APK

You’ve been running in the Android emulator; these steps produce an APK you can install on a real TV or another device.

---

## Option 1: Android Studio (recommended)

1. **Open the TV app project**
   - Open Android Studio.
   - **File → Open** and choose the **`tv-app`** folder  
     (e.g. `EngLeash-Academy/tv-app`).
   - Wait for Gradle sync to finish.

2. **Build the APK**
   - **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
   - Wait for the build to complete. Android Studio will show a notification with **Locate** when it’s done.

3. **Find the APK**
   - Click **Locate** in the notification, or open this folder:
   - **`tv-app/app/build/outputs/apk/debug/app-debug.apk`**

4. **Install on a device**
   - Copy `app-debug.apk` to a USB drive (or use ADB over the network) and install on the TV.
   - On the TV: **Settings → Security** → allow installation from USB/file manager, then open the APK from the file manager and install.

---

## Option 2: Command line (after adding Gradle wrapper)

If you add a Gradle wrapper to the project (e.g. from Android Studio: run a Gradle sync once, then use **View → Tool Windows → Gradle**, or run any build from the IDE once), a `gradlew` script is created. Then from a terminal:

```bash
cd /path/to/EngLeash-Academy/tv-app
./gradlew assembleDebug
```

APK path: **`app/build/outputs/apk/debug/app-debug.apk`**.

---

## Release APK (for distribution)

- In Android Studio: **Build → Generate Signed Bundle / APK** → choose **APK** → create or pick a keystore and complete the wizard.
- Or with wrapper: `./gradlew assembleRelease` (output is unsigned unless you configure signing in `build.gradle.kts`).

For sideloading on your own TV, **app-debug.apk** is enough.
