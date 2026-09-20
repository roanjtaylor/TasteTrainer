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

/** `/:domain/new` and `/:domain/:slug/new` were the curate wizard — name a field, let
 *  Claude map and research it, review the grid, save. Starting or filling a field in the
 *  researched worlds is a conversation with Claude now, so these land back on whatever
 *  the URL was about. (`/personal/new` is a real screen and outranks this route.) */
export function LegacyCurateRedirect() {
  const { domain = '', slug } = useParams();
  return <Navigate to={slug ? `/${domain}/${slug}` : `/${domain}`} replace />;
}
