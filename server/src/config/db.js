const dns = require('dns');
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

// NoSQL-injection defence is layered: request bodies/queries are stripped of `$`/dotted keys
// (middleware/sanitize.js), validated with zod, and ids are checked before reaching queries.
// Unknown query fields are dropped rather than passed through.
mongoose.set('strictQuery', true);

/** True when the connection string names a database (…mongodb.net/<name>?…). */
const uriHasDatabase = (uri) => /^mongodb(\+srv)?:\/\/[^/]+\/[^/?]+/.test(uri);

/**
 * mongodb+srv:// needs a DNS SRV lookup. Some machines (VPNs, local DNS proxies on 127.0.0.1)
 * refuse SRV queries even though normal browsing works; then switch Node to public resolvers.
 * MONGODB_DNS_SERVERS (comma separated) overrides the fallback list.
 */
async function ensureSrvResolvable(uri) {
  if (!uri.startsWith('mongodb+srv://')) return;
  const host = uri.replace(/^mongodb\+srv:\/\/([^@]*@)?/, '').split(/[/?]/)[0];
  const configured = (process.env.MONGODB_DNS_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length) {
    dns.setServers(configured);
    return;
  }
  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
  } catch (err) {
    if (!['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL'].includes(err.code)) return; // let the driver report it
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    logger.warn('System DNS refused the MongoDB SRV lookup; using public DNS resolvers instead', { code: err.code });
  }
}

async function connectDatabase(uri = env.mongoUri) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));

  await ensureSrvResolvable(uri);
  // Atlas strings copied from "Connect" have no database name, which would silently use "test".
  const dbName = uriHasDatabase(uri) ? undefined : process.env.MONGODB_DB_NAME || 'tripsync';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...(dbName ? { dbName } : {}) });
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
