/**
 * Photo binary sync via the connected OneDrive folder.
 *
 * The cross-device state file (mwpjm-state.json) deliberately carries
 * only photo *metadata* — the binaries are too large to ship inside it.
 * This module syncs the actual image blobs as individual files in a
 * `photos` subfolder of the connected OneDrive folder, so they
 * replicate device-to-device the same way the state file does.
 *
 * Each photo is stored as one file named `${projectId}__${photoId}.ext`,
 * which makes it self-describing: any device can match a folder file
 * back to the workboard + photo it belongs to without a manifest.
 *
 * CONSTRAINT: like the rest of folder access, this only works on a
 * desktop Chromium browser (the File System Access API doesn't exist on
 * mobile). The phone's path for getting its photos out remains the
 * per-board "Send to desktop" share; once those land on a desktop and
 * are attached, this sync propagates them to your other desktops.
 *
 * The sync is two-way and idempotent:
 *   - Local blob present, not in folder  -> upload it.
 *   - Local blob missing, file in folder -> download it into IndexedDB.
 *   - Present on both / neither           -> left alone.
 * It never deletes anything on either side.
 */

import { getSubfolderHandle, isFolderApiSupported } from './folderConnection';
import { loadPhoto, savePhoto } from './photoStorage';
import type { Project } from '../types';

const SEP = '__';

function extFromMime(mimeType: string): string {
  const e = (mimeType && mimeType.split('/')[1]) || 'jpg';
  return e === 'jpeg' ? 'jpg' : e;
}

/** `${projectId}__${photoId}.ext` — stable, parseable, no slashes. */
function photoFileName(
  projectId: string,
  photoId: string,
  mimeType: string,
): string {
  return `${projectId}${SEP}${photoId}.${extFromMime(mimeType)}`;
}

export interface PhotoSyncResult {
  uploaded: number;
  downloaded: number;
  errors: number;
  /** Referenced by a workboard but present on neither device nor folder. */
  missing: number;
}

/**
 * Reconcile this device's photo blobs with the OneDrive photos subfolder.
 * Returns counts for surfacing in the UI. Desktop-only (folder API).
 */
export async function syncPhotos(
  projects: Project[],
  photosSubfolder: string,
): Promise<PhotoSyncResult> {
  if (!isFolderApiSupported()) {
    throw new Error(
      'Photo sync needs a desktop Chromium browser (Chrome/Edge) with a connected folder.',
    );
  }
  const dir = await getSubfolderHandle(photosSubfolder || 'photos', {
    create: true,
  });
  if (!dir) {
    throw new Error('Could not open the photos subfolder.');
  }

  const dirAny = dir as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>;
    getFileHandle: (
      name: string,
      opts?: { create?: boolean },
    ) => Promise<FileSystemFileHandle>;
  };

  // Snapshot existing filenames so we can skip re-uploads and know what's
  // available to pull down.
  const existing = new Set<string>();
  for await (const entry of dirAny.values()) {
    if (entry.kind === 'file') existing.add(entry.name);
  }

  let uploaded = 0;
  let downloaded = 0;
  let errors = 0;
  let missing = 0;

  for (const p of projects) {
    for (const photo of p.photos) {
      const fname = photoFileName(p.id, photo.id, photo.mimeType);
      const localBlob = await loadPhoto(p.id, photo.id);

      if (localBlob) {
        if (!existing.has(fname)) {
          try {
            const fh = await dirAny.getFileHandle(fname, { create: true });
            const fhAny = fh as FileSystemFileHandle & {
              createWritable: () => Promise<{
                write: (d: Blob) => Promise<void>;
                close: () => Promise<void>;
              }>;
            };
            const w = await fhAny.createWritable();
            try {
              await w.write(localBlob);
            } finally {
              await w.close();
            }
            existing.add(fname);
            uploaded++;
          } catch {
            errors++;
          }
        }
      } else if (existing.has(fname)) {
        try {
          const fh = await dirAny.getFileHandle(fname, { create: false });
          const file = await fh.getFile();
          await savePhoto(p.id, photo.id, file);
          downloaded++;
        } catch {
          errors++;
        }
      } else {
        missing++;
      }
    }
  }

  return { uploaded, downloaded, errors, missing };
}
