import { revalidatePath } from 'next/cache';
import { signOut } from '../login/actions';

/**
 * Screen 7 of the design handoff, second half.
 *
 * A signed-in user with no membership. **This is a waiting room, not an error** — it
 * is the normal state between "account created" and "owner added them to a centre",
 * so there is no red, no error glyph and nothing that reads as the person's fault.
 * The copy is the handoff's, verbatim.
 *
 * "Check again" is a real action rather than a link to this same page: the reason
 * somebody is on this screen is that they are waiting for a membership to appear, and
 * a plain reload would be served from the router cache showing the same emptiness.
 */
export default function NoAccessPage() {
  async function checkAgain() {
    'use server';
    // Both, because the membership landing is what changes the answer here and the
    // shell above decides where this user goes next.
    revalidatePath('/no-access');
    revalidatePath('/');
  }

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>You&rsquo;re signed in. No centre yet.</h1>
        <p>
          When your centre accepts you, it will appear here — nothing else is needed from you.
        </p>
      </div>

      <form action={checkAgain}>
        <button className="secondary auth-secondary" type="submit">Check again</button>
      </form>

      <form action={signOut}>
        <button className="secondary auth-secondary" type="submit">Sign out</button>
      </form>
    </main>
  );
}
