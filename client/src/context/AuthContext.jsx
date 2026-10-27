import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/endpoints';
import { connectSocket, disconnectSocket } from '../socket/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await authApi.me();
      setUser(me);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status === 'authenticated') connectSocket();
    else if (status === 'anonymous') disconnectSocket();
  }, [status]);

  const login = useCallback(async (credentials) => {
    const { user: me } = await authApi.login(credentials);
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const register = useCallback(async (body) => {
    const { user: me } = await authApi.register(body);
    setUser(me);
    setStatus('authenticated');
    return me;
  }, []);

  const logout = useCallback(async ({ everywhere = false } = {}) => {
    try {
      if (everywhere) await authApi.logoutAll();
      else await authApi.logout();
    } finally {
      disconnectSocket();
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const { user: me } = await authApi.updateProfile(patch);
    setUser(me);
    return me;
  }, []);

  const value = useMemo(() => ({ user, status, login, register, logout, refresh, updateProfile }), [user, status, login, register, logout, refresh, updateProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
