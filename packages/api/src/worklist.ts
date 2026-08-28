/**
 * Reads and writes for rooms, tasks and checklists — 0066 to 0069.
 *
 * As everywhere in this package, no tenant filtering: the migrations hold the
 * boundary and it is not the same on every table here. Tasks and the whole checklist
 * chain are staff-only; `rooms` is deliberately readable by a parent, because
 * `incidents.room_id` would otherwise render blank for the family an incident exists
 * to inform. Filtering in this file would imply the filter is what decides.
 *
 * Every column list is one string literal. `supabase-js` infers the row type from the
 * literal text of the select, so a concatenation degrades the result to
 * `GenericStringError[]` and every cast after it becomes a lie the compiler accepts —
 * written up in `conventions.md` after it cost an afternoon.
 */

import type {
  ChecklistAnswer,
  ChecklistItem,
  ChecklistResponse,
  ChecklistRun,
  ChecklistTemplate,
  ChecklistVersion,
  Room,
  Task,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from '@ece/core';
import { fetchAll } from './paging';
import type { RecordOutcome } from './registers';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const ROOM_COLUMNS = 'id, centre_id, name, sort, archived_at';

interface RoomRow {
  id: string;
  centre_id: string;
  name: string;
  sort: number;
  archived_at: string | null;
}

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  centreId: r.centre_id,
  name: r.name,
  sort: r.sort,
  archivedAt: r.archived_at,
});

/**
 * Every room including archived ones.
 *
 * Archived rooms are returned because last year's incidents point at them and a
 * screen rendering history has to resolve the name. Callers wanting a picker use
 * `liveRooms()` from `@ece/core`, which is one call away and explicit — the opposite
 * default would silently blank the room on old records.
 */
export async function listRooms(db: Db, centreId: string): Promise<Room[]> {
  const rows = await fetchAll<RoomRow>('listRooms', (a, b) =>
    db
      .from('rooms')
      .select(ROOM_COLUMNS)
      .eq('centre_id', centreId)
      .order('sort', { ascending: true })
      .order('name', { ascending: true })
      .range(a, b),
  );
  return rows.map(toRoom);
}

export async function createRoom(
  db: Db,
  input: { centreId: string; name: string; sort?: number },
): Promise<Room> {
  const { data, error } = await db
    .from('rooms')
    .insert({ centre_id: input.centreId, name: input.name.trim(), sort: input.sort ?? 0 })
    .select(ROOM_COLUMNS)
    .single();
  if (error) throw new Error(`createRoom: ${error.message}`);
  return toRoom(data as RoomRow);
}

/** Rename, reorder, or archive. There is no delete — 0066 grants none. */
export async function updateRoom(
  db: Db,
  id: string,
  patch: { name?: string; sort?: number; archivedAt?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.sort !== undefined) row.sort = patch.sort;
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
  if (Object.keys(row).length === 0) return;

  // `.select()` and a zero-row check, for the reason written up on `updateCentre`: a
  // PostgREST UPDATE that matches nothing returns `error: null`, and under RLS that
  // is exactly what a refusal looks like.
  const { data, error } = await db.from('rooms').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateRoom: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('updateRoom: no room was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_COLUMNS =
  'id, centre_id, room_id, title, detail, category, priority, status, due_on, assigned_to, hazard_id, resolution, resolved_at, created_by, created_at';

interface TaskRow {
  id: string;
  centre_id: string;
  room_id: string | null;
  title: string;
  detail: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  due_on: string | null;
  assigned_to: string | null;
  hazard_id: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  centreId: r.centre_id,
  roomId: r.room_id,
  title: r.title,
  detail: r.detail,
  category: r.category,
  priority: r.priority,
  status: r.status,
  dueOn: r.due_on,
  assignedTo: r.assigned_to,
  hazardId: r.hazard_id,
  resolution: r.resolution,
  resolvedAt: r.resolved_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export async function listTasks(db: Db, centreId: string): Promise<Task[]> {
  const rows = await fetchAll<TaskRow>('listTasks', (a, b) =>
    db
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toTask);
}

export async function createTask(
  db: Db,
  input: {
    centreId: string;
    title: string;
    category: TaskCategory;
    priority: TaskPriority;
    roomId?: string | null;
    detail?: string | null;
    dueOn?: string | null;
    assignedTo?: string | null;
    hazardId?: string | null;
  },
): Promise<Task> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('tasks')
    .insert({
      centre_id: input.centreId,
      title: input.title.trim(),
      category: input.category,
      priority: input.priority,
      room_id: input.roomId ?? null,
      detail: input.detail?.trim() || null,
      // Already a local calendar date computed by the caller with `todayInZone`.
      // Nothing here derives a date from a clock — see AGENTS.md §4.3.
      due_on: input.dueOn || null,
      assigned_to: input.assignedTo ?? null,
      hazard_id: input.hazardId ?? null,
      created_by: auth.user?.id ?? null,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw new Error(`createTask: ${error.message}`);
  return toTask(data as TaskRow);
}

/**
 * Change a task: reassign it, repriorise it, or finish it.
 *
 * Finishing needs `status`, `resolution` and `resolvedAt` together — the CHECK in
 * 0067 refuses any two of the three, and this does not re-implement that. It exists
 * so a caller can express the acts separately rather than through a generic patch.
 */
export async function updateTask(
  db: Db,
  id: string,
  patch: {
    title?: string;
    detail?: string | null;
    category?: TaskCategory;
    priority?: TaskPriority;
    status?: TaskStatus;
    roomId?: string | null;
    dueOn?: string | null;
    assignedTo?: string | null;
    resolution?: string | null;
    resolvedAt?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.detail !== undefined) row.detail = patch.detail?.trim() || null;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.roomId !== undefined) row.room_id = patch.roomId;
  if (patch.dueOn !== undefined) row.due_on = patch.dueOn || null;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
  if (patch.resolution !== undefined) row.resolution = patch.resolution?.trim() || null;
  if (patch.resolvedAt !== undefined) row.resolved_at = patch.resolvedAt;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db.from('tasks').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateTask: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('updateTask: no task was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// Checklist templates, versions and items
// ---------------------------------------------------------------------------

const TEMPLATE_COLUMNS = 'id, centre_id, name, folder, recur_days, archived_at';

interface TemplateRow {
  id: string;
  centre_id: string;
  name: string;
  folder: string | null;
  recur_days: number | null;
  archived_at: string | null;
}

const toTemplate = (r: TemplateRow): ChecklistTemplate => ({
  id: r.id,
  centreId: r.centre_id,
  name: r.name,
  folder: r.folder,
  recurDays: r.recur_days,
  archivedAt: r.archived_at,
});

export async function listChecklistTemplates(db: Db, centreId: string): Promise<ChecklistTemplate[]> {
  const rows = await fetchAll<TemplateRow>('listChecklistTemplates', (a, b) =>
    db
      .from('checklist_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('centre_id', centreId)
      .order('folder', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
      .range(a, b),
  );
  return rows.map(toTemplate);
}

const VERSION_COLUMNS = 'id, template_id, version, published_at';

interface VersionRow {
  id: string;
  template_id: string;
  version: number;
  published_at: string | null;
}

const toVersion = (r: VersionRow): ChecklistVersion => ({
  id: r.id,
  templateId: r.template_id,
  version: r.version,
  publishedAt: r.published_at,
});

/**
 * Every version of every template at a centre.
 *
 * One query rather than one per template. A centre has twelve templates and perhaps
 * thirty versions between them; twelve round trips to save reading thirty rows is the
 * wrong trade, and `checklistStatuses` in `@ece/core` wants them all at once anyway to
 * attribute runs.
 */
export async function listChecklistVersions(db: Db, templateIds: string[]): Promise<ChecklistVersion[]> {
  if (templateIds.length === 0) return [];
  const rows = await fetchAll<VersionRow>('listChecklistVersions', (a, b) =>
    db
      .from('checklist_template_versions')
      .select(VERSION_COLUMNS)
      .in('template_id', templateIds)
      .order('version', { ascending: false })
      .range(a, b),
  );
  return rows.map(toVersion);
}

const ITEM_COLUMNS = 'id, version_id, sort, prompt, response_type, required, guidance';

interface ItemRow {
  id: string;
  version_id: string;
  sort: number;
  prompt: string;
  response_type: ChecklistResponse;
  required: boolean;
  guidance: string | null;
}

const toItem = (r: ItemRow): ChecklistItem => ({
  id: r.id,
  versionId: r.version_id,
  sort: r.sort,
  prompt: r.prompt,
  responseType: r.response_type,
  required: r.required,
  guidance: r.guidance,
});

export async function listChecklistItems(db: Db, versionIds: string[]): Promise<ChecklistItem[]> {
  if (versionIds.length === 0) return [];
  const rows = await fetchAll<ItemRow>('listChecklistItems', (a, b) =>
    db
      .from('checklist_items')
      .select(ITEM_COLUMNS)
      .in('version_id', versionIds)
      .order('sort', { ascending: true })
      .range(a, b),
  );
  return rows.map(toItem);
}

export async function createChecklistTemplate(
  db: Db,
  input: { centreId: string; name: string; folder?: string | null; recurDays?: number | null },
): Promise<{ template: ChecklistTemplate; versionId: string }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('checklist_templates')
    .insert({
      centre_id: input.centreId,
      name: input.name.trim(),
      folder: input.folder?.trim() || null,
      recur_days: input.recurDays ?? null,
      created_by: auth.user?.id ?? null,
    })
    .select(TEMPLATE_COLUMNS)
    .single();
  if (error) throw new Error(`createChecklistTemplate: ${error.message}`);

  // A template with no version cannot be filled in and cannot be edited into one
  // through any screen, so it is created with its first draft attached. Two
  // statements rather than a transaction: PostgREST has none, and the failure mode of
  // the second is a template that shows as "no draft", which the screen can offer to
  // fix. The reverse order would orphan a version.
  const version = await createChecklistVersion(db, (data as TemplateRow).id, 1);
  return { template: toTemplate(data as TemplateRow), versionId: version.id };
}

export async function updateChecklistTemplate(
  db: Db,
  id: string,
  patch: { name?: string; folder?: string | null; recurDays?: number | null; archivedAt?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.folder !== undefined) row.folder = patch.folder?.trim() || null;
  if (patch.recurDays !== undefined) row.recur_days = patch.recurDays;
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
  if (Object.keys(row).length === 0) return;

  const { data, error } = await db.from('checklist_templates').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateChecklistTemplate: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('updateChecklistTemplate: no template was updated. Either the id is wrong or the policy refused it.');
  }
}

export async function createChecklistVersion(
  db: Db,
  templateId: string,
  version: number,
): Promise<ChecklistVersion> {
  const { data, error } = await db
    .from('checklist_template_versions')
    .insert({ template_id: templateId, version })
    .select(VERSION_COLUMNS)
    .single();
  if (error) throw new Error(`createChecklistVersion: ${error.message}`);
  return toVersion(data as VersionRow);
}

/**
 * Copy a published version into a new draft, so editing starts from what is there.
 *
 * The alternative — a blank draft — makes changing one word in a twelve-item form a
 * retyping exercise, and a centre that has to retype will instead not change it.
 * That is how a checklist ends up describing a building that was renovated.
 */
export async function forkChecklistVersion(
  db: Db,
  fromVersionId: string,
  templateId: string,
  nextVersion: number,
): Promise<ChecklistVersion> {
  const created = await createChecklistVersion(db, templateId, nextVersion);
  const items = await listChecklistItems(db, [fromVersionId]);
  if (items.length > 0) {
    const { error } = await db.from('checklist_items').insert(
      items.map((i) => ({
        version_id: created.id,
        sort: i.sort,
        prompt: i.prompt,
        response_type: i.responseType,
        required: i.required,
        guidance: i.guidance,
      })),
    );
    if (error) throw new Error(`forkChecklistVersion: ${error.message}`);
  }
  return created;
}

export async function publishChecklistVersion(db: Db, versionId: string, at: string): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('checklist_template_versions')
    .update({ published_at: at, published_by: auth.user?.id ?? null })
    .eq('id', versionId)
    .select('id');
  if (error) throw new Error(`publishChecklistVersion: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'publishChecklistVersion: nothing was published. Either the id is wrong, or the version is already published — 0068 makes a published version immutable.',
    );
  }
}

export async function addChecklistItem(
  db: Db,
  input: {
    versionId: string;
    prompt: string;
    responseType: ChecklistResponse;
    required: boolean;
    sort?: number;
    guidance?: string | null;
  },
): Promise<ChecklistItem> {
  const { data, error } = await db
    .from('checklist_items')
    .insert({
      version_id: input.versionId,
      prompt: input.prompt.trim(),
      response_type: input.responseType,
      required: input.required,
      sort: input.sort ?? 0,
      guidance: input.guidance?.trim() || null,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw new Error(`addChecklistItem: ${error.message}`);
  return toItem(data as ItemRow);
}

/** Only possible while the version is a draft: 0068's policy tests `published_at is null`. */
export async function removeChecklistItem(db: Db, id: string): Promise<void> {
  const { error } = await db.from('checklist_items').delete().eq('id', id);
  if (error) throw new Error(`removeChecklistItem: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Runs and answers
// ---------------------------------------------------------------------------

const RUN_COLUMNS =
  'id, version_id, centre_id, room_id, due_on, assigned_to, started_at, completed_at, signed_by, note';

interface RunRow {
  id: string;
  version_id: string;
  centre_id: string;
  room_id: string | null;
  due_on: string | null;
  assigned_to: string | null;
  started_at: string;
  completed_at: string | null;
  signed_by: string | null;
  note: string | null;
}

const toRun = (r: RunRow): ChecklistRun => ({
  id: r.id,
  versionId: r.version_id,
  centreId: r.centre_id,
  roomId: r.room_id,
  dueOn: r.due_on,
  assignedTo: r.assigned_to,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  signedBy: r.signed_by,
  note: r.note,
});

export async function listChecklistRuns(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<ChecklistRun[]> {
  const rows = await fetchAll<RunRow>('listChecklistRuns', (a, b) =>
    db
      .from('checklist_runs')
      .select(RUN_COLUMNS)
      .eq('centre_id', centreId)
      .gte('started_at', from)
      .lte('started_at', to)
      .order('started_at', { ascending: false })
      .range(a, b),
  );
  return rows.map(toRun);
}

/** Everything still open, whatever its age. The list a manager works through. */
export async function listOpenChecklistRuns(db: Db, centreId: string): Promise<ChecklistRun[]> {
  const rows = await fetchAll<RunRow>('listOpenChecklistRuns', (a, b) =>
    db
      .from('checklist_runs')
      .select(RUN_COLUMNS)
      .eq('centre_id', centreId)
      .is('completed_at', null)
      .order('started_at', { ascending: true })
      .range(a, b),
  );
  return rows.map(toRun);
}

export async function getChecklistRun(db: Db, id: string): Promise<ChecklistRun | null> {
  const { data, error } = await db.from('checklist_runs').select(RUN_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`getChecklistRun: ${error.message}`);
  return data ? toRun(data as RunRow) : null;
}

/**
 * Start filling a form in. Same idempotency contract as every other register write.
 *
 * `clientUuid` is generated by the device, so a tap that times out and is replayed
 * produces one run rather than two — the contract attendance established and the one
 * the offline path depends on.
 */
export async function startChecklistRun(
  db: Db,
  input: {
    versionId: string;
    centreId: string;
    clientUuid: string;
    roomId?: string | null;
    dueOn?: string | null;
    assignedTo?: string | null;
  },
): Promise<{ outcome: RecordOutcome; id: string | null }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('checklist_runs')
    .upsert(
      {
        version_id: input.versionId,
        centre_id: input.centreId,
        room_id: input.roomId ?? null,
        due_on: input.dueOn || null,
        assigned_to: input.assignedTo ?? null,
        client_uuid: input.clientUuid,
        created_by: auth.user?.id ?? null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`startChecklistRun: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) {
    // A duplicate. The caller wants the id of the run that already exists, not a
    // failure — this is the replay path, and it has to be indistinguishable from the
    // first attempt to the person holding the phone.
    const { data: existing, error: lookupError } = await db
      .from('checklist_runs')
      .select('id')
      .eq('client_uuid', input.clientUuid)
      .maybeSingle();
    if (lookupError) throw new Error(`startChecklistRun: ${lookupError.message}`);
    return { outcome: 'duplicate', id: (existing as { id: string } | null)?.id ?? null };
  }
  return { outcome: 'recorded', id: (rows[0] as { id: string }).id };
}

const ANSWER_COLUMNS = 'id, run_id, item_id, value, note';

interface AnswerRow {
  id: string;
  run_id: string;
  item_id: string;
  value: string;
  note: string | null;
}

const toAnswer = (r: AnswerRow): ChecklistAnswer => ({
  id: r.id,
  runId: r.run_id,
  itemId: r.item_id,
  value: r.value,
  note: r.note,
});

export async function listChecklistAnswers(db: Db, runIds: string[]): Promise<ChecklistAnswer[]> {
  if (runIds.length === 0) return [];
  const rows = await fetchAll<AnswerRow>('listChecklistAnswers', (a, b) =>
    db.from('checklist_answers').select(ANSWER_COLUMNS).in('run_id', runIds).range(a, b),
  );
  return rows.map(toAnswer);
}

/**
 * Answer one item, or change an answer already given.
 *
 * Upserted on `(run_id, item_id)` because a person filling a form in changes their
 * mind, and until the run is completed that is not an amendment to a record — it is
 * still being written. The moment `completed_at` is set, 0068's policy stops allowing
 * both the insert and the update, so this function simply stops working rather than
 * needing to know the rule.
 */
export async function answerChecklistItem(
  db: Db,
  input: { runId: string; itemId: string; value: string; note?: string | null },
): Promise<void> {
  const { error } = await db.from('checklist_answers').upsert(
    {
      run_id: input.runId,
      item_id: input.itemId,
      value: input.value,
      note: input.note?.trim() || null,
    },
    { onConflict: 'run_id,item_id' },
  );
  if (error) throw new Error(`answerChecklistItem: ${error.message}`);
}

/**
 * Sign a run off.
 *
 * The required-items rule lives in the trigger in 0068 and is not re-implemented
 * here. This sends the transition and lets the database refuse it; the caller has
 * already computed what is missing from `runProgress()` and disabled the button, so a
 * refusal reaching this point means two clients raced, which is exactly when the
 * database should be the one deciding.
 */
export async function completeChecklistRun(
  db: Db,
  id: string,
  at: string,
  note?: string | null,
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('checklist_runs')
    .update({
      completed_at: at,
      signed_by: auth.user?.id ?? null,
      ...(note !== undefined ? { note: note?.trim() || null } : {}),
    })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`completeChecklistRun: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'completeChecklistRun: nothing was signed off. Either the id is wrong, or the run is already complete — 0068 freezes a completed run.',
    );
  }
}
