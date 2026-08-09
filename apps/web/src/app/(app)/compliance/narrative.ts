'use server';

/**
 * The only place in this application that asks a model for anything.
 *
 * Its own file rather than a function in `actions.ts`, so the import of `@ece/ai` is
 * visible in one place and a reviewer can see the whole outbound path in one screen: the
 * capability check, the switch, the cap, the payload, the call, the record.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT REACHES THE MODEL
 *
 * Eight integers and a fixed vocabulary of five words. No name, no date of birth, no
 * certificate reference, no centre name, no service number. The payload is assembled
 * from figures already on the screen, and `redactForModel` throws rather than sanitises
 * if it could carry anything else — see `redaction.ts` and [[model-calls]].
 *
 * Deliberately NOT sent, though it would improve the prose: the centre's name, so the
 * narrative can say "Little Pearls". A centre name plus a breach count is a small
 * disclosure, but it is a disclosure about an identifiable organisation, and the sentence
 * reads fine without it. The screen puts the name back afterwards, locally, for free.
 */

import { readMonthSpendCents, recordAiRequest } from '@ece/api';
import { checkSpend, type ModelPayload } from '@ece/core';
import { MODEL, modelClient, summariseFigures } from '@ece/ai';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow } from '@/lib/dayWindow';

export type NarrativeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const FEATURE = 'compliance-narrative';

/**
 * The vocabulary. Every word the model may see that is not a number.
 *
 * Fixed at the call site rather than derived from the data, which is the whole mechanism:
 * `redactForModel` matches labels against this list, so a string that arrived from the
 * database cannot pass no matter what it contains. Adding a word here is a decision
 * somebody makes on purpose.
 */
const LABELS = [
  'staff records',
  'ratio history',
  'seven days',
  'certificates',
  'sign-in events',
] as const;

/**
 * The figures this screen already shows, as a payload.
 *
 * Taken as arguments rather than re-read from the database. Two reasons: the caller has
 * just computed them, so re-reading would risk the prose describing different numbers
 * from the table above it; and this function cannot reach the database for figures, which
 * is the property that stops it quietly widening later.
 */
export interface NarrativeFigures {
  totalRecords: number;
  expiredRecords: number;
  dueSoonRecords: number;
  unsightedRecords: number;
  daysReplayed: number;
  daysWithBreach: number;
  minutesInBreach: number;
  /**
   * Days where a breach was still open at the last recorded event, so its length is
   * unknown rather than zero. Sent separately because `minutesInBreach` cannot represent
   * it — a total of "40 minutes" over a day that never closed is an understatement, and
   * the instruction below tells the model to say so rather than smooth it over.
   */
  daysWithUnknownBreachDuration: number;
  signInEvents: number;
}

export async function generateComplianceNarrative(
  figures: NarrativeFigures,
): Promise<NarrativeResult> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  /*
    The month boundary is the centre's, not UTC's. A centre in Auckland asking on the 1st
    at 9am is thirteen hours into a UTC month that started yesterday, and a cap computed
    on UTC would carry last month's spend forward for half a day. `dayWindow` already
    knows how to turn a local date into an instant, including across a DST change.
  */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: ctx.centre.timezone });
  const monthStart = `${today.slice(0, 7)}-01`;
  const { fromUtc } = dayWindow(monthStart, ctx.centre.timezone);

  try {
    const spentCents = await readMonthSpendCents(db, ctx.centre.id, fromUtc);
    const verdict = checkSpend({ aiFeatures: ctx.centre.aiFeatures, spentCents });

    if (!verdict.allowed) {
      /*
        Recorded even though nothing left the building. A run of zero-cost `blocked` rows
        is how a manager finds out the feature has been refusing all week — a table
        holding only successes could not answer that.

        The insert is inside the same try as everything else on purpose: if recording the
        refusal fails, the user still sees a refusal, because `actionError` returns one.
      */
      await recordAiRequest(db, {
        centreId: ctx.centre.id,
        feature: FEATURE,
        model: MODEL,
        requestedBy: ctx.userId,
        inputTokens: 0,
        outputTokens: 0,
        centsEstimate: 0,
        outcome: 'blocked',
      });

      return {
        ok: false,
        error:
          verdict.reason === 'disabled'
            ? 'Written summaries are switched off for this centre. An owner can turn them on in Settings.'
            : `This centre has reached its monthly limit for written summaries ($${(verdict.spentCents / 100).toFixed(2)}). The figures above are unaffected.`,
      };
    }

    // No key configured in this deployment. A centre that switched the feature on should
    // see a sentence, not a stack trace — and the attempt is still recorded, because
    // "nothing happens when I press it" is the report somebody will make.
    const client = modelClient();
    if (!client) {
      await recordAiRequest(db, {
        centreId: ctx.centre.id,
        feature: FEATURE,
        model: MODEL,
        requestedBy: ctx.userId,
        inputTokens: 0,
        outputTokens: 0,
        centsEstimate: 0,
        outcome: 'blocked',
      });
      return { ok: false, error: 'Written summaries are not available on this deployment.' };
    }

    const payload: ModelPayload = {
      figures: {
        staff_records_total: figures.totalRecords,
        staff_records_expired: figures.expiredRecords,
        staff_records_due_soon: figures.dueSoonRecords,
        staff_records_original_not_sighted: figures.unsightedRecords,
        days_replayed: figures.daysReplayed,
        days_with_a_recorded_breach: figures.daysWithBreach,
        total_minutes_in_breach: figures.minutesInBreach,
        days_where_breach_length_is_unknown: figures.daysWithUnknownBreachDuration,
        attendance_events_in_period: figures.signInEvents,
      },
      labels: [...LABELS],
    };

    const result = await summariseFigures({
      client,
      payload,
      allowedLabels: LABELS,
      question:
        "Summarise this early learning service's position over the last seven days, for a " +
        'manager writing a monthly report. Say what the numbers show and what they do not. ' +
        'If days_where_breach_length_is_unknown is above zero, total_minutes_in_breach is a ' +
        'floor rather than a total, and the summary must say so.',
    });

    await recordAiRequest(db, {
      centreId: ctx.centre.id,
      feature: FEATURE,
      model: MODEL,
      requestedBy: ctx.userId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      centsEstimate: result.centsEstimate,
      outcome: result.outcome,
    });

    if (result.outcome !== 'ok' || !result.text) {
      return { ok: false, error: result.message ?? 'No summary was produced.' };
    }

    return { ok: true, text: result.text };
  } catch (e) {
    // Includes the redactor throwing, which is a bug in this file rather than a user
    // error — `actionError` reports it to Sentry, which is where it needs to be seen.
    const { error } = actionError(e, 'generateComplianceNarrative');
    return { ok: false, error };
  }
}
