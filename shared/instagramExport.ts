import type { InstagramPostRef } from './types';

// Reading Instagram's data export (Settings → Your information → Download).
//
// your_instagram_activity/likes/liked_posts.json and saved/saved_posts.json are both a
// bare JSON array of the same record: a `timestamp` (unix seconds — when you liked or
// saved it, not when it was posted), an empty `media`, and `label_values`: a list of
// labelled fields, some flat (URL, Caption, Title) and some nested (Hashtags, Owner —
// a `title` with a `dict` of `dict`s of labelled fields). Shared between the browser,
// which reads the files you drop in (components/InstagramImportPanel.tsx), and any
// script that wants to check what an import would do without running one.

interface Labelled {
  label?: string;
  value?: string;
  href?: string;
}
interface Nested {
  title?: string;
  dict?: { dict?: Labelled[]; title?: string }[];
}
interface Row {
  timestamp?: number;
  label_values?: (Labelled | Nested)[];
}

function flat(row: Row, label: string): string {
  for (const lv of row.label_values ?? []) {
    if ('label' in lv && lv.label === label) return lv.href || lv.value || '';
  }
  return '';
}

function nested(row: Row, title: string): Labelled[][] {
  for (const lv of row.label_values ?? []) {
    if ('title' in lv && lv.title === title) return (lv.dict ?? []).map((d) => d.dict ?? []);
  }
  return [];
}

function field(fields: Labelled[], label: string): string {
  return fields.find((f) => f.label === label)?.value ?? '';
}

/**
 * One export file to import refs. `as` says which file it is, so the timestamp lands
 * on the right field; the server keeps both when a post is in both files.
 */
export function parseInstagramExport(source: string, as: 'liked' | 'saved'): InstagramPostRef[] {
  const start = source.indexOf('[');
  if (start < 0) return [];
  const rows = JSON.parse(source.slice(start)) as Row[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): InstagramPostRef | null => {
      const url = flat(row, 'URL');
      if (!/instagram\.com\//.test(url)) return null;
      const owner = nested(row, 'Owner')[0] ?? [];
      const at = typeof row.timestamp === 'number' ? row.timestamp : undefined;
      return {
        url,
        caption: flat(row, 'Caption') || undefined,
        owner: field(owner, 'Username') || undefined,
        ownerName: field(owner, 'Name') || undefined,
        hashtags: nested(row, 'Hashtags')
          .map((h) => field(h, 'Name'))
          .filter(Boolean),
        ...(as === 'liked' ? { likedAt: at } : { savedAt: at }),
      };
    })
    .filter((r): r is InstagramPostRef => r !== null);
}

/** Which file this is, from its name — so several can be dropped in at once. */
export function exportKind(fileName: string): 'liked' | 'saved' | null {
  const n = fileName.toLowerCase();
  if (n.includes('liked')) return 'liked';
  if (n.includes('saved')) return 'saved';
  return null;
}
