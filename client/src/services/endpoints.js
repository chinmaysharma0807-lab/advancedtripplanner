import api from './api';

const data = (p) => p.then((r) => r.data.data);
const withMeta = (p) => p.then((r) => ({ data: r.data.data, meta: r.data.meta }));

export const authApi = {
  me: () => data(api.get('/auth/me')),
  login: (body) => data(api.post('/auth/login', body)),
  register: (body) => data(api.post('/auth/register', body)),
  logout: () => data(api.post('/auth/logout')),
  logoutAll: () => data(api.post('/auth/logout-all')),
  updateProfile: (body) => data(api.patch('/users/me', body)),
  changePassword: (body) => data(api.post('/users/me/password', body)),
  deleteLocationHistory: (tripId) => data(api.delete('/users/me/location-history', { params: tripId ? { tripId } : {} })),
};

export const tripApi = {
  list: (params) => withMeta(api.get('/trips', { params })),
  get: (id) => data(api.get(`/trips/${id}`)),
  create: (body) => data(api.post('/trips', body)),
  update: (id, body) => data(api.patch(`/trips/${id}`, body)),
  remove: (id) => api.delete(`/trips/${id}`),
  duplicate: (id, body = {}) => data(api.post(`/trips/${id}/duplicate`, body)),
  activityLog: (id, params) => withMeta(api.get(`/trips/${id}/activity-log`, { params })),
  weather: (id) => data(api.get(`/trips/${id}/weather`)),
  recommendations: (id, params) => data(api.get(`/trips/${id}/recommendations`, { params })),
  invite: (id, body) => data(api.post(`/trips/${id}/invitations`, body)),
  invitations: () => data(api.get('/invitations')),
  acceptInvitation: (id) => data(api.post(`/invitations/${id}/accept`)),
  declineInvitation: (id) => data(api.post(`/invitations/${id}/decline`)),
  updateParticipant: (id, userId, role) => data(api.patch(`/trips/${id}/participants/${userId}`, { role })),
  removeParticipant: (id, userId) => api.delete(`/trips/${id}/participants/${userId}`),
  shareLinks: (id) => data(api.get(`/trips/${id}/share-links`)),
  createShareLink: (id, body) => data(api.post(`/trips/${id}/share-links`, body)),
  revokeShareLink: (id, linkId) => api.delete(`/trips/${id}/share-links/${linkId}`),
  viewShared: (token) => data(api.get(`/share/${token}`)),
  joinShared: (token) => data(api.post(`/share/${token}/join`)),
};

export const itineraryApi = {
  list: (tripId, params) => data(api.get(`/trips/${tripId}/itinerary`, { params })),
  create: (tripId, body) => api.post(`/trips/${tripId}/itinerary`, body).then((r) => r.data),
  bulk: (tripId, body) => data(api.post(`/trips/${tripId}/itinerary/bulk`, body)),
  generate: (tripId, body) => data(api.post(`/trips/${tripId}/itinerary/generate`, body)),
  update: (id, body) => data(api.patch(`/itinerary/${id}`, body)),
  setStatus: (id, status, reason) => data(api.patch(`/itinerary/${id}/status`, { status, reason })),
  remove: (id) => api.delete(`/itinerary/${id}`),
  reorder: (tripId, body) => data(api.patch(`/trips/${tripId}/itinerary/reorder`, body)),
  recalculate: (tripId, body = {}) => data(api.post(`/trips/${tripId}/itinerary/recalculate`, body)),
  reportDelay: (tripId, body) => withMeta(api.post(`/trips/${tripId}/itinerary/delay`, body)),
  proposals: (tripId, params) => data(api.get(`/trips/${tripId}/proposals`, { params })),
  applyProposal: (tripId, proposalId, body = {}) => data(api.post(`/trips/${tripId}/proposals/${proposalId}/apply`, body)),
  rejectProposal: (tripId, proposalId) => data(api.post(`/trips/${tripId}/proposals/${proposalId}/reject`)),
  route: (tripId, day) => data(api.get(`/trips/${tripId}/route`, { params: day ? { day } : {} })),
};

export const trackingApi = {
  start: (tripId) => data(api.post(`/trips/${tripId}/tracking/start`, { consent: true })),
  pause: (tripId) => data(api.post(`/trips/${tripId}/tracking/pause`)),
  stop: (tripId) => data(api.post(`/trips/${tripId}/tracking/stop`)),
  sendLocation: (tripId, body) => data(api.post(`/trips/${tripId}/location`, body)),
  latest: (tripId) => data(api.get(`/trips/${tripId}/location/latest`)),
  history: (tripId, params) => withMeta(api.get(`/trips/${tripId}/location/history`, { params })),
};

export const expenseApi = {
  list: (tripId, params) => withMeta(api.get(`/trips/${tripId}/expenses`, { params })),
  summary: (tripId) => data(api.get(`/trips/${tripId}/expenses/summary`)),
  create: (tripId, body) => data(api.post(`/trips/${tripId}/expenses`, body)),
  update: (id, body) => data(api.patch(`/expenses/${id}`, body)),
  remove: (id) => api.delete(`/expenses/${id}`),
};

export const notificationApi = {
  list: (params) => withMeta(api.get('/notifications', { params })),
  markRead: (id) => data(api.patch(`/notifications/${id}/read`)),
  markAllRead: () => data(api.patch('/notifications/read-all')),
};

export const miscApi = {
  geocode: (q) => withMeta(api.get('/geocode', { params: { q } })),
  providers: () => data(api.get('/providers')),
};
