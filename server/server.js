const http = require('http');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/db');
const { createApp } = require('./src/app');
const { createSocketServer } = require('./src/sockets');
const { startJobs, stopJobs } = require('./src/jobs/scheduler');
const { describeProviders } = require('./src/services/providers');

async function main() {
  await connectDatabase();
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  if (env.enableJobs) startJobs();

  server.listen(env.port, () => {
    logger.info(`TripSync API listening on http://localhost:${env.port}`, { providers: describeProviders() });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    stopJobs();
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    io.close();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: err?.message, stack: err?.stack }));
}

main().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
