import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BrainCall, BrainSetup } from '../../../shared/types';
import { api } from '../lib/api';

// The settings cog and what it opens: the app's Claude setup, read from the running
// server (GET /api/brain) rather than described here — so what you read is what is
// actually in force. Laid out top-down, the way a call is actually built: the setup
// every call shares, the anatomy of one call, each call in turn, then the rulebook
// they all carry. Read-only: the rulebook is a file in the repo, edited and versioned
// there; this is the instrument panel, not the controls.

/**
 * The cog itself. Mounted twice by the shell (main.tsx / Nav.tsx), each showing at its
 * own breakpoint: `fixed` in the window's right margin at `xl`+, where there is a
 * margin to sit in, and inline in the nav pill below that — where a fixed button would
 * land on top of the page's own nav actions.
 */
export function BrainButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="How this app prompts Claude"
        aria-label="Open Claude setup"
        className={`h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${className}`}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && <BrainPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function BrainPanel({ onClose }: { onClose: () => void }) {
  const [setup, setSetup] = useState<BrainSetup | null>(null);
  const [error, setError] = useState('');

  // Fetched on every open, never cached: the last-run figures are the live half of
  // this panel, and a copy from ten minutes ago would show the wrong prompt.
  useEffect(() => {
    api.getBrain().then(setSetup).catch((e) => setError(e?.message ?? 'Could not load the setup'));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portalled straight to <body>: the cog that opens this panel is itself mounted
  // inside a `fixed`, z-indexed wrapper (main.tsx's right-margin corner, or the nav
  // pill), which creates its own stacking context — rendered as an ordinary child,
  // this panel's z-50 would only out-rank siblings *within* that wrapper, not the
  // other fixed buttons sharing the corner (account, embed tester), which sit later
  // in the DOM and would paint over it. A portal escapes that context entirely, so
  // the panel is compared against the whole page and always wins.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      {/* Same fixed corner, same h-9 w-9 rounded circle, same border/background as the
          cog button that opens this panel (main.tsx's fixed placement) — so opening
          and closing reads as one button changing icon in place, not two different
          buttons swapping around. z-[60]: above the panel's own z-50. */}
      <button
        onClick={onClose}
        aria-label="Close"
        className="fixed right-3 top-3 z-[60] flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 text-[var(--color-muted)] shadow-sm backdrop-blur transition-colors hover:text-[var(--color-ink)]"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Claude setup"
        className="custom-scroll h-full w-full max-w-3xl overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-wall)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* pr-14: clears the fixed close button above, which sits outside this
            padded flow and would otherwise overlap the title. */}
        <div className="pr-14">
          <h2 className="serif text-2xl">How TasteTrainer thinks</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Every Claude call this app makes, what goes into it, and what the code checks
            afterwards — read live from the server.
          </p>
        </div>

        {error && <p className="mt-6 text-sm text-[var(--color-accent)]">{error}</p>}
        {!setup && !error && <p className="mt-6 text-sm text-[var(--color-muted)]">Loading…</p>}

        {setup && (
          <div className="mt-6 space-y-8">
            <Section title="1 · The setup every call shares">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Model" value={setup.model} />
                <Stat
                  label="Claude proxy"
                  value={setup.proxyConfigured ? 'Connected' : 'No secret set'}
                  warn={!setup.proxyConfigured}
                />
                <Stat label="Call time limit" value={formatDuration(setup.timeoutMs)} />
                <Stat label="Rulebook" value={`${setup.rules.length.toLocaleString()} chars`} />
              </dl>
              {!setup.proxyConfigured && (
                <p className="text-sm text-[var(--color-accent)]">
                  This server has no HF_APP_SECRET, so every call below will fail until it’s set.
                </p>
              )}
            </Section>

            <Section
              title="2 · The anatomy of one call"
              blurb="Every call below is built and handled the same way. Only the task prompt differs."
            >
              <ol className="space-y-2">
                <Step n="a" title="System prompt — identical for every call">
                  <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--color-wall-soft)] p-2 text-xs">{setup.systemTemplate}</pre>
                  The whole rulebook (section 4) is re-read from disk and sent each time, so
                  an edit takes effect on the next call with no restart.
                </Step>
                <Step n="b" title="Task prompt — one template per call">
                  Assembled in code from your data: the world, the topic, subtopics, periods,
                  existing items. Section 3 lists what goes into each, and shows the last one
                  actually sent.
                </Step>
                <Step n="c" title="One message in, JSON out">
                  A single user message with no conversation history; this server sends no tool
                  settings (so web search depends on the proxy, not on this app). The reply is
                  streamed, parsed as JSON, and re-asked once if it isn’t valid.
                </Step>
                <Step n="d" title="Guardrails in code">
                  Anything mechanical — counts, duplicates, off-list subtopics, a settled map —
                  is enforced after the reply rather than trusted to the prompt.
                </Step>
                <Step n="e" title="You decide">
                  Research is shown for review before anything is saved.
                </Step>
              </ol>
            </Section>

            <Section
              title="3 · The calls"
              blurb={`Last-run figures are held in server memory, since it started ${formatWhen(setup.serverStartedAt)} — a restart clears them.`}
            >
              {(['field', 'world'] as const).map((level) => (
                <div key={level} className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    {level === 'field' ? 'Inside one field' : 'Across a whole world'}
                  </h4>
                  {setup.calls.filter((c) => c.level === level).map((c) => (
                    <CallCard key={c.id} call={c} />
                  ))}
                </div>
              ))}
            </Section>

            <Section
              title="4 · The rulebook"
              blurb={`${setup.rulesPath} — sent in full with every call. Edit the file to change how Claude curates; no code change needed.`}
            >
              {splitRules(setup.rules).map((s) => (
                <details
                  key={s.heading}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2"
                >
                  <summary className="cursor-pointer text-sm">
                    {s.heading}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {s.body.length.toLocaleString()} chars
                    </span>
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{s.body}</pre>
                </details>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function CallCard({ call }: { call: BrainCall }) {
  const run = call.lastRun;
  return (
    <details className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2">
      <summary className="cursor-pointer">
        <span className="text-sm font-medium">{call.name}</span>
        {/* The at-a-glance measure, readable without opening the card. */}
        <span className="ml-2 text-xs text-[var(--color-muted)]">
          {run
            ? `${run.ok ? 'ok' : 'failed'} · ${formatDuration(run.durationMs)} · ${formatWhen(run.at)}`
            : 'not run since restart'}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{call.trigger}</span>
      </summary>

      <div className="mt-3 space-y-3 text-sm">
        <p>{call.purpose}</p>
        <Field label="Goes in">
          <ul className="list-disc space-y-0.5 pl-5">
            {call.inputs.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </Field>
        <Field label="Comes back">
          <code className="text-xs">{call.output}</code>
        </Field>
        <Field label="Rules it leans on">{call.rules.join(' · ')}</Field>
        <Field label="Enforced in code">
          <ul className="list-disc space-y-0.5 pl-5">
            {call.guardrails.map((g) => <li key={g}>{g}</li>)}
          </ul>
        </Field>
        <Field label="Survives closing the browser">{call.durable ? 'Yes — a durable job' : 'No — live only'}</Field>

        {run && (
          <Field label="Last real run">
            <p className="text-xs text-[var(--color-muted)]">
              {formatWhen(run.at)} · {formatDuration(run.durationMs)} · system{' '}
              {run.systemChars.toLocaleString()} + prompt {run.promptChars.toLocaleString()} chars
              {run.retried ? ' · re-asked once (invalid JSON)' : ''}
            </p>
            {run.error && <p className="text-xs text-[var(--color-accent)]">{run.error}</p>}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs underline underline-offset-4">
                The exact prompt sent
              </summary>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-wall-soft)] p-2 text-xs">{run.prompt}</pre>
            </details>
          </Field>
        )}
      </div>
    </details>
  );
}

function Section({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="serif text-lg">{title}</h3>
        {blurb && <p className="text-sm text-[var(--color-muted)]">{blurb}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2">
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm ${warn ? 'text-[var(--color-accent)]' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2">
      <span className="serif text-[var(--color-accent)]">{n}</span>
      <div className="min-w-0 text-sm text-[var(--color-muted)]">
        <p className="text-[var(--color-ink)]">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h5 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</h5>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** The rulebook cut at its `## ` headings, so each section opens on its own. Whatever
 *  precedes the first heading is the preamble. */
function splitRules(rules: string): Array<{ heading: string; body: string }> {
  const parts = rules.split(/^## /m);
  const sections = [{ heading: 'Preamble', body: parts[0].replace(/^# .*\n/, '').trim() }];
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    sections.push({
      heading: (nl === -1 ? part : part.slice(0, nl)).trim(),
      body: nl === -1 ? '' : part.slice(nl + 1).trim(),
    });
  }
  return sections.filter((s) => s.body);
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}
