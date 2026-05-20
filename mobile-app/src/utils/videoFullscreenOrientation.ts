import { allowLandscapeForMedia, lockAppPortrait } from './appScreenOrientation';

/** Values from expo-av `FullscreenUpdate` (stable across SDK 50+). */
const FS_PLAYER_WILL_PRESENT = 0;
const FS_PLAYER_DID_PRESENT = 1;
const FS_PLAYER_WILL_DISMISS = 2;
const FS_PLAYER_DID_DISMISS = 3;

export type VideoFullscreenListener = (active: boolean) => void;

/**
 * Keeps the app portrait except while native fullscreen playback is active.
 * Returns whether fullscreen is (or will be) active after this event.
 */
export async function applyVideoFullscreenOrientation(
  fullscreenUpdate: number,
  onChange?: VideoFullscreenListener,
): Promise<boolean> {
  if (
    fullscreenUpdate === FS_PLAYER_WILL_PRESENT ||
    fullscreenUpdate === FS_PLAYER_DID_PRESENT
  ) {
    await allowLandscapeForMedia();
    onChange?.(true);
    return true;
  }
  if (
    fullscreenUpdate === FS_PLAYER_WILL_DISMISS ||
    fullscreenUpdate === FS_PLAYER_DID_DISMISS
  ) {
    await lockAppPortrait();
    onChange?.(false);
    return false;
  }
  return false;
}
