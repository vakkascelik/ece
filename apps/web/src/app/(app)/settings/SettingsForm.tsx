'use client';

import { useActionState, type ReactNode } from 'react';
import {
  LICENCE_TYPES,
  LICENCE_TYPE_LABELS,
  RATIO_SOURCES,
  SERVICE_MODELS,
  SERVICE_MODEL_LABELS,
  type LicenceType,
  type RatioSource,
  type ServiceModel,
} from '@ece/core';
import { saveCentre } from './actions';

type Result = { error?: string; ok?: boolean } | null;

/**
 * One card, one save.
 *
 * A single form with one button under forty fields is a form nobody finishes, and worse
 * here: it makes somebody who came to change the sleep interval re-submit the Ministry
 * service number on their way out. Each card posts its own `section` and `updateCentre`
 * writes only the columns that section named — see the note in `actions.ts` for why that
 * matters when two people are editing at once.
 *
 * Its own `useActionState`, so a failure in one card cannot report itself under another's
 * save button. That is the whole reason this is a component rather than five `<form>`s in a
 * row sharing one hook.
 */
function SettingsCard({
  section,
  title,
  description,
  children,
}: {
  section: 'details' | 'practice' | 'integrations';
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [state, action, busy] = useActionState(saveCentre, null as Result);

  return (
    <form action={action} className="card settings-card">
      <input type="hidden" name="section" value={section} />
      <h2>{title}</h2>
      {description && <p className="sub settings-card-lede">{description}</p>}

      <div className="settings-fields">{children}</div>

      <div className="settings-save">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {/*
          Beside its own button, never at the top of the page. A message about the section
          somebody just saved, reported next to the control they pressed — `role="status"` so
          a screen reader hears it without the focus moving.
        */}
        {state?.error && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p className="sub" role="status" style={{ margin: 0 }}>
            Saved.
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * The centre's settings.
 *
 * WHICH OF THE HANDOVER'S FIVE SECTIONS EXIST
 *
 * It names Centre details, Hours and rooms, Notifications, Integrations, and Data and
 * retention. Three of those have nothing to put in them: this schema has no rooms concept
 * and no opening hours, no per-centre notification preferences, and no centre-level
 * retention setting. Rendering empty cards for them would be inventing settings — and a
 * settings screen that offers a control the product does not honour is worse than one that
 * is short.
 *
 * So: Centre details, Daily practice, Integrations. "Daily practice" is not one of the five
 * names, because the fields in it — witness rule, sleep interval, drill interval, ratio
 * source — are not hours and they are not rooms, and calling the card by a name that does
 * not describe it is how somebody later fails to find the setting they are looking for.
 */
export function SettingsForm({
  name,
  moeServiceNumber,
  medicationRequiresWitness,
  sleepCheckMinutes,
  drillIntervalDays,
  ratioSource,
  aiFeatures,
  licensedPlaces,
  licenceType,
  serviceModel,
}: {
  name: string;
  moeServiceNumber: string | null;
  medicationRequiresWitness: boolean;
  /** `null` means the centre has stated no interval. Rendered as blank, not as 0. */
  sleepCheckMinutes: number | null;
  /** `null` means the centre has stated none. Rendered blank, not as 0. */
  drillIntervalDays: number | null;
  ratioSource: RatioSource;
  /** Off until somebody turns it on. Nothing leaves this product while it is false. */
  aiFeatures: boolean;
  licensedPlaces: number | null;
  /** `null` means not stated. Nothing defaults either of these — see 0083. */
  licenceType: LicenceType | null;
  serviceModel: ServiceModel | null;
}) {
  return (
    <>
      <SettingsCard
        section="details"
        title="Centre details"
        description="Who this service is, and the figure every occupancy report divides by."
      >
        <div>
          <label htmlFor="name">Centre name</label>
          <input id="name" name="name" defaultValue={name} required />
        </div>

        <div>
          <label htmlFor="moe">Ministry of Education service number</label>
          <input
            id="moe"
            name="moeServiceNumber"
            defaultValue={moeServiceNumber ?? ''}
            inputMode="numeric"
            placeholder="46365"
          />
        </div>

        {/*
          The denominator of every occupancy figure, and blank is a real answer.

          Blank means the centre has not stated its licence, and the report then shows the
          attendance counts — which are real — and declines to compute a percentage. A
          default here would produce confident percentages against a number nobody gave.
        */}
        <div>
          <label htmlFor="places">Children this service is licensed for</label>
          <input
            id="places"
            name="licensedPlaces"
            type="number"
            min={1}
            max={1000}
            step={1}
            defaultValue={licensedPlaces ?? ''}
            style={{ maxWidth: '8rem' }}
          />
          <p className="sub settings-hint">
            From your licence. Leave it blank if you would rather not state it &mdash; the
            occupancy report will show how many tamariki attended and say it cannot work out a
            percentage.
          </p>
        </div>

        {/*
          What kind of service this is. Two questions, because they are two facts: a
          kindergarten and a full-day education-and-care centre hold the same licence and
          run differently.

          "Not stated" is a real answer and the default, for the same reason blank is a real
          answer above — and a sharper one. The service model chooses a ratio schedule, and
          only the all-day centre-based one has been transcribed from Schedule 2. So stating
          it does not yet change the ratio figure; what it does is let this product stop
          applying one schedule to every service silently. See 0083 and unverified-claims 51.
        */}
        <div>
          <label htmlFor="licenceType">Licence type</label>
          <select id="licenceType" name="licenceType" defaultValue={licenceType ?? ''}>
            <option value="">Not stated</option>
            {LICENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LICENCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="sub settings-hint">
            From your licence. If yours is a type not listed here &mdash; a kōhanga reo licence,
            for instance &mdash; leave this blank and tell us, because the list comes from the
            Ministry&rsquo;s licensing page and two of its pages disagree about it.
          </p>
        </div>

        <div>
          <label htmlFor="serviceModel">How this service operates</label>
          <select id="serviceModel" name="serviceModel" defaultValue={serviceModel ?? ''}>
            <option value="">Not stated</option>
            {SERVICE_MODELS.map((m) => (
              <option key={m} value={m}>
                {SERVICE_MODEL_LABELS[m]}
              </option>
            ))}
          </select>
          <p className="sub settings-hint">
            The Ministry asks for this on the RS7 return, as a count of all-day, sessional and
            parent-led operating days. The ratio bands also differ between all-day and
            sessional services, and only the all-day ones have been checked against the
            regulation &mdash; so the figure beside a room still says which schedule it used.
          </p>
        </div>
      </SettingsCard>

      {/*
        Both of these are the CENTRE's decisions, and the wording says so in each case.
        This product has not read the licensing criteria — `criteria` ships empty for
        that reason — so a screen that presented either as a requirement would be
        asserting a regulation nobody here has sourced.
      */}
      <SettingsCard
        section="practice"
        title="Daily practice"
        description="Your centre’s own rules. None of these is a regulation this product has read."
      >
        <div>
          <label htmlFor="witness" className="inline" style={{ gap: '0.5rem' }}>
            <input
              id="witness"
              name="medicationRequiresWitness"
              type="checkbox"
              defaultChecked={medicationRequiresWitness}
            />
            <span>Require a second person to witness every dose of medicine</span>
          </label>
          <p className="sub settings-hint">
            Your centre&rsquo;s policy, not a rule this product has verified. With it on, a dose
            recorded without a witness is refused.
          </p>
        </div>

        <div>
          <label htmlFor="sleep">Minutes between sleep checks</label>
          <input
            id="sleep"
            name="sleepCheckMinutes"
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            defaultValue={sleepCheckMinutes ?? ''}
            placeholder="not set"
          />
          <p className="sub settings-hint">
            Leave blank and the sleep register shows how long ago each child was checked without
            calling anything overdue. This product does not know what the required interval is and
            will not guess one &mdash; state your own and the register measures against it.
          </p>
        </div>

        <div>
          <label htmlFor="drill">Days between emergency drills</label>
          <input
            id="drill"
            name="drillIntervalDays"
            type="number"
            min={1}
            max={730}
            inputMode="numeric"
            defaultValue={drillIntervalDays ?? ''}
            placeholder="not set"
          />
          <p className="sub settings-hint">
            Leave blank and the drill log shows how long it has been without calling it late. Same
            as the sleep interval: this product does not know the required frequency and will not
            guess one.
          </p>
        </div>

        {/*
          The one setting on this page that changes what an existing record MEANS.

          Everything else here adds a rule going forward. This changes where the adult
          half of every ratio comes from — including, on screens that replay history,
          days already recorded. The wording says so, and the binder marks days whose
          source differs from the one in force. See 0040.
        */}
        <div>
          <label htmlFor="ratioSource">Where the adult count comes from</label>
          <select id="ratioSource" name="ratioSource" defaultValue={ratioSource}>
            {RATIO_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s === 'declared'
                  ? 'A number staff enter on the attendance screen'
                  : 'The staff who have signed themselves in'}
              </option>
            ))}
          </select>
          <p className="sub settings-hint">
            These never mix. If you choose staff sign-in and nobody signs in, the ratio reads zero
            adults and shows a breach &mdash; that is deliberate, and it is the point of choosing
            it. Changing this also changes how days already recorded are read back, so the evidence
            binder marks any day that used the other source.
          </p>
        </div>
      </SettingsCard>

      {/*
        The one control in this product that sends data outside it. Worded to be refused
        rather than skimmed past: it names the company, says what it receives, and says what
        it does not. Off until somebody reads it and turns it on — no migration flips it, and
        there should never be one.

        Its own card for that reason, not because "Integrations" is one of the handover's
        five names. A decision to send data offshore should not be three fields below a sleep
        interval where somebody can agree to it while looking at something else.
      */}
      <SettingsCard
        section="integrations"
        title="Integrations"
        description="Anything that sends data outside this product. There is one, and it is off until you turn it on."
      >
        <div>
          <label htmlFor="ai" className="inline" style={{ gap: '0.5rem' }}>
            <input id="ai" name="aiFeatures" type="checkbox" defaultChecked={aiFeatures} />
            <span>Let this centre use written summaries generated by Anthropic&rsquo;s Claude</span>
          </label>
          <p className="sub settings-hint">
            Off by default. With it on, this product may send <strong>totals and dates</strong>{' '}
            &mdash; how many breaches, how much is overdue, which days are short &mdash; to
            Anthropic, a company outside New Zealand, to turn into a paragraph you can put in a
            report.{' '}
            <strong>
              No child&rsquo;s name, date of birth, NSN or health information is ever sent
            </strong>
            , and neither is any staff member&rsquo;s. Anything it writes is a draft for you to
            check, never a compliance finding.
          </p>
        </div>
      </SettingsCard>
    </>
  );
}
