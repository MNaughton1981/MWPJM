import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEntry,
  Milestone,
  Project,
  ProjectStatus,
  Settings,
  Trade,
} from '../types';
import type { ImportedWorkOrders } from '../lib/workOrderCsv';
import { DEFAULT_NUVOLO_EMAIL } from '../lib/nuvolo';
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

      deleteProject: (id) =>
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

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
