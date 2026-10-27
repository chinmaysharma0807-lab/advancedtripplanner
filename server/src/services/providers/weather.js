const env = require('../../config/env');
const { fetchJson, TtlCache } = require('./http');

/**
 * Weather adapter interface
 *   forecast({lat,lng}) -> {
 *     current: { time, temperature, weatherCode, description, windSpeed, precipitation },
 *     hourly: [{ time, temperature, precipitationProbability, weatherCode, windSpeed }],
 *     daily: [{ date, weatherCode, description, tempMax, tempMin, precipitationProbability }],
 *     timezone, source, isDemo, fetchedAt
 *   }
 */

const cache = new TtlCache(200);
const TTL = 30 * 60 * 1000;

// WMO weather interpretation codes (used by Open-Meteo).
const WMO = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Heavy rain showers',
  82: 'Violent rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail',
};
const describe = (code) => WMO[code] || 'Unknown';

const openMeteo = {
  name: 'open-meteo',
  async forecast({ lat, lng }) {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      current: 'temperature_2m,weather_code,wind_speed_10m,precipitation',
      hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '16',
      timeformat: 'unixtime',
    });
    const json = await fetchJson('open-meteo', `${env.openMeteoBaseUrl}?${params}`);
    const toIso = (unix) => new Date(unix * 1000).toISOString();
    return {
      current: json.current
        ? {
            time: toIso(json.current.time),
            temperature: json.current.temperature_2m,
            weatherCode: json.current.weather_code,
            description: describe(json.current.weather_code),
            windSpeed: json.current.wind_speed_10m,
            precipitation: json.current.precipitation,
          }
        : null,
      hourly: (json.hourly?.time || []).map((t, i) => ({
        time: toIso(t),
        temperature: json.hourly.temperature_2m[i],
        precipitationProbability: json.hourly.precipitation_probability[i],
        weatherCode: json.hourly.weather_code[i],
        windSpeed: json.hourly.wind_speed_10m[i],
      })),
      daily: (json.daily?.time || []).map((t, i) => ({
        date: toIso(t).slice(0, 10),
        weatherCode: json.daily.weather_code[i],
        description: describe(json.daily.weather_code[i]),
        tempMax: json.daily.temperature_2m_max[i],
        tempMin: json.daily.temperature_2m_min[i],
        precipitationProbability: json.daily.precipitation_probability_max[i],
      })),
      units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
      timezone: json.timezone,
      source: 'open-meteo',
      isDemo: false,
      fetchedAt: new Date().toISOString(),
    };
  },
};

// Deterministic demo forecast so the UI can be exercised offline. Always labelled as demo.
const demo = {
  name: 'demo',
  async forecast({ lat, lng }) {
    const seed = Math.abs(Math.round(lat * 100) + Math.round(lng * 100));
    const codes = [0, 1, 2, 3, 61, 63, 80, 95];
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const hourly = Array.from({ length: 16 * 24 }, (_, i) => {
      const t = new Date(now.getTime() + i * 3600 * 1000);
      const code = codes[(seed + Math.floor(i / 6)) % codes.length];
      return {
        time: t.toISOString(),
        temperature: 18 + ((seed + i) % 10) - 3,
        precipitationProbability: code >= 61 ? 70 : 10,
        weatherCode: code,
        windSpeed: 10 + ((seed + i) % 15),
      };
    });
    const daily = Array.from({ length: 16 }, (_, d) => {
      const slice = hourly.slice(d * 24, d * 24 + 24);
      const code = slice[12].weatherCode;
      return {
        date: slice[0].time.slice(0, 10),
        weatherCode: code,
        description: describe(code),
        tempMax: Math.max(...slice.map((h) => h.temperature)),
        tempMin: Math.min(...slice.map((h) => h.temperature)),
        precipitationProbability: Math.max(...slice.map((h) => h.precipitationProbability)),
      };
    });
    return {
      current: {
        time: now.toISOString(),
        temperature: hourly[0].temperature,
        weatherCode: hourly[0].weatherCode,
        description: describe(hourly[0].weatherCode),
        windSpeed: hourly[0].windSpeed,
        precipitation: 0,
      },
      hourly,
      daily,
      units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' },
      timezone: 'UTC',
      source: 'demo',
      isDemo: true,
      fetchedAt: new Date().toISOString(),
    };
  },
};

const selectAdapter = () => (env.providerMode === 'demo' || env.providers.weather === 'demo' ? demo : openMeteo);

async function forecast(coords) {
  const adapter = selectAdapter();
  const cacheKey = `${adapter.name}:${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = await adapter.forecast(coords);
  cache.set(cacheKey, result, TTL);
  return result;
}

module.exports = { forecast, describe, selectAdapter, cache, adapters: { openMeteo, demo } };
