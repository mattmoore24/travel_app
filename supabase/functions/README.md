# Edge Functions

| Function            | Purpose                                                         | Trigger                         |
| ------------------- | --------------------------------------------------------------- | ------------------------------- |
| `push-worker`       | Drains `public.push_queue` → Expo push API; prunes dead tokens  | Schedule (~1/min) after deploy  |
| `moderation-worker` | Claude moderation: held first messages, photos, selfie likeness | Schedule (~1/min) after deploy  |
| `delete-account`    | In-app account deletion (storage + chats + auth user, 5.1.1(v)) | Called by the app (no schedule) |

Deploy (after `supabase link`):

```bash
supabase functions deploy push-worker
supabase functions deploy moderation-worker
supabase functions deploy delete-account
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # moderation-worker only
```

Scheduling is **not** a dashboard step. `20260817230000_schedule_workers.sql` creates
pg_cron jobs that invoke both workers every minute via `public.invoke_edge_worker`, so the
schedule lives in the repo and rebuilds from a fresh clone. It reads the project URL and
service-role key from Supabase Vault, which is populated once:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<service_role_key>',        'service_role_key');
```

Until those secrets exist the invoker returns quietly, so deploy order does not matter.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the functions themselves
automatically.

`moderation-worker` classifies with `claude-opus-5` and applies verdicts through
service-role-only RPCs (`apply_message_verdict` / `apply_photo_verdict` /
`apply_verification_verdict`). It only has work to do once the `app_config` flags are on:

```sql
update public.app_config set value = 'true' where key = 'require_llm_moderation';
update public.app_config set value = 'true' where key = 'require_photo_moderation';
```

Flip the flags only AFTER the vault secrets exist and `cron.job` shows both workers —
with a flag on and no worker running, new messages/photos wait in the held state
(fail-closed by design; nothing is ever delivered unscreened).

These files are Deno (not part of the app's TypeScript project) — excluded
from `tsc`/`jest` via tsconfig.
