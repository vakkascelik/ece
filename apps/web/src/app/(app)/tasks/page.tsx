import { listHazards, listRooms, listTasks } from '@ece/api';
import { liveRooms, summariseTasks, todayInZone, type Task } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { TaskList, type TaskRow } from './TaskList';

/**
 * The jobs the centre is carrying.
 *
 * Replaces 1Place's Tasks, where Little Pearls had 73 of them open — see
 * docs/replacing-1place.md. Two of their three categories came across; enrolment
 * enquiries did not, because this product already has `/enquiries` with an age band,
 * a waitlist and a conversion report, and forking that into a generic queue would
 * make the better workflow the one nobody uses.
 *
 * Educators, not just managers: the person who finds the broken latch is the person
 * standing next to it, and a queue only they can read is a queue that fills up with
 * things nobody filed.
 */
export default async function TasksPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const [tasks, rooms, hazards] = await Promise.all([
    listTasks(db, ctx.centre.id),
    listRooms(db, ctx.centre.id),
    listHazards(db, ctx.centre.id),
  ]);

  // The centre's calendar day, not the server's. A task due today would otherwise
  // read as overdue for the whole New Zealand morning — AGENTS.md §4.3.
  const today = todayInZone(ctx.centre.timezone);
  const summary = summariseTasks(tasks, today);

  const dayOnly = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));

  const rows: TaskRow[] = tasks.map((task: Task) => ({
    task,
    roomName: task.roomId ? (roomNames.get(task.roomId) ?? null) : null,
    createdLabel: dayOnly.format(new Date(task.createdAt)),
    resolvedLabel: task.resolvedAt ? dayOnly.format(new Date(task.resolvedAt)) : null,
    // Computed here rather than in the component so the comparison happens once,
    // against the centre's date, on the server.
    overdue: task.dueOn !== null && task.dueOn < today,
  }));

  return (
    <>
      <PageHeader
        title="Tasks"
        helpHref="/tasks"
        subtitle={<>Maintenance and hazard follow-up at {ctx.centre.name}.</>}
      />

      {/*
        What is outstanding, not how many have ever been filed. A centre that has
        closed forty reads the same as one that has filed none — the argument
        `summariseHazards` makes on the site-safety page, and a queue that only goes
        up is one nobody opens.
      */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        {summary.clear ? (
          <p style={{ margin: 0 }}>
            <span className="flag flag-ok">{'✓'} Nothing outstanding</span>{' '}
            <span className="sub">Everything filed has been resolved or closed.</span>
          </p>
        ) : (
          <p className="inline" style={{ margin: 0 }}>
            <span className="flag flag-quiet">{summary.live} open</span>
            {summary.critical > 0 && (
              <span className="flag flag-critical">{'▲'} {summary.critical} critical</span>
            )}
            {summary.overdue > 0 && (
              <span className="flag flag-warn">{summary.overdue} past the day it was wanted</span>
            )}
          </p>
        )}
      </div>

      <TaskList
        rows={rows}
        rooms={liveRooms(rooms).map((r) => ({ id: r.id, name: r.name }))}
        openHazards={hazards
          .filter((h) => h.resolvedAt === null)
          .map((h) => ({ id: h.id, description: h.description }))}
      />
    </>
  );
}
