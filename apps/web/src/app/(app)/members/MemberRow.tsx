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

  /*
   * WCAG 4.1.2 and 2.4.6, found by the axe audit rather than by looking.
   *
   * A visual reader gets the name of the person from the cell to the left. A screen
   * reader user tabbing through this table got "combo box, educator", then "Save,
   * button", then "Remove, button" — repeated once per person, with nothing to say
   * whose row they were in. On the screen that changes who can administer a centre
   * and who can be removed from it, that is not a rough edge.
   *
   * `aria-label` rather than a visible <label>: a label per row would repeat the
   * email three times in a cramped table, which is worse for everybody. The name is
   * the thing that has to be in the accessible name, not necessarily on screen.
   */
  const who = email ?? 'this person';

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
          <select
            name="role"
            defaultValue={role}
            aria-label={`Role for ${who}`}
            style={{ maxWidth: '9rem' }}
          >
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            className="secondary"
            type="submit"
            disabled={roleBusy}
            aria-label={`Save the role for ${who}`}
          >
            {roleBusy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </td>
      <td>
        <form action={revokeAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <button
            className="danger"
            type="submit"
            disabled={revokeBusy}
            aria-label={`Remove ${who} from this centre`}
          >
            {revokeBusy ? 'Removing…' : 'Remove'}
          </button>
        </form>
      </td>
    </tr>
  );
}
