import type { TrackingMode } from './types';

export interface ActivityDef {
  id: string;
  label: string;
  emoji: string;
  unit: string;
  tracking: TrackingMode;
  defaultTarget: number;
  /** Sanity ceiling for a single day, enforced client- and server-side. */
  maxDaily: number;
  /** Shown on the create screen so organizers know what they are choosing. */
  blurb?: string;
}

/**
 * Every activity declares how it is logged.
 *
 * The mode is a property of the activity, not a separate choice, because the
 * right answer is almost always obvious: you count push-ups, you time prayer,
 * and asking "how many prayers today?" is the wrong question. Only 'custom'
 * leaves the decision to the organizer.
 */
export const ACTIVITIES: ActivityDef[] = [
  // --- counted by the camera ------------------------------------------------
  { id: 'pushups', label: 'Push-ups', emoji: '💪', unit: 'reps', tracking: 'cv', defaultTarget: 100, maxDaily: 2000, blurb: 'Counted by your camera' },
  { id: 'squats', label: 'Squats', emoji: '🦵', unit: 'reps', tracking: 'cv', defaultTarget: 100, maxDaily: 2000, blurb: 'Counted by your camera' },
  { id: 'situps', label: 'Sit-ups', emoji: '🧎', unit: 'reps', tracking: 'cv', defaultTarget: 100, maxDaily: 2000, blurb: 'Counted by your camera' },

  // --- timed ---------------------------------------------------------------
  { id: 'plank', label: 'Plank', emoji: '⏱️', unit: 'seconds', tracking: 'timer', defaultTarget: 120, maxDaily: 7200, blurb: 'Timed in the app' },
  { id: 'prayer', label: 'Prayer / devotion', emoji: '🙏', unit: 'minutes', tracking: 'timer', defaultTarget: 30, maxDaily: 1440, blurb: 'Timed in the app' },
  { id: 'study', label: 'Study / deep work', emoji: '🧠', unit: 'minutes', tracking: 'timer', defaultTarget: 60, maxDaily: 1440, blurb: 'Timed in the app' },
  { id: 'reading_time', label: 'Reading (timed)', emoji: '📖', unit: 'minutes', tracking: 'timer', defaultTarget: 30, maxDaily: 1440, blurb: 'Timed in the app' },
  { id: 'exercise_time', label: 'Workout (timed)', emoji: '🏋️', unit: 'minutes', tracking: 'timer', defaultTarget: 45, maxDaily: 1440, blurb: 'Timed in the app' },

  // --- yes / no ------------------------------------------------------------
  { id: 'habit', label: 'Daily habit (yes/no)', emoji: '✅', unit: 'day', tracking: 'checkin', defaultTarget: 1, maxDaily: 1, blurb: 'One tap: done today' },
  { id: 'nosugar', label: 'Abstain (no sugar, etc.)', emoji: '🚫', unit: 'day', tracking: 'checkin', defaultTarget: 1, maxDaily: 1, blurb: 'One tap: done today' },

  // --- self-reported numbers -----------------------------------------------
  { id: 'steps', label: 'Steps', emoji: '👟', unit: 'steps', tracking: 'manual', defaultTarget: 8000, maxDaily: 200000, blurb: 'Read off your phone’s health app' },
  { id: 'running', label: 'Running / walking', emoji: '🏃', unit: 'km', tracking: 'manual', defaultTarget: 5, maxDaily: 500, blurb: 'You enter the distance' },
  { id: 'reading', label: 'Reading (pages)', emoji: '📚', unit: 'pages', tracking: 'manual', defaultTarget: 20, maxDaily: 5000, blurb: 'You enter the pages' },
  { id: 'writing', label: 'Writing', emoji: '✍️', unit: 'words', tracking: 'manual', defaultTarget: 500, maxDaily: 100000, blurb: 'You enter the words' },
  { id: 'water', label: 'Water', emoji: '💧', unit: 'glasses', tracking: 'manual', defaultTarget: 8, maxDaily: 50, blurb: 'You enter the count' },
  { id: 'custom', label: 'Something else', emoji: '⭐', unit: 'count', tracking: 'manual', defaultTarget: 1, maxDaily: 100000, blurb: 'You choose how it is logged' },
];

export function getActivity(id: string): ActivityDef {
  return ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[ACTIVITIES.length - 1];
}

export function activityLabel(id: string): string {
  return getActivity(id).label;
}

/** Which camera-counted exercise this activity maps to, if any. */
export function cvExercise(id: string): 'pushups' | 'squats' | 'situps' | null {
  return id === 'pushups' || id === 'squats' || id === 'situps' ? id : null;
}

export const MODE_LABEL: Record<TrackingMode, string> = {
  cv: 'AUTO',
  timer: 'TIMER',
  checkin: 'CHECK',
  manual: 'MANUAL',
};
