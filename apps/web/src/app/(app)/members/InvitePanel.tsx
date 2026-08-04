'use client';

import { useActionState, useState } from 'react';
import { MEMBER_ROLES, type MemberRole } from '@ece/core';
import type { Invitation } from '@ece/api';
import { invite, withdrawInvite, type InviteResult } from './actions';

/**
 * Issuing and withdrawing invitations.
 *
 * The link is shown once, on screen, because no mailer is configured — and saying so
 * plainly beats a "we've sent an email" that never arrives. The manager copies it
 * into whatever they already use to talk to their staff.
 */
export function InvitePanel({
  invitations,
  centreName,
}: {
  invitations: Invitation[];
  centreName: string;
}) {
  const [state, action, pending] = useActionState<InviteResult | null, FormData>(invite, null);
  const error = state && 'error' in state ? state.error : null;
  const issued = state && 'ok' in state ? state : null;

  return (
    <>
      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>Invite someone</h2>
        <p className="sub" style={{ margin: '0 0 1rem', fontSize: '0.8125rem' }}>
          They set their own password and join {centreName}. The link works once and
          expires after seven days.
        </p>

        <form action={action}>
          <div className="row">
            <div style={{ flex: 1, minWidth: '14rem' }}>
              <label htmlFor="invite-email">Email</label>
              <input id="invite-email" name="email" type="email" required autoComplete="off" />
            </div>
            <div>
              <label htmlFor="invite-role">Role</label>
              <select id="invite-role" name="role" defaultValue="educator">
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {label(r)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create invitation'}
              </button>
            </div>
          </div>
        </form>

        {error && (
          <p className="error" role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        )}

        {issued && <IssuedLink email={issued.email} link={issued.link} />}
      </div>

      {invitations.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Waiting to be accepted</h2>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th style={{ width: '1%' }} />
              </tr>
            </thead>
            <tbody>
              {invitations.map((i) => (
                <PendingRow key={i.id} invitation={i} />
              ))}
            </tbody>
          </table>
          <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
            {/*
              The reason the manager cannot just look the link up again: it was never
              stored. Only its hash is, which is why a leaked backup is not a set of
              working invitations.
            */}
            Links cannot be shown again — only a hash of each one is kept. If somebody
            loses theirs, invite them again and the old link stops working.
          </p>
        </div>
      )}
    </>
  );
}

/** Shown once. There is no second chance to read it, so it is hard to miss. */
function IssuedLink({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.9rem',
        border: '1px solid var(--ok-border)',
        background: 'var(--ok-soft)',
        borderRadius: '8px',
      }}
    >
      <p style={{ margin: '0 0 0.5rem' }}>
        <span className="flag flag-ok">✓ Invitation for {email}</span>
      </p>
      <p className="sub" style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem' }}>
        Send them this link. It is shown only now — it is not stored and cannot be
        retrieved.
      </p>
      <input readOnly value={link} className="wide" aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
      <p style={{ margin: '0.5rem 0 0' }}>
        <button
          className="secondary small"
          type="button"
          onClick={() => {
            // `navigator.clipboard` is unavailable over plain HTTP on a LAN address,
            // which is exactly how a centre reaches a machine in the office. So the
            // input above is the real answer and this is the convenience.
            navigator.clipboard?.writeText(link).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </p>
    </div>
  );
}

function PendingRow({ invitation }: { invitation: Invitation }) {
  const [state, action, pending] = useActionState(withdrawInvite, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <tr>
      <td>
        {invitation.email}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>{label(invitation.role)}</td>
      <td>{new Date(invitation.expiresAt).toLocaleDateString('en-NZ')}</td>
      <td>
        <form action={action}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button className="danger small" type="submit" disabled={pending}>
            Withdraw
          </button>
        </form>
      </td>
    </tr>
  );
}

function label(role: MemberRole): string {
  return role === 'parent' ? 'Parent or whānau' : role[0].toUpperCase() + role.slice(1);
}
