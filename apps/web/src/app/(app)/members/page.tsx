import { listMembers, listPendingInvitations } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
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
      <PageHeader
        title="People"
        helpHref="/members"
        /* The total, then what is unfinished — an invitation nobody has accepted is the
           thing on this screen somebody has to chase. */
        subtitle={
          <>
            {members.length} with access to {ctx.centre.name}
            {invitations.length > 0
              ? ` · ${invitations.length} invitation${
                  invitations.length === 1 ? '' : 's'
                } not yet accepted`
              : ''}
          </>
        }
      />

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
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
