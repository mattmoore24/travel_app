import type { SupportMessageStatusRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/**
 * Write a message to support, and get back the id of what was written.
 *
 * Through a function rather than a plain insert, for one reason: the insert
 * policy on support_messages is write-only — deliberately, since the table
 * holds other people's complaints — so PostgREST cannot return the new row,
 * and without an id the app can never ask what became of the message it just
 * sent. The function decides the author itself, and the table's rate limit
 * still fires, so it grants nothing an insert did not.
 *
 * The row is the durable record and delivery is only the notification: it
 * lands even if the mailer is unconfigured or Resend is down.
 */
export async function sendSupportMessage(input: { replyTo: string; body: string }) {
  const { data, error } = await supabase.rpc('submit_support_message', {
    p_reply_to: input.replyTo,
    p_body: input.body,
  });
  if (error) {
    throw error;
  }
  return data as unknown as string;
}

/**
 * What became of one message you wrote. Yours only, and never its content.
 *
 * Guests get nothing back — their message has no owner to match — so the
 * caller has to be ready for null rather than treating it as a failure.
 */
export async function fetchSupportMessageStatus(id: string) {
  const { data, error } = await supabase.rpc('support_message_status', { p_id: id });
  if (error) {
    throw error;
  }
  return ((data ?? []) as SupportMessageStatusRow[])[0] ?? null;
}
