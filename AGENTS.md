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
- iOS-first; keep code cross-platform-clean (no iOS-only APIs outside clearly marked spots
  like SF Symbol tab icons).
