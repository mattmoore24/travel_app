import { supabase } from '@/lib/supabase';

/**
 * Write a message to support.
 *
 * Straight into the table rather than through a function: the row IS the
 * record, so it must land even if the mailer is unconfigured or Resend is
 * down. Rate limits and validation live on the table, where a client cannot
 * talk its way past them.
 */
export async function sendSupportMessage(input: {
  userId: string | null;
  replyTo: string;
  body: string;
}) {
  const { error } = await supabase.from('support_messages').insert({
    user_id: input.userId,
    reply_to: input.replyTo,
    body: input.body,
  });
  if (error) {
    throw error;
  }
}
