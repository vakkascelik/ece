import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Notification email for the enrolment enquiry form.
 *
 * Added 2026-08-27 on the owner's instruction: enquiries should arrive as email at
 * `enrolment@littlepearls.org.nz`, not only as a row somebody has to go and look at.
 *
 * WHY EMAIL IS THE NOTIFICATION AND POSTGRES IS STILL THE RECORD
 *
 * The database write stays. It is not redundancy for its own sake — it decides what happens when
 * this fails. An enquiry that exists only as an email is an enquiry that is gone if the send
 * throws, if the mailbox is full, or if a spam filter eats it, and the family who typed it has
 * already been told "thank you, we will be in touch". With the row written first, a failed send
 * costs a notification, not a family. So `send()` never changes what the form tells the visitor.
 *
 * `server-only` is not decoration. This module holds an SMTP password, and importing it from a
 * client component is the mistake that would put it in the browser bundle. The import fails the
 * build instead.
 *
 * WHY SMTP TO THEIR OWN MAILBOX RATHER THAN A SENDING SERVICE
 *
 * Resend or SES would mean a new vendor, a new API key and new DKIM records on a domain that was
 * migrated yesterday. This posts to `mail.littlepearls.org.nz` as the mailbox it is writing to,
 * over implicit TLS on 465, which is the host and port cPanel itself hands out in its mail-client
 * settings. No new DNS, no new bill, nothing to verify. The cost is that mail delivery is only as
 * good as the InMotion box — and the row in Postgres is the answer to that.
 */

/** Built once. Nodemailer pools connections, and a transport per request reconnects every time. */
let cached: Transporter | null = null;

function transporter(): Transporter | null {
  if (cached) return cached;

  const host = process.env.ENROLMENT_SMTP_HOST;
  const user = process.env.ENROLMENT_SMTP_USER;
  const pass = process.env.ENROLMENT_SMTP_PASS;

  // Absent config disables the notification rather than crashing the form. Local development and
  // preview deploys have no mailbox credentials and must still be able to submit the form; the
  // caller logs the skip, so it is visible rather than silent.
  if (!host || !user || !pass) return null;

  const port = Number(process.env.ENROLMENT_SMTP_PORT ?? 465);
  cached = nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 is STARTTLS and must NOT set this or the handshake never happens.
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

export type EnquiryNotification = {
  contactName: string;
  email: string;
  phone: string;
  centres: string[];
  ageBand: string | null;
  wantedFrom: string;
  wantedDays: number[];
  message: string;
};

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Plain text, no HTML.
 *
 * Everything in here was typed by a member of the public. An HTML body would mean escaping it
 * correctly forever, and the only thing that buys is bold labels in a message a manager reads once
 * and acts on. Plain text cannot carry an injection.
 */
function body(n: EnquiryNotification): string {
  const line = (label: string, value: string) => `${label.padEnd(14)}${value || '—'}`;
  return [
    'A new enrolment enquiry came in through littlepearls.org.nz.',
    '',
    line('Name', n.contactName),
    line('Email', n.email),
    line('Phone', n.phone),
    line('Centre', n.centres.join(', ')),
    line('Age', n.ageBand ?? ''),
    line('Wanted from', n.wantedFrom),
    line('Days', n.wantedDays.map((d) => DAYS[d]).filter(Boolean).join(', ')),
    '',
    'Message:',
    n.message || '—',
    '',
    '—',
    'This is a notification. The enquiry is also saved in the centre system, so it is not lost',
    'if this email is.',
  ].join('\n');
}

/**
 * Best effort, by design. Returns whether it sent; never throws.
 *
 * The caller has already written the row and has already decided what to tell the family. A
 * notification that fails loudly into the logs is recoverable; one that turns a saved enquiry into
 * an error message on screen is not.
 */
export async function sendEnquiryNotification(n: EnquiryNotification): Promise<boolean> {
  const tx = transporter();
  if (!tx) {
    console.warn('enrolment notification skipped: ENROLMENT_SMTP_* not configured');
    return false;
  }

  const to = process.env.ENROLMENT_NOTIFY_TO ?? process.env.ENROLMENT_SMTP_USER!;

  try {
    await tx.sendMail({
      from: `"Little Pearls website" <${process.env.ENROLMENT_SMTP_USER}>`,
      to,
      // So a manager can hit reply and be answering the family, not the website. The envelope
      // sender stays the mailbox — putting a stranger's address there is what fails SPF.
      replyTo: n.email || undefined,
      subject: `Enrolment enquiry — ${n.contactName || 'no name given'}`,
      text: body(n),
    });
    return true;
  } catch (error) {
    console.error('enrolment notification failed to send', error);
    return false;
  }
}
