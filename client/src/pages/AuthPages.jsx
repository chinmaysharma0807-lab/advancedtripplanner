import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { toApiError } from '../services/api';
import { Field, InlineError } from '../components/ui';

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-lg font-bold">
          <img src="/favicon.svg" alt="" className="h-8 w-8" /> TripSync
        </Link>
        <div className="card p-6">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-sm text-ink-500">{footer}</p>
      </div>
    </div>
  );
}

const fieldErrors = (error) =>
  Object.fromEntries((Array.isArray(error?.details) ? error.details : []).map((d) => [String(d.path || '').replace(/^body\./, ''), d.message]));

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to={location.state?.from || '/dashboard'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };
  const fe = fieldErrors(error);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your trips."
      footer={
        <>
          New to TripSync?{' '}
          <Link to="/register" state={location.state} className="font-semibold text-brand-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={fe.email}>
          <input id="email" type="email" autoComplete="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" error={fe.password}>
          <input id="password" type="password" autoComplete="current-password" className="input" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && !Object.keys(fe).length && <InlineError error={error} />}
        <button type="submit" className="btn-primary w-full" disabled={busy || !form.email || !form.password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const localErrors = {};
  if (form.password && form.password.length < 8) localErrors.password = 'At least 8 characters';
  else if (form.password && !(/[A-Za-z]/.test(form.password) && /\d/.test(form.password))) localErrors.password = 'Include a letter and a number';
  if (form.confirm && form.confirm !== form.password) localErrors.confirm = 'Passwords do not match';

  const submit = async (e) => {
    e.preventDefault();
    if (Object.keys(localErrors).length) return;
    setBusy(true);
    setError(null);
    try {
      await register({ name: form.name, email: form.email, password: form.password });
      navigate(location.state?.from || '/trips/new', { replace: true });
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };
  const fe = { ...fieldErrors(error), ...localErrors };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start planning in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state} className="font-semibold text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" htmlFor="name" error={fe.name}>
          <input id="name" autoComplete="name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email" error={fe.email}>
          <input id="email" type="email" autoComplete="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" error={fe.password} hint="8+ characters with a letter and a number">
          <input id="password" type="password" autoComplete="new-password" className="input" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={fe.confirm}>
          <input id="confirm" type="password" autoComplete="new-password" className="input" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        {error && !Object.keys(fieldErrors(error)).length && <InlineError error={error} />}
        <button type="submit" className="btn-primary w-full" disabled={busy || !form.name || !form.email || !form.password || !form.confirm}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
