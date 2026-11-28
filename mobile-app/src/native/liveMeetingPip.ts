import { DeviceEventEmitter, EmitterSubscription, NativeModules, Platform } from 'react-native';

const NativePip = NativeModules.EngleashPip as 
  | { enterPip?: () => void; setAutoEnter?: (on: boolean) => void }
  | undefined;

export function enterMeetingPip(): void {
  if (Platform.OS === 'android') {
    NativePip?.enterPip?.();
  }
}

/** While on, pressing the device Home button minimizes into Picture-in-Picture. */
export function setMeetingPipAuto(on: boolean): void {
  if (Platform.OS === 'android') {
    NativePip?.setAutoEnter?.(on);
  }
}

export function subscribeMeetingPipMode(listener: (active: boolean) => void): EmitterSubscription {
  return DeviceEventEmitter.addListener('EngleashPipMode', (e: { active?: boolean }) => {
    listener(!!e?.active);
  });
}

/** Activity is finishing (e.g. PiP dismissed in a way that closes the task). */
export function subscribeMeetingPipClosed(listener: () => void): EmitterSubscription {
  return DeviceEventEmitter.addListener('EngleashPipClosed', () => {
    listener();
  });
}
