import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { listAllPhotos, type StoredPhotoBlob } from '../lib/photoStorage';
import type { Project, ProjectPhoto } from '../types';

/**
 * Photo-recovery tool (Settings → Recover photos).
 *
 * Photo binaries live in IndexedDB (`mwpjm-photos`), keyed by
 * `${projectId}/${photoId}`, completely separate from the workboard
 * text in localStorage. When a workboard's text is overwritten — e.g.
 * by importing a cross-device sync file, which replaces the project
 * list but does NOT touch photo blobs — the photos survive as
 * "orphaned" entries whose project id no longer matches any workboard.
 *
 * This component reads those blobs directly from the device, groups
 * them by their original project id, and lets the user either download
 * them or rebuild a workboard around them. Because it recreates the
 * project with its ORIGINAL id, the existing blobs line up and display
 * automatically. It is strictly read-only against IndexedDB.
 */

interface PhotoGroup {
  projectId: string;
  photos: StoredPhotoBlob[];
  totalBytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(blob: Blob): string {
  return (blob.type && blob.type.split('/')[1]) || 'jpg';
}

export default function PhotoRecoverySection() {
  const projects = useStore((s) => s.projects);
  const addProject = useStore((s) => s.addProject);
  const composerDrafts = useStore((s) => s.composerDrafts);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const urlsRef = useRef<Record<string, string>>({});

  const revokeAll = useCallback(() => {
    Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = {};
  }, []);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMsg(null);
    revokeAll();
    try {
      const all = await listAllPhotos();
      const byProject = new Map<string, StoredPhotoBlob[]>();
      all.forEach((p) => {
        const arr = byProject.get(p.projectId);
        if (arr) arr.push(p);
        else byProject.set(p.projectId, [p]);
      });
      const gs: PhotoGroup[] = Array.from(byProject.entries()).map(
        ([projectId, photos]) => ({
          projectId,
          photos,
          totalBytes: photos.reduce((n, x) => n + x.blob.size, 0),
        }),
      );
      const urls: Record<string, string> = {};
      all.forEach((p) => {
        urls[p.key] = URL.createObjectURL(p.blob);
      });
      urlsRef.current = urls;
      setGroups(gs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [revokeAll]);

  useEffect(() => {
    void scan();
    return () => revokeAll();
  }, [scan, revokeAll]);

  const activeIds = new Set(projects.map((p) => p.id));

  function downloadOne(b: StoredPhotoBlob) {
    const a = document.createElement('a');
    a.href = urlsRef.current[b.key] ?? URL.createObjectURL(b.blob);
    a.download = `${b.projectId}_${b.photoId}.${extOf(b.blob)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadGroup(g: PhotoGroup) {
    setMsg(`Downloading ${g.photos.length} photo(s)…`);
    for (const b of g.photos) {
      downloadOne(b);
      await new Promise((r) => setTimeout(r, 400));
    }
    setMsg(
      `Downloaded ${g.photos.length} photo(s) to your Downloads folder. ` +
        `Your browser may ask to allow multiple downloads — tap Allow.`,
    );
  }

  function restoreGroup(g: PhotoGroup) {
    const now = new Date().toISOString();
    const photos: ProjectPhoto[] = g.photos.map((b) => ({
      id: b.photoId,
      mimeType: b.blob.type || 'image/jpeg',
      originalName: `${b.photoId}.${extOf(b.blob)}`,
      caption: '',
      capturedAt: now,
      addedAt: now,
      size: b.blob.size,
    }));
    const proj: Project = {
      id: g.projectId, // original id so the existing blobs line up
      name: `Recovered photos — ${new Date().toLocaleDateString()}`,
      description:
        'Photos recovered from this device after a workboard was overwritten.',
      status: 'planning',
      createdAt: now,
      updatedAt: now,
      trades: [],
      milestones: [],
      activity: [],
      photos,
      vendors: [],
      simple: true,
    };
    addProject(proj);
    setMsg(
      `Restored ${photos.length} photo(s) into a new workboard "Recovered photos". ` +
        `Open the Workboards page to view, caption, and export them.`,
    );
  }

  const orphaned = groups.filter((g) => !activeIds.has(g.projectId));
  const matched = groups.filter((g) => activeIds.has(g.projectId));
  const totalPhotos = groups.reduce((n, g) => n + g.photos.length, 0);

  // Unsent update-box text whose workboard no longer exists. Survives a
  // wholesale import because applySyncedState/merge never clear drafts.
  const orphanedDrafts = Object.entries(composerDrafts).filter(
    ([pid, text]) => text.trim().length > 0 && !activeIds.has(pid),
  );

  return (
    <section id="sec-recovery" className="card p-4 space-y-3 scroll-mt-20">
      <h2 className="font-semibold">🛟 Recover photos &amp; notes from this device</h2>
      <p className="text-sm text-slate-600">
        Photos and unsent update-box text are stored on this device
        separately from workboard records. If a workboard was overwritten
        (for example by importing a sync file), its photos and any draft
        notes usually survive here as &ldquo;orphaned&rdquo; data. This tool
        reads them straight from this device's storage so you can recover
        them. It only reads — nothing is deleted.
      </p>

      {loading && (
        <p className="text-sm text-slate-500">Scanning device storage…</p>
      )}
      {error && (
        <p className="text-sm text-rose-700">
          Could not read photo storage: {error}
        </p>
      )}

      {!loading && !error && (
        <div className="text-sm text-slate-700">
          Found <strong>{totalPhotos}</strong> photo(s) across{' '}
          <strong>{groups.length}</strong> workboard id(s) —{' '}
          <strong>{orphaned.length}</strong> orphaned (no matching workboard).
        </div>
      )}

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      {orphaned.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Orphaned photos (likely your lost workboard)
          </h3>
          {orphaned.map((g) => (
            <div key={g.projectId} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-slate-500 font-mono">
                  id: {g.projectId} · {g.photos.length} photo(s) ·{' '}
                  {formatBytes(g.totalBytes)}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => void downloadGroup(g)}
                  >
                    ⬇ Download all
                  </button>
                  <button
                    className="btn-primary text-xs"
                    onClick={() => restoreGroup(g)}
                  >
                    ♻ Restore as workboard
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {g.photos.map((b) => (
                  <button
                    key={b.key}
                    onClick={() => downloadOne(b)}
                    title="Tap to download this photo"
                    className="block"
                  >
                    <img
                      src={urlsRef.current[b.key]}
                      alt={b.photoId}
                      className="w-full h-24 object-cover rounded border"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {orphanedDrafts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">
            Leftover notes from lost workboards
          </h3>
          <p className="text-xs text-slate-500">
            Unsent text from a workboard's update box that outlived the
            workboard itself. Copy anything you need.
          </p>
          {orphanedDrafts.map(([pid, text]) => (
            <div key={pid} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 font-mono">
                  id: {pid}
                </span>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => {
                    if (navigator.clipboard) {
                      void navigator.clipboard.writeText(text);
                      setMsg('Note text copied to clipboard.');
                    }
                  }}
                >
                  ⧉ Copy text
                </button>
              </div>
              <textarea
                readOnly
                value={text}
                className="w-full h-32 text-sm border rounded p-2 font-mono"
              />
            </div>
          ))}
        </div>
      )}

      {matched.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">
            {matched.length} workboard(s) with photos still attached (no action
            needed)
          </summary>
          <ul className="mt-2 list-disc pl-5 text-slate-600">
            {matched.map((g) => (
              <li key={g.projectId}>
                {projects.find((p) => p.id === g.projectId)?.name ??
                  g.projectId}{' '}
                — {g.photos.length} photo(s)
              </li>
            ))}
          </ul>
        </details>
      )}

      <button className="btn-secondary text-xs" onClick={() => void scan()}>
        ↻ Re-scan
      </button>
    </section>
  );
}
