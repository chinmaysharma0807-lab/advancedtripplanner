const mongoose = require('mongoose');

// Uses TEST_MONGODB_URI, else a local MongoDB on 127.0.0.1:27017, else an in-memory MongoDB
// (mongodb-memory-server downloads a MongoDB binary on first use).
module.exports = async () => {
  const base = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
  try {
    const conn = await mongoose.createConnection(`${base.replace(/\/$/, '')}/tripsync_probe`, { serverSelectionTimeoutMS: 2500 }).asPromise();
    await conn.close();
    process.env.TEST_MONGODB_BASE = base.replace(/\/$/, '');
  } catch {
    // eslint-disable-next-line global-require
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    globalThis.__MONGO_MEMORY_SERVER__ = server;
    process.env.TEST_MONGODB_BASE = server.getUri().replace(/\/$/, '');
  }
};
