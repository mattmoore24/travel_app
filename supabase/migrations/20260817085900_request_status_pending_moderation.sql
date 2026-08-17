-- Phase 5 prelude: add the LLM-hold state to request_status.
--
-- Its own migration on purpose: since PostgreSQL 12, ALTER TYPE ... ADD VALUE
-- may run inside a transaction (supabase db push wraps each migration in one)
-- as long as the new value isn't USED in the same transaction — so the value
-- lands here and the trust_safety migration that references it runs in the
-- next transaction. This deploys cleanly on both fresh databases and any
-- project that already applied the Phase 2-4 migrations.
alter type public.request_status add value if not exists 'pending_moderation';
