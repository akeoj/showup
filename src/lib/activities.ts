import type { TrackingMode } from './types';

export interface ActivityDef {
  id: string;
  label: string;
  emoji: string;
  unit: string;
  /** 'cv' activities can be counted by the camera; 'manual' are self-reported. */
  tracking: TrackingMode;
  defaultTarget: number;
  /** Sanity ceiling for a single day, enforced client- and server-side. */
  maxDaily: number;
}

/**
 * Only push-ups have a working detector today. Everything else is
 * self-reported — which is what keeps this a challenge platform rather than a
 * push-up app, at close to zero extra cost.
 */
export const ACTIVITIES: ActivityDef[] = [
  { id: 'pushups', label: 'Push-ups', emoji: '💪', unit: 'reps', tracking: 'cv', defaultTarget: 100, maxDaily: 2000 },
  { id: 'squats', label: 'Squats', emoji: '🦵', unit: 'reps', tracking: 'manual', defaultTarget: 100, maxDaily: 2000 },
  { id: 'situps', label: 'Sit-ups', emoji: '🧎', unit: 'reps', tracking: 'manual', defaultTarget: 100, maxDaily: 2000 },
  { id: 'steps', label: 'Steps', emoji: '👟', unit: 'steps', tracking: 'manual', defaultTarget: 8000, maxDaily: 200000 },
  { id: 'running', label: 'Running', emoji: '🏃', unit: 'km', tracking: 'manual', defaultTarget: 5, maxDaily: 500 },
  { id: 'reading', label: 'Reading', emoji: '📖', unit: 'pages', tracking: 'manual', defaultTarget: 20, maxDaily: 5000 },
  { id: 'prayer', label: 'Prayer / devotion', emoji: '🙏', unit: 'minutes', tracking: 'manual', defaultTarget: 30, maxDaily: 1440 },
  { id: 'writing', label: 'Writing', emoji: '✍️', unit: 'words', tracking: 'manual', defaultTarget: 500, maxDaily: 100000 },
  { id: 'study', label: 'Study / deep work', emoji: '🧠', unit: 'minutes', tracking: 'manual', defaultTarget: 60, maxDaily: 1440 },
  { id: 'custom', label: 'Something else', emoji: '⭐', unit: 'count', tracking: 'manual', defaultTarget: 1, maxDaily: 100000 },
];

export function getActivity(id: string): ActivityDef {
  return ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[ACTIVITIES.length - 1];
}

export function activityLabel(id: string): string {
  return getActivity(id).label;
}
