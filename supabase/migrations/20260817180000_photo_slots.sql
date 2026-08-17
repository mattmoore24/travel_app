-- Profiles carry more photos: 1 profile photo + 8 gallery slots (the brief
-- asks for at least 6 beyond the first). Positions and the per-user cap move
-- together; the cap trigger is replaced rather than edited so the change is
-- one atomic migration.

alter table public.profile_photos drop constraint profile_photos_position_check;
alter table public.profile_photos
  add constraint profile_photos_position_check check (position between 0 and 8);

create or replace function public.enforce_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('photo_limit:' || new.user_id::text));
  if (select count(*) from public.profile_photos where user_id = new.user_id) >= 9 then
    raise exception 'photo limit reached (9 per user)'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
