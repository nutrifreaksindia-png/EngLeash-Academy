import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../config';

const TOKEN_KEY = '@engleash_token';
const REQUEST_TIMEOUT_MS = 20000;
const SIGNUP_TIMEOUT_MS = 45000;

async function fetchJsonUnauthenticated(path: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Set by AuthContext so 401 SESSION_REPLACED can log user out. */
export let onSessionReplaced: (() => void) | null = null;
export function setOnSessionReplaced(cb: (() => void) | null) {
  onSessionReplaced = cb;
}

function getDeviceName(): string {
  return `Mobile (${Platform.OS})`;
}

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const existingHeaders = (options.headers || {}) as Record<string, string>;
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    ...existingHeaders,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers, signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data?.code === 'SESSION_REPLACED') {
      await clearToken();
      onSessionReplaced?.();
    }
  }
  return res;
}

export const api = {
  /** GET without Authorization (e.g. public catalog). */
  async publicGet(path: string) {
    return fetchJsonUnauthenticated(path);
  },

  async login(email: string, password: string, role?: string, client?: 'mobile' | 'tv') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        role,
        client: client ?? 'mobile',
        deviceName: getDeviceName(),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.alreadyLoggedIn && data.deviceName) {
      const err = new Error('ALREADY_LOGGED_IN') as Error & { deviceName?: string };
      err.deviceName = data.deviceName;
      throw err;
    }
    return data;
  },

  async replaceSession(email: string, password: string, role?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${API_BASE}/api/auth/replace-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        role,
        client: 'mobile',
        deviceName: getDeviceName(),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Replace session failed');
    return data;
  },

  async get(path: string) {
    const res = await authFetch(path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async post(path: string, body?: object) {
    const res = await authFetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async signup(body: Record<string, any>) {
    const doSignup = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SIGNUP_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      return data;
    };

    try {
      return await doSignup();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // Retry once on timeout before failing the signup flow.
        try {
          return await doSignup();
        } catch (retryErr: any) {
          if (retryErr?.name === 'AbortError') {
            throw new Error('Request timed out. Please check backend connection and try again.');
          }
          throw retryErr;
        }
      }
      throw error;
    }
  },

  async postForm(path: string, formData: FormData) {
    const res = await authFetch(path, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async delete(path: string) {
    const res = await authFetch(path, { method: 'DELETE' });
    if (res.status === 204) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};

/** Call before clearToken so server can remove the session. */
export async function logoutFromServer(): Promise<void> {
  const token = await getToken();
  if (!token) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } finally {
    await clearToken();
  }
}
