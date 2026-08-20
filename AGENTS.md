# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any
code. Verify APIs against the installed package types in `node_modules` when docs are
unreachable.

# Project conventions

- **Read `docs/PRODUCT_BRIEF.md` first.** Its §7 hard rules are non-negotiable without
  explicit founder sign-off (free core features; no live location; ≤72h pin expiry;
  DB-enforced social-handle gating; moderated first messages; heatmap k-threshold;
  everything pushed to GitHub).
- `docs/ARCHITECTURE.md` = stack/data-model decisions and open technical flags.
  `docs/PROGRESS.md` = status, next steps, founder questions — update both at every phase
  boundary.
- Conventional commits (`feat:` / `fix:` / `chore:` / `docs:`), small and atomic. Never leave
  work unpushed at session end. Never commit secrets — `.env` is gitignored,
  `.env.example` is the template.
- Before pushing: `npm run typecheck && npx expo lint && npm run format:check && npm test`.
- **Migrations that change a function's OUT columns must `drop function` first** —
  Postgres refuses to add columns to an existing `RETURNS TABLE` signature via
  `create or replace`, and the deploy fails after the migration's earlier
  statements have already applied. Re-state grants after any drop.
- **Ship JavaScript over the air** (Actions → TestFlight → `update`); spend an
  EAS build only when native code or config changes. See docs/APP_STORE.md.
- iOS-first; keep code cross-platform-clean (no iOS-only APIs outside clearly marked spots
  like SF Symbol tab icons).

# Skills in this repo (`.claude/skills/`)

- **`traps`** — platform bugs this project has already paid for (touch, keyboard, modals,
  inverted lists, Postgres function signatures). Read it before building a sheet, a
  keyboard-adjacent form, a list, or a migration.
- **`ship`** — how a change reaches the founder's phone, and how to tell an over-the-air
  update from a change that needs an EAS build.
- **`screens`** — run the simulator suite and review the app as pictures, not as an exit
  code.
