#!/usr/bin/env bash
# Capture Android logs useful for Expo dev client + React Native + native crashes.
# Usage: from mobile-app: npm run logs:android
# Requires a device/emulator: adb devices

set -euo pipefail
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
if [[ ! -x "$ADB" ]]; then
  echo "adb not found at $ADB"
  echo "Set ANDROID_HOME or install Android SDK Platform-Tools."
  exit 1
fi

echo "== adb devices =="
"$ADB" devices -l
echo ""
echo "== Recent log lines (errors / RN / your app / Agora) =="
# -d dump and exit; last ~1200 lines then filter (logcat -t is line count from tail)
"$ADB" logcat -d -t 1200 2>/dev/null | grep -iE \
  "AndroidRuntime|ReactNativeJS|ReactNative|FATAL|engleash|expo\.|ExpoModules|Invariant Violation|TypeError|ReferenceError|agora|RtcEngine|iris_|SoLoader|UnsatisfiedLinkError|JNI" \
  | tail -150 || true
echo ""
echo "Tip: reproduce the crash, then run this script again (or use: $ADB logcat -c && $ADB logcat -v time)"
