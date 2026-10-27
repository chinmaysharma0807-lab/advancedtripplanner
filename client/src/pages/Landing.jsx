import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  ['🗺️', 'Day-by-day itineraries', 'Drag-and-drop planning with timeline, calendar, list and map views, plus warnings for overlaps, tight transfers and opening hours.'],
  ['📡', 'Live journey tracking', 'Opt-in location sharing with ETA, distance remaining and route progress from a real routing provider — visible only to your trip.'],
  ['⏱️', 'Adapts to delays', 'When you run late, TripSync proposes a revised schedule that keeps your bookings, explains why, and waits for your approval.'],
  ['🌦️', 'Weather & nearby places', 'Forecasts for your travel dates flag outdoor plans, and nearby recommendations respect your diet, budget and interests.'],
  ['👥', 'Plan together', 'Invite editors and viewers or share a secure link. Every change shows who made it, in real time.'],
  ['💶', 'Budget tracking', 'Log expenses by category, see per-person balances, and get warned before you overspend.'],
];

export default function Landing() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 text-lg font-bold">
          <img src="/favicon.svg" alt="" className="h-8 w-8" /> TripSync
        </span>
        <div className="flex gap-2">
          <Link to="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link to="/register" className="btn-primary">
            Get started
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4">
        <section className="py-14 text-center sm:py-24">
          <p className="chip mx-auto mb-4 bg-brand-100 text-brand-800">Real-time smart trip planner</p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Your itinerary, in sync with the real world.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-500">
            Plan every day of your trip, share your journey live with the people you choose, and let TripSync adjust the plan when traffic, weather or a long lunch gets in the way.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn-primary px-6 py-3 text-base">
              Plan a trip
            </Link>
            <Link to="/login" className="btn-secondary px-6 py-3 text-base">
              Sign in
            </Link>
          </div>
        </section>
        <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3" aria-label="Features">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="card p-5">
              <div className="text-3xl" aria-hidden="true">
                {icon}
              </div>
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-ink-500">{text}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-ink-500">Map data © OpenStreetMap contributors · Weather by Open-Meteo</footer>
    </div>
  );
}
