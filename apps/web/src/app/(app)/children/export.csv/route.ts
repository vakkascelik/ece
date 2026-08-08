import { listChildren, listGuardiansOfChild } from '@ece/api';
import { displayName, formatAge, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * The roll, as a spreadsheet — for a Ministry return, an emergency list, or a merge.
 *
 * `manageChildren`, which is stricter than the page. `/children` is readable by an
 * educator and by a parent, because the policy decides how many rows each of them gets:
 * a parent sees one child. A *file* is different. It leaves the product, gets emailed,
 * and sits in a downloads folder — so the export is owner and manager only, and that is
 * a deliberate narrowing rather than an oversight.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT IN IT
 *
 * No health conditions, no allergies, no custody notes. A spreadsheet of children's
 * medical information is the single most damaging file this product could produce, and
 * "it would be convenient" is not a reason to produce it. The emergency list that
 * genuinely needs allergies is a printed page with a header on it, not a CSV.
 *
 * Guardian contact details ARE included, because an emergency contact list is most of
 * why a centre wants this file at all — and they are already on a screen an owner can
 * read.
 */
export async function GET() {
  const ctx = await requireCapability('manageChildren');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const children = await listChildren(db, ctx.centre.id);

  /*
    One guardian query per child. A licence caps a centre at a few dozen children, so
    this is dozens of round trips on a download somebody presses occasionally — slow
    enough to notice and fast enough to be honest, and it reuses the reader that already
    exists rather than adding a joined one for a single caller.
  */
  const whanau = await Promise.all(
    children.map(async (child) => ({
      child,
      guardians: await listGuardiansOfChild(db, child.id),
    })),
  );

  return csvDownload({
    rows: whanau,
    kind: 'children',
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Name', value: (r) => displayName(r.child) },
      { header: 'Legal first name', value: (r) => r.child.firstName },
      { header: 'Legal last name', value: (r) => r.child.lastName },
      { header: 'Date of birth', value: (r) => r.child.dateOfBirth },
      { header: 'Age', value: (r) => formatAge(r.child.dateOfBirth, today) },
      { header: 'NSN', value: (r) => r.child.moeNsn },
      { header: 'Ethnicities', value: (r) => r.child.ethnicities.join(' ') },
      { header: 'Iwi', value: (r) => r.child.iwi },
      { header: 'First language', value: (r) => r.child.firstLanguage },
      {
        header: 'Whānau',
        value: (r) => r.guardians.map((g) => `${g.guardian.fullName} (${g.relationship})`).join('; '),
      },
      {
        header: 'Contact',
        value: (r) => r.guardians.map((g) => g.guardian.phone ?? g.guardian.email ?? '').filter(Boolean).join('; '),
      },
      {
        // The collection list, which is the column an emergency file is opened for.
        header: 'May collect',
        value: (r) => r.guardians.filter((g) => g.canCollect).map((g) => g.guardian.fullName).join('; '),
      },
    ],
  });
}
