import { listMembers } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { MemberRow } from './MemberRow';

export default async function MembersPage() {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();
  const members = await listMembers(db, ctx.centre.id);

  return (
    <>
      <h1>People</h1>
      <p className="sub">Who can see and change {ctx.centre.name}.</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th style={{ width: '1%' }} />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                membershipId={m.id}
                email={m.email}
                role={m.role}
                isSelf={m.userId === ctx.userId}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Adding someone</h2>
        <p className="sub" style={{ margin: 0 }}>
          Invitations are not built. Adding a person means creating their account and their
          membership, which needs the service-role key and therefore a deliberate server-side
          flow — not a form on this page. Left until there is an agreed onboarding process,
          because the self-serve version is how a stranger joins a centre.
        </p>
      </div>
    </>
  );
}
