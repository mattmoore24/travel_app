import fs from 'node:fs';
import path from 'node:path';

/**
 * The shape of the withdraw, read off the migration.
 *
 * pgTAP owns the behaviour (58_a_hello_can_be_taken_back.test.sql runs every
 * one of these against a real cluster). What is guarded here is the shape a
 * later edit could quietly change while every behavioural test still passed,
 * because the behaviour it breaks only shows up on a phone running the
 * PREVIOUS bundle or on a recipient's lock screen:
 *
 *   * a DELETE instead of a stamp frees the anti-pester slot;
 *   * a fourth `state` word reaches a bundle that has never heard of it;
 *   * a push that rings for a message that no longer exists.
 *
 * A jest test cannot prove any of them wrong. It can keep the three lines
 * that make them impossible from being deleted by somebody tidying up.
 */
const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '20260902210000_a_hello_can_be_taken_back.sql'
);

const sql = fs.readFileSync(MIGRATION, 'utf8');
/** Comments blanked, so a rule is never satisfied by prose describing it. */
const code = sql.replace(/^\s*--.*$/gm, '');

describe('taking a first message back', () => {
  it('stamps the row and never deletes it', () => {
    // `unique (sender_id, recipient_id)` is one shot per direction, ever.
    // Deleting frees that slot, so "take it back" silently becomes "say hi
    // again, and again", at the person who did not answer. This is the
    // dangerous version of the whole feature and it is one word long.
    expect(code).toContain('set withdrawn_at = now()');
    expect(code).not.toMatch(/delete\s+from\s+public\.message_requests/i);
  });

  it('answers the same for pending, declined and expired', () => {
    // sent_requests() collapses all three into a flat 'sent' so a sender is
    // never told they were declined (invariant 4). A withdraw that worked on
    // one and refused on another would hand that fact straight back, in the
    // shape of an error code.
    expect(code).toContain(
      "and status in ('pending', 'pending_moderation', 'declined', 'expired')"
    );
  });

  it('keeps state to its three words and carries the fact as a column', () => {
    // An over-the-air update is never applied on the launch that downloads
    // it, so for at least one launch every phone runs the previous bundle
    // against this schema. A state it has never heard of drops the sender's
    // own message out of "You said hi" and makes saidHiAlready answer
    // "nothing is out to this traveler", which offers a second send the
    // unique constraint refuses.
    expect(code).toContain('add column if not exists withdrawn_at timestamptz');
    expect(code).not.toMatch(/then\s+'withdrawn'/);
    expect(code).not.toMatch(/alter\s+type\s+public\.request_status/i);
  });

  it('takes the message out of every path that reaches the recipient', () => {
    // Three of them, and the RPC is the least important: the policy is the
    // enforcement layer, and respond_to_message_request is what a client
    // holding a list fetched a second earlier would still call.
    expect(code).toContain('and withdrawn_at is null\n  );'); // the select policy
    expect(code).toContain('and r.withdrawn_at is null'); // incoming_requests()
    expect(code).toContain('where id = p_request_id and recipient_id = auth.uid()');
    expect(code).toMatch(/status = 'pending'\s*\n\s*and withdrawn_at is null/);
  });

  it('does not ring a phone for a message that is gone', () => {
    // A first message held for classification is delivered by an UPDATE
    // minutes later, and that update is what fires the push trigger. Withdraw
    // it in between and, without the guard, the classifier's approval pushes
    // "Someone said hi" for something that no longer exists.
    expect(code).toContain('if new.withdrawn_at is null');
    // And the push it queued on the way out is pulled back, by ID rather than
    // by recipient: two travelers can say hi to the same person in the same
    // minute, and silencing "their unsent request pushes" would silence
    // somebody else's.
    expect(code).toContain("'type', 'request', 'request_id', new.id");
    expect(code).toContain("and data ->> 'request_id' = p_request_id::text");
  });

  it('re-states the grants the drop-and-recreate took with it', () => {
    // Adding an OUT column to a RETURNS TABLE function needs `drop function`
    // first, and the drop removes the grants. Without the grant the Chat tab
    // is permission-denied for every signed-in traveler; without the revoke,
    // anon quietly regains execute through Supabase's default.
    expect(code).toContain('drop function if exists public.sent_requests();');
    expect(code).toContain('revoke execute on function public.sent_requests() from public, anon;');
    expect(code).toContain('grant execute on function public.sent_requests() to authenticated;');
  });
});
