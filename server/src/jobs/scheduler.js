const cron = require('node-cron');
const logger = require('../config/logger');
const { sweepSchedules, checkWeather, checkTraffic, closeStaleSessions } = require('./progressJobs');

// Location history retention is enforced by a TTL index on LocationUpdate.expiresAt.

const tasks = [];
const running = new Set();

function schedule(name, expression, fn) {
  const task = cron.schedule(expression, async () => {
    if (running.has(name)) return; // never overlap runs of the same job
    running.add(name);
    try {
      const result = await fn();
      logger.debug(`job ${name} finished`, result);
    } catch (err) {
      logger.error(`job ${name} failed`, { error: err.message });
    } finally {
      running.delete(name);
    }
  });
  tasks.push(task);
}

function startJobs() {
  schedule('schedule-sweep', '* * * * *', () => sweepSchedules());
  schedule('weather', '*/30 * * * *', () => checkWeather());
  schedule('traffic', '*/10 * * * *', () => checkTraffic());
  schedule('stale-sessions', '17 * * * *', () => closeStaleSessions());
  logger.info('Background jobs started', { jobs: tasks.length });
}

function stopJobs() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}

module.exports = { startJobs, stopJobs };
