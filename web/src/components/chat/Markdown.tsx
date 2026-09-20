import { Fragment, type ReactNode } from 'react';

// A small Markdown renderer for Claude's replies: headings, paragraphs, lists, quotes,
// rules, fenced code, tables, and inline bold / italic / code / links / images. Written
// here rather than pulled in as a dependency because the subset a chat reply uses is
// small, and because it has to tolerate HALF-WRITTEN Markdown — a reply is rendered
// while it streams, so an unclosed `**` or code fence is the normal case, not an error.
// Everything is built as React nodes; no HTML is ever injected.

const INLINE = /(`[^`\n]+`)|(!\[[^\]\n]*\]\([^)\s]+\))|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(https?:\/\/[^\s<>)\]]+)/g;

const safeUrl = (url: string) => (/^(https?:|mailto:)/i.test(url) ? url : '#');

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    key += 1;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-[var(--color-wall-soft)] px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      const [, alt = '', src = ''] = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token) ?? [];
      out.push(
        <img
          key={key}
          src={safeUrl(src)}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="my-2 max-h-64 rounded border border-[var(--color-line)]"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />,
      );
    } else if (m[3]) {
      const [, label = '', href = ''] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      out.push(
        <a key={key} href={safeUrl(href)} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] underline underline-offset-2">
          {inline(label)}
        </a>,
      );
    } else if (m[4]) {
      out.push(<strong key={key}>{inline(token.slice(2, -2))}</strong>);
    } else if (m[5]) {
      out.push(<em key={key}>{inline(token.slice(1, -1))}</em>);
    } else {
      const href = token.replace(/[.,;:!?]+$/, '');
      out.push(
        <a key={key} href={safeUrl(href)} target="_blank" rel="noreferrer" className="break-all text-[var(--color-accent)] underline underline-offset-2">
          {href}
        </a>,
      );
      if (href.length < token.length) out.push(token.slice(href.length));
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    key += 1;

    if (!line.trim()) { i += 1; continue; }

    // Fenced code. An unclosed fence (still streaming) runs to the end.
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(
        <pre key={key} className="custom-scroll my-2 overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-3 text-xs leading-relaxed">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1].length <= 2 ? 'text-base' : 'text-sm';
      blocks.push(<h4 key={key} className={`serif mt-3 mb-1 font-semibold ${size}`}>{inline(heading[2])}</h4>);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr key={key} className="my-3 border-[var(--color-line)]" />);
      i += 1;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      blocks.push(
        <div key={key} className="custom-scroll my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.8rem]">
            <thead>
              <tr>{head.map((c, n) => <th key={n} className="border-b border-[var(--color-line)] py-1 pr-3 font-semibold">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>{r.map((c, k) => <td key={k} className="border-b border-[var(--color-line)]/60 py-1 pr-3 align-top">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      blocks.push(
        <blockquote key={key} className="my-2 border-l-2 border-[var(--color-line)] pl-3 text-[var(--color-muted)]">
          {inline(body.join(' '))}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length) {
        const m = bullet.exec(lines[i]);
        if (m) {
          items.push({ depth: Math.floor(m[1].length / 2), text: m[3] });
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
        } else break;
        i += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} className={`my-1.5 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, n) => (
            <li key={n} style={it.depth ? { marginLeft: `${it.depth}rem` } : undefined}>{inline(it.text)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // A paragraph: consecutive plain lines, soft-wrapped together.
    // The first line is taken unconditionally: anything that reached here matched no
    // block above (a lone table row, say), and must still be consumed or this loops.
    const para: string[] = [lines[i]];
    i += 1;
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !bullet.test(lines[i]) && !/^\s*>/.test(lines[i]) && !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key} className="my-1.5">
        {para.map((l, n) => <Fragment key={n}>{n > 0 && ' '}{inline(l)}</Fragment>)}
      </p>,
    );
  }

  return <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}
