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

Then add a schedule for each in the Supabase dashboard (Edge Functions → the function →
Schedules). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions
automatically.

`moderation-worker` classifies with `claude-opus-5` and applies verdicts through
service-role-only RPCs (`apply_message_verdict` / `apply_photo_verdict` /
`apply_verification_verdict`). It only has work to do once the `app_config` flags are on:

```sql
update public.app_config set value = 'true' where key = 'require_llm_moderation';
update public.app_config set value = 'true' where key = 'require_photo_moderation';
```

Flip the flags only AFTER the function is deployed, scheduled, and the secret is set —
with a flag on and no worker running, new messages/photos wait in the held state
(fail-closed by design; nothing is ever delivered unscreened).

These files are Deno (not part of the app's TypeScript project) — excluded
from `tsc`/`jest` via tsconfig.
