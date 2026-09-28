import { useEffect, useState } from 'react';

// "Mobile" for the app's own screens: one breakpoint (Tailwind's `md`, 48rem), shared
// by the landing page, the world view, the account button and the dataset view, so
// the phone layout switches on everywhere at once rather than at three different widths.
// It's a hook rather than CSS alone because these screens swap whole components (the
// map's sections for its canvas; the embed's browser for the dataset wall), not styles.
const QUERY = '(max-width: 47.99rem)';

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
