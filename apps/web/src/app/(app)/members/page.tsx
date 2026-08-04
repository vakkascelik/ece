import { listMembers, listPendingInvitations } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { InvitePanel } from './InvitePanel';
import { MemberRow } from './MemberRow';

export default async function MembersPage() {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();
  const [members, invitations] = await Promise.all([
    listMembers(db, ctx.centre.id),
    listPendingInvitations(db, ctx.centre.id),
  ]);

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

      <InvitePanel invitations={invitations} centreName={ctx.centre.name} />
    </>
  );
}
