import { assessRatio } from './ratios';
import { splitByAgeBand } from './ratios';
import type { Child, HealthCondition } from './children';
import type { RatioAssessment } from './ratios';

export type AttendanceKind = 'in' | 'out';

/**
 * Structural, not imported from `@ece/api`.
 *
 * This is domain logic, and depending on the query layer to describe its own input
 * would make `@ece/core` depend on the thing that depends on it. Both shapes are
 * two fields wide.
 */
export interface ServerAttendanceState {
  childId: string;
  kind: AttendanceKind;
  at: string;
}

export interface QueuedAttendance {
  clientUuid: string;
  childId: string;
  kind: AttendanceKind;
  at: string;
}

/**
 * Merging what the server knows with what is still in the outbox.
 *
 * This is the part of offline that is easy to get subtly wrong, so it is a pure
 * function with tests rather than logic scattered through a component.
 *
 * THE RULE
 *
 * For each child, the state is whichever event is *latest by its own timestamp* —
 * server or queued. Not "queued wins", which sounds right and is not: a child signed
 * in offline at 8:05 and signed out on a working tablet at 15:00 is gone, and letting
 * the stale queued event win would show them present all evening. Not "server wins"
 * either, which loses the offline sign-in entirely.
 *
 * Ordering by the event's own `at` is also what the database does when it derives
 * `attendance_today`, so the device and the server agree once the queue drains.
 */
export interface RollEntry {
  child: Child;
  present: boolean;
  since: string | null;
  conditions: HealthCondition[];
  /** True when this child's current state is still sitting in the outbox. */
  pending: boolean;
}

export interface Roll {
  entries: RollEntry[];
  ratio: RatioAssessment;
  pendingCount: number;
}

export function buildRoll(input: {
  children: Child[];
  serverStates: ServerAttendanceState[];
  queued: QueuedAttendance[];
  health: Map<string, HealthCondition[]>;
  adultsPresent: number;
  timeZone?: string;
}): Roll {
  const server = new Map(input.serverStates.map((s) => [s.childId, s]));

  // Latest queued event per child, by its own timestamp.
  const queued = new Map<string, QueuedAttendance>();
  for (const q of input.queued) {
    const held = queued.get(q.childId);
    if (!held || q.at > held.at) queued.set(q.childId, q);
  }

  const entries: RollEntry[] = input.children.map((child) => {
    const s = server.get(child.id);
    const q = queued.get(child.id);

    let kind: AttendanceKind | null = s?.kind ?? null;
    let at: string | null = s?.at ?? null;
    let pending = false;

    // Whichever happened later, regardless of which side it came from.
    if (q && (!at || q.at > at)) {
      kind = q.kind;
      at = q.at;
      pending = true;
    }

    return {
      child,
      present: kind === 'in',
      since: kind === 'in' ? at : null,
      conditions: input.health.get(child.id) ?? [],
      pending,
    };
  });

  // Queued sign-ins are counted. If they were not, an educator working offline would
  // see fewer children than are in the room — wrong in the dangerous direction.
  const present = entries.filter((e) => e.present).map((e) => e.child);
  const { underTwo, twoAndOver } = splitByAgeBand(present, input.timeZone);

  return {
    entries,
    ratio: assessRatio({ underTwo, twoAndOver, adultsPresent: input.adultsPresent }),
    pendingCount: input.queued.length,
  };
}
