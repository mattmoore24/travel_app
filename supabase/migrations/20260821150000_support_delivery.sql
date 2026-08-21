-- Making the contact form actually deliver, and provable.
--
-- Three problems with what shipped:
--
-- 1. Delivery needs a Resend key. Until somebody sets one, a person is told
--    "we read every one and will reply to that address" and the message goes
--    nowhere but a table. That is the app's only published developer contact
--    and App Review exercises it.
-- 2. Nobody can tell whether a message was delivered. support_messages has no
--    select policy at all -- correctly, it holds other people's complaints --
--    so even the person who wrote one cannot see what became of it, and no
--    test can assert the pipeline works.
-- 3. There is exactly one delivery channel, and it is the one that needs a
--    third-party account.
--
-- So: a second channel that needs no key at all. This app already delivers
-- push notifications, so a support message can raise one on the phone of
-- whoever is on support duty. Empty by default, which changes nothing until
-- somebody is named.

-- 1. Who gets told ------------------------------------------------------------
--
-- Named by email OR by user id, because the person setting this knows their
-- own email and does not know their uuid. Turning a one-statement paste into
-- "first go and find your id in another table" is how a setting ends up never
-- being set.

insert into public.app_config (key, value)
values ('support_notify_recipients', '[]'::jsonb)
on conflict (key) do nothing;

comment on table public.app_config is
  'Server-only settings. support_notify_recipients is a JSON array of emails '
  'or user ids that receive a push for every incoming support message; set it '
  'to make the contact form deliver without an email provider.';

/**
 * Resolve the configured recipients to account ids.
 *
 * Never raises. A malformed entry -- a typo, a stale address, an id belonging
 * to a deleted account -- must not be able to refuse a support message. The
 * row is the record; the push is only the notification, and a notification
 * that can veto the record has the priority backwards.
 */
create function public.support_duty_user_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_entry text;
  v_id uuid;
begin
  for v_entry in
    select jsonb_array_elements_text(value)
      from public.app_config
     where key = 'support_notify_recipients'
  loop
    v_id := null;
    if position('@' in v_entry) > 0 then
      select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(v_entry));
    else
      begin
        v_id := btrim(v_entry)::uuid;
      exception
        when others then
          v_id := null;
      end;
    end if;

    if v_id is not null and exists (select 1 from public.users where id = v_id) then
      return next v_id;
    end if;
  end loop;
end
$$;

revoke execute on function public.support_duty_user_ids() from public, anon, authenticated;

create function public.enqueue_support_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The address goes in the title so it can be read off a lock screen without
  -- opening anything, and the body is the message, truncated the same way
  -- every other push in this schema is.
  insert into public.push_queue (user_id, title, body, data)
  select d.id,
         'Support: ' || new.reply_to,
         left(new.body, 140),
         jsonb_build_object('type', 'support', 'support_message_id', new.id)
  from public.support_duty_user_ids() as d(id)
  where d.id is distinct from new.user_id;

  return new;
end
$$;

create trigger support_messages_push
  after insert on public.support_messages
  for each row execute function public.enqueue_support_push();

revoke execute on function public.enqueue_support_push() from public, anon, authenticated;

-- 2. Telling the sender what became of theirs ---------------------------------
--
-- Scoped to a row the caller wrote, and to a message they can name. It returns
-- no body and no address: this exists so the app can say "delivered" and so a
-- test can assert the pipeline runs, not to make the inbox readable.

create function public.support_message_status(p_id uuid)
returns table (created_at timestamptz, delivered_at timestamptz, attempts int)
language sql
stable
security definer
set search_path = public
as $$
  select s.created_at, s.delivered_at, s.delivery_attempts
  from public.support_messages s
  where s.id = p_id
    and s.user_id is not null
    and s.user_id = auth.uid()
$$;

revoke execute on function public.support_message_status(uuid) from public, anon;
grant execute on function public.support_message_status(uuid) to authenticated;

-- 3. Let the sender learn the id of what they just wrote ----------------------
--
-- The insert policy is write-only, so PostgREST cannot return the new row, and
-- without an id there is nothing to ask about. Definer, but it decides the
-- author itself rather than trusting one, and the limit trigger on the table
-- still fires -- so this is not a way around either.

create function public.submit_support_message(p_reply_to text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.support_messages (user_id, reply_to, body)
  values (auth.uid(), p_reply_to, p_body)
  returning id into v_id;
  return v_id;
end
$$;

grant execute on function public.submit_support_message(text, text) to anon, authenticated;
