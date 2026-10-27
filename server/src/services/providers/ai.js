const env = require('../../config/env');
const logger = require('../../config/logger');
const { ProviderError } = require('./http');

/**
 * AI itinerary adapter interface
 *   isConfigured() -> boolean
 *   generateItinerary({ destination, days, budget, currency, interests, pace, travelers, startDate })
 *     -> { days: [{ day, items: [{ title, description, category, startTime, endTime, locationName,
 *                                  estimatedCost, isOutdoor, priority }] }], source }
 * Coordinates are never invented by the model: the itinerary service geocodes place names
 * through the geocoding provider and leaves coordinates empty when it cannot resolve them.
 */

const ITEM_CATEGORIES = ['sightseeing', 'activity', 'meal', 'hotel_checkin', 'transport', 'rest', 'shopping', 'other'];

const itinerarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['days'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'items'],
        properties: {
          day: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'description', 'category', 'startTime', 'endTime', 'locationName', 'estimatedCost', 'isOutdoor', 'priority'],
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                category: { type: 'string', enum: ITEM_CATEGORIES },
                startTime: { type: 'string', description: 'Local time HH:MM (24h)' },
                endTime: { type: 'string', description: 'Local time HH:MM (24h)' },
                locationName: { type: 'string', description: 'A real, searchable place name including the city' },
                estimatedCost: { type: 'number', description: 'Estimated cost per traveller in the trip currency' },
                isOutdoor: { type: 'boolean' },
                priority: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
            },
          },
        },
      },
    },
  },
};

let client = null;
function getClient() {
  if (client) return client;
  // eslint-disable-next-line global-require
  const Anthropic = require('@anthropic-ai/sdk');
  const Ctor = Anthropic.default || Anthropic;
  client = new Ctor({ apiKey: env.aiApiKey, maxRetries: 2, timeout: 120000 });
  return client;
}

const anthropic = {
  name: 'anthropic',
  isConfigured: () => Boolean(env.aiApiKey),
  async generateItinerary(input) {
    const prompt = [
      `Plan a ${input.days}-day trip to ${input.destination} for ${input.travelers} traveller(s).`,
      `Total budget: ${input.budget || 'not specified'} ${input.currency}. Pace: ${input.pace}.`,
      `Interests: ${input.interests.length ? input.interests.join(', ') : 'general sightseeing'}.`,
      input.dietary?.length ? `Dietary needs: ${input.dietary.join(', ')}.` : '',
      'Include meals and rest periods, keep travel between consecutive stops realistic, and use real places',
      'that exist today. Do not include opening hours, prices or facts you are unsure of; estimate costs conservatively.',
      'Return day numbers starting at 1.',
    ]
      .filter(Boolean)
      .join(' ');

    let response;
    try {
      response = await getClient().beta.messages.create({
        model: env.aiModel,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: itinerarySchema } },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      logger.warn('AI itinerary request failed', { error: err.message, status: err.status });
      throw new ProviderError('anthropic', `AI itinerary generation failed: ${err.message}`, { status: err.status });
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError('anthropic', 'The AI provider declined to generate this itinerary', { retryable: false });
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ProviderError('anthropic', 'The generated itinerary was too long; try fewer days', { retryable: false });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return { ...JSON.parse(text), source: `anthropic:${response.model}` };
    } catch {
      throw new ProviderError('anthropic', 'The AI provider returned an unreadable itinerary', { retryable: false });
    }
  },
};

const disabled = { name: 'none', isConfigured: () => false, async generateItinerary() { return null; } };

const selectAdapter = () =>
  env.providerMode !== 'demo' && env.providers.ai === 'anthropic' && env.aiApiKey ? anthropic : disabled;

module.exports = { selectAdapter, itinerarySchema, adapters: { anthropic, disabled } };
