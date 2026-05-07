package com.engleashacademy

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class EngleashPipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "EngleashPip"

  @ReactMethod
  fun enterPip() {
    val activity = getReactApplicationContext().getCurrentActivity() ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (!activity.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
      return
    }
    try {
      val params =
        PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 9))
          .build()
      activity.enterPictureInPictureMode(params)
    } catch (_: Exception) {
      // ignore
    }
  }
}
