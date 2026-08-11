import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  DOMAIN_LABELS,
  slugifyTopic,
  type BoundaryIssue,
  type FieldMapReview,
  type MapSuggestion,
  type WorldMap,
} from '../../../shared/types';
import { api } from '../lib/api';
import { publishWorldMap, saveWorldMap, useWorldMap } from '../lib/data';
import { useDomain } from '../lib/domain';
import { NavActions } from '../lib/navActions';

// The world review (8-field-map.md) — the level above "what's missing?".
//
// Every other AI call in this app looks INSIDE one field. This one looks at the shelf:
// is the set of fields you've built a good map of this world, and what aren't you
// seeing? It exists because a map assembled one topic at a time inherits the blind
// spots you had when you named the topics — the failure mode where the tool quietly
// confirms your starting understanding instead of widening it.
//
// Running it also draws and updates the world's map. The map itself lives on the shelf
// (`/:domain`); this screen is where it gets generated, and where the changes a later
// review proposes are accepted or dismissed. That split is deliberate: the map should
// only ever change because you said so.
export function WorldReview() {
  const domain = useDomain();
  const { data: map, set: setMap } = useWorldMap(domain);
  const [review, setReview] = useState<FieldMapReview | null>(null);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The prose half of the last review is durable on the map (`lastReview`) so it
  // survives a reload. Only backfills an empty `review` — a fresh check() below sets
  // it directly and this effect must never clobber that with a stale map.
  useEffect(() => {
    if (map?.lastReview) setReview((r) => r ?? map.lastReview!);
  }, [map]);

  if (!domain) return <Navigate to="/" replace />;

  async function check(redraw = false) {
    if (!domain) return;
    if (
      redraw &&
      !confirm(
        "Redraw this world's map from scratch?\n\nThe axes, the regions, and everywhere you've " +
          'moved a card will be replaced. Your datasets are not affected.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setProgress('');
    setReview(null);
    try {
      const { map: nextMap, ...result } = await api.reviewFieldMap(domain, setProgress, redraw);
      setReview(result);
      publishWorldMap(domain, nextMap);
      setMap(nextMap);
    } catch (e: any) {
      setError(e?.message ?? 'Review failed');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function resolve(suggestion: MapSuggestion, accept: boolean) {
    if (!domain) return;
    try {
      setMap(
        await saveWorldMap(
          domain,
          accept ? { accept: suggestion.id } : { dismiss: suggestion.id },
        ),
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not update the map');
    }
  }

  // Per-card state, keyed by the boundary issue's index — several of these can sit on
  // screen at once and each runs its own Claude call independently.
  const [boundaryBusy, setBoundaryBusy] = useState<Record<number, boolean>>({});
  const [boundaryProgress, setBoundaryProgress] = useState<Record<number, string>>({});
  const [boundaryError, setBoundaryError] = useState<Record<number, string>>({});

  async function acceptBoundaryFix(i: number, b: BoundaryIssue) {
    if (!domain) return;
    if (
      !confirm(
        `Apply this fix?\n\n${b.proposal}\n\nClaude will work out the concrete change and carry ` +
          "it out directly — this can rename, split or delete datasets, and there's no undo.",
      )
    ) {
      return;
    }
    setBoundaryBusy((s) => ({ ...s, [i]: true }));
    setBoundaryError((s) => ({ ...s, [i]: '' }));
    try {
      const result = await api.applyBoundaryFix(
        { domain, kind: b.kind, fields: b.fields, proposal: b.proposal, why: b.why },
        (line) => setBoundaryProgress((s) => ({ ...s, [i]: line })),
      );
      if (result.map) {
        publishWorldMap(domain, result.map);
        setMap(result.map);
      }
      // The issue is handled — drop it from the list on screen rather than waiting for
      // the next full review to notice it's gone. Filtered by reference (not index),
      // so this stays correct even if another card's accept resolves in between.
      setReview((r) => (r ? { ...r, boundaryIssues: r.boundaryIssues.filter((x) => x !== b) } : r));
    } catch (e: any) {
      setBoundaryError((s) => ({ ...s, [i]: e?.message ?? 'Could not apply this fix' }));
    } finally {
      setBoundaryBusy((s) => ({ ...s, [i]: false }));
      setBoundaryProgress((s) => ({ ...s, [i]: '' }));
    }
  }

  const hasMap = !!map && map.regions.length > 0;

  return (
    <div className="space-y-8">
      <NavActions>
        <button
          onClick={() => check(false)}
          disabled={busy}
          className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm text-[var(--color-wall)] disabled:opacity-40"
        >
          {busy ? progress || 'Reviewing…' : hasMap ? 'Review again' : 'Check this world →'}
        </button>
        {hasMap && !busy && (
          <button
            onClick={() => check(true)}
            title="Throw the current map away and draw a new one"
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            Redraw from scratch
          </button>
        )}
      </NavActions>

      <header className="mt-4">
        <h1 className="serif text-4xl">
          Review the {DOMAIN_LABELS[domain].short.toLowerCase()} world
        </h1>
        {busy && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            A first draw of a well-stocked world takes a few minutes — it's writing the whole
            map in one pass. The button above keeps moving while it works.
          </p>
        )}
      </header>

      {error && <p className="text-[var(--color-accent)]">{error}</p>}

      {/* Suggestions outlive a single review — they sit on the stored map until you
          deal with them, so closing the tab mid-decision doesn't lose them. */}
      {map && map.suggestions.length > 0 && (
        <Section
          title="Changes to the map"
          note="Accepting one edits the map on the shelf. Nothing changes until you say so."
          empty={null}
        >
          <div className="space-y-3">
            {map.suggestions.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
              >
                <div className="min-w-[16rem] flex-1">
                  <p className="font-medium">{describe(s, map)}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{s.why}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => resolve(s, true)}
                    className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => resolve(s, false)}
                    className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {map && hasMap && <MapSettings domain={domain} map={map} onChanged={setMap} />}

      {review && (
        <div className="space-y-10">
          {review.mapSummary && (
            <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-6">
              <h2 className="serif text-2xl">How this world divides</h2>
              <p className="mt-3 leading-relaxed text-[var(--color-muted)]">{review.mapSummary}</p>
            </section>
          )}

          <Section
            title="Fields you don't have yet"
            note="The unknown-unknowns. These also sit on the map as dashed holes — each one starts a new dataset with its topic and description already filled in."
            empty={
              review.missingFields.length === 0
                ? 'No obvious gaps — this map reads as complete.'
                : null
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {review.missingFields.map((f) => (
                <div
                  key={f.topic}
                  className="flex flex-col rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-card)] p-5"
                >
                  <h3 className="serif text-xl leading-tight">{f.topic}</h3>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{f.description}</p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed">{f.why}</p>
                  <Link
                    to={`/${domain}/new?topic=${encodeURIComponent(f.topic)}&description=${encodeURIComponent(f.description)}`}
                    className="mt-4 self-start rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white"
                  >
                    Curate this →
                  </Link>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Boundaries drawn wrong"
            note="Fields that should merge, split, or be renamed. Accepting hands the fix to Claude, which works out the concrete result and applies it — there's no undo, so read the proposal first."
            empty={
              review.boundaryIssues.length === 0
                ? 'The boundaries between your fields look sound.'
                : null
            }
          >
            <div className="space-y-3">
              {review.boundaryIssues.map((b, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="rounded-full bg-[var(--color-wall-soft)] px-3 py-0.5 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                      {b.kind}
                    </span>
                    <span className="serif text-lg">{b.fields.join(' + ')}</span>
                  </div>
                  <p className="mt-2">{b.proposal}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{b.why}</p>
                  {boundaryError[i] && (
                    <p className="mt-2 text-sm text-[var(--color-accent)]">{boundaryError[i]}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => acceptBoundaryFix(i, b)}
                      disabled={!!boundaryBusy[i]}
                      className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white disabled:opacity-40"
                    >
                      {boundaryBusy[i] ? boundaryProgress[i] || 'Applying…' : 'Accept changes'}
                    </button>
                    {/* A way to go look before committing, or to make the change by
                        hand instead of trusting the automated plan. */}
                    {b.fields.map((f) => (
                      <Link
                        key={f}
                        to={`/${domain}/${slugifyTopic(f)}`}
                        className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
                      >
                        Open {f} →
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Fields that look thin"
            note="Judged from item counts, subtopics and year spans only."
            empty={
              review.thinFields.length === 0 ? 'Every field looks reasonably built out.' : null
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {review.thinFields.map((t) => (
                <div
                  key={t.topic}
                  className="flex flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
                >
                  <Link to={`/${domain}/${slugifyTopic(t.topic)}`} className="hover:underline">
                    <h3 className="serif text-lg leading-tight">{t.topic}</h3>
                  </Link>
                  <p className="mt-1 flex-1 text-sm text-[var(--color-muted)]">{t.detail}</p>
                  {/* Jumps straight to the field with its gap sweep already running —
                      the item-level pass this card's own judgement can't replace. */}
                  <Link
                    to={`/${domain}/${slugifyTopic(t.topic)}?expand=1`}
                    className="mt-4 self-start rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white"
                  >
                    Expand dataset →
                  </Link>
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

/** Plain English for a proposed change, resolving ids the user never sees. */
function describe(s: MapSuggestion, map: WorldMap): string {
  const regionName = (id: string) => map.regions.find((r) => r.id === id)?.name ?? id;
  switch (s.kind) {
    case 'add-region':
      return `Add a region: ${s.region.name}`;
    case 'move-field':
      return `Move a field into ${regionName(s.toRegionId)}`;
    case 'rename-region':
      return `Rename ${regionName(s.regionId)} to ${s.name}`;
  }
}

/**
 * The map's own words, editable.
 *
 * Axes and region names are the labels you read the whole map through, and the model
 * only gets one attempt at them (they're settled after the first review, by design).
 * So they're plain text inputs: if Claude's first pass at "what are the two dimensions
 * of the digital world" is weak, you fix it here rather than re-rolling the map.
 */
function MapSettings({
  domain,
  map,
  onChanged,
}: {
  domain: 'physical' | 'digital';
  map: WorldMap;
  onChanged: (map: WorldMap) => void;
}) {
  const [axes, setAxes] = useState(map.axes);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(map.regions.map((r) => [r.id, r.name])),
  );
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const dirty =
    JSON.stringify(axes) !== JSON.stringify(map.axes) ||
    map.regions.some((r) => names[r.id]?.trim() && names[r.id].trim() !== r.name);

  async function save() {
    setSaving(true);
    try {
      onChanged(await saveWorldMap(domain, { axes, regionNames: names }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="serif text-2xl">The map's labels</span>
        <span className="text-sm text-[var(--color-muted)]">{open ? 'Hide' : 'Edit'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-sm text-[var(--color-muted)]">
            The two dimensions this world is laid out on, and the names of its regions. Claude
            proposes these once and then leaves them alone — so this is where you correct them.
          </p>

          {(['x', 'y'] as const).map((k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-3">
              {(['label', 'low', 'high'] as const).map((part) => (
                <label key={part} className="block">
                  <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
                    {k === 'x' ? 'Across' : 'Up'} · {part === 'label' ? 'name' : part}
                  </span>
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-1.5 text-sm"
                    value={axes[k][part]}
                    onChange={(e) =>
                      setAxes((a) => ({ ...a, [k]: { ...a[k], [part]: e.target.value } }))
                    }
                  />
                </label>
              ))}
            </div>
          ))}

          <div className="grid gap-2 sm:grid-cols-2">
            {map.regions.map((r) => (
              <label key={r.id} className="block">
                <span className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  Region
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-1.5 text-sm"
                  value={names[r.id] ?? r.name}
                  onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)] disabled:opacity-30"
          >
            {saving ? 'Saving…' : 'Save labels'}
          </button>
        </div>
      )}
    </section>
  );
}

function Section({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note: string;
  /** Text to show instead of the children when the section came back empty. */
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="serif text-2xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{note}</p>
      </div>
      {empty ? <p className="text-[var(--color-muted)]">{empty}</p> : children}
    </section>
  );
}
