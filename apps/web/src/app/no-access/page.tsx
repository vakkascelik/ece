import { signOut } from '../login/actions';

/**
 * A signed-in user with no membership. Not an error — it is the normal state
 * between "account created" and "owner added them to a centre", so it reads as
 * a waiting room rather than a failure.
 */
export default function NoAccessPage() {
  return (
    <main className="center">
      <h1>No centre yet</h1>
      <p className="sub">
        Your account is set up, but you have not been added to a centre. An owner or manager
        needs to invite you.
      </p>
      <form action={signOut}>
        <button className="secondary" type="submit">Sign out</button>
      </form>
    </main>
  );
}
