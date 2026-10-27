const path = require('path');
const mongoose = require('mongoose');

// Each test file gets its own throwaway database.
beforeAll(async () => {
  const name = `tripsync_test_${path.basename(expect.getState().testPath || 'x', '.test.js').replace(/\W/g, '_')}`;
  await mongoose.connect(`${process.env.TEST_MONGODB_BASE}/${name}`, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
