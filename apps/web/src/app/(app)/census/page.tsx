import { readCensusReadiness } from '@ece/api';
import { todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { CensusPerson } from './CensusPerson';

/**
 * The staffing section of the annual ECE Return, and what is missing from it.
 *
 * `manageCentre`, matching `caller_may_roster` in `0081` — the two roles that maintain
 * these records. **No new capability**, because the role set would be identical and a
 * capability only decides whether a link is drawn.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 *
 * It says what is missing, per person, by name. It does not offer to fill anything in
 * that this product cannot source: six of the sixteen fields are unenumerated Ministry
 * code lists and their inputs are disabled with the reason on the screen, because a text
 * box there would put an invented code in a return to the Crown.
 *
 * And it never says "ready to submit". Nothing here submits anything — the Return goes
 * through ELI Web, keyed in by a person — so the strongest claim on the page is that no
 * required field is blank. See llm-wiki/wiki/eli-integration.md.
 *
 * NOT ON THIS SCREEN, DELIBERATELY: a person's own view of their own record. `0081`
 * permits it — the read policy allows owner, manager, or the person themselves, because
 * IPP 6 gives someone a right of access to their own information — but a screen showing
 * somebody their employer's record of their ethnicity wants its own thinking about
 * correction (IPP 7) rather than being bolted onto the management page. Until it exists,
 * that access is a request to the centre, which is a legitimate answer and not a
 * complete one.
 */
export default async function CensusPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const today = todayInZone(ctx.centre.timezone);
  const { summary, contactHours, details, loadedDomains } = await readCensusReadiness(
    db,
    ctx.centre.id,
    today,
  );

  const byMember = new Map<string, typeof contactHours>();
  for (const h of contactHours) {
    const list = byMember.get(h.staffMemberId) ?? [];
    list.push(h);
    byMember.set(h.staffMemberId, list);
  }

  return (
    <>
      <PageHeader
        title="ECE Return — staffing"
        subtitle="Staff details and qualifications, as the annual Return asks for them"
        helpHref="/census"
        status={
          summary.incompleteCount > 0
            ? `${summary.incompleteCount} incomplete`
            : undefined
        }
      />

      <section className="card">
        <h2>Where this stands</h2>
        {summary.rows.length === 0 ? (
          <p>
            Nobody is on the roster as at {today}, so there is nothing to report. Add people
            on the <a href="/staff">Staff</a> screen first.
          </p>
        ) : (
          <p>
            {summary.incompleteCount === 0 ? (
              <>
                All {summary.rows.length} people on the roster have every field the Return
                requires.
              </>
            ) : (
              <>
                <strong>
                  {summary.incompleteCount} of {summary.rows.length}
                </strong>{' '}
                people are missing something the Return requires.
              </>
            )}
          </p>
        )}

        {/*
          Three states, and the third is why this is not a boolean. `null` means no code
          set was loaded at all, so nothing was checked — which must not render the same
          as everything passing. The day the first Ministry list is imported has to look
          different from the day before it.
        */}
        <p>
          {summary.codesChecked === true ? (
            <span className="flag flag-ok">Codes checked</span>
          ) : (
            <span className="flag flag-warn">Codes not checked</span>
          )}{' '}
          {summary.codesChecked === null
            ? 'No Ministry code lists are loaded, so no code here has been checked against one. Six fields cannot be filled in until a list is imported.'
            : summary.codesChecked === false
              ? 'A Ministry list is loaded for only part of what the Return asks for, so some codes are unchecked.'
              : 'Every code recorded here was checked against a current Ministry list.'}
        </p>

        <p className="sub">
          This screen prepares figures. It cannot submit anything: the Return goes to the
          Ministry through ELI Web, and a person reviews and files it. Using this product
          does not remove your service&rsquo;s responsibility for the accuracy of what is
          submitted.
        </p>
      </section>

      <section className="card">
        <h2>People on the roster as at {today}</h2>
        {summary.rows.map((row) => (
          <CensusPerson
            key={row.staffMemberId}
            row={row}
            details={details.get(row.staffMemberId) ?? null}
            hours={byMember.get(row.staffMemberId) ?? []}
            loadedDomains={loadedDomains}
            today={today}
          />
        ))}
      </section>
    </>
  );
}
