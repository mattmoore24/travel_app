-- The owner never saw their own address.
--
-- businesses.address arrived on 2026-08-29 (a business says where it is): the
-- owner's page prints it under "Where you are", the editor prefills its box
-- from it, and the client's row type has carried it since that day. Nothing
-- ever put it in my_business(), whose OUT list was written two days earlier,
-- so every owner read "No address yet" under a row they had filled in, and the
-- editor opened on an empty box. Worse than cosmetic: saving the location
-- screen with the box left as it came sent '' for p_address, which
-- update_business_location takes as "the owner typed nothing" and stores as
-- null. E2E run 124's My business frame is where it was noticed.
--
-- RETURNS TABLE grows a column, so drop first (create or replace refuses to
-- change an OUT list) and restate the grants. Nothing else moves: the same
-- rows, the same owner scope, the same definer, the same column order with
-- address at the end.

drop function public.my_business();

create function public.my_business()
returns table (
  id uuid,
  city_id int,
  name text,
  category public.business_category,
  description text,
  place_label text,
  hours_note text,
  website_url text,
  lat double precision,
  lng double precision,
  chat_id uuid,
  public_preview boolean,
  active boolean,
  state public.business_state,
  verified boolean,
  address text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.city_id, b.name, b.category, b.description, b.place_label,
    b.hours_note, b.website_url, b.lat, b.lng, b.chat_id, b.public_preview,
    b.active, b.state, b.verified, b.address
  from public.businesses b
  where b.owner_user_id = auth.uid()
$$;

revoke execute on function public.my_business() from public, anon;
grant execute on function public.my_business() to authenticated;

comment on function public.my_business() is
  'The caller''s own listing, every column the owner''s page and editor '
  'print, including the address as typed or picked. Owner-scoped: a traveler '
  'gets no rows.';
