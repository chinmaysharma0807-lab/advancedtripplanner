import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../services/endpoints', () => ({
  authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
  itineraryApi: { create: vi.fn(), update: vi.fn(), applyProposal: vi.fn(), rejectProposal: vi.fn() },
  miscApi: { geocode: vi.fn() },
}));
vi.mock('../socket/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), getSocket: vi.fn() }));

const { authApi, itineraryApi } = await import('../services/endpoints');
const { AuthProvider } = await import('../context/AuthContext');
const { LoginPage } = await import('../pages/AuthPages');
const { default: ProposalCard } = await import('../components/ProposalCard');
const { default: ItemFormModal } = await import('../components/ItemFormModal');

const axiosError = (status, error) => ({ response: { status, data: { error } } });
const trip = { _id: 't1', name: 'Paris', timezone: 'UTC', currency: 'EUR', transportMode: 'walking', startDate: '2026-06-01T00:00:00.000Z', endDate: '2026-06-03T00:00:00.000Z' };

beforeEach(() => vi.clearAllMocks());

describe('login', () => {
  test('shows the server error for invalid credentials', async () => {
    authApi.me.mockRejectedValue(axiosError(401, { code: 'UNAUTHORIZED', message: 'Authentication required' }));
    authApi.login.mockRejectedValue(axiosError(401, { code: 'UNAUTHORIZED', message: 'Invalid email or password' }));
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'a@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-pass1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(authApi.login).toHaveBeenCalledWith({ email: 'a@example.test', password: 'wrong-pass1' });
  });
});

describe('schedule conflict confirmation', () => {
  test('asks before keeping an overlapping activity, then resubmits with confirmConflict', async () => {
    itineraryApi.create
      .mockRejectedValueOnce(axiosError(409, { code: 'SCHEDULE_CONFLICT', message: 'overlap', details: { conflicts: [{ id: 'x', title: 'Louvre', scheduledStart: '2026-06-01T10:00:00.000Z' }] } }))
      .mockResolvedValueOnce({ data: { _id: 'new' } });
    const onSaved = vi.fn();
    render(<ItemFormModal open trip={trip} onClose={() => {}} onSaved={onSaved} defaults={{ day: 1 }} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Save activity' }));
    expect(await screen.findByText(/This overlaps with/)).toBeInTheDocument();
    expect(screen.getByText(/Louvre/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep both anyway' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(itineraryApi.create.mock.calls[1][1]).toMatchObject({ title: 'Lunch', confirmConflict: true, scheduledStart: '2026-06-01T10:00:00.000Z' });
  });
});

describe('reschedule proposal review', () => {
  const proposal = {
    _id: 'p1',
    day: 1,
    delayMinutes: 40,
    status: 'pending',
    source: 'gps',
    dataSource: 'osrm',
    explanation: 'You are expected 40 min late. Nothing changes until you approve.',
    warnings: [],
    changes: [
      { itemId: 'a', title: 'Museum', action: 'shift', previousStart: '2026-06-01T10:00:00Z', previousEnd: '2026-06-01T11:00:00Z', proposedStart: '2026-06-01T10:40:00Z', proposedEnd: '2026-06-01T11:40:00Z', reason: 'Starts 40 min later' },
      { itemId: 'b', title: 'Coffee', action: 'skip', previousStart: '2026-06-01T12:00:00Z', previousEnd: '2026-06-01T12:30:00Z', reason: 'Would collide' },
      { itemId: 'c', title: 'Dinner', action: 'keep', previousStart: '2026-06-01T19:00:00Z', previousEnd: '2026-06-01T20:00:00Z', proposedStart: '2026-06-01T19:00:00Z', reason: 'Fixed-time booking preserved' },
    ],
  };

  test('lets the traveller exclude a change before applying', async () => {
    itineraryApi.applyProposal.mockResolvedValue({});
    const onResolved = vi.fn();
    render(<ProposalCard proposal={proposal} trip={trip} canEdit onResolved={onResolved} />);
    expect(screen.getByText(/Running about 40 min late/)).toBeInTheDocument();
    expect(screen.getByText('Fixed-time booking preserved')).toBeInTheDocument();
    const user = userEvent.setup();
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Apply' });
    expect(checkboxes).toHaveLength(2); // fixed bookings cannot be toggled
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(itineraryApi.applyProposal).toHaveBeenCalledWith('t1', 'p1', { excludeItemIds: ['b'] });
  });

  test('viewers see the proposal but cannot act on it', () => {
    render(<ProposalCard proposal={proposal} trip={trip} canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
  });
});
