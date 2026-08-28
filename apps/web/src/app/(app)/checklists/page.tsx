import {
  listChecklistRuns,
  listChecklistTemplates,
  listChecklistVersions,
  listOpenChecklistRuns,
  listRooms,
} from '@ece/api';
import {
  can,
  checklistStatuses,
  currentVersion,
  draftVersion,
  liveRooms,
  type ChecklistStatus,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { ChecklistBoard, type OpenRunRow, type TemplateRow } from './ChecklistBoard';

/**
 * The checklists a centre runs, and what is due.
 *
 * This is the feature Little Pearls actually opens 1Place for — twelve templates'
 * worth of the walk round the playground before the gate opens. See
 * docs/replacing-1place.md.
 *
 * THERE IS NO SCHEDULER, AND THAT IS THE DESIGN
 *
 * Nothing creates a run in advance. "Due" is computed from the template's stated
 * interval and the date of the last completed run — the same shape `drillStatuses`
 * uses, and with the same null contract: a template that states no interval shows how
 * long it has been and does not call it late. Materialising future runs would put
 * rows in the database for work nobody has done, and every screen would then have to
 * filter them out.
 */
const HISTORY_DAYS = 90;

export default async function ChecklistsPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const [templates, rooms, openRuns] = await Promise.all([
    listChecklistTemplates(db, ctx.centre.id),
    listRooms(db, ctx.centre.id),
    listOpenChecklistRuns(db, ctx.centre.id),
  ]);

  const live = templates.filter((t) => t.archivedAt === null);
  const versions = await listChecklistVersions(db, templates.map((t) => t.id));

  // Ninety days of completed runs, which is enough to answer "when was this last
  // done" for anything on a monthly or shorter cycle and short enough to stay cheap.
  // A template on a longer interval reports "never in the last 90 days" rather than a
  // wrong date, because `checklistStatuses` treats an absent run as never done.
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const recentRuns = await listChecklistRuns(db, ctx.centre.id, since, new Date().toISOString());

  const now = new Date().toISOString();
  const statuses = new Map<string, ChecklistStatus>(
    checklistStatuses(live, versions, recentRuns, now).map((s) => [s.templateId, s]),
  );

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const templateName = new Map(live.map((t) => [t.id, t.name]));
  const versionOwner = new Map(versions.map((v) => [v.id, v.templateId]));
  const roomNames = new Map(rooms.map((r) => [r.id, r.name]));

  const rows: TemplateRow[] = live.map((template) => {
    const status = statuses.get(template.id);
    const published = currentVersion(versions, template.id);
    const draft = draftVersion(versions, template.id);
    return {
      template,
      publishedVersionId: published?.id ?? null,
      publishedVersion: published?.version ?? null,
      draftVersionId: draft?.id ?? null,
      lastDoneLabel: status?.lastCompletedAt ? when.format(new Date(status.lastCompletedAt)) : null,
      daysSince: status?.daysSince ?? null,
      overdue: status?.overdue ?? null,
    };
  });

  const openRows: OpenRunRow[] = openRuns.map((run) => ({
    id: run.id,
    name: templateName.get(versionOwner.get(run.versionId) ?? '') ?? 'A checklist',
    roomName: run.roomId ? (roomNames.get(run.roomId) ?? null) : null,
    startedLabel: when.format(new Date(run.startedAt)),
  }));

  return (
    <>
      <PageHeader
        title="Checklists"
        helpHref="/checklists"
        subtitle={<>Routine checks at {ctx.centre.name}.</>}
      />

      <ChecklistBoard
        rows={rows}
        openRuns={openRows}
        rooms={liveRooms(rooms).map((r) => ({ id: r.id, name: r.name }))}
        canManage={can(ctx.role, 'manageCentre')}
      />
    </>
  );
}
