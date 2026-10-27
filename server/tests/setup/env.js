// Runs before every test file, before any application module is loaded.
process.env.NODE_ENV = 'test';
process.env.PROVIDER_MODE = 'demo'; // never call real external APIs from tests
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || 'tripsync-test-secret';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.ENABLE_JOBS = 'false';
process.env.AI_API_KEY = '';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
