import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { useTripSocket } from '../hooks/useTripSocket';
import { tripApi, expenseApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Spinner, ErrorState, EmptyState, Modal, Field, InlineError, Stat } from '../components/ui';
import BudgetChart from '../components/BudgetChart';
import { EXPENSE_CATEGORIES, CURRENCIES } from '../utils/constants';
import { formatMoney, formatDate } from '../utils/format';

function ExpenseForm({ trip, expense, open, onClose, onSaved }) {
  const { user } = useAuth();
  const members = [{ _id: trip.owner?._id, name: trip.owner?.name }, ...trip.participants.filter((p) => p.status === 'accepted').map((p) => ({ _id: p.userId?._id, name: p.userId?.name }))];
  const [form, setForm] = useState(() => ({
    description: expense?.description || '',
    category: expense?.category || 'food',
    amount: expense?.amount ?? '',
    currency: expense?.currency || trip.currency,
    exchangeRate: expense?.exchangeRate ?? '',
    expenseDate: (expense?.expenseDate || new Date().toISOString()).slice(0, 10),
    paidBy: expense?.paidBy?._id || expense?.paidBy || user.id,
    splitAmong: (expense?.splitAmong || []).map(String),
    receiptUrl: expense?.receiptUrl || '',
  }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const foreign = form.currency !== trip.currency;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      description: form.description,
      category: form.category,
      amount: Number(form.amount),
      currency: form.currency,
      exchangeRate: foreign && form.exchangeRate ? Number(form.exchangeRate) : null,
      expenseDate: form.expenseDate,
      paidBy: form.paidBy,
      splitAmong: form.splitAmong,
      receiptUrl: form.receiptUrl,
    };
    try {
      if (expense) await expenseApi.update(expense._id, body);
      else await expenseApi.create(trip._id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Edit expense' : 'Add expense'} footer={<button type="submit" form="exp-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}>
      <form id="exp-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="e-desc">
            <input id="e-desc" className="input" required maxLength={300} value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <Field label="Amount" htmlFor="e-amount">
          <input id="e-amount" type="number" min="0.01" step="0.01" required className="input" value={form.amount} onChange={set('amount')} />
        </Field>
        <Field label="Currency" htmlFor="e-cur">
          <select id="e-cur" className="input" value={form.currency} onChange={set('currency')}>
            {[...new Set([trip.currency, ...CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {foreign && (
          <div className="sm:col-span-2">
            <Field label={`Exchange rate: 1 ${form.currency} = ? ${trip.currency}`} htmlFor="e-rate" hint="Required to include this expense in the budget totals. TripSync never guesses exchange rates.">
              <input id="e-rate" type="number" min="0" step="any" className="input" value={form.exchangeRate} onChange={set('exchangeRate')} />
            </Field>
          </div>
        )}
        <Field label="Category" htmlFor="e-cat">
          <select id="e-cat" className="input" value={form.category} onChange={set('category')}>
            {EXPENSE_CATEGORIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" htmlFor="e-date">
          <input id="e-date" type="date" className="input" required value={form.expenseDate} onChange={set('expenseDate')} />
        </Field>
        <Field label="Paid by" htmlFor="e-paid">
          <select id="e-paid" className="input" value={form.paidBy} onChange={set('paidBy')}>
            {members.map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Receipt URL" htmlFor="e-receipt" hint="Optional link to a photo or PDF">
          <input id="e-receipt" type="url" className="input" placeholder="https://" value={form.receiptUrl} onChange={set('receiptUrl')} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">Split among (none selected = everyone)</legend>
          <div className="flex flex-wrap gap-3">
            {members.map((m) => (
              <label key={m._id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.splitAmong.includes(String(m._id))}
                  onChange={(e) => setForm((f) => ({ ...f, splitAmong: e.target.checked ? [...f.splitAmong, String(m._id)] : f.splitAmong.filter((x) => x !== String(m._id)) }))}
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <InlineError error={error} />
        </div>
      </form>
    </Modal>
  );
}

export default function Expenses() {
  const { tripId } = useParams();
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const trip = useAsync(() => tripApi.get(tripId), [tripId]);
  const summary = useAsync(() => expenseApi.summary(tripId), [tripId]);
  const list = useAsync(() => expenseApi.list(tripId, { page, limit: 25, ...(category ? { category } : {}) }), [tripId, page, category]);
  const refresh = () => {
    summary.reload({ silent: true });
    list.reload({ silent: true });
  };
  useTripSocket(tripId, { expenses_updated: refresh }, refresh);

  if (trip.loading && !trip.data) return <Spinner />;
  if (trip.error) return <ErrorState error={trip.error} onRetry={trip.reload} />;
  const t = trip.data;
  const canEdit = ['owner', 'editor'].includes(t.myRole);
  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to={`/trips/${t._id}`} className="text-sm text-brand-700">
            ← {t.name}
          </Link>
          <h1 className="text-2xl font-bold">Budget & expenses</h1>
        </div>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setModal({})}>
            ＋ Add expense
          </button>
        )}
      </div>

      {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Budget" value={formatMoney(s.budget, s.currency)} sub={`${formatMoney(s.perPerson.budget, s.currency)} / person`} />
            <Stat label="Spent" value={formatMoney(s.actual, s.currency)} sub={`${formatMoney(s.perPerson.actual, s.currency)} / person`} tone={s.actual > s.budget && s.budget > 0 ? 'text-rose-700' : ''} />
            <Stat label="Remaining" value={formatMoney(s.remaining, s.currency)} tone={s.remaining < 0 ? 'text-rose-700' : 'text-emerald-700'} />
            <Stat label="Planned activity costs" value={formatMoney(s.planned, s.currency)} sub={s.plannedUnconvertedItems ? `${s.plannedUnconvertedItems} in other currencies not counted` : null} />
          </div>
          {s.warnings.map((w) => (
            <p key={w.type} className={`rounded-xl px-3 py-2 text-sm ${w.type === 'over_budget' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
              {w.message}
            </p>
          ))}
          {Object.keys(s.unconverted).length > 0 && (
            <p className="text-xs text-ink-500">
              Not included (no exchange rate): {Object.entries(s.unconverted).map(([c, v]) => formatMoney(v, c)).join(', ')}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-3 font-semibold">By category</h2>
              <BudgetChart summary={s} />
            </div>
            <div className="card p-4">
              <h2 className="mb-3 font-semibold">Who paid what</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-ink-500">
                    <th className="py-1">Member</th>
                    <th className="py-1 text-right">Paid</th>
                    <th className="py-1 text-right">Share</th>
                    <th className="py-1 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {s.members.map((m) => (
                    <tr key={m.userId} className="border-t border-slate-100">
                      <td className="py-2">{m.name}</td>
                      <td className="py-2 text-right">{formatMoney(m.paid, s.currency)}</td>
                      <td className="py-2 text-right">{formatMoney(m.share, s.currency)}</td>
                      <td className={`py-2 text-right font-medium ${m.balance > 0 ? 'text-emerald-700' : m.balance < 0 ? 'text-rose-700' : ''}`}>
                        {m.balance > 0 ? '+' : ''}
                        {formatMoney(m.balance, s.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-500">Positive balance = is owed money by the group.</p>
            </div>
          </div>
        </>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Expenses</h2>
          <select
            className="input w-auto"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {list.loading && !list.data && <Spinner />}
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.data && list.data.data.length === 0 && (
          <EmptyState icon="🧾" title="No expenses yet" action={canEdit && <button type="button" className="btn-primary" onClick={() => setModal({})}>Add the first one</button>}>
            Track what you spend to compare it with the budget.
          </EmptyState>
        )}
        {list.data?.data.length > 0 && (
          <ul className="card divide-y divide-slate-100">
            {list.data.data.map((e) => {
              const cat = EXPENSE_CATEGORIES.find(([k]) => k === e.category);
              return (
                <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-1.5 rounded-full" style={{ background: cat?.[2] }} />
                    <div>
                      <p className="text-sm font-medium">{e.description}</p>
                      <p className="text-xs text-ink-500">
                        {cat?.[1]} · {formatDate(e.expenseDate, 'UTC')} · paid by {e.paidBy?.name}
                        {e.receiptUrl && (
                          <>
                            {' · '}
                            <a href={e.receiptUrl} target="_blank" rel="noreferrer noopener" className="text-brand-700 underline">
                              receipt
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-right text-sm font-semibold">
                      {formatMoney(e.amount, e.currency)}
                      {e.currency !== t.currency && <span className="block text-xs font-normal text-ink-500">{e.exchangeRate ? `≈ ${formatMoney(e.amount * e.exchangeRate, t.currency)}` : 'no rate — not in totals'}</span>}
                    </span>
                    {canEdit && (
                      <>
                        <button type="button" className="btn-ghost px-2 text-xs" onClick={() => setModal({ expense: e })}>
                          Edit
                        </button>
                        <button type="button" className="btn-ghost px-2 text-xs text-rose-700" onClick={async () => window.confirm('Delete this expense?') && (await expenseApi.remove(e._id), refresh())}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {list.data?.meta.totalPages > 1 && (
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="self-center text-sm text-ink-500">
              {page} / {list.data.meta.totalPages}
            </span>
            <button type="button" className="btn-secondary" disabled={page >= list.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
      {modal && <ExpenseForm trip={t} expense={modal.expense} open onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  );
}
