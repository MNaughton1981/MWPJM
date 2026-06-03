import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectPhoto } from '../types';
import { useStore } from '../state/store';
import { uid } from '../lib/format';
import {
  buildFilename,
  deletePhoto,
  loadPhoto,
  savePhoto,
  savePhotoToFolder,
  loadPhotoFromFolder,
  deletePhotoFromFolder,
} from '../lib/photoStorage';
import {
  getStoredFolderName,
  isFolderApiSupported,
} from '../lib/folderConnection';

interface Props {
  project: Project;
}

/**
 * Photos section for a project. Stores photo blobs in IndexedDB and
 * exposes per-photo download with auto-generated filenames following the
 * configured naming pattern. Per-photo caption editing is the main UX
 * differentiator vs. the OS file picker — that's where you encode the
 * descriptive part of the filename for fast Nuvolo upload later.
 */
export default function PhotosSection({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addPhotoMeta = useStore((s) => s.addPhotoMeta);
  const updatePhotoMeta = useStore((s) => s.updatePhotoMeta);
  const removePhotoMeta = useStore((s) => s.removePhotoMeta);

  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<
    'idle' | 'adding' | 'downloading' | 'backing-up'
  >('idle');
  const [folderConnected, setFolderConnected] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const photos = project.photos ?? [];

  // Photos subfolder under the connected Data folder (default 'photos').
  const photosSubfolder = (settings.photosSubfolder || 'photos').trim() || 'photos';
  // Folder-backed photo storage is desktop-only (File System Access API)
  // AND requires a connected folder. On mobile this stays false, so the
  // app silently keeps the IndexedDB-only behavior.
  const canFolderSync = isFolderApiSupported() && folderConnected;

  useEffect(() => {
    getStoredFolderName().then((name) => setFolderConnected(!!name));
  }, []);

  // Load thumbnails for the current photo set, revoke object URLs on unmount.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next = new Map<string, string>();
      for (const photo of photos) {
        let blob = await loadPhoto(project.id, photo.id);
        // Fallback: blob isn't in this device's IndexedDB (e.g. metadata
        // synced from another desktop) but a folder copy exists — read it
        // back from the OneDrive-synced folder, then re-cache locally so
        // the next load is instant and this device owns a copy too.
        if (!blob && photo.folderPath) {
          const fromFolder = await loadPhotoFromFolder(photo.folderPath);
          if (fromFolder) {
            blob = fromFolder;
            savePhoto(project.id, photo.id, fromFolder).catch(() => undefined);
          }
        }
        if (cancelled) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          created.push(url);
          next.set(photo.id, url);
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
    // We intentionally re-run when photos array identity changes
    // (add/remove) — captions don't need a thumbnail reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, photos.length]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy('adding');
    try {
      for (const file of Array.from(files)) {
        const id = uid();
        await savePhoto(project.id, id, file);
        const photo: ProjectPhoto = {
          id,
          mimeType: file.type || 'image/jpeg',
          originalName: file.name,
          caption: '',
          capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
          addedAt: new Date().toISOString(),
          size: file.size,
        };
        addPhotoMeta(project.id, photo);
        // Best-effort backup into the connected Data folder (desktop
        // only). Failures (no folder, permission denied) are swallowed —
        // the photo still lives in IndexedDB, same as before.
        if (canFolderSync) {
          try {
            const rel = await savePhotoToFolder(
              photosSubfolder,
              project.id,
              id,
              file.name,
              file,
            );
            updatePhotoMeta(project.id, id, { folderPath: rel });
          } catch {
            // keep IndexedDB-only
          }
        }
      }
    } finally {
      setBusy('idle');
    }
  }

  /**
   * Back up every photo that doesn't yet have a folder copy into the
   * connected Data folder. Covers photos captured before folder sync
   * existed, or on a device that only just connected the folder.
   * Desktop-only (gated by canFolderSync at the call site).
   */
  async function backupPhotosToFolder() {
    setBusy('backing-up');
    setBackupMsg(null);
    let done = 0;
    let skipped = 0;
    try {
      for (const photo of photos) {
        if (photo.folderPath) {
          skipped++;
          continue;
        }
        const blob = await loadPhoto(project.id, photo.id);
        if (!blob) {
          skipped++;
          continue;
        }
        try {
          const rel = await savePhotoToFolder(
            photosSubfolder,
            project.id,
            photo.id,
            photo.originalName,
            blob,
          );
          updatePhotoMeta(project.id, photo.id, { folderPath: rel });
          done++;
        } catch (e) {
          setBackupMsg(`Backup stopped: ${(e as Error).message}`);
          return;
        }
      }
      setBackupMsg(
        done === 0
          ? `All photos already backed up to ${photosSubfolder}/.`
          : `✓ Backed up ${done} photo${done !== 1 ? 's' : ''} to ${photosSubfolder}/${skipped ? ` (${skipped} already done)` : ''}.`,
      );
    } finally {
      setBusy('idle');
    }
  }

  async function downloadOne(photo: ProjectPhoto, seq: number) {
    let blob = await loadPhoto(project.id, photo.id);
    if (!blob && photo.folderPath) {
      blob = await loadPhotoFromFolder(photo.folderPath);
    }
    if (!blob) return;
    const filename = buildFilename({
      pattern: settings.photoNamingPattern,
      workOrderId: project.workOrderId,
      projectName: project.name,
      caption: photo.caption,
      capturedAt: photo.capturedAt,
      seq,
      originalName: photo.originalName,
    });
    triggerDownload(blob, filename);
  }

  async function downloadAll() {
    setBusy('downloading');
    try {
      for (let i = 0; i < photos.length; i++) {
        await downloadOne(photos[i], i + 1);
        // Small spacing so browsers don't block subsequent downloads.
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setBusy('idle');
    }
  }

  async function remove(photo: ProjectPhoto) {
    if (!window.confirm(`Remove this photo from the project?`)) return;
    await deletePhoto(project.id, photo.id);
    // Best-effort cleanup of the folder copy so we don't orphan binaries
    // in the OneDrive folder. No-op on mobile / when not connected.
    if (photo.folderPath) {
      deletePhotoFromFolder(photo.folderPath).catch(() => undefined);
    }
    removePhotoMeta(project.id, photo.id);
  }

  function previewName(photo: ProjectPhoto, seq: number): string {
    return buildFilename({
      pattern: settings.photoNamingPattern,
      workOrderId: project.workOrderId,
      projectName: project.name,
      caption: photo.caption,
      capturedAt: photo.capturedAt,
      seq,
      originalName: photo.originalName,
    });
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Photos</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary text-xs"
            onClick={() => cameraRef.current?.click()}
            disabled={busy !== 'idle'}
            title="Open camera (mobile)"
          >
            📷 Take photo
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== 'idle'}
          >
            + Add photos
          </button>
          {photos.length > 1 && (
            <button
              className="btn-primary text-xs"
              onClick={downloadAll}
              disabled={busy !== 'idle'}
              title="Download every photo with the configured naming pattern"
            >
              {busy === 'downloading' ? 'Downloading…' : '⬇ Download all renamed'}
            </button>
          )}
          {canFolderSync && photos.length > 0 && (
            <button
              className="btn-secondary text-xs"
              onClick={backupPhotosToFolder}
              disabled={busy !== 'idle'}
              title={`Copy any not-yet-backed-up photos into the "${photosSubfolder}" subfolder of your connected Data folder (syncs via OneDrive).`}
            >
              {busy === 'backing-up' ? 'Backing up…' : '☁ Back up to folder'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500">
          No photos yet. Add or capture photos here, give each a short
          caption, then download with the auto-generated filename ready for
          Nuvolo upload.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {photos.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              thumbUrl={thumbs.get(photo.id)}
              filenamePreview={previewName(photo, i + 1)}
              onCaption={(caption) =>
                updatePhotoMeta(project.id, photo.id, { caption })
              }
              onDownload={() => downloadOne(photo, i + 1)}
              onRemove={() => remove(photo)}
            />
          ))}
        </ul>
      )}

      {backupMsg && (
        <p className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">
          {backupMsg}
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Pattern: <code>{settings.photoNamingPattern}</code> · Edit in Settings.
        {canFolderSync ? (
          <>
            {' '}· New photos are backed up to{' '}
            <code>{photosSubfolder}/</code> in your connected folder.
          </>
        ) : (
          <>
            {' '}· Photos are stored on this device. Connect a folder on a
            desktop browser to back them up to OneDrive.
          </>
        )}
      </p>
    </section>
  );
}

function PhotoCard({
  photo,
  thumbUrl,
  filenamePreview,
  onCaption,
  onDownload,
  onRemove,
}: {
  photo: ProjectPhoto;
  thumbUrl: string | undefined;
  filenamePreview: string;
  onCaption: (caption: string) => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="border border-slate-200 rounded-lg overflow-hidden flex flex-col bg-white">
      <div className="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={photo.caption || photo.originalName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-xs text-slate-400">loading…</span>
        )}
      </div>
      <div className="p-3 space-y-2">
        <input
          className="input text-sm"
          placeholder="Caption (e.g. plumbing rough-in)"
          value={photo.caption}
          onChange={(e) => onCaption(e.target.value)}
        />
        <div
          className="text-[11px] font-mono text-slate-500 break-all"
          title="Filename used on download"
        >
          {filenamePreview}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            {(photo.size / 1024).toFixed(0)} KB · {photo.originalName}
          </span>
          <div className="flex gap-1">
            <button
              className="btn-ghost text-xs"
              onClick={onDownload}
              title="Download with the renamed filename"
            >
              ⬇
            </button>
            <button
              className="text-slate-300 hover:text-rose-600 px-1 text-sm"
              onClick={onRemove}
              title="Remove photo"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
