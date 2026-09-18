import { useState, type ReactNode } from 'react';

/** What the user chose to run. Both end in a review-before-save proposal; they differ
 *  in who writes the brief — Claude (a sweep for blind spots) or you (a direct ask). */
export type ReviewChoice =
  | { mode: 'sweep'; focus: string }
  | { mode: 'direct'; prompt: string; count: number };

// The step between pressing "Review" and a Claude call starting. The button used to
// kick off a gap sweep instantly, which made the sweep the ONLY way to grow a dataset:
// knowing exactly what you wanted ("more Japanese makers") still meant waiting out a
// whole-field audit first, then phrasing the ask as a "steer" the prompt was told to
// treat as a hypothesis. The two questions — "what am I not seeing?" and "get me this"
// — are different, so they are now two modes, chosen here.
export function ReviewDialog({
  topic,
  onStart,
  onCancel,
}: {
  topic: string;
  onStart: (choice: ReviewChoice) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'sweep' | 'direct'>('sweep');
  const [focus, setFocus] = useState('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(8);

  const canStart = mode === 'sweep' || prompt.trim().length > 0;

  function start() {
    if (!canStart) return;
    onStart(
      mode === 'sweep'
        ? { mode, focus: focus.trim() }
        : { mode, prompt: prompt.trim(), count: Math.max(1, Math.min(50, count || 8)) },
    );
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Review ${topic}`}
        className="w-full max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="serif text-xl">Review {topic}</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Either way, anything Claude finds is shown for review before it’s saved.
        </p>

        <div className="mt-4 space-y-3">
          <ModeOption
            selected={mode === 'sweep'}
            onSelect={() => setMode('sweep')}
            title="Find what I’m missing"
            blurb="Claude sweeps the whole field and reports what’s thin or absent — for the gaps you don’t know to ask about."
          >
            <label className="block">
              <span className="text-sm text-[var(--color-muted)]">
                Look closer at anything? (optional)
              </span>
              <input
                className={inputClass}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && start()}
                placeholder="e.g. the pre-war period — the rest of the field is still swept"
              />
            </label>
          </ModeOption>

          <ModeOption
            selected={mode === 'direct'}
            onSelect={() => setMode('direct')}
            title="Ask for something specific"
            blurb="Write the brief yourself, as you would to Claude directly. No sweep — it researches what you ask for."
          >
            <label className="block">
              <span className="text-sm text-[var(--color-muted)]">Your request</span>
              <textarea
                autoFocus
                className={inputClass}
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. More Japanese independents from the 1970s–90s, especially ones that influenced the Swiss houses."
              />
            </label>
            <label className="mt-2 block">
              <span className="text-sm text-[var(--color-muted)]">Up to how many</span>
              <input
                type="number"
                min={1}
                max={50}
                className="mt-1 block w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </ModeOption>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm hover:bg-[var(--color-wall-soft)]"
          >
            Cancel
          </button>
          <button
            onClick={start}
            disabled={!canStart}
            className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {mode === 'sweep' ? 'Start sweep →' : 'Research this →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  blurb,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        selected
          ? 'border-[var(--color-accent)]/60 bg-[var(--color-wall-soft)]'
          : 'border-[var(--color-line)]'
      }`}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="block w-full text-left">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className={`h-3 w-3 shrink-0 rounded-full border ${
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                : 'border-[var(--color-muted)]'
            }`}
          />
          {title}
        </span>
        <span className="mt-1 block text-sm text-[var(--color-muted)]">{blurb}</span>
      </button>
      {/* Only the chosen mode's inputs are shown, so the dialog reads as one decision
          followed by its details rather than two forms side by side. */}
      {selected && <div className="mt-3">{children}</div>}
    </div>
  );
}
