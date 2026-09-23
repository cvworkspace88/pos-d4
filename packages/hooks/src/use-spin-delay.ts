import { useEffect, useRef, useState } from 'react';

// Ported from spin-delay (https://github.com/smeijer/spin-delay/blob/main/src/index.ts),
// MIT License, Copyright (c) 2020 Stephan Meijer. Changes: typed the timeout ref, lint
// suppressions for upstream's setState-in-effect design.

export interface SpinDelayOptions {
  /**
   * The delay in milliseconds before the spinner is displayed.
   * @default 500
   */
  delay?: number;
  /**
   * The minimum duration in milliseconds the spinner is displayed.
   * @default 200
   */
  minDuration?: number;
  /**
   * Whether to enable the spinner on the server side. If true, `delay` will be
   * ignored, and the spinner will be shown immediately if `loading` is true.
   * @default true
   */
  ssr?: boolean;
}

type State = 'IDLE' | 'DELAY' | 'DISPLAY' | 'EXPIRE';

export const defaultOptions = {
  delay: 500,
  minDuration: 200,
  ssr: true,
};

function useIsSSR() {
  const [isSSR, setIsSSR] = useState(true);

  useEffect(() => {
    // The one extra render after mount is the point: it is how the hook learns it left the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSSR(false);
  }, []);

  return isSSR;
}

/**
 * `loading`, smoothed for a spinner: a load shorter than `delay` never shows one, and once shown it
 * stays up at least `minDuration`, so a fast answer does not blink.
 */
export function useSpinDelay(loading: boolean, options?: SpinDelayOptions): boolean {
  const { delay, minDuration, ssr } = { ...defaultOptions, ...options };

  const isSSR = useIsSSR() && ssr;
  const initialState = isSSR && loading ? 'DISPLAY' : 'IDLE';
  const [state, setState] = useState<State>(initialState);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (loading && (state === 'IDLE' || isSSR)) {
      clearTimeout(timeout.current);

      timeout.current = setTimeout(
        () => {
          if (!loading) {
            return setState('IDLE');
          }

          timeout.current = setTimeout(() => {
            setState('EXPIRE');
          }, minDuration);

          setState('DISPLAY');
        },
        isSSR ? 0 : delay,
      );

      if (!isSSR) {
        // Upstream's state machine steps on `loading` changes, which only an effect can observe.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState('DELAY');
      }
    }

    if (!loading && state !== 'DISPLAY') {
      clearTimeout(timeout.current);
      setState('IDLE');
    }
  }, [loading, state, delay, minDuration, isSSR]);

  useEffect(() => {
    return () => clearTimeout(timeout.current);
  }, []);

  return state === 'DISPLAY' || state === 'EXPIRE';
}
