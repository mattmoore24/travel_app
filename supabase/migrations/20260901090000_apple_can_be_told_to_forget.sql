-- Keep the one thing Apple needs to be told to forget an account.
--
-- App Review rejects an app that offers both Sign in with Apple and in-app
-- account deletion and never calls https://appleid.apple.com/auth/revoke.
-- Revoking needs a refresh token, and a refresh token can only be bought
-- once: Apple hands the app an authorization code at sign-in, that code is
-- exchanged server-side for the refresh token, and it is gone after that.
-- So the token has to be captured at sign-in and kept until the account is
-- deleted, which is the only reason this table exists.
--
-- There is a user-visible half too. Apple returns a name and an email only on
-- the FIRST authorization for an app, so an account deleted without a revoke
-- comes back on the next sign-up with neither, and the person has no address
-- to recover with.
--
-- SERVICE ROLE ONLY. RLS is on and there are deliberately no policies, and
-- every grant is revoked on top of that: a refresh token is a credential
-- against somebody else's identity provider, so no API role may read, write
-- or count these rows. supabase/tests/database/35_apple_tokens_are_server_only
-- is the attack that keeps it that way.
create table public.apple_refresh_tokens (
  user_id uuid primary key references public.users (id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

alter table public.apple_refresh_tokens enable row level security;

revoke all on public.apple_refresh_tokens from public, anon, authenticated;

comment on table public.apple_refresh_tokens is
  'Sign in with Apple refresh tokens, kept only so delete-account can call '
  'Apple''s revoke endpoint before the auth row goes. Service role only: RLS '
  'is enabled with no policies and every grant is revoked. Never expose this '
  'table to anon or authenticated.';

comment on column public.apple_refresh_tokens.refresh_token is
  'Credential against Apple, not against us. Written by store-apple-token, '
  'read once by delete-account, and never sent anywhere else.';
