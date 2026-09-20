import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isMapOp, opGroup, type ChangeOp, type Changeset } from '../../../../shared/chat';
import type { Subtopic } from '../../../../shared/types';
import { Photo } from '../Photo';

// The approval gate, as a diff (shared/chat.ts's Changeset). What a pull request is to
// a folder of code, this is to your datasets: everything Claude proposed, grouped by the
// dataset it touches, green for what would arrive and red for what would go — and
// nothing written until you say so.
//
// One default worth knowing: everything starts TICKED (it is what you asked for, and
// undo exists) except removals, which start UNTICKED — a deletion is only ever a thing
// you did on purpose.

type Decide = (
  changesetId: string,
  action: 'apply' | 'discard' | 'revert',
  body?: { opIds?: string[]; force?: boolean },
) => Promise<void>;

const open = (op: ChangeOp) => op.status === 'pending' || op.status === 'conflict';
/** Things that take something away: red in the diff, and never ticked for you. */
const destructive = (op: ChangeOp) =>
  op.kind === 'item.remove' ||
  op.kind === 'dataset.delete' ||
  (op.kind === 'map.draw' && op.replaces) ||
  (op.kind === 'map.region' && op.action === 'remove');
const tickedByDefault = (op: ChangeOp) => op.status === 'pending' && !destructive(op);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function summarise(ops: ChangeOp[]): string {
  const count = (kind: ChangeOp['kind']) => ops.filter((o) => o.kind === kind).length;
  const parts = [
    count('dataset.create') && plural(count('dataset.create'), 'new dataset'),
    count('item.add') && plural(count('item.add'), 'addition'),
    count('item.update') && plural(count('item.update'), 'edit'),
    count('item.move') && plural(count('item.move'), 'move'),
    count('item.remove') && plural(count('item.remove'), 'removal'),
    count('dataset.update') && plural(count('dataset.update'), 'dataset change'),
    count('dataset.delete') && plural(count('dataset.delete'), 'dataset deletion'),
    ops.some(isMapOp) && plural(ops.filter(isMapOp).length, 'map change'),
  ].filter(Boolean);
  return parts.join(' · ');
}

// ---- Word-level diff, for prose fields ----

type Piece = { text: string; kind: 'same' | 'del' | 'add' };

/** Longest-common-subsequence diff over whitespace-split tokens. Descriptions are a
 *  sentence or three, so the quadratic table is a few thousand cells at most. */
function diffWords(before: string, after: string): Piece[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length * b.length > 250_000) return [{ text: before, kind: 'del' }, { text: after, kind: 'add' }];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: Piece[] = [];
  const push = (text: string, kind: Piece['kind']) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(a[i], 'same'); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push(a[i], 'del'); i += 1; }
    else { push(b[j], 'add'); j += 1; }
  }
  while (i < a.length) { push(a[i], 'del'); i += 1; }
  while (j < b.length) { push(b[j], 'add'); j += 1; }
  return out;
}

const DEL = 'rounded-sm bg-red-100 text-red-900 line-through decoration-red-400/70';
const ADD = 'rounded-sm bg-emerald-100 text-emerald-900';

function FieldDiff({ label, before, after }: { label: string; before: unknown; after: unknown }) {
  const was = before == null || before === '' ? '' : String(before);
  const now = after == null || after === '' ? '' : String(after);
  const prose = was.length > 40 || now.length > 40;
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-xs leading-relaxed">
      <span className="pt-px text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      {label === 'image' ? (
        <span className="flex items-center gap-2">
          {was && <img src={was} alt="" className="h-12 w-16 rounded border-2 border-red-300 object-cover opacity-70" />}
          <span className="text-[var(--color-muted)]">→</span>
          {now && <img src={now} alt="" referrerPolicy="no-referrer" className="h-12 w-16 rounded border-2 border-emerald-400 object-cover" />}
        </span>
      ) : prose && was ? (
        <span>
          {diffWords(was, now).map((p, n) => (
            <span key={n} className={p.kind === 'del' ? DEL : p.kind === 'add' ? ADD : undefined}>{p.text}</span>
          ))}
        </span>
      ) : (
        <span>
          {was ? <span className={DEL}>{was}</span> : <span className="italic text-[var(--color-muted)]">empty</span>}
          <span className="mx-1.5 text-[var(--color-muted)]">→</span>
          {now ? <span className={ADD}>{now}</span> : <span className="italic text-[var(--color-muted)]">empty</span>}
        </span>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  name: 'name', description: 'why great', year: 'year', brand: 'maker', creator: 'creator',
  definingFact: 'fact', subtopic: 'subtopic', url: 'url', image: 'image', imageKind: 'image kind',
  imageQuery: 'image search', wikipediaTitle: 'wikipedia', topic: 'name',
};

function NameListDiff({ label, before, after }: { label: string; before: string[]; after: string[] }) {
  const gone = before.filter((n) => !after.includes(n));
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-2 text-xs leading-relaxed">
      <span className="pt-px text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      <span className="flex flex-wrap gap-1">
        {gone.map((n) => <span key={`-${n}`} className={`${DEL} px-1`}>{n}</span>)}
        {after.map((n) => (
          <span key={n} className={before.includes(n) ? 'rounded-sm bg-[var(--color-wall-soft)] px-1' : `${ADD} px-1`}>{n}</span>
        ))}
      </span>
    </div>
  );
}

// ---- One op ----

function OpBody({ op, topics }: { op: ChangeOp; topics: Record<string, string> }) {
  switch (op.kind) {
    case 'item.add': {
      const it = op.item;
      return (
        <div className="flex gap-3">
          <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded border border-[var(--color-line)] bg-[var(--color-wall-soft)]">
            {it.image ? (
              <Photo src={it.image} alt={it.name} />
            ) : (
              <span className={`absolute inset-0 grid place-items-center px-1 text-center text-[10px] text-[var(--color-muted)] ${op.imagePending ? 'animate-pulse' : ''}`}>
                {op.imagePending ? 'finding a picture…' : 'no picture yet'}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="serif text-sm">
              <span className={`${ADD} px-1`}>+ {it.name}</span>
              <span className="ml-2 text-[var(--color-muted)]">{[it.year, it.brand || it.creator, it.subtopic].filter(Boolean).join(' · ')}</span>
            </p>
            {it.description && <p className="mt-1">{it.description}</p>}
            {it.definingFact && <p className="mt-0.5 italic text-[var(--color-muted)]">{it.definingFact}</p>}
          </div>
        </div>
      );
    }
    case 'item.update':
      return (
        <div className="space-y-1">
          <p className="serif text-sm">{op.itemName}</p>
          {Object.keys(op.patch).map((key) => (
            <FieldDiff key={key} label={FIELD_LABELS[key] ?? key} before={(op.before as any)[key]} after={(op.patch as any)[key]} />
          ))}
        </div>
      );
    case 'item.remove':
      return (
        <div className="flex gap-3">
          <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded border border-red-200 bg-[var(--color-wall-soft)] opacity-70">
            {op.before.image && <Photo src={op.before.image} alt={op.before.name} />}
          </div>
          <p className="serif min-w-0 flex-1 text-sm">
            <span className={`${DEL} px-1`}>− {op.before.name}</span>
            <span className="ml-2 text-xs text-[var(--color-muted)]">{[op.before.year, op.before.brand || op.before.creator].filter(Boolean).join(' · ')}</span>
          </p>
        </div>
      );
    case 'item.move':
      return (
        <p className="text-xs">
          <span className="serif text-sm">{op.itemName}</span>
          <span className="ml-2"><span className={`${DEL} px-1`}>{topics[op.datasetId]} / {op.beforeSubtopic || 'unfiled'}</span></span>
          <span className="mx-1.5 text-[var(--color-muted)]">→</span>
          <span className={`${ADD} px-1`}>{topics[op.toDatasetId]} / {op.subtopic}</span>
        </p>
      );
    case 'dataset.update':
      return (
        <div className="space-y-1">
          <p className="serif text-sm">The dataset itself</p>
          {op.patch.topic !== undefined && <FieldDiff label="name" before={op.before.topic} after={op.patch.topic} />}
          {op.patch.description !== undefined && <FieldDiff label="description" before={op.before.description} after={op.patch.description} />}
          {op.patch.subtopics && (
            <NameListDiff
              label="subtopics"
              before={(op.before.subtopics ?? []).map((s: Subtopic) => s.name)}
              after={op.patch.subtopics.map((s) => s.name)}
            />
          )}
          {op.renames && Object.entries(op.renames).map(([from, to]) => (
            <FieldDiff key={from} label="items in" before={from} after={to} />
          ))}
        </div>
      );
    case 'dataset.create':
      return (
        <div className="text-xs leading-relaxed">
          <p className="serif text-sm"><span className={`${ADD} px-1`}>+ New {op.domain} dataset: {op.topic}</span></p>
          <p className="mt-1">{op.description}</p>
          <p className="mt-1 flex flex-wrap gap-1">{op.subtopics.map((s) => <span key={s.name} className={`${ADD} px-1`}>{s.name}</span>)}</p>
        </div>
      );
    case 'dataset.delete':
      return (
        <p className="serif text-sm">
          <span className={`${DEL} px-1`}>− Delete the dataset {op.topic}</span>
          <span className="ml-2 text-xs text-[var(--color-muted)]">only once it is empty</span>
        </p>
      );
    case 'map.draw':
      return (
        <div className="space-y-1.5 text-xs leading-relaxed">
          <p className="serif text-sm">
            <span className={`${op.replaces ? DEL : ADD} px-1`}>{op.replaces ? 'Redraw the map from scratch' : '+ Draw the map'}</span>
          </p>
          <p className="text-[var(--color-muted)]">
            Across: {op.axes.x.label} ({op.axes.x.low} → {op.axes.x.high}) · Up: {op.axes.y.label} ({op.axes.y.low} → {op.axes.y.high})
          </p>
          {op.regions.map((r) => {
            const here = Object.entries(op.assignments).filter(([, regionId]) => regionId === r.id).map(([id]) => op.fieldNames[id] ?? id);
            return (
              <div key={r.id}>
                <p><span className={`${ADD} px-1`}>{r.name}</span> <span className="text-[var(--color-muted)]">{r.description}</span></p>
                {here.length > 0 && <p className="pl-2 text-[var(--color-muted)]">{here.join(' · ')}</p>}
              </div>
            );
          })}
        </div>
      );
    case 'map.region':
      if (op.action === 'update' && op.before) {
        const moved = op.before.x !== op.region.x || op.before.y !== op.region.y;
        return (
          <div className="space-y-1">
            <p className="serif text-sm">Region: {op.before.name}</p>
            {op.before.name !== op.region.name && <FieldDiff label="name" before={op.before.name} after={op.region.name} />}
            {op.before.description !== op.region.description && <FieldDiff label="description" before={op.before.description} after={op.region.description} />}
            {moved && <FieldDiff label="position" before={`${op.before.x}, ${op.before.y}`} after={`${op.region.x}, ${op.region.y}`} />}
          </div>
        );
      }
      return (
        <div className="text-xs leading-relaxed">
          <p className="serif text-sm">
            <span className={`${op.action === 'remove' ? DEL : ADD} px-1`}>{op.action === 'remove' ? '−' : '+'} Region: {op.region.name}</span>
          </p>
          {op.action === 'add' && <p className="mt-1">{op.region.description}</p>}
        </div>
      );
    case 'map.place':
      return (
        <p className="text-xs">
          <span className="serif text-sm">{op.fieldName}</span>
          {op.beforeRegionName && <span className={`ml-2 ${DEL} px-1`}>{op.beforeRegionName}</span>}
          <span className="mx-1.5 text-[var(--color-muted)]">→</span>
          <span className={`${ADD} px-1`}>{op.regionName}</span>
        </p>
      );
    case 'map.ghost':
      return (
        <div className="text-xs leading-relaxed">
          <p className="serif text-sm">
            <span className={`${op.action === 'remove' ? DEL : ADD} px-1`}>
              {op.action === 'remove' ? '− Drop proposed field' : '+ Missing field'}: {op.field.topic}
            </span>
            {op.regionName && <span className="ml-2 text-xs text-[var(--color-muted)]">in {op.regionName}</span>}
          </p>
          {op.action === 'add' && <p className="mt-1">{op.field.description}</p>}
          {op.action === 'add' && op.field.why && <p className="mt-0.5 italic text-[var(--color-muted)]">{op.field.why}</p>}
        </div>
      );
  }
}

function OpRow({
  op, topics, ticked, onTick, onForce,
}: {
  op: ChangeOp;
  topics: Record<string, string>;
  ticked: boolean;
  onTick: (next: boolean) => void;
  onForce: () => void;
}) {
  const adds =
    op.kind === 'item.add' || op.kind === 'dataset.create' || op.kind === 'map.draw' ||
    ((op.kind === 'map.region' || op.kind === 'map.ghost') && op.action === 'add');
  const edge = destructive(op) ? 'border-l-red-400' : adds ? 'border-l-emerald-500' : 'border-l-amber-400';
  const settled = !open(op);
  return (
    <li className={`flex gap-2.5 border-l-2 bg-[var(--color-card)] py-2 pl-2.5 pr-2 ${edge} ${settled ? 'opacity-55' : ''}`}>
      {settled ? (
        <span className="w-4 shrink-0 pt-0.5 text-center text-xs" title={op.status}>
          {op.status === 'applied' ? '✓' : op.status === 'failed' ? '!' : '×'}
        </span>
      ) : (
        <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-claude)]" aria-label="Include this change" />
      )}
      <div className="min-w-0 flex-1">
        <OpBody op={op} topics={topics} />
        {op.why && <p className="mt-1 text-[11px] italic text-[var(--color-muted)]">Claude: {op.why}</p>}
        {op.problem && (
          <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900">
            {op.problem}
            {op.status === 'conflict' && (
              <button type="button" onClick={onForce} className="ml-2 underline underline-offset-2">Apply anyway</button>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

// ---- The review ----

export function ChangesetReview({ changeset, decide, onClose }: { changeset: Changeset; decide: Decide; onClose: () => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(changeset.ops.filter(tickedByDefault).map((o) => o.id)));
  const [busy, setBusy] = useState(false);

  // Claude can keep staging while this is open; new ops arrive ticked by the same rule.
  const known = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    const fresh = changeset.ops.filter((o) => !known.has(o.id));
    fresh.forEach((o) => known.add(o.id));
    const add = fresh.filter(tickedByDefault).map((o) => o.id);
    if (add.length) setTicked((prev) => new Set([...prev, ...add]));
  }, [changeset.ops, known]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pending = changeset.ops.filter(open);
  const chosen = pending.filter((o) => ticked.has(o.id)).map((o) => o.id);
  const groups = useMemo(() => {
    const byDataset = new Map<string, ChangeOp[]>();
    for (const op of changeset.ops) byDataset.set(opGroup(op), [...(byDataset.get(opGroup(op)) ?? []), op]);
    return [...byDataset];
  }, [changeset.ops]);

  const run = async (action: 'apply' | 'discard', body: { opIds?: string[]; force?: boolean }) => {
    setBusy(true);
    await decide(changeset.id, action, body);
    setBusy(false);
  };

  const tickAll = (ops: ChangeOp[], on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const o of ops.filter(open)) on ? next.add(o.id) : next.delete(o.id);
      return next;
    });

  return (
    <div data-changeset-review className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3">
          <div>
            <h2 className="serif text-lg leading-tight">Proposed changes</h2>
            <p className="text-xs text-[var(--color-muted)]">
              {pending.length ? `${summarise(pending)} — nothing is saved until you accept.` : 'All decided.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full text-lg text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]">×</button>
        </header>

        <div className="custom-scroll flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {groups.map(([datasetId, ops]) => {
            const live = ops.filter(open);
            const allOn = live.length > 0 && live.every((o) => ticked.has(o.id));
            return (
              <section key={datasetId}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <h3 className="serif text-base">{changeset.datasetTopics[datasetId] ?? 'Dataset'}</h3>
                  {live.length > 1 && (
                    <button type="button" onClick={() => tickAll(ops, !allOn)} className="text-[11px] text-[var(--color-muted)] underline underline-offset-2">
                      {allOn ? 'untick all' : 'tick all'}
                    </button>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {ops.map((op) => (
                    <OpRow
                      key={op.id}
                      op={op}
                      topics={changeset.datasetTopics}
                      ticked={ticked.has(op.id)}
                      onTick={(on) => tickAll([op], on)}
                      onForce={() => run('apply', { opIds: [op.id], force: true })}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {pending.length > 0 && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)] px-5 py-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run('discard', {})}
              className="text-xs text-[var(--color-muted)] underline underline-offset-2 disabled:opacity-40"
            >
              Discard everything pending
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !chosen.length}
                onClick={() => run('discard', { opIds: chosen })}
                className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Discard ticked
              </button>
              <button
                type="button"
                disabled={busy || !chosen.length}
                onClick={() => run('apply', { opIds: chosen })}
                className="rounded bg-[var(--color-ink)] px-4 py-1.5 text-xs font-medium text-[var(--color-wall)] disabled:opacity-40"
              >
                {busy ? 'Working…' : `Accept ${plural(chosen.length, 'change')}`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

/** The changeset as it sits in the conversation: a one-glance summary, with the way in
 *  to the full diff — or, once applied, the way back out. */
export function ChangesetCard({ changeset, decide, busy }: { changeset: Changeset; decide: Decide; busy: boolean }) {
  const [reviewing, setReviewing] = useState(false);
  const pending = changeset.ops.filter(open);
  const applied = changeset.ops.filter((o) => o.status === 'applied');
  const failed = changeset.ops.filter((o) => o.status === 'failed');
  const topics = [...new Set(changeset.ops.map((o) => changeset.datasetTopics[opGroup(o)]).filter(Boolean))].join(', ');

  let body: ReactNode;
  if (pending.length) {
    body = (
      <>
        <p className="text-sm"><span className="font-medium">{summarise(pending)}</span> <span className="text-[var(--color-muted)]">to {topics}</span></p>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">Waiting for you — nothing is saved yet.{busy && ' Claude may still add more.'}</p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => setReviewing(true)} className="rounded bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-wall)]">
            Review changes
          </button>
          <button type="button" disabled={busy} onClick={() => decide(changeset.id, 'discard', {})} className="text-xs text-[var(--color-muted)] underline underline-offset-2 disabled:opacity-40">
            Discard
          </button>
        </div>
      </>
    );
  } else if (changeset.status === 'applied') {
    body = (
      <p className="text-xs">
        <span className="text-emerald-700">✓ Saved {summarise(applied)}</span> <span className="text-[var(--color-muted)]">to {topics}.</span>
        {failed.length > 0 && <span className="text-amber-800"> {plural(failed.length, 'change')} couldn’t be applied.</span>}
        <button type="button" onClick={() => setReviewing(true)} className="ml-2 underline underline-offset-2">View</button>
        <button type="button" disabled={busy} onClick={() => decide(changeset.id, 'revert')} className="ml-2 underline underline-offset-2 disabled:opacity-40">Undo</button>
      </p>
    );
  } else {
    body = (
      <p className="text-xs text-[var(--color-muted)]">
        {changeset.status === 'reverted' ? 'Undone — those changes were put back.' : 'Discarded — nothing was changed.'}
        <button type="button" onClick={() => setReviewing(true)} className="ml-2 underline underline-offset-2">View</button>
      </p>
    );
  }

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${pending.length ? 'border-[var(--color-claude)]/50 bg-[var(--color-card)]' : 'border-[var(--color-line)]'}`}>
      {body}
      {reviewing && <ChangesetReview changeset={changeset} decide={decide} onClose={() => setReviewing(false)} />}
    </div>
  );
}
