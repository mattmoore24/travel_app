-- A VERDICT THE FOUNDER CAN READ
--
-- 20260903010000 made `reason_en` required on both moderation verdict schemas
-- so that a rejection written in the subject's own language stays adjudicable
-- by somebody who cannot read it. The storefront half got its reader in the
-- same pass: an 'uncertain' verdict mails the founder and the mail quotes
-- reason_en. The selfie half did not. apply_verification_verdict writes the
-- verdict into verification_requests.verdict and moderation_events.metadata
-- and stops there, and neither table has an admin surface. A person whose
-- selfie was refused appeals through Contact us, the founder opens the
-- support inbox, and the one sentence written for exactly that moment is on
-- no screen anywhere.
--
-- Two service-role views, modelled exactly on admin_report_queue
-- (20260817090000:873-891): a surface for the SQL editor, no RPC, and the
-- `revoke` on the line after the `create`. `reason` and `reason_en` side by
-- side is the whole point: one is what the person was shown, the other is
-- what it says.
--
-- THE REVOKE IS THE WHOLE SECURITY OF THIS FILE. A view over
-- verification_requests is a list of everybody whose selfie was refused,
-- which is about as sensitive as this database gets, and Supabase's default
-- privileges hand every new relation in `public` to anon and authenticated
-- (the local shim mirrors that, which is what lets
-- 66_a_verdict_the_founder_can_read prove the revoke rather than assume it).
-- A view created without the revoke passes a happy-path test perfectly.
--
-- No column moves, no function signature moves, nothing on the client.
-- Re-running a verification is a separate decision with its own consequences
-- for profiles.verified, and this package is only about being able to READ
-- the verdict - there is deliberately no admin_resolve_verification here.

create view public.admin_verification_queue as
select
  v.id,
  v.user_id,
  v.created_at,
  v.reviewed_at,
  v.status,
  v.reason,
  v.verdict ->> 'reason_en' as reason_en,
  v.verdict ->> 'engine' as engine,
  v.attempts
from public.verification_requests v
where v.status <> 'pending'
order by v.created_at desc;

revoke all on public.admin_verification_queue from anon, authenticated;

comment on view public.admin_verification_queue is
  'Service-role only: every settled selfie verification, newest first, with '
  'the sentence the person was shown (reason) beside its English (reason_en). '
  'The English exists so an appeal about somebody''s face is adjudicable by a '
  'founder who cannot read the language it was written in.';

-- The business half, for symmetry and because the 'uncertain' mail is a
-- one-shot a founder can lose. Joined to businesses for the name, since a
-- business id means nothing in an inbox.
create view public.admin_business_verification_queue as
select
  bv.id,
  bv.business_id,
  b.name as business_name,
  bv.created_at,
  bv.reviewed_at,
  bv.status,
  bv.reason,
  bv.verdict ->> 'reason_en' as reason_en,
  bv.verdict ->> 'engine' as engine,
  bv.attempts
from public.business_verifications bv
join public.businesses b on b.id = bv.business_id
where bv.status <> 'pending'
order by bv.created_at desc;

revoke all on public.admin_business_verification_queue from anon, authenticated;

comment on view public.admin_business_verification_queue is
  'Service-role only: every settled storefront verification, newest first, '
  'named, with the owner''s sentence (reason) beside its English (reason_en). '
  'The uncertain mail quotes the same English; this is the copy that does not '
  'get lost.';
