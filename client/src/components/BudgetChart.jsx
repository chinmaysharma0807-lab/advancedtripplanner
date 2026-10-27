import { EXPENSE_CATEGORIES } from '../utils/constants';
import { formatMoney } from '../utils/format';

/** Donut of spending by category plus a utilisation bar. Pure SVG, no chart library. */
export default function BudgetChart({ summary }) {
  const total = Object.values(summary.byCategory).reduce((a, b) => a + b, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const util = summary.utilization ?? 0;
  const over = util > 100;

  return (
    <div className="grid gap-6 sm:grid-cols-[200px_1fr] sm:items-center">
      <svg viewBox="0 0 140 140" className="mx-auto h-48 w-48" role="img" aria-label="Spending by category">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
        {total > 0 &&
          EXPENSE_CATEGORIES.map(([key, , color]) => {
            const value = summary.byCategory[key] || 0;
            if (!value) return null;
            const len = (value / total) * c;
            const el = <circle key={key} cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
            offset += len;
            return el;
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-ink-900 text-[13px] font-semibold">
          {formatMoney(summary.actual, summary.currency)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-ink-500 text-[10px]">
          spent
        </text>
      </svg>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span>Budget used</span>
          <span className={over ? 'font-semibold text-rose-700' : 'font-semibold'}>{summary.utilization === null ? 'No budget set' : `${util}%`}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.min(util, 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget utilisation">
          <div className={`h-full ${over ? 'bg-rose-600' : util > 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(util, 100)}%` }} />
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {EXPENSE_CATEGORIES.map(([key, label, color]) => (
            <li key={key} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
                {label}
              </span>
              <span className="text-ink-700">{formatMoney(summary.byCategory[key] || 0, summary.currency)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
