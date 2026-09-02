-- A link goes where it says
-- ===========================================================================
--
-- biz-link-safety, the server half (docs/UX_PACKAGES.md). A business listing
-- carries up to ten free-text links that a traveler taps from a row wearing
-- Samewhere's chrome, and the blast radius is entirely outside the app. The
-- client (src/features/business/links.ts) refuses to trust a shortener host
-- or a bare IP address and says so under the row; the database, which is the
-- enforcement layer, still accepted both. validate_business_link
-- (20260901140000:148) applied its IP-literal check inside the `else` branch
-- only - so `https://1.2.3.4/x` filed as an Instagram link was fine - and had
-- nothing to say about bit.ly at all.
--
-- Restated whole from 20260901140000_the_rules_have_one_name.sql:148-198 with
-- two changes and nothing else moved:
--
--   1. THE HOST IS READ ONCE, FOR EVERY KIND, after the per-kind shape checks.
--      The authority is the part between the scheme and the first slash,
--      question mark or hash; the host is the part of that after the LAST `@`
--      (https://casaazul.com@evil.test/ is a valid URL whose host is
--      evil.test, and reading it left to right is the oldest way to make a
--      link look like somewhere it is not); a bracketed IPv6 literal keeps
--      its brackets and everything else loses its port. A phone number, an
--      email address or a bare handle has no scheme, so the host is null and
--      both checks below are a no-op for them - which is what "on every
--      kind" means in code rather than in a comment.
--
--   2. A SHORTENER IS REFUSED, exact host or any subdomain of one. The list
--      is the client's SHORT_LINK_HOSTS in src/features/business/links.ts,
--      byte for byte, and the two have to stay the same list: the client's
--      copy is what the traveler-facing caution reads for rows that predate
--      this migration, and this is what refuses new ones. The client cannot
--      read this list (no RPC exists for it, and the client file is not this
--      package's to change), so a host added here must be added there in the
--      same commit. A denylist is a denylist and will be out of date the week
--      it ships; it raises the cost of the lazy attack without claiming to
--      stop the determined one.
--
-- WHAT THIS IS NOT. The label still goes through screen_first_message and
-- the value still does not. That classifier is a flirt-and-harassment screen
-- and running a URL through it would not be a reputation check; nothing here
-- says a link is SAFE, only that this one is not hiding where it goes.
--
-- Both refusals carry a hint code so the client's failure-message map answers
-- by code rather than by prose (src/lib/failure-message.ts, D3): 'bare_address'
-- on the message the previous definition already raised, 'short_link' on the
-- new one. The raise text stays a lowercase fragment on purpose - a fragment
-- is never shown, a hint always is.
--
-- A trigger function with no OUT columns, so create or replace is correct.
-- The revoke survives a replace and is restated anyway so the file reads on
-- its own. 71_a_link_goes_where_it_says.test.sql is the attack.

create or replace function public.validate_business_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_authority text;
  v_host text;
  -- src/features/business/links.ts SHORT_LINK_HOSTS, in the same order.
  v_short constant text[] := array[
    'bit.ly',
    'tinyurl.com',
    't.co',
    'is.gd',
    'goo.gl',
    'rb.gy',
    'cutt.ly',
    'shorturl.at',
    'ow.ly'
  ];
begin
  select count(*) into v_count from public.business_links
   where business_id = new.business_id and id <> coalesce(new.id, gen_random_uuid());
  if v_count >= 10 then
    raise exception 'ten links is plenty' using errcode = 'check_violation';
  end if;

  if new.kind in ('phone', 'whatsapp') then
    if new.value !~ '^\+?[0-9 ()-]{5,30}$' then
      raise exception 'that does not look like a phone number'
        using errcode = 'check_violation';
    end if;
  elsif new.kind = 'email' then
    if new.value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'that does not look like an email address'
        using errcode = 'check_violation';
    end if;
  elsif new.kind in ('instagram', 'tiktok', 'facebook', 'x') then
    -- A handle or a full URL, both fine; anything with a scheme must be https.
    if new.value ~ ':' and new.value !~* '^https://' then
      raise exception 'links have to start with https://'
        using errcode = 'check_violation';
    end if;
  else
    if new.value !~* '^https://' then
      raise exception 'links have to start with https://'
        using errcode = 'check_violation';
    end if;
  end if;

  -- THE HOST THE TAP WILL LAND ON, for every kind. Null when the value is not
  -- a web address at all (a number, an email, a bare handle), and then
  -- neither check below has anything to say.
  v_authority := substring(new.value from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)');
  if v_authority is not null then
    v_host := lower(regexp_replace(v_authority, '^.*@', ''));
    if left(v_host, 1) = '[' then
      v_host := substring(v_host from '^(\[[^\]]*\])');
    else
      v_host := split_part(v_host, ':', 1);
    end if;

    -- An IP literal is never a real business's website and is how a link
    -- gets somewhere the label does not admit to. Every kind, not the else
    -- branch: an Instagram link at 1.2.3.4 is not on Instagram.
    if v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' or left(v_host, 1) = '[' then
      raise exception 'that link needs a real domain'
        using errcode = 'check_violation', hint = 'bare_address';
    end if;

    -- A shortener defeats every check anybody could make on the link,
    -- including this one: whatever is reviewed is bit.ly/x3f9, and what
    -- opens is decided later by somebody else's redirect.
    if exists (
      select 1 from unnest(v_short) s
      where v_host = s or v_host like ('%.' || s)
    ) then
      raise exception 'use the real address, not a short link'
        using errcode = 'check_violation', hint = 'short_link';
    end if;
  end if;

  if (public.screen_first_message(new.label) ->> 'action') = 'block' then
    raise exception 'that text breaks our house rules'
      using errcode = 'check_violation', hint = 'guidelines';
  end if;

  return new;
end
$$;

revoke execute on function public.validate_business_link() from public, anon, authenticated;

comment on function public.validate_business_link() is
  'Shape-checks a business link by kind, then reads the host the tap will '
  'land on and refuses a bare IP address or a link shortener on every kind. '
  'The shortener list is the client''s SHORT_LINK_HOSTS '
  '(src/features/business/links.ts) and the two must stay identical. The '
  'label is screened like any broadcast text; the value is not a reputation '
  'check and nothing here says a link is safe.';
