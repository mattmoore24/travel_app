-- A notice that closes a door says where the handle is.
--
-- Live, the three moderation notices read "Your account has been permanently
-- banned for repeated guideline violations.", "Your account is suspended for
-- 7 days for repeated guideline violations." and "Community guidelines
-- warning". Not one of them names a way back, and the moderation pipeline is
-- an LLM verdict, so false positives exist by construction. This is the exact
-- moment a wrongly caught traveler writes an App Store review instead of an
-- appeal.
--
-- Four things change and nothing else does. The bodies are copied verbatim
-- from 20260821120000_moderation_copy.sql; the thresholds, the ladder, the
-- shadowban rules and the audit writes are untouched.
--
--   1. One name for the rulebook (D32): "house rules", including in the two
--      warning titles.
--   2. One name for the state, matching the gate screen a tap later: paused,
--      and closed. The gate's headline pair is `gateCopy` in
--      src/app/_layout.tsx, and the two have to say the same words or the
--      push and the screen read as two separate events.
--   3. A route back, in the notification itself: "open the app and tap Appeal
--      this". That button now exists - the gate renders the contact form as a
--      view mode, because it is returned INSTEAD OF the navigator and a
--      router.push from it goes nowhere.
--   4. The automation disclosure DSA Art. 17(3)(c) asks for, on the two
--      notices the classifier's ladder produces. The admin warning does NOT
--      carry it and says the opposite, because a person really did read that
--      report, and a machine-decided claim on a human decision is its own
--      kind of wrong.
--
-- create-or-replace is correct for both: returns trigger and returns void, no
-- OUT columns, no signature change. The revokes are restated at the end
-- anyway, which is what this repo does after every replace.

-- public.apply_strike_policy
create or replace function public.apply_strike_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_status public.user_status;
begin
  if new.subject_user_id is null or not public.is_strike_action(new.action) then
    return new;
  end if;

  -- Serialize per-user so concurrent strikes can't both read a stale count.
  perform pg_advisory_xact_lock(hashtext('strikes:' || new.subject_user_id::text));

  select count(*) into v_count
  from public.moderation_events
  where subject_user_id = new.subject_user_id
    and public.is_strike_action(action);

  select status into v_status from public.users where id = new.subject_user_id;
  if v_status is null or v_status = 'banned' then
    return new;
  end if;

  if v_count >= 7 then
    update public.users
      set status = 'banned', suspended_until = null
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'banned', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account closed',
            'Your account is closed for repeated house rules breaches. Our checks are automatic, so if that is wrong, open the app and tap Appeal this.',
            jsonb_build_object('type', 'moderation'));
  -- Suspension applies only to plain-active accounts: suspending a
  -- shadowbanned user would both reveal the shadowban (gate screen) and
  -- launder it into 'active' when lift_expired_suspensions runs. Shadowbanned
  -- accounts still hit the ban rung at 7.
  elsif v_count >= 5 and v_status = 'active' then
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = new.subject_user_id;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'suspended', 'strike_policy',
       jsonb_build_object('strike_count', v_count, 'days', 7));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'Account paused',
            'Your account is paused for 7 days for repeated house rules breaches. Our checks are automatic, so if that is wrong, open the app and tap Appeal this.',
            jsonb_build_object('type', 'moderation'));
  elsif v_count >= 3 and not exists (
    select 1 from public.moderation_events
    where subject_user_id = new.subject_user_id and action = 'warning_issued'
  ) then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (new.subject_user_id, 'user', new.subject_user_id, 'warning_issued', 'strike_policy',
       jsonb_build_object('strike_count', v_count));
    insert into public.push_queue (user_id, title, body, data)
    values (new.subject_user_id, 'House rules warning',
            'Recent messages or photos broke our house rules, on an automatic check. More of it will pause your account.',
            jsonb_build_object('type', 'moderation'));
  end if;
  return new;
end
$$;

-- public.admin_resolve_report
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_rows int;
begin
  perform public.assert_service_caller();
  if p_action not in ('dismiss', 'warn', 'strike', 'suspend', 'ban', 'shadowban') then
    raise exception 'unknown action %', p_action;
  end if;

  select * into v_report
  from public.reports
  where id = p_report_id and status = 'open'
  for update;
  if not found then
    raise exception 'report not open';
  end if;

  if p_action = 'warn' then
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'warning_issued', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
    insert into public.push_queue (user_id, title, body, data)
    values (v_report.reported_user_id, 'House rules warning',
            'A person read a report about your account and agreed with it. More of it will pause your account.',
            jsonb_build_object('type', 'moderation'));
  elsif p_action = 'strike' then
    -- The strike policy trigger handles any resulting warn/suspend/ban.
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_strike', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'suspend' then
    -- Applies to active accounts (or extends an existing suspension). Never
    -- overwrites a shadowban — lift_expired_suspensions would launder it into
    -- 'active' — and never downgrades a ban. Audit events are only written
    -- for state changes that actually happened.
    update public.users
      set status = 'suspended', suspended_until = now() + interval '7 days'
      where id = v_report.reported_user_id and status in ('active', 'suspended');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'suspend does not apply to this account''s status';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_suspended', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'ban' then
    update public.users
      set status = 'banned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'account is already banned';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_banned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  elsif p_action = 'shadowban' then
    update public.users
      set status = 'shadowbanned', suspended_until = null
      where id = v_report.reported_user_id and status <> 'banned';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'cannot shadowban a banned account';
    end if;
    insert into public.moderation_events
      (subject_user_id, entity_type, entity_id, action, source, metadata)
    values
      (v_report.reported_user_id, 'user', v_report.reported_user_id,
       'admin_shadowbanned', 'admin', jsonb_build_object('report_id', p_report_id, 'note', p_note));
  end if;

  update public.reports
    set status = 'resolved:' || p_action
    where id = p_report_id;
end
$$;

-- Grants restated after the replace, per this repo's rule.
revoke execute on function public.apply_strike_policy() from public, anon, authenticated;
revoke execute on function public.admin_resolve_report(uuid, text, text) from public, anon, authenticated;
