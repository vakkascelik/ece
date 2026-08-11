import { listMembers } from '@ece/api';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from './PageHeader';

export default async function OverviewPage() {
  const ctx = await requireCtx();
  const db = await serverDb();
  const members = await listMembers(db, ctx.centre.id);

  const byRole = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title={ctx.centre.name}
        subtitle={
          ctx.centre.moeServiceNumber
            ? `Ministry of Education service ${ctx.centre.moeServiceNumber}`
            : 'No Ministry service number recorded yet'
        }
      />

      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem' }}>People with access</h2>
        {members.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>Nobody yet.</p>
        ) : (
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {(['owner', 'manager', 'educator', 'parent'] as const).map((r) => (
              <div key={r}>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{byRole[r] ?? 0}</div>
                <div className="sub" style={{ margin: 0 }}>{r}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/*
        THIS CARD SAID THE OPPOSITE UNTIL 2026-08-11, AND SAID IT TO EVERY OWNER ON SIGN-IN.

        It read "Nothing holds child data yet — enrolment, attendance and daily records are
        not built". That was true when it was written and stopped being true several phases
        ago: this centre's records now hold every one of those things. A placard left over
        from before a product did its job is worse than no placard, because the one screen
        everybody lands on was telling them the product does less than it does.

        What survives is the half that is still true, and it is quoted from AGENTS.md §1
        rather than reworded, because the list of what is held is the sort of sentence that
        drifts if it is paraphrased twice.

        What was dropped is the clause about a services agreement and professional indemnity
        insurance. An agreement exists; the insurance position is not something this repo can
        see, so the product now asserts neither — recorded as item 35 in unverified-claims
        rather than deleted quietly, because removing a caution is a decision and not a tidy-up.
      */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>What this centre&rsquo;s records hold</h2>
        <p className="sub" style={{ margin: 0 }}>
          Children&rsquo;s names, dates of birth, allergies, medication doses, custody arrangements
          and attendance records. Under-5 records are among the most sensitive personal
          information in the country and a breach is notifiable &mdash; which is why who can read
          what is decided in the database on every request, and not by what a screen happens to
          show.
        </p>
      </div>
    </>
  );
}
