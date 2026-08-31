-- Last em dash the database can show a user: the message throttle's raise
-- message. Raised messages reach the user verbatim through the Alert in
-- src/lib/query-client.ts, so this is user copy. Body otherwise
-- byte-identical to 20260817150000_launch_hardening.sql:27-41 (the only
-- definition). Trigger function, no OUT columns, so `create or replace` is
-- correct and no grants move.
--
-- The other copy this pass audited is already clean by now:
--   * enqueue_accept_push  - fixed in 20260830020000 ('Connected with {name}.
--     Your chat is open.', matching the in-app card).
--   * apply_message_verdict and seed_launch_pins - fixed in 20260830030000.
--   * enqueue_request_push - 20260820001000_copy_pass.sql already replaced
--     'New message request' with 'Someone said hi'; nothing left to change.
-- The copy-lint jest test (src/app/__tests__/copy-lint.test.ts) is the gate
-- that keeps the next copy pass from missing a function the way
-- 20260821120000 missed apply_message_verdict.

create or replace function public.throttle_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id
        and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'sending too fast, give it a moment' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
