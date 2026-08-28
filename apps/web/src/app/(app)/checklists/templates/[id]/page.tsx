import { notFound } from 'next/navigation';
import { listChecklistItems, listChecklistTemplates, listChecklistVersions } from '@ece/api';
import { ITEMS_IN_ORDER } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../../../PageHeader';
import { TemplateEditor } from './TemplateEditor';

/**
 * The questions on one version of one checklist.
 *
 * The route is keyed on the **version**, not the template, because that is what is
 * being edited and what a run will point at. `/checklists/templates/<versionId>`
 * reads oddly and is right: a template has no questions of its own.
 *
 * A published version is read-only here, and not as a courtesy — 0068's policy
 * removes it from the update's view, so the writes fail. Changing a published form
 * means a new draft, which leaves every completed run pointing at what it actually
 * asked.
 */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const templates = await listChecklistTemplates(db, ctx.centre.id);
  const versions = await listChecklistVersions(db, templates.map((t) => t.id));

  const version = versions.find((v) => v.id === id) ?? null;
  // RLS decided this already; a version at another centre reads as absent.
  if (!version) notFound();

  const template = templates.find((t) => t.id === version.templateId) ?? null;
  if (!template) notFound();

  const items = ITEMS_IN_ORDER(await listChecklistItems(db, [version.id]), version.id);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Only offer "revise" from the newest published version — forking an older one
  // would silently drop whatever the newer one added.
  const newestPublished = versions
    .filter((v) => v.templateId === template.id && v.publishedAt !== null)
    .sort((a, b) => b.version - a.version)[0];
  const hasDraft = versions.some((v) => v.templateId === template.id && v.publishedAt === null);

  return (
    <>
      <PageHeader
        title={template.name}
        subtitle={
          <>
            Version {version.version} ·{' '}
            {version.publishedAt
              ? `published ${when.format(new Date(version.publishedAt))}`
              : 'draft'}
          </>
        }
      />

      <TemplateEditor
        template={template}
        version={version}
        items={items}
        canRevise={
          version.publishedAt !== null && !hasDraft && newestPublished?.id === version.id
        }
      />
    </>
  );
}
