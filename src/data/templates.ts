import type { Project } from '../types';
import { uid } from '../lib/format';

function emptyCommon(name: string): Pick<
  Project,
  | 'id'
  | 'name'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'trades'
  | 'milestones'
  | 'activity'
  | 'photos'
  | 'vendors'
> {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    status: 'planning',
    createdAt: now,
    updatedAt: now,
    trades: [],
    milestones: [],
    activity: [],
    photos: [],
    vendors: [],
  };
}

/**
 * Default template — a lightweight "Work Order Follow-up" with no
 * trades or milestones, just notes/photos/vendor info. The Project
 * page hides the trade-coordination and timetable sections when
 * `simple: true`.
 */
export function buildWorkOrderFollowupTemplate(name: string): Project {
  return {
    ...emptyCommon(name),
    workOrderId: '',
    description: '',
    simple: true,
  };
}

/**
 * Full-scope template: 18" dishwasher addition alongside existing 24" DW.
 * Mirrors the kitchenette pilot scope (demo base cabinet, add framing,
 * plumb + electrical rough-in, set unit, trim, test).
 */
export function buildDishwasherUpgradeTemplate(name: string): Project {
  const base = emptyCommon(name);
  return {
    ...base,
    location: 'Kitchenette — TBD',
    workOrderId: '',
    description:
      'Add 18" dishwasher alongside existing 24" dishwasher. Remove a base cabinet ' +
      'segment and add wood framing to accommodate the new unit. Pilot-style scope.',
    simple: false,
    trades: [
      {
        id: uid(),
        key: 'carpentry',
        label: 'Carpentry',
        status: 'not_scheduled',
        notes: 'Demo base cabinet segment. Build framing for 18" DW. Reinstall trim panels.',
      },
      {
        id: uid(),
        key: 'plumbing',
        label: 'Plumbing',
        status: 'not_scheduled',
        notes: 'Tee water supply, add shutoff. Drain via high loop or air gap. Leak test.',
      },
      {
        id: uid(),
        key: 'electrical',
        label: 'Electrical',
        status: 'not_scheduled',
        notes: 'Verify circuit capacity. Install dedicated 120V receptacle for new DW.',
      },
    ],
    milestones: [
      { id: uid(), title: 'Site survey & measurements', done: false, trade: 'general' },
      { id: uid(), title: 'Order materials (DW unit, lumber, fittings)', done: false, trade: 'general' },
      { id: uid(), title: 'Demo base cabinet segment', done: false, trade: 'carpentry' },
      { id: uid(), title: 'Build wood framing for new DW opening', done: false, trade: 'carpentry' },
      { id: uid(), title: 'Plumbing rough-in (supply + drain)', done: false, trade: 'plumbing' },
      { id: uid(), title: 'Electrical receptacle install', done: false, trade: 'electrical' },
      { id: uid(), title: 'Set & connect new 18" DW', done: false, trade: 'plumbing' },
      { id: uid(), title: 'Verify existing 24" DW connections', done: false, trade: 'plumbing' },
      { id: uid(), title: 'Cabinet trim / panel reinstall', done: false, trade: 'carpentry' },
      { id: uid(), title: 'Test cycle (both units) & leak check', done: false, trade: 'general' },
      { id: uid(), title: 'Punch list & final walkthrough', done: false, trade: 'general' },
      { id: uid(), title: 'Close work order', done: false, trade: 'general' },
    ],
  };
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  build: (name: string) => Project;
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'work-order-followup',
    name: 'Work Order Follow-up',
    description:
      'Lightweight project: notes, photos, vendor contacts. No trades or timetable. Default for quick WO tracking.',
    build: buildWorkOrderFollowupTemplate,
  },
  {
    id: 'dishwasher-upgrade',
    name: 'Kitchenette Dishwasher Upgrade (18" + 24")',
    description:
      'Full-scope project with trades + milestones for the kitchenette pilot.',
    build: buildDishwasherUpgradeTemplate,
  },
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start from scratch. Lightweight by default.',
    build: (name: string) => ({
      ...emptyCommon(name),
      simple: true,
    }),
  },
];
