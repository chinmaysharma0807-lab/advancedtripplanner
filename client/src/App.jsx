import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import Dashboard from './pages/Dashboard';
import TripWizard from './pages/TripWizard';
import TripDetails from './pages/TripDetails';
import LiveTracking from './pages/LiveTracking';
import ItineraryEditor from './pages/ItineraryEditor';
import Expenses from './pages/Expenses';
import Profile from './pages/Profile';
import SharedTrip from './pages/SharedTrip';

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-5xl">🧭</p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <Link to="/" className="btn-primary mt-4">
        Go home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/share/:token" element={<SharedTrip />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/trips/new" element={<TripWizard />} />
        <Route path="/trips/:tripId" element={<TripDetails />} />
        <Route path="/trips/:tripId/live" element={<LiveTracking />} />
        <Route path="/trips/:tripId/itinerary" element={<ItineraryEditor />} />
        <Route path="/trips/:tripId/expenses" element={<Expenses />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
