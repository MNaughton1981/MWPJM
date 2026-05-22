import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectPhoto } from '../types';
import { useStore } from '../state/store';
import { uid } from '../lib/format';
import {
  buildFilename,
  deletePhoto,
  loadPhoto,
  savePhoto,
} from '../lib/photoStorage';

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
  const [busy, setBusy] = useState<'idle' | 'adding' | 'downloading'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const photos = project.photos ?? [];

  // Load thumbnails for the current photo set, revoke object URLs on unmount.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next = new Map<string, string>();
      for (const photo of photos) {
        const blob = await loadPhoto(project.id, photo.id);
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
      }
    } finally {
      setBusy('idle');
    }
  }

  async function downloadOne(photo: ProjectPhoto, seq: number) {
    const blob = await loadPhoto(project.id, photo.id);
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

      <p className="text-[11px] text-slate-500">
        Pattern: <code>{settings.photoNamingPattern}</code> · Edit in Settings.
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
