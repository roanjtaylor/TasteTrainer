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

/** `/:domain/map` and `/:domain/review` were the world-review screen. The map lives on
 *  the shelf and reviewing a world is a conversation with Claude there, so both land on
 *  the shelf. */
export function LegacyMapRedirect() {
  const { domain = '' } = useParams();
  return <Navigate to={`/${domain}`} replace />;
}
