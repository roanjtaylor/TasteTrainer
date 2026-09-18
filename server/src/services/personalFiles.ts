import { supabase } from '../supabase.ts';
import { PERSONAL_BUCKET, SUPABASE_URL } from '../config.ts';
import { newId } from '../util.ts';
import type { Dataset } from '../../../shared/types.ts';

// Your own files, kept private (9-personal-and-auth.md).
//
// Every other image in the app is a public web address, which is why `Item.image` is
// "URL only, never downloaded" (2-data.md). A family photo has no public address and
// must never get one, so the personal world is the exception: the file lives in a
// PRIVATE Supabase Storage bucket, and what reaches the browser is a signed URL — a
// link that works for a limited time and then stops.
//
// That creates two spellings of the same image, and this module is the only place
// that knows both:
//   • STORED  — `storage://taste-personal/<path>`: permanent, useless to anyone
//     without the service-role key. This is what sits in the database.
//   • SERVED  — `https://…/storage/v1/object/sign/taste-personal/<path>?token=…`:
//     what `<img src>` needs. Minted on read, never persisted.
// storage.ts converts stored→served on every read and served→stored on every write,
// so the rest of the app — browse, the editor — keeps treating `image` as a plain URL
// and never learns that private files exist.

const REF_PREFIX = `storage://${PERSONAL_BUCKET}/`;
const SIGNED_MARKER = `/storage/v1/object/sign/${PERSONAL_BUCKET}/`;

/** How long a served link works. Long enough that a tab left open all week still
 *  shows its pictures; the client re-reads datasets far more often than this, and
 *  every read mints fresh links. */
const SIGNED_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Image types only: `Item.image` is rendered by an <img>, so anything else would
 *  upload fine and then show as a broken picture. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export function isAcceptedType(contentType: string): boolean {
  return contentType.toLowerCase() in EXTENSIONS;
}

/** Compared by project ref (the host's first label) rather than the whole origin:
 *  Storage can answer on `<ref>.storage.supabase.co` as well as `<ref>.supabase.co`. */
function isOwnHost(url: string): boolean {
  try {
    return new URL(url).hostname.split('.')[0] === new URL(SUPABASE_URL).hostname.split('.')[0];
  } catch {
    return false;
  }
}

/**
 * The bucket path an image refers to, from EITHER spelling — or null for an ordinary
 * web image. Accepting both is what makes the write path safe: the client sends back
 * whatever it was served, and a served link must never be what gets stored (it would
 * work for a week and then break for good).
 */
export function storagePathOf(image: string | undefined): string | null {
  if (!image) return null;
  if (image.startsWith(REF_PREFIX)) return image.slice(REF_PREFIX.length);
  const at = image.indexOf(SIGNED_MARKER);
  // Only our own project's links — a lookalike path on another host is just a URL.
  if (at === -1 || !isOwnHost(image)) return null;
  const path = image.slice(at + SIGNED_MARKER.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

/** Every private file a dataset's items point at. */
export function storagePathsIn(ds: Pick<Dataset, 'items'>): string[] {
  return ds.items.map((it) => storagePathOf(it.image)).filter((p): p is string => !!p);
}

/** Served → stored, for the database. Returns the same object when nothing changes. */
export function toStoredImages(ds: Dataset): Dataset {
  let changed = false;
  const items = ds.items.map((it) => {
    const path = storagePathOf(it.image);
    if (!path || it.image === REF_PREFIX + path) return it;
    changed = true;
    return { ...it, image: REF_PREFIX + path };
  });
  return changed ? { ...ds, items } : ds;
}

/** Stored → served, for the browser. One signing call per dataset, not per item. */
export async function toServedImages(ds: Dataset): Promise<Dataset> {
  const paths = [...new Set(storagePathsIn(ds))];
  if (!paths.length) return ds;

  const { data, error } = await supabase.storage
    .from(PERSONAL_BUCKET)
    .createSignedUrls(paths, SIGNED_TTL_SECONDS);
  if (error) throw new Error(`Could not sign personal files: ${error.message}`);

  const signed = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
  }
  return {
    ...ds,
    items: ds.items.map((it) => {
      const path = storagePathOf(it.image);
      // A file that has gone missing reads as "needs image" rather than a dead link.
      return path ? { ...it, image: signed.get(path) ?? '' } : it;
    }),
  };
}

let bucketReady: Promise<void> | null = null;
/** Self-provisioning, the same way the screenshot bucket is (screenshotRender.ts) —
 *  with the one difference that matters: `public: false`. */
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = supabase.storage
      .createBucket(PERSONAL_BUCKET, {
        public: false,
        allowedMimeTypes: Object.keys(EXTENSIONS),
        fileSizeLimit: '25MB',
      })
      .then(({ error }) => {
        if (error && !/already exists|duplicate/i.test(error.message)) {
          // Don't cache a real failure — worth retrying on the next call.
          bucketReady = null;
          throw new Error(`Could not create the private bucket "${PERSONAL_BUCKET}": ${error.message}`);
        }
      });
  }
  return bucketReady;
}

/**
 * Permission to upload ONE file straight from the browser to the bucket.
 *
 * The file never passes through this server: photos are several megabytes each, a
 * batch of them is far more than the JSON body limit, and proxying them would spend
 * this small server's memory on bytes it has no use for. The server's part is only to
 * decide the path and hand over a single-use token for it.
 */
export async function createUpload(
  userId: string,
  contentType: string,
): Promise<{ path: string; token: string }> {
  const ext = EXTENSIONS[contentType.toLowerCase()];
  if (!ext) throw new Error('Only image files can be uploaded (JPEG, PNG, WebP, GIF, AVIF).');
  // A generated name, not the file's own: the path ends up inside URLs, and
  // "Mum & Dad's wedding (1).JPG" is a needless source of encoding bugs. The original
  // name is kept where it's useful — as the new item's name (web/src/lib/files.ts).
  await ensureBucket();
  const path = `${userId}/${newId()}.${ext}`;
  const { data, error } = await supabase.storage.from(PERSONAL_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? 'Could not start the upload.');
  return { path, token: data.token };
}

/** The served link for a file that was just uploaded, so it can be shown at once. */
export async function signOne(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PERSONAL_BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (error || !data) throw new Error(error?.message ?? 'Could not sign that file.');
  return data.signedUrl;
}

/** Delete files nothing points at any more. Best-effort by design: an orphaned file
 *  costs a few megabytes, a failed save because cleanup failed costs the user's edit. */
export async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(PERSONAL_BUCKET).remove(paths);
  if (error) console.warn('[files] could not remove', paths.length, 'file(s):', error.message);
}
