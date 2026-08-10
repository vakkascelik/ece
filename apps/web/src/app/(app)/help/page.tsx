import Link from 'next/link';
import { can } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { TABS } from './tabs';
import { PageHeader } from '../PageHeader';

/**
 * How this product works, for the people using it rather than the people building it.
 *
 * The words come from `tabs.ts`, which is also what the question mark on each screen
 * renders — see the note there on why there is one copy and not two.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FILTERED BY CAPABILITY, LIKE THE NAVIGATION
 *
 * An educator reading about the Accounts screen they cannot open learns only that the
 * product is keeping something from them. The same `can()` calls the sidebar uses decide
 * what appears here, so this page describes the reader's product and not somebody
 * else's. The roles section says plainly that the list differs by role, so a shorter
 * list does not read as a missing feature.
 */

export default async function HelpPage() {
  const ctx = await requireCtx();
  const isParent = ctx.role === 'parent';

  const visible = TABS.filter((t) => t.capability === null || can(ctx.role, t.capability));

  return (
    <>
      <PageHeader
        title="How this works"
        subtitle={
          <>
            Every screen you can open at {ctx.centre.name}, what it is for, and what it will not
            tell you.
          </>
        }
      />

      <div className="card">
        <h2>Why your list is not the same as a colleague’s</h2>
        <p>
          You are signed in as <strong>{ctx.role}</strong>. The menu shows only the screens
          your role can open, so a shorter list is not a missing feature — it is the product
          refusing to offer you a screen that would turn you away.
        </p>
        <ul>
          <li>
            <strong>Owner</strong> and <strong>manager</strong> see everything, including the
            money, compliance and settings screens.
          </li>
          <li>
            <strong>Educator</strong> sees the day: the roll, incidents, sleep checks, site
            safety, visitors, excursions, staff and the roster — but not accounts, compliance
            or settings.
          </li>
          <li>
            <strong>Parent</strong> sees their own tamariki, pānui, messages and their own
            notifications, and nothing about anybody else’s child.
          </li>
        </ul>
        <p>
          Hiding a link is a courtesy, not the lock. What actually stops somebody reaching
          another centre’s records — or another family’s child — is enforced in the database
          underneath, on every request, whatever the screen shows.
        </p>
      </div>

      <div className="card">
        <h2>The question marks</h2>
        <p>
          The <strong>?</strong> beside a heading or a button opens a short explanation of
          that one thing, in place. Nothing is hidden behind hovering, so it works the same
          on a tablet at the door as on a laptop in the office, and it reads aloud for anybody
          using a screen reader.
        </p>
      </div>

      {visible.map((tab) => (
        <div className="card" key={tab.href}>
          <div className="section-head">
            <div>
              <h2 style={{ marginTop: 0 }}>
                <Link href={tab.href}>
                  {isParent && tab.href === '/children'
                    ? 'Your tamariki'
                    : isParent && tab.href === '/posts'
                      ? 'Pānui'
                      : tab.label}
                </Link>
              </h2>
            </div>
          </div>
          <p>{tab.what}</p>
          <p>{tab.how}</p>
          {tab.limit && (
            <p className="flag flag-warn" style={{ whiteSpace: 'normal', display: 'block' }}>
              {'◌'} {tab.limit}
            </p>
          )}
        </div>
      ))}

      <div className="card">
        <h2>Five things worth knowing before you rely on them</h2>
        <ol>
          <li>
            <strong>The ratio figures are a prompt, not a clearance.</strong> The tables
            behind them have not been checked against the regulations by anybody, and the
            screen says so wherever it shows one.
          </li>
          <li>
            <strong>Telling the centre a child is away does not change the fee.</strong> A
            family reporting an absence is telling you they are not coming. Whether that day
            is still charged is your centre’s policy and is handled on the accounts screens.
          </li>
          <li>
            <strong>Sign-ins made with no connection are held on that device.</strong> They
            are sent when the connection returns. Signing out of the product while work is
            still waiting would destroy the only record that a child is in the building, so
            the product asks first.
          </li>
          <li>
            <strong>Nothing here is submitted to the Ministry.</strong> The funding screen
            prepares figures. A person still enters them.
          </li>
          <li>
            <strong>A record nobody entered cannot expire.</strong> An empty compliance
            screen is not a clean one.
          </li>
        </ol>
      </div>
    </>
  );
}
