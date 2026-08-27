-- Business accounts: the enum values, and nothing else
-- ===========================================================================
--
-- Its own migration on purpose. `alter type ... add value` cannot be followed
-- by a use of that value inside the same transaction, and the Supabase CLI
-- wraps each migration in one. Every statement here is an addition to an
-- existing enum; brand-new types are created in the next file, where they are
-- also used, because creating a type has no such restriction.
--
-- Nothing in this file changes behaviour. The values are consumed by later
-- phases: 'business' chat_kind and request_source by inbound messages,
-- 'admins' speaking mode by the business chat controls, 'impersonation' by
-- the report path, which for a business is the whole verification backstop.

-- A chat with the people who run a place. Deliberately NOT 'direct': the
-- accepted-chat gate that unlocks personal social handles requires
-- kind = 'direct', so a business conversation can never unlock anybody's
-- Instagram in either direction. That is the §7 rule 4 amendment, and this
-- one enum value is what enforces it.
alter type public.chat_kind add value if not exists 'business';

-- Where a first message came from, alongside 'trip_match' and 'pin'.
alter type public.request_source add value if not exists 'business';

-- The third speaking mode: the owner, their staff and the admins they
-- appoint. 'everyone' and 'granted' already cover the other two.
alter type public.group_speaking add value if not exists 'admins';

-- "This isn't the real business." The headline risk for a listing, and the
-- reason it sorts first in the queue.
alter type public.report_reason add value if not exists 'impersonation';
