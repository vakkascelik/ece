/**
 * Quiet hours, and the vocabulary whānau read.
 *
 * The quiet-hours window is stored as local wall-clock times, because a family means "not
 * before 7am" in their own morning — which is a different instant in April than in October.
 * So the comparison has to happen in the centre's timezone, and the window normally **wraps
 * midnight**, which is the part that gets written wrongly.
 */

/**
 * The private storage bucket for media.
 *
 * Here rather than in each app so the name cannot drift between the uploader, the reader and the
 * orphan sweeper — three places that must agree or files go missing.
 */
export const MEDIA_BUCKET = 'media';

/**
 * The private storage bucket for evidence photos (0075) — incidents and checklist
 * runs. A separate bucket from `media` on purpose: consent gates publication, and
 * an evidence photo is internal documentation that must never enter the gated
 * pipeline. Same drift argument as MEDIA_BUCKET for why the name lives here.
 */
export const EVIDENCE_BUCKET = 'evidence';

export const NOTIFICATION_KINDS = ['post', 'message', 'attendance', 'reminder', 'emergency'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationPreferences {
  posts: boolean;
  messages: boolean;
  attendance: boolean;
  reminders: boolean;
  quietHours: boolean;
  /** `HH:MM` or `HH:MM:SS`, local to the centre. */
  quietFrom: string;
  quietUntil: string;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  posts: true,
  messages: true,
  // Off by default. A parent does not need a push notification every time their child is
  // signed in — they were standing there.
  attendance: false,
  reminders: true,
  quietHours: true,
  quietFrom: '20:00',
  quietUntil: '07:00',
};

// 'emergency' has no entry and no opt-out — see wantsKind below.
const ENABLED: Record<Exclude<NotificationKind, 'emergency'>, keyof NotificationPreferences> = {
  post: 'posts',
  message: 'messages',
  attendance: 'attendance',
  reminder: 'reminders',
};

/**
 * Whether this person's preferences allow this kind — except `emergency`, which is not a
 * preference question. There is no toggle for it in `NotificationPreferences` and there
 * will not be one: a family cannot opt out of being told the building is being evacuated,
 * so the type has nothing to check here rather than a boolean that could be set to false.
 */
export function wantsKind(prefs: NotificationPreferences, kind: NotificationKind): boolean {
  if (kind === 'emergency') return true;
  return prefs[ENABLED[kind]] === true;
}

/** Minutes since local midnight, from `HH:MM` or `HH:MM:SS`. */
function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Not a time: ${time}`);
  }
  return h * 60 + m;
}

/** Local wall clock in a timezone, as minutes since midnight, plus the local date. */
function localClock(at: Date, timeZone: string): { minutes: number; date: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    // Intl renders midnight as hour 24 in some runtimes.
    const hour = Number(get('hour')) % 24;
    return {
      minutes: hour * 60 + Number(get('minute')),
      date: `${get('year')}-${get('month')}-${get('day')}`,
    };
  } catch {
    // A runtime without full ICU. Falling back to device local is wrong on a server and right
    // on a phone — and holding a notification forever would be worse than sending it early.
    return {
      minutes: at.getHours() * 60 + at.getMinutes(),
      date: `${at.getFullYear()}-${`${at.getMonth() + 1}`.padStart(2, '0')}-${`${at.getDate()}`.padStart(2, '0')}`,
    };
  }
}

/**
 * Is this instant inside the quiet window?
 *
 * The window wraps midnight in the normal case (20:00 → 07:00), so a plain `from <= now < until`
 * comparison is inside-out for the majority of configurations. Both orientations are handled and
 * both are tested.
 *
 * `from === until` means the whole day is quiet, not none of it. That reading is the safe one:
 * somebody who sets both to the same value has asked for silence, and interpreting it as "always
 * send" would be the opposite of what they touched the setting for.
 */
export function inQuietHours(
  prefs: NotificationPreferences,
  at: Date,
  timeZone: string,
): boolean {
  if (!prefs.quietHours) return false;

  const now = localClock(at, timeZone).minutes;
  const from = minutesOfDay(prefs.quietFrom);
  const until = minutesOfDay(prefs.quietUntil);

  if (from === until) return true;
  // Wrapping window: quiet from the evening, through midnight, to the morning.
  if (from > until) return now >= from || now < until;
  // Same-day window, e.g. a nap-time block of 12:00 → 14:00.
  return now >= from && now < until;
}

/**
 * When a notification of this kind may be delivered — or `null` for never.
 *
 * Returns an instant rather than a boolean so the decision can be **written down** at queue
 * time. A worker that re-derived it on every pass would release everything held overnight the
 * moment somebody changed a preference at midnight, which is not what the family who was asleep
 * asked for.
 */
export function deliverableAt(
  prefs: NotificationPreferences,
  kind: NotificationKind,
  at: Date,
  timeZone: string,
): Date | null {
  if (!wantsKind(prefs, kind)) return null;
  if (!inQuietHours(prefs, at, timeZone)) return at;

  const until = minutesOfDay(prefs.quietUntil);
  const { minutes: now } = localClock(at, timeZone);

  // Minutes to wait until the local wall clock reaches `quietUntil`. If it has already passed
  // today, the window wraps and the target is tomorrow morning.
  const wait = until > now ? until - now : 24 * 60 - now + until;
  return new Date(at.getTime() + wait * 60_000);
}

/**
 * Should this be delivered right now?
 *
 * A convenience for a worker that has already fetched a due row. The queue's `send_after` is the
 * authority; this is the second check for the case where a preference changed since.
 */
export function deliverableNow(
  prefs: NotificationPreferences,
  kind: NotificationKind,
  at: Date,
  timeZone: string,
): boolean {
  return wantsKind(prefs, kind) && !inQuietHours(prefs, at, timeZone);
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Te reo where it is natural and correct, per the plan.
 *
 * Used where the word is already the ordinary one in a New Zealand early learning setting —
 * whānau, kaiako, tamariki, pānui are what staff and families say. Not applied as decoration:
 * translating "Settings" or "Sign out" into te reo in an app whose interface is otherwise English
 * is tokenism, and getting it slightly wrong in front of Māori families is worse than not trying.
 *
 * Macrons are correct and not optional. `panui` without one is a different word.
 */
export const REO = {
  /** Family, in the broad sense. The ordinary word in this sector. */
  whanau: 'whānau',
  /** Teacher / educator. */
  kaiako: 'kaiako',
  /** Children. */
  tamariki: 'tamariki',
  /** A notice or announcement. */
  panui: 'pānui',
  /** Welcome. */
  nauMai: 'nau mai',
} as const;

export const POST_KIND_LABELS = {
  learning_moment: 'Learning moment',
  daily_update: 'Daily update',
  panui: 'Pānui',
} as const;

export type PostKind = keyof typeof POST_KIND_LABELS;

/**
 * Whether a comment on a post appears at once, waits for a kaiako, or cannot be left.
 *
 * The default is `approved_first` and it is set in the column default, not here — a
 * label map is not the place a policy decision should live. These are the words for it.
 *
 * The order is the order the radio group offers, and it is deliberate: the safe option
 * is first and is the one somebody gets by not choosing.
 */
export const COMMENT_MODE_LABELS = {
  approved_first: 'A kaiako approves each comment',
  auto: 'Comments appear straight away',
  disabled: 'No comments on this post',
} as const;

export type CommentMode = keyof typeof COMMENT_MODE_LABELS;
