import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken, setOnSessionReplaced, logoutFromServer } from '../api/client';

export type User = { id: number; email: string; name: string; role: string };

type AuthState = { user: User | null; loading: boolean };

const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  replaceSessionAndLogin: (email: string, password: string) => Promise<void>;
  signup: (payload: Record<string, any>) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => void;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  const refreshUser = useCallback(() => {
    getToken().then((token) => {
      if (!token) {
        setState({ user: null, loading: false });
        return;
      }
      api.get('/users/me').then((user) => setState({ user, loading: false })).catch(() => {
        clearToken();
        setState({ user: null, loading: false });
      });
    });
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    setOnSessionReplaced(() => {
      setState({ user: null, loading: false });
    });
    return () => setOnSessionReplaced(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password, undefined, 'mobile');
    await setToken(data.token);
    try {
      const user = await api.get('/users/me');
      setState({ user, loading: false });
    } catch {
      setState({ user: data.user, loading: false });
    }
  }, []);

  const replaceSessionAndLogin = useCallback(async (email: string, password: string) => {
    const data = await api.replaceSession(email, password, undefined);
    await setToken(data.token);
    try {
      const user = await api.get('/users/me');
      setState({ user, loading: false });
    } catch {
      setState({ user: data.user, loading: false });
    }
  }, []);

  const signup = useCallback(async (payload: Record<string, any>) => {
    await api.signup(payload);
  }, []);

  const logout = useCallback(async () => {
    await logoutFromServer();
    setState({ user: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ user: state.user, loading: state.loading, login, replaceSessionAndLogin, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
