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

## The Slide presets animate LAYOUT, and freeze the frame while they run

- **`entering={SlideInDown}` and the rest of the Slide family animate
  `originY`, not a transform** — read `Slide.js` in the package: the builder
  returns `animations: { originY: ... }`. So the animation owns the view's
  real frame for its whole duration.
- **The Fade and Zoom presets do not, and that distinction is half this
  entry.** `Fade.js` and `Zoom.js` animate `opacity` and `transform`, so
  their per-frame style carries no layout key. `updateLayoutMetrics` in
  `LayoutAnimationsUtils.h` uses optionals precisely "to avoid overwriting
  non-animated values", so the frame they push is the one already on screen,
  and React Native's mounting layer skips an `updateLayoutMetrics` whose old
  and new are equal. `FadeInDown`, `FadeInUp` and `ZoomIn` are safe on a
  container that grows. Do not go hunting them.
- **While it runs, Reanimated re-applies the frame it SNAPSHOTTED at the
  start, once per frame, width and height included.** In
  `LayoutAnimationsProxy_Legacy.cpp`, a real layout `Update` for that tag is
  passed through to the mount (`filteredMutations.push_back`) and then
  `addOngoingAnimations` immediately overwrites it from the animation's own
  `updateMap`. The last write wins, and it is the stale one. When the spring
  settles nothing restores the true layout, because from React Native's point
  of view the layout was already committed and has not changed since.
- **So an animated container whose content arrives after the tap freezes at
  the size it had at the moment of the tap.** The place card opened about a
  third of the way and came up whole only on a second tap — the second tap
  was served from the query cache, so the snapshot was of the finished card.
  It went unnoticed for a while because iOS views do not clip by default: a
  plain `<View>` child simply spilled out of the frozen frame and stayed
  visible (which is its own bug — "the card runs off the bottom"). Putting a
  `ScrollView` inside, which DOES clip, is what turned a spill into a
  visibly half-open sheet.
- **The fix is to slide on a `translateY` in `useAnimatedStyle` instead**, so
  React Native keeps the layout and the view resizes the instant its content
  does. `components/ui/sheet.tsx` does this, and
  `components/ui/__tests__/sheet.test.ts` keeps the preset from coming back.
  A Slide preset is still fine on something that cannot change size — an
  `absoluteFill` scrim takes its frame from its parent, and a marker with
  fixed dimensions has nothing to grow.
- Swept 2026-08-28: the sheet was the app's only Slide entrance. Every other
  entrance in `src/` is a Fade, a Zoom, a `Keyframe` of opacity, or carries
  `layout={LinearTransition}`. All clear.
- `layout={LinearTransition}` also defuses it (the proxy re-targets an
  ongoing animation only when a LAYOUT animation is configured), but it
  animates every subsequent size change too, including the keyboard growing a
  sheet's padding. Prefer the transform.

## Keyboard

- **Under Fabric, an `InputAccessoryView` binds to ONE field, ONCE, when the
  BAR enters the window — and the field never looks for it.** This is why the
  "Hide keyboard" bar was built three times (2026-08-24, 08-28, 08-30) and was
  never on the founder's phone. Read the native file, not the docs:
  `RCTInputAccessoryComponentView.mm`'s `didMoveToWindow` is guarded by
  `if (self.window && !_textInput)`; it runs `RCTFindTextInputWithNativeId`
  over the whole window, takes the FIRST field whose `inputAccessoryViewID`
  matches, caches it, and never looks again. On the field side,
  `RCTTextInputComponentView.setDefaultInputAccessoryView` returns early the
  moment an `inputAccessoryViewID` is set — so a field that missed the
  one-shot bind gets nothing, not even iOS's default toolbar. The documented
  pattern (one bar per screen, one shared id, every field pointing at it) was
  right under Paper, where the FIELD looked the bar up on its own mount, and
  is quietly wrong under Fabric: the bar binds to whichever field exists when
  the shell first mounts and every field mounted later (the next signup step,
  a search box revealed by a tap) has none. Symptom: the bar works on the
  first screen you try and on no other, and the shared-id source scan is
  green throughout. The shape that works is one bar per field, mounted with
  it, rendered BEFORE it in sibling order — `components/form/keyboard-done-bar`'s
  `KeyboardDone` render prop, which `FormTextField` uses and every raw
  `TextInput` wraps itself in. Before, not after, because Fabric assembles a
  new subtree bottom-up (`Differentiator.cpp`: `createMutations`, then the
  children's `downwardMutations`, then this level's `insertMutations`) and
  attaches it whole, so `didMoveToWindow` cascades parent-first over a subtree
  that is already complete: an earlier-sibling bar finds its field and binds
  before the field's own `didMoveToWindow` fires `autoFocus`; a later-sibling
  bar binds to a keyboard already showing, and nothing calls
  `reloadInputViews`.
- **A source scan that checks a FILE contains a prop is not a check that the
  prop is on the element.** The old bar test passed a `language-field.tsx`
  whose `{...keyboardDoneProps}` sat on a `SymbolView` icon, and a
  `pin-form-sheet.tsx` whose one raw `TextInput` had no props at all because
  a `FormTextField` elsewhere in the file carried them. The replacement walks
  the rendered tree for the pair and, for the scan, requires each `<TextInput`
  to sit between a `<KeyboardDone>` and its `</KeyboardDone>`.
- **Reanimated's `useAnimatedKeyboard().height` is the keyboard's frame and
  NOT the input accessory view above it.** With a Hide keyboard bar on every
  field, a floor sized to that height lifts a footer 36pt short and the bar
  lies across the bottom third of the Continue pill (run 109, screen 60;
  the tap still lands, the picture is wrong). `components/ui/keyboard-floor`
  adds `KEYBOARD_BAR_HEIGHT` while the keyboard is up; a floor of its own
  anywhere else has to do the same. And a control the floor puts UNDER the
  keyboard on purpose (step-shell's footer) is still in the hierarchy, so a
  Maestro `tapOn` finds it, reports COMPLETED, and taps the keys: hide the
  keyboard first in the flow.
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

## A `Sheet` drops its `footer` unless you also pass `scrolls`

`sheet.tsx` renders `{footer}` inside the `scrolls ? (...) : children` ternary,
in the scrolling arm only. So `<Sheet footer={<PrimaryButton .../>}>` without
`scrolls` is not a layout mistake with a visible symptom - the buttons **do not
render at all**, on a sheet whose only other way out may be a pull-down. TypeScript
is happy, the prop is real, and nothing in the tree says the footer went missing.

The pair of them is one rule with two halves, and `keyboard-covers-the-footer`
now scans every `<Sheet` in the app for both:

1. a sheet with `avoidKeyboard` that renders a `PrimaryButton` **anywhere,
   body or footer prop**, must have `scrolls` WITH `footer`, or an explicit
   `keyboardAllowance`. A bare `avoidKeyboard` lifts the whole sheet by the
   whole keyboard and parks every button in it in the strip reserved for Hide
   keyboard;
2. a sheet with a `footer` must have `scrolls` at all, per the above.

Rule 2 exists because the first version of that guard read only the sheet's
BODY for a button. Removing `scrolls` while leaving the buttons in `footer` -
the obvious mutation to check it with - passed, against a sheet that rendered
no buttons whatsoever. **A source-scan guard that reads the wrong half of a JSX
element is worse than none**, because it certifies the thing it cannot see. If
a guard parses an opening tag, remember that props like `footer={...}` are part
of the TAG and not the children, and mutation-check it in both directions.

## A fixed height inside a sheet cannot give way, and the sheet is capped

`Sheet` sets `maxHeight: height - insets.top - Space.lg`, and `avoidKeyboard`
grows its floor by the keyboard's full height. Any child with a rigid `height`
therefore pushes the sheet's own bottom past that cap the moment the content
above it grows - which is exactly what Dynamic Type does to a header, a search
row and a count line. Nothing scrolls it back: the overflow is simply off the
end of a box that will not move.

The languages picker was `height: listHeight` on its FlatList and had this bug
at the accessibility sizes with the search focused. `maxHeight` plus
`flexShrink: 1` is the shape: a ceiling the list may reach and a size it gives
up under pressure. The same reasoning is why `scrolls` exists at all, and why a
sheet that has grown past three or four children usually wants it.

## Effects that consume what they act on

- **A store write inside an effect re-renders the component BEFORE the event
  loop turns, so a cleanup keyed on the written value runs before any 0ms
  timer the same effect scheduled.** The map's intent replay consumed the
  intent (`intentHandled()`, a Zustand write), scheduled `applyCity` and
  `enterPlaceMode` on a `setTimeout(..., 0)`, and returned
  `() => clearTimeout(timer)`. React flushes a sync-lane update scheduled
  during passive effects synchronously, so the intent going null re-ran the
  effect, its cleanup cleared the timer, and the replay never fired - every
  guard around it read correctly and the onboarding tour's tail was red for
  four runs. Hold the timer in a ref and clear it on unmount only
  (`features/pins/__tests__/replay-outlives-its-clear.test.tsx` shows both
  shapes on the real React). The general rule: an effect that both consumes
  its trigger and defers its action must not own the deferral through its
  own cleanup.

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
- **A change of RETURN TYPE needs the same drop-first** (say `uuid` to
  `jsonb`): Postgres refuses that through `create or replace` too, and the
  failure lands after the earlier statements have applied. 20260905130000
  avoided one on purpose: `register_business` keeps its `uuid`, and the client
  reads the resolved city through `city_for_spot` before the write and
  `my_business` after it.
- `distinct on (...)` requires those same expressions to lead the
  `ORDER BY`. Deduplicating in a subquery and ordering in the outer query is
  the way to keep both.
- Row-level security is the enforcement layer; client code is only UX. A
  policy that lets a table be read in bulk defeats the feature even if no
  screen does it — check policies for enumerability, not just correctness.
- `PostgrestError` is not an `Error`. `catch (e) { if (e instanceof Error) }`
  silently swallows every database message.
- **`add column` on a table with column-level grants revokes `select *`.**
  Postgres refuses a star select unless EVERY column is granted, so a new
  column on a column-granted table breaks the app's `.select('*')` (and
  `returning *` via bare `.select()` after insert) with `permission denied` —
  while the column-listed insert keeps working, so the write half looks fine
  and the read-back dies. Rendered through a screen that has not opted into
  `LoadError`, the failure IS the empty state: the business photo grid
  answered every successful upload with "0 of 10" for three e2e runs
  (90 to 92) before anything named the cause. Grant the new column in the
  same migration, and keep `31_select_star_stays_readable.test.sql` listing
  every table the app star-reads.

**A Postgres Changes subscription filtered to `INSERT` cannot see a verdict.**
Anything that lands in a pending state and is later cleared by a worker
changes by UPDATE, not INSERT — a held photo, a moderated first message, a
verification. Both of this repo's thread subscriptions watched INSERT only, so
the screen most likely to be OPEN while a photo cleared was the one screen
that could not notice, and the review tile sat there until somebody else
posted or the person backed out and came back. Use `event: '*'` and either
merge the row by id (a table-backed cache) or invalidate (an RPC-backed one).
Merging matters as much as subscribing: a handler that treats a known id as
"already have it" drops the very update it was subscribed for.

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
- **The iOS Simulator on GitHub's macOS runners CAN reach `u.expo.dev`, and
  this entry used to say the opposite.** The evidence for "cannot" was
  expo-updates' log line `checkError: "Unknown error: A TLS error caused the
secure connection to failed"`, read off a step that had died 0.1s after
  launching the app: `DB=$(ls ... | tail -1)` under `bash -e` with pipefail
  took the step down the first time the updates database was missing, which
  is exactly the case the wait loop exists to wait out, so the log was read
  before the app had waited for anything. With that fixed, run 43 fetched
  the published update and drove the flows against it. So **`build: false`
  is the honest default for a JavaScript change** (`e2e.yml`'s own input
  description says so): the reused binary fetches the `e2e` channel's update,
  and the workflow fails outright rather than falling back to embedded JS
  when the fetch does not land, printing the updates table and expo-updates'
  own log so the next "cannot fetch" is read rather than assumed.
  `build: true` is for a native change, and once after a `version` bump: a
  runtime-0.1.0 simulator binary cannot take a runtime-0.2.0 update, so the
  first run after 2026-09-02's bump to 0.2.0 needs a fresh binary.
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

## `opacity` cannot express "disabled" and stay legible

Fading a control dims its label AND its ground together, in the same
proportion, so the contrast between them collapses toward the contrast between
the ground and itself — which is 1:1. There is no opacity value that says
"unavailable" without also saying "unreadable".

Measured here, on `#0E1020`: a filled pill at `opacity: 0.4` came out at
**2.35:1** and a ghost label at the same value **2.28:1**, both under the 3:1
floor for a control, and both still looking completely tappable. The fix is to
change COLOUR, never alpha — swap the fill for `surfaceSunken` and the label
for `textSecondary` — which lands at 8.2:1 and reads as unavailable because
the accent is gone, not because it is faint.

Two things follow. Fixing one variant is not fixing the component: the filled
case was corrected months before the ghost and danger cases, which kept the
fade. And WCAG's exemption for inactive controls is not a licence — the
founder reads the screen, not the spec.

## Tests

- **Never loosen an assertion to make a run pass.** A wildcard once let a
  run go green on a screen where two form fields had been concatenated into
  one. Assert the exact text a human would read.
- Screenshots are the evidence, not the exit code. See the `screens` skill.
- **After a mid-flow `launchApp`, nothing on the map screen matches** — not
  the legend chip's printed words, not its accessibility label, not a marker.
  Runs 64 and 66 asserted each of those in turn and failed on screenshots that
  plainly show them. The same map IS addressable on a cold start (the guest
  flow taps `Drop a pin` as a hard step and passes), so this is not MapKit
  refusing to publish a tree. Photograph that segment and move on.
- **A Pressable with its own `accessibilityLabel` HIDES the text inside it
  from Maestro.** On iOS it becomes a single accessibility element and its
  children stop being elements at all, so `visible: "<the words on screen>"`
  fails on a screenshot that plainly shows those words. Assert the spoken
  label instead — and remember it is usually not the same sentence, because a
  spoken label has to say what the thing IS. This cost a run on the map's
  places legend, whose chip reads "Tap a place to see what's on" and speaks
  "The small chips are places. Tap one to see what's on.".

**A pgTAP fixture cannot be a temp table if the suite switches roles.** `set
local role authenticated` has no privileges on anything in `pg_temp`, so the
first assertion after the switch dies with "permission denied for table ctx" —
and that is always the half of the test that matters, because it is the half
about what a real user sees. Use a `pg_temp.<name>()` FUNCTION returning the id
instead; functions are callable where tables are not.

**And read the id from the table that has a policy for the reader.** `chats`
carries no select policy for room members (harmless — `my_chats` is a definer
function), so a helper that joins `chats` returns NULL the moment the suite
becomes `authenticated`, and every insert afterwards goes to a null chat and
is refused by RLS with an error that says nothing about the real cause. Read
`groups.chat_id`.

## Maestro judges a sheet row visible while the dock is painted over it

The plan list (`plan-list.tsx`) is a ScrollView inside a sliding sheet, and
the dock's opaque plate covers the bottom `footing` points of that
ScrollView's frame. Maestro reads frames, not what is drawn over them:
`scrollUntilVisible` on a row in the list's last section stops the moment
the row's frame is inside the list's, which is under the dock, and the tap
lands on the tab bar. Runs 106, 120 and 121 all photographed the Travelers
tab after "tapping" a What's on row, by label and by id alike. The rows'
frames are otherwise true (plan-list-row-0 is tapped by id at the half
detent every run), and the venue's map annotation is no way round it:
Maestro cannot address a MapKit annotation by label (runs 106, 120, 122).
What works: the sheet to its full detent (a drag on the strip; the strip's
tap only toggles peek and half), the list to its end (the last row's
padding clears the dock), then the row by id.

## A map swipe at 45% lands on the plan list, not the map

`planListHeights` puts the half detent at `footing + 55%` of the content range,
so the plan list's top edge sits at roughly **45% of the window**. A Maestro
swipe at `y: 45%` is therefore on the sheet: it scrolls the rows and the map
does not move at all. Run 128's guest tour died on `Back to Bangkok` with the
map still over Bangkok Noi and the list plainly at half in the failure frame.

Swipe at **25%**, which is map at both peek and half. There is no safe y at the
full detent: `full = windowHeight - RAIL_RESERVE`, so the sheet covers
everything. And collapse the list first — see the entry below for why that is
harder than it looks, and how run 129 lost the same assertion with the map in
exactly the right place.

And swipe THREE times, not two. The assertion is about distance —
`FAR_FROM_CITY_M` is 4 km from `home` — while a swipe carries a fraction of the
current viewport, and the zoom is whatever `fitRegion` chose to frame this
city's pins. Re-seeding the demo data changes it. Two spans were tuned against
one seed and are not a constant.

No jest guard for this one, deliberately: the rule is "a swipe meant for the
MAP must clear the sheet", and several legitimate swipes cross that band
(vertical scrolls, the tour carousel at y 50%). A blanket band check would be
mostly false positives.

## Maestro taps a button through the keyboard and calls it a success

Since 326837d a StepScreen or StepShell footer is a sibling BELOW the keyboard
floor, and since 43886b4 a Sheet with a `keyboardAllowance` leaves its pinned
button covered too. That is the founder's ask - the button does not rise, the
keyboard covers it, `Hide keyboard` is the way back down - and it changes what
`tapOn` means. The button is still in the accessibility tree with a frame, so
Maestro taps its coordinates, the tap lands on the keyboard, and the STEP
PASSES. The run then dies several steps later on an assertion about something
the button never did, naming a screen and a beat rather than the tap.

Runs 126 and 127 both burned on this at the say-hi composer, 25 seconds each
waiting for a confirmation, and I misattributed 126 to my own re-seeding of the
demo data before 127 reproduced it on untouched rows. The artifact that settles
it is always there and easy to miss: Maestro writes
`results/step-N-assertCondition-(...).png` at the moment an assertion fails.
Look at that picture before theorising.

So: type, then `tapOn: 'Hide keyboard'` (or `pressKey: Enter` on a
single-line field, which iOS honours by blurring - `hideKeyboard` is BANNED
here, it took run 82 down in both tours), and only then tap the button.
`e2e-flows.test.ts` derives the covered screens from the source and fails the
gate on a flow that skips it, so this is a caught mistake rather than a
twenty-minute one. The chat room's Composer is the exception the guard is
scoped to allow: its Send is inline in the bar and is SUPPOSED to ride up.

## `plan-list-peek` is a TOGGLE, and it is `disabled` under any sheet

`onPress={() => snapTo(expanded ? 'peek' : 'half')}`. Tapping it does not
collapse the list; it flips whichever way the list currently is. And
`disabled={collapsed}` where `collapsed` is `sheetCovered`, so while a pin
card, a venue stack, the filter sheet or a sign-up gate is up, the header is
disabled — Maestro still finds it, still taps it, and still reports
**COMPLETED**, because a disabled `Pressable` is an element with a frame.

Run 129 is what that costs. The guest tour tapped a row (which opened the
guest sign-up gate), failed to close it, tapped the peek header into a dead
control, panned three screen-widths off Bangkok, and asserted the way-home
pill. The map was in exactly the right place. But a list past its peek is
`planListExpanded`, `planListExpanded` is `mapCovered`, and `mapCovered` makes
`slot` null — so every banner is suppressed and the pill it was waiting for
could not exist. Two green steps and a red one, none of them where the
mistake was.

**The rows are the state probe.** `plan-list.tsx` sets
`accessibilityElementsHidden={!expanded}` on the scroller, so `plan-list-row-0`
is in the hierarchy when the list is up and absent when it is down. Gate the
collapse on it and assert it afterwards:

```yaml
- runFlow:
    when:
      visible:
        id: 'plan-list-row-0'
    commands:
      - tapOn:
          id: 'plan-list-peek'
      - waitForAnimationToEnd:
          timeout: 2000
- assertNotVisible:
    id: 'plan-list-row-0'
```

## A branch that replaces a card replaces the card's close

`{isGuest && !selectedPin.seeded ? <SignUpGate .../> : <PinCard .../>}` inside
one `<Sheet inline dimmed={false}>`. `PinCard` draws its own header with an ✕;
the gate arm drew no header at all. And `dimmed={false}` means no scrim to tap.
So for a guest — the person most likely to open it — the highest-stakes sheet
in the app had no visible way out, only a pull-down gesture nothing on screen
mentions.

Nobody reported it. E2E 129 found it from the other side: the tour tapped the
`Close` the card has, Maestro reported `WARNED` because the element did not
exist, and because the step was `optional: true` the run carried on for twenty
more steps with the sheet still open.

Whenever a ternary swaps out a whole sheet body, ask what came off with it.
`sign-up-gate-detail.test.tsx` now reads that branch out of the source and
fails if the close leaves again.

## A four-second confirmation is not an assertion target

`SAID_HI_MS` is 4000; `CONFIRM_MS` is 1100. A Maestro hierarchy fetch on iOS
can take a second or more on its own, so a four-second window sits inside the
driver's own sampling error. Pinning a flow to it makes the suite report on
Maestro's timing rather than on the app, and it fails in both directions:
run 124 burned 25 s waiting for the composer beat while the strip came and
went underneath it, and run 129 did the mirror image — the shared
`(Sent to|Said hi to)` wait matched the STRIP near the end of its window and
the exact-sentence assert under it failed a fraction of a second later against
a bar that had cleared itself exactly on time.

Wait for whichever beat is up (that is what proves the action), take the
picture, and make the beat-specific assertion `optional: true`. Then assert
something DURABLE and fail on that instead — the composer closing itself is
the same fact and it does not expire. Copy belongs in jest, which can check it
character for character on every commit rather than once a run
(`travelers-said-hi.test.ts`).

The same applies to a bare `assertVisible` straight after a `tapOn`: it fires
before the state write, the entrance animation and the next card's photo have
landed. Use `extendedWaitUntil` with a budget close to the beat's own life, so
a bar that never arrives still fails, and fails fast.

## Apple Maps props: two that silently do nothing, and one ordering hazard

`showsPointsOfInterests` is the plural. The singular spelling is not a prop in
react-native-maps 1.27.2 and is dropped without a word.

`showsIndoors` is declared in the Apple codegen props and read by nothing in
`ios/AirMaps` — dead on MapKit. Meanwhile `showsBuildings`, `rotateEnabled`
and `pitchEnabled` are all documented in the .d.ts as unsupported or
Google-only on iOS and all three ARE honoured: `RNMapsMapView.mm` remaps each
straight onto AIRMap, which is an MKMapView subclass overriding none of their
setters. Read the native file, not the doc comment.

**The ordering hazard is the one that costs a release.** On iOS 16+ the POI
prop is implemented by copying `MKMapView.preferredConfiguration` and writing
a `pointOfInterestFilter` onto it. `mapType` is written straight to
`MKMapView.mapType` — the same underlying state — twenty-five lines LATER in
the same `updateProps` pass, and setting it installs a fresh default
configuration for that type, discarding the filter. On mount both change
together, so the map type wins and the POI icons stay. Neither prop ever
changes again and the native remap is guarded on `old != new`, so nothing
re-applies it. Hold the POI value in state and flip it on `onMapReady`: that
puts the write in a later commit where `mapType` is unchanged. Costs one frame
of pills.

`pointsOfInterestFilter` (the array) IS applied after `mapType`, but the
native side only ever builds `initIncludingCategories` and bails on an empty
array, so it cannot express "none of them".

Nothing removes labels, roads or water — MKPointOfInterestFilter covers
business categories only. The only remaining lever is an overlay, and it is a
good one: MapKit draws every overlay BENEATH every annotation, so a polygon
wash dims the cartography without touching a single marker.

**Do not stack that wash on `mutedStandard`.** They are not complementary.
mutedStandard drops label CONTRAST as well as saturation, so a wash over it
darkens something already flattened, and the founder's map came back on
2026-08-23 as too dark to read — a street name at roughly 2:1 against the
ground. `standard` with `userInterfaceStyle: 'dark'` is the map Apple shows
at night: legible, and already navy enough for a dark theme. Let the map type
carry contrast and let the wash carry saturation, at about 0.14 rather than
0.34. One knob each, and tune the wash first.

**A shared props constant does not cover overlays.** Both MapViews spread
`QUIET_BASEMAP`, which is why the props cannot drift; the wash is a `Polygon`
each screen draws for itself, and the picker had silently never drawn one.
Invisible while both maps used the same type, and a visible split the moment
one value changed. When a treatment is half prop and half overlay, check both
halves on both screens.

## The local Postgres shim owns `auth`. The hosted project does not.

`scripts/db-test.sh` builds a throwaway cluster where one role owns
everything, so anything you write against the `auth` schema passes. The
hosted project locks that schema down and the migration role does not own it.
The gap is silent until deploy.

`alter table auth.users ...` is refused outright — that is what broke the
guests-can-chat deploy on 2026-08-23. If a migration needs a column the local
cluster lacks but real Supabase already has, put it in
`supabase/shim/local_supabase_shim.sql`, which never runs against production.

What IS permitted, on the evidence of this repo running it: `create trigger`
on `auth.users` (`on_auth_user_created`, since the first migration) and
`select` from it inside a SECURITY DEFINER function (the support inbox
resolving addresses). Prefer reading over mirroring — a definer function
reading `auth.users.is_anonymous` needs no column, no sync trigger and has no
drift, which is how the same feature ended up smaller on the second attempt.

**`delete from auth.users` is not in that list.** The one place this project
removes a user, `delete-account`, goes through `admin.auth.admin.deleteUser`
in an Edge Function. Anything scheduled that needs to delete an auth row does
the same and is invoked by `invoke_edge_worker`, because a pg_cron job that
silently cannot do its job is worse than no job.

## The simulator keyboard guesses, and it will break a run

Run 50 died asserting text it had just typed, on a field reading "Meeting by
the door around 7d". The trailing "d" was iOS's inline predictive text —
ghosted after the cursor, present in the accessibility value, offered behind a
first-run "Inline Predictions" tooltip that had popped up over the sheet and
could have eaten the next tap as easily as it broke the assertion.

The E2E workflow now turns `KeyboardPrediction`, `KeyboardInlineCompletion`,
`KeyboardAutocorrection` and `KeyboardShowPredictiveBar` off via
`simctl spawn defaults write com.apple.keyboard.preferences` before anything
types. Do not "fix" this class of failure with `pressKey: Enter` on a
multiline field — Enter is a newline there, and a newline is exactly what `.`
does not match in a Maestro pattern.

## expo-router: a guard swap unmounts the stack, and takes navigation with it

Two separate hazards in the root layout, both of which shipped, both of which
every test in the repo passed straight through.

**A `Stack.Protected` predicate written for the common case traps the
uncommon one.** The tabs were gated on `!signedIn || onboarded`, which reads
correctly until a third kind of person exists. A guest (anonymous sign-in) is
signed in and can never be onboarded — the database refuses that stamp on
purpose — so the moment one signed in, the tabs unmounted and the onboarding
stack took over, asking for a profile behind a finish button the server would
refuse forever. Write the predicate as the question you are actually asking
("does this person still owe us a profile?"), give it a name, and give it a
test naming the case that does not fit.

Check the same thing for every `Stack.Screen` inside a guarded block. The
guest-naming screen sat inside `signedIn && onboarded`, which is the one pair
of states it is never used in — signed out, becoming a guest, and a guest
account, renaming. `router.push` to an unregistered route does not throw. It
does nothing, silently, which looks exactly like a dead button.

**A root-level loading hold discards in-flight navigation.** The hold renders
_instead of_ the navigator, so while it is up there is no stack, and anything
that called `router.replace` a tick earlier is gone; when the hold drops, the
stack remounts at its anchor route. Signing in flips `signedIn` true while the
profile query is still pending, so a screen that signs somebody in and then
navigates is racing its own layout. Either exempt that path from the hold
(best — if the routing decision does not need the query, do not wait for it),
or hold the destination somewhere outside the stack and navigate after remount.

Both are invisible to unit tests, to pgTAP, and to a signed-in E2E flow. The
thing that caught them was walking the screens in the order a real person
would.

**A cold-start deep link is ALONE in the navigator unless you say otherwise.**
Opening `samewhere://join-group/<token>` on a phone that was not already
running builds a navigation state containing only that route: no tab bar, no
back chevron, and `router.back()` dispatching a GO_BACK that no navigator
handles — silently, so the button simply does nothing. Tap the same link again
while the app is warm and it works perfectly, which is exactly how the founder
reported it ("it crashed the first time then worked the second time"). Fix it
once, at the root:

```tsx
export const unstable_settings = { anchor: '(tabs)' };
```

Then never let a linked screen's only exit be a bare `router.back()`. The
idiom this repo uses everywhere is
`router.canGoBack() ? router.back() : router.replace('/(tabs)')`, and every
terminal branch of a linkable screen needs it.

**`router.replace(next)` from a screen pushed on top of `next` pushes a SECOND
copy of it.** The naming screen was reached from the invite and then replaced
itself with the invite, so the invite the person wanted — with both of its
options still on it — was two dismissals down, behind a stack the app had
built by hand. Going back is almost always what was meant; keep `next` as the
fallback for the cold-start case where there is nothing to go back to.

**`tracksViewChanges` does nothing on the map this app actually ships.** It is
implemented for iOS **Google** Maps and for Android only — present in
`ios/AirGoogleMaps/AIRGoogleMapMarker.m` and the Android sources, absent from
every file under `ios/AirMaps`, and documented `@platform iOS: Google Maps
only` at `node_modules/react-native-maps/src/MapMarker.tsx:308-316`. This app
is `PROVIDER_DEFAULT`, and the Apple path mounts a marker's React child as a
LIVE subview (`ios/AirMaps/RNMapsMarkerView.mm:286-296`,
`ios/AirMaps/AIRMapMarker.m:75-79`) and never snapshots it. So springs and
entrances paint unconditionally, there is no pan-time freeze being bought, and
the hook costs a timer plus one extra render per marker.

Keep `useMarkerTracking` anyway — Android is the platform it is for — and keep
its KEYS complete. The key is the project's checklist of everything a marker
draws: anything missing from it is something that would be missing from the
bitmap on the provider that does freeze. Do not "optimise" a marker by
reasoning about rasterisation on iOS; there isn't any.

Two z-order facts a marker change needs at the same time:

- `AIRMapMarker.m:401-405`'s `setZIndex` updates `layer.zPosition` only and
  does NOT re-assign `zPriority`, so a selected marker's collision priority is
  whatever it was at mount. Raising `zIndex` on selection changes what draws on
  top and nothing about what MapKit declutters.
- `displayPriority` is the DECLUTTER control, not the layer control. Never
  `'low'` on anything that has to stay tappable: a decluttered annotation
  leaves the accessibility tree with it, so the simulator suite cannot reach it
  either (`business-marker.tsx:165-178` records the outage this caused).

**A marker's tappable area IS its wrapper view, padding included.** There is no
hit slop on a `Marker` child. `26 + 4 + 4` is 34 and under the floor; the
padding is not decoration, it is the hit target, so a body-size change has to
be paid for in the padding at the same time (`30 + 7 + 7 = 44`).

**A workflow subagent can write to the tree, and can commit.** Paid for twice on
2026-09-10. A design agent told to "write the trigger as real SQL that would
run" verified its SQL by writing a migration and a pgTAP file INTO
`supabase/`, then wrote them again under a new timestamp when they were moved
aside — polluting three `db-test.sh` runs and one diagnosis in between. Later
a different agent ran `git commit` on the working branch (with a fixture edit
that was time-of-day dependent), and a third committed a revert of the first
one's file. Both commits were then pushed under the next real commit.

Every subagent has Bash, and Bash has git. So, for any agent that reads the
repo: say in its prompt, in so many words, "return text; do not write files;
do not run git". For any agent that must edit, give it `isolation: 'worktree'`
and forbid commit/push/checkout/stash/reset by name, then review and apply the
diff yourself. And before trusting a `db-test.sh` result while an agent is
running, `git status --short` first: an untracked migration in the list is not
yours.

And the worktree itself is INSIDE the repo: `.claude/worktrees/<agent>/` is a
full second copy of the tree, git-ignored through `.git/info/exclude` but
visible to everything that walks the filesystem. `tsc` failed on the agent's
half-finished edits, `jest` ran every file twice and printed a test's OLD name
after the real one had been rewritten, and `expo lint` and `prettier --check`
would have read it too. All four now exclude `.claude/` (tsconfig `exclude`,
jest `testPathIgnorePatterns` + `modulePathIgnorePatterns`, eslint `ignores`,
`.prettierignore`). Keep those lines when touching the configs, and remove
the worktree (`git worktree remove`) once its diff has been applied.
