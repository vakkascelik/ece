import { notFound } from 'next/navigation';
import {
  getChecklistRun,
  listChecklistAnswers,
  listChecklistItems,
  listChecklistTemplates,
  listChecklistVersions,
  listRooms,
  listRunPhotos,
  signEvidenceUrl,
} from '@ece/api';
import { ITEMS_IN_ORDER, roomName, runProgress } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../../PageHeader';
import { EvidencePhotos } from '../../evidence/EvidencePhotos';
import { RunForm } from './RunForm';

/**
 * One filling-in of one checklist.
 *
 * The run points at a **version**, and this page renders that version's questions —
 * not the template's current ones. That is the whole reason versions exist: a
 * completed run has to read as the form that was in front of the person who signed
 * it, or the first wording change rewrites last year's evidence.
 *
 * Once signed the page is read-only, and not because it hides the controls: 0068's
 * policy removes a completed run from the update's view, so the writes would fail
 * anyway. The controls disappear so nobody tries.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const run = await getChecklistRun(db, id);
  // RLS has already decided this: a run at another centre reads as absent rather than
  // as forbidden, which is the correct thing for a URL somebody could guess.
  if (!run) notFound();

  const [items, answers, templates, rooms, photos] = await Promise.all([
    listChecklistItems(db, [run.versionId]),
    listChecklistAnswers(db, [run.id]),
    listChecklistTemplates(db, ctx.centre.id),
    listRooms(db, ctx.centre.id),
    listRunPhotos(db, run.id),
  ]);

  const signedPhotos = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      caption: p.caption,
      url: await signEvidenceUrl(db, p.storagePath),
    })),
  );

  const versions = await listChecklistVersions(db, templates.map((t) => t.id));
  const version = versions.find((v) => v.id === run.versionId) ?? null;
  const template = version ? (templates.find((t) => t.id === version.templateId) ?? null) : null;

  const ordered = ITEMS_IN_ORDER(items, run.versionId);
  const progress = runProgress(ordered, answers);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const where = roomName(rooms, run.roomId);

  return (
    <>
      <PageHeader
        title={template?.name ?? 'Checklist'}
        subtitle={
          <>
            {where ? `${where} · ` : ''}
            started {when.format(new Date(run.startedAt))}
            {version ? ` · version ${version.version}` : ''}
          </>
        }
      />

      {run.completedAt !== null && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            <span className="flag flag-ok">{'✓'} Signed {when.format(new Date(run.completedAt))}</span>{' '}
            <span className="sub">
              This record cannot be changed. A correction is a new run, so what was signed stays
              readable as it was signed.
            </span>
          </p>
        </div>
      )}

      <RunForm
        runId={run.id}
        items={ordered}
        answers={answers}
        progress={progress}
        note={run.note}
        signed={run.completedAt !== null}
      />

      {/*
        Photos ride the run, not an answer. A broken latch photographed mid-walk
        belongs to the walk; per-answer attachment can come later if anybody asks
        for it, and the schema (0075) would not need to change.
      */}
      <EvidencePhotos
        photos={signedPhotos}
        parent={{ kind: 'run', id: run.id }}
        locked={run.completedAt !== null}
        lockedReason="This run is signed, so its photos are frozen with it. A correction is a new run."
      />
    </>
  );
}
