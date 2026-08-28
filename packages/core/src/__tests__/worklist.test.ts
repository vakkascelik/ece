import { describe, expect, it } from 'vitest';
import {
  checklistStatuses,
  compareTaskUrgency,
  hazardReviewStatus,
  liveRooms,
  roomName,
  runProgress,
  sortRooms,
  summariseTasks,
  type ChecklistItem,
  type ChecklistRun,
  type ChecklistTemplate,
  type ChecklistVersion,
  type Room,
  type Task,
} from '../worklist';

const room = (over: Partial<Room> & Pick<Room, 'id' | 'name'>): Room => ({
  centreId: 'c1',
  sort: 0,
  archivedAt: null,
  ...over,
});

const task = (over: Partial<Task> & Pick<Task, 'id' | 'createdAt'>): Task => ({
  centreId: 'c1',
  roomId: null,
  title: 'The gate latch sticks',
  detail: null,
  category: 'maintenance',
  priority: 'medium',
  status: 'pending',
  dueOn: null,
  assignedTo: null,
  hazardId: null,
  resolution: null,
  resolvedAt: null,
  createdBy: null,
  ...over,
});

describe('rooms', () => {
  it('orders by the centre’s own sort before the alphabet', () => {
    const rooms = [
      room({ id: 'r1', name: 'Carpark', sort: 90 }),
      room({ id: 'r2', name: 'Infant', sort: 10 }),
      room({ id: 'r3', name: 'Toddler', sort: 20 }),
    ];
    expect(sortRooms(rooms).map((r) => r.name)).toEqual(['Infant', 'Toddler', 'Carpark']);
  });

  it('falls back to the alphabet inside a tie, so the order is never arbitrary', () => {
    const rooms = [room({ id: 'r1', name: 'Kitchen' }), room({ id: 'r2', name: 'Awhi' })];
    expect(sortRooms(rooms).map((r) => r.name)).toEqual(['Awhi', 'Kitchen']);
  });

  it('keeps archived rooms out of a picker', () => {
    const rooms = [
      room({ id: 'r1', name: 'Toddler' }),
      room({ id: 'r2', name: 'Old Toddler', archivedAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(liveRooms(rooms).map((r) => r.name)).toEqual(['Toddler']);
  });

  /*
   * The reason archiving exists instead of deletion. A closed room still has last
   * year's incidents pointing at it, and a binder that renders them has to resolve
   * the name — so the lookup must NOT filter on archived.
   */
  it('still resolves the name of an archived room, which is the point of archiving', () => {
    const rooms = [room({ id: 'r2', name: 'Old Toddler', archivedAt: '2026-01-01T00:00:00Z' })];
    expect(roomName(rooms, 'r2')).toBe('Old Toddler');
  });

  it('returns null for an unrecorded room rather than inventing a placeholder', () => {
    expect(roomName([], null)).toBeNull();
    expect(roomName([room({ id: 'r1', name: 'Toddler' })], 'gone')).toBeNull();
  });
});

describe('task ordering', () => {
  it('puts live work above finished work', () => {
    const open = task({ id: 't1', createdAt: '2026-01-01T00:00:00Z', priority: 'low' });
    const done = task({
      id: 't2',
      createdAt: '2026-01-01T00:00:00Z',
      priority: 'critical',
      status: 'closed',
      resolvedAt: '2026-02-01T00:00:00Z',
      resolution: 'Fixed.',
    });
    expect([done, open].sort(compareTaskUrgency).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  /*
   * The assertion this comparator exists for, and the same argument
   * `compareHazardUrgency` makes: priority alone puts this morning's critical task
   * above a high one open since March, and the March one is the failure — somebody
   * has walked past it two hundred times.
   */
  it('breaks a priority tie on the oldest due date, not the newest', () => {
    const march = task({ id: 'old', createdAt: '2026-03-01T00:00:00Z', priority: 'high', dueOn: '2026-03-05' });
    const today = task({ id: 'new', createdAt: '2026-08-01T00:00:00Z', priority: 'high', dueOn: '2026-08-05' });
    expect([today, march].sort(compareTaskUrgency).map((t) => t.id)).toEqual(['old', 'new']);
  });

  it('sorts a task with no due date after one that has a date at the same priority', () => {
    const dated = task({ id: 'dated', createdAt: '2026-08-01T00:00:00Z', dueOn: '2026-12-01' });
    const undated = task({ id: 'undated', createdAt: '2026-01-01T00:00:00Z', dueOn: null });
    expect([undated, dated].sort(compareTaskUrgency).map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('reads finished work newest-first', () => {
    const base = { status: 'closed' as const, resolution: 'Fixed.' };
    const older = task({ id: 'older', createdAt: '2026-01-01T00:00:00Z', ...base, resolvedAt: '2026-02-01T00:00:00Z' });
    const newer = task({ id: 'newer', createdAt: '2026-01-01T00:00:00Z', ...base, resolvedAt: '2026-07-01T00:00:00Z' });
    expect([older, newer].sort(compareTaskUrgency).map((t) => t.id)).toEqual(['newer', 'older']);
  });
});

describe('summariseTasks', () => {
  const today = '2026-08-28';

  it('counts what is outstanding, not what has ever been filed', () => {
    const tasks = [
      task({ id: 't1', createdAt: '2026-08-01T00:00:00Z' }),
      task({
        id: 't2',
        createdAt: '2026-08-01T00:00:00Z',
        status: 'closed',
        resolution: 'Done.',
        resolvedAt: '2026-08-02T00:00:00Z',
      }),
    ];
    expect(summariseTasks(tasks, today).live).toBe(1);
  });

  it('reads clear for a centre that has closed forty, same as one that filed none', () => {
    const closed = Array.from({ length: 40 }, (_, i) =>
      task({
        id: `t${i}`,
        createdAt: '2026-08-01T00:00:00Z',
        status: 'closed',
        resolution: 'Done.',
        resolvedAt: '2026-08-02T00:00:00Z',
      }),
    );
    expect(summariseTasks(closed, today).clear).toBe(true);
    expect(summariseTasks([], today).clear).toBe(true);
  });

  /*
   * A task due TODAY is not overdue. The boundary matters more than it looks: `today`
   * is the centre's local date, and comparing against a UTC clock would mark every
   * task due today as late for the whole New Zealand morning.
   */
  it('does not call a task due today overdue', () => {
    const due = task({ id: 't1', createdAt: '2026-08-01T00:00:00Z', dueOn: today });
    expect(summariseTasks([due], today).overdue).toBe(0);
  });

  it('does call yesterday overdue', () => {
    const due = task({ id: 't1', createdAt: '2026-08-01T00:00:00Z', dueOn: '2026-08-27' });
    expect(summariseTasks([due], today).overdue).toBe(1);
  });

  it('never counts a finished task as overdue, however old its due date', () => {
    const done = task({
      id: 't1',
      createdAt: '2026-01-01T00:00:00Z',
      dueOn: '2026-01-02',
      status: 'resolved',
      resolution: 'Done.',
      resolvedAt: '2026-01-03T00:00:00Z',
    });
    expect(summariseTasks([done], today).overdue).toBe(0);
  });
});

describe('runProgress', () => {
  const item = (id: string, required: boolean): ChecklistItem => ({
    id,
    versionId: 'v1',
    sort: 0,
    prompt: id,
    responseType: 'yes_no',
    required,
    guidance: null,
  });
  const answer = (itemId: string, value: string) => ({
    id: `a-${itemId}`,
    runId: 'r1',
    itemId,
    value,
    note: null,
  });

  it('will not let a run be signed while a required item is unanswered', () => {
    const p = runProgress([item('i1', true), item('i2', true)], [answer('i1', 'yes')]);
    expect(p.remaining).toBe(1);
    expect(p.canComplete).toBe(false);
  });

  /*
   * `required = false` has to mean something, or the flag is decoration. This is the
   * mirror of the trigger in 0068, which counts only required items.
   */
  it('lets it be signed with an optional item left blank', () => {
    const p = runProgress([item('i1', true), item('i2', false)], [answer('i1', 'yes')]);
    expect(p.remaining).toBe(0);
    expect(p.canComplete).toBe(true);
    expect(p.answered).toBe(1);
    expect(p.total).toBe(2);
  });

  it('counts the findings, which are the reason to keep the record at all', () => {
    const p = runProgress(
      [item('i1', true), item('i2', true)],
      [answer('i1', 'no'), answer('i2', 'yes')],
    );
    expect(p.failures).toBe(1);
  });

  it('an empty form is completable, because there is nothing to answer', () => {
    expect(runProgress([], []).canComplete).toBe(true);
  });
});

describe('checklistStatuses', () => {
  const now = '2026-08-28T09:00:00Z';
  const template = (over: Partial<ChecklistTemplate> & Pick<ChecklistTemplate, 'id'>): ChecklistTemplate => ({
    centreId: 'c1',
    name: 'Daily playground check',
    folder: null,
    recurDays: null,
    archivedAt: null,
    ...over,
  });
  const version: ChecklistVersion = {
    id: 'v1',
    templateId: 't1',
    version: 1,
    publishedAt: '2026-01-01T00:00:00Z',
  };
  const run = (over: Partial<ChecklistRun> & Pick<ChecklistRun, 'id'>): ChecklistRun => ({
    versionId: 'v1',
    centreId: 'c1',
    roomId: null,
    dueOn: null,
    assignedTo: null,
    startedAt: '2026-08-20T00:00:00Z',
    completedAt: null,
    signedBy: null,
    note: null,
    ...over,
  });

  /*
   * THE CONTRACT THAT MATTERS, and it is the same one drillStatuses and sleepStatuses
   * hold: `false` says "recently enough", `null` says "nobody has said what recently
   * enough means". A caller that renders them the same way puts a green tick against
   * an unmeasured gap, which is how a product talks a centre into a breach.
   */
  it('reports overdue as null when the template states no interval', () => {
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: null })],
      [version],
      [run({ id: 'r1', completedAt: '2026-08-01T00:00:00Z' })],
      now,
    );
    expect(s[0]?.overdue).toBeNull();
    expect(s[0]?.daysSince).toBe(27);
  });

  it('reports never-done as its own state, not as an infinite overdue', () => {
    const s = checklistStatuses([template({ id: 't1', recurDays: 1 })], [version], [], now);
    expect(s[0]).toEqual({ templateId: 't1', lastCompletedAt: null, daysSince: null, overdue: null });
  });

  it('ignores a run that was started and never signed', () => {
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: 1 })],
      [version],
      [run({ id: 'r1', completedAt: null })],
      now,
    );
    expect(s[0]?.lastCompletedAt).toBeNull();
  });

  it('is overdue once the gap reaches the stated interval', () => {
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: 7 })],
      [version],
      [run({ id: 'r1', completedAt: '2026-08-21T09:00:00Z' })],
      now,
    );
    expect(s[0]?.daysSince).toBe(7);
    expect(s[0]?.overdue).toBe(true);
  });

  it('is not overdue one day short of it', () => {
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: 7 })],
      [version],
      [run({ id: 'r1', completedAt: '2026-08-22T09:00:00Z' })],
      now,
    );
    expect(s[0]?.overdue).toBe(false);
  });

  /*
   * Runs point at a VERSION, so attributing one to its template goes through the
   * version map. A run against version 1 must still count when version 2 exists —
   * publishing a new form does not erase the fact that the old one was done.
   */
  it('attributes a run made against an older version to the same template', () => {
    const v2: ChecklistVersion = { id: 'v2', templateId: 't1', version: 2, publishedAt: now };
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: 7 })],
      [version, v2],
      [run({ id: 'r1', versionId: 'v1', completedAt: '2026-08-27T09:00:00Z' })],
      now,
    );
    expect(s[0]?.daysSince).toBe(1);
  });

  it('does not attribute another template’s run', () => {
    const other: ChecklistVersion = { id: 'v9', templateId: 't9', version: 1, publishedAt: now };
    const s = checklistStatuses(
      [template({ id: 't1', recurDays: 7 })],
      [version, other],
      [run({ id: 'r1', versionId: 'v9', completedAt: now })],
      now,
    );
    expect(s[0]?.lastCompletedAt).toBeNull();
  });
});

describe('hazardReviewStatus', () => {
  const now = '2026-08-28T09:00:00Z';

  /*
   * "Identified three months ago" and "reviewed three months ago" are different
   * claims, and only the second is about anybody having looked again. A hazard never
   * reviewed reports null rather than counting from identification.
   */
  it('reports null for a hazard nobody has reviewed', () => {
    expect(hazardReviewStatus({ reviewedAt: null, reviewIntervalDays: 30 }, now)).toEqual({
      daysSince: null,
      overdue: null,
    });
  });

  it('reports elapsed time without judging it when no interval is stated', () => {
    const s = hazardReviewStatus({ reviewedAt: '2026-07-28T09:00:00Z', reviewIntervalDays: null }, now);
    expect(s.daysSince).toBe(31);
    expect(s.overdue).toBeNull();
  });

  it('judges it once an interval is stated', () => {
    const s = hazardReviewStatus({ reviewedAt: '2026-07-28T09:00:00Z', reviewIntervalDays: 30 }, now);
    expect(s.overdue).toBe(true);
  });
});
