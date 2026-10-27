import { useEffect, useRef } from 'react';
import { ITEM_STATUS, TRIP_STATUS } from '../utils/constants';

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 py-10 text-sm text-ink-500 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon = '🧭', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="mb-3 text-4xl" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-ink-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const isPermission = error?.status === 403 || error?.status === 404;
  const isOffline = error?.status === 0;
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-8 text-center">
      <div className="mb-2 text-3xl" aria-hidden="true">
        {isOffline ? '📡' : isPermission ? '🔒' : '⚠️'}
      </div>
      <h3 className="font-semibold text-rose-900">{isOffline ? 'You are offline' : isPermission ? 'Not available' : title}</h3>
      <p className="mt-1 text-sm text-rose-800">
        {isPermission ? 'This trip does not exist or you do not have access to it.' : error?.message || 'Please try again.'}
      </p>
      {onRetry && !isPermission && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineError({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {error.message || String(error)}
      {Array.isArray(error.details) && (
        <ul className="mt-1 list-inside list-disc">
          {error.details.slice(0, 5).map((d, i) => (
            <li key={i}>{d.message || String(d)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusBadge({ status }) {
  const s = ITEM_STATUS[status] || ITEM_STATUS.upcoming;
  return <span className={`chip ${s.className}`}>{s.label}</span>;
}

export function TripStatusBadge({ status }) {
  const s = TRIP_STATUS[status] || TRIP_STATUS.upcoming;
  return <span className={`chip ${s.className}`}>{s.label}</span>;
}

/** Labels where a value came from, so demo data and estimates are never mistaken for live data. */
export function SourceBadge({ source, isDemo, isEstimate, updatedAt, className = '' }) {
  if (!source && !isDemo) return null;
  const tone = isDemo ? 'bg-fuchsia-100 text-fuchsia-800' : isEstimate ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  const label = isDemo ? 'DEMO DATA' : isEstimate ? 'Estimate' : source;
  return (
    <span className={`chip ${tone} ${className}`} title={`Source: ${source || 'demo'}${updatedAt ? ` · updated ${new Date(updatedAt).toLocaleString()}` : ''}`}>
      {label}
      {isDemo || isEstimate ? ` · ${source}` : ''}
    </span>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          onClick={() => onChange(key)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${active === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
