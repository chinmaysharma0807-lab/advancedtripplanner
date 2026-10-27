import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { timeAgo } from '../utils/format';

function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-ghost relative px-2.5" onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${unreadCount} unread)`} aria-expanded={open}>
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[11px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
          <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
            <span className="font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">You are all caught up.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/60'}`}
                    onClick={() => {
                      if (!n.readAt) markRead(n._id);
                      setOpen(false);
                      if (n.tripId) navigate(n.type === 'invitation' ? '/dashboard' : `/trips/${n.tripId}`);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.severity === 'critical' ? 'bg-rose-600' : n.severity === 'warning' ? 'bg-amber-500' : 'bg-brand-500'} ${n.readAt ? 'opacity-30' : ''}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-3 text-xs text-ink-500">{n.message}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-500">
                          {n.type.replace(/_/g, ' ')} · {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useNotifications();
  return (
    <div className="pointer-events-none fixed bottom-20 right-2 z-50 flex w-[calc(100%-1rem)] max-w-sm flex-col gap-2 sm:bottom-4 sm:right-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-xl border bg-white p-3 shadow-lg ${t.severity === 'critical' ? 'border-rose-300' : t.severity === 'warning' ? 'border-amber-300' : 'border-slate-200'}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs text-ink-500">{t.message}</p>}
            </div>
            <button type="button" className="text-ink-500 hover:text-ink-900" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const navClass = ({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-slate-100'}`;

export default function Layout() {
  const { user, logout } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-bold text-ink-900">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            TripSync
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            <NavLink to="/dashboard" className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/trips/new" className={navClass}>
              Plan a trip
            </NavLink>
            <NavLink to="/profile" className={navClass}>
              Profile
            </NavLink>
          </nav>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <span className="hidden text-sm text-ink-500 md:inline">{user?.name}</span>
            <button
              type="button"
              className="btn-ghost hidden px-2.5 sm:inline-flex"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
        {!online && <div className="bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-white">You are offline — showing the last loaded data. Live updates resume when you reconnect.</div>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white sm:hidden" aria-label="Mobile">
        {[
          ['/dashboard', '🏠', 'Home'],
          ['/trips/new', '➕', 'Plan'],
          ['/profile', '👤', 'Profile'],
        ].map(([to, icon, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `flex flex-col items-center py-2 text-xs ${isActive ? 'text-brand-700' : 'text-ink-500'}`}>
            <span aria-hidden="true" className="text-lg">
              {icon}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
