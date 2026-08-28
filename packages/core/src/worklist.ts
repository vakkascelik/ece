/**
 * Rooms, tasks and checklists — the 1Place replacement (docs/replacing-1place.md).
 *
 * Grouped by phase rather than by table, the same choice `facilities.ts` makes and
 * for the same reason: the boundary that matters is in the policies, not in the
 * arithmetic, and splitting these three would produce files nobody can find anything
 * in.
 *
 * Same rule as every other module here: **nothing reads a clock.** `now` is a
 * parameter, because every question this module answers is time-relative and a
 * function that calls `Date.now()` cannot be tested at a boundary.
 */

import { daysSince } from './facilities';

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  centreId: string;
  name: string;
  sort: number;
  archivedAt: string | null;
}

/**
 * Display order: the centre's own, then alphabetical inside a tie.
 *
 * Alphabetical alone is wrong for this list and wrong in a way that costs time —
 * a centre reads its rooms youngest-first (Infant, Toddler, Preschool) and putting
 * Carpark at the top of a picker used at speed is a small tax paid every day.
 */
export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Live rooms only, in order. What every picker in the product shows. */
export function liveRooms(rooms: Room[]): Room[] {
  return sortRooms(rooms.filter((r) => r.archivedAt === null));
}

/**
 * A room name by id, for rendering a row that references one.
 *
 * Returns `null` rather than a placeholder when the id is unknown, so the caller
 * decides what an unrecorded room looks like. A room that was archived still
 * resolves — last year's incidents have to stay readable, which is the whole reason
 * archiving exists instead of deletion.
 */
export function roomName(rooms: Room[], roomId: string | null): string | null {
  if (!roomId) return null;
  return rooms.find((r) => r.id === roomId)?.name ?? null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['pending', 'open', 'resolved', 'closed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  open: 'Open',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const TASK_CATEGORIES = ['maintenance', 'hazard', 'other'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  maintenance: 'Maintenance',
  hazard: 'Hazard follow-up',
  other: 'Other',
};

export interface Task {
  id: string;
  centreId: string;
  roomId: string | null;
  title: string;
  detail: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  dueOn: string | null;
  assignedTo: string | null;
  hazardId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Still being carried. The two statuses that mean somebody has to do something. */
export function isTaskLive(task: Task): boolean {
  return task.status === 'pending' || task.status === 'open';
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Live before finished, then worst priority, then oldest due date, then oldest filed.
 *
 * The last key is the one that earns its place, and it is the same argument
 * `compareHazardUrgency` makes: sorting by priority alone puts a critical task filed
 * this morning above a high one that has been open since March, and the March one is
 * the failure — somebody has walked past it two hundred times.
 *
 * A task with no due date sorts after one that has a date at the same priority. Not
 * having said when it is wanted is weaker information than having said, and it should
 * not jump the queue by being vague.
 */
export function compareTaskUrgency(a: Task, b: Task): number {
  const live = (t: Task) => (isTaskLive(t) ? 0 : 1);
  const byLive = live(a) - live(b);
  if (byLive !== 0) return byLive;

  // Finished tasks read best newest-first: the question is "what happened lately".
  if (!isTaskLive(a) && !isTaskLive(b)) {
    return (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt);
  }

  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (byPriority !== 0) return byPriority;

  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export interface TaskSummary {
  live: number;
  critical: number;
  /** Live, and the day it was wanted by has passed. */
  overdue: number;
  clear: boolean;
}

/**
 * What is outstanding, not how many tasks have ever been filed.
 *
 * `clear` ignores finished tasks, so a centre that has closed forty reads the same as
 * one that has filed none — the argument `summariseHazards` and `summarise().clean`
 * both make. A queue that only ever goes up is a queue nobody opens.
 *
 * `today` is the centre's local date, passed in. Comparing a `date` column against a
 * UTC clock would mark a task overdue for the whole New Zealand morning of the day it
 * is actually due.
 */
export function summariseTasks(tasks: Task[], today: string): TaskSummary {
  const live = tasks.filter(isTaskLive);
  return {
    live: live.length,
    critical: live.filter((t) => t.priority === 'critical').length,
    overdue: live.filter((t) => t.dueOn !== null && t.dueOn < today).length,
    clear: live.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

export const CHECKLIST_RESPONSES = ['yes_no', 'yes_no_na', 'text', 'number'] as const;
export type ChecklistResponse = (typeof CHECKLIST_RESPONSES)[number];

export const CHECKLIST_RESPONSE_LABELS: Record<ChecklistResponse, string> = {
  yes_no: 'Yes / No',
  yes_no_na: 'Yes / No / N/A',
  text: 'Written answer',
  number: 'A number',
};

export interface ChecklistTemplate {
  id: string;
  centreId: string;
  name: string;
  folder: string | null;
  recurDays: number | null;
  archivedAt: string | null;
}

export interface ChecklistVersion {
  id: string;
  templateId: string;
  version: number;
  publishedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  versionId: string;
  sort: number;
  prompt: string;
  responseType: ChecklistResponse;
  required: boolean;
  guidance: string | null;
}

export interface ChecklistRun {
  id: string;
  versionId: string;
  centreId: string;
  roomId: string | null;
  dueOn: string | null;
  assignedTo: string | null;
  startedAt: string;
  completedAt: string | null;
  signedBy: string | null;
  note: string | null;
}

export interface ChecklistAnswer {
  id: string;
  runId: string;
  itemId: string;
  value: string;
  note: string | null;
}

/** The version a new run should use: the highest published one, or none. */
export function currentVersion(versions: ChecklistVersion[], templateId: string): ChecklistVersion | null {
  const published = versions
    .filter((v) => v.templateId === templateId && v.publishedAt !== null)
    .sort((a, b) => b.version - a.version);
  return published[0] ?? null;
}

/** The draft being edited, if there is one. At most one per template in practice. */
export function draftVersion(versions: ChecklistVersion[], templateId: string): ChecklistVersion | null {
  return (
    versions
      .filter((v) => v.templateId === templateId && v.publishedAt === null)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export const ITEMS_IN_ORDER = (items: ChecklistItem[], versionId: string): ChecklistItem[] =>
  items.filter((i) => i.versionId === versionId).sort((a, b) => a.sort - b.sort);

/**
 * How far through a run is, and whether it can be signed.
 *
 * `canComplete` mirrors the database trigger rather than replacing it. The trigger is
 * what makes the rule true; this exists so the button can be disabled instead of the
 * write failing, which is the same relationship every capability check in this
 * product has with its policy.
 *
 * `answered` counts every item with a value, required or not, because that is what a
 * progress line means to somebody filling the form in. `remaining` counts only the
 * required ones, because that is what stands between them and finishing.
 */
export interface RunProgress {
  answered: number;
  total: number;
  remaining: number;
  canComplete: boolean;
  /** Items answered "no" — the findings, which are the reason to keep the record. */
  failures: number;
}

export function runProgress(items: ChecklistItem[], answers: ChecklistAnswer[]): RunProgress {
  const answeredIds = new Set(answers.map((a) => a.itemId));
  const required = items.filter((i) => i.required);
  return {
    answered: items.filter((i) => answeredIds.has(i.id)).length,
    total: items.length,
    remaining: required.filter((i) => !answeredIds.has(i.id)).length,
    canComplete: required.every((i) => answeredIds.has(i.id)),
    failures: answers.filter((a) => a.value === 'no').length,
  };
}

/**
 * When this template was last done, how long ago, and whether that is late.
 *
 * `overdue` is `null` when the template states no interval, and callers must render
 * that differently from `false` — identical contract to `drillStatuses` and
 * `sleepStatuses`, and the same reasoning: `false` says "recently enough", `null` says
 * "nobody has said what recently enough means". A green tick against an unmeasured gap
 * is how a product talks a centre into a breach.
 *
 * `lastCompletedAt` of `null` means it has never been done, reported as its own state
 * rather than as an infinite overdue — a template published this morning is not
 * behind.
 */
export interface ChecklistStatus {
  templateId: string;
  lastCompletedAt: string | null;
  daysSince: number | null;
  overdue: boolean | null;
}

export function checklistStatuses(
  templates: ChecklistTemplate[],
  versions: ChecklistVersion[],
  runs: ChecklistRun[],
  now: string,
): ChecklistStatus[] {
  // version id → template id, so a run can be attributed without another query.
  const owner = new Map(versions.map((v) => [v.id, v.templateId]));

  return templates.map((template) => {
    const last = runs
      .filter((r) => r.completedAt !== null && owner.get(r.versionId) === template.id)
      .reduce<ChecklistRun | null>(
        (best, r) => (!best || (r.completedAt ?? '') > (best.completedAt ?? '') ? r : best),
        null,
      );

    if (!last?.completedAt) {
      return { templateId: template.id, lastCompletedAt: null, daysSince: null, overdue: null };
    }

    const since = daysSince(last.completedAt, now);
    return {
      templateId: template.id,
      lastCompletedAt: last.completedAt,
      daysSince: since,
      overdue: template.recurDays === null ? null : since >= template.recurDays,
    };
  });
}

// ---------------------------------------------------------------------------
// Hazard assessment (0069)
// ---------------------------------------------------------------------------

export const LIKELIHOOD_LABELS: Record<number, string> = {
  1: 'Rare',
  2: 'Unlikely',
  3: 'Possible',
  4: 'Likely',
  5: 'Almost certain',
};

export const CONSEQUENCE_LABELS: Record<number, string> = {
  1: 'Negligible',
  2: 'Minor',
  3: 'Moderate',
  4: 'Major',
  5: 'Severe',
};

/**
 * There is deliberately no `riskBand(score)` function in this file.
 *
 * Every risk-matrix product maps the product of likelihood and consequence onto
 * low/medium/high, and the bands look official. This repo cannot source them: a 5×5
 * grid banded at 15 and 8 is one convention, banding at 12 and 6 is another, both are
 * in wide use, and neither appears in any New Zealand ECE regulation anybody here has
 * read. The difference decides whether a hazard is escalated.
 *
 * So the score is shown as a number out of 25 beside the risk a person recorded, and
 * nothing in this product converts one into the other. Adding that function is the
 * change that would turn an unsourced convention into a compliance threshold — see
 * llm-wiki/wiki/unverified-claims.md, and the header of migration 0069.
 */

/**
 * How long since a hazard was reviewed, and whether that is late.
 *
 * Same `null`-means-unstated contract as everything else here. A hazard that has
 * never been reviewed reports `daysSince: null` rather than counting from when it was
 * identified — "identified three months ago" and "reviewed three months ago" are
 * different claims and only one of them is about anybody having looked again.
 */
export interface HazardReviewStatus {
  daysSince: number | null;
  overdue: boolean | null;
}

export function hazardReviewStatus(
  hazard: { reviewedAt: string | null; reviewIntervalDays: number | null },
  now: string,
): HazardReviewStatus {
  if (hazard.reviewedAt === null) {
    return { daysSince: null, overdue: null };
  }
  const since = daysSince(hazard.reviewedAt, now);
  return {
    daysSince: since,
    overdue: hazard.reviewIntervalDays === null ? null : since >= hazard.reviewIntervalDays,
  };
}
