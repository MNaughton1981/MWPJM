import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEntry,
  Milestone,
  Project,
  ProjectPhoto,
  ProjectStatus,
  Settings,
  Trade,
} from '../types';
import type { ImportedWorkOrders } from '../lib/workOrderCsv';
import { DEFAULT_NUVOLO_EMAIL, DEFAULT_WO_URL_PATTERN } from '../lib/nuvolo';
import {
  DEFAULT_PHOTO_NAMING_PATTERN,
  deleteProjectPhotos,
} from '../lib/photoStorage';
import { uid } from '../lib/format';

interface AppState {
  projects: Project[];
  settings: Settings;
  workOrders: ImportedWorkOrders | null;

  // Project CRUD
  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // Trades
  addTrade: (projectId: string, t: Omit<Trade, 'id'>) => void;
  updateTrade: (projectId: string, tradeId: string, patch: Partial<Trade>) => void;
  removeTrade: (projectId: string, tradeId: string) => void;

  // Milestones
  addMilestone: (projectId: string, m: Omit<Milestone, 'id'>) => void;
  updateMilestone: (projectId: string, milestoneId: string, patch: Partial<Milestone>) => void;
  removeMilestone: (projectId: string, milestoneId: string) => void;

  // Activity
  addActivity: (projectId: string, entry: Omit<ActivityEntry, 'id'>) => void;
  removeActivity: (projectId: string, entryId: string) => void;

  // Photos (metadata only — blobs live in IndexedDB)
  addPhotoMeta: (projectId: string, photo: ProjectPhoto) => void;
  updatePhotoMeta: (
    projectId: string,
    photoId: string,
    patch: Partial<ProjectPhoto>,
  ) => void;
  removePhotoMeta: (projectId: string, photoId: string) => void;

  // Settings
  setSettings: (patch: Partial<Settings>) => void;

  // Work orders (imported from Nuvolo CSV)
  setWorkOrders: (data: ImportedWorkOrders | null) => void;

  // Bulk import/export
  replaceAll: (data: { projects: Project[]; settings: Settings }) => void;
}

const defaultSettings: Settings = {
  technicianName: '',
  nuvoloEmail: DEFAULT_NUVOLO_EMAIL,
  reportFolderPath:
    'C:\\Users\\mnaughto\\OneDrive - MathWorks\\Projects\\Nuvolo Dev\\fegpjm\\reports\\open_work_orders',
  photoNamingPattern: DEFAULT_PHOTO_NAMING_PATTERN,
  userEmail: '',
  nuvoloWorkOrderUrlPattern: DEFAULT_WO_URL_PATTERN,
};

function touch(p: Project): Project {
  return { ...p, updatedAt: new Date().toISOString() };
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      projects: [],
      settings: defaultSettings,
      workOrders: null,

      addProject: (p) =>
        set((s) => ({ projects: [p, ...s.projects] })),

      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? touch({ ...p, ...patch }) : p,
          ),
        })),

      deleteProject: (id) => {
        // Fire-and-forget cleanup of any photos in IndexedDB. We don't
        // block the UI on this; if it fails the orphaned blobs are harmless.
        deleteProjectPhotos(id).catch(() => undefined);
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
      },

      addTrade: (projectId, t) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, trades: [...p.trades, { ...t, id: uid() }] })
              : p,
          ),
        })),

      updateTrade: (projectId, tradeId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  trades: p.trades.map((t) =>
                    t.id === tradeId ? { ...t, ...patch } : t,
                  ),
                })
              : p,
          ),
        })),

      removeTrade: (projectId, tradeId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, trades: p.trades.filter((t) => t.id !== tradeId) })
              : p,
          ),
        })),

      addMilestone: (projectId, m) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, milestones: [...p.milestones, { ...m, id: uid() }] })
              : p,
          ),
        })),

      updateMilestone: (projectId, milestoneId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  milestones: p.milestones.map((m) =>
                    m.id === milestoneId ? { ...m, ...patch } : m,
                  ),
                })
              : p,
          ),
        })),

      removeMilestone: (projectId, milestoneId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  milestones: p.milestones.filter((m) => m.id !== milestoneId),
                })
              : p,
          ),
        })),

      addActivity: (projectId, entry) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  activity: [{ ...entry, id: uid() }, ...p.activity],
                })
              : p,
          ),
        })),

      removeActivity: (projectId, entryId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  activity: p.activity.filter((a) => a.id !== entryId),
                })
              : p,
          ),
        })),

      addPhotoMeta: (projectId, photo) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, photos: [...(p.photos ?? []), photo] })
              : p,
          ),
        })),

      updatePhotoMeta: (projectId, photoId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  photos: (p.photos ?? []).map((ph) =>
                    ph.id === photoId ? { ...ph, ...patch } : ph,
                  ),
                })
              : p,
          ),
        })),

      removePhotoMeta: (projectId, photoId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  photos: (p.photos ?? []).filter((ph) => ph.id !== photoId),
                })
              : p,
          ),
        })),

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setWorkOrders: (data) => set(() => ({ workOrders: data })),

      replaceAll: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
        })),
    }),
    {
      name: 'mwpjm-store-v1',
      version: 1,
    },
  ),
);

export function setProjectStatus(id: string, status: ProjectStatus) {
  useStore.getState().updateProject(id, { status });
}
