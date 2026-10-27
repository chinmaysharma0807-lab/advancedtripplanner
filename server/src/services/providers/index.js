const env = require('../../config/env');
const routing = require('./routing');
const geocoding = require('./geocoding');
const weather = require('./weather');
const places = require('./places');
const ai = require('./ai');

/** Describe which adapters are active, so the UI can label demo or estimated data. */
function describeProviders() {
  return {
    mode: env.providerMode,
    routing: routing.selectAdapter().name,
    geocoding: geocoding.selectAdapter().name,
    weather: weather.selectAdapter().name,
    places: places.selectAdapter().name,
    ai: ai.selectAdapter().name,
    trafficAware: routing.supportsTraffic(),
    demoSimulationAllowed: env.allowDemoSimulation,
    flightStatus: 'unsupported',
  };
}

module.exports = { routing, geocoding, weather, places, ai, describeProviders };
