import { listMembers } from '@ece/api';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

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
      <h1>{ctx.centre.name}</h1>
      <p className="sub">
        {ctx.centre.moeServiceNumber
          ? `Ministry of Education service ${ctx.centre.moeServiceNumber}`
          : 'No Ministry service number recorded yet'}
      </p>

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

      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Nothing holds child data yet</h2>
        <p className="sub" style={{ margin: 0 }}>
          Enrolment, attendance and daily records are not built. Under-5 records are among the most
          sensitive personal information in New Zealand, and nothing here should hold them before a
          written services agreement and professional indemnity insurance are in place.
        </p>
      </div>
    </>
  );
}
