import { api } from './api';
import { supabase } from './supabase';

// Uploading your own files (personal world, 9-personal-and-auth.md).
//
// Three steps, two of them ours: ask the server where the file goes and for a
// single-use token; send the bytes STRAIGHT to Supabase Storage with that token (they
// never pass through our server — see server/src/services/personalFiles.ts); then ask
// the server for a signed link so the picture can be shown straight away. The link is
// what goes in `item.image`; the server swaps it for a permanent reference on save.

/** What an <input type="file"> should offer — mirrors the server's accepted types. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

/** Upload one image; resolves to a URL an <img> can show. */
export async function uploadImage(file: File): Promise<string> {
  if (!supabase) throw new Error('Sign-in isn’t configured, so files can’t be uploaded.');
  const { bucket, path, token } = await api.createUpload(file.type);
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return (await api.signFile(path)).url;
}

/** "IMG_2041.jpg" is nobody's idea of a name, but "Wedding day.jpg" is a fine one —
 *  so a file's name becomes the new item's, minus the extension and the separators
 *  cameras and downloads put where spaces belong. */
export function nameFromFile(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
