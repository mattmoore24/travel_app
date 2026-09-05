import type { PostgrestError } from '@supabase/supabase-js';

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
export async function sendSupportMessage(input: {
  replyTo: string;
  body: string;
  /**
   * The sender's own triage hint: 'safety' | 'account' | 'other'. Optional in
   * the database (an older bundle sends two arguments and the defaulted third
   * parameter keeps that call working), so it is optional here too.
   */
  category?: string | null;
}) {
  const { data, error } = await supabase.rpc('submit_support_message', {
    p_reply_to: input.replyTo,
    p_body: input.body,
    p_category: input.category ?? undefined,
  });
  if (error) {
    throw error;
  }
  return data as unknown as string;
}

/**
 * `my_report_status` and `my_support_messages` are not in
 * database.types.ts's Functions map yet — that file is hand-maintained — and
 * `supabase.rpc` only accepts a name it finds there. One narrow door, and a
 * door rather than an `any`: the row type is still checked at both calls
 * below. Delete it the moment the two Functions entries land.
 */
type UntypedRpc = <T>(
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: T | null; error: PostgrestError | null }>;

const untypedRpc = supabase.rpc as unknown as UntypedRpc;

/**
 * Two states, and there will never be a third.
 *
 * A third state is a moderation outcome about another person — "we banned
 * them", said in two words — published to anybody willing to file a report to
 * find out. The database is what enforces the collapse (every resolved report
 * of either kind maps to one word in 20260902250000, and the pgTAP suite
 * proves a ban, a dismissal and a removed listing come back identical); this
 * type is the client half saying it has nowhere to put one.
 */
export type ReportState = 'received' | 'reviewed';

export type MyReportRow = {
  id: string;
  created_at: string;
  /**
   * The raw reason, as text rather than an enum, because two tables answer
   * this question: a report about a person carries a `report_reason` and a
   * report about a business carries a `business_report_reason`. The two label
   * sets have no value in common, so one flat lookup on the screen is
   * unambiguous.
   */
  reason: string;
  state: ReportState;
};

export type MySupportMessageRow = {
  id: string;
  created_at: string;
  /** The sender's own triage hint. Null for anything written before the chips. */
  category: string | null;
  delivered: boolean;
};

/**
 * Every report this account has filed, about people and about businesses
 * alike, newest first.
 *
 * Nothing about the account or the listing reported, in either direction —
 * see the migration, which is where that is enforced.
 */
export async function fetchMyReports(): Promise<MyReportRow[]> {
  const { data, error } = await untypedRpc<MyReportRow[]>('my_report_status', {});
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * Every message this account has written to support, and whether it has
 * reached us. Never the body, never the address.
 *
 * This replaced `support_message_status(p_id)`, which asked the question the
 * other way round and needed an id the client had thrown away — so nothing
 * ever called it. Asking "which of these are mine" needs no bookkeeping on
 * the phone and survives a reinstall.
 */
export async function fetchMySupportMessages(): Promise<MySupportMessageRow[]> {
  const { data, error } = await untypedRpc<MySupportMessageRow[]>('my_support_messages', {});
  if (error) {
    throw error;
  }
  return data ?? [];
}
