import type { ReactNode } from 'react';
import { TabHelp } from './help/TabHelp';

/**
 * The top of every screen under (app).
 *
 * WHY THIS EXISTS
 *
 * There were four spellings of the same block. Attendance wrapped its title in
 * `.page-head` with an inline margin override; Incidents used a bare `.has-help` with the
 * subtitle outside it; Compliance, Enquiries and Funding put a `marginBottom: '1rem'` on
 * the subtitle instead; Account and Children used neither. The result was that the top of
 * every screen sat at a slightly different height, which is the loudest available signal
 * that a product was built one screen at a time.
 *
 * IT OWNS ITS OWN BOTTOM MARGIN
 *
 * That is the whole point of the component and the reason the inline overrides could be
 * deleted rather than moved. A caller that writes its own margin here has reintroduced the
 * problem — put the spacing in `.page-header` in globals.css so every screen moves
 * together.
 *
 * `helpHref` IS NOT A LINK, AND MUST NOT BECOME ONE
 *
 * It is the route key `TabHelp` looks a doc up by, and what it renders is the existing
 * in-place `<details>` disclosure — server-rendered, no JavaScript, operable before React
 * hydrates. The name matches the design handover's prop list, which is the only reason it
 * is spelled this way; the handover's mockup draws a `?` beside the title and this is that
 * `?`. Turning it into an anchor to `/help` would undo the argument in HelpNote's own
 * docblock and break the audit that clicks `summary.help-mark` and expects `.help-body`.
 *
 * ONE FILLED BUTTON, AT MOST
 *
 * `actions` is a slot, so this component cannot enforce that, but the rule the screens are
 * written to is: at most one filled button per header and it is the thing the screen exists
 * to do. Exports and print stay secondary — a download styled as the primary action on a
 * compliance screen tells somebody the point of the page is to leave it.
 */
export function PageHeader({
  title,
  subtitle,
  helpHref,
  actions,
  status,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Route key for the help doc, e.g. `/attendance`. Renders nothing if there is no doc. */
  helpHref?: string;
  /** The action row. `PageActions` slots in here unchanged. */
  actions?: ReactNode;
  /**
   * What is outstanding on this screen — never what happened. A centre with forty resolved
   * incidents is in the same state as one with none, and a counter that only goes up is a
   * counter nobody reads. Incidents already computed exactly this; the strip is where it
   * goes now.
   */
  status?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-head">
        {/*
          `.has-help` keeps the `?` on the title's own line rather than below it — it sets
          `display: inline` on the h1 for that reason, and opens the disclosure as a block
          underneath. Reused rather than replaced: it already solves this.
        */}
        <div className="has-help">
          <h1>{title}</h1>
          {helpHref && <TabHelp href={helpHref} />}
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {status && <div className="page-status">{status}</div>}
    </header>
  );
}
