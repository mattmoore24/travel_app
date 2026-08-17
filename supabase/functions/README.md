# Edge Functions

| Function      | Purpose                                                        | Trigger                        |
| ------------- | -------------------------------------------------------------- | ------------------------------ |
| `push-worker` | Drains `public.push_queue` → Expo push API; prunes dead tokens | Schedule (~1/min) after deploy |

Deploy (after `supabase link`):

```bash
supabase functions deploy push-worker
```

Then add a schedule in the Supabase dashboard (Edge Functions → your function →
Schedules). No extra secrets needed — `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.

Phase 5 will add the first-message moderation function (Claude classification)
behind the existing `screen_first_message` seam, using an `ANTHROPIC_API_KEY`
secret (`supabase secrets set ANTHROPIC_API_KEY=...`).

These files are Deno (not part of the app's TypeScript project) — excluded
from `tsc`/`jest` via tsconfig.
