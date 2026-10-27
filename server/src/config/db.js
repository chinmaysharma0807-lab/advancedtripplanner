const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

// NoSQL-injection defence is layered: request bodies/queries are stripped of `$`/dotted keys
// (middleware/sanitize.js), validated with zod, and ids are checked before reaching queries.
// Unknown query fields are dropped rather than passed through.
mongoose.set('strictQuery', true);

async function connectDatabase(uri = env.mongoUri) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info('MongoDB connected', { db: mongoose.connection.name });
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

module.exports = { connectDatabase, disconnectDatabase };
