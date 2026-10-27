module.exports = async () => {
  if (globalThis.__MONGO_MEMORY_SERVER__) await globalThis.__MONGO_MEMORY_SERVER__.stop();
};
