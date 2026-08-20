// Emails whatever the in-app contact form has collected.
//
// Deploy:  supabase functions deploy support-mailer
// Schedule: pg_cron every five minutes (see the support_messages migration).
//
// Secrets, both set with `supabase secrets set`:
//   RESEND_API_KEY   a Resend key with send permission
//   SUPPORT_INBOX    where support mail should land
//   SUPPORT_FROM     optional; the verified sender, defaults to Resend's
//                    shared onboarding@resend.dev sandbox address
//
// With either of the first two missing this returns quietly and changes
// nothing. That is deliberate: the rows are the record and they keep piling
// up safely in the table, readable from the dashboard, until somebody
// supplies a key. A worker that failed loudly every five minutes on a
// project that has not been configured yet would just train everyone to
// ignore its logs.
//
// Runs with the service role: support_messages has no select policy at all,
// so nothing but the service role can read it.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_URL = 'https://api.resend.com/emails';
const BATCH = 25;

/** Give up after this many tries so one poisoned row cannot block the queue. */
const MAX_ATTEMPTS = 5;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async () => {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const inbox = Deno.env.get('SUPPORT_INBOX');
  const from = Deno.env.get('SUPPORT_FROM') ?? 'Samewhere <onboarding@resend.dev>';

  if (!apiKey || !inbox) {
    return Response.json({
      skipped: 'not configured',
      missing: [!apiKey ? 'RESEND_API_KEY' : null, !inbox ? 'SUPPORT_INBOX' : null].filter(Boolean),
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: pending, error } = await supabase
    .from('support_messages')
    .select('id, user_id, reply_to, body, created_at, delivery_attempts')
    .is('delivered_at', null)
    .lt('delivery_attempts', MAX_ATTEMPTS)
    .order('created_at')
    .limit(BATCH);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return Response.json({ delivered: 0 });
  }

  const report = { delivered: 0, failed: 0, notes: [] as string[] };

  for (const message of pending as any[]) {
    const who = message.user_id ? `account ${message.user_id}` : 'a guest';
    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [inbox],
          // Replying in a mail client should reach the person who wrote in,
          // which is the whole point of asking for their address.
          reply_to: message.reply_to,
          subject: `Samewhere support: ${message.reply_to}`,
          text: [
            `From: ${message.reply_to} (${who})`,
            `Sent: ${message.created_at}`,
            '',
            message.body,
          ].join('\n'),
          html:
            `<p><strong>From:</strong> ${escapeHtml(message.reply_to)} (${escapeHtml(who)})<br>` +
            `<strong>Sent:</strong> ${escapeHtml(message.created_at)}</p>` +
            `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message.body)}</pre>`,
        }),
      });

      if (!response.ok) {
        throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }

      const { error: markError } = await supabase
        .from('support_messages')
        .update({
          delivered_at: new Date().toISOString(),
          delivery_attempts: (message.delivery_attempts ?? 0) + 1,
          delivery_error: null,
        })
        .eq('id', message.id);
      if (markError) {
        // The mail went out. Say so loudly, because the row will be picked up
        // again on the next tick and the founder will get it twice.
        report.notes.push(`${message.id}: sent but not marked: ${markError.message}`);
      }
      report.delivered += 1;
    } catch (sendError) {
      report.failed += 1;
      const attempts = (message.delivery_attempts ?? 0) + 1;
      const detail = (sendError as Error).message.slice(0, 500);
      await supabase
        .from('support_messages')
        .update({ delivery_attempts: attempts, delivery_error: detail })
        .eq('id', message.id);
      report.notes.push(
        attempts >= MAX_ATTEMPTS
          ? `${message.id}: giving up after ${attempts} attempts (${detail}). The row is still in the table.`
          : `${message.id}: ${detail}`
      );
    }
  }

  return Response.json(report);
});
