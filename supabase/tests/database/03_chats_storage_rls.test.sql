-- Chats are member-only; storage writes are confined to the owner's folder.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'cara@example.com');

create function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end
$$;

insert into public.chats (id) values ('11111111-1111-1111-1111-111111111111');
insert into public.chat_participants (chat_id, user_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.chats),
  1,
  'member sees the chat'
);
select throws_ok(
  $$ insert into public.chats (id) values ('22222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'clients cannot create chats directly (Phase 2 server path only)'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(
  (select count(*)::int from public.chats),
  0,
  'non-member sees no chat'
);

-- Storage: owner-folder writes only.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('profile-photos',
             '00000000-0000-0000-0000-00000000000a/p0.jpg') $$,
  'owner can upload into own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('profile-photos',
             '00000000-0000-0000-0000-00000000000b/sneaky.jpg') $$,
  '42501',
  null,
  'cannot upload into another user''s folder'
);
select is(
  (select count(*)::int from storage.objects),
  1,
  'authenticated users can read bucket objects (discovery is gated by profile_photos RLS)'
);

select * from finish();
rollback;
