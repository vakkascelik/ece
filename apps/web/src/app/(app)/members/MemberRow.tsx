'use client';

import { useActionState } from 'react';
import { MEMBER_ROLES, type MemberRole } from '@ece/core';
import { changeRole, revoke } from './actions';

type Result = { error?: string; ok?: boolean } | null;

/**
 * One roster row.
 *
 * A client component purely so the guard messages are visible. "This is the only
 * owner" is the difference between a refused click and a centre nobody can
 * administer, and a server-action form that returns void would swallow it.
 */
export function MemberRow({
  membershipId,
  email,
  role,
  isSelf,
}: {
  membershipId: string;
  email: string | null;
  role: MemberRole;
  isSelf: boolean;
}) {
  const [roleState, roleAction, roleBusy] = useActionState(changeRole, null as Result);
  const [revokeState, revokeAction, revokeBusy] = useActionState(revoke, null as Result);
  const error = roleState?.error ?? revokeState?.error;

  return (
    <tr>
      <td>
        {email ?? <span className="sub">unknown</span>}
        {isSelf && <span className="pill" style={{ marginLeft: '0.5rem' }}>you</span>}
        {error && <div className="error" style={{ fontSize: '0.8125rem' }}>{error}</div>}
      </td>
      <td>
        <form action={roleAction} className="row" style={{ gap: '0.4rem' }}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <select name="role" defaultValue={role} style={{ maxWidth: '9rem' }}>
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button className="secondary" type="submit" disabled={roleBusy}>
            {roleBusy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </td>
      <td>
        <form action={revokeAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <button className="danger" type="submit" disabled={revokeBusy}>
            {revokeBusy ? 'Removing…' : 'Remove'}
          </button>
        </form>
      </td>
    </tr>
  );
}
