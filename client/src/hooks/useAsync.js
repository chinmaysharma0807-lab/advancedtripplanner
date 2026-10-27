import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../services/api';

/** Run an async loader with loading / error / data state; `reload` re-runs it. */
export function useAsync(loader, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ loading: immediate, error: null, data: undefined });
  const mounted = useRef(true);
  const latest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async ({ silent = false } = {}) => {
      const id = ++latest.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await loader();
        if (mounted.current && id === latest.current) setState({ loading: false, error: null, data });
        return data;
      } catch (err) {
        if (mounted.current && id === latest.current) setState((s) => ({ ...s, loading: false, error: toApiError(err) }));
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  useEffect(() => {
    if (immediate) run();
  }, [run, immediate]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: run, setData };
}
