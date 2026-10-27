import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { notificationApi } from '../services/endpoints';
import { getSocket } from '../socket/socket';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { status, user } = useAuth();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const seen = useRef(new Set());

  const pushToast = useCallback((toast) => {
    const id = toast.id || `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t.filter((x) => x.id !== id), { ...toast, id }].slice(-4));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.duration || 6000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const load = useCallback(async () => {
    try {
      const { data, meta } = await notificationApi.list({ limit: 30 });
      data.forEach((n) => seen.current.add(n._id));
      setItems(data);
      setUnreadCount(meta.unreadCount);
    } catch {
      /* the bell simply stays empty when offline */
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setItems([]);
      setUnreadCount(0);
      return undefined;
    }
    load();
    const socket = getSocket();
    const onNotification = (n) => {
      if (seen.current.has(n._id)) return; // server dedupes; this guards against replays
      seen.current.add(n._id);
      setItems((list) => [n, ...list].slice(0, 50));
      setUnreadCount((c) => c + 1);
      pushToast({ id: n._id, title: n.title, message: n.message, severity: n.severity, tripId: n.tripId });
      if (user?.notificationPreferences?.browserPush && 'Notification' in window && window.Notification.permission === 'granted' && document.hidden) {
        // eslint-disable-next-line no-new
        new window.Notification(n.title, { body: n.message, tag: n._id });
      }
    };
    socket.on('trip_notification', onNotification);
    socket.on('connect', load); // recover anything missed while disconnected
    return () => {
      socket.off('trip_notification', onNotification);
      socket.off('connect', load);
    };
  }, [status, load, pushToast, user?.notificationPreferences?.browserPush]);

  const markRead = useCallback(async (id) => {
    const n = await notificationApi.markRead(id);
    setItems((list) => list.map((x) => (x._id === id ? n : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await notificationApi.markAllRead();
    setItems((list) => list.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }, []);

  const value = useMemo(
    () => ({ items, unreadCount, reload: load, markRead, markAllRead, toasts, pushToast, dismissToast }),
    [items, unreadCount, load, markRead, markAllRead, toasts, pushToast, dismissToast]
  );
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
