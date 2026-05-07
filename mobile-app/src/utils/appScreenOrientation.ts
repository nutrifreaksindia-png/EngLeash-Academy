import * as ScreenOrientation from 'expo-screen-orientation';

/** Portrait-only for normal app screens. */
export async function lockAppPortrait(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    // Unsupported or already locked
  }
}

/** Allow sensor-driven rotation (portrait + landscape) for video and live class. */
export async function allowLandscapeForMedia(): Promise<void> {
  try {
    await ScreenOrientation.unlockAsync();
  } catch {
    // ignore
  }
}

/** Lock landscape for live classroom (preview + call). */
export async function lockLandscapeForLive(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
  } catch {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {
      await allowLandscapeForMedia();
    }
  }
}
