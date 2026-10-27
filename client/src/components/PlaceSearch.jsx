import { useEffect, useId, useRef, useState } from 'react';
import { miscApi } from '../services/endpoints';
import { toApiError } from '../services/api';

/** Place autocomplete backed by the server's geocoding adapter (Nominatim or demo data). */
export default function PlaceSearch({ value, onChange, placeholder = 'Search for a place', label, required = false }) {
  const [query, setQuery] = useState(value?.name || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: null, source: null });
  const timer = useRef(null);
  const id = useId();

  useEffect(() => {
    setQuery(value?.name || '');
  }, [value?.name]);

  const search = (q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setState({ loading: true, error: null });
      try {
        const { data, meta } = await miscApi.geocode(q);
        setResults(data);
        setState({ loading: false, error: null, source: meta?.source });
        setOpen(true);
      } catch (err) {
        setResults([]);
        setState({ loading: false, error: toApiError(err).message });
      }
    }, 450);
  };

  return (
    <div className="relative">
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <input
        id={id}
        className="input"
        value={query}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange?.({ name: e.target.value }); // free text until a result is chosen
          search(e.target.value);
        }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value?.coordinates ? (
        <p className="mt-1 text-xs text-emerald-700">
          📍 {value.coordinates.lat.toFixed(4)}, {value.coordinates.lng.toFixed(4)}
        </p>
      ) : query.length >= 2 && !state.loading ? (
        <p className="mt-1 text-xs text-ink-500">Pick a result to place it on the map.</p>
      ) : null}
      {state.loading && <p className="mt-1 text-xs text-ink-500">Searching…</p>}
      {state.error && <p className="mt-1 text-xs text-rose-700">{state.error}</p>}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.address}-${i}`} role="option" aria-selected="false">
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange?.({ name: r.name, address: r.address, coordinates: r.coordinates });
                  setQuery(r.name);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{r.name}</span>
                <span className="block truncate text-xs text-ink-500">{r.address}</span>
              </button>
            </li>
          ))}
          <li className="px-3 py-1 text-[11px] text-ink-500">{results[0]?.isDemo ? 'DEMO place data' : 'Search by OpenStreetMap Nominatim'}</li>
        </ul>
      )}
    </div>
  );
}
