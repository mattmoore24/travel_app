---
name: traps
description: Platform traps this project has already paid for — React Native/Fabric, iOS presentation, Expo SDK 57, Reanimated, and Postgres. Read before building any sheet, modal, keyboard-adjacent form, list, animated entrance, or migration that changes a function signature. Also read when something "looks right in the code but does nothing on the device".
---

# Things that cost this project a day each

Every entry below is a real bug that shipped or nearly shipped here. They
share a shape: the code reads correctly, the compiler is happy, and the
device does something else.

## Touch and layout

- **A `TextInput` inside a `UIVisualEffectView` never receives the tap that
  would focus it.** The glass primitives wrap one. Any field the user must
  type into gets an opaque background instead. This made pin search look
  completely broken for weeks — the field could not be focused, so nothing
  typed ever happened.
- **An absolutely-positioned view resolves against its parent, not the
  screen.** A dropdown or sheet rendered from inside a form anchors to the
  form's box. Present it through `<Modal>` (see `components/ui/sheet.tsx`)
  or it will appear halfway down a scroll view.
- **iOS silently drops a modal presentation that starts while another modal
  is dismissing.** Nothing throws; the second screen just never appears.
  Delay the second presentation (~450ms) or wait for the first to finish.
- **Navigating out from under a presented modal freezes the screen behind
  it.** `router.push` from inside a Sheet pushes the route into the stack
  below, but the Sheet's full-screen scrim survives — so when the user comes
  back, every tap lands on an invisible overlay and the screen looks dead.
  This is what made the map unusable after viewing a pin's profile. Always
  dismiss the sheet FIRST and push after its exit animation (`leaveThen` in
  `features/pins/map-screen.tsx`).
- **A page inside a flex parent needs `flex: 1` of its own** or it collapses
  to content height and its empty state renders off-screen.
- **`entering` and an animated style must not both drive `opacity`.** The
  second one wins non-deterministically and the element flickers or stays
  invisible.
- **A view at `opacity: 0` is skipped by UIKit hit-testing.** A staggered
  entrance means the button is untappable until it lands — which is why the
  E2E flows wait for animations before tapping.
- **`StyleSheet.absoluteFillObject` is not in this RN's typings.** Use
  `StyleSheet.absoluteFill`.

## Keyboard

- Lifting a bottom-anchored sheet by `translateY` works for short sheets and
  fails for tall ones: either the top runs off screen, or (once clamped) it
  cannot move at all and its own submit button stays buried. **Grow
  `paddingBottom` by the keyboard height instead**, and cap `maxHeight` so
  the scroll area shrinks rather than overflowing.
- A primary action inside a `ScrollView` is reachable only by scrolling.
  Keep submit buttons _outside_ the scroll area.
- `keyboardShouldPersistTaps="handled"` swallows the first tap on a control
  while a field is focused. Use `"always"` where the next tap is a field.

## Lists

- **An inverted `FlatList` flips the order of a cell's children.** A day
  separator emitted as a fragment sibling lands on the wrong side of the
  message. Wrap the pair in one `<View>` and order it there.
- Synthetic rows (a first-message preview, a placeholder) must be excluded
  from anything that writes their `id` to the database.

## Postgres / Supabase

- **`create or replace function` cannot add an OUT column to a
  `RETURNS TABLE` signature.** Postgres errors, and the deploy fails _after_
  earlier statements in the migration have already applied. Always
  `drop function if exists` first — and re-state the `grant`s, which the
  drop removes.
- `distinct on (...)` requires those same expressions to lead the
  `ORDER BY`. Deduplicating in a subquery and ordering in the outer query is
  the way to keep both.
- Row-level security is the enforcement layer; client code is only UX. A
  policy that lets a table be read in bulk defeats the feature even if no
  screen does it — check policies for enumerability, not just correctness.
- `PostgrestError` is not an `Error`. `catch (e) { if (e instanceof Error) }`
  silently swallows every database message.

## Expo SDK 57

- Read <https://docs.expo.dev/versions/v57.0.0/>. When docs are unreachable,
  read the installed types in `node_modules` — never recall an API.
- Local native modules live in `modules/` (the autolinking default) and are
  picked up by `expo-module.config.json`. They exist only in a **new build**;
  an OTA update cannot add native code. Consume them through
  `requireOptionalNativeModule`, which returns `null` on an older binary
  instead of throwing, and give the feature a JS fallback.
- **A local module without a `.podspec` is silently dropped.** Autolinking's
  `resolve` step returns `null` for any module directory containing no
  podspec, so the build succeeds, the app ships, and the Swift is simply
  never compiled in. `search` still lists it, which makes it look fine.
  Prove linkage before spending a build:

  ```
  npx expo-modules-autolinking resolve -p apple --json
  ```

  The module must appear under `modules[].packageName`. Being listed by
  `search` is not the same thing.

## CI runners

- **`/Applications/Xcode.app` on a GitHub macOS runner is not the newest
  Xcode installed.** On `macos-15` the symlink points at 16.4, whose iOS 18.5
  SDK cannot compile `expo-glass-effect`'s iOS 26 APIs — the archive dies
  ~3 minutes in, and Expo's error detector mislabels it "Could not resolve
  package dependencies". The image also carries Xcode 26.x; select it by
  version, set both `xcode-select` and `DEVELOPER_DIR`, and assert
  `xcrun --sdk iphoneos --show-sdk-version` before building.
- **No Xcode on the `macos-15` image can compile Expo SDK 57.** Swept
  exhaustively on 2026-08-20, six runs, and the bracket closed empty:

  | Xcode              | Result                                                                      |
  | ------------------ | --------------------------------------------------------------------------- |
  | 16.4               | iOS 18.5 SDK — cannot see `expo-glass-effect`'s iOS 26 APIs                 |
  | 26.0, 26.1, 26.1.1 | 16 errors: `'weak' must be a mutable variable` — `weak let` needs Swift 6.2 |
  | 26.2, 26.3         | 1 error: `JavaScriptCodable+Date.swift:53` type of expression is ambiguous  |

  The two failures are contradictory, and that is the finding:
  `expo-modules-jsi@57.0.4` **requires** Swift 6.2 (it uses `weak let`) and
  **fails to compile** on Swift 6.2 and newer. No version satisfies both, so
  this is Expo's own source-compatibility gap, not a configuration mistake.
  EAS's hosted builders evidently carry an Xcode point release GitHub's image
  does not, and they build this project fine. **Do not re-run this sweep on
  `macos-15`**, and do not reach for the local path at all while the Expo
  subscription is active — it exists only as a fallback. If it ever matters
  again, the one untried avenue is the `macos-26` runner image and its
  different point releases (26.4.1, 26.5, 26.6), but those sit further along
  the axis that already fails.

- **`xcbeautify` swallows the stderr of a failing script phase**, and Expo
  then pattern-matches the raw log and prints its own guess — which named
  the wrong subsystem twice here. The real error is in the kept working
  directory (`EAS_LOCAL_BUILD_SKIP_CLEANUP=1`), in `logs/*.log`. Grep those
  for `error:` before believing any summary line.

## Tests

- **Never loosen an assertion to make a run pass.** A wildcard once let a
  run go green on a screen where two form fields had been concatenated into
  one. Assert the exact text a human would read.
- Screenshots are the evidence, not the exit code. See the `screens` skill.
