import { Navigate, useParams } from 'react-router-dom';
import { slugifyTopic } from '../../../shared/types';
import { useDataset } from '../lib/data';

// Addresses from before datasets were named in the URL: /datasets and
// /dataset/<uuid>. They're in browser histories, open tabs and bookmarks, so rather
// than dropping people at a blank screen these resolve to the new address — the
// dataset itself names both halves of it (its domain and its topic).
export function LegacyDatasetRedirect() {
  const { id = '' } = useParams();
  const { data: ds, error } = useDataset(id || null);

  if (error) return <Navigate to="/" replace />;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;
  return <Navigate to={`/${ds.domain}/${slugifyTopic(ds.topic)}`} replace />;
}

/** `/:domain/map` was the review screen before the world had an actual map. The map
 *  now lives on the shelf, so the name would point at the wrong thing — send it to
 *  the review, which is what that address always meant. */
export function LegacyMapRedirect() {
  const { domain = '' } = useParams();
  return <Navigate to={`/${domain}/review`} replace />;
}
