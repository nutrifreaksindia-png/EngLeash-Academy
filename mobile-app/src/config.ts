import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

// Canonical hosted backend for production and optional remote-dev mode.
const PROD_API_BASE = 'https://api.engleashacademy.com';

/**
 * Prefer EXPO_PUBLIC_API_BASE for explicit control in both dev and prod builds.
 * Fallback keeps local dev working when only host/port are provided.
 */
const EXPLICIT_API_BASE = process.env.EXPO_PUBLIC_API_BASE?.trim();
/** Optional override; do not default to a random LAN IP — wrong IP causes silent timeouts. */
const DEV_API_HOST_OVERRIDE = process.env.EXPO_PUBLIC_DEV_API_HOST?.trim();
const DEV_API_PORT = Number(process.env.EXPO_PUBLIC_DEV_API_PORT || 3001);
const USE_REMOTE_API_IN_DEV = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.EXPO_PUBLIC_USE_REMOTE_API || '').toLowerCase()
);

function hostFromExpoDev(): string | null {
  const raw = Constants.expoConfig?.hostUri?.trim();
  if (!raw) return null;
  const host = raw.split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

function hostFromMetroBundle(): string | null {
  const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL || scriptURL.startsWith('file:')) return null;
  const match = scriptURL.match(/^(?:https?|exp|exps):\/\/([^/:/?]+)/i);
  if (!match?.[1]) return null;
  const host = match[1];
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'localhost';
  }
  return host;
}

function resolveDevApiHost(): string {
  if (DEV_API_HOST_OVERRIDE) return DEV_API_HOST_OVERRIDE;
  const fromExpo = hostFromExpoDev();
  if (fromExpo) return fromExpo;
  const fromBundle = hostFromMetroBundle();
  if (fromBundle) return fromBundle;
  return 'localhost';
}

const devBase = `http://${resolveDevApiHost()}:${DEV_API_PORT}`;

export const API_BASE = EXPLICIT_API_BASE || (__DEV__ ? (USE_REMOTE_API_IN_DEV ? PROD_API_BASE : devBase) : PROD_API_BASE);

export const ROLES = ['Admin', 'Trainer', 'Student'] as const;
export type Role = (typeof ROLES)[number];
