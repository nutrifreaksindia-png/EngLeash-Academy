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
