import { useAsync } from '../hooks/useAsync';
import { tripApi } from '../services/endpoints';
import { Spinner, ErrorState, SourceBadge } from './ui';
import { timeAgo } from '../utils/format';

const icon = (code) => (code >= 95 ? '⛈️' : code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82 ? '❄️' : code >= 51 ? '🌧️' : code >= 45 ? '🌫️' : code >= 2 ? '⛅' : '☀️');

export default function WeatherPanel({ tripId }) {
  const { data, loading, error, reload } = useAsync(() => tripApi.weather(tripId), [tripId]);
  if (loading) return <Spinner label="Loading forecasts…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { destinations, flags } = data;
  if (!destinations.length) return <p className="text-sm text-ink-500">Add coordinates to the destination to see weather.</p>;
  return (
    <div className="space-y-4">
      {destinations.map((d) => (
        <div key={d.place.name} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">{d.place.name}</h4>
            {d.available && <SourceBadge source={d.source} isDemo={d.isDemo} updatedAt={d.fetchedAt} />}
          </div>
          {!d.available ? (
            <p className="mt-2 text-sm text-amber-800">{d.reason} No forecast is shown rather than a guess.</p>
          ) : (
            <>
              {d.current && (
                <p className="mt-2 text-sm">
                  Now: {icon(d.current.weatherCode)} {d.current.description}, {Math.round(d.current.temperature)}
                  {d.units.temperature} · wind {Math.round(d.current.windSpeed)} {d.units.windSpeed}
                  <span className="text-xs text-ink-500"> · updated {timeAgo(d.fetchedAt)}</span>
                </p>
              )}
              {d.note && <p className="mt-1 text-xs text-ink-500">{d.note}</p>}
              {d.daily.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {d.daily.map((day) => (
                    <div key={day.date} className="min-w-[88px] rounded-xl bg-slate-50 p-2 text-center text-xs">
                      <div className="font-semibold">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
                      <div className="text-2xl" title={day.description}>
                        {icon(day.weatherCode)}
                      </div>
                      <div>
                        {Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°
                      </div>
                      <div className="text-ink-500">💧 {day.precipitationProbability ?? '—'}%</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <p className="text-xs text-ink-500">
        Checked {flags.checked} outdoor {flags.checked === 1 ? 'activity' : 'activities'} in the forecast window; {flags.flagged} flagged{flags.failed ? `, ${flags.failed} could not be checked` : ''}.
      </p>
    </div>
  );
}
