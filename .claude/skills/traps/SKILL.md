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
  is dismissing — and on Fabric that does not lose a sheet, it kills touch
  for the whole app.** This entry used to say "the second screen just never
  appears". That is the smaller half. `<Modal>` renders a `ModalHostView`
  whose descriptor lays it out full screen and absolutely positioned
  (`ModalHostViewComponentDescriptor.h`), while its children are mounted into
  the modal's own view controller, never into it
  (`RCTModalHostViewComponentView.mm`). So the host view is empty, paints
  nothing, overrides no `hitTest`, and `RCTViewComponentView`'s hit test
  returns _itself_ for every point on screen. A dropped presentation leaves
  that invisible full-screen view sitting in the tree. Worse, RN sets
  `_isPresented = YES` before calling `presentViewController:` and only
  retries from `didMoveToWindow`/`updateProps`, so it never recovers: the app
  is dead to touch until relaunch.
  It reached a simulator run as three byte-identical screenshots and four
  taps the driver reported as successful. Whether the same race is lost on a
  real phone is NOT established, and do not let anyone tell you it is: the
  device path serialises an extra `getNotificationSettingsWithCompletionHandler:`
  hop that the simulator short-circuits, and that hop is in the one variable
  the race turns on. All the evidence is from a simulator. Fix it anyway —
  the cost of losing is a dead app and the cost of the guard is a timer. Delay the second presentation by
  `SHEET_SETTLE_MS` (`components/ui/sheet.tsx`) or wait for the first to
  finish — and note that "unmounted in React" is not "gone from the screen",
  so a mount counter alone is not enough.
  Anything presenting a modal on a DATA event rather than a tap is the
  dangerous case, because it cannot know what is on screen: the push primer
  is the only one, and it waits on three facts (the tabs focused, no native
  modal registered, and the settle delay). If you add another, register it
  with `useRegisterNativeModal` — a count that only knows about `Sheet` is a
  count that lies. There is a cheaper escape for anything rendered as a
  direct child of a full-screen root: `<Sheet inline>` has no `<Modal>` at
  all, so there is no presentation to drop. It was not taken for the primer
  only because its layering against the native tab bar could not be verified
  without a device.
- **Navigating out from under a presented modal freezes the screen behind
  it.** `router.push` from inside a Sheet pushes the route into the stack
  below, but the Sheet's full-screen scrim survives — so when the user comes
  back, every tap lands on an invisible overlay and the screen looks dead.
  This is what made the map unusable after viewing a pin's profile. Always
  dismiss the sheet FIRST and push after its exit animation: wrap the jump in
  `leavingSheet(close)` from `components/ui/sheet`, which owns both the rule
  and the timing. It bit twice — the signed-in path and, a day later, the
  guest sign-up gate rendered in the same sheet — so treat ANY navigation
  inside a `<Sheet>` as this bug until it is wrapped. `Linking.openURL` is
  fine: it leaves the app rather than pushing underneath.
- **The GitHub REST API is not reachable from this sandbox.** `curl` to
  `api.github.com` returns 403 "GitHub access is not enabled for this
  session" — only the `mcp__github__*` tools work. So a Bash monitor that
  polls run status silently emits nothing and looks like "still running"
  rather than "cannot reach". Poll with `actions_list` / `list_workflow_jobs`
  instead, and note those return large payloads that overflow to a file: read
  them with a python one-liner rather than dumping them into context.
- **`KeyboardAvoidingView`'s frame is measured against its PARENT, not the
  window.** So the usual `keyboardVerticalOffset={someHeaderHeight}` recipe is
  only right when the view is the screen root. Both chat screens passed a
  hardcoded 90 while sitting below a native header inside a SafeAreaView, and
  landed the composer about ten points under the keyboard — near enough to
  look almost right, far enough that you could not see what you were typing,
  and enough that XCUITest could not type into it at all. Use
  `components/ui/keyboard-floor`, which asks `useAnimatedKeyboard()` for the
  real height instead of guessing, the same way `components/ui/sheet` does.
- **A page inside a flex parent needs `flex: 1` of its own** or it collapses
  to content height and its empty state renders off-screen.
- **`height: '100%'` is a percentage of the AVAILABLE height, not of the
  parent's content.** Yoga resolves a child's percentage against the size
  handed down from above — inside a ScrollView that is about a screen — even
  when the parent's own height is `auto`. So a frame whose only flow child is
  sized that way never collapses to its text: dropping the parent's fixed
  height hands that child a screen-tall box and pushes everything after it
  below the fold. `justifyContent: 'flex-end'` cannot shrink a parent either;
  it only places flow children inside a height already decided. This is
  exactly what removing the profile hero's height did (edcd8d7): run 33
  photographed a full-screen slab of `surfaceSunken` with no name on it, and
  it was reverted (612bb5c). For a container that must be as tall as its
  content, give every child an intrinsic size — or branch to a different
  element, which is what the no-photo profile band does.
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
- `keyboardShouldPersistTaps="handled"` swallows the first tap on a text
  FIELD while another field is focused, because a `TextInput` does not claim
  the responder. Use `"always"` where the next tap is a field. It does not
  swallow taps on a `Pressable`, which claims in the bubble phase and so wins
  over the list.
- **A scroller with no `keyboardShouldPersistTaps` eats the first touch
  whenever a field anywhere on screen has focus** — including a long press,
  and including a composer that lives outside the list. The default is
  `'never'`, and React Native implements that by claiming the responder in the
  CAPTURE phase (`ScrollView._handleStartShouldSetResponderCapture`), before
  any child is asked; `Pressability` arms its long-press timer only inside
  `onResponderGrant`, so the timer is never scheduled, and on release the
  scroller blurs the field. Symptom: press and hold does nothing except close
  the keyboard, and it works on the second try. This is what stopped the chat
  reaction menu from ever opening, through two wrong fixes, because component
  tests call the handler directly and never enter the responder system.

## Lists

- **An inverted `FlatList` flips the order of a cell's children.** A day
  separator emitted as a fragment sibling lands on the wrong side of the
  message. Wrap the pair in one `<View>` and order it there.
- Synthetic rows (a first-message preview, a placeholder) must be excluded
  from anything that writes their `id` to the database.
- **An inverted list standing on a keyboard-sized floor moves its rows by the
  whole keyboard height when that keyboard goes.** The list is anchored to its
  own bottom, so collapsing `KeyboardFloor`'s padding slides every row DOWN,
  not up. Anything holding a measured window rect across a keyboard
  dismissal — an anchored menu, a popover, a tooltip — is then off by roughly
  a third of a screen. Dismiss first, wait for `keyboardDidHide`, give it two
  more frames so the floor's own Reanimated style has committed, and measure
  after. Keep a timeout as well: an interaction must never depend on an event
  that might not arrive.

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

## Over-the-air updates

- **An update is never applied on the launch that downloads it.**
  `launchWaitMs` defaults to **0**, so expo-updates starts the app on the
  bundle it already has and fetches the new one in the background. The
  download becomes the running code on the _next_ launch. Anything that
  verifies "the current code" after a single launch is verifying the previous
  build.
- **The download lives in the app's data container**
  (`Library/Application Support/.expo-internal`), so any state clear deletes
  it. Maestro's `clearState: true` on every flow meant the E2E suite screen
  shotted the binary's **embedded** JS for weeks while reporting green. The
  fix in `e2e.yml`: publish, launch once to fetch, poll `expo-v2.db` for the
  published update id at `status = 1`, then reset only the app's own storage
  between flows. Never re-introduce a state clear into a flow.
- **The iOS Simulator on GitHub's macOS runners cannot reach `u.expo.dev`.**
  expo-updates' own log says
  `checkError: "Unknown error: A TLS error caused the secure connection to
failed"` on every check, while the same simulator talks to Supabase over
  HTTPS without trouble, and expo-updates uses a plain
  `URLSessionConfiguration.default`. So it is the environment, not the
  config. The consequence is that **the E2E suite cannot be run against a
  reused binary**: `build: true` is the default and the only honest setting
  there, because it embeds the code under test rather than relying on a
  fetch that always fails.
- **The updates database is `expo-v11.db` today, and was `expo-v2.db` not
  long ago.** `UpdatesDatabaseInitialization.swift` bumps the filename with
  every schema migration. Anything inspecting it must glob `expo-v*.db`;
  hardcoding the version failed the E2E gate twice on downloads that had
  actually succeeded. Next to it sits
  `dev.expo.modules.core.logging.expo-updates.txt`, which says more about a
  failed check than os_log does.
- `UpdatesConfigOverride` can only override the update URL and request
  headers at runtime. `launchWaitMs` and `checkOnLaunch` are baked into
  `Expo.plist` at build time, so there is no way to make an existing binary
  block on the download.

## Tests

- **Never loosen an assertion to make a run pass.** A wildcard once let a
  run go green on a screen where two form fields had been concatenated into
  one. Assert the exact text a human would read.
- Screenshots are the evidence, not the exit code. See the `screens` skill.
