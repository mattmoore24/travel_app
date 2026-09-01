# Every work package, in full

The reference half of [`UX_PLAN.md`](UX_PLAN.md).

# Part 4 — Every package in full

Grouped by subsystem. Each carries what changes, the migration if any, the test that proves it, the risk, and the question it waits on.

## Dropping a pin: place mode, the pin form, expiry, categories and join modes

Seventeen findings collapse into eleven packages, and the pin-drop flow itself only accounts for seven of them. The shape of the real work is narrow: one screen, src/features/pins/pin-form-sheet.tsx, is carrying four separate defects at once (its day and lifetime controls are below the fold, its scroll edge guillotines text with no fade, its disabled button never says what it wants, and its first label says "Location" four rows above a line promising it is not one), and all four are cheap JavaScript. The one genuinely expensive thing here is that a pin dropped by panning the map has no category and no name until after you have committed to it, because both facts only exist when Apple's search index was used — fixing that properly needs a new native call (MKLocalPointsOfInterestRequest) and therefore an EAS build, so it is the only package worth batching native work for. Two findings are cheaper than they look: the web pin form is a second, divergent, unreachable-on-iOS composer that writes real pins at the city centroid, and deleting it closes both of them in one commit. Three findings assigned here belong to other subsystems (the sent-hello inbox row, group system messages, the admin liquidity view); they are planned honestly but marked later and should be merged into whoever owns chat and admin. The founder is really deciding three things: whether the category may ever be asked or corrected after removing the chips, whether the pin flow is worth an EAS build, and whether the web build stays a write path at all. My recommendation on all three is: no chips but a correctable glyph, yes to one batched build, and no, make web read-only.

### `pin-sheet-words` — Say what the pin sheet is waiting for, and stop labelling a plan a location

**Priority** now · **Effort** S · **Ships as** over the air

On the one sheet a traveler actually uses to drop a pin, the first label is "Location" and the last line is "Never shows where you are" — the exact word the architecture spent itself avoiding, four rows above its own denial. The primary button says "Drop it", a phrase this codebase also uses for discarding (business-edit.tsx:1007, "Drop them" = throw your changes away), and it sits next to "Gone in 72h max", so it can read as "forget this". And when the button is grey, nothing on screen says which of the two empty boxes it is waiting for: neither field is marked required and the older web screen already solved this with a footer sentence. Three string changes, one screen, no layout risk.

<details><summary>Closes 3 audit findings</summary>

- The disabled "Drop it" button never says what it is waiting for

- The pin form is headed "Location" and footed "Never shows where you are"

- "Drop it" is the confirm button on a form where the same verb means abandon

</details>

**Changes**

- src/features/pins/pin-form-sheet.tsx:169-171 — section label "Location" becomes "Where". "Place" and "spot" are still legal here per the design brief ("place" is banned only when it means a business); "Location" is the collision.

- src/features/pins/pin-form-sheet.tsx:341 — PrimaryButton label "Drop it" becomes "Put it on the map". Fallback if it ever wraps on a narrow device: "Drop the pin", which keeps the noun the map FAB (map-screen.tsx:1394, "Drop a pin") teaches.

- src/features/pins/pin-form-sheet.tsx:341-345 — add accessibilityHint to the PrimaryButton, mirroring the footnote below, because the disabled state here is a colour swap (primary-button.tsx:38-53) and a colour change is not announced.

- src/features/pins/pin-form-sheet.tsx:346-348 — make the footnote conditional on the same expression that disables the button. Empty plan: "Say what the plan is first." Filled: "A plan, not your location. It disappears on its own." Same slot, same one-line height either way, so nothing reflows. Drop "Gone in 72h max" from here: the "Disappears after" heading and the pinned readout added by pin-sheet-fits both carry the expiry, and three statements of one fact on one screen is what the audit caught.

- e2e/flows/signed-in-tour.yml:120 — `- tapOn: 'Drop it'` becomes `- tapOn: 'Put it on the map'`. This is the step that would silently fail the whole run; the later `assertVisible: 'Drop a pin'` steps at :153 and :418 refer to the map FAB and are untouched.

- e2e/flows/signed-in-tour.yml — after `- takeScreenshot: 14-pin-form`, add `- assertVisible: 'Say what the plan is first.'` before typing, so the disabled reason is proved rather than photographed.

**Tests.** jest is the wrong tool for strings. Evidence is the re-shot 14-pin-form.png (grey button now reading "Put it on the map" over "Say what the plan is first.") and 15-pin-form-filled.png (filled button over "A plan, not your location. It disappears on its own."), plus the two new Maestro assertions above. Read both strings aloud: no em dashes, no banned words.

**Risk.** The E2E flow taps the button by its literal label, so forgetting the flow edit turns a five-minute copy change into a red run that looks like a real regression. "Put it on the map" is four words where "Drop it" was two; check it in the re-shot 14-pin-form rather than assuming, because PrimaryButton has no wrap handling. No hard rule is touched: the sheet still never states or collects a real location.

### `pin-sheet-fits` — Make the day, the lifetime and the plan all fit in the pin sheet at once

**Priority** now · **Effort** M · **Ships as** over the air

The two fields that define what a pin IS — the day it is for and how long it lives — are the two the sheet hides. In 14-pin-form.png "Disappears after" is a heading over roughly 35pt of empty space with no slider, no readout and no range, and there is no keyboard up yet. In 15-pin-form-filled.png, with the keyboard up, the day chips and the whole expiry block are gone while the button is live. The 72-hour expiry is one of the four privacy promises the product leads with and its control is, in practice, unreachable. The same scroll edge also slices the venue name horizontally through its letterforms in 15, on the screen whose whole job is confirming which spot you are about to pin. This file already learned this lesson once, when run 76 photographed the join-mode block clipped in half and it was moved above the fields; this applies the same precedent to the two controls still below them.

<details><summary>Closes 3 audit findings</summary>

- The pin form clips "When" and "Disappears after" below the fold, and "Drop it" stays live above them

- "Disappears after" heads an empty gap: the expiry control never comes into view

- Sheet content is clipped mid-glyph under the grab handle with no fade or header

</details>

**Changes**

- src/components/form/chip-rail.tsx:28-34 — render `label` as a `<ThemedText type="smallBold">` above the horizontal ScrollView when it is set, keeping it on accessibilityLabel too. Today line 33 spends the prop on accessibility only, which is why the Today/Tomorrow/Monday chips float with no heading at all in 14-pin-form.png. Safe to change in place: pin-form-sheet.tsx:319 is the only caller in the repo.

- src/features/pins/pin-form-sheet.tsx:317-338 — move the ChipRail block and the sliderBlock up, to sit directly after the joinBlock (ends :266) and before the plan field (:273). Order becomes: Where card, How people come along, When, Disappears after, What's the plan?, Details.

- src/features/pins/pin-form-sheet.tsx:296-315 — cut the Details field from two reserved lines to one that grows: drop `numberOfLines={2}` and lower `styles.noteInput.minHeight` (:384-387) from 62 to 40. This buys back roughly the height the two moved blocks cost, so the required plan field does not become the new thing below the fold — which is the exact mirror-image bug this reorder invites.

- src/features/pins/pin-form-sheet.tsx:325-326 — the slider heading becomes `Disappears after · ${hoursLabel(effectiveHours)}`, so the value is readable even when the track is not. `hoursLabel` is already imported (:22).

- src/features/pins/pin-form-sheet.tsx:339-345 — add a pinned readout row between the ScrollView and the PrimaryButton, outside the scroller so it survives the keyboard: a Pressable reading `${intentLabel(effectiveIntent)} · gone in ${hoursLabel(effectiveHours)}`, which on press calls scrollRef.current?.scrollTo({ y: fieldY.current.expiry }). Record that y with an onLayout on the sliderBlock, using the same fieldY ref the two text fields already use (:83-84, :274, :293). One row of pinned chrome, not a second slider. Import intentLabel from pin-helpers.

- src/features/pins/pin-form-sheet.tsx:150-168 — wrap the ScrollView in a `<View style={{ flexShrink: 1 }}>` and add two absolutely-positioned `<LinearGradient>` siblings inside it, pointerEvents="none": top 20pt from theme.surface to transparent, bottom 24pt from transparent to theme.surface. Do this HERE and not in components/ui/sheet.tsx: every other Sheet caller (select-field, language-field, trip-editor, push-primer, four call sites in map-screen) has static children, and a generic top fade would wash out their first row for no reason.

- e2e/flows/signed-in-tour.yml:107-117 — beside the existing join-mode assertions, add `- assertVisible: 'When'` and `- assertVisible: 'Disappears after.*'`. assertVisible, not scrollUntilVisible: the whole claim is that no scrolling is needed, which is the same reasoning the file already records at :113-115 for the join rows.

**Tests.** Screenshots are the only thing that answers this. Re-shoot 14-pin-form.png (no keyboard: Where, join rows, When with a visible heading, "Disappears after · 6 hours" with a real slider under it, both fields, all present) and 15-pin-form-filled.png (keyboard up: no text sliced through its letterforms at the scroll edge, a visible fade there instead, and the pinned "Today · gone in 6 hours" row above the button). Add the two Maestro assertions above so a future regression fails the run rather than only the picture. src/features/pins/**tests**/pin-helpers.test.ts already covers hoursLabel and intentLabel, so no new unit tests are owed.

**Risk.** The sheet is ALREADY at its maximum height — sheet.tsx:252 caps it at `height - insets.top - Space.lg`, and measuring 14-pin-form.png puts the sheet's top edge right at that cap — so "give it a taller detent" is not available and content cost is the only lever. That means the reorder can only work if the Details field really does give back the height the moved blocks take; if the re-shot screenshots still show the plan field below the fold, the next lever is collapsing the two join rows into a Segmented control, which is a recorded founder decision (the comment at :213-221 explains why they are two full rows) and must not be done without sign-off. Every pinned row also steals from the scroller when the keyboard is up, so keep the readout to one line. Nothing here changes what expiry is written: effectiveHours still runs through minHoursForIntent / MAX_PIN_HOURS / expiryForHours, so hard rule 3 is untouched.

**After.** `pin-sheet-words`

### `pin-place-name-pill` — Name the spot under the placement pin before asking anyone to confirm it

**Priority** now · **Effort** M · **Ships as** over the air

13-place-after-pan.png shows the fixed amber pin sitting on the Chao Phraya river near Wat Kanlaya with nothing on screen naming it: the only chrome is an empty "Search Bangkok" field and a "Pin here" button. 14-pin-form.png then reveals the answer — "Somdet Phra Pokklao Bridge, Wang Burapha Ph..." — one screen too late, because the reverse geocode runs inside the form (pin-form-sheet.tsx:92-114), after the commit. The app already knows the answer and asks for the commitment first, on the single most important act on this screen. The consequence is either a wrong pin or a round trip through a modal sheet.

<details><summary>Closes 1 audit findings</summary>

- "Pin here" hovers over a spot with no name, then names it one screen too late (first half)

</details>

**Changes**

- src/features/pins/map-screen.tsx:923-943 — in onRegionChangeComplete, when mode === 'place', kick off a debounced reverse geocode of the settled centre. Guard it three ways, because iOS CLGeocoder rate-limits and starts failing under rapid panning: a seq counter that drops any response that is not the newest (copy the pattern from use-place-search.ts:69-78), a hard floor of 800ms since the last call held in a ref, and a skip when the new centre is within ~15m of the last geocoded centre (metersBetween is already imported into this file from cluster.ts).

- src/features/pins/map-screen.tsx:759-763 — add `placeLabel` state beside the existing `placeCoords` / `searchedPlace` / `lifted` state. Clear it in enterPlaceMode (:831-861) and in flyTo (:868-880), where searchedPlace already supplies a better name.

- src/features/pins/map-screen.tsx:1399-1416 — render a pill directly above the confirmBar, inside the same Animated.View, using theme.surface plus Elevation.floating to match the search field above (NOT glass: the brief is explicit that glass is a finish and never the thing carrying contrast, and this file already records that lesson at :1250-1262). Text is `searchedPlace?.name ?? placeLabel ?? 'Drop it here'`. Keep the pill mounted at a fixed height and only dim its text (themeColor textSecondary) while `lifted` is true, rather than mounting and unmounting it on every pan — a pill that appears and vanishes on each drag is worse motion than a pill that goes quiet.

- src/features/pins/pin-form-sheet.tsx:33-41, :64-68, :92-114 — accept a new optional `initialLabel?: string | null` prop, seed the placeLabel state from it, and skip the in-form reverse geocode when it is supplied. Keep the existing effect as the fallback for the case where the map never resolved a name, exactly as the file's comment at :88-91 describes.

- src/features/pins/map-screen.tsx:1418-1424 — pass `initialLabel={placeLabel}` into PinFormSheet so the same string is not fetched twice.

- src/features/pins/pin-helpers.ts — add a small pure `shouldGeocode({ last, next, lastAtMs, nowMs })` returning boolean, holding the 800ms floor and the 15m distance rule, so the throttling is unit-testable instead of living inside a map callback.

**Tests.** jest on shouldGeocode in src/features/pins/**tests**/pin-helpers.test.ts: it refuses inside 800ms, refuses inside 15m, allows outside both. The rest is a screenshot — re-shoot 13-place-after-pan.png and confirm the pill names the bridge before "Pin here" is tapped. Do NOT add a Maestro assertion on the geocoded string: the pan target in the flow (swipe 50%,62% to 58%,42%) is not deterministic enough to guarantee which name comes back, and loosening an assertion later to make a run pass is exactly what change-review forbids.

**Risk.** Rate limiting is the whole risk. Without the floor and the distance guard, a fast pan issues a geocode per settle and CLGeocoder starts returning errors, at which point the pill would read "Drop it here" over a spot the app can name — worse than saying nothing. Do not drop the form's existing fallback effect. Rule 2 is not touched and the code comment should say so: reverse-geocoding a coordinate the user chose on a map reads nobody's position, no permission is requested, and this is the same call the form already makes today.

### `pin-web-write-path-off` — Delete the web pin composer and make the web build read-only

**Priority** now · **Effort** S · **Ships as** over the air

Two pin forms ship and they disagree about what a pin is. src/app/drop-pin.tsx says "Post pin" and "Pin disappears after", has a category chip row, and cannot set a join mode — so every pin it creates takes the message-first path in hooks.ts:86 regardless of what the person wanted. The shipped iOS sheet says the opposite. Worse, drop-pin is a live write path into production pins with no location picker: location-picker.web.tsx:15-23 ignores every prop and renders a note saying the pin sits at the city center, so a pin posted from web is a claim that a person intends to be at a specific venue at a specific time, filed at the city centroid, indistinguishable from a real pin on the iOS map, occupying the same 72-hour window, joinable by other travelers. And because drop-pin is the route name, it is the file anyone reading the codebase finds first, so the next change to "the pin form" has an even chance of landing in the version nobody sees.

<details><summary>Closes 2 audit findings</summary>

- src/app/drop-pin.tsx is a second, divergent pin form no iOS screen can reach

- The web build is a live write path into production pins with no location picker, so a pin dropped there lands at the city centre

</details>

**Changes**

- src/app/drop-pin.tsx — delete the file (120 lines). Do not attempt parity with the sheet: map-screen.web.tsx:14-15 carries its own comment saying web is a dev convenience and iOS is the product, and the sheet's category comes from a tapped POI that a web list has no way to produce.

- src/app/\_layout.tsx:290 — delete the `<Stack.Screen name="drop-pin" options={{ presentation: 'modal' }} />` line. Leave :289 (compose-request) alone; that route is live on iOS.

- src/features/pins/map-screen.web.tsx:1-11, :57-60 — delete the "Drop a pin" PrimaryButton and its router.push, and the now-unused router and PrimaryButton imports. Replace with a `<ThemedText type="small" themeColor="textSecondary">` reading "Pins are dropped in the iOS app."

- src/features/pins/location-picker.web.tsx — keep it. It is still reached by business-signup.tsx:418,481 and business-edit.tsx:1161, which are a separate problem in a different subsystem; note it in that owner's plan rather than deleting the stub here.

- src/features/pins/map-screen.web.tsx:45-56 — leave the read-only list as it is. The audit claim that it bypasses the audience setting is wrong: it reads city_pins, which is SECURITY INVOKER and therefore governed by pins_select_visible (20260816210000_map_pins.sql:132-145 — expiry, active launch city, is_discoverable_owner and discovery_pair_ok all enforced there). What it skips is the client-side day/category/kind filter state, which is a per-viewer preference, not a visibility rule.

- src/features/pins/map-screen.tsx:1542 — untouched. The literal string 'drop-pin' there is the guest gate's `where` prop, not a route.

**Tests.** npm run typecheck is the real proof: the unused imports and the dangling route are compile errors, and nothing else in src/ references the file. Then confirm no Maestro flow touches it (e2e/flows/\*.yml contain no reference to drop-pin — the pin flow goes through the map's sheet). No screenshot changes on iOS by construction.

**Risk.** Deleting a route is the safest possible edit here — nothing on iOS pushes it — but grep for the literal 'drop-pin' before committing so the guest gate's `where` prop at map-screen.tsx:1542 is not caught by a careless find-and-replace. If the founder later wants posting from web back, the one thing it cannot ship without is the join-mode pair (pin-form-sheet.tsx:358-371), because `joinable` decides whether a group chat is created at all (hooks.ts:85-110); copy and glyph differences are cosmetic beside that.

**Waits on.** Should the web build be able to create pins at all? For: it is the only way to exercise the write path without a simulator, and it costs nothing today. Against: every pin it makes is filed at the city centroid and is indistinguishable from a real one on the iOS map, so somebody walks to the wrong corner; the same file is also a second, divergent definition of what a pin is. Recommendation: make web read-only. High confidence.

### `pin-sheet-discard-guard` — Stop a pull-down from throwing away a plan somebody just wrote

**Priority** next · **Effort** S · **Ships as** over the air

The plan text is what makes the difference between a marker and an invitation, and 15-pin-form-filled.png is a person mid-sentence over a live keyboard. PinFormSheet is presented through components/ui/sheet.tsx, whose grabber is a real pull-to-dismiss (DISMISS_DISTANCE 90pt or DISMISS_VELOCITY 900) and whose scrim is a full-screen "Dismiss" Pressable — and neither checks whether anything has been typed. The sheet unmounts, all state goes, and tapping "Pin here" again gives you an empty form. The app already knows how to do this properly: edit-profile.tsx:105-118 raises "Discard your changes?" / "You'll lose what you wrote." and even admits in its own comment that a swipe down used to eat a whole bio rewrite in silence.

<details><summary>Closes 1 audit findings</summary>

- The first hello and the pin form are swipe-dismissible modals with no discard guard (the pin half; the compose-request half is a different screen and a different mechanism)

</details>

**Changes**

- src/components/ui/sheet.tsx:121-148 — add an optional `onCloseRequest?: () => void` prop. When it is set, the scrim Pressable (:231-236) and the pull gesture's dismissal branch (:195-197, via runOnJS) call it instead of `onClose`; when it is absent nothing changes, so all nine existing callers are untouched.

- src/components/ui/sheet.tsx:190-198 — leave the `drag.value = withSpring(0, Springs.release)` reset unconditional. It already runs on every gesture end, so a refused dismissal springs the sheet back home rather than leaving it parked halfway off screen, which is exactly what the guard needs.

- src/features/pins/pin-form-sheet.tsx:148-149 — pass `onCloseRequest` to the Sheet: when `venue.trim() || note.trim()` is empty, call onClose directly; otherwise raise `Alert.alert('Discard this plan?', "You'll lose what you wrote.", [{ text: 'Keep writing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }])`, matching edit-profile's voice.

- src/components/ui/**tests**/sheet.test.ts — add a case asserting that with onCloseRequest set, the dismissal path calls it and does not call onClose. The file already exists and already guards this component against a regression (it keeps the Slide preset from coming back).

**Tests.** jest on components/ui/**tests**/sheet.test.ts for the routing of the dismissal (unit-testable, no simulator needed). The behaviour itself is an E2E step: in e2e/flows/signed-in-tour.yml after typing the plan, swipe down on the sheet and `assertVisible: 'Discard this plan?'`, then `tapOn: 'Keep writing'` and assert the typed plan is still there before continuing to the post. That step also proves the sheet survives the refused gesture rather than sitting halfway open.

**Risk.** This is the one place a guard is genuinely achievable, and it is worth saying why: edit-profile settled for guarding only its Close button because on an iOS native-stack modal a swipe dismissal cannot reliably be preventDefault-ed. The Sheet's pull is a react-native-gesture-handler Pan on the JS side, so intercepting it is real rather than aspirational. The trap to respect is the modal one from the traps skill: never dismiss and then alert. Raising the Alert while the Sheet is still mounted and still presented is safe — UIAlertController presents over the sheet's own view controller and nothing is mid-dismissal. Do not implement this by unmounting the sheet first and alerting in a setTimeout; that is the presentation iOS silently drops, and on Fabric it kills touch for the whole app.

**After.** `pin-sheet-fits`

### `pin-category-from-plan-text` — Guess a hand-placed pin's category from the plan, and show the guess as the marker

**Priority** next · **Effort** S · **Ships as** over the air

pin-form-sheet.tsx:86 is `const category = categoryForPoi(initialPlace?.category)` and pin-helpers.ts:103-106 returns 'other' for a null POI, so every pin placed by panning the map is typed 'other'. filters.ts:122 then drops any pin whose category is not in a non-empty filter list, so an untyped plan is invisible to anyone who has ticked Bar, or Food, or anything else that is not Other. 16-pin-posted.png proves it end to end: the pin dropped by panning in 12/13 draws with the plain mappin glyph among wineglass, camera and fork pins. The path pin-search-field.tsx:40-41 explicitly calls "the first-class way to place a pin" produces the second-class pin. This closes most of the harm today without an EAS build and without asking anyone a question.

<details><summary>Closes 2 audit findings</summary>

- A pin placed by dragging is always "Other" and disappears under any category filter

- The pin sheet never asks the category, so hand-placed pins file as Other and vanish from filters

</details>

**Changes**

- src/features/pins/pin-helpers.ts — add `categoryForPlan(text: string): PinCategory | null` beside categoryForPoi (:93-152): a lowercased keyword pass returning 'bar' for drinks/beer/pub/cocktail/rooftop, 'restaurant' for dinner/lunch/breakfast/food/eat/brunch/coffee, 'club' for club/dancing/party/gig, 'hike' for hike/trek/walk/park, 'beach' for beach/surf/swim, 'museum' for museum/gallery/exhibition, 'monument' for temple/wat/palace/ruins, and null for anything else. Null, not 'other', so the caller decides — the existing comment at :95-98 records the founder's rule and this extends it rather than replacing it.

- src/features/pins/pin-form-sheet.tsx:86 — `const category = categoryForPoi(initialPlace?.category)` becomes: use the POI category when it resolves to something other than 'other'; otherwise `categoryForPlan(venue) ?? 'other'`. Because it now reads `venue`, the value updates as the person types, which is what makes the next line honest.

- src/features/pins/pin-form-sheet.tsx:172-175 — the PinGlyph in the place card already renders `category`, so with the change above the marker preview changes live while the plan is typed. Its comment (:173-174) already says the glyph exists so that choosing a category previews the pin you are about to drop; this makes that true for the hand-placed path too.

- src/features/pins/filters.ts:122 — NO change. Making 'other' always pass would turn the Other chip into a no-op and put non-bars on a map filtered to Bar, which is a worse lie than the current one.

- src/features/pins/**tests**/pin-helpers.test.ts:78-97 — extend the categoryForPoi describe block with a categoryForPlan block: the keyword hits, the case-insensitivity, and the null for "Rooftop hello from Maestro"-style text that names no activity.

**Tests.** jest in src/features/pins/**tests**/pin-helpers.test.ts for categoryForPlan, and one case asserting a null POI plus a null keyword match still yields 'other' (so the existing assertion at :91-97 that unrecognised is a real answer rather than a failure still holds). Screenshot evidence: re-shoot 16-pin-posted.png — with a plan reading "Rooftop hello from Maestro" the marker should now carry the wineglass rather than the anonymous mappin.

**Risk.** A wrong guess puts a plan under the wrong chip, where 'other' put it under none. That is a real trade and the reason this carries a founder decision. Keep the keyword list small and unambiguous — "walk" mapping to 'hike' is already borderline, and anything requiring a second thought belongs in the nearby-venue lookup instead. The mitigation that makes it defensible is that the glyph updates live in the place card, so the person sees the marker they are about to drop before they drop it. Note for whoever builds this: when a place came from search, `venue` is pre-seeded with the venue's own name (pin-form-sheet.tsx:64), so the keyword pass runs against a name rather than a plan on that path — which is fine, because that path already has a real POI category and never reaches the fallback.

**Waits on.** Should the app guess a pin's category from the plan text when the map cannot supply one? For: it costs nobody a tap, it honours the no-question rule exactly, and it stops the drag-the-map path producing a pin invisible to every category filter. Against: a guess can be wrong, and a wrong category is arguably worse than an honest 'other' because the person is never told what was inferred. Recommendation: guess, and make the guess visible in the marker preview the sheet already draws. Medium confidence — worth re-reading after the first week of real pins.

### `pin-nearby-venues` — Offer the venues under the placement pin, and take their category with them

**Priority** next · **Effort** L · **Ships as** EAS build

The remaining half of both the naming problem and the category problem is the same missing capability: the app can only name and type a spot when the person typed its name into the search field. 13-place-after-pan.png shows Apple's own POI pills right there on the basemap — On Lok Yun, McDonald's, Wang Lang Market, Big C — and the obvious gesture is to tap one. That gesture cannot be wired: react-native-maps delivers onPoiClick only on the Google provider, and this app is Apple Maps on iOS (basemap.ts QUIET_BASEMAP, PROVIDER_DEFAULT), so the tap never reaches JavaScript. grep confirms no onPoiClick anywhere in src/. The workable version is the native module this repo already ships. Give it a second call and offer the two or three nearest venues as chips above the button, carrying name, address and category into the form exactly the way a searched place does.

<details><summary>Closes 3 audit findings</summary>

- "Pin here" hovers over a spot with no name, then names it one screen too late (second half)

- A pin placed by dragging is always "Other" and disappears under any category filter (the POI half)

- The pin sheet never asks the category, so hand-placed pins file as Other and vanish from filters (the POI half)

</details>

**Changes**

- modules/local-search/ios/LocalSearchModule.swift — add a second AsyncFunction("nearbyAsync") taking latitude, longitude, radiusMeters and limit, built on MKLocalPointsOfInterestRequest(center:radius:) rather than MKLocalSearch.Request, because there is no natural-language query for "what is here". Set pointOfInterestFilter = .includingAll, map results through the existing LocalSearchResult record (:5-15) so name, address, locality, coordinates and pointOfInterestCategory.rawValue all arrive the same shape, hold an `activeNearby: MKLocalSearch?` and cancel it on each new call the way searchAsync already does at :59-62, and keep the whole definition `.runOnQueue(.main)` for the same main-thread-affinity reason recorded at :98-101.

- modules/local-search/index.ts:15-23, :39-56 — widen LocalSearchNativeModule with `nearbyAsync?`, add `export const nearbySearchAvailable = typeof LocalSearch?.nearbyAsync === 'function'`, and export `nearbyPlaces(...)` that returns [] when it is missing. This is the subtle part and the file already explains why (:25-30): this app ships JavaScript over the air to binaries built before a module existed. requireOptionalNativeModule returns the module here — it exists — but the new METHOD is undefined on any build older than this one, so a plain `venueSearchAvailable` check is not enough and would throw on the founder's current TestFlight build.

- src/features/pins/map-screen.tsx:923-943 — on settle in place mode, call nearbyPlaces around the centre with a ~120m radius, reusing the same seq / floor / distance guards pin-place-name-pill installs for the geocode so the two do not each fire on every frame of a pan.

- src/features/pins/map-screen.tsx:1399-1416 — render up to three name chips in the place-mode dock, above the name pill and the confirmBar. Tapping one sets searchedPlace to that LocalSearchResult and moves the placement pin to its coordinate via mapRef.current?.animateToRegion at the current zoom (not flyTo at :868-880, which also changes the zoom). The PLACE_DRIFT_M guard at :934-941 then behaves exactly as it does for a searched place: pan more than 40m away and it stops being that venue.

- src/features/pins/pin-form-sheet.tsx:86 — no further change needed. A tapped chip arrives as `initialPlace`, so categoryForPoi already resolves it and the plan-text fallback from pin-category-from-plan-text only runs when nothing was tapped.

- app.json / eas.json — no config change; the module is already in modules/ and already built into the app. This is a native SOURCE change, which is what makes it a build.

**Tests.** Unit-test the availability guard in a small jest test that mocks the module with and without nearbyAsync and asserts nearbyPlaces resolves [] rather than throwing — that is the OTA-to-old-binary case and it is the one thing a simulator run cannot show you. Everything else is pictures: re-shoot 13-place-after-pan.png with the chip row present, and add a Maestro step that taps the first chip and asserts the pin form's place card now shows that venue's name rather than a reverse-geocoded street. Verify on a device with the real build, not only the simulator, because MKLocalPointsOfInterestRequest results differ by region.

**Risk.** This is the only package in the subsystem that cannot ship over the air, so it should be the thing that justifies the next EAS build rather than a build on its own — batch it with whatever other native work is queued. The optional-method guard is the failure that would actually bite: get it wrong and the founder's existing TestFlight build crashes in place mode the moment an OTA update lands, which is the worst possible way to learn this. MKLocalPointsOfInterestRequest is iOS 14+, comfortably inside the deployment target, but it returns nothing at all in some regions and over water — 13-place-after-pan.png is literally a pin on a river — so the chip row must be absent rather than empty, and the name pill must remain the fallback. Nothing here touches location permissions: the search region comes from the map centre the person chose, exactly as the module's header comment at :24-26 already states for searchAsync.

**Waits on.** Is the pin-drop flow worth an EAS build? For: it is the hero feature, and this is the only fix that makes the drag-the-map path produce a pin as good as the search path — a real name and a real category, with no question asked. Against: builds draw down real Expo credit, and pin-place-name-pill plus pin-category-from-plan-text already close most of the harm over the air for free. Recommendation: yes, but batch it with the next native change rather than spending a build on this alone. Medium confidence.

**After.** `pin-place-name-pill`

### `pin-room-remembers-the-plan` — Give a pin-born chat room the plan it came from

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

Someone taps "Anyone can join" on a rooftop plan for tonight and lands in a room that says nothing about the rooftop, the night, or how long the plan has left. The pin expires in at most 72 hours and the room does not show the clock, so the most time-sensitive fact in the product is invisible in the only place people coordinate. Everything a newcomer needs in order to say a useful first thing was on the previous screen and is gone. The migration that created this shape (20260829120000_a_pin_anyone_can_join.sql:24-32) deliberately lets the chat outlive the pin, which is right — but it means the room has to carry the plan itself while the pin is alive, and say so plainly once it is not.

<details><summary>Closes 1 audit findings</summary>

- A plan's chat room loses the plan the moment you enter it

</details>

**Changes**

- supabase/migrations/<new>\_a_room_remembers_its_plan.sql — add `create function public.pin_for_group(p_chat_id uuid) returns table (pin_id uuid, venue_name text, place_label text, category public.pin_category, intent_date date, expires_at timestamptz, lat double precision, lng double precision)`, SECURITY DEFINER, `set search_path = public`, joining groups to pins on groups.pin_id and gated on `public.is_room_member(p_chat_id)` (20260817200000_establishment_rooms.sql:122). Definer and member-gated on purpose: a joiner is already in the room, so the pin's owner-keyed discovery filter must not hide the plan from them. This is a NEW function, so no drop-function-first is required; still `revoke execute ... from public, anon` and `grant execute ... to authenticated`, and finish with `notify pgrst, 'reload schema'`.

- src/lib/database.types.ts:525-543 — add `pin_id: string | null` to GroupRow. fetchGroup (src/features/groups/api.ts:70-80) already does `select('*')`, so the column is on the wire today and only the type is missing; add the PinForGroupRow shape and its Functions entry too.

- src/features/rooms/api.ts / src/features/rooms/hooks.ts — add fetchPinForGroup + usePinForGroup(chatId), enabled only when the group row carries a non-null pin_id, following the shape of the existing useRoomInfo / fetchRoomInfo pair (api.ts:45, hooks.ts:35).

- src/app/room/[id].tsx:183-210 — this is the correction the audit got wrong. The header that reads "Maestro crew / 1 person here" in 24-group-message.png is here, in the room THREAD, not in src/app/group/[id].tsx, which is the group settings screen (name, photo, who can post, members, leave). Add a non-scrolling card under the header row, gated on the group carrying a pin: PinGlyph for the category, venue name, the intent day, and the burns-out countdown from burnOutLabel(expires_at) — the same helper map-screen.tsx uses, so the room and the pin card can never disagree — plus a "View in Maps" link through the existing openInMaps helper. When pin_for_group returns nothing (the pin expired and groups.pin_id went null, per the migration's ON DELETE SET NULL), render one quiet line saying the plan has ended rather than removing the card, so the room does not silently lose its origin.

- e2e/flows/signed-in-tour.yml — after `- assertVisible: 'Your plan, open to join'` at :131, add a step that taps "Open the chat" and takes a screenshot. The run has never once photographed the pin-born room; the room it does photograph (24-group-message.png, "Maestro crew") is the hand-made group from the 22/23 flow, which is why this defect survived the audit's own evidence.

**Database.** One new migration adding public.pin_for_group(uuid). No existing RETURNS TABLE signature changes, so no drop-function-first is needed here — but restate the revoke/grant pair as this repo does for every function, and end with notify pgrst.

**Tests.** pgTAP in supabase/tests/database/ (next number in sequence, following 26_joinable_pins_and_knowing_people.test.sql): a non-member calling pin_for_group on somebody's room gets nothing; a member gets the row; a member still gets the row when the pin's owner is outside their audience, which is the whole reason the function is definer; and after the pin is deleted the call returns no rows rather than erroring. Then the screenshot of the pin-born room, which is new evidence the suite has never captured.

**Risk.** The temptation is to add pin fields to my_chats or room_info instead of a new function; both are RETURNS TABLE and both would then need drop-function-first plus re-stated grants, which is the deploy failure AGENTS.md warns about. A separate function avoids it entirely. Second risk: the countdown must come from expires_at through burnOutLabel and never be recomputed locally, or the room and the map will disagree about the same pin. Hard rule 3 is unaffected — the room reads the pin's expiry, it does not extend it, and once the pin is gone the room says so rather than continuing to show a stale clock.

### `chat-sent-hello-age-and-withdraw` — Date a hello you sent, and let it be taken back

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

You write a first message to a stranger. They never answer. The row sits under "You said hi" above your real conversations with your words on it, no date, and no way to take it back. Two asymmetries make it worse: inside a chat you CAN unsend a message, so the app has already decided taking words back is legitimate; and the row deliberately never reveals whether the other person declined, read it, or was stopped by moderation, which means "Sent" is indistinguishable at day one and at day ninety. This lives in the chat subsystem rather than in the pin flow — whoever owns the inbox should merge it — but the correction is worth carrying forward intact.

<details><summary>Closes 1 audit findings</summary>

- A hello you sent can never be withdrawn and never expires, so the inbox fills with permanent "Sent" rows

</details>

**Changes**

- src/app/(tabs)/chat.tsx:262-266 — render request.created_at through the existing rowTimestamp() helper (imported at :31, already used at :302) beside the word "Sent" in the trailing column. SentRequestRow already carries created_at (database.types.ts:452-461) and sent_requests() already returns it (20260816200000_trips_matching.sql:618-649), so this half needs no migration at all. It reveals nothing about the recipient and does not touch the promise the comment at :224-228 records.

- supabase/migrations/<new>\_a_hello_can_be_taken_back.sql — add `withdrawn_at timestamptz` to public.message_requests and an RPC that sets it, refusing unless the row is the caller's own and status = 'pending'. Do NOT delete the sender's row: the table carries `unique (sender_id, recipient_id) -- one shot per direction, ever (anti-pester)` (20260816200000_trips_matching.sql:394), and deleting frees that slot, turning one shot into unlimited re-sends at the same person — the exact behaviour the constraint exists to stop — while also destroying the moderation_verdict history for a message that was already delivered.

- supabase/migrations/<same file> — update public.sent_requests() so its CASE emits 'withdrawn' when withdrawn_at is set, and update the recipient-side incoming_requests() so a withdrawn row is no longer served. sent_requests() returns `state text`, so adding a value changes no OUT column and create-or-replace is safe here; check incoming_requests() the same way before writing it, and if either genuinely gains a column, drop function first and re-state the grants. Prefer a timestamptz column over `alter type request_status add value` — enum value additions and the transaction Supabase runs migrations in do not mix well.

- src/lib/database.types.ts:452-461 — widen SentRequestRow's `state` union with 'withdrawn'.

- src/app/(tabs)/chat.tsx:790 — waitingOnThem filters `state === 'sent'`; a withdrawn row should fall out of that section and read "Taken back" wherever it is still shown, rather than vanishing without trace.

**Database.** One new migration: `withdrawn_at timestamptz` on public.message_requests plus a withdraw RPC, and edits to sent_requests() / incoming_requests(). Verify OUT columns before using create or replace; anything that gains a column needs drop function first and its grants re-stated.

**Tests.** pgTAP in supabase/tests/database/, extending the 05_message_requests.test.sql family: withdrawing refuses on an accepted row, refuses on somebody else's row, leaves the unique constraint intact so a second send to the same person is still refused after a withdrawal, and removes the row from incoming_requests for the recipient. jest is the wrong tool here — a mocked Supabase would only prove the mock works. The date rendering is a screenshot of the chat list.

**Risk.** The dangerous version of this feature is the obvious one: delete the row. That silently converts the anti-pester constraint into nothing and is a safety regression, not a convenience. Rules 4 and 5 also bound the UI: the withdrawn row must not become a channel that tells the sender anything about the recipient, so "Taken back" is a fact about the sender's own action and nothing else. The date half is safe on its own and could ship first.

### `chat-room-membership-log` — Record who joined and who left in a group thread

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

A hostel room's defining property is churn: people land, people fly out. With no membership events the header count changes from nine to six and nobody can tell who went, and a group with no origin line reads as a room somebody dropped you into rather than one you were invited to. 23-group-created.png shows a brand-new group whose thread is completely blank. This is chat-subsystem work and should be merged there; it is listed here because it overlaps the pin-born room, whose "this plan has ended" line pin-room-remembers-the-plan places in the header card instead.

<details><summary>Closes 1 audit findings</summary>

- Nothing in a group thread records who joined or left

</details>

**Changes**

- supabase/migrations/<new> — add a 'system' message kind and emit rows on group created, joined via invite, added, left, removed, and end date set or changed. Give them a null sender: these have no author, so they must be exempt from the first-message moderation path (hard rule 5 is about a person's words reaching another person, and a system line has no writer to moderate). Any message-returning RETURNS TABLE function that gains a column here needs drop function first and its grants re-stated.

- src/features/chat/unread.ts — exclude system rows from unread_count, or a hostel check-in wave badges the Chat tab for messages nobody wrote.

- src/app/room/[id].tsx — render system rows centre-aligned at caption size in textTertiary, no bubble, and batch joins inside one hour into "3 people joined" so a check-in wave does not bury the conversation.

- Scope correction worth carrying: this is a churn LOG, not the answer to "who is in this room". src/app/group/[id].tsx:538-580 already renders a full roster with photos, names and roles behind the (i), and the thread header already prints the member count, so the safety argument the finding leans on is overstated.

**Database.** New migration adding a system message kind and the emit points. Check every message-returning function's OUT columns; drop function first and re-state grants for any that widen.

**Tests.** pgTAP that a system row is created on join and on leave, that it carries a null sender, and that it does not count toward unread_count. Then a screenshot of a group thread with a join and a leave in it, since this is entirely a question of whether the thread still reads as a conversation.

**Risk.** Unread counting is the trap: get it wrong and the tab badge counts events nobody sent. The moderation exemption has to be written deliberately and commented, or a later reader will read it as a hole in rule 5 rather than as a row with no author.

### `admin-liquidity-reach-and-history` — Make the liquidity number countable and keep its history

**Priority** later · **Effort** M · **Ships as** Supabase deploy only

The brief calls this THE metric and gates opening a second city on it, and the view answers two questions badly. admin_liquidity (20260817150000_launch_hardening.sql:434-455) unions users with a live pin and users with an active trip, and a trip can be posted weeks ahead and run for weeks, so somebody who installed once, posted a trip and never came back counts toward a city's liquidity for the whole window. And it is a gauge with no trend: there is no snapshot table anywhere in supabase/migrations, and pins hard-delete within 15 minutes of expiry by design (rule 3), so the history cannot be reconstructed later. This is admin-subsystem work, listed here because it was assigned; it touches nothing in the pin flow except by reading pins.

<details><summary>Closes 1 audit findings</summary>

- The liquidity number counts users who may never open the app again, and has no history

</details>

**Changes**

- supabase/migrations/<new> — add `last_seen_on date` to public.profiles, written at most once per day by an RPC the app already calls on launch. Day granularity only, no time, no location: state that in the migration comment so a later reader does not mistake it for a rule 2 concern.

- supabase/migrations/<same file> — add a `liquidity_reachable` column to admin_liquidity counting users who additionally have last_seen_on within 7 days. A view is replaced, not a function, so the drop-function-first rule does not apply — but `create or replace view` cannot reorder or drop existing columns, so append the new column at the end or drop and recreate the view and re-state its `revoke all ... from anon, authenticated`.

- supabase/migrations/<same file> — add a `liquidity_daily` snapshot table (city_id, day, users_with_live_pin, users_with_active_trip, liquidity, reachable) written by a nightly pg_cron job alongside the jobs already scheduled in launch_hardening. Daily aggregate counts retain no pin and no location, so rule 3 is untouched; say so in the comment.

- docs/DASHBOARD.md — the file already maps each §6 metric to its source; add the two new columns and the snapshot table.

**Database.** New migration: profiles.last_seen_on, a once-a-day touch RPC, a widened admin_liquidity view, a liquidity_daily table and its nightly pg_cron job. Views replace rather than drop-function; re-state the revoke on any view you recreate.

**Tests.** pgTAP: the touch RPC writes at most once per day and cannot be called for another user; admin_liquidity and liquidity_daily remain unreadable to anon and authenticated; a user whose last_seen_on is eight days old counts in liquidity but not in liquidity_reachable. No client-side test is meaningful here.

**Risk.** last_seen_on is a new fact stored about a person, so it needs the founder's explicit yes even though it is not location data. Keep it to a date and never a timestamp: a per-minute last-seen is a presence signal, and presence is one short step from the live-location promise the product is built on refusing. The snapshot job must store counts only and never rows.

**Waits on.** Should the app record a day-granularity last_seen_on per profile? For: without it the 500-1,000 liquidity gate can be met by people who will never answer a hello, and the decision it blocks — when to open a second city — is the most expensive one in the plan. Against: it is a new fact stored about a person in an app whose pitch is that it stores as little as possible, and 'last seen' is a phrase with baggage even at day granularity. Recommendation: add it, keep it to a date, never surface it to another user, and say plainly in the migration comment why it is not a rule 2 concern. Medium confidence.

## The map as a browsing surface: markers, clusters, camera, filters, heat, empty cities

Seventy-five findings land on one screen, and they collapse into four real problems. First, the map cannot answer its own marketing sentence: there is no list of what is on, no time on any marker, and the camera never frames the pins it has, so a city with twelve plans in it opens looking abandoned. Second, the marker vocabulary has drifted from the vocabulary everywhere else — Apple's own orange POI discs sit beside ours, a two-pin cluster draws as three circles, your own pin is indistinguishable from a stranger's, and the filter sheet labels the same eight categories with colour emoji including a red pushpin. Third, the heatmap the brief calls the differentiator draws nothing in three of four launch cities by arithmetic, has no label when it is empty, no error path when it fails, and a metric that reports success for a layer that has drawn zero pixels. Fourth, a business account opens on a map of the wrong continent with no button on it, and every traveler opens on Bangkok forever. What the founder is really deciding here is whether the map earns its place as the hero screen or stays a pretty background: the list, the camera fit and the honest heat states are the three that decide it, and none of them needs a new query or a paywall. Almost all of this ships over the air; four packages carry a migration, and one of those is a plain column add.

### `map-pin-title-one-voice` — One function decides a pin's title, and addresses stop clipping

**Priority** now · **Effort** S · **Ships as** over the air

The same pin is called two different things depending on where you meet it. The card headlines the venue, the cluster row headlines the plan text, and the hero variant headlines the plan text over the venue — so tapping a stack, reading a row, and opening it gives you two names for one object. Separately, the card truncates the venue and the address to one line, which is the exact bug the pin form already paid for and fixed with a comment naming this Bangkok address. A person deciding whether to walk somewhere is reading a clipped street name.

<details><summary>Closes 3 audit findings</summary>

- The same pin gets three different titles depending on who is looking at it

- The pin card truncates the address to one line, the exact bug already fixed in the form

- Avatar initials are cut with charAt(0), which splits a surrogate pair and renders a broken glyph

</details>

**Changes**

- src/features/pins/pin-helpers.ts — export `pinTitle(pin)` returning `pin.venue_name` and `pinSubtitle(pin)` returning `pin.note?.trim() ?? null`. One function, so the answer cannot drift again, and so the venue/plan column split can change the definition in one place later.

- src/features/pins/map-screen.tsx:174 — hero title renders `pinSubtitle(pin) ?? pinTitle(pin)`; the footnote under it at :207 renders `pinTitle(pin)`. Layout unchanged, decider changed.

- src/features/pins/map-screen.tsx:202 — non-hero headline renders `pinTitle(pin)`; the body at :252 renders `pinSubtitle(pin)`.

- src/features/pins/map-screen.tsx:1615 — venue-stack row title renders `pinSubtitle(pin) ?? pinTitle(pin)`, matching the hero so a row and the card it opens agree.

- src/features/pins/map-screen.tsx:202, :207, :215 — numberOfLines 1 → 2, matching pin-form-sheet.tsx:184 and its comment. Leave :1614 (the row's plan line) at 1; lift :1617 to 2 only if it is showing a venue name.

- src/features/pins/map-screen.tsx:517 — CrewFace initial: `(person.display_name ?? '?').slice(0,1)` → `Array.from((person.display_name ?? '?').trim())[0] ?? '?'`, so a name starting outside the BMP does not render a lone surrogate in a 28pt disc. The other three sites of this bug (avatar-button, travelers, add-people) belong to other subsystems.

**Tests.** Jest in src/features/pins/**tests**/pin-helpers.test.ts: pinTitle returns venue_name for a pin with and without a note; pinSubtitle returns null for an empty/whitespace note; Array.from on an emoji-leading name yields one whole grapheme. Screenshots: re-shoot 16-pin-posted and confirm the full 'Somdet Phra Pokklao Bridge, Wang Burapha Phirom' reads over two lines.

**Risk.** Low. The only visible change is the hero and the stack row agreeing, plus two-line addresses making the card taller — check the card at large Dynamic Type so the two extra lines do not push the primary button off a small phone. Do not use these helpers to change what the compose draft interpolates; that string is fixed by the venue/plan split, not here.

### `map-filter-glyphs-retire-the-emoji` — The filter sheet draws the markers it filters, and the old pin screen goes

**Priority** now · **Effort** M · **Ships as** over the air

The filter sheet labels eight categories with colour emoji while the map draws the same eight as monochrome glyphs on amber discs, so the picker and the thing it picks do not share a vocabulary — and two of them actively contradict the map, where Museum is a columned building and Sights is a camera. It also puts a saturated red pushpin on screen, in an app whose palette bans red. The reasoning against emoji is already written in pin-form-sheet.tsx; the filter sheet is the last place it did not land, and a second, older pin-creation screen is the reason the emoji field cannot simply be deleted.

<details><summary>Closes 4 audit findings</summary>

- The Filters sheet labels plan types with emoji, including a red pushpin, and two of them contradict the map

- The filter sheet uses colour emoji for the same eight categories the map draws as glyphs

- Map filter and pin categories use full-colour emoji, including a red pin, in an app that is otherwise strictly SF Symbols

- A second, older pin-creation screen still ships, with the vocabulary the map has moved on from

</details>

**Changes**

- src/features/pins/map-filter-sheet.tsx:201 — replace `label={`${category.emoji}  ${category.label}`}` with a chip that renders `<PinGlyph category={category.value} size={18} />` beside `category.label`. Chip already takes a label; give it an optional `leading?: ReactNode`. Keep `testID={`filter-category-${value}`}` (map-filter-sheet.tsx:256-262 records that run 72 failed on the emoji-prefixed label, and e2e/flows/guest-tour.yml:82 selects by that id) and set accessibilityLabel to the plain category name so VoiceOver stops saying 'cocktail glass Bar'.

- src/features/pins/pin-marker.tsx:241 — PinGlyph already takes a size; no change needed, it is exported and already used by pin-form-sheet.tsx:175 and map-screen.tsx:197.

- src/features/pins/pin-helpers.ts:4-22 — delete the `emoji` field from PIN_CATEGORIES, and delete `SEEDED_EMOJI` and `categoryEmoji` once the two remaining consumers below are gone.

- src/app/drop-pin.tsx — delete. It builds `${c.emoji} ${c.label}` labels, uses duration chips instead of the hours slider, and calls createPin with no `joinable`, so hooks.ts:485 takes the non-joinable branch and nothing it creates can ever open a group chat. It is a second species of the same row.

- src/app/\_layout.tsx:290 — delete the `<Stack.Screen name="drop-pin">` registration. This is the line that actually closes the route; it is registered for every platform, so it is deep-linkable on iOS today.

- src/features/pins/map-screen.web.tsx:11,47,57-60 — drop the `categoryEmoji` import and render `<PinGlyph category={pin.category} seeded={pin.seeded} size={20} />` in the row; remove the 'Drop a pin' button and replace it with one line saying pin creation is on the phone. The file's own header comment already says web is a dev convenience.

**Tests.** Jest: a render test for the category chip asserting the chip's accessibilityLabel is exactly 'Bar' and that no chip label contains a non-ASCII character (grep-style assertion over PIN_CATEGORIES). E2E: guest-tour.yml already taps `filter-category-bar` and asserts 'Filters, 1 on' — it must stay green unmodified, which is the proof the testID contract held. Screenshots: re-shoot 05a-map-filters and 05b-map-filters-on and confirm the red pushpin is gone and Museum/Sights carry the same glyphs the map draws.

**Risk.** Deleting drop-pin.tsx removes the only pin-creation path on web; that is intended, but confirm nothing else routes to '/drop-pin' (grep before deleting — location-picker is mounted from business-signup and business-edit too and must survive). If the founder wants a web creation path kept, it must set `joinable` and use PIN_CATEGORIES glyphs, or web-created pins stay a second, unjoinable species.

### `map-picker-never-draws-apples-red` — The location picker draws our marker, at a zoom that can answer its own question

**Priority** now · **Effort** S · **Ships as** over the air

LocationPicker mounts a bare `<Marker>` with no child and no pinColor, so MapKit draws its default red-coral balloon — the one colour §7 bans as a UI colour, on the screen that asks a business owner to confirm the marker travelers will tap. It is also the wrong object: an owner drags a red balloon and gets a navy chip. And the address step passes no `delta`, so the picker defaults to 0.06 — roughly seven kilometres of Lisbon — under the instruction 'check the marker is on your door'. The component's own comment already says a city-wide map cannot answer that question.

<details><summary>Closes 3 audit findings</summary>

- The location picker draws a red pin, the one colour §7 bans

- The business signup map draws Apple's default red pin, which rule 7 bans

- "Check the marker is on your door" is asked over a map showing seven kilometres of Lisbon

</details>

**Changes**

- src/features/pins/location-picker.tsx:172-181 — add an optional `marker?: ReactNode` prop rendered as the Marker's child, with `anchor={{x:0.5,y:0.5}}` to match business-marker.tsx's CHIP_ANCHOR so the chip does not sit half a chip off the door. Keep `draggable` and `onDragEnd` exactly as they are.

- src/features/pins/location-picker.web.tsx — mirror the new prop so the web stub still typechecks.

- src/app/business-signup.tsx:418 and :490, src/app/business-edit.tsx:1161 — pass `marker={<PlaceGlyph category={category} />}` from src/features/business/business-marker.tsx, so 'Is this right?' previews the chip a traveler will actually tap.

- src/app/business-signup.tsx:418 — pass `delta={0.004}` once the address geocodes (business-edit.tsx:1171 and the confirm step at :490 already do), and animate to the geocoded result rather than staying on the city centre. When nothing geocodes, stay at the city delta and keep the existing 'Tap the map to drop your marker.' copy at location-picker.tsx:184.

- src/features/pins/location-picker.tsx:194-198 — raise the map from `height: 220` to about 280 on the placement step; 220pt is small for a drag task.

**Tests.** Jest render test on LocationPicker asserting the rendered Marker has children (a bare Marker is legal in react-native-maps, so this is an assertion rather than a lint rule). Screenshots: re-shoot 44-business-address-and-marker, 45-business-where-final and 46-business-confirm and confirm no red is on screen and the marker is the navy chip.

**Risk.** Two findings said 'the cheapest fix is pinColor={theme.highlight}' — do not take it. Amber is the traveler-pin signal and would be wrong on a business screen. Also check the drag hit target: a 26pt chip is a smaller grab handle than MapKit's balloon, so verify a drag still starts reliably in the simulator before calling it done.

### `map-curated-pins-drop-the-em-dashes` — Rewrite the curated pin notes and the moderation push in the app's own voice

**Priority** now · **Effort** S · **Ships as** Supabase deploy only

The design brief bans em dashes in anything the app shows, and the sweep concluded they survive only in code comments. That is true of src/ and false of the database. seed_launch_pins() is the live curated-pin seeder, it re-runs daily, and all sixteen of its twenty pins that have a note carry an em dash. Those are the pins a brand-new user taps on the hero screen before any real traveler has posted anything, so they are the app's voice on day one. The moderation refusal push carries one too, in the single most sensitive notification the app sends.

<details><summary>Closes 1 audit findings</summary>

- Thirteen of the sixteen curated day-one map pins contain an em dash, and so does the moderation push

</details>

**Changes**

- supabase/migrations/<new>\_curated_pins_say_it_plainly.sql — `create or replace function public.seed_launch_pins()` (same signature, same integer return, so no drop-function is needed — AGENTS.md's drop-first rule is about OUT columns) with all sixteen notes rewritten: 'Open-air market under the bridge. Travelers meet at the main gate, 7pm.', 'Classic sunset spot. Bring a drink, everyone talks to everyone.', 'Chinatown after dark. Come hungry, leave in a food coma.', 'Train from Cais do Sodré. Surfers and swimmers both welcome.', 'Meet at the clock tower, section 26 for vintage, then coconut ice cream.', and the eleven others in the same register. Restate `revoke all on function public.seed_launch_pins() from public, anon, authenticated;`.

- Same migration — redefine `public.apply_message_verdict` (defined at 20260820001000_copy_pass.sql:109, last definition; 20260821120000 only redefines apply_strike_policy and admin_resolve_report) with the push body at :190 rewritten to 'Your message wasn't delivered. It came across as explicit. Reword it and it goes straight out.'

- supabase/seed/launch_pins.sql:13-51 — same rewrite, so the manual seed and the scheduled function do not disagree.

- scripts/ (or the existing pre-push gate) — add an em-dash check scoped to SQL string literals in supabase/migrations/_.sql and supabase/seed/_.sql, not to whole files. Fifty-six lines across the migrations contain an em dash and most are SQL comments the brief permits; a naive grep gate gets disabled within a week.

**Database.** One migration recreating seed_launch_pins() and apply_message_verdict with rewritten copy. Both keep their signatures, so create-or-replace is correct; restate the revoke on seed_launch_pins anyway.

**Tests.** pgTAP in supabase/tests/database/06_pins_heatmap.test.sql (or a new 30_copy_is_ours.test.sql): call seed_launch_pins() and assert `select count(*) from pins where seeded and seed_note like '%—%'` is zero. Assert the same over the push_queue body written by apply_message_verdict on a blocked verdict. Screenshots: re-shoot 16-pin-posted after a seeded pin is tapped.

**Risk.** Superseded definitions do not need rewriting — trust_safety.sql:489 and the older seed_launch_pins in 20260818010000 are dead, and sweeping them balloons the change for no user-visible gain. The scoped gate is the part that can go wrong: make it precise enough that it never fires on a comment, or it will be turned off.

### `map-marker-vocabulary` — Make our markers unmistakable: a silhouette Apple never draws, one disc per photoless cluster, a ring on your own pin

**Priority** now · **Effort** M · **Ships as** over the air

A first-timer cannot tell in five seconds which orange thing is a person's plan and which is Apple's opinion of a restaurant: PIN_AMBER sits a few tens of points from Apple's own orange fork-and-knife disc at the same size and hue, and the 11pt tail is the only distinguishing mark. At launch density nobody has a profile photo, so every two-pin cluster degrades into two identical category glyphs plus a badge — three circles for two plans, wide enough to clip at the screen edge, with both faces borrowing the first pin's category. Your own pin, the one affirming act on this screen, stops being yours the moment the card closes. And nothing on the marker says when any of it is.

<details><summary>Closes 7 audit findings</summary>

- Every marker is the same orange disc, and Apple's own POI icons are in the same palette

- A two-pin cluster draws as three separate discs and shows one category for both plans

- A two-pin cluster draws two identical glyphs plus a badge reading "2"

- Your own pin is indistinguishable from a stranger's on the map

- Fixed-height marker and dock chrome will clip at large Dynamic Type

- The map's Drop a pin pill and the segmented control's badge are fixed-height boxes around scaling text

- Nothing on the map says when any plan is. The date only exists inside a tap.

</details>

**Changes**

- src/features/pins/pin-marker.tsx:300 — lengthen TAIL from 11 to 16 and narrow it into a teardrop neck, so the marker reads as a dropped pin rather than a badge. Apple's POI marks are always flat discs; the silhouette is the differentiator the hue cannot be.

- src/features/pins/pin-marker.tsx:58 — MARKER_CENTER_OFFSET is a hardcoded {x:0,y:-20} encoding BODY+TAIL geometry. Derive it from BODY and TAIL so it moves with the tail, or every pin tip drifts off its venue. PinStackView and CityCountView share the same anchor and must be checked.

- src/features/pins/pin-marker.tsx:174-201 (PinStackView) — branch on how many entries in `shown` actually resolved to a URL. Zero photos: draw ONE 36pt disc carrying the category glyph plus the 22pt count badge, matching the single-marker silhouette. One or two: draw those faces plus the badge. Three: the current overlap. Never change how many hooks ClusterMarker calls — map-screen.tsx:645-650 deliberately calls usePhotoUrl exactly three times whatever the cluster holds. While there, fix or delete the stale 'Nulls become the anonymous silhouette' comment at :159, which the code no longer does.

- src/features/pins/map-screen.tsx:648-671 (ClusterMarker) — pass the cluster's DOMINANT category, not `cluster.pins[0].category`; where categories differ pass a new neutral entry. CATEGORY_GLYPHS has no neutral today, so add one using the same `mappin` the dock uses.

- src/features/pins/pin-marker.tsx:60-77 — add `own?: boolean` to PinMarkerViewProps and wrap the body in a 2pt concentric `theme.accent` ring INSIDE the existing 4pt wrap padding, so nothing moves off its coordinate. This is business-marker.tsx:115-137's own-ring pattern, already argued and shipped in this codebase.

- src/features/pins/pin-marker.tsx:60-77 — add `intentDate: string`. Draw today's markers at full PIN_AMBER and later ones at about 75%; cap the ramp at two steps, because 45% amber on this basemap drops the marker under the legibility floor. On a mixed-day stack, soonest day wins. This is the secondary channel; the list package carries the primary one.

- src/features/pins/map-screen.tsx:592 and :652 — `own` and `intentDate` must both go into the useMarkerTracking key, or the ring and the opacity are missing from the frozen bitmap. Pass `pin.user_id === ownUserId` from CityPinMarker using useOwnUserId, which map-screen.tsx already imports at :76.

- src/features/pins/pin-marker.tsx:340-380 — `allowFontScaling={false}` on stackCountText, cityName and cityCount. Marker artwork is cartography, not body text, and MapKit's own labels behave this way; today a '2' scales inside a badge that cannot, on a view that is then frozen as a bitmap.

- src/features/pins/map-screen.tsx:1889 and :1394 — dockButton `height: 52` → `minHeight: 52` with `paddingVertical: Space.sm`, and replace the raw `<Text style={styles.dockLabel}>` with `ThemedText type="callout"` so it inherits the role instead of copying the size. crewFace (map-screen.tsx:1794) gets `minHeight`/`aspectRatio` rather than frozen text — it is card chrome, where the accessibility argument cuts the other way.

**Tests.** Jest render tests on PinStackView: zero faces renders one disc and one badge; two faces renders two discs and one badge; a mixed-category cluster renders the neutral glyph. Jest on the dominant-category helper in cluster.ts. Screenshots are the real evidence here: re-shoot 02-map-tab, 28-map-with-places and 16-pin-posted and check (a) no cluster is three circles wide, (b) the hike cluster at the right edge is no longer clipped, (c) our markers are separable from Apple's POI discs at a glance, (d) the own pin carries a blue ring. Add one screenshot pass at AX3 to the simulator suite for the dock and the count badge.

**Risk.** Two traps. The centre offset is the one that silently breaks everything: change the tail without deriving the offset and every pin lands 5pt off its venue, which looks like nothing and is wrong on every marker. And anything added to a marker that is not in the tracking key simply never paints, because the view is a frozen bitmap — that is what the useMarkerTracking comment at pin-marker.tsx:271 exists to say. Do not touch PIN_GOLD's meaning here: the honest case against gold is that it is barely separable from amber at 36pt, not that Apple stars its own POIs in the same colour (it does not — its star mark is lavender).

**Waits on.** Retire PIN_GOLD for curated picks, or keep it? Gold and amber are barely separable at 36pt on a warm basemap, so a curated pick currently reads as a traveler pin with a star in it. Against changing: gold is a recorded two-colour decision and the filter sheet already names 'Samewhere picks' as a family.

### `map-camera-frames-its-data` — Fit the camera to the pins, cluster by screen distance, and give a panned-away map a way home

**Priority** next · **Effort** M · **Ships as** over the air

Every city opens at the same hardcoded 0.09-degree box on the city centroid and is never re-fitted. In Bangkok the markers occupy the middle third of the frame while Bang Kruai, Chom Thong and Yan Nawa fill the rest with empty basemap; applying a filter does not re-frame either, so narrowing the map makes it feel emptier than the data warrants. Clustering compounds it: the 30m venue radius is right for its stated problem and takes no account of screen space, so at this zoom two venues 400m apart overlap into one orange mass with one tap target. And drag east from Bangkok and every marker scrolls off, with no card and no discoverable way back — tapping the already-selected city chip does recentre, but nobody would guess a selected chip is a button.

<details><summary>Closes 5 audit findings</summary>

- The map camera is a fixed 0.09-degree box on the city centroid, so a thin city looks abandoned by construction

- The map never frames its own pins, so a city with plans in it opens looking empty

- Pan away from the launch city and you get a blank map with no pins, no message and no way back

- Opening a pin card does not move the map, so the pin can end up under its own card

- Clustering is venue-only at every zoom, so markers collide into an unreadable smear

</details>

**Changes**

- src/features/pins/map-screen.tsx — add a `fitToPins()` helper calling `mapRef.current.fitToCoordinates` over the filtered pin and business set, with edgePadding clearing the city rail on top and the dock on the bottom, clamped between a minimum span of 0.012 (the value flyTo already uses at :871) and the existing 0.09 maximum. Call it on city select (inside selectCity at :810), on first data arrival after pinsQuery settles, on filter change, and after the `setFilters(DEFAULT_FILTERS)` reset in onPosted at :1427 so a fresh pin is framed with its neighbours.

- src/features/pins/map-screen.tsx — gate fitToPins on `mode === 'browse' && !selectedPinId && !venueKey && !selectedPlaceId && !cityScale`. It must not fight the pin-select nudge at :1072, which deliberately offsets the camera so the card clears the marker, and it must not fire while CityScaleMarker is the intended aggregate view.

- src/features/pins/map-screen.tsx:1068-1079 — extract the existing nudge into a local `nudgeAbove(lat, lng)` and call it from the cluster onPress at :1046 and the BusinessMarker onPress at :1027 too, so all three cards behave alike. Add the guard the pin path also lacks: skip the animation when the marker is already north of the region centre.

- src/features/pins/cluster.ts — add a second pass, `clusterByScreen(clusters, region, screenWidth)`, run over clusterPins' output: merge clusters whose on-screen separation is under about 44pt into a plain count bubble, which splits on tap by animating to a tighter region. Feed it `lastRegion.current`, already tracked at map-screen.tsx:924. Keep clusterPins as the venue pass, untouched and separately tested.

- src/features/pins/map-screen.tsx — add a 'Back to Bangkok' pill above the dock, shown when `metersBetween(lastRegion.current, activeCity.cities)` exceeds a few kilometres (metersBetween is already exported from cluster.ts:23). It reuses the 0.09 delta so the camera lands where the city chip lands. Suppress it while `mode !== 'browse'` and while any card is open.

- src/features/pins/map-screen.tsx:1298 — the empty banner also fires on 'no pins in the current viewport', with the copy 'No plans over here. Bangkok's are back that way.' Debounce on onRegionChangeComplete or it flickers on every pan.

**Tests.** Jest in src/features/pins/**tests**/cluster.test.ts: clusterByScreen merges two clusters 20pt apart at a 0.09 delta and leaves them separate at 0.01; the venue pass output is unchanged by the screen pass at high zoom. Jest on the fit-span clamp (a single pin yields 0.012, a city-wide set yields 0.09). Screenshots: re-shoot 02-map-tab and 05c-map-filtered and confirm the pins fill the frame and the filtered map re-centres on what survived. E2E: add a pan step to guest-tour.yml and assert the 'Back to Bangkok' pill's spoken label appears.

**Risk.** Re-fitting on filter change plus the marker-select nudge is the collision to watch: if both fire, the camera fights itself and the card lands over the marker again. The gate on `!selectedPinId` is what prevents it and must be verified in the simulator, not reasoned about. The screen-space pass changes cluster keys as the camera moves, which will re-mount markers on every zoom step — key the merged bubble on its member ids sorted, not on the region, or markers flash on every pinch.

### `map-plan-list` — A draggable list of what is on in this city, under the map

**Priority** next · **Effort** L · **Ships as** over the air

Discovery is strictly marker by marker. To find out what is happening in Bangkok you pan, spot amber discs against Apple's own orange POI icons, tap each one, read the card, close it, repeat. There is no count, no ranking, no scanning, and no answer to the sentence the brief sells the product on. At launch density this is the whole difference between alive and dead: eleven pins on a city-wide map look like nothing, and eleven rows saying 'Sunset drinks at Sky Bar, tonight, 2 going' look like a scene. It also gives the day somewhere to live, gives the heat somewhere to be explained, and turns a business's live post from a slightly warmer ring into a row somebody reads.

<details><summary>Closes 3 audit findings</summary>

- There is no list of what is on in the city, anywhere in the app

- There is no list on the map, so discovery is hunting orange dots at 10km zoom

- A business's live post only brightens a marker ring, so "what travelers are doing tonight" is undiscoverable without tapping every chip

</details>

**Changes**

- src/features/pins/map-screen.tsx — a new `<PlanList>` bottom sheet rendered over the map at three detents. Peek (~90pt): a grab handle and one line, '11 plans in Bangkok · 4 today'. Half: a scrollable grouped list. Full: list only. Build the rows from the `clusters` array already in memory (map-screen.tsx:777) via clusterPins/clusterTitle, so two plans at one bar are one row and no new query is added.

- New file src/features/pins/plan-list.tsx — the sheet and its rows. Sections are Tonight / Tomorrow / <weekday>, from `intentLabel`. Each row: category glyph, pinTitle/pinSubtitle from the title package, venue, day, burn-out countdown, join count, and an 'open to join' mark. NO display_name and NO avatar for any viewer: a guest's and a business's feed come from public_city_pins with identity stripped (src/features/guest/hooks.ts:76-85), so a row that assumed a name would degrade to nothing for two of three account kinds. Row content is the same for everyone, which is also the simplest thing to keep honest.

- src/features/pins/plan-list.tsx — a second section for businesses with `has_live_post` from the `places` array already loaded by useCityBusinesses (map-screen.tsx:712), headed 'On tonight'. Rows deep-link to the existing PlaceSheet. Branch the whole list on account kind: a business account sees only its own posts and the faceless traveler-plan rows, never a traveler directory (§7 rule 8, and the rule quoted at src/features/business/hooks.ts:52-55).

- src/features/pins/map-screen.tsx — tapping a row calls the existing `setSelectedPinId` path at :1065 including its camera nudge, so the list and the marker card stay one selection model. Panning the map re-sorts rows by distance from centre, using metersBetween.

- src/features/pins/map-screen.tsx — the list collapses to its peek whenever the pin card, the venue stack, MapFilterSheet or PlaceSheet opens, and never covers the 'Drop a pin' dock at :1373. Those four sheets plus the empty banner and the legend chips all present in that same slot today; the list is the sixth thing there and has to yield to all of them.

- src/features/pins/plan-list.tsx — the peek line reads from the same filtered `pins` array the markers do, or it will say '11 plans' over a map showing two.

**Tests.** Jest render tests on PlanList: rows carry no display_name for any viewer; a business viewer sees no traveler-identity fields; the peek count equals the filtered pin count; day grouping puts a pin whose intent_date is today under 'Tonight'. E2E: a new step in guest-tour.yml expanding the sheet and tapping a row, asserting the pin card opens. Screenshots: 02-map-tab re-shot with the peek visible, plus a new shot of the expanded list — this is a design change and the pictures are the only thing that answers whether it works.

**Risk.** This is the largest package here and the one most likely to collide with the map's existing bottom furniture. The traps skill is explicit that a Slide entrance freezes the frame it snapshotted, so the sheet must slide on a translateY in useAnimatedStyle the way components/ui/sheet.tsx does — do not reach for SlideInDown. Wording: rows and headings say 'business', never 'place' for a venue (the founder overturned the softer word on 2026-08-28), and a pin carries a date but no time, so the heading is 'Today', not 'Tonight', until the intent_time package lands.

**Waits on.** Does the list ship at the peek detent by default, permanently occupying about 90pt of the map? Against: the map is the hero and every point of it is content. For: a peek that has to be discovered is a list nobody finds, and the peek line is the only place the city's plan count is ever stated.

**After.** `map-pin-title-one-voice`, `map-camera-frames-its-data`

### `map-heat-says-what-it-is` — Give the heat layer a name, an honest empty state, and a metric that means something

**Priority** next · **Effort** M · **Ships as** over the air

The brief calls the anonymized heatmap the differentiator and the marketing hook. On the app's default city it draws nothing, in every screenshot from the last run — and the one sentence explaining it is gated on `heatCells.length > 0`, so the explanation only exists once the thing being explained is already visible. There is no error path either: if public_heat_cells fails, times out, or the launch city row is inactive (the function returns silently), the map draws no glow and says nothing, which is identical to a genuinely quiet city. Choosing a day filter makes it worse, because the k-threshold is then evaluated against a third of the pins, so the layer disappears exactly when somebody is trying hardest to use it. And `heatmap_rendered` fires when heat DATA arrives, not when a person sees anything, so the founder metric would read healthy for a feature that has drawn zero pixels.

<details><summary>Closes 6 audit findings</summary>

- The heatmap does not render in the default city, and the app has no way to say so

- The heat query has no loading or error path, so a failed heatmap and a quiet city are indistinguishable

- Choosing a day filter silently destroys the heat layer, punishing the most engaged users

- The heatmap, the stated differentiator, is undiscoverable when it happens not to be on screen

- The heatmap, the product's stated differentiator, renders in none of the 94 screenshots

- heatmap_rendered measures data arrival, not a view, and would report engagement with a layer that draws nothing

</details>

**Changes**

- src/features/pins/filters.ts:104,128 — add 'heat' to MarkerKind and to ALL_MARKER_KINDS, and a `showsHeat(filters)` predicate beside showsBusinesses. Client-side rendering only: it must never touch the k-threshold or the server query.

- src/features/pins/map-filter-sheet.tsx:33-78 — a fourth 'What to show' row, 'Busy areas', subtitle 'Where plans are clustering. Never shown unless enough people are in on it, and never anyone's name.' Visible even when the layer is empty, which is exactly when somebody needs to know it exists. Verify the sheet at maximum height with Dynamic Type up; the file's own comment at :401-403 warns a fourth group can push Done off a small phone.

- src/features/pins/map-screen.tsx:703 — read `isError` and `isPending` off the heat query, not just `data`. On error, extend the existing glass banner at :1281 with one footnote line and a Try again, reusing the LoadError compact form rather than adding a fourth element to that strip.

- src/features/pins/map-screen.tsx — an honest third state on the legend: when the query has SETTLED and `heatCells.length === 0`, say so. Read the number from `activeCity.heat_k` (already selected by api.ts:21) or write the sentence with no number in it: 'Not busy enough to show yet. A few people have to be planning the same area.' Gate on a settled query, not the initial state, or the message flashes on every city switch.

- src/features/pins/map-screen.tsx:703 — call useMapHeat twice, once with `filterISO` and once with null. When the day-filtered result is empty and the unfiltered one is not, draw the all-days layer and render the footnote 'Busy areas shown across the next three days' in the same branch. The fallback may never appear unlabelled, and never through the one-shot dismissible legend, which is dismissed forever after one read.

- src/features/pins/map-screen.tsx:790-794 — delete `heatmap_rendered` and replace it with `heatmap_viewed`, fired once per city per session on actual visibility: layer mounted, non-empty, map not covered by a sheet and not in place mode. Keep `cells` as an aggregate count. If a data-arrival event is wanted for debugging, name it `heat_loaded` so it can never be mistaken for a view.

- src/components/ui/build-stamp.tsx precedent — add a debug-only line reporting cells returned for the active city and date, behind the same build gate. Print the city's cell COUNT only; never a per-cell population below heat_k.

**Tests.** Jest in src/features/pins/**tests**/heat.test.ts and filters.test.ts: showsHeat defaults on; the day-fallback selector returns the unfiltered set only when the filtered set is empty and the unfiltered is not. Jest on the heatmap_viewed guard (does not fire while a sheet is open, fires once per city). Screenshots: 05a-map-filters re-shot with the fourth row, and a shot of the empty-heat legend state — which today is the state every launch city except Lisbon is in, so it is the one that actually ships.

**Risk.** Rule 6 is the thing to not break. The 'Busy areas' toggle only stops the client drawing cells the server already thresholded; it must not become a parameter to heat_cells. The all-days fallback is inside rule 6 (those cells cleared k for their own pool) but only while it is labelled — an unlabelled fallback reports 'busy tomorrow' from a pool that is not tomorrow's. And the debug cell count must never print a below-threshold cell's population in a user-visible build.

**After.** `map-filter-sheet-shows-the-result`, `map-one-message-slot`

### `map-heat-has-something-to-show` — Re-seed the curated pins by district so a heat cell can actually clear k

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

A heat cell needs heat_k distinct posters inside a 0.005-degree square, and heat_k is 3. Bucketing the twenty curated seed coordinates: Lisbon's Time Out Market, Pensão Amor and Miradouro de Santa Catarina all land in cell 38.705/-9.150, so Lisbon gets exactly one glow. Bangkok, Mexico City and Denpasar have no two curated pins in the same cell, so at launch density they get nothing, ever. The layer the brief calls the marketing hook is absent by arithmetic, not by accident, and the fix is supply and honesty, never lowering k.

<details><summary>Closes 2 audit findings</summary>

- The heatmap, the product's stated differentiator, renders in one launch city and has never appeared in a screenshot

- The heatmap, the product's stated differentiator, renders in none of the 94 screenshots

</details>

**Changes**

- supabase/migrations/<new>\_curated_pins_cluster_by_district.sql — `create or replace function public.seed_launch_pins()` with the seed list re-written by neighbourhood rather than by landmark: three or four pins inside one cell per nightlife district (Bairro Alto, Cais do Sodré; Khao San, Thonglor, Chinatown; Roma Norte, Condesa; Canggu, Seminyak). Those are also the areas travelers actually cluster in, so this is more honest content, not just denser content. Same signature, so create-or-replace is correct; restate the revoke.

- supabase/seed/launch_pins.sql — the identical rewrite, so the manual seed and the function do not disagree. Land this in the same change as the em-dash rewrite or immediately after it, since both touch the same VALUES list.

- supabase/migrations/<same> — decide and encode whether seeded pins count toward k. heat_cells (20260823010000_keep_the_map_alive.sql:89,95) counts `distinct coalesce(p.user_id::text, p.id::text)`, and seeded pins are exactly the rows with a null user_id, so three curated pins in one cell clear the threshold while representing zero distinct people. If the answer is no, the count becomes `count(distinct p.user_id) filter (where p.user_id is not null)` — and because that does NOT change the OUT columns, create-or-replace is still legal here; only a change to cell_lat/cell_lng/pin_count would need the drop-function-first dance and the grants restated.

- supabase/migrations/<same> — mirror whichever choice is made into public_heat_cells (20260823010000:104), or a guest and a member will see different glows on the same city.

**Database.** One migration recreating seed_launch_pins() with district-clustered seed data, and (if the decision goes that way) heat_cells and public_heat_cells with a seeded-pin exclusion in the count. Neither changes OUT columns, so create-or-replace is legal; restate the grants on heat_cells anyway since the file already does.

**Tests.** pgTAP in supabase/tests/database/06_pins_heatmap.test.sql: after calling seed_launch_pins(), assert every ACTIVE launch city produces at least one heat cell from the curated seed alone — this is the regression that lets a re-seed silently un-cluster itself later. Keep the existing rule-6 assertion (a cell below k renders nothing) unmodified; it is the one that matters. If seeded pins stop counting, add the attack test: three seeded pins in one cell produce zero cells.

**Risk.** The founder decision below is load-bearing: if seeded pins keep counting, the app ships a glow that represents nobody, on the exact feature whose value is that it is trustworthy. If they stop counting, the re-seed buys nothing for heat and the layer stays empty until real travelers arrive — which makes the honest-empty-state work in the previous package the whole deliverable rather than a fallback.

**Waits on.** Do curated pins count toward the heatmap's k-threshold? For counting them: it is the only way the layer renders anything on day one, and the brief already blesses curated content for exactly this cold-start reason. Against: a heat cell says 'people are planning here', and three admin rows say nothing of the kind — rule 6's value is that the layer is never a lie.

**After.** `map-curated-pins-drop-the-em-dashes`

### `map-one-message-slot` — One message slot above the dock, with a priority order and the moments that matter in it

**Priority** next · **Effort** M · **Ships as** over the air

Three or four different things compete for the strip of map directly above 'Drop a pin': the places legend, the heat legend, and the empty or error banner. On a quiet map that is the strip carrying the only sentence explaining why the city looks bare, and the least important of them — a hint about a marker family — occupies it in every screenshot in the run. The two legends are one-shot forever, so somebody who dismisses the places chip on day one has permanently lost the only sentence in the app that explains the navy chips, and the heat explanation is gated behind that dismissal. Meanwhile the two moments that most deserve the slot are not in it at all: the reward for finishing thirteen signup screens is a screen with no visible change, and the one person who accepts 'Be the first' gets a map with a single pin on it and no follow-up.

<details><summary>Closes 5 audit findings</summary>

- The map's teaching chips are one-shot forever and they sit on top of the primary action

- The map's one-shot hint occupies the only free banner slot, crowding out the states that matter more

- After thirteen signup screens the map is the same frame the guest already saw

- Nothing happens after "Be the first" - the user who drops the only pin in a city is left alone with it

- Device-local state is not scoped to the account and leaks between users on one phone

</details>

**Changes**

- src/features/pins/map-screen.tsx — one `messageSlot` constant replacing the two hand-tuned offsets at :1285/:1309/:1353 (`+ Spacing.five + 64`) and :1454/:1487 (`+ Space.xxxl + Space.xl`), which currently overlap by roughly a chip's lower edge.

- src/features/pins/map-screen.tsx — a single `slotContent` computed in one place with an explicit priority: pins error > empty city > first-session strip > first-pin follow-up > heat legend > places legend. Only one renders. Today heat already wins over places (:749, :1481) and the error and empty banners are mutually exclusive query states, so the work is adding the missing gates, not rebuilding precedence: suppress the places legend while the traveler empty banner is up, mirroring the existing `!legend.visible` gate.

- src/features/pins/map-screen.tsx:1454-1487 — move both legend chips ABOVE the dock rather than into the strip immediately over it, so the last thing between a user and the primary action is not a dismissible hint.

- src/features/pins/heat-legend.ts:4-5,31 — store a timestamp instead of '1' so 're-arm after 60 days' can be expressed at all, and namespace both keys with the signed-in user id (or clear them in the SIGNED_OUT branch of use-auth-listener.ts:110) so a guest-then-signup on one device does not inherit the other identity's dismissals.

- src/features/pins/map-filter-sheet.tsx:170-185 — extend the existing 'What to show' rows into the permanent legend: swap the generic figure.walk / storefront.fill / star.fill symbols for the artwork the map actually draws (PinGlyph, the business chip from business-marker.tsx, the gold pick), so the explanation lives somewhere a person can go back to. This makes the sheet taller; land the maxHeight cap from the filter-feedback package in the same change.

- src/features/pins/map-screen.tsx — a first-session strip in the slot, 'You're on the map, Maya. Pin where you're headed and people can join.' Keyed on `onboarding_completed_at` falling inside the session or a one-shot flag cleared on the first pin, NOT on onboarding_completed alone, which is true forever after.

- src/features/pins/map-screen.tsx:1297-1329 — when the viewer's own pin is the only live pin in the city, replace the empty banner with a follow-up on the same footprint: 'You're first in Lisbon. We'll tell you when someone joins.' plus one toggle arming a push for the next pin in the same cell, through the existing src/features/notifications/push-primer.tsx. Scope the promise to the pin's life ('while your pin is up') — pins hard-expire at ≤72h, so the notification must expire with the pin rather than becoming a standing subscription.

**Tests.** Jest on the slot-priority selector: given every combination of (error, empty, first-session, first-pin, heat legend, places legend) exactly one is chosen and the order holds. Jest on the heat-legend store: a timestamp older than 60 days re-arms, a newer one does not; a different user id sees an un-dismissed legend. Screenshots: re-shoot 02-map-tab (places chip above the dock), 05c-map-filtered, and a new empty-city shot showing the be-first follow-up.

**Risk.** The push primer is the one thing on this screen that presents a modal on a DATA event rather than a tap, and the traps skill is explicit that this is the dangerous case — a dropped presentation on Fabric kills touch for the whole app. The follow-up toggle must go through the existing primer flow, which already waits on three facts, and must not present anything itself. Also: the first-session strip is the only place in the app where finishing onboarding can be felt, so get the copy right — no em dashes, no 'place' for a business.

### `map-filter-sheet-shows-the-result` — Say how many plans survive the filter, and stop covering the map that is meant to prove it

**Priority** next · **Effort** M · **Ships as** over the air

The argument for having no Apply button is that you can watch the map change as you tick, and the code says so twice. In the shipped screenshots you cannot: the sheet runs from about 15% of the screen down to the tab bar, and the strip of map above it holds the city rail, the Filters pill and empty basemap north of the river — zero markers. So the interaction is Apply-less without being live. You tick blind, close, and only then find the map went from eleven markers to two, with a 'Filters · 1' badge that counts filters, not survivors. An over-filtered map is then indistinguishable from an empty city, which is the one impression this product cannot afford.

<details><summary>Closes 2 audit findings</summary>

- The Filters sheet covers the map it claims to be updating live

- Applying a filter silently removes pins and never says how many are left

</details>

**Changes**

- src/features/pins/map-filter-sheet.tsx:118 — cap the sheet body at `maxHeight: height * 0.6`. components/ui/sheet.tsx:246-253 has no detents; it sizes to content under `maxHeight: height - insets.top - Space.lg`, so this is a style on the inline sheet's own body. The ScrollView at :141 already scrolls, so nothing is lost.

- src/features/pins/map-filter-sheet.tsx:95-103 — take a new `resultCount: number` prop and render it as a line directly above the Done button: '3 plans on the map', or 'No plans fit these filters' with a Clear all beneath it. Do NOT relabel Done to 'Show 3 plans': the comment at :216-219 rejects a button that implies pending work, and it is right — the map has already applied everything.

- src/features/pins/map-filter-sheet.tsx:119-139 — a second count under the Filters header, '3 of 11 plans', so the size of what was removed is legible.

- src/features/pins/map-screen.tsx:1562 — pass the count. It must be computed from the same arrays the markers render — `pins` after pinPasses, plus `places` when businesses are ticked — or the number will contradict the dots the moment Businesses is unticked.

**Tests.** Jest render test on MapFilterSheet: the count line reflects the prop, the zero case renders 'No plans fit these filters' and a Clear all, and Done keeps its label. Jest asserting the count passed from the map equals `pins.length + (showsBusinesses(filters) ? places.length : 0)`. Screenshots: re-shoot 05a, 05b and 05c and confirm markers are visible above the sheet and the count on 05c explains the near-empty map.

**Risk.** A 0.6 cap plus a fourth 'What to show' row plus large Dynamic Type is the combination that pushes Done off the bottom, which the file's own style comment at :401-403 already warns about. Check the sheet at AX3 with the heat row present before shipping. Keep the numeric badge on FilterButton as it is; it answers a different question.

### `map-business-tab-is-about-the-business` — A business's map opens on its own city, shows why its listing is missing, and has a button on it

**Priority** next · **Effort** M · **Ships as** over the air

Map is the first tab and therefore the landing screen for a business account. The active city falls back to launchCities[0], which is Bangkok, for everyone — so a Lisbon cafe owner who has just finished a nine-screen signup lands on a map of Bangkok, where their own business does not exist, and a coach mark cheerfully invites them to tap somebody else's. The app knows exactly which city they are in and ignores it. When the listing genuinely is absent the code knows why and says nothing. And the one thing a hostel owner wants from a map of their city — see who is around, then say what is on tonight — has no control anywhere on the screen, because the dock is gated on `!isBusiness` and nothing replaces it.

<details><summary>Closes 3 audit findings</summary>

- A business owner's map does not contain their own business, and nothing explains why

- The business map has no action on it at all

- A business's Map tab opens on the wrong city, thousands of miles from its own door

</details>

**Changes**

- src/features/pins/map-screen.tsx:687-723 — seed `cityId` from `ownBusiness.city_id` in an effect that fires once ownBusiness resolves, not as a useState initializer: useOwnBusiness is async and the chips arrive before the answer does, so an initializer would latch null. `useEffect(() => { if (cityId == null && ownBusiness?.city_id != null && launchCities.some(c => c.city_id === ownBusiness.city_id)) setCityId(ownBusiness.city_id); }, [...])` — the launch-city guard matters or the chip row at :1135 selects nothing.

- src/features/pins/map-screen.tsx:754,1330-1360 — when `isBusiness && ownBusiness != null && !ownChipOnMap`, render a card in the emptyBanner slot whose copy switches on `ownBusiness.state` (my_business() already returns 'unconfirmed' | 'listed' | 'flagged' | 'removed', typed at src/lib/database.types.ts:227-229). Unconfirmed: 'Your business is not on the map yet. Confirm your email to put it here', pressable into src/app/business-email.tsx. Flagged: 'We are checking your listing. It goes on the map once that is done', not pressable. Removed: say so plainly. Suppress the 'Tap a business' legend while this card is up, or the screen says two things at once.

- src/features/pins/map-screen.tsx:1373 — a business branch beside the traveler dock: the same PressableScale with a storefront glyph, labelled 'Post what's on', routing to `/business-post` (src/app/business-post.tsx already exists). When the listing already has a live post, 'Update tonight'. Never labelled 'Drop a pin', and never routed through the pin path: the founder's rule at src/features/business/hooks.ts:52-55 and the assert_not_business trigger both forbid it.

- src/features/pins/map-screen.tsx — gate that button on `ownBusiness.state === 'listed'`. If the listing is not live, the state card above replaces it, or the button posts into a listing nobody can see.

- src/features/pins/map-screen.tsx:1128-1168 — hide the city rail for a business account. They operate in exactly one city, and four chips including two continents away is a navigation task where a job should be.

**Tests.** Jest render tests on the business empty-card: each of the four `state` values produces its own sentence, and only 'unconfirmed' is pressable. Jest asserting the dock button is absent while state !== 'listed'. E2E: extend business-tour.yml to assert the Lisbon chip is selected (or the rail absent) and that 'Post what's on' is on screen. Screenshots: re-shoot 71-business-map — the run's own commit message records that 70 and 71 are byte-identical, so shoot the two states distinctly this time.

**Risk.** The city-seeding effect must be idempotent and must not fight a manual chip tap; guard on `cityId == null` only. The dock button is the one place a business account could be handed a traveler affordance by accident — route it explicitly and never reuse enterPlaceMode, which already returns early for a business at :832 and would silently do nothing if wired wrong.

**Waits on.** See the decision on the business landing tab: whether a business account should land on My business instead of the Map at all.

### `map-remembers-your-city` — The map opens where you are, and the analytics stop attributing everyone to Bangkok

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

`activeCityId = cityId ?? launchCities[0]?.city_id`, and cityId is plain component state that resets on every cold start. api.ts:23 orders by city_id deterministically, so the hero screen of a map-led product opens on Bangkok for every user on every launch, forever. A traveler in Lisbon sees pins that are real and 9,000km away, and has to re-pick their city every single time. The same defect corrupts the founder's per-city numbers twice over: every user who never taps a chip is attributed to Bangkok, and a user in a city that has not launched resolves no active city at all, so `map_viewed` never fires — which means interest in unlaunched cities, the highest-leverage growth signal there is, reads as zero by construction.

<details><summary>Closes 3 audit findings</summary>

- The map opens on Bangkok for everybody, on every launch, forever

- map_viewed attributes every default view to launch_cities[0], and is silent for users outside a launch city

- No timezone anywhere in the schema, so the first scheduled push will fire at the wrong hour in three of four launch cities

</details>

**Changes**

- supabase/migrations/<new>\_launch_cities_know_their_clock.sql — `alter table public.launch_cities add column timezone text not null default 'UTC'` backfilled with Asia/Bangkok, Asia/Makassar, Europe/Lisbon, America/Mexico_City, then drop the default. Add a validation that the value parses (`select now() at time zone timezone`) or a typo'd IANA name raises inside a cron job where nobody sees it. This is a plain column add, so no drop-function is required — but check whether any of city_pins, heat_cells or the launch-cities read path selects `*` before assuming nothing downstream needs restating.

- src/features/pins/api.ts:20 and src/lib/database.types.ts — add `timezone` to the launch_cities select and to LaunchCityWithCity.

- New file src/features/pins/city-store.ts — a small Zustand store holding the selected city id, persisted under `samewhere.map.city.v1`. src/app/(tabs)/chat.tsx:761 independently hardcodes `launchCities[0]` for 'Rooms near you', so a Lisbon traveler is shown Bangkok's rooms as well; both tabs must read the same store or this is only half fixed.

- src/features/pins/map-screen.tsx:687-688, :808 — resolve the active city in order: the persisted choice; then the city of the member's soonest upcoming trip from useMyTrips; then the launch city whose `timezone` matches `Intl.DateTimeFormat().resolvedOptions().timeZone`; then launchCities[0]. Keep the fallback strictly to Intl — do not let it become an expo-location read, which would cross §7 rule 2.

- src/features/pins/map-screen.tsx:786-789 — capture `map_viewed` unconditionally with `city_id: activeCityId ?? null` and `explicit: cityId != null`, so a defaulted attribution is distinguishable from a chosen one and an out-of-area user is counted rather than invisible. Add `city_switched` on selectCity at :810 carrying the city chosen.

**Database.** One migration adding launch_cities.timezone with a backfill and a parse check. Plain column add, no function signature change; confirm no read path selects \* before assuming nothing needs restating.

**Tests.** pgTAP in supabase/tests/database/09_launch_hardening.test.sql: every active launch_cities row has a timezone that `now() at time zone` accepts. Jest on the city-resolution function with a table of inputs (persisted / trip / timezone / none), including the case where the persisted city is no longer active. Jest on the analytics payload shape. E2E: launch, tap Lisbon, kill and relaunch, assert the Lisbon chip is selected — this is the whole point and only an E2E step proves it.

**Risk.** A persisted city that has since been deactivated must fall through rather than render an empty map — check `active` before accepting the stored id. The timezone column is also what the notification work needs before any scheduled push exists, so shipping it here is deliberate: the four launch cities span thirteen hours, and a '18:00 the night before your trip' job scheduled in UTC is 01:00 in Bangkok.

### `map-today-is-the-citys-today` — "Today" means the browsed city's today, not the reader's

**Priority** next · **Effort** M · **Ships as** over the air

The whole map is city-scoped, and the stated use case is planning a city you have not reached yet — trips are future-dated by construction. At 20:00 in London it is 03:00 the next day in Bangkok. The reader's phone says today is the 30th; Bangkok's today is the 31st. Tapping Today therefore filters to a Bangkok night that ended three hours ago and hides tonight's entirely, and every marker's Today/Tomorrow label is off by one. filterDates already bridges the device-vs-UTC gap and its comment is explicit that that is the case it solves; it cannot help here, because the gap is device-vs-destination and reaches fifteen hours. In a product whose heartbeat is a 72-hour expiry, this is the app being confidently wrong about time on its hero surface.

<details><summary>Closes 1 audit findings</summary>

- The map's "Today" is the reader's today, not the city's — browsing a destination before you arrive shows the wrong night

</details>

**Changes**

- src/features/pins/filters.ts:183,188 — daysFor and heatDay already accept a `now` argument. Pass the browsed city's clock rather than defaulting to `new Date()`.

- src/features/pins/map-screen.tsx:699-700 — compute `cityClock = cityNow(new Date(), activeCity.cities.lng)` once (cityNow is already exported from src/features/business/vocabulary.ts:172 and is used for business hours) and thread it into daysFor, heatDay, intentDateOptions and intentLabel. Once launch_cities.timezone exists from the previous package, prefer the real IANA offset over the longitude approximation.

- src/features/pins/pin-helpers.ts:224,251 — intentLabel and filterDates already take `now`; every map call site must pass the city clock, so a marker reading 'Today' means the city's today.

- src/features/pins/map-filter-sheet.tsx:113 — the third day's weekday name is derived from `addDays(new Date(), 2)`; derive it from the city clock too, or the chip is named for the wrong day.

- src/features/pins/pin-form-sheet.tsx:67,115 — a pin dropped from an airport lounge should land on the destination city's date. Write intent_date from the city clock, and check it against the validate_pin trigger's `current_date - 1` / `+2` window (20260816210000_map_pins.sql:106), which has enough slack in both directions to absorb this.

**Database.** none, but it consumes launch_cities.timezone from the previous package

**Tests.** Jest in src/features/pins/**tests**/pin-helpers.test.ts and filters.test.ts, with fixed clocks: a device at UTC+1 browsing Bangkok at 20:00 gets Bangkok's next calendar day for 'today'; a device at UTC-6 browsing Lisbon gets the right answer in the other direction; intentLabel says 'Today' for a pin on the city's today and 'Tomorrow' for the next. These are pure-logic cases and belong nowhere else.

**Risk.** Two clocks already write intent_date (the device's local calendar day and Postgres's UTC current_date), which is exactly why filterDates returns two candidate strings. Adding a third clock without preserving that tolerance would hide seeded pins from everyone; keep the two-string match and widen the set rather than replacing it. Verify against the validate_pin trigger before changing what the form writes — a date outside its window is a raw database refusal at the end of the form.

**After.** `map-remembers-your-city`

### `map-place-mode-says-where-you-are` — Show the address before the commit, and stop thudding at camera moves the user did not make

**Priority** next · **Effort** M · **Ships as** over the air

Placement is blind. The reverse geocode runs inside the form, after 'Pin here' is committed, so the first time a traveler learns their rooftop drinks are pinned to a bridge over the Chao Phraya is after they have tapped through — which is exactly what the last E2E run did. Nothing warns that the centre is water, a motorway, or nowhere. Two smaller defects live in the same handlers: Keyboard.dismiss() fires once per frame for the whole duration of a pan on the one screen that must hold 60fps, and the pin's drop haptic — whose meaning is 'you placed it here' — fires for the programmatic camera moves the app itself makes on entering place mode and on picking a search result.

<details><summary>Closes 3 audit findings</summary>

- Pin drop mode never says where you are dropping, so a plan lands on a bridge

- Keyboard.dismiss runs on every frame of a map pan in place mode

- The place-mode pin thuds when the map animates itself, not only when you drag it

</details>

**Changes**

- src/features/pins/map-screen.tsx:923-930 — on onRegionChangeComplete in place mode, debounce a `Location.reverseGeocodeAsync` of the map centre and float a small card directly above the 'Pin here' button showing the result. Reverse-geocoding a coordinate the user chose reads nobody's position, so this stays inside §7 rule 2.

- src/features/pins/map-screen.tsx:1400-1418 — when the centre resolves to nothing, swap the card for the brief's own error voice ('Nothing here. Drag to a street or a venue.') and disable Pin here. Reuse the resolved label as the pin's `placeLabel` so pin-form-sheet.tsx:88-113 does not have to geocode a second time.

- src/features/pins/map-screen.tsx:910-921 — call Keyboard.dismiss() only on the transition INTO lifted, not on every onRegionChange frame. Track whether the field is focused, or simply guard on `!lifted` before dismissing. The behaviour the comment wants — the keyboard getting out of the way when you drag — is preserved by the first call.

- src/features/pins/map-screen.tsx:852,871 and src/features/pins/place-pin-overlay.tsx:29-41 — set a ref before each programmatic animateToRegion (enterPlaceMode's 3x zoom, flyTo's landing) and clear it on the next onRegionChangeComplete; gate `haptics.medium()` on it. Keep the pin's visual lift and drop either way — that motion is informative regardless of who caused it. Note enterPlaceMode already fires haptics.light() at :839, so today entering place mode is light-then-medium inside one animation.

**Tests.** Jest on the haptic gate: a programmatic move sets the flag and produces no medium impact; a gesture-driven settle does. Jest on the dismiss guard: N region-change events with lifted already true produce one dismiss. Screenshots: re-shoot 13-place-after-pan, which currently shows an unlabelled crosshair over the river between Wat Arun and Wat Kanlaya under a full-width 'Pin here' — the new shot should name the bridge before the commit, not after.

**Risk.** The reverse geocode is a network call on a debounce inside a gesture handler; rate-limit it and cancel in-flight requests on the next settle, or a fast pan queues a dozen lookups and the card lags behind the map. iOS also throttles reverseGeocodeAsync, so the card must degrade to nothing rather than to a stale address — showing the previous street over a new coordinate is worse than showing none.

### `map-signup-gate-says-what-you-get` — The sign-up gate leads with the invitation, not the privacy warning

**Priority** next · **Effort** S · **Ships as** over the air

A guest taps 'Drop a pin' — an act of enthusiasm — and gets a card headed 'Pins come with your name on them', subtitled 'Takes a minute. Always free.' The headline slot is being used to disclose a downside, and the two lines do not agree emotionally: a caveat followed by a reassurance about price. The research the brief cites says ~54% of solo travelers are women and that their departure is what collapses these marketplaces; that headline is precisely the sentence that makes that person put the phone down. The sheet also fills about 40% of the screen for a ~200pt card, scrimming away the map the gate is arguing about, and never says what a pin actually is — which matters, because somebody who skipped the tour has never had the word explained.

<details><summary>Closes 2 audit findings</summary>

- The sign-up gate's headline is a privacy warning where the invitation should be

- The guest gate sheet fills more than half the screen for a three-line card

</details>

**Changes**

- src/components/ui/sign-up-gate.tsx:24 — write the contract onto the `reason` prop doc, next to the existing `where` doc: reason always answers 'what do I get', in the imperative; any caveat goes in the body. That is where the next writer will look.

- src/components/ui/sign-up-gate.tsx:52-80 — add an optional `detail` prop rendered as a footnote under `reason`.

- src/features/pins/map-screen.tsx:1537-1541 — 'Pins come with your name on them' → 'Put your plan on the map', with detail 'Your name and photo go on the pin, so people know who they are meeting. It disappears within three days.' The join variant 'Joining puts you in the chat, with a name' → 'Join the plan and the chat'.

- src/features/pins/map-screen.tsx:1643 — the pin-card gate's 'See who's going and say hi' already has the right shape; leave it.

- src/components/ui/sign-up-gate.tsx:91-93 and src/components/ui/sheet.tsx:214 — drop the compact style's marginTop and change the sheet's bottom padding to `insets.bottom + Space.md`. Do not add a detent: sheet.tsx:246-253 already sizes to content, and the empty strip is doubled bottom space, not a fixed height.

- The other five gate call sites (room/[id].tsx:482, place/[id].tsx:516, chat.tsx:878, join-group/[token].tsx:208, place-sheet.tsx:262) currently mix statements, imperatives and questions. They belong to other subsystems, but the contract lands here and they should be swept to match.

**Tests.** Jest render test on SignUpGate asserting `reason` and `detail` both render and that the compact variant has no doubled bottom spacing. Screenshots: re-shoot 06-guest-gate and 10-auth-gate and confirm the headline is an invitation and more of the map survives behind it. Read the strings aloud before shipping — no em dashes, no 'request' for a message.

**Risk.** Low, but this is user-facing copy on the highest-stakes conversion surface in the app, so the design-review brief's tone rules apply verbatim. Changing the sheet's shared bottom padding touches every sheet in the app; verify the pin card and the filter sheet still have room under their buttons.

### `map-pin-venue-and-plan-split` — Split venue_name into the place and the plan

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

One column is being asked to be two things. The field labelled "What's the plan?" writes `venue_name`: when the place came from search it arrives pre-filled with 'Time Out Market', which is not a plan; when it came from a drag it holds free text, which is not a venue. Three strings break downstream. The opening message composes as 'Hey! What time are you heading to Rooftop hello from Maestro?'. clusterTitle falls back to '2 plans here' whenever two people at one bar wrote different plan text, and the venue sheet then prints that string twice, because its subtitle is also '{n} plans here'. And the marker's VoiceOver label opens with a sentence rather than a place. The app cannot answer 'which bar is this' about its own pins.

<details><summary>Closes 1 audit findings</summary>

- "What's the plan?" writes the venue column, so the pin has no venue and three strings break

</details>

**Changes**

- supabase/migrations/<new>\_a_pin_has_a_place_and_a_plan.sql — `alter table public.pins add column plan text check (plan is null or char_length(plan) between 1 and 80)`, then backfill `plan = venue_name where place_label is not null` (the rows where the venue text was actually plan text typed over a geocoded address).

- Same migration — `drop function if exists public.city_pins(int);` and recreate with `plan` in the RETURNS TABLE, then restate `revoke ... from public, anon` and `grant execute ... to authenticated`. Same for `public_city_pins(int)` with its anon grant. This is the AGENTS.md trap verbatim: Postgres refuses to add an OUT column via create-or-replace and fails the deploy after the earlier statements have applied. 20260829120000_a_pin_anyone_can_join.sql:359-368 is the pattern to copy.

- Same migration — add `p_plan` to `post_joinable_pin` and mirror it in the plain insert path.

- src/lib/database.types.ts:658 and :154 — add `plan: string | null` to CityPinRow and PublicPinRow. src/features/guest/hooks.ts:78-85 — the normalisation must carry it.

- src/features/pins/pin-form-sheet.tsx:63,265-269,130 — the free-text field becomes `plan` with the placeholder it already has; `venue_name` is filled from search or from the place-mode reverse geocode and stays editable. Submit both.

- src/features/pins/pin-helpers.ts — redefine pinTitle as `pin.venue_name` and pinSubtitle as `pin.plan ?? pin.note`. No call sites change, because the title package already routed all three through these functions.

- src/features/pins/cluster.ts:73-78 — clusterTitle groups on venue_name as it does today, which now actually means the venue. Decide the blank case: a dragged pin that never got a reverse geocode falls back to place_label, then to '{n} plans here'.

- src/features/pins/map-screen.tsx:451 — the compose draft becomes 'Hey! What time are you heading to Time Out Market?' with no code change, because it already interpolates venue_name.

- src/features/pins/map-screen.tsx:1577-1581 — stop printing '{n} plans here' as both the venue header and its own subtitle.

**Database.** One migration: add pins.plan, optional backfill, then `drop function` and recreate city_pins(int) and public_city_pins(int) with the new OUT column, restating every grant. Also extend post_joinable_pin.

**Tests.** pgTAP in a new test file: the backfill leaves no pin with a null plan where place_label was set; city_pins and public_city_pins both return the new column with grants intact after the drop (assert as `authenticated` and as `anon` respectively — a lost grant after a drop is the exact failure this repo has already documented). Jest on clusterTitle: same venue different plans returns the venue; blank venue falls back to place_label. Screenshots: re-shoot 16-pin-posted and confirm the card headlines the venue with the plan beneath it.

**Risk.** The drop-function-first rule is the whole risk. If it is skipped, the deploy dies after the alter table has already landed, leaving a column with no function returning it. Second risk: the backfill heuristic (`place_label is not null`) is a guess about which existing rows hold plan text; pins live at most 72 hours, so the honest alternative is to ship the column, let the old rows expire, and skip the backfill entirely.

**Waits on.** Backfill the existing rows, or let them expire? Pins live ≤72 hours, so doing nothing is correct within three days and costs no guesswork; backfilling is one statement but is a heuristic about what people meant.

**After.** `map-pin-title-one-voice`

### `map-carries-your-intent-through-signup` — Carry what a guest was doing across the account wall

**Priority** next · **Effort** M · **Ships as** over the air

The one context the app carries across the account wall is a group-invite token, and the code around PendingInviteHandoff shows the team already understands why that matters. Nothing else is carried. A guest taps a pin at a bar in Lisbon, reads 'See who's going and say hi', taps Create an account, answers thirteen screens, and arrives at the tabs with selectedPinId gone and cityId back at its useState(null) default, which resolves to Bangkok. Same for the drop-pin gate: the region they had panned to is lost. This is the largest leak in the funnel and it hits at the exact moment somebody has spent three minutes proving they wanted something specific.

<details><summary>Closes 1 audit findings</summary>

- Signup throws away everything a guest was doing, except a group invite

</details>

**Changes**

- src/features/auth/store.ts:41-53 — generalise `pendingInvite` into `pendingIntent: { kind: 'pin' | 'traveler' | 'drop-pin'; cityId: number; pinId?: string; userId?: string; region?: Region } | null`, same in-memory lifetime as the invite, never persisted.

- src/features/pins/map-screen.tsx:1640-1649 and :1534-1545 — the two `onNavigate` handlers that currently just clear selection and push /join record the intent first: the pin card records `{kind:'pin', cityId, pinId}`, the drop gate records `{kind:'drop-pin', cityId, region: lastRegion.current}`.

- src/app/(tabs)/\_layout.tsx:21-54 — extend PendingInviteHandoff to replay it: select the city through the shared city store, then select the pin card, or enter place mode at the saved region. Clear pendingIntent BEFORE navigating, the way inviteHandled() is called before the push at :44-47, or backing out of the replayed screen pushes it straight back on.

- src/app/(tabs)/travelers.tsx:235-243 — the third origin, recording `{kind:'traveler', cityId, userId}`. Different subsystem, same store; land it or the store has a branch nothing writes.

**Tests.** Jest on the store: setting and clearing pendingIntent, and the clear-before-navigate ordering. E2E in guest-tour.yml: as a guest, tap a pin, tap through the gate, complete signup, and assert the same pin's card is open on the same city — this is a whole flow a person walks, so it belongs in Maestro and nowhere else.

**Risk.** Replaying a pin card requires the pin still to exist: pins hard-expire at ≤72h and a signup takes minutes, so the replay must degrade silently to 'select the city' when the pin is gone rather than showing an error. Do not persist the intent to storage — an intent surviving a cold start is a different feature with a different privacy story.

**After.** `map-remembers-your-city`

### `dev-strings-never-ship` — Keep "waiting on backend keys" out of any bundle a person can reach

**Priority** next · **Effort** S · **Ships as** over the air

Five screens, the map among them, render a code-styled badge reading 'waiting on backend keys' over body text telling the reader to copy .env.example and restart the dev server. The component's comment argues only dev states can reach it, and for an EAS build that is right — the flag is a build-time check on inlined EXPO*PUBLIC* vars. But this project ships JavaScript over the air, and an OTA bundle built by a workflow run missing those two secrets ships a bundle where the flag is false. The blast radius is every phone on the channel, and what they see is a support ticket addressed to a developer.

<details><summary>Closes 1 audit findings</summary>

- Developer setup instructions are shippable copy on five tabs

</details>

**Changes**

- src/components/placeholder-screen.tsx:50-53 — `{phase && __DEV__ ? ...}` so the code badge cannot render in a production bundle.

- src/components/placeholder-screen.tsx — add a `configError` variant rendering one written sentence: title "Can't reach Samewhere", description 'Something is wrong on our end. Try again in a few minutes.' Use it rather than rewriting five description strings by hand.

- src/features/pins/map-screen.tsx:800-802, src/app/(tabs)/travelers.tsx:508-510, chat.tsx:799-801, my-business.tsx:338-340, profile-me.tsx:247-249 — switch to the configError variant. Keep the .env text under `__DEV__` next to the existing console.warn at src/lib/supabase.ts:14, where a developer will actually see it.

**Tests.** Jest render test on PlaceholderScreen with **DEV** false asserting the phase badge is absent and the generic copy renders. This is build-hygiene insurance, so the test is the deliverable — nothing in the E2E suite can reach the state.

**Risk.** Low. Frame it honestly as insurance rather than as a live user-facing bug: it only ships from a misbuilt bundle or an OTA published from a machine without .env.

### `city-rail-says-whats-on` — Put counts on the city chips and capture the cities nobody has opened yet

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

The rail is the app's entire geography and it explains nothing. It does not say these are the only four cities, does not say how much is happening in each, and gives a traveler in Chiang Mai or Porto no answer and no way to register that they exist. A traveler in Lisbon on a quiet Tuesday sees four pins and cannot tell whether that is Lisbon today or the whole product. Counts on the chips would tell the truth in one glance and give somebody heading to Bangkok next week a reason to keep the app installed. The demand capture is the input to the liquidity decision §2.6 describes, and today it does not exist in any form.

<details><summary>Closes 3 audit findings</summary>

- The city rail says nothing about the cities, and a traveler whose city is not one of the four has nowhere to go

- The four city chips carry no liveness, so a thin city gives no reason to look at a busy one

- Pan outside the four launch cities and the map has nothing to say

</details>

**Changes**

- supabase/migrations/<new>\_a_city_says_how_busy_it_is.sql — a `city_pin_counts()` security-definer function returning (city_id, pin_count) for active launch cities. It must compute the count under the SAME visibility rules the map applies, or a chip advertises pins a narrowed-audience viewer cannot see. Apply each city's own heat_k as a floor and return null rather than a 1 or a 2, matching heat_cells.

- Same migration — a `city_requests (user_id, city_name, created_at)` table with RLS (insert own, select none), and a `request_city(p_name text)` RPC. This is the demand map §2.6 asks for, at essentially no cost.

- src/features/pins/api.ts and hooks.ts — fetch and cache the counts alongside useLaunchCities.

- src/features/pins/map-screen.tsx:1130-1168 — render the count inside each chip as caption-size textSecondary ('Lisbon 4'), never a badge, so the chip does not grow into a card and the rail does not reflow on selection (the file already paid for that with the smallBold lesson at :1155).

- src/features/pins/map-screen.tsx — a trailing chip after the four: 'Somewhere else?', opening a short sheet that takes a city name and says 'We open cities where there are enough travelers. We will tell you when yours is one.' Records through request_city.

- src/features/pins/map-screen.tsx:1691-1694 — add a trailing fade mask on the rail so it reads as scrollable once there are five chips. Do not describe the current rail as clipped: in every screenshot the 'Mexico City' chip renders complete with its gutter visible.

**Database.** One migration: city_pin_counts() security-definer function honouring per-viewer visibility with a heat_k floor, plus a city_requests table with RLS and a request_city() RPC. New functions, so no drop-first needed; state the grants explicitly rather than relying on Supabase defaults.

**Tests.** pgTAP: city_pin_counts returns no count below heat_k; a viewer with a narrowed audience gets a count that matches what city_pins returns for them (the enumerability check, written as an attack). city_requests is insert-only for its owner and unreadable in bulk. Jest on the chip rendering with and without a count. Screenshots: re-shoot 02-map-tab with counts and the trailing chip.

**Risk.** The count is a new aggregate over a table whose whole privacy story is per-viewer visibility, so the enumerability check matters more than the arithmetic: a definer function that ignores discovery_pair_ok would let anyone with the anon key measure a city. Keep the k floor even though the number is aggregate — belt and braces on the one feature whose value is that it is trustworthy.

**Waits on.** Should the app record which unlaunched cities people ask for? For: it is the liquidity signal §2.6 says to instrument, and it converts a churned user into a data point. Against: it is a new table holding a user id next to a stated travel intention, which is a small but real widening of what the app stores.

**After.** `map-remembers-your-city`

### `map-pin-carries-an-hour` — Give a pin an optional time

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

The brief's marketing hook is 'see what travelers are doing in this city tonight', and the data model has no hour in it: intent_date is a date, the day filter is any/today/tomorrow/later, and the actual time survives only as prose in the details field. A traveler at 9pm filtering to Today gets this morning's beach plan beside tonight's bar, and the only way to tell is to open each pin and read. It also costs the heat layer its best story: a cell busy at 8pm and empty at noon is far more interesting than a cell busy today, and it is still future intent, not location.

<details><summary>Closes 1 audit findings</summary>

- A pin has a date but no time, so the map cannot answer "what is on tonight"

</details>

**Changes**

- supabase/migrations/<new>\_a_plan_has_an_hour.sql — `alter table public.pins add column intent_time time` (nullable, so 'sometime that day' stays valid and nothing existing breaks).

- Same migration — extend the validate_pin trigger (20260816210000_map_pins.sql:106) so the intent date-and-time is checked against the pin's lifetime, not just the date. An intent_time late on the last valid day can push a plan past the 72h ceiling, and §7 rule 3 leaks through exactly that gap.

- Same migration — `drop function if exists public.city_pins(int)` and `public_city_pins(int)`, recreate both with intent_time, restate every grant. Same for heat_cells if the time is passed to it.

- src/lib/database.types.ts — intent_time on CityPinRow and PublicPinRow; src/features/guest/hooks.ts normalisation carries it.

- src/features/pins/pin-form-sheet.tsx — an optional time control beside the existing day ChipRail. Optional means optional: no default, and a pin with no time is a first-class pin.

- src/features/pins/map-screen.tsx and plan-list.tsx — show it next to the day on the card, sort cluster stacks and list rows by it, and let the list heading become 'Tonight' rather than 'Today'.

- src/features/pins/map-filter-sheet.tsx:148-168 — a Morning / Afternoon / Evening segment under the existing 'When' heading. Inside the sheet, not as new chips on the map: the founder already ruled the day chips belong in the filter screen, and this extends that rather than reversing it.

**Database.** add pins.intent_time (nullable); extend validate_pin to timestamp granularity; drop-and-recreate city_pins, public_city_pins, and heat_cells if it consumes the time, restating all grants.

**Tests.** pgTAP: a pin whose intent_time on its last valid day would fall past created_at + 72h is refused (this is the rule-3 attack and is the reason the trigger has to move to timestamp granularity). If intent_time reaches heat_cells, a pgTAP case proving the k-threshold is recomputed over the time-sliced set — inheriting the day-level k would render an evening cell holding one person, which is exactly what rule 6 forbids. Jest on the time-of-day filter predicate and on the sort.

**Risk.** Two §7 risks in one change, which is why it is `later` rather than `next`: the 72-hour ceiling can leak through a time on the last valid day, and the heat threshold can be inherited from a coarser bucket. Neither is visible in testing unless it is specifically attacked. Also the function drop-and-recreate has to restate grants on four functions in one migration.

**Waits on.** Does a pin get an hour at all? For: it is the difference between the map answering 'tonight' and answering 'today', and it is the brief's own sentence. Against: an optional field that most people skip produces a map where half the plans are sorted and half are not, and every new field is one more thing between a person and a posted pin.

**After.** `map-pin-venue-and-plan-split`, `map-plan-list`

### `map-pins-link-to-a-business` — "Plan to go" from a business page

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

The hero mechanic is 'I want to go to X on Y', and X is free text with no relationship to the business listing sitting at the same coordinates. A traveler reading a bar's page on Thursday, deciding to go Friday, has to leave, open the map, find the spot again and retype the name. The two map layers — intent and premises — never meet.

<details><summary>Closes 1 audit findings</summary>

- A traveler cannot say "I'm going" from a business page, and pins never link to a business

</details>

**Changes**

- supabase/migrations/<new>\_a_pin_can_name_a_business.sql — `alter table public.pins add column business_id uuid references public.businesses (id) on delete set null` (nullable). Then `drop function` and recreate city_pins(int) and public_city_pins(int) with the new OUT column, restating grants.

- src/app/place/[id].tsx:560-635 — a 'Plan to go' action in the existing stack, opening the pin form pre-filled with the business's name, category and coordinates.

- src/features/pins/pin-form-sheet.tsx and api.ts — accept and submit businessId when the form was opened from a business page.

- src/features/pins/plan-list.tsx and map-screen.tsx — a pin that names a business deep-links its venue line to that business's sheet.

**Database.** add pins.business_id (nullable, on delete set null); drop-and-recreate city_pins and public_city_pins with the column, restating grants.

**Tests.** pgTAP: business_id is nullable and a deleted business leaves the pin intact with a null link (on delete set null); a pin cannot name a business in another city. Jest on the pre-fill. E2E: from a business page, tap Plan to go and post, then assert the pin is on the map.

**Risk.** Keep the owner-facing half out of this package. 'Four travelers have plans here this week' is a §10 business-analytics question with its own k-threshold argument, and bundling it turns a small traveler convenience into a privacy review.

**Waits on.** Do owners ever see an aggregate of who plans to come? Raise it separately against §10; this package deliberately ships only the traveler half.

**After.** `map-pin-venue-and-plan-split`

### `map-heat-remembers-usually-busy` — A de-identified "usually busy" layer beneath live heat

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

Even after the re-seed, a quiet Tuesday in Lisbon shows nothing, because live heat only knows about pins that exist right now and pins hard-expire within 72 hours. Google Maps' Popular Times is exactly this, and it is the reason a quiet Tuesday still tells you something. It would make the heat layer valuable to a user who never meets anybody, which is what the brief actually asks of it.

<details><summary>Closes 1 audit findings</summary>

- The heatmap, the product's stated differentiator, renders in one launch city and has never appeared in a screenshot

</details>

**Changes**

- supabase/migrations/<new>\_the_map_remembers_where_it_was_busy.sql — a `heat_history (cell_lat, cell_lng, weekday, hour_band, ...)` table with NO user reference of any kind. Write to it from the expire-pins sweep, before the hard delete.

- Same migration — the aggregation must inherit the threshold, not lose it. Either write a bucket only when it already passed k live, or keep a hashed distinct-poster set per bucket and re-apply `>= heat_k` at read time inside the RPC, never on the client.

- Same migration — a `heat_history_cells(p_city_id int)` reader. If it shares heat_cells' OUT columns it is a new function and needs no drop; if heat_cells itself grows a column to distinguish live from historic, that is the drop-function-first case and the grants must be restated.

- src/features/pins/heat.ts and map-screen.tsx — draw the history layer dimmer, beneath live heat, with its own line in the filter sheet's Busy areas row so it can be turned off.

**Database.** New heat_history table with no user reference, a write step inside the expire-pins sweep, and a reader function that re-applies heat_k. New functions need no drop; changing heat_cells' OUT columns would.

**Tests.** pgTAP alongside the existing heat tests: a bucket that never passed k live is never returned; a bucket written from three distinct posters is; the table holds no column that could identify a person (assert on information_schema, so a later migration adding one fails the suite). This is a privacy invariant, so it is written as an attack.

**Risk.** This is the only package here that creates a new persistent record of activity, and rule 3 says pins are unreadable after expiry. A count with no user column is not a pin, so the rule survives — but the design is only safe if the threshold is inherited rather than recomputed on a smaller pool, and that is easy to get subtly wrong. Genuinely optional: ship it only if the founder wants the map to say something on a quiet Tuesday.

**Waits on.** Should the map remember where it was busy after the pins are gone? For: it makes the heat layer worth something on a quiet night, which is the brief's own test for it, and a bucket count carries no user column. Against: rule 3's promise is that a pin is gone, and a derived record that outlives it is a promise with a footnote.

**After.** `map-heat-has-something-to-show`, `map-heat-says-what-it-is`

## The Travelers queue and matching

Forty-two findings collapse to seventeen packages, and three of them are the whole story. First, one string in src/app/(tabs)/travelers.tsx breaks a §7 hard rule in shipped code: "You're top of their list too." is the reciprocal-interest reveal with the word "match" removed, and it is photographed in 17-travelers-signed-in.png. Six agents found it independently; that is one line to change. Second, the floating action bar is geometrically wrong rather than badly tuned. The gradient reaches full opacity 55% down its own 167pt height, which is roughly 60pt below the top of the buttons, so a second trip's city and dates read through the primary action of the whole screen. Five findings describe the same wrong stop; one solid plate plus one short ramp above it fixes all five and lets three tuning constants be deleted. Third, passing a traveler is a silent, unlabelled, unrecoverable-for-a-fortnight tap 12pt from Say hi, and the only undo appears after the queue is empty and clears every pass you ever made. What the founder is really deciding here is smaller than the finding count suggests: whether a hello can be taken back (the unique constraint is deliberate anti-pester), whether travelers get a private hold-for-later shelf (recorded as already decided against), whether a guest sees one face or three on day one in a new city, and whether the app ever asks two people if they actually met. Everything else is repair work the code's own comments already predicted.

### `tq-spotlight-copy` — Replace the spotlight's ranking line with the mechanism it describes

**Priority** now · **Effort** S · **Ships as** over the air

"You're top of their list too." is printed under the "Today in Bangkok" chip on every spotlight traveler, and it is the reciprocal-interest reveal the product exists to avoid: it tells a reader that a named stranger has ranked them. The design brief bans exactly this grammar, and this is the one line that would make a screenshot of Samewhere indistinguishable from a dating app. The underlying mechanic is fine and worth keeping. daily_spotlight is symmetric by construction, the same pairing is written for both people, and the score has no appearance input at all. What has to go is the claim about somebody's feelings, not the shared prompt.

<details><summary>Closes 5 audit findings</summary>

- "You're top of their list too." is reciprocity ceremony, and it is printed unconditionally

- "You're top of their list too." imports a ranking frame the product does not have, over a chip nobody can decode

- "You're top of their list too" is unverifiable and is see-who-liked-you grammar

- "You're top of their list too." is a mutual-match ceremony with the banned word removed

- The spotlight subtitle sells a mutual-interest signal the product does not have and should not imply

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — line 366: delete the literal 'You&apos;re top of their list too.' and render 'Shown to you and {name} today.' built from the traveler's own display_name. Change the TravelerPage prop at :330 from a prepared `spotlight?: string | null` to `isSpotlight?: boolean`, and build both the chip string (`Today in ${candidate.match.city_name}`) and the note inside TravelerPage where `shown.display_name` is already in scope. Update the call site at :700.

- src/app/(tabs)/travelers.tsx — rename `styles.spotlightNote` (:772) to `styles.sharedTodayNote` so a ceremony cannot grow back under the old name, and add `paddingHorizontal: Space.lg` plus `paddingRight: HitTarget + Space.lg` to `styles.spotlightRow` (:759): the row has no horizontal padding today and the centred line runs under the 44pt ProfileCorner avatar at larger Dynamic Type.

- supabase/migrations/20260822180000_daily_spotlight.sql — no change. Read only, to confirm the wording is true: the unique indexes on (day,user_a) and (day,user_b) guarantee the pairing exists for both sides once it is written.

**Tests.** New jest test src/features/matching/**tests**/spotlight-copy.test.ts asserting the rendered note contains neither 'top of' nor 'list' and does contain the traveler's name (extract the string into an exported `sharedTodayNote(name: string)` helper so it can be asserted without rendering). Re-shoot 17-travelers-signed-in.png and read it: the chip and the new line must both be legible above the hero.

**Risk.** The replacement must not restate the overlap. 'Both in Bangkok Aug 30 – Sep 4' is already an accent chip on the hero photo in the same viewport, so any wording about shared dates prints the same fact twice on one screen. Small tense risk: the person who inherits the pairing is told the other is 'seeing' them before that person has opened the tab. 'Shown to you and {name} today' is the phrasing that survives that, because it describes the write, not the read.

### `tq-action-bar-ground` — Give the Say hi bar an opaque ground and make Next a control you can see

**Priority** now · **Effort** M · **Ships as** over the air

The gradient behind the action bar reaches full opacity 55% of the way down its own height, which lands roughly 60pt below the top of the buttons, so the entire button row sits on a half-transparent wash. In the shipped frame a second trip's 'ico' and 'Sep 25 – Oct 28' read through and beside the primary action of the screen. The comment above that block states the intent exactly and the geometry does not deliver it. In the same bar, the Next control is a circle filled surfaceSunken (1.15:1 on canvas) outlined in hairline (1.41:1), a token the theme file reserves for decorative dividers, with no visible word on it, so what a user sees is a white arrow floating in space.

<details><summary>Closes 6 audit findings</summary>

- The Say hi bar's gradient does not cover the content it floats over

- The primary "Say hi" action sits in the translucent half of its own gradient, so the profile behind it ghosts through

- Content is legible directly behind the Say hi bar on Travelers

- On Travelers, the profile's own trip dates read through the "Say hi" button

- The Next control is an unlabelled arrow on a circle at ~1.5:1, using `hairline` where the brief says `border`

- Two floating docks on two tabs compute the same clearance with two different formulas, so the same chrome sits at two heights on one phone

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — replace the single LinearGradient at :398-406 with two inert siblings: a solid `theme.background` plate of exactly `actionBarHeight(insets.bottom)` pinned to bottom:0, and above it a LinearGradient `['transparent', theme.background]` with `locations={[0, 1]}`, `height: ACTION_BAR_RAMP`, `bottom: actionBarHeight(insets.bottom)`. The buttons then never sit on anything but opaque ground while the 32pt feather above them still reads.

- src/app/(tabs)/travelers.tsx — `actionBarHeight()` at :458-464: change `bottomInset / 2` to `bottomInset`. Line 409's `paddingBottom` becomes `BottomTabInset + insets.bottom + Space.sm` so the two expressions stay one formula. This is the 17pt drift that makes the Map's 'Drop a pin' pill and this bar sit at two different heights on the same phone.

- src/constants/theme.ts — add `export function tabDockBottom(bottomInset: number) { return BottomTabInset + bottomInset + Space.sm; }` next to `BottomTabInset` (:249), and use it in travelers.tsx:409 and src/features/matching/connected-notice.tsx:56 (which already uses the correct full-inset expression, so this is a rename, not a behaviour change). src/features/pins/map-screen.tsx:1377/:1403 and src/app/(tabs)/my-business.tsx:744/:759 carry the same two expressions and should adopt it in the same commit or be handed to whoever owns them.

- src/app/(tabs)/travelers.tsx — delete `ACTION_BAR_CLEARANCE = 148` (:449) and set the inner ScrollView's `paddingBottom` (:350) to `actionBarHeight(insets.bottom) + Space.xl`. The constant is currently double-counting BottomTabInset (198 of padding for a 135pt bar) and it is what would silently go short the moment the bar grows.

- src/app/(tabs)/travelers.tsx — `styles.nextButton` (:805-813): `borderColor: theme.border` not `theme.hairline`, `borderWidth: 1` not `StyleSheet.hairlineWidth`, and turn the 52pt circle into a pill (`height: ACTION_BUTTON`, `paddingHorizontal: Space.lg`, `borderRadius: Radius.pill`, `flexDirection: 'row'`, `gap: Space.xs`, `flexShrink: 0`) carrying the `arrow.right` symbol plus a `caption` 'Next' in `textSecondary`. Keep `accessibilityLabel="Next traveler"` — 'Next' alone is not unique in context.

**Tests.** New jest test src/app/**tests**/travelers-action-bar.test.ts asserting `actionBarHeight(34) === tabDockBottom(34) + Space.sm + ACTION_BUTTON`, so the plate can never drift from the bar it is covering. Re-shoot 17-travelers-signed-in.png at default type and again at Dynamic Type XXL and read both: no page text legible anywhere in or beside the bar, and the 'Both in Bangkok…' chip still fully visible at rest without scrolling.

**Risk.** The comment at :449-464 records the previous swing in the other direction, where a taller ramp erased the 'Both there Aug 23 – 28' chip that explains why this person is on screen. Splitting the plate from the ramp is what makes that trade go away rather than move, but it must be re-photographed to prove it. Growing the inset from half to full adds 17pt to the bar, which is exactly why the clearance has to become derived rather than a magic 148. The Next pill widens at large type against a `flex: 1` Say hi; check XXL before shipping.

### `tq-accept-push-copy` — Make the accept push say what happened instead of instructing a repeat

**Priority** now · **Effort** S · **Ships as** Supabase deploy only

The push that fires when somebody accepts your hello reads 'Chat open' / '{name} replied. Say hi.' It goes to the person who sent the first message, so it instructs them to redo the thing that just worked, and it is not true: respond_to_message_request creates the chat and the participant rows and writes no message, so the thread contains only their own sentence. The in-app card obeys the brief's mandated wording for this moment and the push invents its own, so a user who sees both within seconds gets two names for one event.

<details><summary>Closes 2 audit findings</summary>

- The accept push says "Say hi" to the person who already said hi, and renames an event the app already named

- The accept notification promises a reply that does not exist

</details>

**Changes**

- supabase/migrations/<new>\_the_accept_push_is_true.sql — `create or replace function public.enqueue_accept_push()` with title 'Chat open' and body `coalesce(v_name, 'A traveler') || ' said yes. Your chat is open.'`. Keep the `jsonb_build_object('type','accepted','chat_id', new.chat_id)` payload unchanged. Copy the current body verbatim from supabase/migrations/20260820001000_copy_pass.sql:292-310 and change only the two strings.

- supabase/migrations/20260820001000_copy_pass.sql — read only, to confirm this is the newest definition (chat_realtime.sql:237 precedes it; nothing later redefines it).

**Database.** One new migration replacing the enqueue_accept_push trigger function. No OUT columns, so no drop and no grants to restate.

**Tests.** Extend supabase/tests/database/05_message_requests.test.sql: accept a pending request as the recipient and assert the push_queue row's `user_id` is the sender, its `title` is 'Chat open', and its `body` contains neither 'replied' nor 'Say hi'. That is a pgTAP assertion because it is a database invariant about who is told what.

**Risk.** Almost none. This is a trigger function, so it has no OUT columns and `create or replace` is correct — the drop-function rule in AGENTS.md applies to `RETURNS TABLE` signatures and does not bite here. Avoid the word 'connected' in the push even though ConnectedNotice uses it: matching the card exactly is tempting, but 'said yes' is the vocabulary the rest of the send path already uses and the brief bans 'they said yes' only as a replacement for 'Connected with [name]' on the accept card, which is not being touched.

### `tq-send-path-honest` — Stop the composer destroying a draft, and stop it going quiet when it matters most

**Priority** now · **Effort** M · **Ships as** over the air

Three defects sit on the one path a hello travels. The live draft warning is wired `useDraftWarning(message, !blockedNotice)`, so the moment a send is refused the advisory preview switches off for every keystroke that follows: the person rewriting a blocked message types with no guidance and finds out by pressing Send again, which manufactures the second strike. When the daily cap fires, setCapped early-returns a full-screen card and the composer unmounts, so a message somebody spent two minutes on is simply gone, while the budget that would have prevented it was already fetched on mount with staleTime 0. And the push-permission ask is gated on `result.delivered`, which is false on every hello the moment require_llm_moderation is switched on, so satisfying hard rule 5 silently switches off the notification ask on the flow it was built for.

<details><summary>Closes 3 audit findings</summary>

- The live draft warning switches OFF exactly when it is needed most

- The push-permission ask stops firing the moment LLM moderation is switched on

- Hitting the daily cap destroys the message the person just wrote

</details>

**Changes**

- src/app/compose-request.tsx — line 67: `useDraftWarning(message, true)`. The preview RPC is read-only and swallows its own errors (src/features/matching/api.ts:62-68), so leaving it on costs nothing.

- src/app/compose-request.tsx — the two advisory cards at :260-278 become three branches driven by `risky` and `blockedNotice`: `risky && blockedNotice` keeps the red 'That message can't be sent'; `risky && !blockedNotice` keeps the highlight 'This might not go through'; `blockedNotice && !risky` renders a quiet 'That reads better. Send when you're ready.' so a rewrite has a visible finish line. Do not promise delivery — preview_first_message only runs the regex prefilter and cannot predict the LLM verdict.

- src/app/compose-request.tsx — the cap. Add a mount guard before the composer renders: when `budget.data && budget.data.used >= budget.data.allowed`, show the cap card immediately so nobody writes into a box that cannot send (gate on `budget.data` being loaded so it never flashes over an undefined query). For the mid-session case, replace the early `return` at :131-152 with an absolutely-positioned opaque overlay inside the same tree (`StyleSheet.absoluteFill` over an opaque `theme.background`), so `message` state survives, and give it two controls: 'Keep my message' → `setCapped(null)`, and 'Fair enough' → `router.back()`. Deliberately NOT a `<Sheet>`: the traps file records that a Modal presented while another is dismissing can kill touch for the whole app, and this screen is already a presented route.

- src/features/matching/hooks.ts — line 141: `if (result.delivered || result.queued)`. Line 132-137: add `queued: result.queued` to the `request_sent` analytics capture, or the §6 funnel goes blind on the same flag.

- src/app/(tabs)/travelers.tsx — add `useFirstMessageBudget()` and extend the Say hi label at :429 with a capped branch: 'No hellos left today', `disabled`. PrimaryButton renders disabled as a surfaceSunken fill with a textSecondary label (8.2:1), not a fade, so this stays legible while it says not-now. src/features/pins/map-screen.tsx:435 carries the same button and the same need — hand it to whoever owns the map.

**Tests.** jest: add a case to src/features/notifications/**tests**/primer-store.test.ts (or a new useSendRequest test) asserting `ask('hello-sent')` runs on a `{ delivered: false, queued: true }` result, so flipping require_llm_moderation cannot silently switch it off again. jest: a compose-request test that sets capped mid-session and asserts the `message` value survives the overlay. Maestro: extend e2e/flows/signed-in-tour.yml to open the composer, type a draft, and assert the composer is still mounted after a simulated cap — or, if the cap cannot be forced in E2E, cover it with the jest case and re-shoot the composer with the cap overlay up.

**Risk.** The 'That reads better' card must never read as a guarantee — the prefilter is not the moderator, and a promise here becomes a betrayal when the LLM blocks it anyway. The cap overlay must be opaque and must not use `<Sheet>`; a Modal-over-Modal race here is the dead-app trap the traps file documents. Turning the preview on unconditionally means one extra debounced RPC per rewrite, which is the point.

### `tq-pass-is-recoverable` — Make passing a traveler undoable, and make the pass say it happened

**Priority** now · **Effort** M · **Ships as** over the air

The Next control sits 12pt from a full-width Say hi on a screen thumbed one-handed. One mis-tap removes that person from the queue for fourteen days, with no toast, no undo and no visible record. Since a trip window is one to three weeks, fourteen days is functionally for this trip, and in a launch city holding six overlapping travelers a mis-tap loses one of six. The recovery control exists but is behind a door you can only reach by passing everybody, and it is all-or-nothing: it clears every pass you have ever made rather than the one you regret. A reading screen with a silent irreversible action is a trap, because nothing about reading suggests permanence.

<details><summary>Closes 2 audit findings</summary>

- Passing a traveler is irreversible for fourteen days, and the only undo appears after the queue is already empty

- Passing a traveler is irreversible until you have exhausted the entire queue

</details>

**Changes**

- src/features/matching/passed.ts — add `const remove = useCallback((userId: string) => persist(entries.filter((e) => e.id !== userId)), [entries, persist])` and return it alongside `has`/`count`/`add`/`reset`. The API today is add-or-clear-everything (:42-57).

- src/app/(tabs)/travelers.tsx — in `onNext` (:706-708), capture the name before `passed.add`, then set an `undo` state `{ id, name }` and a `restoredId` state (both declared with the other hooks above the early returns). Hold the dismiss timer in a ref and clear it on unmount and on the next pass, so a timer never outlives the screen.

- src/app/(tabs)/travelers.tsx — render the undo bar in `TravelersScreen` as a sibling of the `Animated.View` deck, not inside `TravelerPage`, so it survives the `key={current.userId}` remount. Position it at `bottom: actionBarHeight(insets.bottom)` with an opaque `theme.surface` plate and `Elevation.floating`, above the ramp's zIndex. Copy: 'Moved past {name}' with an 'Undo' control. Five seconds, dismissing on the next pass.

- src/app/(tabs)/travelers.tsx — Undo calls `passed.remove(id)` and `setRestoredId(id)`. Hoist a restored id to slot 0 the same way `spotlightId` already is at :556-563 (`queue.findIndex` then `queue.unshift(...queue.splice(at, 1))`), so undo returns the person you just passed rather than whoever happens to sort first. Clear `restoredId` once they are `current`.

- src/app/(tabs)/travelers.tsx — the empty-state control at :683-685: keep `passed.reset()` (all-or-nothing is right when the queue is already empty) but state the count before the action, using `countOf` from src/lib/plural: 'Show the {n} people you skipped'.

**Tests.** New jest test src/features/matching/**tests**/passed.test.ts (AsyncStorage is already mocked in jest.setup.js): add three, remove the middle one, assert the other two survive and the store was written; remove an id that was never added is a no-op; an entry older than the 14-day TTL is still dropped on load. Maestro: in e2e/flows/signed-in-tour.yml, after 17-travelers-signed-in, tapOn 'Next', assertVisible the exact string 'Moved past ' plus the demo name, takeScreenshot 17a-passed-undo, tapOn 'Undo', assertVisible the original name again. Assert the exact text a human reads, not a loosened matcher.

**Risk.** The undo bar floats over a scrolling page, so it must carry its own opaque ground or it repeats the exact defect tq-action-bar-ground exists to fix. I am deliberately not growing the scroll padding while it is up: a 5-second bar that reflows the page mid-read is worse than one that floats above it with a solid plate. `remove` re-inserts the candidate into the queue from `byUser`, and without the restored-id hoist the screen would jump to whoever sorts first rather than to the person you undid — that hoist is the part most likely to be skipped and most likely to be noticed.

**After.** `tq-action-bar-ground`

### `tq-queue-scope` — Tell the reader how many people are left, and let them pull to look again

**Priority** now · **Effort** S · **Ships as** over the air

The brief's intent for this screen is a reading screen, and a reading screen needs scope. Nothing says whether there are four people in Bangkok on your dates or four hundred, nothing says how many you have been through, and the docked bar is visible from the first pixel, so the screen feels like an endless feed you must keep feeding — the exact pressure a deck creates. The number already exists: queue.length is computed at :543 and used only to decide whether to render the empty state. Separately, Travelers is a queue that empties and the only recovery is switching tabs or force-quitting; the Chat tab's own comment says nothing in the app could be pulled to refresh, on the one screen people reflexively pull, and that was fixed for Chat and nowhere else.

<details><summary>Closes 2 audit findings</summary>

- The queue never tells you how many people are in it, so an unhurried reading screen behaves like an endless feed

- Only the Chat tab can be pulled to refresh

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — lift the spotlight ribbon out of the ScrollView's contentContainer (:353-368) into a fixed header row rendered as a sibling ABOVE the ScrollView inside `TravelerPage`, taking `paddingTop: insets.top + Space.sm` so the ScrollView's own paddingTop drops to `Space.sm`. Give the header `paddingHorizontal: Space.lg` and `paddingRight: HitTarget + Space.lg` so it clears the absolutely-positioned 44pt ProfileCorner avatar at large Dynamic Type.

- src/app/(tabs)/travelers.tsx — in that header, always render a `footnote`/`textSecondary` line: `{n} more on your dates in {city}` where n = `queue.length - 1` and city = `current.match.city_name`, reading 'Last one for now' at n === 0. Pass `remaining` into TravelerPage as a prop. Do not phrase it as a count of everyone in the city: the queue is already filtered by passed, existing chats and hellos already sent, and by the viewer's own audience setting.

- src/app/(tabs)/travelers.tsx — add a `RefreshControl` to the inner ScrollView (:340) driven by props from TravelersScreen: `refreshing={matchesQuery.isFetching}` and an `onRefresh` that refetches `matchesQuery` and `tripsQuery`. Import RefreshControl from react-native, mirroring src/app/(tabs)/chat.tsx:893.

- src/app/(tabs)/travelers.tsx — add `useFocusEffect` on the same refresh callback, the way chat.tsx:758 does, so a queue that emptied while the tab was off-stage recovers on return without a gesture.

**Tests.** jest: extract the count string into an exported helper (`remainingLine(n, city)`) and unit-test the three cases (n > 1, n === 1 wording, n === 0 → 'Last one for now'). Maestro: after 17-travelers-signed-in, assert the exact remaining line is visible, then swipe down on the hero and assert the screen still shows a traveler (a pull that navigates or blanks is the failure). Re-shoot 17: the hero now starts one line lower on a non-spotlight traveler and that is a picture decision, not a code one.

**Risk.** Moving the ribbon out of the scroller pushes the hero photo down by a line on every traveler, including the non-spotlight case where there is currently nothing above the photo. That is the trade: orientation costs vertical space on a screen whose whole pitch is the face. Re-shoot before believing it. A RefreshControl on a ScrollView whose first child is a full-bleed photo behaves normally, but the gesture must not fight the page scroll at the very top.

### `tq-guest-empty-city` — Stop the guest screen contradicting itself in an empty city

**Priority** now · **Effort** S · **Ships as** over the air

When featured_traveler returns nothing the screen renders 'Nobody in town this week.' and, immediately below it, a sign-up card whose reason reads 'See everyone else in town'. Two sentences on one screen saying opposite things, on the launch-day branch: LAUNCH_RUNBOOK step 4 purges the six demo travelers before real users arrive, so this is what a first-time visitor sees on day one in a new city. The brief names dead cities as failure mode number one in the whole category, and the code has no answer for it. The ternary at :234 already branches on `featured` — it just does not branch the reason.

<details><summary>Closes 2 audit findings</summary>

- The guest Travelers screen contradicts itself in an empty city, which is the launch-day state

- The Travelers card renders a portrait selfie at 3:2 landscape — the widest crop in the app on its most face-critical surface

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — the SignUpGate reason at :230-241: make it a function of `featured` on both branches. On the null branch use 'Be one of the first travelers here', so the contradicting pair can never co-render. This alone closes the defect.

- src/app/(tabs)/travelers.tsx — replace the bare 'Nobody in town this week.' (:232) with the evidence the map already has: call `useMapPins(cityId)` (src/features/guest/hooks.ts:59, already granted to anon through public_city_pins) and render the live count of plans in the launch city — 'No profiles to show yet. {n} plans are on the map in {city} this week.' — falling back to the plain sentence when the count is zero. This moves no data across a visibility boundary: it is the same faceless rows the guest map already serves.

- src/app/(tabs)/travelers.tsx — add `contentPosition="top"` to the guest card's hero Image (:174-178). `styles.cardHero` is `aspectRatio: 3 / 2` and `contentFit="cover"` keeps the middle 66% vertically, so a portrait photo whose face sits high loses the top of the head. Top-weighting the crop costs one prop.

**Tests.** jest: a small render test in src/app/**tests**/ asserting the two strings never co-occur — render GuestTravelers with `featured = null` and assert 'See everyone else in town' is absent. Maestro: re-shoot 03-travelers-guest.png, and add a second capture against a city with no featured traveler if the seed data allows one.

**Risk.** Do not name individual live pins to a signed-out guest. A real traveler's venue plus date is not guest content, and the guest photo path already goes through a dedicated signed-URL edge function precisely because the bucket is authenticated-only. An aggregate city count is the honest ceiling here. Keep the 3:2 ratio: the comment at :165-172 records that a full-height photo pushed the sign-up card off the bottom of the screen, which is the regression that mattered more.

### `tq-onboarding-skip-names-its-cost` — Make the trip skip say what it closes, and make the wall finish that sentence

**Priority** now · **Effort** S · **Ships as** over the air

Step 10's own subtitle calls the trip 'what puts you in front of the people who will be there when you are'. Its skip is a friendly 'I have not booked anything yet' and its footnote reassures you that you can still drop a pin and read the map. Both true, and both silent about the consequence: travelers.tsx returns the whole tab as 'Add a trip first' whenever trips.length === 0. The wall arrives later, on a different screen, with no memory that it was a choice the person made. Somebody who came to the app to meet people has been routed past the feature they came for by a button that read like a courtesy.

<details><summary>Closes 1 audit findings</summary>

- Skipping the trip step silently closes the Travelers tab, and the skip does not say so

</details>

**Changes**

- src/app/onboarding/index.tsx — line 469: change `skipLabel` to 'I'll add it later'. The skip only renders when `trips.length === 0` (the ternary at :468), so anything new has to sit inside that same branch.

- src/app/onboarding/index.tsx — add one line next to the skip, not inside the existing footnote at :479-484, which is already doing the reassurance job: 'Travelers stays closed until you do. The map does not.' src/features/signup/step-shell.tsx renders `skipLabel` as a lone PressableScale at :157-166, so this needs either a new optional `skipNote` prop on StepShell rendered directly beneath the skip, or the sentence appended into the step's own children above the footer.

- src/app/(tabs)/travelers.tsx — line 610: change 'Add a trip first' to echo the words the person read at signup, so the wall reads as the second half of a sentence rather than a surprise. Keep the 'Add a trip' button and the 'You'll see who's in town on your dates' line beneath it.

**Tests.** jest: src/app/**tests**/onboarding-sequence.test.ts already covers this flow — add an assertion that step 10's skip label and its note both render when there are no trips, and neither renders once a trip exists. Maestro: e2e/flows/onboarding-tour.yml, assert the exact new skip string is on the step. Re-shoot the trip step and the Travelers empty state so the two can be read side by side.

**Risk.** Keep the skip. Forcing a trip on somebody who has not booked is the worse outcome and would cost more signups than the closed tab costs. The only risk is length: adding a note beneath the skip on a step that already carries a footnote can crowd the footer at large Dynamic Type, so check the step at XXL.

### `tq-after-the-hello` — Delete the three unreachable button states and give the moment after a hello something to be

**Priority** next · **Effort** M · **Ships as** over the air

The queue filter drops every candidate present in `sentByRecipient` or `chatByUser` before `current` is chosen, so `sent` and `chatId` are always undefined for the rendered traveler: the label is always 'Say hi', `disabled` is always false, and `canOpen` in TravelerPage is always true. The file describes behaviour it cannot produce. What actually happens is that the composer's confirmation auto-pops after 1100ms and a different stranger's face has silently taken the page underneath, with no trace on Travelers that you said anything and no route back except finding it in Chat under 'You said hi'. The moment of highest intent in the whole product ends in a face swap nobody asked for.

<details><summary>Closes 2 audit findings</summary>

- Three of the action button's four states are unreachable dead code, and the state they were built for has no UI at all

- After you say hi, the screen's only primary button goes dead

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — delete the `chatId` and `requested` props from TravelerPage (:322-336), the `canOpen` derivation (:273), and the ternary at :429 so the label is just 'Say hi' (plus the capped branch from tq-send-path-honest). Delete the `sent`/`chatId` derivation at :686-689 and the props at :703-704.

- src/features/matching/last-hello.ts — new file: a tiny zustand store `useLastHello` holding `{ name: string } | null`, with `note(name)` and `clear()`. This is the signal Travelers has no way to get today, because `router.back()` carries nothing and the recipient has already been filtered out of the queue by the time the screen re-renders.

- src/features/matching/hooks.ts — in `useSendRequest.onSuccess` (:131-144), call `useLastHello.getState().note(recipientName)` on the delivered-or-queued branch. Pass the name through the mutation input alongside `recipientId`.

- src/app/(tabs)/travelers.tsx — render a dismissible strip in the same slot the undo bar uses (above the action bar, opaque `theme.surface`, `bottom: actionBarHeight(insets.bottom)`): 'Said hi to {name}. It's in Chat under You said hi.' whose tap routes to `/chat`. Auto-dismiss after ~4s and clear the store. Keep the auto-advance underneath: the comment at :544-551 records the founder rejecting a post-send state the traveler gets stuck behind, so this is a beat, not a resting state.

- src/app/(tabs)/chat.tsx — no change needed; SentHelloRow (:225-272) already sorts above the conversations under the 'You said hi' heading, so landing on the tab is enough.

**Tests.** jest: a unit test on the last-hello store (note then clear; a second note replaces the first). jest: assert the Say hi label has no `requested`/`chatId` branch left — a simple grep-style assertion in src/app/**tests**/ that the file no longer references `canOpen` is cheap insurance against the dead code coming back. Maestro: send a hello in e2e/flows/signed-in-tour.yml, assert the exact strip text is visible on Travelers after the composer pops, takeScreenshot 17b-said-hi, then assert it is gone.

**Risk.** Do not offer a 'Go to chat' link at this moment: a hello is a message_request behind the accept gate and passes moderation before delivery, so no chat id exists yet and the link would be dead. The strip must not block the next traveler — it floats, it does not gate. Two transient bars now share one slot (this and the undo bar); they must be mutually exclusive or one will land on top of the other.

**After.** `tq-action-bar-ground`, `tq-send-path-honest`, `tq-pass-is-recoverable`

### `tq-safety-on-the-card` — Put report and block on the screen where a stranger is first read, and give every control a word

**Priority** next · **Effort** M · **Ships as** over the air

Travelers is the screen a woman spends the most time on, one stranger at a time, and it carries no safety affordance at all. To report the man on screen she must open his full profile, scroll past photos, prompts, priorities, about, details and socials, and find two ghost buttons at the bottom. The incoming-hello card got this right with an inline 'Does this feel off? Tell us.'; the browse surface, where a creepy bio is actually first seen, got nothing. On the same card, one of three routes to the composer carries no visible word: the on-photo reply bubble is an unlabelled glyph while the two others read 'Reply' and 'Say hi', so a first-time user cannot tell whether it does something different.

<details><summary>Closes 2 audit findings</summary>

- On the screen where you decide whether to greet a stranger, there is no report or block at all

- Travelers offers three different controls that all send the same hello

</details>

**Changes**

- src/features/profile/actions-menu.ts — new file lifting the item list and the ActionSheetIOS/Alert fork out of src/app/chat/[id].tsx:128-168 into `openTravelerMenu({ userId, name, onBlock })` returning View profile / Report / Block, so the three surfaces stay identical rather than drifting.

- src/app/chat/[id].tsx — replace the inline `openMenu` body with a call to the shared helper, keeping the business branch (no 'View profile' for a business viewer) and the Leave chat / Archive tail as caller-supplied extra items.

- src/app/(tabs)/travelers.tsx — add an overflow control to the action bar row, next to the new Next pill, opening the shared menu for `current.userId`. The card has no header — the screenshot shows the skip arrow in the bottom row and nothing above the photo but the spotlight strip — so the bottom row is the honest anchor. `accessibilityLabel={`More about ${name}`}`.

- src/app/profile/[userId].tsx — move Report (:145) and Block (:153) out of the bottom of the actions stack into the same shared menu behind a header overflow, which also removes two full-width ghost buttons from a page that already carries five.

- src/features/profile/profile-view.tsx — line 100: delete the `onPhoto ? null : <ThemedText>Reply</ThemedText>` branch so the on-photo bubble reads 'Reply' like every other anchor. It already has its own `theme.surface` ground (:90) and a 44pt press through hitSlop (:87), so this is a width change, not a new component.

**Tests.** jest: extend src/features/profile/**tests**/profile-view.test.tsx to assert the on-photo reply control renders the visible word 'Reply', not only an accessibility label. jest: a unit test on the shared menu builder asserting the item labels and the destructive index for both the traveler and the business viewer. Maestro: tap the new overflow on Travelers and assert 'Report' and 'Block' are both present; re-shoot 17 so the bottom row can be read as three named controls rather than two and a smudge.

**Risk.** The action bar is getting crowded: Next pill, overflow, Say hi, all on one row above a tab bar, and Say hi is `flex: 1`. At Dynamic Type XXL this is the row most likely to wrap or squeeze the primary action to nothing — check XXL before shipping and be willing to drop the overflow to a corner overlay on the photo instead. profile-view.tsx is shared with the Profile surface, so the 'Reply' word change shows up on every profile page too; that is intended, but it is another agent's screenshot to re-read.

**After.** `tq-action-bar-ground`

### `tq-incoming-hello-card` — Put the city and the dates on the card you decide on, and make declining recoverable

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

RequestCard shows a photo, name, age, seal, the anchor phrase, the message, a report line and two buttons. It does not show where this person will be, when, or how long ago they wrote. The entire premise of the app is a shared city on shared dates and that is the one fact missing from the screen where it is decided, which is why the card's own subtitle has to say 'view full profile'. Declining fires no haptic, shows no confirmation and offers no undo — the card simply disappears on the next invalidate, which is indistinguishable from a render glitch — and unique(sender_id, recipient_id) makes it permanent. And every waiting hello renders as a full card with an unclamped 500-character message and no cap, so twenty pending hellos is twenty stacked cards before the first real conversation.

<details><summary>Closes 3 audit findings</summary>

- The card you decide on omits the city and the dates the whole product is built on

- Decline is one silent, unconfirmed, permanent tap next to Accept

- Every waiting hello renders as a full card above the inbox, with no cap and no length limit

</details>

**Changes**

- supabase/migrations/<new>\_a_hello_says_where_and_when.sql — `drop function public.incoming_requests();` then recreate it with three added OUT columns (`overlap_city text, overlap_start date, overlap_end date`) via a lateral join from the sender's active trips to the caller's own, then restate `revoke execute on function public.incoming_requests() from public, anon;` exactly as supabase/migrations/20260816200000_trips_matching.sql:728-734 does. The function is deliberately SECURITY INVOKER — keep it that way: the trips_select_overlap policy (trips_matching.sql:286-296) already gates the join to a genuine overlap, so a pin-sourced hello simply returns nulls and renders no chip, which is correct.

- src/lib/database.types.ts — add the three columns to `IncomingRequestRow`.

- src/app/(tabs)/chat.tsx — RequestCard (:145-214): render the overlap as the same accent chip the traveler page uses, reusing the exact string src/app/(tabs)/travelers.tsx:731 builds ('Both in {city} {formatDateRange(...)}') so the two surfaces cannot drift. Add the relative timestamp to the card's top right from `request.created_at`, which incoming_requests already returns and the card already drops, using `rowTimestamp` from src/features/chat/separators.ts:53.

- src/app/(tabs)/chat.tsx — `act(false)` (:130-143): add `haptics.selection()` on the decline press, and keep the card mounted for ~5s showing 'Declined. Undo' before calling `respondToRequest`. A deferred call, not a declined-to-pending reversal: adding a reverse arm to respond_to_message_request means a second write path and a new guarded branch for no user-visible gain. Do not demote the button — primary-button.tsx already renders `variant='ghost'` as transparent, unraised, 44pt against Accept's 52 with no press haptic.

- src/app/(tabs)/chat.tsx — line 174: clamp `first_message` to `numberOfLines={4}` with a tap to expand. Line 969-978: past a threshold of three, replace the map with one row (count plus stacked avatars) that pushes a new src/app/hellos.tsx rendering the same RequestCard list, so the accept/decline logic is written once.

**Database.** One migration: drop function public.incoming_requests() first, recreate with three added OUT columns, restate the revoke from public, anon.

**Tests.** pgTAP: extend supabase/tests/database/05_message_requests.test.sql — a recipient with an overlapping trip sees the city and both overlap dates; a recipient with no overlapping trip (a pin-sourced hello) sees nulls and no leak of the sender's trip; the caller sees nothing for a request addressed to somebody else. That is the attack, not the happy path. jest: a unit test on the shared overlap-string builder proving Travelers and RequestCard produce the identical sentence. Maestro: re-shoot the Waiting-on-you section with a card carrying the chip and the timestamp, and a second shot with four pending hellos collapsed to one row.

**Risk.** The drop-function-first rule bites here: this changes OUT columns on a RETURNS TABLE function, so a `create or replace` deploy fails after the migration's earlier statements have applied. Restate the revoke after the drop. The undo window means a decline is not written for five seconds — if the app is backgrounded or the tab unmounts inside that window the decline must still fire, so the timer needs an unmount flush rather than a silent cancel. The /hellos threshold hides cards behind a tap; below three they must stay inline, since one or two waiting hellos genuinely belong there.

### `tq-hello-that-ends` — Give an unanswered hello a date and an ending

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

request_status declares an 'expired' value and nothing in the schema ever writes it, so a pending hello sits in the recipient's 'Waiting on you' and the sender's 'You said hi' permanently. SentHelloRow shows a fixed trailing word 'Sent' and nothing else, even though sent_requests already returns created_at, so a hello from three weeks ago in a city you have left is visually identical to one sent an hour ago. Eight a day over a two-week trip leaves twenty-odd dead rows stacked above the conversations that actually matter.

<details><summary>Closes 1 audit findings</summary>

- A hello nobody answers never ends, cannot be withdrawn, and has no date on it

</details>

**Changes**

- src/app/(tabs)/chat.tsx — SentHelloRow (:263-267): replace the hardcoded 'Sent' with `rowTimestamp(request.created_at)` from src/features/chat/separators.ts, the same helper the conversation rows already use. This must not become a status: the row's whole contract is that it never reveals a read, a decline or a moderation stop.

- supabase/migrations/<new>\_a_hello_that_nobody_answers_ends.sql — `create or replace function public.expire_message_requests()` flipping pending rows to 'expired' once the sender's latest active trip has ended, or after 30 days when there is no trip, returning the count. Revoke execute from public, anon, authenticated. Schedule it under the same `pg_available_extensions` guard the other sweeps use (supabase/migrations/20260822180000_daily_spotlight.sql:194-203 is the pattern).

- supabase/migrations/<new>\_a_hello_that_nobody_answers_ends.sql — the filters. incoming_requests() already reads `status = 'pending'` so expired rows fall out of the recipient's inbox with no change. sent_requests (20260816200000_trips_matching.sql:618-650) maps status into a flat `state`; confirm an expired row maps to something the client drops, and if not, exclude it there — which is an OUT-value change, not an OUT-column change, so `create or replace` is safe.

- src/lib/database.types.ts — no change if 'expired' is filtered server-side; if it is surfaced, widen SentRequestRow['state'].

**Database.** One migration adding public.expire_message_requests() plus its pg_cron schedule, and possibly a create-or-replace of sent_requests() to filter the new state. No OUT columns change, so no drop needed unless sent_requests gains a column.

**Tests.** pgTAP: a new case in supabase/tests/database/05_message_requests.test.sql — a pending request whose sender's trip ended yesterday is flipped to 'expired' by the sweep and disappears from both incoming_requests() and sent_requests(); an accepted request is untouched; the unique(sender_id, recipient_id) constraint still holds afterwards, so expiry does not free a re-send. jest: extend src/features/chat/**tests**/separators.test.ts if rowTimestamp needs a case for a several-week-old ISO date.

**Risk.** Do not hard-delete on expiry and do not build a withdraw that deletes. trips_matching.sql:394 records unique(sender_id, recipient_id) as 'one shot per direction, ever (anti-pester)', and freeing that row turns withdraw-and-resend into exactly the pester loop the constraint closes. Expiring the row keeps the constraint while clearing both lists. The sweep touches rows the recipient can see, so run it against a copy first and check the count it returns before scheduling it.

### `tq-next-traveler-prefetch` — Have the next traveler's face already downloaded when the card turns

**Priority** next · **Effort** S · **Ships as** over the air

The core loop of the product is read a person, tap Next, read the next person. What happens instead is that the new page mounts, fades in over 200ms, and only then fires the chain: usePublicProfile and usePublicPhotos on mount, then usePhotoUrl for a signed URL, then the image download. So the first thing you see of every traveler is an empty surfaceSunken frame where their face goes, and the photo is the entire pitch of the screen. `grep -rn prefetch src/` returns nothing — the app prefetches nothing for anyone.

<details><summary>Closes 1 audit findings</summary>

- Next on Travelers starts a signed-URL round trip after the card has already appeared

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — add `useQueryClient()` (the file has none today) and an effect keyed on `queue[0]?.userId` that prefetches for `queue[1]` and `queue[2]`: `['public-profile', userId]`, `['public-photos', userId]` and `['photo-url', candidate.match.photo_path]`. The match row already carries photo_path, so the signed URL can be fetched without waiting on the photos query. Then call `Image.prefetch(url)` from expo-image once the signed URL resolves. Two ahead, not the whole queue.

- src/features/profile/profile-view.tsx — line 63: add `transition={Motion.quick}` to the hero `Image` so a photo that still arrives late crossfades into the frame instead of snapping.

- src/features/profile/hooks.ts — read only. usePhotoUrl (:210) already carries `staleTime: 50 * 60 * 1000` against a `SIGNED_URL_TTL_SECONDS = 60 * 60` mint (src/features/profile/api.ts:17), so a prefetched URL is good for an hour and the five-minute TTL some findings assumed applies only to the guest featured-photo edge function.

**Tests.** jest: a unit test asserting the prefetch effect asks for exactly the three keys for queue[1] and queue[2] and nothing for queue[3] (mock queryClient.prefetchQuery and assert the key list). Screenshots cannot prove this one — the evidence is a hand-run on a throttled connection, tapping Next and watching whether the frame is ever empty.

**Risk.** Nothing here crosses a visibility boundary: it is the same rows the viewer is already served, fetched one card earlier, through the same RLS-gated queries. The real risk is quantity — prefetching the whole queue would mint a signed URL for every traveler in the city and fill the image cache with faces nobody looked at. Two ahead is the ceiling.

### `tq-shared-language` — Show the shared language the match score already spends 18 points on

**Priority** next · **Effort** S · **Ships as** over the air

spotlight_score weights a shared language at 6 points each up to 18, against 84 from overlap and 12 from verification — the second-heaviest term it has — and then spends it entirely on ordering. For a non-English traveler this is the single fact most likely to turn a card into a conversation, and it is computed server-side and discarded before it reaches the screen. It needs no migration: get_matches already returns `languages` (supabase/migrations/20260823030000_profile_visibility.sql:136), and the viewer's own are on their own profile.

<details><summary>Closes 1 audit findings</summary>

- Shared language is the second-heaviest term in the match score and is never shown to anyone

</details>

**Changes**

- src/features/matching/shared-language.ts — new file: `sharedLanguages(mine: string[] | null, theirs: string[] | null): string[]`, intersecting the two and dropping 'en' when it is the only match, so the line carries information rather than filling space.

- src/app/(tabs)/travelers.tsx — call `useOwnProfile()` (src/features/profile/hooks.ts:47) alongside the existing queries, compute the intersection against `candidate.match.languages`, and pass the first result through to ProfileView as an `alsoSpeaks` string built with `languageLabel` from src/constants/languages.ts:202.

- src/features/profile/profile-view.tsx — add an optional `alsoSpeaks?: string | null` prop threaded to `Identity` (:571-589) and rendered as a second pill beneath the existing overlap pill (:625-631), using the same `styles.overlapPill` geometry in a quieter fill so it reads as supporting the overlap chip rather than competing with it.

**Tests.** jest: src/features/matching/**tests**/shared-language.test.ts — two travelers sharing Portuguese and English return Portuguese only; sharing only English returns nothing; a null languages array on either side returns nothing; order follows the viewer's own list so the same pair renders the same way for both people. Re-shoot 17 with a demo traveler who shares a non-English language.

**Risk.** The line must never appear when the only overlap is English, or it becomes noise on the majority of cards and trains people to ignore the row the overlap chip lives in. Two pills stacked under the name at large Dynamic Type will push the hero text taller — check XXL, since the hero height is a fixed ratio and the text sits on the scrim.

### `tq-guest-more-faces` — Show a guest three travelers before the wall, not one

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

A guest is shown one person, told 'Make a profile to see theirs', and stops. The brief's rule is that the account is asked for at the moment of action, never at the door — but the second person is a door. The category's number one killer is dead cities, and one face cannot answer 'are there people here on my dates'; three can. The RPC serving this is already SECURITY DEFINER returning a safe projection, and the photo already comes through a server-signed edge function, so the privacy argument in the code's comment covers the profile route, not the count.

<details><summary>Closes 1 audit findings</summary>

- A guest sees exactly one traveler and then a wall, on a tab whose whole job is proving the city is not dead

</details>

**Changes**

- supabase/migrations/<new>\_a_guest_sees_more_than_one.sql — `create or replace function public.featured_traveler(p_city_id int)` changing `limit 1` to `limit 3`, body otherwise verbatim from supabase/migrations/20260830000000_a_business_is_served_no_travelers.sql:234-289. Same OUT columns and same argument list, so no drop is needed. Keep the anon grant and the `viewer_is_business()` guard exactly as they are.

- supabase/functions/featured-photo/index.ts — return `{ urls: (string | null)[] }` by mapping the signed-URL mint over the rows instead of taking `data?.[0]` (:51). Keep TTL_SECONDS at 300 and keep the city-in, server-picks-the-person contract: the caller still cannot name a path or a user. Deploy with `supabase functions deploy featured-photo`.

- src/features/guest/hooks.ts — `useFeaturedTraveler` (:126-140) returns the full array rather than `[0]`; `useFeaturedPhoto` (:158-175) returns the url list. Both keys stay city-scoped.

- src/app/(tabs)/travelers.tsx — GuestTravelers (:106-245) renders the rows as a vertical list of the existing card, with the SignUpGate after the third. Keep the tap behaviour exactly as it is (scroll to the gate), because the profile route is unreadable signed-out and a push would be a tap that silently does nothing.

**Database.** One migration create-or-replacing featured_traveler with limit 3. Same OUT columns and same arguments, so no drop; the anon and authenticated grants survive a create-or-replace and need no restating.

**Tests.** pgTAP: extend supabase/tests/database/10_rooms_guest_mode.test.sql (or the guest-mode suite) — anon gets at most three rows, never a business account, never a non-discoverable owner, and never a traveler whose trip has ended. Maestro: re-shoot 03-travelers-guest.png at 6.1 inches and prove the sign-up card is still on screen without scrolling; that is the exact regression the compact card was introduced to fix, and three cards is what would re-break it.

**Risk.** This widens what a signed-out device sees from one face to three, which is a founder call rather than a code call. It also spends an edge function deploy, so the app and the backend must land together or a guest gets one photo and three cards. The layout risk is real and photographed once already: three 3:2 cards plus a gate is taller than a phone, so the gate must either dock or the third card must be partially cut with the gate immediately under it.

**Waits on.** Should a signed-out visitor see three travelers or one? For: dead cities are the category's number one killer and one face cannot answer 'are there people here on my dates', which is the question the whole tab exists to answer on launch day. Against: it triples what an anonymous device is shown of real travelers who consented to a discovery surface, not to a shop window, and it spends an edge function deploy plus a layout the compact card was specifically built to protect.

**After.** `tq-guest-empty-city`

### `tq-did-you-meet` — Ask, once and privately, whether two travelers actually met

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

The founder can currently see how many hellos are accepted and nothing about whether anyone got a coffee out of it. Those two numbers can move in opposite directions, and the one that decides whether the product works is the one nobody is collecting: §6 lists request-to-accept rate and in-trip retention, with no meet signal among them. For the traveler it is smaller but real — a conversation that produced a night out and one that died after four messages look identical in the list forever.

<details><summary>Closes 1 audit findings</summary>

- Nothing ever asks whether two travelers actually met

</details>

**Changes**

- supabase/migrations/<new>\_did_you_two_meet.sql — a `chat_meet_answers` table (chat_id, user_id, answer enum yes/no/unsure, created_at, primary key (chat_id, user_id)), RLS on, self-insert and self-select only, revoked from anon. Plus a `meet_prompt_due(p_chat_id uuid)` helper or an OUT column on my_chats — if it goes on my_chats that changes OUT columns and the migration must drop the function first and restate its revoke (20260816200000_trips_matching.sql:728-734).

- src/features/chat/meet-prompt.tsx — new component: one quiet card at the top of the thread reading 'Did you two end up meeting?' with Yes / No / Not sure, rendered once per chat after the shared trip window has ended and dismissed permanently on answer.

- src/app/chat/[id].tsx — mount the card above the thread when it is due.

- docs/PRODUCT_BRIEF.md — add the resulting rate to §6 as the metric this exists to produce. Without that line the mechanic has no owner and no reason to survive the next audit.

**Database.** New chat_meet_answers table with RLS, plus either a helper function or a drop-and-recreate of my_chats() if the due flag is projected there (OUT columns change, so drop first and restate the revoke).

**Tests.** pgTAP: a new supabase/tests/database file — a participant can insert exactly one answer for a chat they are in, cannot read the other participant's answer, and cannot insert for a chat they are not in. That last one is the attack. jest: a unit test on the due-date logic (the prompt appears the day after the last shared date, never before, never twice). Screenshot the card in the thread.

**Risk.** Do not ship anything called 'We Met' in code or in copy: §7 bans dating-app grammar and the name is the grammar. The answer must be private, never surfaced to the other person, and never an input to visibility or ranking — the moment it becomes either, it is a rating of a person and the whole product changes shape. The prompt is also the first thing in the app that asks a traveler for something rather than offering something, so it gets one appearance and a permanent dismissal.

**Waits on.** Is the only number that says the product works worth one tap from every traveler after every trip? For: accept rate and meet rate can move in opposite directions and the app currently measures the wrong one, so there is no evidence the product does its job. Against: it is the first thing in the app that asks rather than gives, it needs a table, an RLS suite and a §6 amendment, and a low answer rate produces a number too noisy to act on.

### `tq-store-review` — Ask for a review once, at the accepted-chat moment and nowhere else

**Priority** later · **Effort** S · **Ships as** EAS build

**Status: DEFERRED, not done (2026-09-01).** Nothing in this package is in the tree. `expo-store-review` is not a dependency, `useAcceptedCelebration` calls nothing, and no jest test covers it — so do not read the paragraphs below as a description of shipped behaviour. It is deferred on its own "Waits on" question: this is a native module, so it cannot ship over the air, and an EAS build draws down real credit on a pre-launch app with no users for the prompt to convert. The four things that have to land together, and the rules for when the prompt may fire, are written up in [`APP_STORE.md`](APP_STORE.md) under "Queued for the next build" so that whoever spends the build has them; that write-up is the whole of what was produced here. Un-defer it when the next native change is queued and batch the two.

Everything about this product is free, so App Store search ranking and the star rating are the whole of paid acquisition. Nothing converts a genuinely good moment into a review, so the rating will be shaped entirely by the minority who arrive at the listing angry. The moment already exists and is already detected: useAcceptedCelebration fires when a hello you sent turns into a chat, and it is already careful not to fire in a burst on a fresh install.

<details><summary>Closes 1 audit findings</summary>

- There is no App Store review prompt anywhere, on an app whose only paid channel is not existing

</details>

**Changes**

- package.json — add `expo-store-review`.

- src/features/matching/use-accepted-celebration.ts — after the notice is dismissed, call `requestReview()` once per install, gated behind at least one prior session so it can never fire during onboarding. Reuse the existing AsyncStorage seen-set pattern (:46-64) for the once-per-install flag rather than adding a second store.

- src/features/matching/connected-notice.tsx — no change; the review ask must follow the dismissal, not ride on top of the card.

**Tests.** jest: a unit test that the review call fires on the first accepted chat and never again, and never on the seeded first-run set (which is already marked as old news at :55-58). There is no screenshot for this — Apple owns the dialog and throttles it — so the evidence is a TestFlight build and a hand-run.

**Risk.** This is a new native module, so it needs an EAS build rather than an over-the-air update, and builds draw down real credit — batch it with whatever other native change is queued. Apple throttles the prompt itself, so no custom pre-prompt is needed and none should be added. Firing it at the wrong moment (during onboarding, or twice) is worse than not firing it at all.

**Waits on.** Spend an EAS build on a review prompt now, or wait and batch it? For: the rating is the entire paid acquisition channel and the accepted-chat moment is the best one the app will ever have. Against: it is a native module on a pre-launch app with no users, so the prompt has nothing to convert yet, and the build credit is better spent on a native change that unblocks something.

## Profiles: viewing, editing, trips, priorities, visibility, verification

Fifty-one findings collapse into twenty packages, and they cluster into five real problems. First, the profile's own vocabulary is wrong in a way that corrupts data the recipient reads: `priority` and `priority:{slot}` are emitted by profile-view and by the composer's own chip row, and `parseAnchor` has no branch for either, so a hello answering "Learn to dive" arrives announced as being about a bio the person may not have. Second, the reply mechanic — the product's whole thesis — is drawn as the smallest thing in each section while the obvious target beside it is inert, and on a stranger's profile reached from a pin the only full-width buttons are Report and Block. Third, the photo path contradicts itself in writing: photo-grid.tsx's own comment concludes "take the square they approved and show it as a square" and the code still renders 4:5, there is no camera on the one mandatory step, and a denied Photos permission leaves a plus tile that does nothing forever. Fourth, profile-me is a Settings screen wearing a profile's clothes, with no blocked list, no account email, and no way back in for a named guest. Fifth, the visibility screen — the one the research says keeps women on the platform — renders four of five options at 0.45 opacity and clips the sentence that explains them. Two audit claims did not survive reading the code and I have corrected them in place: profile-hero.tsx is dead code that nothing imports, so "fix its aspectRatio" would have changed nothing on screen; and ProfileView contains no router call at all, so the comment justifying `owner={false}` on onboarding step 13 is wrong about its own component. What the founder is really deciding here is one thing: whether a profile photo is a square the person approved or a 4:5 frame the app crops for them. Everything else in the photo cluster follows from that answer.

### `prof-anchor-vocabulary` — Teach the anchor parser about priorities, and use one verb for saying hi

**Priority** now · **Effort** S · **Ships as** over the air

A hello anchored on someone's top priority is announced to the recipient as being about their bio, and if they have no bio the app is claiming a hello came from an empty field. The same screen also uses two verbs for one act: a chip reading "Reply" beside a stranger who has said nothing, and a "Say hi" button on the same card. And the Top priorities chip announces itself to VoiceOver as "Say you're in" while displaying the word "Reply", which fails WCAG 2.5.3 on the one control the whole mechanic rests on.

<details><summary>Closes 4 audit findings</summary>

- A hello anchored on a top priority is announced to the recipient as being about their bio

- The composer defaults to a bio anchor without checking there is a bio

- "Reply to their travel plans" asks a traveler to reply to someone who has said nothing to them

- The "Reply" chip on Top priorities announces itself to VoiceOver as "Say you're in", a name the button does not display

</details>

**Changes**

- src/features/chat/anchors.ts — add `{ kind: 'priority' }` to the Anchor union; in parseAnchor (:33-56) branch on `element === 'priority' || element.startsWith('priority:')` BEFORE the bio fallback. anchorStartedFrom → `Started from something on ${whose} list`; anchorAboutYours → `something on your list`. Keep bio as the last-resort fallback for unknown keys, which is deliberate.

- src/features/chat/**tests**/anchors.test.ts — add priority cases to all three describes. The case at :4 is titled 'reads every anchor the composer can emit' and asserts a completeness that is currently false. Add a guard that imports the composer's option list and fails when any value parses to 'bio'.

- src/app/compose-request.tsx — export ELEMENT_OPTIONS (module-private const at :28-36) so the guard test can read it; change :59 `useState(params.element ?? 'bio')` to `?? 'trip'` (the file's own comment at :28-30 calls trip "the one anchor that always exists"); change :202 'What are you replying to?' to 'What are you saying hi about?'.

- src/app/(tabs)/travelers.tsx:736 — the no-overlap fallback `{ key: 'bio', label: 'their bio' }` becomes `{ key: 'trip', label: 'your dates together' }`. Both people are there by definition of the match even when formatDateRange has no computed overlap to quote.

- src/features/profile/profile-view.tsx:110-116 — REPLY_LABELS becomes 'Say hi about their bio' / 'their details' / 'their travel plans'; :159 fallback string to match; :330 `Reply to "{prompt}"` → `Say hi about "{prompt}"`; :367 `Reply to photo N` → `Say hi about photo N`; :802 'Reply to this photo' → 'Say hi about this photo'.

- src/features/profile/profile-view.tsx:66-107 — ReplyButton gains a `text?: string` prop rendered at :100-104 in place of the hardcoded literal 'Reply'. Default text 'About this'. Top priorities passes text "I'm in" with accessibilityLabel `I'm in. ${priorities[0].text}.` so the visible name is inside the accessible name. Do NOT make the visible chip say 'Say hi': 17-travelers-signed-in.png shows the primary on the same card already reads 'Say hi', and two differently-scoped controls must not carry identical text.

- src/features/profile/profile-view.tsx:239 — leave the priority chip's own accessibilityLabel alone. Its visible text IS `priority.text` and the label already contains it, so 2.5.3 is satisfied there; changing it is churn.

**Tests.** jest: anchors.test.ts gains `parseAnchor('priority')` and `parseAnchor('priority:2')` → `{kind:'priority'}`, plus both renderers, plus the ELEMENT_OPTIONS completeness guard that fails when a new chip value has no branch. Maestro (e2e/flows/signed-in-tour.yml): assert the chip beside 'Travel plans' reads 'About this', not 'Reply'. Re-shoot 17-travelers-signed-in.png.

**Risk.** profile_element is persisted on message_requests, so old rows already carry 'priority' and start rendering correctly — no back-compat break, and nothing has to be migrated. Changing the composer default from 'bio' to 'trip' is only reachable from paths that pass no element; the pin sheet always passes `pin:...` (map-screen.tsx:444) and Travelers now passes 'trip', so no path can claim shared dates that do not exist. Check every new string against the design-review banned list before shipping: no em dashes, and 'request' never means a message.

### `prof-stranger-actions` — Give a stranger's profile a docked Say hi, and stop it offering one you already sent

**Priority** now · **Effort** M · **Ships as** over the air

Reached from a map pin, a stranger's profile ends in Report (ghost) and Block (danger). The only way to start a conversation is a 26pt chip in a section header. Worse, the page never reads useSentRequests, so every reply chip stays live for someone you already wrote to — and the app routes you there itself from the Chat tab's "You said hi" row, straight into a unique-constraint rejection. The Travelers tab already solved both; the map's own terminal surface did not.

<details><summary>Closes 3 audit findings</summary>

- A stranger's profile page offers Report and Block as its only full-width buttons, and no way to say hi

- Saying hi to somebody you already messaged is a dead end that destroys the message

- Both profile screens open with an empty navigation bar and never name whose page you are on (the /profile/[userId] half)

</details>

**Changes**

- src/components/ui/docked-action-bar.tsx (new) — lift the `actionBackdrop` + `actionBar` block from src/app/(tabs)/travelers.tsx:398-434 with its constants at :455-464 (ACTION_BAR_RAMP, ACTION_BUTTON, actionBarHeight, ACTION_BAR_CLEARANCE) and its styles at :788-817. Props: primaryLabel, onPrimary, disabled, optional secondary circle, and an explicit bottomInset so a stacked screen with a nav header does not add BottomTabInset.

- src/app/(tabs)/travelers.tsx — render the extracted component; keep passing the same actionBarHeight into the scroll clearance so 'Both there Aug 23 - 28' is not re-buried (the run-44 regression the comment at :450-462 documents).

- src/app/profile/[userId].tsx — import useSentRequests (src/features/matching/hooks.ts:34); `alreadySaidHi = sentRequests.some(r => r.recipient_id === userId && r.state === 'sent')` ('sent' also covers pending_moderation and a silent decline, which is what invariant 4 wants). When `!known`, mount DockedActionBar labelled `Say hi to ${name}`, anchored the way travelers.tsx:715-737 does; when alreadySaidHi, render it disabled reading 'Message sent' exactly as travelers.tsx:429-430 already does, and pass `onRespondTo={undefined}`.

- src/app/profile/[userId].tsx — add paddingBottom to styles.content equal to the bar height so nothing rests under it. Add a quiet line in the `actions` slot when alreadySaidHi: "You said hi. It'll be in Chat if they answer."

- src/app/profile/[userId].tsx — move Report (:146) and Block (:153) out of the page body into a nested `<Stack.Screen options={{ headerTitle, headerRight }} />` overflow. Lift the openMenu pattern verbatim from src/app/chat/[id].tsx:128-168 (ActionSheetIOS with a destructiveButtonIndex, Alert fallback off iOS). Set headerTitle to the display name here, not in \_layout.tsx:292, because the name only exists once the profile query resolves.

- src/features/pins/map-screen.tsx:433-455 — same useSentRequests check on the pin sheet; when a hello is already sent, replace the unconditional Say hi PrimaryButton with the disabled 'Message sent' state.

**Tests.** Maestro (e2e/flows/signed-in-tour.yml): tap a map pin, open the profile, assert 'Say hi to Theo' is visible without scrolling and that no 'Block' button exists in the page body; send a hello; return through the Chat tab's SentHelloRow and assert 'Message sent'. Screenshots: a new shot of the pin-reached profile at rest, and re-shoot the pin sheet.

**Risk.** The bar is absolutely positioned over a ScrollView. The backdrop must stay `pointerEvents="none"` and the bar `box-none`, or this becomes the hit-testing trap the traps skill records. Do not carry BottomTabInset onto a stacked screen — it will float the bar 49pt too high. Report must stay reachable in two taps; App Review requires in-app reporting and moving it into an overflow is only acceptable because the overflow is in the nav bar, always on screen. The audit called this "no way to say hi"; that overstates it, `onRespondTo` is wired for `!known` at :89-102, so a 26pt path exists today.

### `prof-page-chrome` — Make the audience rows readable, unclip the note under them, and name both profile screens

**Priority** now · **Effort** M · **Ships as** over the air

For every account on day one, four of the five rows on "Who you see, and who sees you" are dimmed to 0.45 and one of them is the women-only filter the research names as the reason women stay. Tapping a dimmed row does nothing at all. The sentence that explains the greying is cut mid-word at the scroll edge. On the profile itself the same setting shouts in all-caps against four Title Case headers below it, sits flush against the identity card in the same fill, and both profile screens open with a blank 110pt navigation bar.

<details><summary>Closes 5 audit findings</summary>

- The safety filter's four options are rendered at 0.45 opacity with the reason stated underneath them

- The paragraph explaining the gendered options is cut off mid-sentence behind the Done button

- One ALL-CAPS section header survives on the profile, against Title Case everywhere else

- The topmost card on your own profile is the app's last all-caps label, and it touches the identity card below it

- Both profile screens open with an empty navigation bar and never name whose page you are on (the profile-me half)

</details>

**Changes**

- src/features/profile/audience-picker.tsx:62 — delete `opacity: locked ? 0.45 : 1`. Instead render a `lock` SymbolView in the trailing slot at :68-75 (where the checkmark sits) tinted textTertiary, and set the locked row title to `themeColor="textSecondary"`. Measured: #A6A9C4 on #20243D is 6.6:1, against roughly 3.3:1 for the title and 2.4:1 for the detail once 0.45 composites the whole row. (The audit's 2.7:1 and 1.7:1 figures are wrong; the conclusion is not.)

- src/features/profile/audience-picker.tsx:55 — append ". Needs the verified badge. Opens verification." to the row accessibilityLabel when locked.

- src/features/profile/audience-picker.tsx:37-42 — `pick()` on a locked row must not return silently. Take an `onLockedPress?: () => void` prop; src/app/visibility.tsx passes `() => router.push('/verification')`. Onboarding passes nothing for now: \_layout.tsx:287 puts the verification route inside `Stack.Protected guard={signedIn && onboarded}`, so a push from step 12 resolves to nothing (prof-onboarding-badge-door fixes that).

- src/features/profile/audience-picker.tsx:144 — `WHO YOU SEE, AND WHO SEES YOU` becomes `Who you see, and who sees you`, keeping `type="caption"`, matching the title of the screen it opens (visibility.tsx:35) and the four Title Case headers under it. docs/DESIGN.md:336 retired ALL-CAPS. Decide the pattern once and apply it to the other two survivors, src/app/room/[id].tsx:568 and src/app/business-signup.tsx:797, so the app is not inconsistent in both directions.

- src/app/visibility.tsx:71-75 — move AUDIENCE_GENDER_NOTE above `<AudiencePicker>` or fold it into the StepScreen subtitle beside AUDIENCE_BOTH_WAYS. Adding bottom padding fixes nothing: in src/components/form/step-screen.tsx:71-118 the footer is a SIBLING of the ScrollView inside KeyboardFloor, not an overlay, so the sentence is clipped at the scroll viewport edge and more padding just adds empty scroll below the same clipped line. Leave AUDIENCE_NEEDS_BADGE and the Get verified button where they are — the comment at :57-60 records that placement being fixed after E2E run 55.

- src/app/profile-me.tsx:489-491 — `pageContent` currently sets only paddingBottom, so the AudienceCard is flush against the identity band in the same fill. Add `gap: Space.md` (or a marginBottom on the card) so the setting reads as its own object, and align its horizontal inset with the band below it.

- src/app/profile-me.tsx — set `headerTitle: 'Your profile'` through a nested `<Stack.Screen options>`; src/app/\_layout.tsx:252 currently forces `headerTitle: ''`. Prefer 'Your profile' over the person's own name: they know who they are, and the value of the bar is naming the screen.

**Tests.** Screenshots are the only thing that answers this: re-shoot 18-profile-me.png (title case, a visible gap above the identity card, a named header) and 18b-who-can-see-you.png (the whole gender sentence above the fold at default type, readable locked rows). Maestro (e2e/flows/signed-in-tour.yml): tap the 'Verified women' row on /visibility and assert the app lands on 'Get your badge'.

**Risk.** Do not tint the AudienceCard's ground to make it feel distinct: styles.card at :117-121 already carries a borderWidth that turns theme.accent when the audience is narrowed, and a tinted ground would collide with that state signal. Routing a locked row to verification contradicts the comment at :26-30 ('a row that is simply not live beats one that tells you off after you tap it') — it does not tell anyone off, but the change should say so in the comment or the next reader will revert it.

### `prof-photo-input` — Offer a camera on the mandatory photo step, handle a refused permission, and show the square people approved

**Priority** now · **Effort** M · **Ships as** over the air

The one step of signup that cannot be skipped calls launchImageLibraryAsync and nothing else: no camera, no permission branch, no denial handling. Deny the iOS prompt and the plus tile does nothing, forever, on a screen whose only other control is Sign out. Separately, photo-grid.tsx's own comment concludes that people frame themselves inside a square and the profile then cuts a further fifth off each side, and the code still renders 4:5 — so the comment now conceals the defect instead of recording it. The caption beside the tile is bottom-aligned against a tall empty box, states the requirement a second time, and becomes a word ladder at accessibility text sizes.

<details><summary>Closes 6 audit findings</summary>

- Signup asks for the whole camera roll, three dialogs deep, twice, and offers no camera

- The one mandatory step has one input path, no camera, and no handling when photo permission is refused

- The recorded fix for the square-into-4:5 crop was written into a comment but never applied to the display

- `aspect` is passed where iOS ignores it, and omitted where Android would use a wrong default

- The photo tile's label floats at the bottom-right of a tall empty box and states the requirement twice

- The photo step's tile-plus-side-caption becomes a word ladder at accessibility text sizes

</details>

**Changes**

- src/lib/pick-image.ts — add an options argument `{ allowsEditing?: boolean; onLibraryBlocked?: () => void }`, forward allowsEditing to both launchCameraAsync and launchImageLibraryAsync, and in `fromLibrary` call requestMediaLibraryPermissionsAsync first, invoking onLibraryBlocked and resolving null when `!granted && !canAskAgain`. Defaults leave the three existing callers byte-identical (src/components/ui/photo-button.tsx, src/app/new-group.tsx:101, src/app/group/[id].tsx:316).

- src/components/photo-grid.tsx:191-199 — replace the direct ImagePicker call with `pickImage({ allowsEditing: true, onLibraryBlocked: ... })` and drop the local expo-image-picker import. pickImage already implements the missing action sheet: 'Take a photo' / 'Choose from library' / 'Cancel' with a camera-permission request and a silent library fallback. Do NOT route through src/lib/live-camera.ts — its docblock and src/lib/**tests**/live-camera.test.ts source-scan forbid a library import there, because that module is the verification-selfie path.

- src/components/photo-grid.tsx — a `libraryBlocked` state renders an inline row under the grid: "Photos are off for Samewhere. Turn them on in Settings, or take one now." with a Linking.openSettings() ghost button, in the same shape as src/app/verification.tsx:136-152.

- src/components/photo-grid.tsx:32 — `const RATIO = 5 / 4` becomes `1`, and the comment is rewritten to describe what the code does rather than what it used to do.

- src/features/profile/profile-view.tsx:1245-1249 — galleryPhoto `aspectRatio: 4 / 5` becomes 1; :755 the hero `height: heroWidth * 1.15` becomes `heroWidth`. Note for whoever builds this: the hero is not 4:5 today, it is 1:1.15, so this is a smaller move than the finding claimed.

- src/components/ui/profile-hero.tsx — DELETE the file. A repo-wide grep for `ProfileHero` returns only its own definition at :18; nothing imports it, so the audit's instruction to change its `aspectRatio: 4 / 5` at :69 would have changed nothing on any screen. Leave src/app/(tabs)/travelers.tsx:875 (`cardHero: 3 / 2`) alone — that is the signed-out marketing card and its landscape crop is deliberate (comment at :160-171).

- src/components/photo-grid.tsx:304-313 — `mainBlock.alignItems` from 'flex-end' to 'flex-start', and switch flexDirection to 'column' when `PixelRatio.getFontScale() > 1.3` so the caption sits under a full-width tile instead of laddering in a ~134pt column (visible at three lines already at default size in 54-signup-photo-gate.png).

- src/components/photo-grid.tsx:246-256 — make the caption detail a prop. PhotoGrid renders in two places: src/app/onboarding/index.tsx:306, whose footer note at :301 already says 'A profile photo is the one thing we need.', and src/app/edit-profile.tsx:224, which has no footer note and must keep 'Required.'. Onboarding passes the reason instead: 'People decide whether to say hi from this.'

- src/app/verification.tsx:47-51 — drop `aspect: [4, 5]`. It reaches launchCameraAsync through src/lib/live-camera.ts:63 and is Android-only, so the screen's code claims a 4:5 selfie while capturing a square. Add one line to live-camera.ts's `aspect` doc saying it only reaches Android.

**Tests.** Screenshots: re-shoot 54-signup-photo-gate.png (caption top-aligned, requirement stated once), 18-profile-me.png and 17-travelers-signed-in.png (square hero). Maestro: e2e/subflows/pick-a-photo.yml is unchanged and still climbs the wall through the library, but its header comment about allowsEditing stays true, so nothing there needs editing. The camera branch is not drivable in the simulator, so the action sheet is covered by a screenshot only.

**Risk.** Every photo already in the bucket was cropped square by the system editor, so a square display shows MORE of the approved frame, never less. The seeded demo travelers' photos are landscape stock and will centre-crop harder in a square hero — look at 17 before and after and decide whether the seeds need reshooting. Keeping allowsEditing keeps the Photos authorisation sheet (allowsEditing forces UIImagePickerController rather than PHPicker, which is why there is a sheet at all); the camera option is what removes the dead end for anyone who refuses it. The audit's 'three dialogs, twice' reading of steps 055-057 and 066-068 is wrong — those are pick-a-photo.yml's three optional taps at ONE sheet, and two runs merged into one results directory. Restate the evidence honestly in the commit.

**Waits on.** Square or 4:5 — see the decisions list. The package as written implements square, which is what the code comment already concluded.

### `prof-verification-copy` — Say how long the selfie check takes, and what the badge actually buys

**Priority** now · **Effort** S · **Ships as** over the air

"Selfie submitted / Your badge shows up once it clears" is form-speak plus an idiom a non-native speaker will not decode, on a flow the brief says must feel near-instant. The screen is honest about the cost of a selfie and completely silent about the payoff: nothing on it says the badge is what unlocks "Verified women only", which is the reason a safety-conscious traveler would hand one over. And the sentence that does explain the trade is a riddle: the setting is not asking anyone for anything.

<details><summary>Closes 2 audit findings</summary>

- Verification says "once it clears" and gives no timeframe, for a flow the brief says must feel instant

- Verification tells you what a selfie costs, never what the badge buys

</details>

**Changes**

- src/app/verification.tsx:78 — `Alert.alert('Selfie sent', 'We check it in about a minute. Your badge appears on your profile as soon as it passes.')`.

- src/app/verification.tsx:117-120 — retitle 'Selfie in review' to 'Checking your selfie' and keep its existing 'Usually takes a few minutes.' line, but make the two numbers agree with the alert. Pick one duration for both. (The audit claimed neither state gives a timeframe; the in-review card does. Only the submit alert is vague.)

- src/app/verification.tsx:96 — add one line to the subtitle: 'It also unlocks who can see you, so you can choose verified travelers only, or verified women only.'

- src/features/profile/audience.ts:77 — AUDIENCE_NEEDS_BADGE from 'You need the badge before you can ask other people for one.' to 'These are for verified travelers. Get your badge and they turn on.' It renders in two places, src/app/visibility.tsx:63 and src/app/onboarding/index.tsx:552 (where it is concatenated with 'The selfie check lives on your profile once you are in.'), so read both aloud after the edit.

- If an escalation line is wanted for the slow case, copy src/app/(tabs)/my-business.tsx:514-515 verbatim: "Someone is checking your photos by hand. We'll email you when they have." The audit misquoted it.

**Tests.** Screenshots: re-shoot 18b-who-can-see-you.png for the reworded AUDIENCE_NEEDS_BADGE, and shoot the verification screen in its three states (first run, in review, rejected). No logic changes, so nothing else applies.

**Risk.** Do not promise a duration the pipeline cannot hold. Check what the verification worker's actual turnaround is before writing 'about a minute' into an alert; a broken promise here costs more than a vague one.

### `prof-guest-account-copy` — Fix the guest pitch, tell guests about the 30-day sweep, and give them a sign-in door

**Priority** now · **Effort** S · **Ships as** over the air

The named-guest conversion pitch breaks its own list halfway through, so the sentence stops parsing. Nobody is ever told that a guest account and every message it sent are deleted after 30 days without use, which is both a nasty surprise and the single most concrete reason to upgrade the app has. And the 'I already have an account' button is hidden from exactly the person most likely to want it: a guest who typed a name, then remembered their real account holds their trips and chats, is offered only to make a second one.

<details><summary>Closes 3 audit findings</summary>

- "A profile adds pins, trips and meeting people" breaks its own list

- A guest is never told their account and their messages are deleted after 30 days

- A named guest has no sign-in door on their own account screen

</details>

**Changes**

- src/app/profile-me.tsx:67-69 — 'Chats only for now. A profile adds pins, trips and meeting people, and your chats come with you.' becomes 'Chats only for now. With a profile you can drop pins, post trips and meet people, and your chats come with you.' Verb-led, parallel with the anonymous sibling one line down at :70 ('Say hi, drop pins, join the open chats.').

- src/app/profile-me.tsx — one line under it: 'Guest names and chats are removed after a month without use. A profile keeps them.' The rule is real and stated nowhere in src/: supabase/migrations/20260823060000_guests_can_chat.sql:304-315 (`stale_guest_ids`: anonymous, 30 days old, no live membership, nothing said in 30 days) and supabase/functions/guest-janitor/index.ts:3-5 ('Deleting a guest takes their messages with them, by cascade. That is the intent.').

- src/app/profile-me.tsx:82-89 — render the 'I already have an account' ghost button in the named-guest branch too (today it is `{guestName ? null : ...}`), with one line above it: 'Signing in leaves this guest name behind. Making a profile brings your chats with you.'

- Put the 30-day sentence in a shared constant if the guest gate also needs it, rather than writing it twice.

**Tests.** Maestro (e2e/flows/guest-tour.yml): name a guest, open the account screen through the header avatar, assert both the 30-day line and 'I already have an account'. Re-shoot the guest profile screenshot.

**Risk.** The 30-day line must not read as a threat on a screen whose job is to convert. One sentence, stated as a fact, no countdown and no nag — the design brief bans anti-user lecturing and this is the same shape.

### `prof-small-strings` — One discard verb, one Done that commits, a neutral first placeholder, and honest character limits

**Priority** now · **Effort** S · **Ships as** over the air

Four unrelated one-liners that each cost a reader something. A business owner backing out of an edit is offered 'Drop them', and 'drop' is the app's verb for publishing a pin everywhere else in the product. Two controls named 'Done' sit 68pt apart on the priorities editor doing different things. The first priorities placeholder is 'day trip to Sintra' shown to an account whose only trip is Bangkok. And the bio cap is counted in UTF-16 units on the client and codepoints in Postgres, so 'Bios are capped at 500 characters' is false for anyone writing with emoji.

<details><summary>Closes 4 audit findings</summary>

- Two vocabularies for discarding edits, and eight different words for "cancel"

- Two different controls labelled "Done" are on screen at once whenever a form field has focus

- The priorities placeholders are all Lisbon, whoever you are and wherever you are going

- Character caps are counted in UTF-16 units on the client and codepoints in the database

</details>

**Changes**

- src/app/business-edit.tsx:1004-1007 — 'Drop your changes?' / 'Drop them' becomes 'Discard your changes?' / 'Discard', identical to src/app/edit-profile.tsx:114-116. 'Drop' is the create-a-pin verb (src/features/pins/map-screen.tsx:1394, src/app/(tabs)/travelers.tsx:675, src/app/drop-pin.tsx:74).

- src/app/business-edit.tsx:994 — 'Leave it as it is' becomes 'Keep it as it is'. Leave the genuine antonym pairs alone (Stay/Leave, Keep it up/Take it down, Keep it/Remove). The audit's 'eight different words for cancel' is a miscount — there are seven, and 'Fair enough' at src/app/compose-request.tsx:149 is a PrimaryButton, not a cancel.

- src/components/form/keyboard-done-bar.tsx:63,68 — visible text 'Done' becomes 'Hide keyboard' (or the chevron.down glyph), accessibilityLabel to match. Reserve 'Done' for the control that commits. Do NOT rename src/app/edit-priorities.tsx:180's continueLabel: 'Done' is the shared StepScreen vocabulary (step-screen.tsx:56 default, visibility.tsx:37), so fix the one bar that collides with all of them. Measured on 34-priorities-editor.png the two are ~68pt apart and the LOWER one is the harmless keyboard dismiss, the reverse of what the finding claimed.

- src/features/profile/priorities.ts:29-36 — reorder PRIORITY_PLACEHOLDERS so index 0 is city-neutral ('rooftop for the sunset'). Only two of the six are Lisbon-specific and index 0 was one of them, which is exactly what 34-priorities-editor.png photographed. The modulo rotation in `priorityPlaceholder` is unchanged.

- src/features/profile/validation.ts:44-49 and :20-29 — count codepoints, not UTF-16 units: `[...value].length` in validateBio and validateDisplayName so the client agrees with `char_length` (supabase/migrations/20260816190000_core_auth_profiles.sql:41). Today an emoji costs 2 on the client and 1 in the DB, so a non-BMP writer is cut off at as few as 250 characters and told the wrong number. Apply the same to MESSAGE_MAX in src/app/compose-request.tsx:24 if its DB check is char_length.

**Tests.** jest: validateBio and validateDisplayName over a 500-emoji string and a non-BMP CJK string, asserting they pass where the DB would pass. Screenshots: re-shoot 34-priorities-editor.png and 35-priorities-typed.png.

**Risk.** keyboard-done-bar is mounted app-wide, so this string change lands on every keyboard-adjacent screen at once. That is the point, but it means the screenshot pass has to cover more than the priorities editor.

### `prof-anchor-targets` — Make the block the tap target, and stop the trip rows staggering under a finger

**Priority** next · **Effort** M · **Ships as** over the air

The product thesis is that a first message anchored to something specific gets answered, and the anchor affordance is the smallest element in each section: a caption-sized chip aligned right in a header, while the large obvious object beside it — the Bangkok trip card, the prompt answer in headline weight — does nothing when tapped. A first-time user taps the card, gets nothing, and concludes the page is not interactive. The priority chips are the exception, and they are the one place the pattern works.

<details><summary>Closes 2 audit findings</summary>

- The reply anchors are 26pt chips in section headers while the content they point at is inert

- Every traveler's trip rows re-stagger, so the shared-dates line lands last and untappable

</details>

**Changes**

- src/features/profile/profile-view.tsx:440-462 — TripsSection currently wraps the row in PressableScale only when `owner` and otherwise falls through to a bare View. Wrap the visitor's row too, calling `onRespondTo({ key: 'trip', label: 'their travel plans', quote: trip.cityLabel })`, with `accessibilityLabel={`${trip.cityLabel}, ${formatDateRange(trip.startDate, trip.endDate)}. Say hi about this.`}` so the visible words survive in the accessible name.

- src/features/profile/profile-view.tsx:307-343 — wrap the PromptCard body (the bare `<ThemedText type="headline">{prompt.answer}</ThemedText>` at :341) in PressableScale calling the same target the header chip already builds at :331-338. Keep the chip as the visible affordance rather than the hit area.

- src/features/profile/profile-view.tsx:915 — do NOT wrap the About paragraph. `profile.bio` is free text up to 500 characters; one giant button costs text selection and hands VoiceOver a single enormous element. Give the About header chip the wider pill treatment instead.

- src/features/profile/profile-view.tsx:450 — drop the per-row `FadeInDown.delay(i * 40)` and keep a single FadeInDown on the trips block. The traps skill records that a view at opacity 0 is skipped by UIKit hit-testing entirely, so once the visitor's rows are pressable the stagger is a real dead zone — and src/app/(tabs)/travelers.tsx:699 remounts the whole page with `key={current.userId}` on every Next, so it re-staggers on every card.

- Correct the record in the commit message: 'Both in Bangkok Aug 30 – Sep 4' is rendered in the hero identity block (profile-view.tsx:625-629, built at :716-721) and arrives with the card's own FadeIn, not in the staggered rows. 17-travelers-signed-in.png shows it on the photo. The stagger is worth removing for the hit-testing reason, not that one.

**Tests.** Maestro (e2e/flows/signed-in-tour.yml): press Next, then tap the trip card immediately, and assert the composer opens on 'Say hi to Theo'. That is the assertion the old stagger would fail. Re-shoot 17-travelers-signed-in.png.

**Risk.** Nesting a PressableScale inside a section that also carries a header chip gives two overlapping targets for one action — make sure the chip is not inside the new pressable's bounds or VoiceOver will announce a button inside a button. Skip the one-shot hero pulse the finding proposes: teaching the pattern with a timed animation needs an AccessibilityInfo.isReduceMotionEnabled check and a once-per-install AsyncStorage flag, and making the blocks tappable is the actual fix.

**After.** `prof-anchor-vocabulary`

### `prof-photo-lifecycle` — Show the photo you just picked, keep it when the upload fails, and say one thing about a rejected one

**Priority** next · **Effort** L · **Ships as** over the air

Adding a photo produces a screen where four grey dashed boxes all spin and none contains the photo you chose. If the upload fails on hostel wifi the local URI goes out of scope and the person re-finds the photo among thousands and re-crops it. A pending photo gets a two-word chip while a pending chat photo gets a reason and a duration twenty files away, and the owner's profile simultaneously tells them to add a photo they already added. A rejected profile photo says 'Removed' in danger red while the identical business verdict says "Didn't pass" in warning.

<details><summary>Closes 6 audit findings</summary>

- No upload progress, no preview of what is uploading, and every empty slot spins at once

- An upload that fails throws away the photo the user just picked and cropped

- The profile photo moderation wait gets two words where the chat photo gets a reason and a duration

- The two galleries use different words and different colours for the same moderation states

- Profile photos carry no accessibility label, though the business side already does it and documents why

- No placeholder on any photo, so slow connections show flat grey rectangles rather than loading

</details>

**Changes**

- src/components/photo-grid.tsx — hold `{ localUri, position, state: 'uploading' | 'failed' }` in state; render the picked URI in the target tile immediately at reduced opacity with an 'Uploading' chip in the same visual language as StatusChip. Scope `busy` to that slot: :242 and :281 both pass the same `uploadPhoto.isPending` boolean, which is why every empty slot spins at once.

- src/components/photo-grid.tsx:216-219 — on failure keep the local URI and render that tile as a failed upload with a Retry that re-runs `uploadPhoto.mutateAsync` on the same file (so the resize and re-encode in src/lib/image-upload.ts:34-60 are not repeated either). Match the `message.local === 'failed'` / `onRetry` branch in src/features/chat/message-thread.tsx. Drop the bare Alert.

- src/components/photo-grid.tsx:34-48 — StatusChip's rejected state becomes "Didn't pass" on `theme.warning` with `onHighlight` text, identical to src/app/business-edit.tsx:461-468, so one verdict has one word and one colour in both account kinds. 'Didn't pass' is the better of the two: plainer, and it does not imply the person did something.

- src/components/photo-grid.tsx — add an '{n} of 9' counter above the extras row, matching src/app/business-edit.tsx:636. PHOTOS_MAX is 9 (src/features/profile/validation.ts:11) and nothing on the profile side says so.

- Lift the treatment in src/features/chat/message-thread.tsx:358-385 (`PhotoCheck`: reserves the real frame, shows the sender their own photo behind a scrim, 'We check every photo before it goes out. Usually about 5 seconds.') into a shared component and use it on the grid tile and on the profile hero.

- src/app/profile-me.tsx:234 — while the only photo is pending, render it in the hero behind that scrim instead of filtering it out with `moderation_status === 'approved'` and falling through to ProfileView's photo-less band at :836-880, which shows an 'Add a photo' button to somebody who just added one. Keep the existing heldBack notice at :296-307.

- Accessibility labels on every profile photo, following the pattern src/app/place/[id].tsx:53-64 already documents ('A "Photos" heading over unlabelled images is a heading over nothing'): profile-view.tsx's `Photo` (:57-65), `WovenPhoto` (:363), the hero (:757), photo-grid.tsx's tile (:100), and src/app/(tabs)/travelers.tsx:175. 'Profile photo of Mara', 'Photo 3 of 5'; in the owner's grid fold the state in ('Photo 3, being checked') and name which photo each Remove removes, as business-edit.tsx:473 already does.

- Skeleton placeholders on the photo frames using src/components/ui/skeleton.tsx, the way src/features/business/place-sheet.tsx:168 already does, so a slow connection shows loading rather than a grey rectangle that might be empty or broken.

**Tests.** Screenshots are the only thing that answers 'does it look right': shoot the grid mid-upload, the failed tile with Retry, and the pending hero on profile-me. Maestro: e2e/subflows/pick-a-photo.yml already lands a photo — add an assertion that the tile shows the photo before the 'In review' chip appears, which the current code cannot satisfy.

**Risk.** supabase-js exposes no upload progress, so there is no honest determinate ring. The finding's alternative — an XHR to a signed endpoint — would move the upload off `processAndUploadImage`, which is the one place the image pipeline lives for profile photos, verification selfies and chat photos alike. Show the local photo with an 'Uploading' chip instead. Also check the push copy for a rejected photo: if it says 'removed', it has to change with the chip or the two disagree again.

**After.** `prof-photo-input`

### `prof-settings-spine` — Give profile-me a Settings spine instead of a stack of ghost buttons

**Priority** next · **Effort** M · **Ships as** over the air

The header avatar is the only account door a traveler has, and behind it is a rendering of your own profile with account actions loosely stacked below the fold as identical full-width ghost buttons. Reaching a human is four taps and two long scrolls through a rulebook. Somebody looking for a blocked list, their email address, or a privacy policy has nowhere to look and no way to tell that those things do not exist versus being further down.

<details><summary>Closes 2 audit findings</summary>

- There is no settings screen, and no word "Settings" anywhere in the app

- profile-me is doing a Settings screen's job without being one, and the avatar is its only door

</details>

**Changes**

- src/app/profile-me.tsx:331-400 — replace the stack of PrimaryButtons (Edit profile, Get verified, House rules and help, Run a business?, Sign out, Delete account) with a row list under an explicit 'Settings' heading, in Apple's grouped-list grammar with chevrons: Edit profile, Who you see and who sees you (pointing at the same /visibility route the AudienceCard at :290 opens), Get verified, Blocked, House rules and help, Send us a message (/contact directly — today it is two taps inside /guidelines), Run a business?, then Sign out and Delete account visually separated at the bottom.

- Keep the AudienceCard at the top AND add the row: the card is the founder's key selector (:283-289 records why), and demoting the one privacy control the product's positioning depends on into the middle of a list undoes that.

- Keep /profile-me as the single destination. src/components/ui/avatar-button.tsx:47-55 is the only account door for a traveler, mounted at src/features/pins/map-screen.tsx:1222, src/app/(tabs)/travelers.tsx:478, src/app/(tabs)/chat.tsx:831 and :946. No new route, one screen.

- Do NOT add a 'Notifications' row. There is no notification-preferences screen anywhere in src/app — only the primer at src/features/notifications/push-primer.tsx — and a row that opens nothing is worse than no row.

- Correct the record while in here: Delete account is already `variant="danger"` at :383. It is Sign out that shares ghost styling with House rules, which is the actual weighting problem.

**Tests.** Screenshots: re-shoot 18-profile-me.png scrolled to the settings block. Maestro (e2e/flows/signed-in-tour.yml): from the avatar, assert 'Send us a message' is reachable in one tap and that 'Delete account' is visibly separated from Sign out.

**Risk.** This screen carries the two controls App Review requires to be reachable in-app (5.1.1(v) delete, and sign out). Do not bury either behind a disclosure. Rows that lead to routes behind `signedIn && onboarded` (src/app/\_layout.tsx:272-296) must not render for a guest or a business — the business branch at :105-200 is a different render path and this package does not touch it.

### `prof-view-modes` — Let people see their profile as a stranger does, and let onboarding step 13 jump to the step that owns each block

**Priority** next · **Effort** M · **Ships as** over the air

Your own profile claims in its own comment to be 'exactly the page a stranger gets'. It is not in the way that matters: a stranger's copy is covered in reply anchors and yours has Edit buttons in the same slots, so you can never notice that your bio has no anchor worth tapping. And onboarding step 13 subtitles itself 'Step back to change anything' when the only way back is a single-step chevron: fixing a typo in your name is ten Back taps through ten animated scene transitions.

<details><summary>Closes 2 audit findings</summary>

- Your own profile hides the one affordance that decides whether anyone messages you

- 'Step back to change anything' costs up to ten Back taps, and the component already supports the jump

</details>

**Changes**

- src/app/profile-me.tsx — a small 'Preview' pill in the row with the AudienceCard that re-renders the same ProfileView with `owner={false}`, `handles={[]}` and a no-op `onRespondTo`, under a dimmed banner 'This is what {city} sees'. `handles={[]}` is required, not optional: profile-view.tsx:504-528 branches on owner for the socials section, and a preview that kept your own handles would teach the opposite of hard rule 4.

- src/app/onboarding/index.tsx:566-620 — pass `owner` on the step-13 ProfileView and wire each callback to the local step setter rather than a route: onEditSection('photos') → go(5), onEditSection('details') → go(4), onEditSection('about') → go(7), onEditPrompt → go(8), onEditPriorities → go(9), the socials onEdit → go(11). docs/ONBOARDING.md §3 already specifies exactly this.

- Delete the comment at :605-612 justifying `owner={false}`. It is factually wrong: src/features/profile/profile-view.tsx has no expo-router import and no `router.` call anywhere. Every owner affordance is a caller-supplied callback gated as `owner && onEdit` (:204, :258, :315, :777, :841), and the only owner-mode caller today is profile-me.tsx:318-327, whose own callbacks push the guarded routes.

- Handle the two things owner mode also changes on that step: the socials section stops returning early (the early returns at :504 and :517 are gated on `!owner`) and renders 'Socials / None yet / Only people you're chatting with see these.' — route its onEdit to go(11) rather than expecting it to vanish; and TripsSection swaps its empty copy and always renders 'Add a trip' at :462-480, which opens the TripEditor sheet in place — replace that with go(10) on this step.

- src/app/onboarding/index.tsx:576 — reword the step-13 subtitle. With owner on, 'Exactly what a stranger sees' stops being true. Something like 'Your profile. Tap any part to change it.'

**Tests.** Maestro (e2e/flows/onboarding-tour.yml): from step 13 tap the About Edit, assert the app is on the bio step, then Continue forward and assert it is back on 13. Screenshots: the step-13 review with edit affordances, and the profile-me preview with its banner.

**Risk.** Opening the TripEditor sheet from inside StepShell is the modal-over-modal trap the traps skill records — on Fabric a presentation that starts while another is dismissing does not just lose the sheet, it kills touch for the whole app. Route to go(10) instead. The preview on profile-me must not become a second layout: the whole value is that it is the same component.

**After.** `prof-anchor-vocabulary`

### `prof-blocked-list` — Add a Blocked list with unblock, using the policies that already exist

**Priority** next · **Effort** M · **Ships as** over the air

Blocking is a one-way door with no inventory. A traveler who blocks the wrong person from a crowded group thread cannot undo it and cannot even see who they have blocked. Because blocks cut visibility in both directions this also produces a support case the founder cannot fix from the app — 'my friend has disappeared and I do not know why' — and a safety feature people are afraid to use pushes travelers toward the weaker option of not replying.

<details><summary>Closes 1 audit findings</summary>

- There is no way to see or undo a block

</details>

**Changes**

- src/features/chat/api.ts — `fetchBlocks()` as `supabase.from('blocks').select('blocked_id, created_at').order('created_at', { ascending: false })`, and `unblockUser(blockedId)` as `.delete().eq('blocked_id', blockedId)`. No RPC and no migration: supabase/migrations/20260816200000_trips_matching.sql:83-96 already carries blocks_select_own, blocks_insert_own and blocks_delete_own, and revokes only update/truncate/references/trigger, so select/insert/delete remain granted to authenticated.

- Fetch names in a second query, not an embed — the blocks FK points at public.users, not public.profiles: `supabase.from('profiles').select('user_id, display_name').in('user_id', ids)`. That read is legal: is_visible_owner (supabase/migrations/20260816190000_core_auth_profiles.sql:146-157) is only `status = 'active'` and does not exclude a blocked pair.

- src/features/chat/hooks.ts — `useBlocks()` and `useUnblockUser()`, invalidating the discovery surfaces through src/features/profile/discovery-cache.ts the way useSetVisibility does at src/features/profile/hooks.ts:253-264, because unblocking changes who the map and Travelers may show.

- src/app/blocked.tsx (new) — a StepScreen list of display names with an Unblock action and a confirmation. Register it in src/app/\_layout.tsx inside `Stack.Protected guard={signedIn && onboarded}`, beside `visibility`.

- Add the 'Blocked' row to the settings list built in prof-settings-spine, not as a loose ghost button.

- Two things this must not do: restore a chat the block closed (the sever behaviour documented at supabase/migrations/20260816200000_trips_matching.sql:98+ is one-way, and deleting the blocks row is all this does), and withdraw a report — reports are the moderation audit trail and unblocking must never touch them.

**Database.** None. The existing blocks_delete_own policy and the surviving delete grant are the whole mechanism. No RETURNS TABLE function changes, so no drop-function requirement.

**Tests.** pgTAP in supabase/tests/database/, written as attacks: alice cannot delete bob's blocks row; after alice unblocks bob the chat the block closed is still closed; after alice unblocks bob the moderation_events 'block created' row is still present; alice's 51st block in 24 hours still fails after fifty block/unblock cycles. Maestro: block from a profile, open Settings → Blocked, unblock, assert the name is gone.

**Risk.** The audit worried that unblock cycling would launder the block counter. It cannot: supabase/migrations/20260817150000_launch_hardening.sql:145-168 counts through moderation_events precisely 'because unblocking deletes the blocks row', and the audit entry survives the delete. That means no new rate limit is needed, but the pgTAP test above must prove it rather than assume it.

**After.** `prof-settings-spine`

### `prof-account-identity` — Show the address the account is under, let people change it, and stop blaming wifi for a closed account

**Priority** next · **Effort** M · **Ships as** over the air

Email confirmation is off for v1, so a typo at signup produces a working account that never receives a single piece of mail revealing the mistake. Nothing in the app ever displays the address, there is no way to change it, and password reset is deliberately oracle-free, so the account is permanently unrecoverable including through support. Separately, when the profile row is genuinely gone — deleted on another device, swept by the guest janitor, removed by an admin — the app says 'Check your connection and try again' and offers a Retry that can never succeed.

<details><summary>Closes 2 audit findings</summary>

- One typo in the signup email is a permanently unrecoverable account

- 'Can't load your profile. Check your connection' is what the app says when the account no longer exists

</details>

**Changes**

- src/app/profile-me.tsx — an 'Account' block in the settings list showing the address (`useOwnEmail`, src/features/profile/hooks.ts:43, used today only to prefill src/app/contact.tsx:26) and how the person signs in (Apple or a password), plus Change email and Change password rows.

- src/app/change-email.tsx and src/app/change-password.tsx (new) — both are `supabase.auth.updateUser` calls the codebase already makes at src/features/auth/api.ts:55 and :89. Register both in src/app/\_layout.tsx behind `signedIn`.

- src/app/(auth)/join.tsx:20 — the validator is only a shape check. Warn on the common domain misspellings (gmial, hotmial, yahho, outlok) before submit, and after signup show the address back once: 'This is where we will send a reset link if you ever need one.' docs/LAUNCH_RUNBOOK.md:31 records confirmation being off, so nothing else ever reveals a typo.

- src/app/\_layout.tsx:160-169 — branch AccountLoadError on the error rather than always saying 'Check your connection'. PGRST116, which `.single()` in fetchOwnProfile (src/features/profile/api.ts:143-152) throws when there is no row, and a 401/403 render 'This account has been closed' with Sign out as the primary and no Retry. Everything else keeps the network wording. Read `error.code` directly: PostgrestError is not an Error, so `instanceof` swallows it (change-review says the same).

**Tests.** jest on the error classifier (a synthetic PGRST116 versus a network failure), because a closed account cannot be produced from a Maestro run. Maestro: open Settings and assert the account address renders. Screenshot the closed-account state rendered from a forced error, and the account block.

**Risk.** `supabase.auth.updateUser({ email })` sends a confirmation to the NEW address. With confirmation off for v1 the behaviour has to be checked against the project's auth settings first — a change-email that silently does nothing is worse than not offering one. The business side has the same trap and is out of scope here: src/app/business-edit.tsx:1089 re-confirms the LISTING email, never the auth email.

**After.** `prof-settings-spine`

### `prof-group-consent-copy` — Stop the visibility screen promising a gate that group co-membership removes

**Priority** next · **Effort** S · **Ships as** over the air

Joining an open plan with eleven strangers lets every one of them open a 1:1 thread that was never accepted — open_direct_chat checks auth, standing, guest/business, blocked-pair and shared-group membership, and nothing else. The founder's decision that messaging a groupmate should be one tap is right and should stay. What is wrong is that the app tells people the opposite: the visibility screen ends with 'Chat is separate: anyone can still message you', which implies the say-hi gate still applies to everyone. It is the one string in the app that actively misleads about this.

<details><summary>Closes 1 audit findings</summary>

- Joining a group silently removes the accept gate, and nothing at the join point says so

</details>

**Changes**

- src/features/profile/audience.ts:71 — AUDIENCE_BOTH_WAYS's last clause becomes 'Chat is separate: anyone can say hi, and anyone in a group with you can write to you directly.' It renders in two places, src/app/visibility.tsx:38 and src/app/onboarding/index.tsx:530, so read both aloud after the edit; 18b-who-can-see-you.png is the shot that proves the wrap.

- src/app/profile/[userId].tsx:105-124 — when `known` came from `sharesGroup` (src/features/groups/hooks.ts, useSharesGroupWith) rather than `connected`, add a caption under 'Message {name}': 'You are both in a group, so this goes straight through.' src/app/message/[userId].tsx:57 already tells the SENDER this; the profile is where the recipient's side of the same fact is learned.

- Out of scope here and owned by the chat/groups subsystem, but name it in the commit so it is not lost: the one-line consent notice at the join point (src/app/join-group/[token].tsx, src/app/join-place.tsx), and the provenance header plus inline Block/Report on the first direct chat from a group co-member, which belongs in src/app/chat/[id].tsx keyed off a group name the chat row already knows rather than synthesised client-side.

- Do NOT apply discovery_pair_ok to open_direct_chat (supabase/migrations/20260829130000_add_people_without_a_link.sql:324-366). The founder's reasoning is recorded at src/app/message/[userId].tsx:13-23 and narrowing it silently would break the thing the group feature is for. The fix is to stop the app claiming otherwise.

**Tests.** Screenshots: re-shoot 18b-who-can-see-you.png with the longer sentence (check it does not push the gender note back off the fold — this package and prof-page-chrome both edit that screen's copy, so shoot after both land) and shoot a group-member profile. No logic changes.

**Risk.** The new sentence is longer, and 18b already had a clipping problem. Ship it after prof-page-chrome moves the gender note, or the fix and the regression land in the same build.

**After.** `prof-page-chrome`

### `prof-onboarding-badge-door` — Put the selfie step inside signup, so the locked audience rows are a door and not a wall

**Priority** next · **Effort** M · **Ships as** over the air

Signup asks every new account who can see them and then greys out every answer except Everyone, because a brand-new account can never be verified. Showing the locked rows is the founder's decision and is right — somebody who never learns the setting exists is exactly who the step is for. The problem is that the step names the badge, says it lives somewhere else, and hands you no way to act. A woman finishing onboarding is set to Everyone and the app never asks again.

<details><summary>Closes 1 audit findings</summary>

- The women-only audience is locked behind a badge the onboarding step gives you no way to get

</details>

**Changes**

- src/features/profile/verification-capture.tsx (new) — extract the body of src/app/verification.tsx (the capture, the preview, the blocked-camera card, the submit at :46-90 and :100-183), leaving the route as a thin StepScreen wrapper. `captureLivePhoto` already handles the whole capture.

- src/app/onboarding/index.tsx:523-560 — when an unverified account taps a locked row, present that component inline on step 12 and apply the chosen audience the moment the badge clears. `router.push('/verification')` cannot work from here: src/app/\_layout.tsx:287 puts `<Stack.Screen name="verification">` inside `<Stack.Protected guard={signedIn && onboarded}>` and an onboarding account satisfies neither half. Wire the AudiencePicker's `onLockedPress` prop from prof-page-chrome to open it.

- src/app/onboarding/index.tsx:546-552 — swap the two footnotes so AUDIENCE_NEEDS_BADGE (the answer to 'why is this grey') comes before AUDIENCE_GENDER_NOTE.

- Do NOT reorder anything on src/app/visibility.tsx. Its comment at :57-60 records the ordering being fixed after E2E run 55 photographed the Get verified button falling off a 6.1" screen, and 18b-who-can-see-you.png shows it working today. The audit claimed the dead end exists 'in both screens'; it exists only in signup.

**Tests.** Maestro (e2e/flows/onboarding-tour.yml): on step 12 tap 'Verified women' and assert the capture appears rather than nothing happening. Screenshot the new step 12 in both states.

**Risk.** The capture component is presented inside StepShell, which is itself a full-screen scene — check it does not open a second modal over a dismissing one (the Fabric touch-death trap in the traps skill). The camera permission prompt now appears inside signup, which is one more system dialog on a flow the audit already criticised for having too many; the offsetting argument is that it appears only when someone reaches for a locked row on purpose.

**Waits on.** Whether step 12 should exist at all — see the decisions list (audit finding 22). This package assumes it stays and gets a door.

**After.** `prof-verification-copy`, `prof-page-chrome`

### `prof-photo-reorder` — Let people reorder photos and choose which one leads, which the database already allows

**Priority** next · **Effort** M · **Ships as** over the air

Choosing which photo leads is the single highest-leverage edit anyone makes to a profile, and today it costs a destructive confirm, a row delete, a storage delete, a re-pick, a re-crop and a fresh trip through moderation during which the profile has no hero at all. People will not do it, so the app fills with profiles whose lead photo is whichever one they happened to upload first. The permission to fix this is already granted and written down.

<details><summary>Closes 1 audit findings</summary>

- Nobody can reorder photos or change which one is the profile photo, though the DB already allows it

</details>

**Changes**

- src/features/profile/api.ts — `setPhotoPositions(updates: { id: string; position: number }[])`. supabase/migrations/20260816190000_core_auth_profiles.sql:359-362 says exactly this is allowed: 'profile_photos: moderation_status is server-owned; clients may only move positions. revoke update ...; grant update (position) on public.profile_photos to authenticated.'

- src/features/profile/hooks.ts — `useReorderPhotos()` with an optimistic setQueryData on ['photos', userId] and invalidation on settle, alongside the existing useUploadPhoto/useDeletePhoto.

- src/components/photo-grid.tsx — long-press-to-drag on the tiles (Reanimated is already a dependency and LinearTransition is already on FilledPhoto at :95), plus a plain 'Make this my profile photo' action on each tile. The non-gesture action is not optional: a drag is unreachable with VoiceOver.

- Positions are effectively unique per user — `nextPosition` at :180-189 assumes one photo per slot — so a reorder must write through a batched update or a temporary slot, never a naive pairwise swap that transiently duplicates a position.

- Read the traps skill's long-press-on-a-list entry before wiring the gesture.

**Database.** None. The column grant already exists.

**Tests.** pgTAP written as an attack: an authenticated user cannot change moderation_status or storage_path through the same column grant, which is the whole reason the grant is column-scoped. jest on the position-recomputation helper (reorder, then delete, then reorder again, asserting no duplicate slots). Maestro: reorder two photos and assert the hero changes. Screenshot before and after.

**Risk.** A reorder that transiently duplicates position 0 gives the profile two 'profile photos' until the second write lands; the hero picks `photos.find(p => p.position === 0)` (profile-view.tsx:702) and would show whichever came back first. Batch the write. A long-press gesture on a grid inside a ScrollView also competes with the scroll — the traps entry exists for this.

**After.** `prof-photo-lifecycle`

### `prof-photo-viewer` — One full-screen photo viewer, used from the profile hero, the gallery and the chat bubble

**Priority** later · **Effort** M · **Ships as** over the air

The point of sending a photo in this app is 'look at this' — a rooftop, a meeting spot, a menu — and a landscape photo arrives as a centre-cropped 220pt square showing the middle third that neither side can open. The same is true of a profile photo: you cannot look closely at the person you are about to write to, which is a safety affordance as much as a curiosity one. A grep across src for a lightbox, a zoom, a pinch handler or a full-screen image modal returns nothing.

<details><summary>Closes 2 audit findings</summary>

- A chat photo is a hard 220pt square that cannot be opened, and no full-screen photo viewer exists anywhere in the app

- Portrait is locked globally, including for the photo viewer and the map (the viewer half only)

</details>

**Changes**

- src/components/ui/photo-viewer.tsx (new) — tap to open, pinch to zoom, swipe down to close, black ground, no chrome. Take the signed URL from `usePhotoUrl` unchanged; the viewer must not introduce a public link, because the photos bucket is private by design (src/features/profile/api.ts:213-222).

- src/features/profile/profile-view.tsx — open it from the hero photo (:755-760) and from WovenPhoto (:363), without swallowing the reply bubble's own tap target at :368-380.

- src/features/chat/message-thread.tsx:1155-1159 — let the bubble size itself to the photo's aspect within a max height instead of the hard `photo: { width: 220, height: 220 }` with contentFit cover, and open the viewer on tap.

- Present through `<Modal>`, following src/components/ui/sheet.tsx, and never start the presentation while another modal is dismissing.

**Tests.** Screenshots: the viewer open on a landscape chat photo and on a profile photo. Maestro: tap a chat photo, assert the viewer opens, swipe down, assert it closes and the thread is still scrolled where it was.

**Risk.** On Fabric a dropped modal presentation does not just lose the sheet, it kills touch for the whole app — the traps skill's ModalHostView entry. Guard against opening the viewer from inside a dismissing sheet (the map's pin sheet is the likeliest caller later). Landscape for the viewer is a separate question: app.json:5 is `"orientation": "portrait"` app-wide with no per-screen override and no expo-screen-orientation dependency, so per-screen rotation is a native change and an EAS build. Do not lift the lock globally — src/components/ui/sheet.tsx:151 and the intro tour assume a tall window.

**Waits on.** Whether to spend an EAS build and a native dependency on per-screen rotation for the viewer and the map — see the decisions list.

**After.** `prof-photo-lifecycle`

### `prof-rough-trip-dates` — Let a trip say roughly when, so a traveler without exact dates can still be found

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

The app asks for precision it will not get. 'Bangkok, probably most of September' is how open-ended travel is actually planned and it is not expressible: the calendar demands two taps on two specific days and Post trip stays off until both land. A traveler who does not know either posts nothing — and Travelers then says 'Add a trip first' forever — or posts a guess and never corrects it, which quietly corrupts the overlap query for everyone matched against them.

<details><summary>Closes 1 audit findings</summary>

- A trip must have exact start and end dates, which most backpackers do not have when they would post one

</details>

**Changes**

- supabase/migrations/<ts>\_a_trip_can_be_roughly_when.sql (new) — `alter table public.trips add column approximate boolean not null default false;`. Then, because the chip has to reach a traveler's card, `traveler_trips(uuid)` gains an OUT column: **drop function public.traveler_trips(uuid) first**, re-create it from the latest definition (supabase/migrations/20260830000000_a_business_is_served_no_travelers.sql:142) with the extra column, and re-state `revoke execute on function public.traveler_trips(uuid) from public, anon` plus the grant to authenticated. Same treatment for get_matches ONLY if the chip is wanted on the Travelers card; if it is not, leave that function untouched.

- src/app/add-trip.tsx:103-127 — a second tab in the dates block, 'Rough dates', taking a month and a length. Write the widest plausible range under an explicit documented rule ('about a week in September' stores Sep 1-30 with approximate = true), capped by the existing 365-day check at supabase/migrations/20260816200000_trips_matching.sql:185 so overlap results stay honest rather than silently inflating everyone's match count.

- src/features/trips/api.ts — createTrip and updateTrip carry the flag. src/features/trips/trip-editor.tsx gets the same tab, since that is the editor ProfileView mounts in place at :1044-1045.

- src/features/trips/dates.ts — a `rangeForRoughDates(month, lengthDays)` helper beside the existing formatters, and a formatter that renders an approximate trip as 'Around Sep 8 – 15'.

- src/features/profile/profile-view.tsx:440-462 — render a small 'roughly' chip on an approximate trip card so a stranger reading the profile knows not to book flights around it.

- src/features/profile/profile-view.tsx — on your own profile, an edit nudge once the window is inside 14 days: 'Know your dates yet?', using `daysUntil` from src/features/trips/dates.ts:24.

**Database.** Adds trips.approximate (boolean not null default false). Requires drop function public.traveler_trips(uuid) before re-creating it with the extra OUT column, then re-stating the revoke from public/anon and the grant to authenticated. Same for get_matches if the chip reaches the Travelers card.

**Tests.** pgTAP: an approximate trip still cannot exceed the 365-day check, and traveler_trips still refuses a non-visible owner after the drop-and-recreate (that is the test that catches a missing re-grant). jest on rangeForRoughDates and on the 'Around Sep 8 – 15' formatter. Maestro: post a rough trip and assert the profile shows 'Around'. Screenshot the new date block.

**Risk.** The migration is the dangerous part: AGENTS.md's rule exists because Postgres refuses to add columns to an existing RETURNS TABLE signature via create-or-replace and the deploy then fails AFTER the earlier statements have already applied. Drop first, re-create, re-state grants, and put the alter table before the drop so a failure leaves a harmless unused column rather than a missing function. Widening ranges is the product risk: an approximate September trip overlapping everyone in September inflates every match count in the city, which is the failure mode the brief calls a collapsing accept rate.

**Waits on.** Whether an approximate trip counts for matching at full weight, or is de-ranked, or is excluded from the overlap query entirely — see the decisions list.

### `prof-business-account-order` — Put the business account controls above the rulebook, not below it

**Priority** later · **Effort** S · **Ships as** over the air

The business account page is deliberately short and then puts a four-section rulebook between the owner and the only two controls on the page. 73-business-account.png ends at Sign out with Delete account below the visible area, so a bar owner closing down scrolls past rules about ratings and photo policy to reach the delete button. And the first thing offered is a large primary button that sends an owner who arrived from My business back to the tab they just left.

<details><summary>Closes 2 audit findings</summary>

- The business account page hides Delete account below the fold with no anchor

- The business account screen is an explainer wearing an account screen's slot

</details>

**Changes**

- src/app/profile-me.tsx:138-175 — move the rules card below Sign out and Delete account, or collapse it behind a 'The rules for businesses' disclosure that expands in place. The account controls should be the last thing you scroll to, not the thing behind the reading material.

- src/app/profile-me.tsx:154-175 — give the block an 'Account' heading and turn Send us a message / Sign out / Delete account into a row list, matching the traveler side from prof-settings-spine, so the three controls read as controls rather than a trailing stack.

- src/app/profile-me.tsx:133 — suppress the 'Manage your business' primary when the screen was opened from src/app/(tabs)/my-business.tsx:710 ('Account and rules'), by passing a param, so the primary action is never 'go back where you came from'.

- Do NOT put the rules behind a link to the traveler rulebook. profile-me.tsx:138-141 records that exact regression being undone: /guidelines talks about pins and 'your profile' and bans commercial solicitation, which is the wrong document for a business.

- Do NOT re-do the 'give Delete account destructive treatment' item. It is already `variant="danger"` at :173, with the comment recording why.

**Tests.** Screenshot: re-shoot 73-business-account.png and assert Delete account is above the fold on a 6.1" screen. Maestro (e2e/flows/business-tour.yml): from My business → Account and rules, assert no 'Manage your business' button.

**Risk.** App Review 5.1.1(v) requires in-app account deletion to be reachable; moving the rules card must not push anything else below the fold in its place. If the disclosure route is taken, the collapsed state must still be obviously expandable — a rulebook nobody can find is worse than one in the wrong order.

**Waits on.** Whether the four-section rules card belongs on this page at all — see the decisions list (audit finding 34, which is a recorded founder decision).

**After.** `prof-settings-spine`

### `prof-home-city-reference` — Make home city reference data, the way trip cities already are

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

The app applies proper reference-data discipline to the city a traveler is going to and none at all to the city they are from, and the split falls precisely along language lines. 'München', 'Munich', 'Munique' and 'Monaco di Baviera' are four unrelated strings for one place; 'Deutschland', 'Germany' and 'DE' are three countries. Home city is a displayed profile field and a first-message anchor ('home' in the anchor vocabulary), so the inconsistency is visible, and it forecloses anything that would group travelers by where they are from.

<details><summary>Closes 1 audit findings</summary>

- Home city and country are free text while trip cities are reference data, so the same city splits along language lines

</details>

**Changes**

- supabase/migrations/<ts>\_home_is_a_city_too.sql (new) — `alter table public.profiles add column home_city_id int references public.cities (id);` keeping the existing `home_city` / `home_country` text columns (supabase/migrations/20260816190000_core_auth_profiles.sql:37-38) as the fallback for places the cities table does not carry.

- src/features/profile/api.ts — add the column to PROFILE_COLUMNS, which is the one place the profile read is defined.

- src/app/edit-profile.tsx:176-178 — replace the two FormTextFields with the city typeahead src/app/add-trip.tsx:65-105 already drives through `search_cities` (accent-insensitive via immutable_unaccent), and make Home country a picker over ISO 3166 codes rendered with the endonym-plus-English pattern src/constants/languages.ts already establishes.

- The same swap on the onboarding home step, so the two forms cannot drift.

- Keep writing the text columns alongside the id, so nothing that reads them today breaks and a city the table does not carry is still expressible.

**Database.** Adds profiles.home_city_id (int, nullable, references cities). No function OUT columns change, so no drop function is required — but if PROFILE_COLUMNS is ever fed through a RETURNS TABLE function, that one does need the drop-and-re-grant treatment.

**Tests.** jest on the fallback path (free text preserved when no city matches, and the displayed label preferring the reference row when one exists). Maestro: type a home city in Edit profile and assert the suggestion list, then save and assert the profile shows it. No pgTAP — no policy changes and no function signature changes, so no drop-function requirement.

**Risk.** Existing profiles have only free text, so the display has to keep working from `home_city` alone; do not make home_city_id load-bearing for rendering. The `home` anchor in src/features/chat/anchors.ts:44 renders 'where you are from' generically and is unaffected. This is genuinely optional before launch — it buys correctness for a field nothing currently groups by.

**Waits on.** Whether this is worth doing before launch at all — see the decisions list.

## Design system, shared components and accessibility

Thirty findings collapse into eighteen packages, and almost all of them are one of three problems wearing different clothes. The first is that this app writes fixed numbers where the OS gives live ones: a 50pt guess at a tab bar whose height follows Dynamic Type, a 52pt "height" that is really a minHeight, a hardcoded fontSize in the composer, a type scale whose tightest line heights clip anything with a tone mark, and a form whose last field runs off a scroll edge under the keyboard. The second is that a component the app already owns is not used where it was written to be used: LoadError exists and the most-trafficked profile route renders a black rectangle instead; PressableScale's own comment forbids a haptic on a scrolling row and two rows do it anyway; ChipRail takes a label and never draws it. The third is that the design system's written record has drifted from the code far enough to teach wrong behaviour, and the drift is now the fastest way for a contributor to introduce a bug. Nothing here touches the database, so there is no migration in this whole plan and every package ships over the air; the only build cost is CI time for two new simulator passes. The founder is really deciding three things: whether red may stay as a destructive label (the code has already decided yes and the rule says no), what comes out of the pin form so the expiry slider fits on a sheet that is already at full screen height, and whether nineteen screen headings dropping from 32pt to 24pt is the app he wants. I have dropped fourteen sub-claims, mostly because the code comment beside them records the opposite decision being taken on purpose, or because the arithmetic in the finding does not survive being recomputed.

### `ds-menu-dim` — Make the reaction menu's backdrop actually dim, and hide the message it lifted

**Priority** now · **Effort** M · **Ships as** over the air

Screenshot 25 shows the long-press menu open with everything behind it legible: "Maestro crew" and "1 person here" in the header, the "Message the ro…" placeholder in the composer, the day separator "Today 11:18 PM" sitting in the gap between the emoji pill and the lifted bubble so the menu appears to contain a stray line of text, and a second dimmed "First one in" directly under the lifted copy. This layer's whole stated job is "only this message matters right now" and it is not doing it. It has been fixed twice already (0.62, then 0.86) and is now at 0.88 with a GlassView layered on to carry the rest, and the photograph says the glass is not carrying it.

<details><summary>Closes 1 audit findings</summary>

- The long-press menu does not dim: header, composer, date separator and a ghost of the message all read through it

</details>

**Changes**

- src/features/chat/message-thread.tsx — delete the orphaned comment block at :111-131. It narrates the 0.62 → 0.86 → 0.95 history and now sits directly above `const RUN_AVATAR = 26` (:149), so the file's own documentation describes a constant that is not there.

- src/features/chat/message-thread.tsx — set MENU_SCRIM (:154) to 'rgba(2,3,9,0.95)', the value the stale comment already claims; delete MENU_GLASS_OVER_SCRIM (:160) and the `isLiquidGlassAvailable()` / `<GlassView>` block at :684-691; drop the `expo-glass-effect` import at :2, which is this file's only use of it. Do NOT paint the scrim over the glass instead: a near-opaque dim on top of a blur makes the blur invisible, so you pay for a GPU effect that does nothing. The comment at :674-682 already records exactly that failure arriving by a different route.

- src/features/chat/message-thread.tsx — hide the original bubble while its copy is lifted. `menu` is already in scope in the component that owns renderItem (state at :873, renderItem at :924), so pass `hidden={menu?.message.id === item.id}` into `<Bubble>` and have Bubble render its inner content at `opacity: 0` while the row keeps its measured height. This removes the ghost under the lifted copy no matter what the scrim opacity is, and it is what Messages does.

**Tests.** Re-shoot 25-reaction-menu.png through the `screens` skill. Acceptance is the picture: the header text, the composer placeholder, the day separator and the second "First one in" are all gone. Not a contrast calculation, and not the existing component tests, which pass on the broken screen because they call handlers directly.

**Risk.** At 0.95 the ground is near-black, so the lifted bubble and the two cards have to carry the whole composition on their own elevation; only the screenshot can say whether they do. The menu is a raw `<Modal>` that registers itself through `useRegisterNativeModal(menu != null)` at :878 — leave that call alone while editing this layer, or the push primer presents into a collision and the traps skill's dead-to-touch bug comes back.

### `ds-profile-load-states` — Give the public profile route the three states every other screen has

**Priority** now · **Effort** S · **Ships as** over the air

A traveler taps a face on the map or in Travelers, and on hostel wifi gets a black rectangle with a back button and no way to tell whether the person was deleted, the app broke, or the request never left the phone. The route renders an empty ThemedView while the query is in flight and renders that same empty view forever if it fails, because the branch above it only catches a successful empty result. LoadError was written for precisely this failure and this file imports neither it nor Skeleton.

<details><summary>Closes 1 audit findings</summary>

- Tapping a pin can open a permanently blank black screen with no spinner, no error and no retry

</details>

**Changes**

- src/app/profile/[userId].tsx — replace the terminal `if (!profile) { return <ThemedView style={styles.root} />; }` at :59-61 with two real branches. On `profileQuery.isError`, render `<LoadError what="this profile" error={profileQuery.error} onRetry={profileQuery.refetch} />`. While loading, render a hero-shaped skeleton: `<Skeleton aspectRatio={4 / 5} />` to match profile-hero.tsx's `aspectRatio: 4/5`, plus three text bars. Keep the existing `isSuccess && !profile` copy ("This traveler isn't available."), which is the only branch currently correct. Add the two imports the file lacks: `LoadError` from @/components/ui/load-error and `Skeleton` from @/components/ui/skeleton.

- src/features/profile/profile-view.tsx — add a `tripsPending?: boolean` prop beside the existing `photosPending` (declared at :676, consumed at :730) and use it at :407-415 so a failed trips fetch draws a placeholder instead of the sentence "No trips yet." A fetch that failed must never be rendered as an absence; that is the one thing that makes a real person look like a fake one.

- src/app/profile/[userId].tsx — the `?? []` defaults at :32-37 hide the same failure for prompts, priorities and trips. Thread `tripsPending={tripsQuery.data === undefined}` through, the same way `photosPending` already is at :74.

**Tests.** Jest is the wrong tool here (it would prove the mock). Add a Maestro step to e2e/flows/signed-in-tour.yml that taps a map pin's hero and asserts the profile name is visible, so the route is walked; the load and error branches are verified by screenshot with the network stopped, which is a manual check on the device. The `screens` skill's picture of the loading state is the evidence.

**Risk.** Small. The one trap is the skeleton shape: profile-hero uses `aspectRatio`, not a fixed height, precisely because a hardcoded hero height is right on one phone and kicks everything below it down by up to a hundred points on every other. Use aspectRatio in the skeleton too.

### `ds-bottom-clip` — Stop scrollers cutting their last control off the bottom of the screen

**Priority** now · **Effort** M · **Ships as** over the air

Screenshot 51 is the second step of account creation with the keyboard up, and the Age field draws left and right borders running into a hard horizontal cut with no bottom edge and no corner radius, above a large blue Continue. Nothing says the content scrolls. The same class of bug sits in the Sheet primitive: it caps its own height but React Native's flexShrink defaults to 0, so a sheet whose children do not shrink runs its overflow off the bottom of the screen, and the drag gesture is down-only so there is no way to pull it back. Trip editor is the worst case, and Travelers' "Add a trip first" wall makes it the gate on the whole tab.

<details><summary>Closes 2 audit findings</summary>

- The Age field on the second signup screen is sliced in half by the scroll edge under the keyboard

- A sheet with no internal scroller pushes its own primary button off the bottom of the screen at large text, and the fix already exists twice in the codebase

</details>

**Changes**

- src/components/form/step-screen.tsx — add `paddingBottom: Spacing.four + HitTarget` to `styles.content` (:159-162, currently `{ gap: Spacing.three, padding: Spacing.four }`), so the last field always clears the docked footer, which is a real sibling of the scroller at :103. Do NOT add `automaticallyAdjustKeyboardInsets`: the ScrollView is already wrapped in KeyboardFloor (:69), which pads the parent by `keyboard.height - insets.bottom`, and the ScrollView's own auto-inset would double-count that and push the last field a whole keyboard-height too far. KeyboardFloor is this project's settled answer for exactly this.

- src/components/ui/sheet.tsx — add two optional props: `scrolls?: boolean` (default false) and `footer?: ReactNode`. When `scrolls`, wrap `{children}` (:270) in a ScrollView with `style={{ flexShrink: 1 }}`, `keyboardShouldPersistTaps="always"` and `keyboardDismissMode="interactive"`, matching pin-form-sheet.tsx:150-168 exactly, and render `footer` as a sibling outside it. Opt-in rather than default so pin-form-sheet and place-sheet, which already own their scrollers, are untouched.

- src/features/trips/trip-editor.tsx — pass `scrolls` on the Sheet at :131 and move the two PrimaryButtons (:220 Add trip / Save changes, :231 Delete this trip) into the new `footer` slot, so the calendar and suggestion rows scroll and the submit stays pinned. The traps skill is explicit that a primary action inside a ScrollView is reachable only by scrolling.

- src/components/form/select-field.tsx — pass `scrolls` on the Sheet at :81 so a long option list gives way instead of overflowing.

- src/features/notifications/push-primer.tsx — pass `scrolls` on the Sheet at :91 with the two buttons in `footer`.

**Tests.** Re-shoot 51-signup-who.png with the keyboard up: the Age field must draw a closed rounded rectangle like the Name field above it. Add one Maestro pass (see ds-tab-bar-inset for the AX5 simulator step) that opens Add a trip from the Travelers "Add a trip first" wall and asserts `save-trip` is visible and tappable at the largest text size. src/components/ui/**tests**/sheet.test.ts already guards the entrance against the Slide presets; extend it to assert the scroller is only mounted when `scrolls` is set.

**Risk.** The Sheet is the app's most load-bearing primitive and the traps skill has four separate entries about it. Do not touch the transform entrance (:172-175, :217) or the SlideOutDown exit while you are in here, and do not change `avoidKeyboard`'s `Math.max(insets.bottom, lift)` at :214, which is a fix for the home indicator being reserved twice. The `scrolls` default of false is what keeps the blast radius to three callers.

### `ds-haptics-vocabulary` — Stop scrolling from buzzing, and make destructive taps feel destructive

**Priority** now · **Effort** S · **Ships as** over the air

PressableScale fires its haptic on touch-down, which is right for a button and wrong for anything you might be about to scroll past. Its own doc comment states the rule and two call sites break it, so flicking the venue stack or the guest Travelers page produces a soft impact for a gesture that does nothing. That is exactly how haptics stop meaning anything. Meanwhile `warning` is documented as "destructive confirmation (delete, leave)" and has exactly one call site in the whole app: a form telling you that you picked too many languages. Unsend, leave group and take-a-pin-down-early all complete with no distinct feedback at all.

<details><summary>Closes 2 audit findings</summary>

- A touch-down haptic fires on rows inside scrollers, so scrolling buzzes

- The warning haptic is defined for destructive confirmations and used only for a language limit

</details>

**Changes**

- src/app/(tabs)/travelers.tsx:145 — `haptic="soft"` to `haptic="none"` on the featured card, which sits inside the ScrollView opened at :116.

- src/features/pins/map-screen.tsx:1602 — same, on the venue row inside the ScrollView at :1595, which is capped at `maxHeight: 260` and genuinely scrolls.

- No change at map-screen.tsx:153, :279 or :1248. I opened them: :153 and :279 are inside PinCard (:147), which is not in a scroller, and :1248 is the place-mode Cancel button, a real control that is correctly haptic. Recording that here so the next audit does not re-open them.

- src/features/pins/map-screen.tsx:371-373 — fire `haptics.warning()` inside the Alert's "Take it down" onPress, before `deletePin.mutate(pin.id)`.

- src/features/chat/message-thread.tsx:1072-1078 — fire `haptics.warning()` in the `onUnsend` callback before calling through.

- src/app/group/[id].tsx:228-239 — fire `haptics.warning()` in `confirmLeave`'s "Leave" handler, before `leaveRoom.mutate`.

- src/components/form/language-field.tsx:70 — `haptics.warning()` to `haptics.selection()`. Refusing an eighth language is a limit, not a destruction.

**Tests.** Jest cannot feel a haptic. The unit-testable half is the rule, not the call: add a jest test in src/components/ui/**tests** that renders PressableScale with `haptic="none"` and asserts no haptics module call fires on press-in. Everything else is a device check, walked once: scroll the venue stack and the guest Travelers page and feel nothing; unsend a message and feel the warning.

**Risk.** Low. Note that the language-field change is a copy-adjacent decision as well as a haptic one, and the "take it down" path is a §7-rule-3 surface (pin expiry) — the change adds feedback only and must not touch `deletePin` or the expiry maths.

### `ds-chat-header` — Make the Chat header say which segment is on, and say what the plus does

**Priority** now · **Effort** S · **Ships as** over the air

Three things in one 44pt row, all visible in screenshot 27a. The segmented thumb is surfaceSunken on a surface track at 1.135:1 (I recomputed it) with a StyleSheet.hairlineWidth border, so a 3.4:1 colour is drawn 0.33pt wide at 3x and the control's primary signal is a sub-pixel edge, on the tab where people switch most. The thumb then slides over 150ms while the list swaps in the same commit, so for those 150ms the thumb is over Chats and the screen shows groups. And the "+" is a rounded square sitting immediately beside a 44pt circular AvatarButton, labelled "Start a chat" while its destination is /new-group, which the file's own comment says is a thing this screen cannot do.

<details><summary>Closes 3 audit findings</summary>

- The segmented control's selected state is a 0.33pt stroke over a 1.15:1 fill difference

- The segmented thumb slides while the content behind it has already swapped

- The Chat header's "+" is a square among circles, and its VoiceOver label promises a chat but opens a group

</details>

**Changes**

- src/components/ui/segmented.tsx — in `styles.thumb` (:126-134) change `borderWidth: StyleSheet.hairlineWidth` to `1.5`. Keep `borderColor: theme.border` (:70) and keep the selected label at `theme.text` (:98). Do not chase the fill: accentSoft #1D2742 on surface #171A2E is 1.17:1, a 0.03 improvement on today's 1.13:1 and still nothing anyone can see, and Elevation.raised is a drop shadow on a #0E1020-family ground, which is invisible. Spend the contrast on the edge.

- src/components/ui/segmented.tsx:92-97 — the `withTiming` and the `onChange` fire back to back in the same handler. Leave that; fix it at the caller instead so the durations match.

- src/app/(tabs)/chat.tsx — wrap the list body under the header in `<Animated.View key={tab} entering={FadeIn.duration(Motion.quick)}>` so the content change and the thumb travel share 150ms. FadeIn is safe here: the traps skill establishes that Fade and Zoom animate opacity and transform only and never own the frame, unlike the Slide family.

- src/app/(tabs)/chat.tsx:936-938 — change `accessibilityLabel="Start a chat"` to `accessibilityLabel="New group"` and add `accessibilityHint="One-to-one chats open when someone answers your hello"`, which is information a VoiceOver user cannot get from this screen any other way. Swap the glyph to `person.2.badge.plus` (ios) / `group_add`.

- src/app/(tabs)/chat.tsx:1148-1152 — `styles.headerAction`: `borderRadius: Radius.md` to `borderRadius: HitTarget / 2`, so it is a circle like every other round-glyph control in the app (back buttons, the Next circle, send, room avatars) and like the AvatarButton it sits beside.

**Tests.** Re-shoot 27a-chat-list-with-a-row.png and 20-chat-individual.png; acceptance is being able to see which of Chats/Groups is on without hunting. Update the Maestro assertion in e2e/flows/signed-in-tour.yml that taps this control: a Pressable with its own accessibilityLabel hides the text inside it from Maestro, so the flow must assert the spoken label, which is changing from "Start a chat" to "New group".

**Risk.** The label change breaks any Maestro step that taps `Start a chat`; grep e2e/flows before pushing. Nothing about the destination changes, so the comment at :916-930 defending a constant destination across both segments still holds.

### `ds-reduce-motion` — Honour Reduce Motion and Reduce Transparency, which DESIGN.md already promises

**Priority** now · **Effort** M · **Ships as** over the air

grep for ReduceMotion, useReducedMotion and AccessibilityInfo across src/ returns zero hits, and docs/DESIGN.md:112 states "Everything respects Reduce Motion" while :54 claims "every glass surface has a solid fallback". This is a regression against a written contract, not a generic accessibility ask. Two animations loop forever with no off switch: the skeleton's opacity pulse, which runs on the Chat and Travelers first paints, and the intro tour's breathing glow over 2.6s, which is the very first screen anyone sees. A traveler with a vestibular disorder or motion sickness on a long bus, which is a real state for this audience, gets exactly the same app.

<details><summary>Closes 3 audit findings</summary>

- Reduce Motion is honoured nowhere in the app, including two infinite loops

- Nothing in the app asks whether Reduce Motion is on

- Nothing in the app reacts to Reduce Transparency, Increase Contrast or Bold Text; the glass fallback is chosen by OS version alone

</details>

**Changes**

- src/constants/theme.ts — `import { ReduceMotion } from 'react-native-reanimated'` and add `reduceMotion: ReduceMotion.System` to each of the eight presets in `Springs` (:221-230). `snap` and `pop` are duration/dampingRatio configs and still accept the field. Do NOT hang this off `Motion` (:208): that is a duration map and adding a non-numeric key breaks every `Motion.quick` call site that passes it straight through as a duration.

- src/components/ui/skeleton.tsx:46-48 — gate the `withRepeat(withTiming(1, { duration: 900 }), -1, true)` on `useReducedMotion()` and hold `pulse` at its mid point (0.75) instead. Two lines, and it covers one of the app's only two infinite loops.

- src/features/intro/intro-tour.tsx:155-161 — same gate on the `withRepeat(withTiming(0.95, { duration: 2600 }), -1, true)` breathing glow, holding `breath` at 0.75.

- src/hooks/use-accessibility-settings.ts (new) — a single hook wrapping `AccessibilityInfo.isReduceMotionEnabled()` and `isReduceTransparencyEnabled()` plus their change listeners, so there is one subscription rather than one per component. It lives beside use-theme.ts.

- src/features/pins/map-screen.tsx — consume the hook for the camera work Reanimated does not cover: the city-switch and address-search flights become `setCamera` without animation when Reduce Motion is on.

- src/components/ui/glass-surface.tsx:41 — the only branch today is `isLiquidGlassAvailable()`, an OS capability check. Add the second condition: take the opaque fallback branch when Reduce Transparency is on. The branch already exists; it needs one more term.

- docs/DESIGN.md:112 and :54 — leave the claims in place once this lands, but only once it lands.

**Tests.** A jest test in src/components/ui/**tests** that mocks `useReducedMotion` to true and asserts Skeleton does not call withRepeat. Then a simulator pass with Reduce Motion and Reduce Transparency on, added alongside the AX5 pass in ds-tab-bar-inset, screenshotting Chat first paint, the intro tour's welcome page and the map's empty banner. The DESIGN.md claim should be backed by a picture, which is exactly what it has never had.

**Risk.** Reanimated already honours the system flag for withSpring and withTiming, so the Springs change is belt-and-braces and cannot regress anything. The real judgement call is the map camera: the place-mode pin lift carries information (which coordinate is being marked), so keep the ground dot and drop the travel there rather than removing the feedback. Do not gate the confirmation haptics — those are information, not decoration.

### `ds-pin-form` — Pin form: label the day chips, get the expiry slider on screen, and say why Drop it is off

**Priority** next · **Effort** M · **Ships as** over the air

Three failures stack on the app's most important write action, all visible in screenshot 14. ChipRail takes a `label` prop and never renders it (it sets accessibilityLabel on a horizontal ScrollView, which is not a focusable element), so "When" is invisible to sighted users and to VoiceOver alike, and a bare Today / Tomorrow / Monday row floats between the Details field and a heading reading "Disappears after" — the obvious reading is that those chips are the expiry. The actual expiry control is clipped off the bottom of the scroll viewport, on a form whose 72-hour cap is a §7 hard rule. And "Drop it" is disabled on `venue.trim().length === 0` with nothing saying so; the footnote in that slot is talking about expiry instead.

<details><summary>Closes 1 audit findings</summary>

- Pin form: the day chips have no visible label, the expiry slider is cut off below the fold, and "Drop it" is greyed with no reason given

</details>

**Changes**

- src/components/form/chip-rail.tsx:28-34 — render `label` as a visible `<ThemedText type="smallBold">` heading above the rail, and move the accessibilityLabel off the ScrollView onto a wrapping `<View accessibilityRole="radiogroup">`. `smallBold` is what pin-form-sheet already uses for "Disappears after" (:325), so the two headings match.

- src/features/pins/pin-form-sheet.tsx — add the note the disabled button owes: above the PrimaryButton at :340, render `venue.trim() ? null : "Say what the plan is and you can drop it."` This is the slot StepShell has a purpose-built `note` prop for, used there to say "A profile photo is the one thing we need."

- src/features/pins/pin-form-sheet.tsx — recover the vertical room the slider needs. I measured the screenshot against sheet.tsx:252: the sheet is ALREADY at its cap (`height - insets.top - Space.lg`, roughly 796pt of an 874pt screen), so there is no detent to raise and the verifier's suggestion to raise one is not available. Something has to come out. Cheapest two: drop `noteInput.minHeight` from 62 to 44 (:383, the field still grows to two lines), and render the `detail` sentence on the selected join mode only, collapsing the other card to its label. That is roughly 60pt, which is what HoursSlider plus its value label costs.

- src/features/pins/pin-form-sheet.tsx:163-168 — the team already answered the clipping with `showsVerticalScrollIndicator` + `indicatorStyle="white"`, and screenshot 14 shows that bar is invisible at rest. Leave it in, but do not treat it as the fix; it has already failed once.

**Tests.** Re-shoot 14-pin-form.png through the `screens` skill. Acceptance is the picture: a visible "When" heading over the day chips, the hours slider drawn under "Disappears after", and a line above a greyed Drop it saying what is missing. The form's existing jest tests pass today on the broken screen, so they are not evidence. Add one assertion to the pin subflow in e2e/flows/signed-in-tour.yml for the slider's accessibilityLabel, "How long this pin stays up", so a future regression fails the run rather than only the eye.

**Risk.** Trimming the join-mode detail lines is a copy decision as well as a layout one, and the comment on JOIN_MODES says the difference between the two options IS the sentence under each label. Showing it on the selected card only keeps the information one tap away rather than deleting it, but the founder should see the picture. Nothing here may touch MAX_PIN_HOURS or `expiryForHours` — the 72h cap is §7 rule 3.

**Waits on.** The pin sheet is already at full screen height, so the expiry slider only fits if something else shrinks. For trimming: the slider is a hard-rule control and a user who cannot see it cannot set it, while the join-mode detail is one tap away on the selected card. Against: those two sentences are the whole difference between the two join modes and the code comment says so explicitly.

### `ds-type-scale` — Make the type scale real: unshadow title, loosen the clipping line heights, delete the last hardcoded font size

**Priority** next · **Effort** M · **Ships as** over the air

themed-text.tsx maps the string `title` onto the `display` role and consults that LEGACY map before the real roles, so all 19 `type="title"` call sites render at 32/38 instead of 24/30, and `subtitle` shadows the real `title` the same way. A contributor reading theme.ts and writing `type="title"` gets something 33% larger than the table says, with no error. Separately the scale's tightest ratios are Latin ratios — display 1.19, title 1.25, caption 1.27 — and Thai, Lao, Burmese, Devanagari and Vietnamese stack marks that get sheared by a Text with an explicit lineHeight. The profile hero renders the name at the tightest ratio in the scale. And the chat composer hardcodes `fontSize: 15` where theme.ts's own header says nothing in the app hardcodes a font size, so at AX5 a 120pt box holds about one and a half lines of the message you are composing — on a product where every first message is moderated and has to be right first time.

<details><summary>Closes 3 audit findings</summary>

- type="title" silently renders at display size - the documented 24pt title role is unreachable

- The type scale's tightest line heights are Latin ratios, and they clip exactly where names render

- The chat composer's font size is hardcoded, so at accessibility sizes you can see roughly one line of what you are typing

</details>

**Changes**

- src/components/themed-text.tsx:11-20 and :30 — walk the 19 `type="title"` sites and name the role each one wants, THEN delete `title` and `subtitle` from LEGACY and from the props union at :24. Keeping display (32pt): features/signup/step-shell.tsx:131, app/(tabs)/travelers.tsx:123, app/profile-me.tsx:59 and :122, features/chat/message-thread.tsx:726 (that one is a reaction emoji, where 32 is a size not a heading). Moving to the real title (24pt): components/ui/profile-hero.tsx:50, app/place/[id].tsx:357, app/group/[id].tsx:355, app/(tabs)/my-business.tsx:463, app/(tabs)/chat.tsx:909, app/archived-chats.tsx:24, app/add-to-group/[userId].tsx:57, app/add-people/[chatId].tsx:52, app/rate-place.tsx:204/:255/:307, app/(tabs)/travelers.tsx:202 (a monogram letter inside a 44pt circle) and :611/:657 (empty-state headlines, one of which is a full sentence and reads as a wall at 32pt). Then rename the 9 `type="subtitle"` sites to `type="title"`: components/form/step-screen.tsx:80, components/placeholder-screen.tsx:44, app/compose-request.tsx:142 and :167, app/guidelines.tsx:23, app/\_layout.tsx:54 and :90, features/pins/map-screen.web.tsx:41, features/notifications/push-primer.tsx:100. Do all three edits in one commit — flipping precedence as a one-liner would silently shrink 19 headings while leaving subtitle at 24pt, so two roles collide.

- src/constants/theme.ts:146-152 — raise display to 32/42, title to 24/32 and caption to 11/15. Nothing in the Latin rendering gets worse at those values and the non-Latin clipping stops. `body` at 16/23 is already fine; leave headline and callout at 1.33.

- src/features/chat/composer.tsx:168-176 — replace the literal `fontSize: 15` with `Type.callout.fontSize`, and make `maxHeight` proportional to fontScale (four lines' worth: `4 * Type.callout.lineHeight * fontScale`, clamped so it cannot eat the thread). The keyboard floor at message-thread.tsx:643 already computes against the window, so a taller composer will not push send off screen.

- src/components/**tests**/themed-text.test.tsx (new) — assert the resolved fontSize for every role name the props union accepts, so this class of shadowing cannot come back silently.

**Tests.** The snapshot test above is the regression guard. The change itself is verified by the `screens` skill, not by typecheck, which cannot see any of this: re-shoot 42, 48, 51, 54 (signup and business-signup headings, which keep display), 18-profile-me, 73-business-account, 27b, 24 and 17 (headings that drop to 24pt), and 20/27a for the Messages title. For the line heights, rename one demo traveler in scripts/demo-travelers.json to a Thai display name and one to a Devanagari one, re-seed through .github/workflows/demo-travelers.yml, and re-shoot 17 — clipping is a picture, not an assertion.

**Risk.** This is the most visible change in the plan: nineteen headings shrink by a third in one commit. That is the intended outcome and it is still worth showing the founder before it goes to TestFlight. The demo-fixture half costs a re-seed against the live backend and a re-shoot; if that is not wanted now, ship the line-height raise anyway (it cannot make Latin worse) and take the picture later.

**Waits on.** Nineteen screen headings drop from 32pt to 24pt. For: the scale then means what theme.ts says, there is a real step between a screen title and the biggest thing available, and long empty-state sentences stop reading as walls. Against: the app currently looks bolder, and the founder may simply prefer 32pt for card and sheet titles, in which case the honest fix is to rename those sites to `display` explicitly and keep the size.

### `ds-empty-state` — One EmptyState component, top-anchored, everywhere a list can be empty

**Priority** next · **Effort** M · **Ships as** over the air

Two states of the Chat screen compose as if they were designed by different people: the guest version centres its block in whatever space is left, so the first thing a new visitor reads on the Chat tab is a wall of nothing; the signed-in version jams a small card under the segmented control and leaves the rest as void. The guest version also has no title at all, just a stray sentence, where every other empty state in the app has a title, a body and an action. The same divergence repeats across travelers.tsx (three branches, two different top pads), archived-chats, add-to-group and add-people. Having both is what makes the app feel unfinished.

<details><summary>Closes 2 audit findings</summary>

- The same Chat screen anchors its empty state two different ways depending on who is looking

- The guest Chat tab floats one sentence in a screen of empty space (the missing-title half only)

</details>

**Changes**

- src/components/ui/empty-state.tsx (new) — `<EmptyState title body action />`, sitting beside load-error.tsx and skeleton.tsx. Title at `type="title"` (the real 24pt once ds-type-scale lands), body at `type="body"` in textSecondary, optional action as a PrimaryButton. Top-anchored at the same offset a populated list's first row uses, so switching between empty and full does not move the eye.

- src/app/(tabs)/chat.tsx:1075-1092 — replace the inline `emptyCard` with EmptyState, keeping all three copy branches (business / groups / individual) and the "Find travelers" action exactly as they are. The guard chain above it at :1071-1074 is load-bearing (it stops the card painting under skeletons, under "You said hi - Sent", and over failed hellos) — keep it verbatim.

- src/app/(tabs)/chat.tsx:873-879 — the guest Chats branch: add the missing title above the existing sentence so the block has the same title/body/action shape. Whether to keep `styles.guestCentre`'s centring is a founder decision (see decisions) — the comment at :813-819 records that top-aligning it was tried and rejected. Ship the title regardless; it is the only part of that finding not already answered.

- src/app/(tabs)/travelers.tsx:606-620 and :650-670 — both empty walls become EmptyState, which also fixes their headings dropping to 24pt and removes the two different top pads (`insets.top + Space.xxl` versus `insets.top + Space.sm + HitTarget + Space.lg`). Keep the second one's clearance for ProfileCorner — that offset exists because Space.xxl put the headline through the avatar's lower half.

- src/app/archived-chats.tsx, src/app/add-to-group/[userId].tsx, src/app/add-people/[chatId].tsx — adopt EmptyState in place of their inline blocks.

**Tests.** Re-shoot 04-chat-guest.png, 20-chat-individual.png, 17-travelers-signed-in.png and 27c-add-people.png. Acceptance is that an empty list and a populated one start at the same y. A jest render test in src/components/ui/**tests** asserting EmptyState renders title, body and action in that order and omits the action when none is given.

**Risk.** The signed-in Chat empty card sits behind a four-term guard that took three separate bugs to arrive at; moving the card must not move the guard. Do not give the traveler Chat tab a "Messages" title to match the business branch: that would put a title above a Segmented control the business branch does not have, adding a second header row on one branch only and reintroducing the divergence this package exists to remove. If the tab wants a title, both branches get it and the segmented control moves below it, which is a bigger change than this.

**Waits on.** Whether the guest Chats branch keeps its vertical centring. The comment at chat.tsx:813-819 already records top-aligning being tried and rejected, so this is a decision to revisit, not a bug to fix.

**After.** `ds-type-scale`

### `ds-voiceover-state` — Say the state change out loud: loading, empty, failed, and the unread count

**Priority** next · **Effort** M · **Ships as** over the air

The label coverage in this app is genuinely good, which makes this the binding gap. Skeletons are correctly hidden from VoiceOver, and nothing announces anything, so a blind user on the Chat or Travelers tab hears silence while a screen loads, silence when it resolves to empty, and silence when it resolves to a LoadError. The three outcomes are indistinguishable without re-exploring the screen by hand, on precisely the screens where the difference matters most: is my archive gone, or did the request fail. Separately the Chat tab's badge is the app's only unread signal, and on iOS 26's Liquid Glass tab bar UIKit no longer derives an accessibilityValue from badgeValue, so a screen reader user hears "Chat, tab" whether five people are waiting or nobody is.

<details><summary>Closes 2 audit findings</summary>

- No screen announces its own state change to VoiceOver, so a blind user cannot tell loading from empty from failed

- iOS 26 stopped narrating tab bar badges, so the Chat unread count is silent to VoiceOver

</details>

**Changes**

- src/features/chat/use-announce.ts (new, beside use-mark-read.ts) — a one-shot announce hook wrapping `AccessibilityInfo.announceForAccessibility`, guarded by `AccessibilityInfo.isScreenReaderEnabled()` so it does no work when VoiceOver is off. Announce is the primary mechanism, not the fallback: `accessibilityLiveRegion` and `accessibilityRole="alert"` are Android-only in React Native and are no-ops on this app's platform.

- src/components/ui/load-error.tsx — fire `AccessibilityInfo.announceForAccessibility(loadFailureMessage(error, what))` in a mount effect, and add `accessibilityLiveRegion="polite"` on the root at :33 as the Android path only.

- src/app/(tabs)/chat.tsx, src/app/(tabs)/travelers.tsx and the map's empty banner — call the hook on the loading-to-settled transition: "6 chats", "No chats yet", "Your chats could not load".

- src/components/app-tabs.tsx:60-77 — set an explicit accessibilityLabel on the Chat trigger that carries the count and changes with it: "Chat" at zero, "Chat, 3 waiting" otherwise. "Waiting" is the word the chat code already uses and it avoids the banned "request". First verify against the installed expo-router types whether NativeTabs.Trigger forwards accessibilityLabel to the UITabBarItem in SDK 57 — node_modules is not installed in my sandbox so I could not check. If it does not, file it upstream and announce the change once per arrival from the Chat tab in the meantime.

**Tests.** VoiceOver on a real device, not the simulator's inspector — the badge behaviour is the whole reason this finding exists and the simulator's accessibility inspector will not reproduce it. Walk: open Chat cold with the network off (hear the failure), with an empty account (hear "No chats yet"), and with three hellos waiting (hear the count on the tab). A jest test that the announce hook does nothing when isScreenReaderEnabled resolves false.

**Risk.** An announcement that fires on every render is worse than silence. The hook must fire once per settle, keyed on the query's status transition, not on data identity. The tab-label half may turn out to be unimplementable in SDK 57's NativeTabs, in which case ship the announcements alone rather than dropping the package.

**After.** `ds-empty-state`

### `ds-tab-bar-inset` — Measure the tab bar instead of guessing 50pt, and photograph the app at AX5

**Priority** next · **Effort** L · **Ships as** over the air

`BottomTabInset` is a literal — 50 on iOS — for a bar whose height is driven by its item labels, and those labels scale with Dynamic Type. Twenty-eight call sites across nine files read it. At the AX sizes the real bar grows upward while every floating dock in the app stays put, so "Drop a pin" on the Map and "Say hi" on Travelers slide underneath it, along with the connected notice, the empty-city banner and the tail of every list. Those are the app's two primary actions, on the two screens the product is for, becoming untappable for the users most likely to have raised their text size. Nothing in the app reads fontScale outside the chat reaction menu, so nothing notices.

<details><summary>Closes 1 audit findings</summary>

- The whole bottom edge of the app is built on a hardcoded 50pt guess at a tab bar that grows with Dynamic Type

</details>

**Changes**

- src/hooks/use-tab-bar-inset.ts (new) — publish the inset as a hook derived from `useWindowDimensions().fontScale`, with a floor of 50 and a clamped multiplier. Before writing it, check whether expo-router's NativeTabs in SDK 57 exposes the iOS 26 tab bar accessory slot: UIKit positions an accessory above the bar and animates with it, which makes the clearance stop being the app's problem at all. Read the installed types in node_modules — the docs at docs.expo.dev/versions/v57.0.0/ are the other source, and the traps skill forbids recalling this API from memory.

- src/constants/theme.ts:249 — keep `BottomTabInset` exported as the hook's floor so nothing breaks mid-migration, then delete it once the last call site moves.

- Migrate the 28 reads: src/features/pins/map-screen.tsx (:1285, :1309, :1353, :1377, :1403, :1454, :1487), src/app/(tabs)/travelers.tsx (:121, :350, :409, :459), src/app/(tabs)/my-business.tsx (:423, :744, :759), src/app/(tabs)/chat.tsx (:820, :901), src/features/matching/connected-notice.tsx:56, src/components/placeholder-screen.tsx:73. src/features/pins/map-screen.web.tsx:39 and src/components/app-tabs.web.tsx keep the constant (there is no native bar on web).

- .github/workflows/e2e.yml — between the boot at :148 and the flow loop at :318, add a step that runs `xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large`, runs one new flow, and resets. The loop already globs `../e2e/flows/*.yml`, so the flow file has to sit outside that glob or the ordinary passes inherit the setting.

- e2e/flows/large-text-tour.yml (new) — Map, Travelers and Chat at AX5, screenshotting each, plus a tap on "Drop a pin" and "Say hi" to prove they are still reachable. Add the Reduce Motion and Reduce Transparency passes from ds-reduce-motion to the same step.

**Tests.** The AX5 flow above is the test, and its output is a set of pictures rather than an exit code — which is the only thing that answers "does the button still exist". Also assert the two primary actions by their spoken labels, not their visible text: a Pressable with its own accessibilityLabel hides its children from Maestro on iOS.

**Risk.** Twenty-eight call sites is a wide diff and every one of them is a bottom edge somebody already tuned by eye, so the AX5 pictures are not optional and neither are re-shoots at the default size. If the accessory-slot route turns out to exist, it is a better answer but touches native presentation and would need an EAS build to verify; check that before committing to the hook. Nothing here touches pin expiry, location or pricing.

### `ds-action-docks` — Travelers and My business: measure the bar, give it a floor, and label the browse action

**Priority** next · **Effort** M · **Ships as** over the air

Screenshot 17 shows "…ico" and "Sep 25 – Oct 28" from the next traveler's card reading legibly underneath and around the Say hi pill. There IS a gradient backdrop, but the bar row itself has no fill, and the backdrop was deliberately shrunk once already because the taller version sliced "Both there Aug 23 - 28" in half — the one fact explaining why this person is on screen. Underneath that, three magic numbers are derived from PrimaryButton's 52, which is a minHeight around a scaling label, not a height: at AX sizes the Say hi pill is 90-110pt tall while the Next circle stays a hard 52, the row loses its baseline, the gradient starts a line and a half above the bar again, and the 148pt scroll tail is shorter than the bar so the last lines of a bio sit under the buttons. Both of those are regressions the file's own comments say were already fixed once. Separately the browse action is an unlabelled dark circle at low contrast while the commit action gets the full accent pill, on a screen the brief describes as reading rather than judging.

<details><summary>Closes 2 audit findings</summary>

- The Travelers and My business action bars derive three magic numbers from PrimaryButton's minHeight, so at large text the bar goes lopsided, the fade stops short and the bio runs under the button again

- The Travelers action dock is transparent, so the next card's text reads through the buttons

</details>

**Changes**

- src/app/(tabs)/travelers.tsx — put `onLayout` on the action bar container (:408), hold its height in state, and feed that one number to the ScrollView's paddingBottom (:350) and to the gradient's height (:404). Delete ACTION_BAR_CLEARANCE (:444), ACTION_BUTTON (:448) and actionBarHeight() (:458). Keep ACTION_BAR_RAMP as the fade above the measured height.

- src/app/(tabs)/travelers.tsx:794-804 — give `styles.actionBar` a `theme.background` fill bounded exactly to the measured bar height, so nothing reads through the buttons. Leave the existing transparent-to-background LinearGradient ramp above it alone; do not raise it, because travelers.tsx:448-458 records that exact fix being backed out for dissolving the overlap line.

- src/app/(tabs)/travelers.tsx:805-813 — the Next control: replace the hard `width: 52, height: 52, borderRadius: 26` circle with a secondary pill reading "Next" at the same height as the Say hi PrimaryButton, using `minHeight: 52` and `alignSelf: 'stretch'` so it tracks its neighbour instead of shrinking away from it. Keep the existing `accessibilityLabel="Next traveler"` at :414. "Next" carries no deck vocabulary; it is the browse half of read-or-move-on.

- src/app/(tabs)/my-business.tsx — identical shape, identical bug: DOCK_CLEARANCE (:48), DOCK_BUTTON (:51) and dockHeight() (:758-760) all go, replaced by the measured height feeding :423 and :740; give `styles.dock` (:743) the same opaque floor.

**Tests.** Re-shoot 17-travelers-signed-in.png and 70-business-my-business.png at the default text size (nothing reads through the bar) and at AX5 in the new large-text flow (the two controls share a baseline and the bio does not run under them). No unit test proves either of these; the last two attempts at this were both caught by a screenshot and both re-broken by reasoning.

**Risk.** Measuring in onLayout means one frame where paddingBottom is 0, which on a short profile can flash the content up and settle it. Seed the state with the current constant so the first frame is right and the measurement only corrects it. The gradient is the part with history: two separate comments in these files record it being tuned and re-tuned against the overlap line, so re-shoot a traveler with exactly one trip.

**After.** `ds-tab-bar-inset`

### `ds-design-doc` — Cut the token tables out of DESIGN.md and point at theme.ts

**Priority** next · **Effort** M · **Ships as** over the air

DESIGN.md is the file a contributor opens to learn this design system, and almost every hard number in it is wrong. It names the palette "Dusk: deep indigo + burnt amber on warm bone" with a light column; the app ships "Nocturne", dark only, with Colors.light identical to Colors.dark. Every dark value has drifted (canvas, surface, text, highlight, warning, danger, hairline), the type table says display 34/40 and title 26/32 against a shipped 32/38 and 24/30, the radius scale is 10/14/20/28 against a shipped 8/12/16/20, and six tokens carrying the app's contrast floors are absent entirely. Worse, three passages now teach wrong behaviour: it says traveler pins are indigo with white glyphs where theme.ts says a blue pin on a dark blue basemap is the exact collision the palette exists to avoid, it says the docked Drop a pin button is amber where screenshot 28 shows it blue, and it teaches the banned words "Requests", "sending a request" and "establishment rooms" after the founder's 2026-08-28 reversal.

<details><summary>Closes 1 audit findings</summary>

- docs/DESIGN.md documents a different design system than the one that ships - wrong palette, wrong scales, wrong pins, banned vocabulary

</details>

**Changes**

- docs/DESIGN.md:60-87 and :98-107 — delete the colour, type, space and radius tables outright and replace them with a pointer to src/constants/theme.ts, which already carries the ratios and the reasoning inline and is the only copy that cannot go stale silently. Do not patch the numbers; they will drift again.

- docs/DESIGN.md:317-319 — correct the pin colours: amber #FF9A5A body with a #0E1020 glyph for traveler pins and gold #FFC168 for curated seeds, per src/features/pins/pin-marker.tsx:46-48. State why (blue on a dark blue basemap), because that is the part worth keeping.

- docs/DESIGN.md:293 — correct the amber Drop-a-pin claim; the button is accent blue in screenshot 28 and amber is spent on twenty markers on that screen.

- docs/DESIGN.md:122, :139, :173 — replace "Requests", "sending a request" and "establishment rooms" with the words the app now uses. This doc is where the next contributor learns the vocabulary and it currently teaches three banned terms.

- docs/DESIGN.md — add a line at the top saying which file wins on tokens, and keep everything the doc is uniquely good at: the research, the guest ladder, the motion and haptics table, the craft-pass narrative.

**Tests.** Docs. The check is a grep: after this lands, `grep -nE '#[0-9A-Fa-f]{6}' docs/DESIGN.md` should return only the three pin colours it explains, and the vocabulary test at src/features/business/**tests**/vocabulary.test.ts is the model for extending a banned-words check to this file if that is wanted.

**Risk.** None to the app; this ships no code and reaches nobody's phone. The risk of NOT doing it is the one that has already been paid: line 77 lists accent as #2A4C9B, the exact value theme.ts spends a paragraph explaining is unusable at 2.34:1 for anything readable.

### `ds-demo-marker` — Move the demo disclosure out of the bio prose and onto the card

**Priority** next · **Effort** S · **Ships as** over the air

The seeded bios end with "[demo]" and it renders in full as a fourth line on the guest Travelers card — the screen where a stranger decides whether this app is real. The intent is right and must survive: the fixture's own readme says every bio carries a visible marker and no real person's likeness is used. But a bracketed token appended to prose does not read as a disclosure to anybody; it reads as unfinished software. It also flows into a first message: profile-view.tsx:910 passes the bio through as the `quote` on a reply, so "[demo]" would be quoted back at somebody.

<details><summary>Closes 1 audit findings</summary>

- The guest Travelers screen looks nothing like the real one, and the first bio a guest reads ends in "[demo]" (the [demo] half)

</details>

**Changes**

- src/lib/demo-marker.ts (new) — `splitDemoMarker(bio): { bio: string; isDemo: boolean }`, a pure function that strips a trailing "[demo]" and reports whether it was there. Pure logic, so it gets a jest test.

- src/app/(tabs)/travelers.tsx:219 — render the stripped bio and, when `isDemo`, a caption chip on the card reading "Sample profile" in surfaceSunken. The chip survives truncation and translation, which the suffix does not.

- src/features/profile/profile-view.tsx:902-915 — the same split for the About block, and use the stripped text for the `onRespondTo` quote at :910 so a demo marker cannot end up inside somebody's first message.

- No change to scripts/demo-travelers.json. The marker stays in the data, so the runbook's purge requirement and the honesty commitment are untouched — this only changes how it is displayed.

**Tests.** A jest test for splitDemoMarker covering a bio with the marker, without it, and with trailing whitespace around it. Then re-shoot 03-travelers-guest.png: the bio ends in prose and a "Sample profile" chip sits on the card.

**Risk.** Low, but the disclosure is the point: if the chip does not render, the app is showing an AI-generated portrait with no marker at all. The jest test must assert that `isDemo` is true whenever the marker was present, and the screenshot must show the chip before this ships.

### `ds-sheet-gesture` — Let the whole sheet card take the drag, not just the grabber

**Priority** later · **Effort** M · **Ships as** over the air

The pan gesture is attached only to the 24pt grabber strip, so pulling down on a card's own title does nothing. On iOS a grabber means "this thing is draggable", and here it is the only 24pt of a full-width card that actually is. Three surfaces sit over the live map and all three are cards a user reaches for by the header.

<details><summary>Closes 1 audit findings</summary>

- Every sheet has one height, the drag only goes down, and only the grabber accepts it (the gesture-target half)

</details>

**Changes**

- src/components/ui/sheet.tsx:259-271 — move the GestureDetector from the grabber View to the sheet's Animated.View at :240, so a drag anywhere on the card dismisses. Keep the grabber's accessible Dismiss button exactly as it is (:260-266); it is the VoiceOver path and it is correctly labelled "Dismiss" rather than "Close" because sheets carry their own Close.

- src/components/ui/sheet.tsx:186-198 — add `.activeOffsetY(10)` to the pan so a small movement does not steal a tap, and compose it against any inner ScrollView with `simultaneousWithExternalGesture` / `blocksExternalGesture` so a drag inside a list still scrolls while a drag on the header dismisses. Read the traps skill's touch and gesture entries before wiring this; the sheet is inside a GestureHandlerRootView of its own (:294) because a Modal is hosted in its own native window outside the navigator's gesture root.

- Keep the down-only clamp at :188. Dragging up is a recorded decision (:184-186) and there is no second detent to drag to: the sheet's maxHeight is already `height - insets.top - Space.lg` and PlaceSheet's ScrollView already grows to it.

**Tests.** Device check, not a unit test: open the pin card, the place card and the venue stack; drag each by its title (dismisses), then drag inside the venue list (scrolls, does not dismiss). The venue list is the one that can only fail on a device, because it is a scroller inside a sheet inside a Modal. Extend src/components/ui/**tests**/sheet.test.ts to assert the detector wraps the card rather than the grabber, so a refactor cannot silently put it back.

**Risk.** Gesture composition inside a Modal-hosted GestureHandlerRootView is the exact shape of several traps entries, and getting `blocksExternalGesture` the wrong way round makes the venue list unscrollable, which is worse than today. This is why it is `later` and separate from the scroll work in ds-bottom-clip.

**After.** `ds-bottom-clip`

### `ds-chip-consolidation` — One chip component, three vocabularies retired

**Priority** later · **Effort** M · **Ships as** over the air

**Status: done (2026-09-01), with two properties put back.** A merge of three chips is not the intersection of them. The first pass carried across the testID and the 44pt hitSlop and silently dropped two things the filter sheet's private Chip had: the 1pt hairline border and the bold label on a selected chip. The border was not decoration. `ChipRail` paints an unselected chip `surfaceSunken`, which measures **1.12:1** against the sheet it sits in and **1.24:1** against the canvas, so without an edge an unticked chip is a word floating in the page with no pill around it. Both are back, on every chip in the app rather than only on the filter sheet's, which is the point of there being one component. `ChipRail`'s `label` prop also moved from the common half of the union onto the single-select half: the `multi` + `label` pairing had no caller anywhere in the app, and the branch that stripped the `radiogroup` role back off for it was exercised only by the test asserting the branch existed. The role is unconditional and true now, and the pairing is a compile error.

**Still owed:** the three screenshots this package names (42-business-where-empty, 14-pin-form, 05b-map-filters-on) have not been re-shot since the border and the weight came back.

There are three chip implementations on three different token vocabularies. ChipRow uses theme.tint / theme.backgroundElement, Spacing.two/three, `type="small"`, a vertical-only hitSlop and flexWrap. ChipRail uses theme.accent / theme.surfaceSunken, Space.md/sm, `type="footnote"`, PressableScale, a horizontal ScrollView and no hitSlop. And the map filter sheet — the one the filter screenshots actually show — defines a third private Chip on theme.accent / theme.surface. Today the aliases resolve to the same hex, so the divergence is invisible, which is exactly why it is dangerous: the day anyone gives tint and accent different values, half the chips in the app change and half do not.

<details><summary>Closes 1 audit findings</summary>

- Two chip components on two different token vocabularies, used side by side in the same flows

</details>

**Changes**

- src/components/form/chip-rail.tsx — add a `wrap` prop (flexWrap instead of the horizontal ScrollView) and a `multi` prop for toggle semantics. Carry ChipRow's 44pt guarantee across: ChipRail today has no hitSlop and a Space.sm vertical pad, so the merged component must adopt ChipRow's `hitSlop={{ top: 5, bottom: 5 }}` rather than inherit ChipRail's absence of one.

- Migrate the ChipRow call sites: src/app/business-signup.tsx:379 (city picker), src/app/drop-pin.tsx:94/:100/:106, src/app/rate-place.tsx:320, src/app/compose-request.tsx:203, src/app/edit-prompt.tsx:124, src/app/report.tsx:74.

- src/features/pins/map-filter-sheet.tsx:247 — migrate the private Chip, keeping its `testID` prop: a category chip's label leads with an emoji, so Maestro's full-string match cannot hit it and run 72 failed on exactly that.

- Delete src/components/form/chip-row.tsx last.

**Tests.** Re-shoot 42-business-where-empty.png (the city chips), 14-pin-form.png (the day chips) and 05b-map-filters-on.png (the filter chips) and confirm they are one family. Keep every existing Maestro assertion that taps a chip by testID working; those ids are the only handle on an emoji-led label.

**Risk.** The `testID` on the filter chips is load-bearing for the E2E suite and must survive the migration. Do NOT extend this into deleting theme.tint and theme.backgroundElement from the alias block at theme.ts:78-83: `backgroundElement` alone has more than forty readers across the app, including a `ThemedView type="backgroundElement"` used on twenty screens, so the chip work does not unblock that and pretending it does turns a medium package into an app-wide rewrite.

**After.** `ds-pin-form`

### `ds-gate-flat` — Stop drawing a bordered card inside a sheet at the moment we ask for an account

**Priority** later · **Effort** S · **Ships as** over the air

**Status: done (2026-09-01), after one missed call site.** The `flat` variant landed with the four call sites anybody had thought of, and left the fifth — and worst — on the card: `src/features/business/place-sheet.tsx`, the guest gate on a business marker. Its `<Sheet inline>` is one component up the file (`PlaceSheet` wraps `PlaceCard`), so it matched no pattern a reader or a regex would write, and it kept `compact`, which only ever selected between two GlassSurface styles. On every device without Liquid Glass, and every device with Reduce Transparency on, that GlassSurface painted `theme.surface` — the sheet's own colour — so the card was not a card, it was a ring of padding. Fixed, and the test that says "every gate that renders inside a Sheet asks for flat" now answers that universal by parsing every `.tsx` in `src/` with the TypeScript compiler and resolving a gate through the component that renders it, rather than naming three files and checking four of ten sites.

The resolution is **across files**, and it was not at first. The version that landed with the fix built both maps — what is rendered under a `<Sheet>`, and what renders what — inside the per-file loop, and only ever opened files that already contained `<SignUpGate`. So a gate in a component whose `<Sheet>` lives in a DIFFERENT file resolved to not-inside-a-sheet and passed while still carrying the card: the same false universal as the file-naming version, one indirection further out. Both maps are now accumulated over every `.tsx` in `src/` before the reachability walk runs once at the end. Component identity is the JSX tag name, so two same-named components in different files are treated as one — which can only push `insideSheet` toward true, the safe direction for a rule that says "ask for flat". No call site's answer changed when this was fixed, which is the point: the hole was in what the test could see, not in what the app does.

In screenshot 06 the sign-up gate is a bordered rounded card sitting inside the map's sheet, which is the card-in-card that DESIGN.md principle 4 explicitly bans. It is the more expensive instance of the pattern because it is the moment a browsing guest is asked for an account, and the container framing makes the ask read as a modal inside a modal. The sheet is already the elevated object; the card adds a second frame and buys nothing.

<details><summary>Closes 1 audit findings</summary>

- Elevation runs backwards: gate and notice cards are darker than the sheets they sit inside (the card-in-card half)

</details>

**Changes**

- src/components/ui/sign-up-gate.tsx:52 — add a `flat` variant that renders the headline, the subtitle and the two buttons straight onto the parent's ground with no GlassSurface and no border. Keep the analytics at :47-49 and :61/:74 unchanged; `where` is the only thing analytics sees and that must stay true.

- Use `flat` wherever the gate is already inside a sheet — the map's pin sheet is the one screenshot 06 shows. Leave the Travelers and Chat instances on the card, where they sit on a page rather than in a sheet.

- src/components/ui/glass-surface.tsx:53-59 — the non-glass fallback always paints `theme.surface` regardless of what it is placed on, so inside a sheet (also `theme.surface`, sheet.tsx:251) the fallback is invisible. Either take the ground as a prop or stop nesting GlassSurface inside Sheet. Do NOT add a `surfaceRaised` token on the premise that sheets are #20243D — they are #171A2E, and the house-rules notice in screenshot 19 is accentSoft #1D2742, which is LIGHTER than its ground, not darker. The palette is not running backwards.

- When you edit this file, remember the traps entry: any navigation from inside a Sheet must go through `leavingSheet(close)`, which is what the `onNavigate` prop at :41 exists for. The flat variant must keep it.

**Tests.** Re-shoot 06-guest-gate.png; acceptance is one frame on the screen instead of two. A jest render test in src/components/ui/**tests** asserting the flat variant renders no GlassSurface, so the card cannot creep back.

**Risk.** The gate is the app's only conversion step and its analytics carry the funnel; a refactor that drops a `capture` call silently blinds the one number the founder has. Assert both `gate_shown` and `gate_tapped` still fire in the flat variant.

### `ds-stack-header` — Give the pushed screens a real header title instead of a bare back button on its own row

**Priority** later · **Effort** M · **Ships as** over the air

**Status: PARTIALLY DONE (2026-09-01) — one route of seven.** `archived-chats` has its title ("Archived", `_layout.tsx:466`) and its in-body `<ThemedText type="title">` is gone. Six `headerTitle: ''` routes still carry the lone-back-button pattern, and the finding that says so is right about the count and wrong about two of them, so read the table before applying it. Line numbers are as of this note; the route NAME is the handle.

| Route (`_layout.tsx`)       | Header row today                                                     | What to do                                                                                        |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `first-messages` (:474)     | genuinely empty; the page draws `type="title">Waiting on you` (:41)  | `headerTitle: 'Waiting on you'`, and DELETE `first-messages.tsx:41`. Identical to archived-chats. |
| `place/[id]` (:412)         | genuinely empty; the page draws the business name (:524)             | the business name, set from the screen — see below. KEEP the in-page name.                        |
| `join-group/[token]` (:621) | genuinely empty; five branch headlines, no one title                 | `headerTitle: 'Group invite'`. Keep every branch headline.                                        |
| `i/[token]` (:629)          | the same screen, re-exported                                         | the same `'Group invite'`. These two must never drift.                                            |
| `profile-me` (:433)         | NOT empty — the screen sets its own title in all four branches       | leave the layout alone, or lift the two static ones. Not a lone back button.                      |
| `profile/[userId]` (:517)   | NOT empty — the screen sets `headerTitle: name` once the query lands | leave it. `''` is the pre-resolve placeholder and is correct.                                     |

Three notes that stop this being re-derived:

- **`place/[id]` sets its title from the screen, not from the layout**, for the reason `profile/[userId]` already gives at :185: the name only exists once the query resolves. Add `<Stack.Screen options={{ headerTitle: place.name }} />` inside the loaded branch. Keep the hero name in the body: it carries `<PlaceSeal />` and the category/hours meta line, so deleting it loses the verified check's anchor. Name in the header AND on the hero is what `profile/[userId]` already does, deliberately.
- **The traps entry applies to any title set from inside a screen.** `<Stack.Screen>` inside the component reaches the navigator through `setOptions` AFTER mount, so the row is empty for a frame on push. That is tolerable for a title and was NOT tolerable for `headerShown`, which is why `room/[id]`'s is set in the layout.
- **`profile-me` is not this package's problem** and the package already says so ("Do not chase profile-me (18)"): its four branches set 'Your profile' / 'Account' / 'Your profile' themselves. The only improvement available is moving the two static ones into the layout so the first frame is not blank; that is optional and is not what the finding describes.

**Correction (2026-09-01).** An earlier version of this note said nothing here was applied because `src/app/_layout.tsx` was held by another agent. That was false and this very package's status line contradicts it three paragraphs above: `_layout.tsx` is edited twice in this pass — `headerTitle: 'Archived'` at `:466`, and `<Stack.Screen name="muted-words">` registered at `:514`. One route of seven is done end to end (`archived-chats`: the layout title is set AND the duplicate `<ThemedText type="title">` is deleted from `archived-chats.tsx`). The other six are open, and what they need is in the table above: four of them (`first-messages`, `place/[id]`, `join-group/[token]`, `i/[token]`) need a change in the SCREEN as well as in the layout, and two (`profile-me`, `profile/[userId]`) need nothing at all.

The app has three unrelated header grammars, and the most common one spends a whole row on a lone circular back button and then stacks the screen's title underneath it. On 73-business-account and 24-group-message that is 105-110pt of header before the title, and in the chat the room's name and "1 person here" sit below the button rather than beside it, so a messaging screen opens with a quarter of it empty. The cause is not a missing component: src/app/\_layout.tsx sets `headerTitle: ''` on eight routes, so the native iOS 26 header renders a lone glass back button and each screen then draws its own title in the body.

<details><summary>Closes 1 audit findings</summary>

- Three different screen headers, and the most common one spends 150pt on a lone circular button

</details>

**Changes**

- src/app/\_layout.tsx — give each of the eight `headerShown: true, headerTitle: ''` routes a real title. Static strings where the screen has one (archived-chats at :271, profile-me at :245, add-people, add-to-group); a `headerTitle` render callback where it is dynamic and carries a subtitle (chat/[id] at :253, group/[id] at :303, place/[id] at :239, room/[id] at :245, profile/[userId] at :293). This is the correct mechanism rather than a bespoke components/ui/stack-header.tsx: the row already exists, it is just empty.

- Remove the now-duplicated in-body title from each of those screens: src/app/archived-chats.tsx:24, src/app/group/[id].tsx:355, src/app/add-to-group/[userId].tsx:57, src/app/add-people/[chatId].tsx:52 and the chat header block at src/app/chat/[id].tsx:190-210.

- Leave signup and business-signup on the chevron-plus-progress-bar header at src/features/signup/step-shell.tsx:85-100. That is the one deliberate exception and it is right: a progress bar is the title on those screens.

- Do not chase profile-me (18) on this: I measured it and the privacy card starts about 116pt down, i.e. roughly 57pt below the safe area — one button plus spacing, not the 150pt the finding claims. It needs title/inset alignment, not a header rebuild.

**Tests.** Re-shoot 18-profile-me.png, 24-group-message.png, 27b-group-add-and-leave.png and 73-business-account.png. Any Maestro step that taps or asserts one of those in-body titles has to move to the header title, and the traps skill's note applies: a Pressable with its own accessibilityLabel hides its text from Maestro, so assert the spoken label.

**Risk.** Native header titles pick their own colour from the navigation appearance rather than from the app's tokens, so this needs a picture on a dark ground before it is believed. `headerBackButtonDisplayMode: 'minimal'` is set globally at \_layout.tsx:213; giving a screen a title can change what the NEXT screen's back button says, so walk two levels deep on at least one stack.

**After.** `ds-type-scale`

## The Chat tab: inbox, segments, archive, badges

Twenty-seven findings collapse into fourteen packages, and the biggest single theme is not layout, it is honesty: seven separate agents found the same two strings. "Rooms near you" at chat.tsx:508 and "1 guest here now" at chat.tsx:515 assert live presence in the app whose second hard rule is that it never knows where anybody is, and the section is not even city-accurate — chat.tsx:761 feeds it `launchCities[0]`, the first row of a founder-managed table, so a traveler in Lisbon reads that a Bangkok hostel is near them. That is one afternoon's work and it should go first. The second theme is that the Chat tab was rebuilt into flush iMessage rows and three surfaces never got the memo: archived-chats.tsx still draws floating cards and answers a failed fetch with "Nothing archived.", the incoming-hello cards float outside the list's own geometry, and the Archive swipe action is painted in the danger red the app reserves for Unsend and Block for an action its own copy calls "still readable" twice. The third theme is data the row cannot see: my_chats returns no pin_id and no speaking, so a private crew, a pin plan anyone can walk into, and a publicly-readable hostel room are three different privacy models drawn identically, and the row cannot tell them apart even if it wanted to. That needs one migration that drops my_chats first and adds two columns. What the founder is really deciding here is two things. One: whether to reverse the recorded note at chat.tsx:336 and give rooms three glyphs instead of one house — the note's actual objection (people-icons on a business) is answered by using the storefront mark the app already has, but it is still a decision that was made on purpose. Two: whether a per-user muted-word list is worth a table, a screen and a settings row for a product with no users yet. Everything else is ordinary work.

### `chat-honest-city-and-counts` — Name the city the room list shows, and stop claiming presence

**Priority** now · **Effort** M · **Ships as** over the air

Seven agents found the same two strings. The heading at chat.tsx:508 says "Rooms near you" and every row under it says "1 guest here now" (chat.tsx:515), in the app whose loudest promise is that it never collects or displays where anybody is. It is also false in the ordinary sense: chat.tsx:761 feeds RoomDiscovery `launchCities[0]?.city_id`, the first row of a founder-managed table ordered by id, so a traveler in Bangkok reads that Lisbon hostels are nearby. member_count is chat membership, which runs on room_members.expires_at (departure plus days) and has nothing to do with where anybody is standing. On top of that, the groups empty card says "Join an open chat below" and RoomDiscovery returns null for a roomless city AND for a failed fetch, so the sentence points at nothing and a broken query looks like an empty city.

<details><summary>Closes 7 audit findings</summary>

- "Rooms near you" is not near you, and it says the one thing the app promises never to know

- "Rooms near you" lists whatever city is first in the launch list, not a city near anyone

- "1 guest here now" claims live presence in an app that promises never to know it

- "Rooms near you" and "1 guest here now" are presence language in an app that promises it never knows where you are

- "Rooms near you" and "1 guest here now" claim presence the app must never claim

- Chat says "1 guest here now" and "Rooms near you" - live-presence copy in the app that promises it never knows where you are

- The Groups empty state points at content directly below it that is not rendered

</details>

**Changes**

- src/features/pins/browsing-city.ts (new) — `useBrowsingCity()` returning `{ cityId, cityName }`. Reads useLaunchCities() and useMyTrips(); picks the launch city of the trip containing today, else the earliest upcoming trip whose city is a launch city, else launchCities[0]. Export the choice as a pure `pickBrowsingCity(launchCities, trips, today)` so it is unit-testable. The input is a date range the traveler typed, never device location. Cite src/app/business-signup.tsx:150 as precedent: 'Chosen, never assumed. This used to fall back to launchCities[0]'.

- src/app/(tabs)/chat.tsx:759-761 — replace `const cityId = launchCities[0]?.city_id ?? null` with `const { cityId, cityName } = useBrowsingCity()`; drop the now-unused useLaunchCities import.

- src/app/(tabs)/chat.tsx:500-524 — RoomDiscovery takes `cityName` and the rooms array as props instead of running its own query. Heading at :508 becomes `Rooms in {cityName}` (fall back to `Open rooms` when cityName is null). Row detail at :515 becomes `${countOf(room.member_count, 'traveler')} in this chat`. Add an isError branch rendering `<LoadError compact what="the open rooms" error={query.error} onRetry={query.refetch} />` BEFORE the `rooms.length === 0 → null` return at :502, so a failed fetch stops being pixel-identical to a roomless city.

- src/app/(tabs)/chat.tsx — lift `const roomsQuery = useCityRooms(cityId)` into ChatScreen (same query key, so no extra round trip) and pass `rooms` and `roomsQuery` down at the two render sites, :862 and :1109.

- src/app/(tabs)/chat.tsx:313-324 — the room preview's `${countOf(chat.member_count,'person','people')} here` becomes `... in this chat`, so the list has one vocabulary rather than 'here' meaning presence on one row and membership on another.

- src/app/(tabs)/chat.tsx:1079-1085 — the groups empty copy becomes conditional on rooms.length: with rooms, keep 'Join an open chat below, or start your own.'; with none, 'Start one and it shows up here for travelers in {cityName}.'

- src/app/(tabs)/chat.tsx:1086-1091 — add `<PrimaryButton label="Start a group" onPress={() => router.push('/new-group')} />` to the empty card for `tab === 'groups' && !isBusiness`. Screenshot 20 shows the plus in the header is easy to miss.

- src/app/room/[id].tsx:258, :262, :282 — the same sweep, so the list and the thread do not end up with two vocabularies: 'here · you run this chat' → 'in this chat · you run it'; `{countOf(member_count,'person','people')} here` → '... in this chat'; `${countOf(info.member_count,'guest')} here. ` → `${countOf(info.member_count,'traveler')} in this chat. `

- src/lib/plural.ts:1-6 — the helper's own doc example is literally '"1 guest here now", not "1 guests here now"'. Change it to '"1 traveler in this chat"' or the file teaches the phrasing back.

**Tests.** New jest src/features/pins/**tests**/browsing-city.test.ts for pickBrowsingCity: today inside a trip, today before the only trip, a trip in a non-launch city, no trips, an empty launch list. New cases in src/app/**tests**/chat-list.test.ts asserting the source of src/app/(tabs)/chat.tsx, src/app/room/[id].tsx and src/features/chat/ contains neither 'here now' nor 'near you' — two separate it() blocks so the failure names which one. Then re-shoot 21-chat-groups.png and 27a-chat-list-with-a-row.png from e2e/flows/signed-in-tour.yml:378-384 and read the heading in the picture, not in the diff.

**Risk.** The city must never come from a device-location read; deriving it from a trip a person typed is what keeps rule 2 intact, and anybody 'improving' this later will reach for expo-location. useMyTrips adds a query to the Chat tab, but it is already cached from the profile tab and disabled without a user id, so a guest still falls through to launchCities[0]. Deliberately NOT changed: travelers.tsx:73 takes the same fallback but sits inside GuestTravelers, and a guest has no trips, so the swap is a no-op; map-screen.web.tsx:19 is not the shipped surface; map-screen.tsx:688 already has real chosen-city state that should keep winning on the map. No test or E2E flow asserts either banned string today, so nothing goes red on the copy change alone.

### `chat-business-inbox-one-truth` — Stop the business inbox saying three contradictory things about an empty room

**Priority** now · **Effort** S · **Ships as** over the air

Screenshot 72-business-chat.png is the first screen a hostel owner sees, and it makes three statements that cannot all be true: a timestamp of 11:01 PM on the title line, "0 people here" under it, and a card below saying "No messages yet". The stamp comes from chat.tsx:302 falling back to created_at, so it is the moment the account was made presented as the time of the last message. And the one thing the owner can actually do about an empty room — put something up, which is what brightens their marker — lives on the My business tab and is not offered anywhere on the screen where they are standing when they notice.

<details><summary>Closes 3 audit findings</summary>

- The business inbox stamps a time on a room with nothing in it, so "0 people here" is dated 11:01 PM

- The business inbox states three contradictory things and offers the owner nothing to do

- The business's own room advertises "0 people here" with nothing the owner can do about it

</details>

**Changes**

- src/app/(tabs)/chat.tsx:302 — `const stamp = isRoom && chat.last_message_at == null ? '' : rowTimestamp(chat.last_message_at ?? chat.created_at)`. rowTrailing at :388-393 already guards with `stamp ? … : null`, so this is the whole change. The created_at fallback stays right for a direct chat, where created_at IS the time of the first message.

- src/app/(tabs)/chat.tsx:313-324 — when `isRoom && chat.member_count === 0`, fall through to null rather than emitting '0 people here'. The row then carries the name alone and the card below is the only statement of emptiness.

- src/app/(tabs)/chat.tsx:1075-1092 — split the isBusiness arm of the empty card. When the business's own room has no messages, the card reads 'Nobody has dropped in yet' / 'Put up what is on this week and travelers who find you on the map can join.' with `<PrimaryButton label="Post something" onPress={() => router.push('/business-post')} />`. 'Post something' is the title of the destination screen (src/app/business-post.tsx:262), so the control says exactly what happens. Add a business arm beside the existing `tab === 'individual' && !isBusiness` gate at :1089 rather than widening that condition. Keep the current card ('No messages yet' / 'Travelers who find you on the map can write to you here.') for a business whose room has posts but no traveler replies.

**Tests.** Extend src/app/**tests**/business-chat.test.ts with source assertions: the isBusiness empty card contains '/business-post', and the stamp expression is guarded on last_message_at. Then re-shoot 72-business-chat.png from e2e/flows/business-tour.yml:313 and check the row no longer carries a time over a zero, and that the button is on screen. The screenshot is the evidence; the exit code is not.

**Risk.** /business-post is declared inside Stack.Protected in src/app/\_layout.tsx as a modal, so a business account can reach it; a traveler cannot, which is why the button must live in the business arm and not in a widened condition. The empty-card block is also edited by chat-honest-city-and-counts, so land that first or the two conflict in the same JSX.

**After.** `chat-honest-city-and-counts`

### `chat-invite-code-everywhere` — Give the invite code a real field on every platform, and move the row

**Priority** now · **Effort** M · **Ships as** over the air

The card at chat.tsx:1099-1100 says 'Paste the code somebody sent you.' and the alert it opens says 'Open the invite link you were sent.' — an instruction to leave the app, printed above a field waiting for a code. On Android and web it is worse: chat.tsx:730 is a plain Alert with no input at all, so somebody holding a six-character code has no route into the group whatsoever. This is the only Platform.OS === 'ios' branch in the app whose non-iOS arm removes a capability instead of substituting one, which is exactly what AGENTS.md's cross-platform-clean rule is about, and it contradicts the comment directly above it at :714-716, which says the code exists precisely because a samewhere:// link is not tappable in every messaging app.

<details><summary>Closes 3 audit findings</summary>

- "Have an invite? Paste the code somebody sent you" opens an alert that tells you to open a link instead

- There is no way to enter an invite code on Android or web: the fallback is an alert that asks for nothing

- "Have an invite?" is dressed as a conversation and sits in the middle of the list

</details>

**Changes**

- src/features/chat/invite-code-sheet.tsx (new) — a `<Sheet avoidKeyboard>` holding one FormTextField labelled 'Invite code', a Join PrimaryButton and Cancel. Pushes `/join-group/${encodeURIComponent(token)}`; that route exists at src/app/join-group/[token].tsx and is reachable signed out. Wrap the push in `leavingSheet(close)` from components/ui/sheet — navigating out from under a presented sheet leaves its full-screen scrim behind and kills touch on the screen you return to.

- src/app/(tabs)/chat.tsx:717-732 — delete promptForInvite and the whole `Platform.OS === 'ios' && Alert.prompt` branch. Open the sheet from a useState boolean instead. Drop the `Platform` import at :7 if nothing else in the file uses it.

- src/app/(tabs)/chat.tsx:1095-1111 — move the 'Have an invite?' PlainRow BELOW `<RoomDiscovery />` so it stops sliding down the list as groups accumulate. Leave the row itself alone: 27a-chat-list-with-a-row.png shows it already has the link glyph, tint="quiet", a chevron none of the conversation rows have, and a visible section gap, so three of the four differentiators the audit asked for are already shipped.

**Tests.** Extend src/app/**tests**/invite-exits.test.ts with source assertions that chat.tsx no longer contains Alert.prompt and no longer branches the invite path on Platform.OS. Add an E2E segment to e2e/flows/signed-in-tour.yml after the Groups screenshot: tapOn 'Join a group with an invite code', waitForAnimationToEnd, takeScreenshot 27e-invite-sheet, assertVisible the exact label 'Invite code', tapOn 'Cancel'. Never loosen that assertion to a wildcard.

**Risk.** iOS silently drops a modal presentation that starts while another is dismissing, and on Fabric that kills touch for the whole app until relaunch. This sheet opens on a tap rather than a data event, and nothing else on the Chat tab presents a modal, so no SHEET_SETTLE_MS guard is needed — but do not add a second presenter to this screen without registering it with useRegisterNativeModal. A TextInput inside a UIVisualEffectView never receives the tap that would focus it; FormTextField is opaque, so keep it out of any glass primitive.

### `chat-preview-survives-dynamic-type` — Scale the fixed preview height with the text size

**Priority** now · **Effort** S · **Ships as** over the air

chat.tsx:1298 pins the preview block to `height: 40`. The role applied to it is `callout`, which is 15/20 in src/constants/theme.ts:150, so two lines are exactly 40 points and there is zero slack at the DEFAULT text size. Any Dynamic Type step clips the second line, and on the Chats list that second line is the message itself, so a low-vision user gets names and timestamps and no content. The reasoning in the comment is right and must survive: a list whose rows change height as messages arrive cannot be scanned by position, and the ragged timestamp column is what people complain about without being able to name it. The constant should scale, not go away.

<details><summary>Closes 1 audit findings</summary>

- Chat list previews are locked to 40pt, so the second line disappears at large Dynamic Type

</details>

**Changes**

- src/app/(tabs)/chat.tsx — add `const { fontScale } = useWindowDimensions()` to ChatRow (:292), SentHelloRow (:230) and PlainRow (:430), and apply `[styles.rowPreview, { height: 40 * fontScale }]` at the three preview Texts, :259, :382 and :480. useWindowDimensions rather than PixelRatio.getFontScale() because it re-renders when the setting changes.

- src/app/(tabs)/chat.tsx:1294-1300 — keep the comment, and extend it to say the base is 2 × Type.callout.lineHeight with no slack, so the next person does not shave it.

- src/app/**tests**/chat-list.test.ts:43-46 — the existing case asserts /rowPreview: \{\s\*height: 40,/ and will go red on this change. Rewrite it to assert both halves: the base is two callout line-heights, and the height applied to the element is multiplied by fontScale.

**Tests.** The rewritten jest case above. Then the only thing that actually answers the question: run the simulator suite with the device text size at AX3 and look at 20-chat-individual.png and 27a-chat-list-with-a-row.png. If the second line still clips, the multiplier is not the whole fix and the rows need minHeight instead.

**Risk.** The audit's follow-on list is wrong and would waste a day: profile-me.tsx:456/460/468 and compose-request.tsx:298/321 are 96/82/72/40pt icon and image containers, not text. The fixed heights worth auditing are the ones in this same StyleSheet and in src/features/chat/message-thread.tsx. roomBadge must stay square at AVATAR, because scaling the avatar well would break the x=80 text column the whole list geometry is built on.

### `chat-archived-is-a-conversation-list` — Rebuild Archived on the shared chat row, with loading and error states

**Priority** now · **Effort** M · **Ships as** over the air

Archived is the one conversation list that never got the redesign. archived-chats.tsx:29 draws each row as a filled ThemedView with padding and Radius.lg, which the ChatRow comment at chat.tsx:274-289 explicitly says was abandoned as 'a layout for a feed of unrelated things'. It also loses everything the row was rebuilt to carry: no avatar, no timestamp, no unread dot, no room or business distinction, no swipe. Worse, line 17 discards the query object entirely, so a person with six archived conversations who opens the screen offline is told 'Nothing archived.' — for a chat archive that is the most alarming possible wrong answer, and it is exactly the failure load-error.tsx was written to end. It also flashes on every cold open, since nothing gates the sentence on isSuccess.

<details><summary>Closes 2 audit findings</summary>

- The Archived screen still uses the floating-card layout the inbox was deliberately rebuilt away from

- Archived chats tells a user with a full archive that they have nothing archived whenever the fetch fails

</details>

**Changes**

- src/features/chat/chat-row.tsx (new) — lift ChatRow, the AVATAR constant, Avatar, PlaceAvatar and the row/rowBody/rowTitle/rowName\*/rowPreview/rowTrailing/separator/unreadGutter/unreadDot/unreadPill styles out of src/app/(tabs)/chat.tsx:61-123, 274-416 and 1272-1318 into one module. Export ChatRow and the `list` wrapper style. Nothing about the geometry changes; this is a move so two screens can stop diverging.

- src/app/(tabs)/chat.tsx — import from the new module; delete the moved code.

- src/app/archived-chats.tsx:17 — `const query = useMyChats(true); const chats = query.data ?? []` instead of destructuring the data away.

- src/app/archived-chats.tsx:28-67 — delete the bespoke row and its `row`/`rowText` styles; render `chats.map((chat, i) => <ChatRow chat={chat} last={i === chats.length - 1} />)` inside the negative-margin list wrapper. Keep 'Put back' but move it to a right-swipe action on a ReanimatedSwipeable mirroring chat.tsx:621-651, plus the same long-press Alert item, so un-archiving uses the inbox's own affordance vocabulary.

- src/app/archived-chats.tsx:68-70 — gate 'Nothing archived.' on `query.isSuccess`; render three `<ChatRowSkeleton />` while isPending; render `<LoadError compact what="your archived chats" error={query.error} onRetry={query.refetch} />` on isError. Copy the pattern and the reason from chat.tsx:1042-1046 and :984-990.

**Tests.** New jest render test src/app/**tests**/archived-chats.test.tsx with useMyChats mocked into each of the three states, asserting 'Nothing archived.' renders ONLY on success-with-zero rows, that the pending state shows skeletons and not that sentence, and that the error state offers 'Try again'. Assert the exact strings. Add an E2E segment to e2e/flows/signed-in-tour.yml: long-press the Maestro crew row, tap Archive, tap the Archived row, takeScreenshot 27d-archived.

**Risk.** The move is where regressions hide. `list`'s marginHorizontal is -Spacing.four and cancels the scroller's own gutter; archived-chats.tsx pads its content with Space.lg, so the negative margin has to match its own container or the separators will not run edge to edge. src/app/**tests**/chat-list.test.ts reads '(tabs)/chat.tsx' and asserts on 'left: Space.lg + 10 + Space.md', 'marginHorizontal: -Spacing.four' and the row style block — update its source() path for the moved constants in the same commit or a pure move turns the suite red.

### `chat-archiving-does-not-read-as-deleting` — Un-red the Archive swipe, keep the Archived door visible, announce auto-archives

**Priority** next · **Effort** M · **Ships as** over the air

Archiving is non-destructive and the app says so twice: chat.tsx:1117 renders 'still readable' and archived-chats.tsx:25-26 promises a new message brings one back. Yet chat.tsx:647 paints Archive in theme.danger, the same red as Unsend and Block, in the rightmost slot where iOS has trained thumbs that the far action deletes. message-thread.tsx:610-614 already states the principle for the message menu: red means this takes something away, and if it means everything it means nothing. Separately, archive_idle_chats runs at 03:30 daily and archives any chat with no message for 14 days, silently, and the only route to /archived-chats is a row that itself only appears once something has been archived, so the first time a traveler notices is when they go looking for a name they remember and cannot find it.

<details><summary>Closes 2 audit findings</summary>

- The Archive swipe action is painted in danger red for an action the app describes as "still readable"

- Chats auto-archive after 14 days with no notice, and the door to them only appears once you are already behind it

</details>

**Changes**

- src/app/(tabs)/chat.tsx:528-556 — SwipeAction hardcodes theme.onAccent for both the icon and the label; add colour props so a fill other than accent can carry legible content.

- src/app/(tabs)/chat.tsx:644-649 — Archive's `tint={theme.danger}` becomes theme.accentDeep with theme.onAccentDeep (white on accentDeep is 8.2:1, src/constants/theme.ts:54-56). Keep danger for Unsend, Block, Leave chat and Remove.

- src/app/(tabs)/chat.tsx:634-643 — Mute's `tint={theme.textSecondary}` is a grey-lavender fill that reads as a disabled control rather than a button; change it to theme.surfaceSunken with theme.text.

- src/app/(tabs)/chat.tsx:1113-1125 — stop gating the Archived PlainRow on `archived.length > 0`. Render it once the archived query has succeeded, with a zero count if that is the truth, so the door is not hidden behind itself.

- src/features/chat/archive-notice.ts (new) — no migration needed: chat_prefs is readable by its owner under chat_prefs_rw_own (supabase/migrations/20260817200000_establishment_rooms.sql:112-118). Select the user's chat_prefs rows with a non-null archived_at, compare against a stamp held in AsyncStorage (same pattern as src/features/pins/heat-legend.ts), return how many are newer.

- src/app/(tabs)/chat.tsx — render a one-line dismissible notice above the list, `${countOf(n,'quiet chat')} moved to Archived`, tapping through to /archived-chats and writing the stamp on read.

- src/features/rooms/hooks.ts:131-146 — useChatPref's onSuccess writes the archive stamp immediately whenever the patch carried `archived: true`, so a chat the person archived by hand never shows up in the notice.

**Tests.** Jest for the archive-notice comparison: nothing archived, archived before the stamp, archived after it, AsyncStorage empty on first run, and a hand-archived chat that must not count. Then a screenshot of a swiped row in 27a to confirm Archive is no longer red, and one of the notice.

**Risk.** archive_idle_chats and a hand archive both write chat_prefs.archived_at, so without the stamp write in useChatPref the notice fires at the person for something they just did themselves. Deliberately out of scope: the 24-hour 'still waiting' push. It needs a per-chat scheduled job the product does not have, and its privacy carve-out (never push for a chat where YOU wrote last, because that tells the sender their message went unanswered, which is a decline in everything but name) belongs with the first scheduled push and its quiet-hours work.

**Waits on.** Is 14 days of silence still the right auto-archive window, or should chats stop moving on their own? FOR keeping it: an inbox that never prunes itself becomes a wall of dead conversations, and archiving is genuinely reversible. AGAINST: for a product whose whole value is a conversation that turns into a meet-up, silently relocating one is expensive, and the notice this package adds is a mitigation rather than a fix.

**After.** `chat-archived-is-a-conversation-list`

### `chat-hellos-do-not-flood-the-inbox` — Timestamp the incoming hellos, cap them at two, and put them in the list

**Priority** next · **Effort** M · **Ships as** over the air

Each waiting hello is a filled card about a fifth of a screen tall — avatar row, the whole first message, the report link, Decline and Accept — and chat.tsx:974-976 maps them with no cap and no collapse. Eight waiting hellos is 1600pt of judgement calls between a returning user and the conversation they opened the app for. They are also rendered OUTSIDE the styles.list wrapper every other section uses, so they float as slabs in the scroller's gutter above the flush rows the inbox was deliberately rebuilt into. And none of them says when it arrived, even though IncomingRequestRow carries created_at (src/lib/database.types.ts:444), so a hello from an hour ago and one from three weeks ago look equally urgent, which is precisely the pressure a platonic app should not apply.

<details><summary>Closes 1 audit findings</summary>

- Incoming hellos render as unbounded full-size accept cards at the top of the inbox, with no timestamp

</details>

**Changes**

- src/app/(tabs)/chat.tsx:153-167 — add the arrival time to RequestCard's header row, right-aligned on the name's line, using `rowTimestamp(request.created_at)` from features/chat/separators so the vocabulary matches the conversation rows exactly.

- src/app/(tabs)/chat.tsx:969-978 — wrap the whole 'Waiting on you' block in `<View style={styles.list}>` so it shares the list's geometry instead of floating in the gutter. The cards keep their backgroundElement fill, so give them back their own horizontal padding or they will bleed past the screen edge inside the negative-margin wrapper.

- src/app/(tabs)/chat.tsx:974-976 — render the first two cards inline and collapse the rest behind one flush PlainRow: title `${countOf(requests.length - 2, 'more hello')}`, detail 'Tap to read them', tint="quiet", chevron. Expand in place on tap with a useState boolean rather than pushing a new route; the list is at most a handful of cards and the decision belongs on the screen the person is already on. No badge count beyond the number already in the sentence.

**Tests.** Jest render test asserting that three incoming requests produce two cards plus a row reading exactly '1 more hello', and that tapping it reveals the third. Assert the exact sentence, not a wildcard. For the picture: the E2E fixture seeds no incoming hellos, so either seed three on the signed-in account in e2e/flows/signed-in-tour.yml before the 20-chat-individual screenshot, or take the screenshot by hand and attach it — the layout claim is the whole finding and only a picture answers it.

**Risk.** styles.list applies marginHorizontal: -Spacing.four, and RequestCard is a padded card rather than a flush row, so it needs its gutter restored inside the wrapper. Do not move the report link ('Does this feel off? Tell us.') behind the collapse: the receiver's half of moderation must stay reachable on every hello that is on screen.

### `chat-row-knows-a-plan-from-a-crew` — Give my_chats the plan date and the room's readability, and say both on the row

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

In screenshot 27a, 'Maestro crew' (a private group), 'Rooftop hello from Maestro' (a plan attached to a pin, which post_joinable_pin creates with speaking='everyone' so anyone who can see that pin walks in) and 'Once Again Hostel' (a business room readable by signed-out visitors) are three rows with three different privacy models and nothing on the screen distinguishes them. Somebody writing 'I am at the hostel on Rua X until Tuesday, come find me' into what they believe is a four-person crew has no signal that a stranger can open it. The room screen knows and says 'anyone can read' once you are inside (src/app/room/[id].tsx:265); the list, which is where you decide what to type, does not. Separately, a pin plan's date vanishes the moment anyone writes: chat.tsx:313-324 falls through to last_message, so 'Rooftop hello from Maestro' could be tonight at seven or a thing that happened in March. The row cannot fix either of these today, because my_chats returns neither pin_id nor speaking, so my_role separates a business room from a traveler room but cannot tell a plan from a crew — post_joinable_pin makes the creator 'admin' either way.

<details><summary>Closes 2 audit findings</summary>

- A pin plan's date is invisible on its row the moment anybody writes in it

- A private crew, a pin plan open to strangers and a public hostel room draw the same house icon and never say who can read them

</details>

**Changes**

- supabase/migrations/20260901120000_a_chat_row_says_what_kind_it_is.sql (new) — my_chats(boolean) gains two OUT columns, so `drop function if exists public.my_chats(boolean);` FIRST, then re-create from the body at supabase/migrations/20260830000000_a_business_is_served_no_travelers.sql:439-593, then re-state the pair from 20260827100000_business_accounts.sql:657-658: `revoke execute on function public.my_chats(boolean) from public, anon;` and `grant execute on function public.my_chats(boolean) to authenticated;`. Add `plan_date date` as `(select p.intent_date from public.pins p where p.id = g.pin_id)` and `public_preview boolean` as `b.public_preview`, both off joins already in the query. End with `notify pgrst, 'reload schema';`.

- src/lib/database.types.ts:463-497 — add plan_date and public_preview to ChatListRow, with the note that plan_date goes null the moment the pin expires.

- src/features/chat/chat-row.tsx — append a privacy tail to the preview line in the room screen's own words: plan_date non-null → ' · anyone with the pin can join' (which is exactly what join_pin_chat enforces: pin visibility, no token); my_role null and public_preview true → ' · anyone can read'; my_role null and public_preview false → ' · a business runs this chat'; a private crew gets nothing.

- src/features/chat/chat-row.tsx — render plan_date as a quiet trailing chip on the rowTitle line, formatted {weekday:'short', day:'numeric', month:'short'} (pins.intent_date is a date, not a timestamp, so there is no time to show), and nothing once the date has passed.

- src/app/room/[id].tsx:253-266 — the same chip under the room title, where the subtitle only counts people today.

**Database.** Adds plan_date and public_preview to my_chats(boolean). Changes the OUT column list, so the migration MUST drop function public.my_chats(boolean) first and then re-state `revoke execute … from public, anon` and `grant execute … to authenticated`.

**Tests.** New pgTAP supabase/tests/database/30_a_chat_row_says_what_kind.test.sql: a group created by post_joinable_pin returns plan_date equal to the pin's intent_date; DELETING the pin (which is what expire_pins does, 20260816210000_map_pins.sql:271) makes plan_date null while the group survives — write that one as the attack, because it is the rule-3 assertion that nothing about an expired pin remains readable through this row; a group made by create_group has a null plan_date; a business room returns its public_preview and a traveler group returns null. Jest for the chip formatter. Screenshot 27a to see 'Rooftop hello from Maestro' carry a date and 'Once Again Hostel' carry the tail.

**Risk.** The trap this repo has already paid for: create or replace cannot add an OUT column to a RETURNS TABLE signature, and the deploy dies AFTER the migration's earlier statements have applied. Drop first, re-state both grants. my_chats is called by name over the wire from shipped binaries that cannot be updated over the air — adding columns is safe (PostgREST returns extra keys an old client ignores), removing or reordering is not. Note that groups.pin_id is `on delete set null`, so an expired plan becomes an ordinary group with no date, which is the founder's recorded intent that the conversation is not on the pin's timer.

**After.** `chat-archived-is-a-conversation-list`

### `chat-glyphs-say-what-a-row-is` — Replace the one house glyph with a pin, a storefront and a group mark

**Priority** next · **Effort** S · **Ships as** over the air

27a draws the same accent-tinted house on a private crew, a pin plan and a hostel room. Three objects with three lifespans and three privacy models, and the reader's only way to tell them apart is by reading the titles. The plan row, the one about to become residue, looks exactly as permanent as the hostel. This is a recorded decision, not an oversight — chat.tsx:336-339 argues that kind === 'room' covers both a hostel's guest room and a travelers' group, and that a business room under three little people would be wrong about what it is. That objection is correct and this proposal does not reopen it: nobody is putting people-icons on a business. What the note defends is one glyph for two KINDS; what the screenshot shows is one glyph for three privacy models.

<details><summary>Closes 2 audit findings</summary>

- Every group and room row draws the same house glyph, so the list has no shape

- A private crew, a pin plan open to strangers and a public hostel room draw the same house icon and never say who can read them

</details>

**Changes**

- src/features/chat/chat-row.tsx — branch the badge at what is now chat.tsx:334-345. plan_date non-null → mappin.and.ellipse, the marker the person tapped to get in. public_preview non-null (a business room, from either side) → storefront.fill, which PlaceAvatar at chat.tsx:116 and the map already use for a business, so this also removes a cross-screen inconsistency. Everything else, meaning a traveler group or an expired plan → person.3.fill. The house stops being drawn.

- src/features/chat/chat-row.tsx — when chat.photo_path is set, render the photo instead of the glyph. my_chats already returns g.photo_path for traveler groups (supabase/migrations/20260821010000_traveler_groups.sql:563), so a group that has a picture is free today.

- src/app/(tabs)/chat.tsx:512-519 — RoomDiscovery lists businesses only, so its rows take storefront.fill too rather than the house.

- src/app/(tabs)/chat.tsx:336-339 — replace the comment with the new reasoning, so the next reader inherits the decision rather than re-deriving it.

**Tests.** A jest source assertion that the room badge branches on plan_date and public_preview and that 'house.fill' no longer appears in chat-row.tsx or in RoomDiscovery. Then the only real test: re-shoot 21-chat-groups.png and 27a-chat-list-with-a-row.png and put them side by side with the current pair. If three marks read as noisier rather than clearer, the founder answer was no.

**Risk.** A row is scanned, not read, and three marks in a column of five rows can read as clutter where one reads as calm. The privacy tail from chat-row-knows-a-plan-from-a-crew already says the thing that matters in words, so this is genuinely optional. Do NOT extend it to putting a business's cover photo on a room row: my_chats returns g.photo_path for every room, so a business room's is null, and adding it means a third column plus a bucket branch — a business photo signed through usePhotoUrl comes back a 404 wearing a valid URL, which is the exact bug recorded at chat.tsx:295-299.

**Waits on.** Reverse the note at chat.tsx:336 and give room rows three marks instead of one house. FOR: three objects with three privacy models and three lifespans currently look identical, the storefront is already the app's business mark so the note's actual objection is answered rather than ignored, and the plan glyph is the same marker the person tapped to get in. AGAINST: the single house is a decision the founder already made on purpose, one mark is calmer in a list that is scanned rather than read, and the privacy tail already shipped in the previous package says the important half in words.

**After.** `chat-row-knows-a-plan-from-a-crew`

### `chat-guest-tab-has-something-on-it` — Give the signed-out Chats segment a real empty state

**Priority** next · **Effort** S · **Ships as** over the air

04-chat-guest.png shows roughly 600pt of nothing, then a left-aligned grey footnote with no heading and no glyph, then the join card, then 450pt more. One of three tabs reads as a screen that failed to load rather than a screen with nothing yet, and it is the tab a curious visitor taps third, right before deciding whether the app has anybody in it. The audit's headline claim is half wrong and worth correcting in the plan: the Groups segment is NOT empty. The same isGuest branch renders a footnote and `<RoomDiscovery cityId={cityId} />` at chat.tsx:859-862, city_rooms is granted to anon, and 21-chat-groups.png shows that query returning 'Once Again Hostel'. So the segmented control stays; hiding it would remove the only signed-out route into the open rooms.

<details><summary>Closes 1 audit findings</summary>

- The guest Chat tab is one grey sentence floating in a void, under a Groups toggle that shows nothing

</details>

**Changes**

- src/app/(tabs)/chat.tsx:873-880 — replace the bare footnote with a real empty state: the tour's chat glyph (bubble.left.and.bubble.right.fill, src/features/intro/intro-tour.tsx:88) at 56pt in theme.textSecondary, a headline, the existing sentence beneath it, alignItems 'center' and textAlign 'center' so the block is centred rather than left-aligned inside a centred flex, then the SignUpGate unchanged.

- src/app/(tabs)/chat.tsx:873-880 — add one line pointing across: 'Open chats at hostels and bars are under Groups', so the other segment stops looking inert.

- src/app/(tabs)/chat.tsx:1135-1139 — guestCentre keeps flex: 1 and justifyContent: 'center'. The void in the screenshot is what centring a two-element column in a full-screen scroller looks like; the glyph and the headline are what fill it, not a layout change.

**Tests.** Re-shoot 04-chat-guest.png from e2e/flows/guest-tour.yml:54-55 and look at it. Add an assertVisible for the exact new sentence before the screenshot. Do not duplicate RoomDiscovery onto the Chats segment.

**Risk.** A Pressable with its own accessibilityLabel hides the text inside it from Maestro, so if the pointer line becomes a tappable shortcut to Groups, assert the spoken label rather than the words on screen.

### `chat-block-says-it-landed` — Acknowledge a block, and give it a permanent home

**Priority** next · **Effort** M · **Ships as** over the air

A woman blocks a man from inside a thread. src/app/chat/[id].tsx:70-92 fires block.mutate from the Alert's destructive button and does nothing else: no navigation, no haptic, no follow-up. useBlockUser (src/features/chat/hooks.ts:225-236) only captures analytics and invalidates. After a refetch a grey line appears reading 'This chat is closed.' — the same sentence she would see if he had left, deliberately, because chat_status is 'closed' either way (sever_on_block, supabase/migrations/20260816200000_trips_matching.sql:115-123). So at the one moment she most needs certainty, the app is ambiguous by design, with no confirmation, no way to check later, and no blocked list anywhere in the product.

<details><summary>Closes 1 audit findings</summary>

- Blocking someone gives no confirmation; the thread just says "This chat is closed."

</details>

**Changes**

- src/features/chat/hooks.ts:225-236 — useBlockUser's onSuccess calls haptics.success() before the invalidate.

- src/features/chat/api.ts — new fetchMyBlocks(): `select blocked_id from blocks`. No migration: blocks_select_own (20260816200000_trips_matching.sql:83-85) already lets the blocker read their own rows and is caller-scoped, so it cannot enumerate anyone else's.

- src/features/chat/hooks.ts — new useMyBlocks() over that fetch.

- src/app/chat/[id].tsx:429-433 — branch on the block rather than on `closed` alone: when useMyBlocks() contains chat.other_user_id, replace the composer with a persistent 'You blocked {name}. They cannot write to you.' Keep 'This chat is closed.' for every other closure. That is WhatsApp's grammar and it survives a remount, which a local flag would not.

- src/app/blocked.tsx (new) — the list, with an Unblock action (blocks_delete_own already permits it).

- src/app/profile-me.tsx:346-350 — a ghost PrimaryButton 'Blocked people' beside 'House rules and help', so recovery has a permanent home and no undo toast is needed.

- src/app/\_layout.tsx — register the new route inside the same guard that holds /visibility.

**Tests.** pgTAP added to supabase/tests/database/08_trust_safety.test.sql, written as the attack: a third party selecting from blocks returns nothing, and the blocked user cannot see the row naming them. Jest render test for the two composer branches, asserting the exact sentences. E2E is the wrong tool here: blocking a seeded account is destructive to the fixture and would poison every later flow.

**Risk.** useBlockUser calls queryClient.invalidateQueries() with no key, so everything in the app refetches at once and useMyBlocks joins that storm. The composer must not wait on it: render 'This chat is closed.' until the blocks query has an answer, never the reverse, or a moment of loading state will tell somebody they have not blocked a person they just blocked. Deliberately not done: popping back to the list with a blocked marker on the row. my_chats gives a blocked chat and an abandoned one the same chat_status, so the marker needs the same lookup and says less, and popping the person out of the thread takes away the messages they may need to screenshot for a report.

### `chat-list-stops-mounting-every-row` — Virtualize the chat list

**Priority** next · **Effort** M · **Ships as** over the air

chat.tsx:888 is a plain ScrollView and the body maps eagerly over four arrays: requests (:974), waitingOnThem (:1000), pinned (:1017) and rest (:1035). Each ChatRowLink mounts an Image and its own signed-URL query (usePhotoUrl at :72, useBusinessPhotoUrl at :100). A traveler three months into a trip with sixty conversations mounts sixty rows, sixty avatars and sixty signed-URL requests every time they open the tab, and it is one of three tabs. This is the only unbounded list in the app that is not virtualized — message-thread.tsx:894 is a proper inverted FlatList, so the code knows the difference — and the symptom is a Chat tab that gets slower the more the app is used, which is the worst possible direction for a retention surface.

<details><summary>Closes 1 audit findings</summary>

- The chat list renders every conversation eagerly inside a ScrollView

</details>

**Changes**

- src/app/(tabs)/chat.tsx:886-1126 — convert the signed-in branch to a SectionList: sections for the incoming hellos, 'You said hi', Pinned, and the rest; the header row and the segmented control as ListHeaderComponent; the invite row, RoomDiscovery and the Archived row as ListFooterComponent; carry the existing RefreshControl at :892-898 across unchanged. ChatRowLink, ChatRow and the section headings are unchanged.

- src/app/(tabs)/chat.tsx:558-655 — key the ReanimatedSwipeable ref per chat id and close it on onViewableItemsChanged, so a recycled cell cannot come back with another conversation's row already swiped open.

- src/app/(tabs)/chat.tsx:806-884 — the guest branch stays a ScrollView. guestFill and guestCentre depend on flexGrow, which a SectionList's contentContainerStyle handles differently; converting both in one change is how this goes wrong.

**Tests.** There is no new logic to unit-test, so the evidence is pictures: 20-chat-individual.png, 21-chat-groups.png and 27a-chat-list-with-a-row.png must be visually identical to the current ones, plus a scroll to the bottom in the E2E flow to prove the footer sections survived. Add a jest source assertion that the signed-in branch no longer opens with <ScrollView.

**Risk.** Row recycling and an open swipeable is the classic pairing bug and it is worse here than usual, because the action behind the swipe archives a conversation. Do not add keyboardShouldPersistTaps to this list: there is no text field on the screen, and the responder-capture trap only bites a scroller with a focused field under it. Travelers and the profile pages can stay ScrollViews; they render one item.

**After.** `chat-hellos-do-not-flood-the-inbox`, `chat-invite-code-everywhere`

### `chat-thread-reaches-older-messages` — Let a thread load earlier messages past the first hundred

**Priority** next · **Effort** M · **Ships as** over the air

src/features/chat/api.ts:7 sets MESSAGE_PAGE to 100 and :16 applies it with no range or cursor, and the inverted FlatList at message-thread.tsx:894-899 sets no onEndReached. A hostel room crosses a hundred messages over a long weekend; after that the oldest are unreachable and nothing on screen says so — you scroll up, the list ends, and the conversation appears to have begun there.

<details><summary>Closes 1 audit findings</summary>

- A thread stops at 100 messages with no way to load older ones

</details>

**Changes**

- src/features/chat/api.ts:10-22 — fetchMessages(chatId, olderThan?: string) adds `.lt('created_at', olderThan)` when a cursor is passed. MESSAGE_PAGE stays 100.

- src/features/chat/hooks.ts:31-69 — keep useQuery and the flat ['messages', chatId] key. Do NOT move to useInfiniteQuery: that key is written as a flat MessageRow[] by the realtime handler at :52-62 and by the optimistic send, fail and discard paths in src/features/chat/outgoing.ts, and changing its shape changes the contract under all of them in one commit. Add useLoadOlderMessages(chatId) instead: fetch a page older than the current oldest created_at and append it (the array is newest-first) with queryClient.setQueryData, deduping by id.

- src/features/chat/message-thread.tsx:894-899 — the list is inverted, so the top of the thread is the END. Add a ListFooterComponent rendering an 'Earlier messages' button when the last page came back full, and a spinner while it loads. An explicit button rather than onEndReached, because the failure mode of a silent fetch on an inverted list is a jump.

- src/features/chat/hooks.ts:44-45 — leave staleTime 0 and refetchOnMount 'always' exactly as they are. The comment at :42-44 gives the reason and it is right; the refetch replaces the first page only.

**Tests.** Jest for the cursor and the merge: a full page arms the button, a short page hides it, the append dedupes by id, and a realtime insert arriving mid-load still lands at the front. Then confirm by hand that opening a chat after loading two pages does not throw the older page away — that is the interaction between refetchOnMount and the prepend and it is the thing most likely to be wrong. E2E cannot reach 100 messages without seeding, so a manual screenshot of the button is the evidence.

**Risk.** The older page and the realtime handler write the same array. The handler at :58-61 replaces a known id and prepends otherwise; an older page must be APPENDED and deduped or a message shows twice. Synthetic rows must stay out of it: the first-message preview at src/app/chat/[id].tsx:334-344 has a `first:` id that is not a real row and must never be used as a cursor.

### `chat-words-i-would-rather-not-see` — A per-user muted-word list that collapses a hello rather than deleting it

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

The moderation classifier is tuned by the platform for everyone, and it will be tuned conservatively because a false positive silences a legitimate hello. That leaves each traveler with no way to set their own line, and per the brief's own research the people whose departure collapses this marketplace are exactly the ones with the most specific lines. The recipient's only control today is after the fact: the 'Does this feel off? Tell us.' link at chat.tsx:180-192, which arrives once the message has already been read.

<details><summary>Closes 1 audit findings</summary>

- A recipient has no way to say in advance what they do not want to receive

</details>

**Changes**

- supabase/migrations/<ts>\_words_i_would_rather_not_see.sql (new) — table user_muted_words (user_id uuid references users on delete cascade, word text, created_at timestamptz, primary key (user_id, word)), RLS enabled, one policy for all four verbs on user_id = auth.uid(), revoked from anon. No function signature changes, so no drop-function dance.

- src/features/profile/muted-words.ts (new) — useMutedWords() and useSetMutedWords(), plus a pure `matchesMutedWord(text, words)` that matches on word boundaries.

- src/app/muted-words.tsx (new) — the editor. NOT on src/app/visibility.tsx: that screen's header comment at :14-27 commits out loud to three promises, one of which is that it does nothing to chat, and hanging a message filter off it breaks the one thing it says.

- src/app/profile-me.tsx:346-350 — a ghost PrimaryButton reaching the new route, beside 'House rules and help'.

- src/app/(tabs)/chat.tsx:174 — when the first message matches, render it collapsed behind a tap. The sender's profile, the report link, Decline and Accept all stay visible. Nothing is deleted, nothing is gated, and the sender is never told.

**Database.** New table user_muted_words with RLS scoped to auth.uid(). No RETURNS TABLE function changes, so no drop-function requirement.

**Tests.** pgTAP in a new supabase/tests/database file, written as the attack: one user selecting another user's muted words returns nothing, and an insert naming another user_id is refused. Jest for the matcher: word boundaries, case insensitivity, and no substring false positives ('assist' must not match 'ass', 'classic' must not match 'ass'). A screenshot of a collapsed hello, because whether it reads as protective or as censorship is a design question only a picture answers.

**Risk.** This sits ON TOP of the server pipeline and never replaces it: rule 5 says every first message passes moderation before delivery, and it still does. This is a per-user layer applied at render, after delivery. The real hazard is the matcher: a naive includes() collapses innocent messages and reads as the app censoring people, which is worse than the problem it solves. Match on word boundaries, and show the person which of their own words caused the collapse, on their own list, never to the sender.

**Waits on.** Ship a per-user muted-word list at all. FOR: the platform classifier is deliberately conservative, the travelers this marketplace cannot afford to lose are the ones with the most specific lines, and it stays free and gates nothing. AGAINST: it is a table, a screen and a settings row for a product with no users yet, and the same effort spent on the classifier itself helps everyone rather than the few who find the setting.

**After.** `chat-hellos-do-not-flood-the-inbox`

## The message thread, reactions, groups and rooms

Forty-one findings collapse into twenty-one packages, and the shape of the work is lopsided: the thread's mechanics are in good order (optimistic sends, realtime on `event: '*'`, an anchored long-press menu, photo-in-review tiles, unsend, pins) while the thread's conventions are missing wholesale. There is no reply, no unread divider, no way to get an address out of a message, no paging past 100, and no in-app search — five things every traveler already has in their thumbs from WhatsApp. Six packages are cheap and clearly right and should ship this week: the Send button still expresses disabled with `opacity: 0.4`, the exact pattern this repo's own traps skill measured at 2.35:1 and banned; the long-press menu paints a second copy of the message over the first and has been "fixed" three times by darkening a scrim that cannot win; the delivery status is set in an 11pt semibold letterspaced label role; a tapback takes two network round trips to appear; the accepter of a hello is told it started from the sender's photo; and one conversation is called a group, a room and a chat on a single screen. The real work after that is reply and the unread divider, in that order, because a hostel room of twelve is the surface the product is betting on and it is the surface with the weakest tools. Two corrections matter for planning: `messages` is ONE table serving direct chats and rooms alike, so reply is one column and not two, and `expo-clipboard` is not in the binary, so "Copy" has to be the share sheet the founder already asked for or it costs an EAS build. What the founder is really deciding here is how much of a messenger Samewhere intends to be — reply, paging, search and quoting are table stakes nobody praises and everybody notices missing — and separately whether to buy a domain, because four findings (the QR nobody can scan, the pasted link that gets rejected, the share message that has to explain itself, the URL space) are one blocked decision wearing four hats.

### `chat-send-button-reads-as-a-button` — Make Send express disabled by colour, and give it the app's press feel

**Priority** now · **Effort** S · **Ships as** over the air

The Send button is the most repeated control in the product and the only primary control in the app with no press feedback of any kind. Worse, it expresses disabled with `opacity: 0.4` — the exact pattern this repo already measured at 2.35:1 on #0E1020 and banned in its own traps skill, under the 3:1 floor for a control and still looking completely tappable. Screenshots 23, 24 and 26 all show it: a muddy navy disc with a washed-out arrow, in the state an empty composer spends most of its life in. It reads as broken rather than as waiting for you to type.

<details><summary>Closes 2 audit findings</summary>

- The Send button expresses disabled with opacity 0.4, the exact trap this repo has already documented and paid for

- Composer Send has no haptic, no press feedback, and fades to 0.4 for disabled

</details>

**Changes**

- src/features/chat/composer.tsx — replace the plain `Pressable` at :132-152 with `PressableScale scaleTo={0.9} haptic="soft" disabled={!canSend}`; put layout on `containerStyle={styles.sendTarget}` (40x40) and visuals on `style={[styles.sendButton, { backgroundColor: canSend ? theme.accentDeep : theme.surfaceSunken }]}`, because PressableScale scales an INNER view and putting size only on the inner one shrinks the hit rect. Delete the `opacity: canSend ? 1 : 0.4` at :146 outright.

- src/features/chat/composer.tsx:151 — the arrow's `tintColor` must move with the fill: `canSend ? theme.onAccentDeep : theme.textSecondary`. Swapping the fill while leaving a white arrow on it brings the same collapse back at a different value.

- src/features/chat/composer.tsx — do NOT import @/lib/haptics or call it inside submit(). A disabled RN Pressable never fires onPressIn, so PressableScale's own touch-down haptic is already silent on an empty composer.

**Tests.** New src/features/chat/**tests**/composer.test.tsx: render with an empty draft and assert the flattened Send style has no `opacity` key and a `backgroundColor` of surfaceSunken; type a character and assert accentDeep. Then re-shoot E2E `24-group-message` and `26-reacted` — the screenshot is the evidence for "does it look disabled", nothing else answers it.

**Risk.** PressableScale's containerStyle/style split is the trap: get it wrong and the 40pt circle shrinks its own touch target mid-press and drops taps (the comment at src/components/ui/pressable-scale.tsx:24-30 records exactly this). Do not also add an explicit accessibilityState — the `disabled` prop already folds into it and a second one can contradict the first.

### `chat-menu-hides-the-message-it-lifts` — Hide the source bubble while its menu is open instead of dimming it

**Priority** now · **Effort** M · **Ships as** over the air

Long-pressing a message renders it twice. The overlay paints a copy of the pressed bubble at `top + shift` while the real one stays mounted in the thread underneath, and the only thing hiding it is a scrim darkened three times (0.62, 0.86, 0.88) chasing a fight it cannot win. Screenshot 25 is the proof: "First one in" is legible twice, about 22pt apart, with the Pin/Unsend card half over the ghost — and the header, the day separator and the composer placeholder all read through the scrim. On the one screen the design brief says novelty is a pure cost, the headline gesture looks like a rendering fault.

<details><summary>Closes 3 audit findings</summary>

- Long-pressing a message renders it twice

- The long-press menu shows the message twice: the lifted copy over the un-hidden original

- The reaction menu leaves a ghost of the original message and floats the reaction row away from it

</details>

**Changes**

- src/features/chat/message-thread.tsx — `menu` already lives in the thread component at :873, so nothing has to be lifted. In renderItem (:924) compute `const lifted = menu?.message.id === item.id` and pass it to `Bubble` as a new `lifted?: boolean` prop.

- src/features/chat/message-thread.tsx Bubble (:684-711) — apply `lifted && { opacity: 0 }` to the outer `styles.bubbleRow` view. Never `display: 'none'` and never a conditional return: the measureInWindow rect the menu was positioned from (:466-470) must stay valid, and the row's height must stay in the layout or the list reflows under the open menu.

- src/features/chat/message-thread.tsx:895 — add `extraData={menu?.message.id}` to the FlatList. The inline renderItem usually forces a re-render; extraData is the guarantee VirtualizedList re-renders the cells when the menu opens and closes.

- src/features/chat/message-thread.tsx:154 — bring MENU_SCRIM back from 'rgba(2,3,9,0.88)' to about 'rgba(2,3,9,0.70)'. The near-opaque value was only ever compensating for the ghost. Keep the GlassView and MENU_GLASS_OVER_SCRIM at :160 as they are — the comment at :133-152 is right that a dim depending on a GPU effect being present is not a dim.

- src/features/chat/message-thread.tsx:107-131 — rewrite the scrim comment block to record the real cause and the real fix rather than the opacity ladder, so the next person who sees something through the scrim does not reach for 0.95.

**Tests.** src/features/chat/**tests**/message-thread.test.tsx: add `testID={`bubble-${item.id}`}` to the row and assert that after `fireEvent(..., 'longPress')` the source row's flattened style has `opacity: 0`, and that it is back to undefined after pressing Dismiss. Then re-shoot E2E `25-reaction-menu` — the words must appear exactly once. Assert the exact text a human reads; do not loosen it.

**Risk.** A view at `opacity: 0` is skipped by UIKit hit-testing entirely (traps). Harmless here because the modal is over it, but it means the row is untappable for one frame after dismissal on a slow commit. Second risk: lowering the scrim before the ghost fix lands re-exposes the date separator the scrim was darkened for, so the two halves must ship together.

### `chat-bubble-footer-reads-as-one-thing` — Stack reaction and delivery status under the bubble, and stop shouting "Sent"

**Priority** now · **Effort** S · **Ships as** over the air

In screenshot 26 the tapback and the delivery status sit at almost the same height on opposite sides of an empty gap, reading as a row of two unrelated controls rather than a mark on the message above them. And "Sent" is rendered in the `caption` role — 11pt, 600 weight, 0.4 letterspacing — which is correct for a section heading and wrong for a delivery status. Showing it only under the newest own message is the right restraint; the typography undoes it.

<details><summary>Closes 2 audit findings</summary>

- The reaction chip hangs below the bubble on the opposite side from "Sent", so the two collide into a meaningless two-column row

- "Sent" is rendered in the caption role, an 11pt semibold letterspaced label, so the status shouts louder than the message

</details>

**Changes**

- src/features/chat/message-thread.tsx Bubble (:496-556) — move `<Reactions rows={...} onToggle={...} />` ABOVE the status PressableScale inside `bubbleColumn`, so the vertical order is bubble, reaction, status.

- src/features/chat/message-thread.tsx Reactions (:161-211) — take a `mine: boolean` prop and add `alignSelf: mine ? 'flex-end' : 'flex-start'` to the row, so a chip on your own right-aligned bubble hangs off the bubble's own edge.

- src/features/chat/message-thread.tsx:1187-1192 styles.reactionRow — `marginTop: -6` is the negative overlap that stopped working once the status shared the band; make it `marginTop: 2`, keeping `marginHorizontal: Space.sm`.

- src/features/chat/message-thread.tsx:545-547 — the status text becomes `type="footnote"` (13/400, already in Type at src/constants/theme.ts:151) at textSecondary or danger. Leave the day separator on `caption`, where the weight is right, and leave the accessibilityLabel wording alone.

**Tests.** src/features/chat/**tests**/message-thread.test.tsx: render an own message with `delivered` and one reaction, assert the rendered order of bubbleColumn's children and that the 'Sent' node carries fontSize 13. Then re-shoot E2E `26-reacted`: the heart must sit under the bubble's trailing corner with 'Sent' beneath it.

**Risk.** Do not reach for the iMessage overlap (absolutely positioning the chip over the bubble's corner). The menu measures the bubble's window rect at message-thread.tsx:466-470 to place its action card, and an overlapping chip changes what that rect contains. The cheap reorder gets 90% of the value with none of that risk.

### `chat-reactions-land-instantly` — Make a tapback and an unsend appear before the network answers

**Priority** now · **Effort** S · **Ships as** over the air

Long-press a bubble, pick a heart, and the menu closes onto a bubble with no reaction on it. The chip only appears after `setReaction` returns and the invalidated ['reactions', chatId] query refetches from scratch at staleTime 0 — two round trips, on hostel wifi or a foreign SIM, while the user stares directly at the thing that is supposed to change. Unsend is the same: five keys invalidated and the message stays on screen until they all land. The file's own neighbour, useSendMessage, already does this properly, so the pattern is in the repo and just was not applied.

<details><summary>Closes 1 audit findings</summary>

- Tapping a tapback does nothing until two network hops finish

</details>

**Changes**

- New src/features/rooms/reactions.ts — a pure `applyToggle(rows: ReactionSummaryRow[], input: { messageId, emoji, on, userId }): ReactionSummaryRow[]` mirroring the server's one-reaction-per-person rule: turning one on removes the viewer's previous emoji on that message (decrementing or dropping its row) and adds or increments the new one with `reacted_by_me: true`; turning one off decrements and drops the row at zero.

- src/features/rooms/hooks.ts:165-175 useToggleReaction — add `onMutate` (cancelQueries on ['reactions', chatId], snapshot via getQueryData, setQueryData through applyToggle, return the snapshot), `onError` rollback, and move the invalidate from onSuccess to onSettled.

- src/features/rooms/hooks.ts:177-193 useUnsendMessage — add `onMutate` writing `unsent_at` onto the matching row in both ['messages', chatId] and ['room-messages', chatId], with a snapshot rollback in onError. The thread already renders `unsent_at != null` as the UnsentNote (message-thread.tsx:559-568), so nothing else changes.

- src/features/rooms/hooks.ts:152-158 useReactions — leave staleTime 0; the optimistic write is what closes the gap, not caching.

**Tests.** New src/features/rooms/**tests**/reactions.test.ts — jest on `applyToggle` alone: toggling on adds a row with count 1 and reacted_by_me; a second emoji on the same message moves yours rather than stacking; toggling off drops the row at zero but leaves other people's rows intact. Do not mock Supabase to prove the mutation — the pure updater is the logic worth testing.

**Risk.** `PostgrestError` is not an `Error`, so any rollback path written as `if (e instanceof Error)` silently swallows every database message. React Query's onError does not need such a guard; do not add one while in here.

### `chat-message-actions-do-the-job` — Give the long-press menu Share and links, split Remove from Report, and let a visitor report

**Priority** now · **Effort** M · **Ships as** over the air

Three failures share one array. A traveler is sent "we're at Rua da Bica 42, 8pm" or an Instagram handle and there is no way to get any of it out — the menu offers only Pin and Unsend, and a URL is dead grey text. That matters more here than in a general messenger because §7 rule 4 means socials only ever arrive inside a chat, so the chat is the one place a handle can appear and it is unextractable. Meanwhile a room's moderator gets "Remove" INSTEAD of "Report", so the people best placed to spot abuse early have the weakest escalation path; and a non-member reading a public business room — the surface most likely to show a stranger's message — gets no menu at all, because one flag conflates "may add a reaction" with "may flag abuse".

<details><summary>Closes 3 audit findings</summary>

- Nothing in a message can be copied, selected or tapped: no Copy action, no selectable text, no link detection

- A visitor reading a public business room cannot report a message, because canReact gates reporting too

- The room moderator's menu replaces Report with Remove, leaving no way to escalate a message they had to delete

</details>

**Changes**

- src/features/chat/message-thread.tsx:610-624 — the actions array gains a Share entry at the top, calling react-native's `Share.share({ message: message.body })`, gated on `message.body != null`. NOT expo-clipboard: package.json:13-36 lists every expo module in the binary and clipboard is not among them, so adding it is native code and costs an EAS build. src/app/group/[id].tsx:293-296 records the founder's own view that the share sheet IS the text/email/copy chooser. Label it "Share", not "Copy" — a control says exactly what happens.

- New src/features/chat/links.ts — `splitLinks(body: string): Array<{ text: string; url: string | null }>` matching http(s) URLs and bare domains, trimming trailing punctuation, leaving @handles alone.

- src/features/chat/message-thread.tsx BubbleBody:320-325 — render splitLinks output as nested `<Text>` spans, the matched ones pressable and calling `Linking.openURL` from expo-linking (package.json:25, already shipped) inside a try/catch. Underline them; theme.accent on a received bubble, underlined onAccentDeep on your own where accent-on-accentDeep has no contrast. Do NOT use `dataDetectorTypes` (a TextInput prop) or `dataDetectorType` (Text, Android-only) — neither does anything on an iOS-first app.

- src/features/chat/message-thread.tsx — replace the `reportLabel` prop with a second handler `onRemove?: (messageId: string) => void`. MessageMenu pushes Pin, Share, Remove (destructive), Unsend (destructive), Report (destructive). The card's height maths at :634-635 already scales with actions.length, so no layout work.

- src/features/chat/message-thread.tsx:945-950 — add a `canReport = true` prop and change the gate to `const menuable = (canReact || onReport != null || onRemove != null) && !item.id.startsWith('first:') && !isLocalId(item.id) && !unsent && note == null`, supplying onOpenMenu on menuable. MessageMenu renders the emoji pill only when canReact, so a non-member gets a card with Report and nothing else.

- src/app/room/[id].tsx:413-439 — drop reportLabel; pass `onRemove` (the moderator Alert calling removeMessage) and `onReport` (the existing /report push with `context: room:<chatId>:message:<id>`) side by side, both for any signed-in reader including a moderator.

- src/app/room/[id].tsx — a signed-out visitor has no session and /report sits behind `Stack.Protected guard={signedIn}` (src/app/\_layout.tsx:362-364), so for them pass an onReport that presents the existing SignUpGate rather than pushing a route that does nothing. A guest ACCOUNT can report and must keep the real route.

**Tests.** jest on splitLinks in src/features/chat/**tests**/links.test.ts (bare domain, trailing full stop, two URLs in one sentence, a handle untouched). src/features/chat/**tests**/message-thread.test.tsx: a long press with `canReact={false}` plus an onReport opens a menu containing Report and no emoji; a moderator's menu shows Remove and Report calling different handlers. E2E: extend signed-in-tour to long-press and assert 'Share' is visible, then re-shoot 25.

**Risk.** Do NOT add `selectable` to the bubble text as a second copy path: the bubble owns a 220ms long press (message-thread.tsx:452) and claims the responder in the bubble phase, so iOS's own text-selection recogniser never starts — a prop that reads as a fix and does nothing on a device is exactly what the traps skill exists for. Second: a nested pressable `<Text>` inside a Pressable is fine on iOS, but verify the long press still opens the menu when the press lands ON a link.

**After.** `chat-menu-hides-the-message-it-lifts`

### `chat-anchor-speaks-to-the-accepter` — Tell the accepter the hello started from THEIR profile, not the sender's

**Priority** now · **Effort** S · **Ships as** over the air

src/features/chat/anchors.ts exists because the anchor needs two grammars, and its own header comment says so: third person about the other person's profile for the sender, second person about your own for the recipient. Only one is used after accept. chat/[id].tsx:408 calls `anchorStartedFrom(chat.first_message_element, chat.title)`, and my_chats sets `title` for a direct chat to the OTHER participant (20260830000000:496-500). So the person who received a hello about their own photo opens the chat and reads "Started from Alex's photo" — Alex's photo, which Alex never mentioned — directly above the opening message that contradicts it. This is the exact failure anchors.ts was written to prevent, one accept step later.

<details><summary>Closes 1 audit findings</summary>

- After accepting, the recipient is told the hello started from the sender's profile, not their own

</details>

**Changes**

- src/features/chat/anchors.ts — add `anchorTheyStartedFrom(element: string): string` returning `` `Started from ${anchorAboutYours(element)}` ``, which composes correctly for every kind ('your photo', 'your travel plans', 'where you are from', 'your pin at X'). Do not pass a name into it: for the accepter the name in `title` is the sender and the anchor is about the reader.

- src/features/chat/anchors.ts — add a pure `footerAnchor(element, firstMessageSenderId, ownUserId, title): string` that picks between the two renderers, so the screen holds no branching and the choice is unit-testable.

- src/app/chat/[id].tsx:403-413 — call footerAnchor. The screen already reads `chat.first_message_sender_id` at :339 for the synthetic first bubble, so nothing new is fetched.

**Tests.** src/features/chat/**tests**/anchors.test.ts already has a full `describe('anchorAboutYours')` block, so the vocabulary is covered — what is untested is which renderer gets picked. Add a `describe('footerAnchor')` asserting that for one first_message_element the sender and the accepter get DIFFERENT strings, and that the accepter's never contains the other person's name.

**Risk.** `first_message_sender_id` is nullable on ChatListRow. Treat null as "not me" only when ownUserId is also non-null; otherwise fall back to the existing third-person string rather than telling a business or a still-loading session the wrong thing.

### `chat-one-word-per-thing` — One word per thing, no presence claims, and an unambiguous date in the inbox

**Priority** now · **Effort** M · **Ships as** over the air

A traveler taps Groups, taps Start a group, creates a group, and is then asked to "Message the room…" — screenshot 24 shows that placeholder inside "Maestro crew", a traveler group. On one settings screen the object is a group five times and a chat twice, and the leave confirmation throws away the succession warning the screen just gave. "Guest" means two unrelated things one tab apart. And four strings claim proximity — a member with no departure date is labelled with the bare word "Here", exactly where WhatsApp puts "online" — in an app whose strongest safety claim is that it never collects your location. The founder settled this class of question on 2026-08-28 for place versus business and chose consistency; this is the same decision, unmade, plus a numeric date that means March 4 to an American and 3 April to everyone else the app is for.

<details><summary>Closes 7 audit findings</summary>

- "Guest" means two unrelated things, and the collision lands in a hostel room

- "Here", "here now" and "nearby" make presence claims in an app whose promise is that it does not know where you are

- Group settings calls one object a chat and a group in the same paragraph, and the leave confirmation drops the fact the screen just taught you

- Group settings explains its controls by screen position, and the control it describes is not on screen

- The same conversation is called a group, a room and a chat, sometimes on one screen

- "Only who I pick" reads as a typo

- Chat-list dates render as "3/4", which means March 4 to an American and 3 April to nearly everyone else

</details>

**Changes**

- New src/features/groups/speaking.ts — hoist SPEAKING_OPTIONS out of BOTH src/app/group/[id].tsx:44-47 and src/app/new-group.tsx:25-28 (they are duplicated today) and change the label to 'Only people I pick'. One constant, two importers.

- src/app/room/[id].tsx:513 — `placeholder={isGroup ? 'Message the group…' : 'Message the room…'}`. The isGroup flag is already computed at :88-89.

- src/app/room/[id].tsx:257-259, :262, :282 — replace every 'here' presence claim with 'in this chat', and at :282 use `countOf(info.member_count, 'person', 'people')` instead of `countOf(info.member_count, 'guest')`. Guest is reserved for the signed-out state.

- src/app/(tabs)/chat.tsx:508 — 'Rooms near you' becomes 'Rooms in {city}', using the joined `cities` row fetchLaunchCities already selects (src/features/pins/api.ts:15-21); fall back to 'Open rooms' when the name is not loaded. Never 'nearby'.

- src/app/(tabs)/chat.tsx:515 — `${countOf(room.member_count, 'person', 'people')} in this chat`.

- src/app/(tabs)/chat.tsx:319 — the room preview's ` here` suffix becomes ` in this chat`, matching the room screen.

- src/app/group/[id].tsx:149 — `member.departure_date ? `In town until ${formatDate(...)}` : 'No dates set'`. Screenshot 27 shows '1 person' as the heading directly above, so 'No dates set' sits consistently with it.

- src/app/group/[id].tsx:597-604 — 'Leave this chat' becomes 'Leave this group' (label and accessibilityLabel); :447-449 'Give this chat no end date' becomes 'Give this group no end date'.

- src/app/group/[id].tsx:228-244 — branch confirmLeave the way the footnote at :606-610 already branches: isAdmin gets 'You run this one, so somebody else takes over when you go.', everyone else 'You stop getting its messages. Anyone in the group can add you back.' The confirmation must echo the control.

- src/app/group/[id].tsx:583-588 — delete the whole 'Tap a name to open their profile. The button on the right of a row...' paragraph. It describes a control by screen position, describes two acts as one button, and in the photographed state (27-group-settings) no such button is on screen. Do not re-add the accessible label the finding asks for: the ellipsis already carries `accessibilityLabel={`Manage ${name}`}` at :162.

- src/lib/plural.ts:2 — the doc comment is `"1 guest here now", not "1 guests here now"`, enshrining the banned phrasing as the example the next caller copies. Change it to '1 person in this chat'.

- src/features/chat/separators.ts:51 — SHORT_DATE becomes `{ month: 'short', day: 'numeric' }` ('Mar 4'), unambiguous in every Latin-script locale and one or two characters wider in a column already sized for 'Yesterday'.

- .claude/skills/design-review/SKILL.md — add 'here now', 'nearby', 'near you' and a bare 'Here' to the banned-vocabulary list beside swipe/deck/match, and record the naming ruling: a traveler-made one is a GROUP, a business-run one is a ROOM, and 'chat' is only ever a one-to-one.

**Tests.** Update src/features/chat/**tests**/separators.test.ts for the new SHORT_DATE (assert 'Mar 4', not a wildcard). Add a jest test asserting both SPEAKING_OPTIONS importers resolve to the same array. E2E: re-shoot 22, 24, 26, 27 and 27a and read the words — the change IS the screenshot, and a green run proves nothing about copy.

**Risk.** src/features/pins/map-screen.tsx:1459 and :1470 both read 'Glowing spots are plans nearby' while the map is scoped to a city chip that may be a continent away. Same finding, same vocabulary, but the map subsystem's file — if the map plan does not cover it, add it here as 'Glowing spots are where the plans are' (visible text and matching accessibilityLabel), or the banned list ships with a live violation under it. Second: src/app/place/[id].tsx:558 'N people in the chat here' is locative about a business, not a presence claim, and can stay.

### `chat-getting-a-second-person-in` — Make a brand-new group offer the invite, and stop rejecting the link people paste

**Priority** now · **Effort** M · **Ships as** over the air

Screenshot 23 is the screen a person lands on straight after the most effortful thing in the Chat tab: they named a group, chose a photo, set who can post and an end date, and get "1 person here" over an instruction to talk to themselves. The one thing they need next — getting anybody else in — is behind an unlabelled (i) glyph. And the recovery path built specifically because samewhere:// is untappable fails on the most likely input: paste the link (or the whole shared line, which is what a long-press copy in Messages gives you) and chat.tsx:718-721 percent-encodes it whole, the preview cannot resolve it, and the screen blames the sender. The empty-state copy is good; it is answering the wrong question.

<details><summary>Closes 4 audit findings</summary>

- A brand-new group is an empty room with no invite prompt and no record that you created it

- The share message is a wall of text that explains nothing and prints the invite token twice

- The lobby QR code is a dead end for the people it is aimed at

- "Paste the code somebody sent you" rejects the link, which is what people actually paste

</details>

**Changes**

- src/app/room/[id].tsx:440-458 — when `isGroup && (membership?.member_count ?? 0) < 2 && messages.length === 0`, replace the empty state with 'Your group is ready.' plus a PrimaryButton 'Invite people' pushing `/group/${id}`. Keep 'Go first. One line is plenty.' for a room that has members but no messages, where it is exactly right, and leave the muted branch untouched.

- New src/features/groups/invite-code.ts — `normalizeInviteCode(input: string): string | null`: trim, pull the first URL out of a multi-line shared message, drop any query or fragment, take the last non-empty path segment when the value parses as a URL or contains a slash, return null for empty. src/features/profile/validation.ts already does this shape for a pasted profile link — reuse the idea, not the code.

- src/app/(tabs)/chat.tsx:713-731 promptForInvite — run the pasted value through normalizeInviteCode before `router.push('/join-group/...')`, and widen the Alert body from 'Open the invite link you were sent.' to 'Paste the code or the link you were sent.', which is what the row above it already promises.

- src/app/group/[id].tsx:287-302 — the share message tells a recipient who has never heard of Samewhere nothing about what it is, and instructs somebody without the app to put a code 'into the app'. Rewrite to `Join "${group.name}" on Samewhere, a free app for meeting other travelers: ${url}` and reword the second line to `No app yet? Get Samewhere first, then put in this code: ${inviteToken}`.

- src/features/groups/invite-qr.tsx:49-51 — the caption promises a join and delivers a shrug: iOS Camera cannot resolve a custom scheme for an app that is not installed, and the four people in a hostel lobby are exactly the people who have not installed it. Change to 'Point a camera at this. They need Samewhere first.' until the link is https.

**Tests.** New src/features/groups/**tests**/invite-code.test.ts: `samewhere:///join-group/abc123`, `https://x/join-group/abc?utm=1`, a bare 64-character token, the whole two-line shared message, whitespace, empty. E2E: extend signed-in-tour after `23-group-created` to assert 'Invite people' is visible, then re-shoot that screenshot.

**Risk.** Do NOT drop the invite-code line from the share message and do NOT print the token in large type under the QR: the token is 64 hex characters (group_invite_token mints two UUIDs' worth, 20260821010000:353-356), unreadable across a table, and the code line is the only recovery path while the scheme stays untappable. The finding's worry about the credential appearing twice is weak — same secret, same message, and the URL already carries it. The real fix is an https link, which is a founder decision and an EAS build.

### `chat-unread-divider` — Draw a New line where you stopped reading, and open the thread there

**Priority** next · **Effort** M · **Ships as** over the air

unread.ts computes counts for the tab badge and each segment, so the app knows exactly how many messages are waiting — and throws the number away at the thread boundary. A traveler joins the hostel room, spends a day on a walking tour, comes back to sixty messages and lands on the newest one with nothing marking where yesterday ended. It is worse than a missing feature: useMarkReadWhileOpen fires on focus (use-mark-read.ts:24-31), so backing out and returning loses the boundary forever. This is the surface the product is betting on, made unusable by being busy.

<details><summary>Closes 2 audit findings</summary>

- A thread has no unread divider and never opens where you left off

- Opening a thread with unread messages drops you at the newest one with no divider and no way back to where you left off

</details>

**Changes**

- src/features/chat/unread.ts — add `firstUnreadId(messages, ownUserId, unreadCount): string | null`. Walk the newest-first array counting only messages from other people that are not local placeholders; return the id of the oldest unread. Return null when unreadCount is 0, or when the walk runs off the end of the loaded page — a count larger than what is loaded cannot be placed honestly.

- src/features/chat/message-thread.tsx — new prop `unreadFrom?: string | null`. In renderItem (:963-966) render the divider INSIDE the same wrapper View the day separator uses, above the bubble, when `item.id === unreadFrom`: two flexed hairlines with a centred 'New' in theme.highlight, the same colour as the unread dot. A sibling row would mark the boundary against the wrong message, because an inverted cell flips its children (traps).

- src/app/chat/[id].tsx — snapshot `chat.unread_count` into a useRef on the first render where `chat` is defined (a ref assigned during render wins over useMarkReadWhileOpen's focus effect), compute unreadFrom from firstUnreadId(thread, ownUserId, snapshot) and pass it down. `last_read_at` is NOT available: my_chats' RETURNS TABLE (20260830000000:440-459) returns unread_count and no timestamp and no other RPC exposes it, so counting from the newest is the only path needing no migration.

- src/app/room/[id].tsx — the same snapshot from `membership.unread_count`, computed against `thread`.

- src/features/chat/message-thread.tsx — hold a useRef<FlatList> and, on the list's first onLayout only, `scrollToIndex({ index, viewPosition: 0.85, animated: false })` at the divider. Supply `onScrollToIndexFailed` that scrolls to `averageItemLength * index` and retries once on the next frame: there is no getItemLayout and bubble heights vary, so initialScrollIndex would warn and land wrong. Skip entirely when unreadFrom is null or the count exceeds 30.

- src/features/chat/message-thread.tsx — a floating 'Jump to latest' PressableScale shown when onScroll reports a contentOffset past one screen (inverted: offset grows as you scroll up), calling `scrollToOffset({ offset: 0 })`. It is also the escape hatch if the divider scroll lands somewhere surprising.

**Database.** none — the cheap path deliberately avoids one. If the founder later wants the true last_read_at timestamp instead of a count, that means adding an OUT column to my_chats, which per AGENTS.md requires `drop function public.my_chats(boolean)` first and both grants re-stated.

**Tests.** jest on firstUnreadId in src/features/chat/**tests**/unread.test.ts (which exists): own messages sent after the boundary are not counted; a count larger than the loaded page returns null; zero returns null. A render test on MessageThread with unreadFrom set, asserting the exact word 'New' appears once. There is no honest E2E — it needs two accounts and a gap — so the evidence is a manual two-device check, and say so rather than shipping a green run as proof.

**Risk.** The thread stands on a keyboard-sized floor and an inverted list is anchored to its own bottom, so any measured scroll taken across a keyboard dismissal is off by a keyboard's height (traps, and message-thread.tsx:480-508 already fights this for the menu). Do the divider scroll on first layout only, before the composer can be focused. Second: on a fast refetch the snapshot ref must not be re-armed, or the line moves under the reader.

### `chat-load-earlier-messages` — Page a conversation past its first screenful instead of ending silently

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

Two travelers who became friends and kept chatting hit 100 messages and everything before that is unreachable: src/features/chat/api.ts:7 caps at 100 and the FlatList has no onEndReached anywhere in the file. There is no spinner, no 'load earlier', no sign a limit was applied — the thread simply ends, and the anchor note saying what the conversation started from sits above message 100 asserting something false. A room is the mirror: `room_messages(p_chat_id, p_limit int default 60)` exists but src/features/rooms/api.ts:66 never passes it, so a busy hostel room is silently capped at 60 with no way back.

<details><summary>Closes 1 audit findings</summary>

- A one-to-one thread stops at 100 messages with no way to reach anything older

</details>

**Changes**

- src/features/chat/api.ts:10-22 — `fetchMessages(chatId, before?: string)` adds `.lt('created_at', before)` when given.

- src/features/chat/hooks.ts:31-68 useMessages — convert to useInfiniteQuery keyed on the oldest loaded created_at, `initialPageParam: null`, getNextPageParam returning null when a page comes back short. The realtime handler at :49-63 currently does setQueryData on a flat array and must be rewritten for the InfiniteData shape: prepend into pages[0], keeping the replace-not-skip behaviour that makes a photo verdict land. carryFailed moves to page 0.

- src/features/chat/message-thread.tsx:894-1040 — new props `onEndReached?: () => void` and `loadingMore?: boolean`. Wire onEndReached with `onEndReachedThreshold={0.4}` on the inverted list (it fires at the visual TOP) and render an ActivityIndicator above whatever `footer` the caller passed, in the same element — the footer slot is already taken by the anchor card.

- src/app/chat/[id].tsx:403-413 — render the anchor footer only when `!hasNextPage`, so it stops sitting above message 100 claiming the conversation began there.

- New migration supabase/migrations/2026XXXXXXXXXX_load_earlier.sql — `drop function if exists public.room_messages(uuid, int);` then recreate as `room_messages(p_chat_id uuid, p_limit int default 60, p_before timestamptz default null)` with `and (p_before is null or m.created_at < p_before)` and the same masking, ordering and membership tests. The drop is mandatory: adding a defaulted parameter creates a second overload and PostgREST calls by named argument, which does not save you — 20260827170000:295-298 records this exact lesson for update_group. Re-state `grant execute on function public.room_messages(uuid, int, timestamptz) to anon, authenticated;`.

- src/features/rooms/api.ts:65-71 — pass p_limit and p_before. src/features/rooms/hooks.ts:74-109 useRoomMessages becomes an infinite query on the same shape; the realtime subscription keeps invalidating, which refetches every loaded page — acceptable at these sizes, and the alternative is a merge the joined RPC cannot synthesise client-side.

- src/lib/database.types.ts — update the room_messages Args entry with the new parameter.

**Database.** One migration. `drop function if exists public.room_messages(uuid, int);` FIRST, then create the three-argument version, then re-state the grant to anon and authenticated — the drop removes it.

**Tests.** New supabase/tests/database/30_message_paging.test.sql (pgTAP): room_messages with p_before excludes rows at or after that timestamp; the cap still clamps to 200; and — written as the attack — a non-member still gets nothing back from a private group whatever p_before they pass. jest on the getNextPageParam selector (short page ends paging; a full page returns the oldest created_at). No E2E: making 100 messages in a flow is not worth the run time, and say so.

**Risk.** The realtime rewrite is the sharp edge. Both thread subscriptions were already broken once by watching INSERT only, and the InfiniteData conversion is the second chance to break them — a handler that treats a known id as 'already have it' drops the very photo verdict it was subscribed for (traps). Keep `event: '*'` and keep the replace-by-id merge. Second: this and chat-unread-divider touch the same FlatList; whoever does this must relax the divider's 'count exceeds what is loaded' guard rather than leaving two rules fighting.

**After.** `chat-unread-divider`

### `chat-reply-to-a-message` — Reply to a specific message, with the quoted line above the bubble

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

In a room of six people discussing three plans for tonight, every answer is ambiguous. "I'm in" — in for what? The only repair available is retyping what you are answering, which nobody does, so the room degenerates into parallel monologues, and the app's own five-minute grouping window welds consecutive messages together to make it worse. This is the single convention whose absence people notice fastest moving between apps, and the one that makes a busy hostel room readable for somebody who arrives an hour late. One correction to the audit: `messages` is ONE table serving direct chats and rooms alike (20260816220000:15-21; room_messages is an RPC over it), so this is one column, not two.

<details><summary>Closes 2 audit findings</summary>

- You cannot reply to a specific message anywhere in the app

- No reply or quote anywhere, which makes a group room with three people talking unreadable

</details>

**Changes**

- New migration supabase/migrations/2026XXXXXXXXXX_reply_to_a_message.sql — `alter table public.messages add column reply_to_message_id uuid references public.messages(id) on delete set null;` plus `create index messages_reply_idx on public.messages (reply_to_message_id);`

- Same migration — a `before insert` trigger `messages_reply_same_chat()` raising unless the parent row's chat_id equals the new row's. A check constraint cannot do the subquery, and without it a client can quote a message from a chat the reader is not in.

- Same migration — `drop function if exists public.room_messages(uuid, int, timestamptz);` (and the two-argument form if paging has not landed) then recreate adding three OUT columns: `reply_to_message_id uuid, reply_to_name text, reply_to_body text`. The name is the parent sender's display_name and NEVER a handle (§7 rule 4), and the body comes back null when the parent is unsent or removed rather than preserving a copy the reader may no longer be allowed to see. Re-state the grant to anon, authenticated.

- src/lib/database.types.ts — add the column to MessageRow (direct chats read `select('*')`, so it arrives free) and the three fields to RoomMessageRow.

- src/features/chat/api.ts:24-34 and :50-76 — sendMessage and sendPhotoMessage take an optional replyToMessageId and include it in the insert.

- src/features/chat/outgoing.ts — optimisticMessage and optimisticRoomMessage carry it, so the quoted strip appears on the placeholder bubble too.

- src/features/chat/message-thread.tsx:610-624 — 'Reply' becomes the FIRST entry in the actions array, ahead of Pin.

- src/features/chat/message-thread.tsx BubbleBody:305-325 — a quoted strip above the content INSIDE the bubble: a 2pt leading rule in theme.accent (accentSoft on your own bubble), the parent's name in caption and its first line in footnote with numberOfLines 1. Inside the bubble, so the inverted-cell child-flip is a non-issue. For a direct chat the parent resolves from the loaded page and falls back to 'Message' when off-page.

- src/features/chat/composer.tsx — a `replyingTo?: { name: string; body: string | null }` banner above the input with an x to clear, plus onCancelReply. Keep the reply id in the two screens and attach it at send, rather than widening ComposerDraft's contract for both callers.

- src/app/chat/[id].tsx and src/app/room/[id].tsx — hold replyTo state, pass onReply into MessageThread and replyingTo into Composer, and clear it after a successful send.

**Database.** One migration: add `messages.reply_to_message_id` + index + a same-chat insert trigger, then `drop function if exists public.room_messages(...)` for every existing signature and recreate with three new OUT columns, re-stating `grant execute ... to anon, authenticated`.

**Tests.** New supabase/tests/database/31_reply_to.test.sql (pgTAP), written as attacks: inserting a message whose reply_to points at another chat's message is refused; a non-member reading a private group through room_messages gets nothing including the reply fields; a reply to an unsent parent comes back with reply_to_body null but the id intact. jest on the quoted-strip resolver (parent on page, off page, unsent). E2E: extend signed-in-tour to long-press, tap Reply, send, and re-shoot 24 with the quoted strip visible.

**Risk.** The migration is the risk: the drop-function-first rule bites for real here, because room_messages gains OUT columns and the deploy fails AFTER the earlier statements have applied if the drop is missed. Tap-to-scroll-to-the-parent and swipe-right-to-reply are deliberately NOT in this package — the first needs the same onScrollToIndexFailed work as the unread divider and should reuse it; the second is a gesture, and the menu item alone unblocks the room.

**After.** `chat-message-actions-do-the-job`

### `chat-one-storey-thread-header` — One header row per thread, with the group's own photo on it

**Priority** next · **Effort** M · **Ships as** over the air

Every conversation wears two storeys of chrome: an empty native nav bar carrying only a back chevron, then the app's own identity band underneath, starting at the left margin so nothing lines up with the chevron. Measured off screenshot 26 that is roughly 110pt above a mostly empty thread, and it breaks the association a messaging header depends on — back button, avatar and name are one object in every app people use. The room header has no avatar at all, which compounds the second half: the creation flow asks for a group photo, uploads it, and the person never sees it again. my_chats already returns it (20260828120000:117 selects g.photo_path for a room) and ChatRow at chat.tsx:328-345 throws it away for the house glyph, so screenshot 27a is three identical circles for three different groups.

<details><summary>Closes 2 audit findings</summary>

- Every thread wears a two-row header: an empty native nav bar carrying only the back chevron, then the app's own title band

- The group photo somebody uploads when starting a group is never shown in the inbox or the thread

</details>

**Changes**

- New src/features/chat/thread-header.tsx — one ThreadHeader: safe-area top padding, a back chevron calling router.back(), a 32pt avatar slot, title plus optional subtitle, and a trailing slot. The composition at src/app/chat/[id].tsx:183-243 is already right; this is that, one storey up, with a leading back button.

- src/app/\_layout.tsx:244-246, :265-267, :304-306 — set `headerShown: false` for room/[id], chat/[id] and group/[id]. The stack's swipe-back gesture stays on by default.

- src/app/chat/[id].tsx:367 and src/app/room/[id].tsx:181 — SafeAreaView edges go from ['bottom'] to ['top','bottom'], or the header sits under the notch.

- src/app/chat/[id].tsx:183-239 ChatHeader — render through ThreadHeader, keeping the existing avatar/place/verified logic and the ellipsis in the trailing slot.

- src/app/room/[id].tsx:183-245 — render through ThreadHeader with a 32pt avatar from `useChatPhotoUrl(group?.photo_path)` for a group (falling back to the house glyph) or the business cover for a venue room, the member-count line as the subtitle, and the (i) plus Leave in the trailing slot.

- src/app/group/[id].tsx — a ThreadHeader with back and the group's name, so the settings screen stops relying on a floating overlay chevron.

- src/app/(tabs)/chat.tsx:328-345 — add a RoomAvatar beside the existing Avatar/PlaceAvatar that signs `chat.photo_path` through useChatPhotoUrl when `isRoom && chat.photo_path != null`, falling back to the house glyph while it signs or when there is none. No migration: `chat_photos_select_group` (20260821100000:12-21) already lets any room member read a group photo, which is why group/[id].tsx:211 already works.

**Tests.** E2E is the test here: re-shoot 20, 21, 23, 24, 26, 27 and 27a and look at them. Add one jest render test that ThreadHeader renders exactly one back control with a unique accessibilityLabel, because two identical labels on a screen are ambiguous under VoiceOver. Also photograph the thread at the largest Dynamic Type setting before calling it done.

**Risk.** A header is a fixed composition and Dynamic Type is live everywhere: a 32pt avatar next to a title and subtitle at 200% is the classic clipped-header bug, so give the text column flexShrink and let the row grow rather than fixing its height. Second: this and chat-one-word-per-thing both edit room/[id].tsx's header region — land the words first, they are cheaper.

**After.** `chat-one-word-per-thing`

### `chat-group-page-mute-and-report` — Put Mute where people look for it, and give a group somewhere to be reported

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

Mute exists — src/app/(tabs)/chat.tsx:603 and :635 put it on the row's swipe and long-press — so the one place a person goes looking for "make this quiet" is the one place it is not. And there is no way to report a group at all: the whole reporting path is per-person, `reports.reported_user_id` is NOT NULL (20260816220000:105), and src/app/report.tsx:23 requires a userId, so a room that has gone bad has no exit that tells anybody. Two of the four claims in the original finding are false and are dropped: the screen DOES name the group, support rename, and show a member count and an end date — screenshot 27 is simply scrolled past that block.

<details><summary>Closes 1 audit findings</summary>

- Group settings never names the group, and cannot mute, rename or report it

</details>

**Changes**

- src/app/group/[id].tsx:308-357 — add a Mute row to the identity block, shaped like the existing 'No end date' radio at :445-491, calling the same `useChatPref()` mutation chat.tsx:604 uses. The current value needs the chat row: add `useMyChats()` and `useMyChats(true)` and find by chat_id, the pattern src/app/room/[id].tsx:72-77 already uses.

- New migration supabase/migrations/2026XXXXXXXXXX_report_a_group.sql — `alter table public.reports add column reported_chat_id uuid references public.chats(id) on delete cascade;`, `alter table public.reports alter column reported_user_id drop not null;`, and `add constraint reports_has_a_subject check (reported_user_id is not null or reported_chat_id is not null)`. Widen `reports_insert_own` so a chat report additionally requires `is_room_member(reported_chat_id) or is_chat_member(reported_chat_id)` — a report must not become a way to probe chats you are not in.

- src/features/chat/api.ts:152-168 reportUser — accept reportedChatId as an alternative subject and stop requiring reportedUserId.

- src/app/report.tsx:22-60 — accept a `chatId` param as an alternative to userId, branch the heading and the post-submit alert (there is nobody to 'block too' when the subject is a group), and keep the reason list unchanged.

- src/app/group/[id].tsx:594-611 — add 'Report this group' as a second destructive row beside 'Leave this group', pushing /report with chatId and `context: group:<id>`.

**Database.** One migration: add `reports.reported_chat_id`, drop the NOT NULL on `reported_user_id`, add a has-a-subject check, and widen the insert policy to require membership of the reported chat.

**Tests.** New supabase/tests/database/32_report_a_group.test.sql (pgTAP), as attacks: a report with neither subject is refused by the check; a user who is not a member of the reported chat is refused by the policy; a member's chat report inserts. jest on the api function's argument shaping. E2E: open group settings, tap Report this group, assert the reason list, re-shoot 27.

**Risk.** Relaxing a NOT NULL on the reports table touches the moderation pipeline: anything downstream that joins reported_user_id (the impersonation scan, the support email) must tolerate null, or a group report silently fails somewhere nobody is watching. Audit every reader of public.reports before shipping the migration.

**Waits on.** Should a group report also name a person, or can a report have no human subject? For: an unnamed group report is the only honest shape when the problem is the room itself. Against: every downstream moderation lever the app has acts on a person, so a subjectless report may have nothing behind it.

**Also widen when this lands.** Four published sentences were narrowed to name this gap and will be wrong once it closes: docs/legal/COMMUNITY_GUIDELINES.md (DSA Art. 16), its copy in web/guidelines/index.html, the Reporting paragraph in web/support/index.html, and docs/APP_STORE.md's review note 2, age-rating row and listing-copy SAFETY line.

### `chat-anyone-in-a-group-can-invite` — Let any member share the invite link, with the admin keeping the kill switch

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

Six people are in a city group. One meets a seventh in the hostel kitchen and cannot bring them in: src/app/group/[id].tsx:504 wraps the entire Invite section — QR, share and revoke — in `if (isAdmin)`, :218 never fetches a token for anyone else, and group_invite_token raises 'group not found' for a non-moderator (20260821010000:336-339). A travel group's membership grows by whoever is physically present, not by whoever founded it. The founder has already made the matching call once, in the add_to_group migration: "Any member may add, not only an admin. That is the founder's call and it matches how the invite link already behaves" — except the link does not behave that way.

<details><summary>Closes 1 audit findings</summary>

- Only the group admin can invite anyone

</details>

**Changes**

- New migration supabase/migrations/2026XXXXXXXXXX_who_can_invite.sql — `create type public.group_invites_who as enum ('everyone','admin');` and `alter table public.groups add column invites public.group_invites_who not null default 'everyone';`

- Same migration — `create or replace function public.group_invite_token(p_chat_id uuid)` (it returns text, so replace is correct and no drop is needed) with the guard widened to `is_room_moderator(p_chat_id) or (is_room_member(p_chat_id) and (select invites from public.groups where chat_id = p_chat_id) = 'everyone')`. revoke_group_invites stays moderator-only: the kill switch is the admin's, the same trust model WhatsApp uses.

- Same migration — `drop function if exists public.update_group(uuid, text, public.group_speaking, date, text, boolean, boolean);` then recreate with `p_invites public.group_invites_who default null` appended and re-state its grant. Adding a defaulted parameter otherwise creates a second overload and PostgREST calls by named argument, which does not save you (20260827170000:295-298).

- src/features/groups/api.ts and src/features/groups/hooks.ts:53-70 — thread `invites` through updateGroup; src/lib/database.types.ts gains the column on GroupRow and the parameter on the Args.

- src/app/group/[id].tsx:504-535 — move the Invite section out of the isAdmin branch and gate it on `isAdmin || group.invites === 'everyone'`; :218 becomes `useGroupInviteToken(id, canInvite)`. 'Turn off the current link' stays inside the isAdmin branch.

- src/app/group/[id].tsx:359-376 — add a 'Who can invite' Segmented for admins beside 'Who can post', reusing the shape of the speaking control, with a footnote saying what each option means.

**Database.** One migration: new `group_invites_who` enum, `groups.invites` defaulting to 'everyone', `create or replace` on group_invite_token, and a drop-then-recreate of update_group with the grant re-stated.

**Tests.** New supabase/tests/database/33_who_can_invite.test.sql (pgTAP): a plain member gets a token when invites='everyone'; the same member is refused when it is 'admin'; a non-member is refused in both states; revoke_group_invites refuses a member in both. Client-side, a jest test that the Invite section's visibility predicate matches the server's rule, so the two cannot drift.

**Risk.** Defaulting to 'everyone' widens who can mint a bearer token for every existing group on the day the migration lands. That is the founder's stated model for adding people, but it is a real change to live groups — the revoke path is the mitigation and must be verified working before this ships.

**Waits on.** Default 'everyone' or 'admin' for existing groups? For everyone: it matches the founder's recorded call on add_to_group and it is the growth loop the feature exists for. Against: it retroactively widens link-minting on groups whose admins chose them under the old rule.

### `chat-being-added-is-visible-and-refusable` — Say who added you to a group, and let a person opt out of being added

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

The whole architecture of this app is consent before exposure: first messages are moderated, socials are invisible until an accepted chat, a chat only opens when the other person answers. Group membership is the one place that grammar breaks. add_to_group (20260829130000:235-313) inserts straight into room_members with no invitation, no notification and no system message, and Leave is the only exit. It is not as bad as the audit says — the RPC enforces knows_traveler, is_blocked_pair, no business or guest accounts, and a memory of moderator removals — but there is no per-user control anywhere in src/app/visibility.tsx, and no way to know it happened until you open the tab.

<details><summary>Closes 1 audit findings</summary>

- "Add someone" puts a person into a group with strangers instantly, with no consent step and no way to refuse

</details>

**Changes**

- New migration supabase/migrations/2026XXXXXXXXXX_who_can_add_me.sql — `create type public.group_add_policy as enum ('known','link_only');` and `alter table public.profiles add column group_adds public.group_add_policy not null default 'known';` plus a `set_group_adds(p_policy public.group_add_policy)` definer function granted to authenticated only, mirroring set_visibility (20260823040000:116).

- Same migration — `create or replace function public.add_to_group(p_chat_id uuid, p_user_id uuid)` (returns jsonb, unchanged, so replace is correct) adding a check after the knows_traveler test: if the target's `group_adds = 'link_only'`, raise 'They only join groups by invite link.' Enforced in the RPC so it holds for any caller, not just this client.

- Same migration — `alter table public.room_members add column added_by uuid references public.users(id) on delete set null;` and set it in add_to_group's insert. Deliberately NOT a system message: a `messages` row would have to skip the first-message moderation trigger and widen the body constraint, which is a change to the one path §7 rule 5 protects.

- src/app/room/[id].tsx — when the reader's membership carries an `added_by` that is not themselves, show a one-time dismissible line above the composer naming who added them, with Leave one tap away. my_chats does not carry added_by, so read it from group_members (already fetched on the group screen) or add it there — group_members is a definer function returning a table, so that variant needs the drop-first treatment and re-stated grants.

- src/app/visibility.tsx — a second block under the audience picker: 'Who can add you to a group', with 'Anyone you have chatted with' and 'Only by invite link', calling the new setter. Say the consequence out loud the way the audience block already does.

**Database.** One migration: `group_add_policy` enum, `profiles.group_adds`, a `set_group_adds` setter, `room_members.added_by`, and a create-or-replace of add_to_group (return type unchanged, so no drop needed).

**Tests.** New supabase/tests/database/34_who_can_add_me.test.sql (pgTAP), as an attack: with the target set to 'link_only', add_to_group is refused even for somebody who genuinely shares a chat with them; with 'known' it succeeds; a caller who does not know the target is refused in both states. E2E: add the setting to the visibility flow and re-shoot 18b.

**Risk.** Do NOT build an accept-or-decline invitation for this. It is the heavier option, it duplicates the join-group flow, and once the setting exists there is nothing left for it to prevent. Second: the added_by banner needs the field on a row the room screen already has, or this quietly grows a second RPC signature change — check group_members before assuming.

**Waits on.** Is a per-user 'who can add me' setting worth a settings row, or is a visible, instantly reversible addition enough? For the setting: it is the only version matching the consent-before-exposure grammar the rest of the product keeps, and it is enforced in the DB. Against: it is a second privacy control on a screen that already has one, and the added_by banner alone fixes the surprise.

### `chat-inbox-search` — Search the inbox, reusing the field that already exists one screen away

**Priority** next · **Effort** S · **Ships as** over the air

There is no search in the inbox at all — `grep -c TextInput` returns 0 for src/app/(tabs)/chat.tsx — while src/app/add-people/[chatId].tsx:5 has one over a server-side ilike, one screen away. It bites once a traveler has a dozen rooms across three cities and wants "the Lisbon dorm one". The pattern is not missing from the codebase, only from the screen that needs it.

<details><summary>Closes 1 audit findings</summary>

- No search in the inbox or in a thread, though the Add someone modal one screen away has one

</details>

**Changes**

- New src/features/chat/search.ts — `filterChats(chats: ChatListRow[], query: string): ChatListRow[]`, case-insensitive over title, last_message and first_message, returning the input unchanged for an empty query.

- src/app/(tabs)/chat.tsx — a TextInput pinned under the Segmented in the signed-in branch, styled from add-people/[chatId].tsx's search row: opaque theme.surfaceSunken, never a glass surface, because a TextInput inside a UIVisualEffectView never receives the tap that would focus it (traps). Apply filterChats to `inTab` before the pinned/rest split, and clear the query when the tab changes.

- src/app/(tabs)/chat.tsx — the outer ScrollView must gain `keyboardShouldPersistTaps="always"`. It has none today, and a scroller with no setting claims the responder in the CAPTURE phase whenever a field has focus, so the first tap on a chat row would be eaten while the search field is active.

**Tests.** jest on filterChats in src/features/chat/**tests**/search.test.ts (matches title, matches a preview, empty query is identity, no match returns empty). E2E: type into the field and assert the exact remaining row title, then a screenshot. Assert the words a human reads, not a wildcard.

**Risk.** The keyboardShouldPersistTaps change is the whole risk and the reason this is not a one-line package: getting it wrong reproduces the exact bug that stopped the reaction menu opening for weeks. In-thread search is deliberately out of scope — it needs a server-side ilike RPC scoped to one chat plus a result-jump, and the jump should share the scroll-to-index work from the unread divider rather than inventing a second one.

**After.** `chat-unread-divider`

### `chat-business-room-has-a-next-action` — Replace "0 people here" with the thing a business owner can actually do

**Priority** next · **Effort** M · **Ships as** over the air

After twelve screens and an email round trip, the owner's Chat tab reads "Your room / Maestro Cafe / 0 people here" over "Travelers who find you on the map can write to you here." (src/app/(tabs)/chat.tsx:1077-1085). That sentence is the whole of a business's growth strategy and it is entirely passive: no share sheet, no link, no QR for the noticeboard. The app's only Share call in the entire codebase is the group invite at src/app/group/[id].tsx:293. A hostel with a hundred travelers through reception has no way to point any of them at the listing, which is exactly the liquidity the launch-dense strategy depends on. The machinery exists and only needs pointing at a business: app.json:8 declares the scheme, group/[id].tsx:40 builds a URL, and src/features/groups/invite-qr.tsx renders a scannable square.

<details><summary>Closes 1 audit findings</summary>

- A newly live business lands on "0 people here" with nothing to do and nothing to send

</details>

**Changes**

- New src/features/share/share-link.tsx — lift InviteQr and the share-sheet call out of the groups feature into one component taking a url, a title and a message, rendering the QR and a Share button. src/features/groups/invite-qr.tsx becomes a thin caller so the group flow is unchanged.

- src/app/(tabs)/chat.tsx:1077-1085 — for a business, replace the passive sentence with what the room is for plus the action that fills it: 'Your chat opens when a traveler writes to you.' and a 'Share your listing' button mounting ShareLink with a `/place/<id>` deep link. Check the string against the design brief's banned vocabulary first — 'place' must not appear in anything a reader sees.

- src/app/(tabs)/chat.tsx:314-323 — the room preview line for a business's own room reads '0 people here'; make it the invitation rather than the count when member_count is 0.

- src/app/room/[id].tsx:448-457 — the business owner's empty room takes the same treatment: the non-group branch currently says 'Nothing here yet.' over 'Go first. One line is plenty.', which is advice to talk to yourself in a room you run.

**Tests.** jest that ShareLink builds the same URL shape the group invite already produces (one builder, two callers). E2E: the business tour already reaches this screen — re-shoot `72-business-chat` and read it. The QR itself is only provable by pointing a camera at it, so that is a manual check and should be recorded as one.

**Risk.** The my-business dock and the place page are where the owner will look second, and those two files belong to the business subsystem. This package deliberately changes only the chat surfaces plus the shared component; if the business plan does not mount ShareLink on those two screens the feature is half-built and the founder will find the seam — coordinate before starting. Second: a samewhere:// place link has the same camera problem as the group QR, so the https decision is what makes either square work for a stranger.

**After.** `chat-getting-a-second-person-in`

### `chat-who-reacted` — Show who reacted, in rooms and groups only

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

In a one-to-one chat a bare pill is correct — there is only one other person it could be — and it should stay exactly as it is. In a twelve-person hostel room a 🔥 on "rooftop at 9?" is the cheapest possible RSVP and it carries no signal: is that one person or seven, and is it anybody they have met. One correction: the COUNT already exists — message-thread.tsx:202-206 prints it whenever more than one person has used the emoji, and screenshot 26 shows a bare heart because that reaction has exactly one reactor. What is missing is the identities, and ReactionSummaryRow carries none, so this is a database change and not a UI change.

<details><summary>Closes 1 audit findings</summary>

- A reaction in a group says nothing about who reacted

</details>

**Changes**

- New migration supabase/migrations/2026XXXXXXXXXX_who_reacted.sql — `create function public.message_reactors(p_message_id uuid) returns table (user_id uuid, display_name text, photo_path text, emoji text)`, security definer, gated on the caller being a member or moderator of the message's chat. A NEW function, so no drop is needed. `grant execute ... to authenticated` only, never anon: a signed-out visitor reading a public business room must not be able to enumerate who is in it.

- src/lib/database.types.ts — add ReactorRow and the RPC entry.

- src/features/rooms/api.ts and hooks.ts — fetchReactors / useReactors, enabled only when a message id is set.

- src/features/chat/message-thread.tsx Reactions:161-211 — a new optional `onOpenReactors?: (messageId: string, emoji: string) => void` wired to the chip's onLongPress, leaving the tap as the toggle, which is the iMessage grammar and must not change.

- src/app/room/[id].tsx — pass onOpenReactors and present the list in a `<Sheet>` from src/components/ui/sheet.tsx. src/app/chat/[id].tsx passes nothing, so a one-to-one thread is untouched.

**Database.** One migration adding a new `message_reactors(uuid)` definer function granted to authenticated only. No drop-function requirement: it does not exist yet.

**Tests.** New supabase/tests/database/35_who_reacted.test.sql (pgTAP), as an attack: anon gets nothing; an authenticated non-member of a private group gets nothing for a message in it; a member gets the rows. jest on the hook's enabled predicate. E2E: react in the group tour, long-press the chip, assert the reactor's exact name, screenshot.

**Risk.** iOS silently drops a modal presentation that starts while another is dismissing, and on Fabric that kills touch for the whole app until relaunch (traps). This sheet opens from the thread, not from inside the message menu, so there is no collision — but if anyone later wires it from the menu it must go through leavingSheet / SHEET_SETTLE_MS. Register it with useRegisterNativeModal either way, as the message menu already does at message-thread.tsx:876.

### `chat-one-locale-for-dates` — One LOCALE constant, and every date formatter takes it

**Priority** later · **Effort** M · **Ships as** over the air

Two date engines run side by side. Thirteen call sites hardcode 'en' and four pass undefined (the device locale), so on any phone not set to English the same screen renders both conventions at once: the trip calendar's month header reads 'agosto 2026' while the summary under it reads 'Aug 30 – Sep 2', and the chat list's row timestamp is English while the 'you leave' line beneath it is the device's. It reads as a half-finished translation, which is worse than being uniformly English — uniformly English is a product decision, this looks like a bug.

<details><summary>Closes 1 audit findings</summary>

- Two date engines run side by side, so a non-English phone shows two languages on one screen

</details>

**Changes**

- New src/lib/locale.ts — one exported LOCALE, sourced once from expo-localization's `getLocales()[0].languageTag` (already a dependency, package.json:26) or pinned to 'en', whichever the founder chooses. Nothing else in the app may name a locale.

- src/features/chat/separators.ts:6, :7, :50, :51 — the four formatters take LOCALE.

- src/app/room/[id].tsx:271 and src/app/(tabs)/chat.tsx:319 — the two `toLocaleDateString(undefined, ...)` calls take LOCALE.

- src/features/groups/closing.ts:47 — the `Intl.DateTimeFormat(undefined, ...)` takes LOCALE.

- The remaining nine sites (src/features/trips/dates.ts:29-30, trip-calendar.tsx:87 and :138, src/features/pins/pin-helpers.ts:43 and :232, map-filter-sheet.tsx:113, src/app/place/[id].tsx:49, my-business.tsx:43, \_layout.tsx:96) are one line each and belong to other subsystems; they must land in the same release or the screen still shows two conventions.

**Tests.** jest with the locale forced both ways, asserting separators.ts and trips/dates.ts produce the same language for the same input. A lint-style test that greps src/ for `Intl.DateTimeFormat(` and `toLocaleDateString(` and fails on any argument that is not LOCALE — that is the only thing keeping the fourteenth call site from appearing.

**Risk.** If LOCALE becomes the device locale, every date string changes width overnight and some get much longer (German month names, Japanese ordering), so every fixed-width or fixed-height date container has to be re-photographed, not just typechecked. If LOCALE is pinned to 'en', the four device-locale sites become visibly less localised than today, which somebody will report — so the decision must be made before the sweep, not during it.

**Waits on.** Device locale or English everywhere? For device locale: month names, number formats and date order localise for free with no translation work, on an app whose users are by definition abroad. For English: the rest of the copy is English, and a Portuguese date inside an English sentence is its own kind of half-finished.

**After.** `chat-one-word-per-thing`

### `chat-send-a-pin-into-a-conversation` — Attach a pin to a message, and let anyone in the thread join it

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

The product's whole sentence is "I want to go to X on Y", and the natural next message after two people agree is the pin itself. There is no way to send it: ComposerDraft is exactly `{ text, photoUri }` (composer.tsx:12) and PhotoButton is the only attachment control. anchors.ts:49-51 already parses a `pin:` anchor, so a pin can START a conversation and never enter one. Worse, the group chat — the surface most likely to produce an actual meetup — has no object in it that represents a plan, so a plan agreed in a room leaves no trace on the map and contributes nothing to the heatmap the product is differentiated by. This imports no dating grammar whatsoever: the object passed around is a place and a time, never a person.

<details><summary>Closes 1 audit findings</summary>

- The map and the chat never touch: you cannot send a pin into a conversation

</details>

**Changes**

- src/features/chat/composer.tsx:12 — ComposerDraft gains `pinId: string | null`, and the attachment row gains a second control beside PhotoButton opening a picker of the sender's own live pins.

- New src/features/chat/pin-card.tsx — the in-thread rendering: venue, category glyph, intent date, and a 'Join this plan' action creating the tapper's own pin at the same venue and date. The join mode already exists (20260829120000_a_pin_anyone_can_join.sql; screenshot 15b).

- src/features/chat/message-thread.tsx BubbleBody — render the card when the message carries a pin, above or in place of the body.

- New migration — `alter table public.messages add column pin_id uuid references public.pins(id) on delete set null;` plus an insert check that the pin is the sender's own and still live, and the same drop-then-recreate on room_messages to surface it with the pin's venue and date joined (OUT columns change, so drop first and re-state grants).

**Database.** One migration: `messages.pin_id` with an own-and-live insert check, plus a drop-and-recreate of room_messages to join the pin's venue and date, grants re-stated.

**Tests.** pgTAP: a message cannot carry somebody else's pin; a pin past its 72-hour expiry comes back with its fields nulled rather than readable, because §7 rule 3 says an expired pin is unreadable and a chat must not become a way around that. jest on the card's date formatting. E2E: send a pin in the group tour and screenshot the card.

**Risk.** §7 rule 3 is the live wire: an embedded pin must become unreadable at expiry like every other pin, so the RPC has to null it rather than the client hiding it. Second: this is the largest cross-subsystem package in the plan — it needs the pins feature's picker and join flow as much as the chat's composer — and it must not start until reply has landed, because both change the composer's contract.

**Waits on.** Is a shared pin a first-class object in a chat, or is a link to the map enough? For: highest-leverage borrow available, imports no dating grammar, and finally lets a plan agreed in a room reach the heatmap. Against: the biggest package here, touching the composer, the thread, the pins feature and a migration, when 'the rooftop at 9?' already works as a sentence.

**After.** `chat-reply-to-a-message`

### `chat-group-end-date-seeded-from-the-trip` — Preload "Pick a day" with the creator's trip end instead of thirty days

**Priority** later · **Effort** S · **Ships as** over the air

This is the cheap half of the group-expiry question and it is worth taking whichever way the founder answers the default. Today src/app/new-group.tsx:212 seeds the picker with `addDays(new Date(), 30)` — a number that means nothing to anybody. Seeding it with the end of the creator's current or next trip makes one tap produce the trip-shaped answer, which is the answer most groups actually want, without touching the recorded default or the comment at :169-171 that defends it.

<details><summary>Closes 1 audit findings</summary>

- Groups default to never expiring, in an app where everything else does

</details>

**Changes**

- src/app/new-group.tsx:205-214 — replace `addDays(new Date(), 30)` with the end of the creator's current or next trip from `useMyTrips()` (src/features/trips/hooks.ts:27), falling back to the thirty-day value when there is no trip.

- src/app/new-group.tsx:234 — when the seed comes from a trip, label the row with the city and date rather than a bare date, so it reads as an answer and not a guess.

- src/app/group/[id].tsx:195-200 pickerDay — the same seed, so the after-the-fact control and the creation control agree.

**Tests.** jest on a pure `seedEndDate(trips, today)` helper: a current trip returns its end, a future trip returns its end, no trips returns today+30, a past trip is ignored. The default itself does not change, so nothing else moves.

**Risk.** None to shipped behaviour: 'No end date' stays selected and stays the default, so this only changes what the OTHER option is prefilled with. If the founder later flips the default, this is the value it flips to, which is why it is worth having first.

**Waits on.** See the decision on whether the default itself should change. This package is the half that is right either way.

## Notifications, badges and re-engagement

Ten findings collapse into eight packages, and the shape of the subsystem is simple: the database side of push is finished and careful, and the phone side is missing. Every push Samewhere sends already carries a routing payload (`'type'` plus `'chat_id'`, written at 30+ call sites), and `src/features/notifications/push.ts` contains nothing that reads one: no `setNotificationHandler`, no response listener, no badge call, verified by a repo-wide grep that returns zero hits outside that file's four permission calls. So the first package is the unblocker for almost everything else, including the lifecycle work: a notification you cannot tap through is not worth scheduling. The second cluster is the one-shot primer, which is well built and correct as far as it goes but has no companion control, so a reflex tap on "Not now" is permanent and invisible; the fix is one Notifications row on both account pages reading the live OS state, not a second unprompted ask. The third is `join_pin_chat` (supabase/migrations/20260829190000_a_business_is_not_a_traveler.sql:196-203), which writes a `room_members` row and returns, producing no message, no unread dot and no push, so the map's hero payoff is silent on both sides. What the founder is really deciding here is three things: whether an app may ask about notifications twice, whether it may send anything beyond the "replies, hellos, and anything about your account, nothing else, ever" the primer promised in writing, and whether joining a plan writes a visible line into the plan's chat. The rest is work with no strategy in it. I am dropping nine items, mostly the between-trip half of the lifecycle proposal, which docs/PRODUCT_BRIEF.md:119 explicitly defers out of v1.

### `notif-tap-routing` — Make a tapped notification open the thing it is about

**Priority** now · **Effort** M · **Ships as** over the air + Supabase deploy

Every push the database sends carries a routing payload that nothing on the phone reads. Tapping "Ana: see you at 8" launches the app onto whatever tab you last left, so the single most common notification interaction in the product is a dead end. A message arriving while somebody is browsing the Map is completely silent, because expo-notifications presents nothing in the foreground without a handler and none is set. And because the response listener is also where a push open can be counted, the only mechanism the app has for causing a return is currently unmeasurable: there is no push_opened event anywhere, while the permission funnel is instrumented thoroughly (primer-store.ts:105-134).

<details><summary>Closes 2 audit findings</summary>

- Push notifications open the app and nothing else: no tap routing, no foreground display, no icon badge

- No push-open attribution, so the only retention lever cannot be tied to retention

</details>

**Changes**

- src/features/notifications/push.ts — add `Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) })` at module scope. Verify those four field names against the installed SDK 57 types before writing (AGENTS.md: never recall an API; `shouldShowAlert` was split into banner/list in a recent SDK and node_modules is not installed in this checkout). Also export `pushPermissionState(): Promise<'granted' | 'undetermined' | 'denied'>` wrapping `Notifications.getPermissionsAsync()`, which the settings row and the second-ask package both need.

- src/app/\_layout.tsx — import '@/features/notifications/push' at the top so the handler is installed on launch rather than whenever the tabs happen to pull it in through push-primer.tsx.

- src/features/notifications/use-notification-routing.ts (new) — `useNotificationRouting()`: read `getLastNotificationResponseAsync()` once on mount behind a ref (cold start), subscribe with `addNotificationResponseReceivedListener` and remove the subscription on unmount (warm), then switch on `data.type`. 'message' → `/room/{chat_id}` when `data.kind === 'room'`, else `/chat/{chat_id}`; 'accepted' → `/chat/{chat_id}` (always a direct chat); 'request' → `/(tabs)/chat`; 'moderation' → `/guidelines`; 'verification' → `/verification`; 'support' → `/contact`. Note the correction to the original proposal: 'verification' must go to `/verification`, which exists, not `/profile-me`, which has no verification content. Capture `push_opened` with `{ type, age_seconds }` derived from the notification's `date`, and `push_permission_state` with the result of `pushPermissionState()` on the cold-start pass.

- src/app/(tabs)/\_layout.tsx — call `useNotificationRouting()` inside a render-nothing component mounted beside PendingInviteHandoff. It needs a mounted stack and a live session for exactly the reasons that component documents at :14-21.

- supabase/migrations/20260831090000_a_push_knows_where_it_goes.sql (new) — `create or replace function public.enqueue_message_push()` only (a DROP would need CASCADE and would take the `messages_push` trigger with it, as 20260828140000_room_unsend_and_mute.sql:80-84 already records). Restate the body from 20260828140000:85-147 unchanged except both `jsonb_build_object('type','message','chat_id', new.chat_id)` calls, which gain `'kind'`: `'direct'` in the chat_participants arm and `'room'` in the room_members arm. Re-state the `revoke execute ... from public, anon, authenticated`. This removes the client's need to guess a chat's kind from a cache that may not have loaded yet; it mirrors exactly what src/app/(tabs)/chat.tsx:594 already switches on.

- src/lib/database.types.ts — add a `PushPayload` union type for the six `data.type` values so the routing switch is exhaustive rather than stringly typed.

**Database.** One migration, create-or-replace only on enqueue_message_push (never drop: the messages_push trigger depends on it). Re-state the revoke after the replace. No OUT columns change, so the drop-function-first rule does not bite here.

**Tests.** jest: src/features/notifications/**tests**/use-notification-routing.test.ts, mocking expo-notifications and expo-router — one case per payload type asserting the exact route pushed, plus a case where a 'message' payload with kind 'room' goes to /room and the same payload with kind 'direct' goes to /chat, plus a cold-start case where getLastNotificationResponseAsync fires once and not again on re-render. jest: a test that importing src/features/notifications/push.ts calls setNotificationHandler with shouldShowBanner true, so the foreground half cannot silently regress. pgTAP: extend supabase/tests/database/07_chat_realtime.test.sql with two assertions that a direct message enqueues data->>'kind' = 'direct' and a room message enqueues 'room'. Not E2E: remote push cannot be delivered to a simulator at all (pushPossible() returns false there), so a Maestro flow would photograph nothing.

**Risk.** The handler field names are the live risk — this SDK's expo-notifications is ~57.0.11 and the shouldShowAlert/shouldShowBanner split is recent, so a wrong key means the foreground half silently does nothing with no error. Read the installed types or the v57 docs first. The routing hook mounts under (tabs), so a notification tapped while signed out routes nowhere; that is correct, not a bug, but it means the cold-start read must run after the session resolves or the response is consumed and thrown away. Do not present anything modal from this hook: the traps skill's rule about presenting on a data event applies, and a router.push is not a Modal so it is safe as written.

### `notif-settings-row` — Add one Notifications row to both account pages, reading the live OS state

**Priority** now · **Effort** M · **Ships as** over the air

The primer is asked once, in good words, at an earned moment, and then never again: markOffered writes 'samewhere.push.primer.v1' before the OS dialog and nothing anywhere clears it. There is no notifications control anywhere in the app to undo that. profile-me.tsx has eight controls and none is about notifications; the business account page has five; my-business.tsx has one row under Your account. So the most common outcome of the ask is somebody who can never receive the messages the product exists to deliver and has no idea that is the state they are in. It is worse than missed replies: the primer's own promise covers "anything about your account", which is where a moderation removal or a suspension arrives.

<details><summary>Closes 3 audit findings</summary>

- Push is offered exactly once, ever, and no notification setting exists anywhere

- Declining the one-time push primer permanently silences every account and moderation notice

- The push permission is asked once, ever, and there is no way to say yes later

</details>

**Changes**

- src/features/notifications/notifications-row.tsx (new) — a `<NotificationsRow />` that reads `pushPermissionState()` from push.ts on mount, again on `useFocusEffect`, and again on an AppState change to 'active'. That third read is load-bearing: going to iOS Settings and coming back never changes navigator focus, so without it the row still says Off after the person has just turned it on. Three states, and they are not symmetric. `granted` renders "On. Hellos, replies, and anything about your account." with no action. `undetermined` renders a control that calls `enablePushNotifications()` directly — NOT Linking.openSettings(), because declining the primer never calls requestPermissionsAsync, so iOS holds no record of this app and shows no Samewhere entry under Settings, Notifications at all; sending somebody there would be sending them to a page that does not exist. `denied` renders "Off. Turn them on in Settings" with `Linking.openSettings()`, the same pattern src/app/verification.tsx:145-150 and src/app/business-storefront.tsx:257-264 already use for the camera. When `pushPossible()` is false the row renders nothing.

- src/app/profile-me.tsx — traveler branch: render <NotificationsRow /> inside the `actions` fragment between "Get verified" (:336-342) and "House rules and help" (:347-351). Business branch (BusinessAccount, :113-210): render it after "Manage your business" (:134-137) and before the rules card.

- src/app/(tabs)/my-business.tsx — add a second DetailRow inside the existing `<Section title="Your account">` (:699-712), under "Account and rules", label "Notifications", value driven by the same hook, `onPress` running the same three-state action. Extract the state read into `useNotificationPermission()` in notifications-row.tsx so the DetailRow and the PrimaryButton renderings share one source of truth.

- src/features/notifications/push.ts — `pushPermissionState()` lands here in notif-tap-routing; this package consumes it. If the packages ship out of order, add it here instead.

**Tests.** jest: src/features/notifications/**tests**/notifications-row.test.tsx with expo-notifications mocked — three renders asserting the exact sentence a person reads in each state, one asserting that the undetermined branch calls enablePushNotifications and never Linking.openSettings, one asserting the denied branch does the reverse, and one asserting the row renders null when pushPossible() is false. Do not loosen those to substring matches; the traps skill has a whole entry about that. E2E: re-shoot 18-profile-me.png in e2e/flows/signed-in-tour.yml and the my-business screenshot in business-tour.yml, and read the pictures. On a simulator pushPossible() is false, so the expected picture is the row absent, which is itself the assertion that the guard works.

**Risk.** The row must read the OS, never the AsyncStorage primer flag. The flag records that we asked; it says nothing about what iOS currently holds, so an owner who granted permission in Settings would be told they are off. Second risk: this row must not clear 'samewhere.push.primer.v1'. Clearing it after an OS-level denial would re-arm the primer sheet, and worthAsking (primer-store.ts:89-94) tests pushPermissionGranted(), which answers false for 'denied' and 'undetermined' alike, so the sheet would appear with a "Notify me" button that registers nothing. This contradicts one line of the verifier's note on the one-shot finding, and the code is why.

### `notif-presence-grammar` — Take the two present-tense presence claims out of the list subtitles

**Priority** now · **Effort** S · **Ships as** over the air

Two subtitles are written in the grammar of live location on a product whose strongest differentiator is that it never shows where anybody is. Both are technically defensible and both read as a position claim, which is the thing a privacy-conscious solo traveler would screenshot before deleting the app. It costs two lines and loses nothing: the liquidity signal, which is the point of both strings, survives the rewording.

<details><summary>Closes 1 audit findings</summary>

- Two list subtitles read as present-tense presence on a product that promises it never shows where anyone is

</details>

**Changes**

- src/app/(tabs)/travelers.tsx:131-134 — keep the existing two-arm conditional and change only the present-tense arm from `In ${featured.city_name} right now` to `In ${featured.city_name} this week`. The correction to the finding: this is inside GuestTravelers (opens at :69), so it is the signed-out teaser only. There is no signed-in variant to change; the signed-in row already renders a shared date window, which screenshot 17-travelers-signed-in.png shows.

- src/app/(tabs)/chat.tsx:515 — `${countOf(room.member_count, 'guest')} here now` becomes `${countOf(room.member_count, 'guest')} staying`. "Checked in" was the other candidate and is worse: it reads as a live presence claim, which is the thing being removed.

**Tests.** E2E screenshots, which is the only thing that answers "does it read right": re-shoot 03-travelers-guest.png (guest-tour.yml) and 27a-chat-list-with-a-row.png (signed-in-tour.yml) and read them. If any Maestro assertion currently matches the old text, update it to the exact new sentence rather than widening it.

**Risk.** Almost none. The only thing to watch is that the two-arm conditional at travelers.tsx:126-134 stays: it was tightened once already because the founder's own test profile appeared under a flat "right now" with a trip starting five days later, and collapsing it back to one string would re-open that.

### `notif-plan-join-is-felt` — Make joining somebody's plan produce a line in the chat and a push to the host

**Priority** now · **Effort** L · **Ships as** over the air + Supabase deploy

The map is the hero and "anyone can join" is its payoff. Today `join_pin_chat` inserts a room_members row and returns a chat_id. It queues no push, and because it writes no message row the existing enqueue_message_push trigger never fires either, so unread_count stays zero and the chat row gets no dot. The host learns three people are coming only by opening the app and re-reading the Groups list, inside a window where the whole premise is that the plan is tonight. It punishes the joiner too: the Join tap produces no visible consequence anywhere in the app.

<details><summary>Closes 1 audit findings</summary>

- Joining somebody's plan produces no push, no badge and no dot: the hero loop is silent

</details>

**Changes**

- supabase/migrations/20260831100000_a_join_is_felt.sql (new), part 1 — `create type public.message_kind as enum ('said','joined')` and `alter table public.messages add column kind public.message_kind not null default 'said'`. A `kind` column rather than a plain body row: `messages` has no system concept today (id, chat_id, sender_id NOT NULL, body, image_path, moderation_status, removed_at, removed_by, unsent_at, created_at), so inserting "Ana is in" as an ordinary message would render as a bubble Ana appears to have typed, which is a lie in a thread the design brief says must follow iMessage conventions exactly.

- same migration, part 2 — `drop function if exists public.room_messages(uuid, int)` then recreate it from 20260828140000_room_unsend_and_mute.sql:35-73 with `kind` added to the RETURNS TABLE and the select list, then `grant execute on function public.room_messages(uuid, int) to anon, authenticated`. This is the AGENTS.md trap verbatim: adding an OUT column to a RETURNS TABLE cannot be done with create-or-replace, and the drop takes the grant with it.

- same migration, part 3 — `create or replace function public.join_pin_chat(p_pin_id uuid)` restating the whole body from 20260829190000_a_business_is_not_a_traveler.sql:132-204 unchanged up to and including the room_members upsert, then adding, guarded by `not exists (select 1 from public.messages where chat_id = v_chat and sender_id = v_user and kind = 'joined')` so a leave-and-rejoin does not post a second line: `insert into public.messages (chat_id, sender_id, body, kind, moderation_status) values (v_chat, v_user, coalesce((select display_name from public.profiles where user_id = v_user), 'Somebody') || ' is in', 'joined', 'approved')`.

- same migration, part 4 — `create or replace function public.enqueue_message_push()` (create-or-replace ONLY; the messages_push trigger depends on it) restating 20260828140000:85-147 with a branch at the very top: when `new.kind = 'joined'`, insert exactly one push_queue row addressed to `groups.created_by` for this chat, title = the plan's venue name from `pins` via `groups.pin_id`, body = the message body plus the going count, data = `jsonb_build_object('type','message','kind','room','chat_id', new.chat_id)`, and only while `(select count(*) from public.messages where chat_id = new.chat_id and kind = 'joined') <= 5`; honour `chat_prefs.muted` for the host exactly as the existing arms do; then `return new` without falling through to the fan-out. This is where the cap has to live, not in join_pin_chat, because the fan-out is what would otherwise machine-gun a popular plan. Re-state the revoke after the replace.

- src/lib/database.types.ts — add `kind: 'said' | 'joined'` to RoomMessageRow (:390-405) and optionally to MessageRow (:571-586; direct chats read the table with `select *`, so the column arrives whether or not it is typed).

- src/features/chat/message-thread.tsx — add an optional `systemFor?: (message) => string | null` prop beside the existing `noteFor` (:813, :863, :942). When it returns a string, render a centred caption row instead of a Bubble, suppress the author line above it, and leave `reactable` false. The `note` path at :976-982 is the pattern to copy; it renders left-aligned in a theirs-row, which is wrong for a join line that belongs to nobody.

- src/app/room/[id].tsx — pass `systemFor={(m) => (byId.get(m.id)?.kind === 'joined' ? m.body : null)}` beside the existing noteFor at :373.

**Database.** supabase/migrations/20260831100000_a_join_is_felt.sql: new message_kind enum, messages.kind column, DROP-then-recreate room_messages(uuid,int) with the grant restated, create-or-replace join_pin_chat and enqueue_message_push with their revokes restated. The drop-function-first rule applies to room_messages and must not be applied to enqueue_message_push, whose trigger would go with it.

**Tests.** pgTAP: supabase/tests/database/30_a_join_is_felt.test.sql. Assert that join_pin_chat writes exactly one messages row with kind 'joined'; that the pin owner's my_chats().unread_count for that chat goes from 0 to 1 while the joiner's own stays 0 (unread_count filters sender_id <> auth.uid(), 20260830000000:536-548); that exactly one push_queue row is queued and it is addressed to the host, not to every member; that the sixth join queues none; that a host with chat_prefs.muted true gets none; that leaving and rejoining does not post a second line; and that an ordinary message posted into the same room after five joins still fans out normally, which is the regression the branch could cause. jest: extend src/features/chat/**tests**/message-thread.test.tsx with a systemFor case asserting the exact sentence renders and no bubble and no author line does. E2E: re-shoot the room screenshot in signed-in-tour.yml after a seeded join so the line is looked at rather than asserted.

**Risk.** The room_messages signature change is the classic deploy-halfway failure if the drop is forgotten, and the grant must be restated after it. The enqueue_message_push branch is the other one: an early return that is written slightly wrong suppresses ordinary chat pushes for the whole room, which is a silent regression of the feature this subsystem exists to protect, hence the pgTAP assertion that a normal message still fans out. A join line also becomes the chat list's last_message preview, which is desirable but will change 27a-chat-list-with-a-row.png. Nothing here touches pin lifetime, discovery visibility or handle gating, so no hard rule is in play.

**Waits on.** Does joining a plan write a visible line into the plan's chat, or should the join stay silent in the thread and only ring the host's phone? For: a thread that says who arrived is how every group messaging app people already use behaves, it earns the unread dot through machinery that already exists, and it gives the joiner proof the tap did something. Against: it is a new column on `messages` plus a signature change to room_messages plus a rendering path, where a push-only fix would be one insert into push_queue and no schema change at all.

**After.** `notif-tap-routing`

### `notif-icon-badge` — Put a real number on the home-screen icon, and clear it when the thread is read

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

The worker never sends a `badge` value and the client never calls setBadgeCountAsync, so the home-screen count is permanently zero. A traveler who swipes away a banner in a noisy hostel has no trace that a hello is waiting, and an unanswered hello looks to the sender like a decline, which is exactly the signal hard rule 4's no-decline-notification design exists to suppress. This is a two-sided fix and neither side alone is worth much: the handler's shouldSetBadge only increments while the app is running, and a client-side write only takes effect the next time somebody opens the app.

<details><summary>Closes 1 audit findings</summary>

- Push notifications open the app and nothing else: no tap routing, no foreground display, no icon badge

</details>

**Changes**

- supabase/migrations/20260831110000_the_icon_carries_the_count.sql (new) — `create function public.waiting_counts(p_users uuid[]) returns table (user_id uuid, waiting int)`, security definer, mirroring src/features/chat/unread.ts:waitingTotal exactly: conversations where the recipient's unread_count > 0 and chat_prefs.muted is not true, plus their pending incoming message_requests. Reuse the unread expression from my_chats (20260830000000:535-549) rather than writing a second one. `revoke all on function public.waiting_counts(uuid[]) from public, anon, authenticated` and grant nothing to clients: it reads across users and would be a bulk unread-state leak if any client could call it. The service role reaches it through the function's own definer rights, the way push-worker already reaches push_queue.

- supabase/functions/push-worker/index.ts — after building `userIds` (:83) and before building `notifications` (:96-104), call `supabase.rpc('waiting_counts', { p_users: userIds })` once per batch and put the result in a Map, then add `badge: waitingByUser.get(item.user_id) ?? undefined` to the notification object at :97-103. Correction to the original proposal: no `badge` column on push_queue. A column would freeze the count at enqueue time, so a queue row drained a minute later would carry a stale number, and it would need populating at every one of the 30-odd enqueue sites. Computing once per drain batch is one extra round trip and is always current.

- src/features/notifications/badge.ts (new) — `useIconBadge(count: number)`: an effect calling `Notifications.setBadgeCountAsync(count)` whenever the value changes, no-op when `pushPossible()` is false.

- src/components/app-tabs.tsx — call `useIconBadge(waiting)` next to the existing `const waiting = useWaitingCount()` (:29). One source of truth: the icon and the tab badge cannot disagree, and useWaitingCount already refetches through React Query on focus and on the invalidations useMarkChatRead fires.

- src/features/auth/api.ts — clear the badge to 0 in signOut, so a shared device does not carry the previous account's count.

**Database.** supabase/migrations/20260831110000_the_icon_carries_the_count.sql: one new definer function, revoked from every client role. No signature changes to existing functions, so no drop-first requirement.

**Tests.** pgTAP: supabase/tests/database/31_the_icon_carries_the_count.test.sql. Assert waiting_counts returns the same number as counting my_chats() rows with unread_count > 0 and muted false plus pending message_requests, for a user with a mix of muted, unmuted, read and unread chats; assert a muted chat with unread messages is excluded; and assert `authenticated` cannot execute the function at all, written as an attack (throws_ok on a set role authenticated call). jest: extend src/features/chat/**tests** with a parity test that waitingTotal and the SQL's stated rule agree on the same fixture shape, and a test that useIconBadge does not call setBadgeCountAsync when pushPossible() is false.

**Risk.** Two definitions of "waiting" that can drift apart, which is why the pgTAP test asserts the SQL against my_chats rather than against a hand-written expectation. The other risk is the grant: waiting_counts reads other users' unread state, so a stray `grant execute ... to authenticated` turns it into a bulk enumeration of who has unread messages, which is exactly the enumerability failure the change-review skill warns about. Assert the refusal, do not just avoid the grant.

**After.** `notif-tap-routing`

### `notif-second-ask` — Let the primer ask a second time, at the moment somebody says hi to you

**Priority** next · **Effort** M · **Ships as** over the air

Both primer reasons are outbound: you sent a hello, or you posted a pin. Stamping onboarding_completed_at is what makes a person discoverable, so somebody who finishes signup and then just browses for a week is never asked about push at all. The highest-value notification this product has, somebody said hi to you, is discoverable only by opening the app and looking. The code already solved this shape of problem on the other side: askBusiness('listing-live') exists precisely because a business does neither traveler thing. The traveler equivalent is not a third moment invented at signup, it is the first inbound hello.

<details><summary>Closes 2 audit findings</summary>

- A new traveler becomes discoverable at step 13 and is never offered notifications, so the first hello lands in silence

- The push permission is asked once, ever, and there is no way to say yes later

</details>

**Changes**

- src/features/notifications/primer-store.ts — replace the single `const KEY = 'samewhere.push.primer.v1'` (:11) with a per-reason key, `samewhere.push.primer.v2.<reason>`, and add a lifetime cap constant of two asks read from a second key that counts them. worthAsking (:89-94) gains two clauses: refuse when the count has reached the cap, and refuse when `pushPermissionState()` returns 'denied'. That second clause is the one the current code cannot express: pushPermissionGranted() answers false for 'not yet' and for 'the OS has already been told no' alike, so without it a re-armed sheet would offer a "Notify me" button that calls requestPermissionsAsync, gets 'denied' back instantly and registers nothing. Keep the existing doc comment's reasoning and extend it rather than deleting it.

- src/features/notifications/primer-store.ts — add `'hello-received'` to `PrimerReason` (:14).

- src/features/notifications/push-primer.tsx — add the COPY entry for 'hello-received' beside the two at :23-32. Title "Somebody said hi", body "Want your phone to tell you next time? Hellos, replies, and anything about your account. Nothing else, ever." Same register as the other two, same promise, no banned words.

- src/features/notifications/use-hello-received-primer.ts (new) — watches `useIncomingRequests()` (src/features/matching/hooks.ts:147-158) and calls `usePushPrimer.getState().ask('hello-received')` the first time it returns a non-empty list in a session. Deliberately not an onSuccess inside the query: the ask must not fire on a background refetch that returns the same hello over and over.

- src/app/(tabs)/\_layout.tsx — mount it in the same render-nothing component as the routing hook. The PushPrimer sheet already handles the presentation risk (focused, no native modal registered, SHEET_SETTLE_MS), which is exactly the guard the traps skill demands for anything presenting a modal on a data event; do not add a second presentation path.

- src/features/notifications/**tests**/primer-store.test.ts — the existing 'never asks a second time, whichever way the first went' case (:57-64) encodes the old rule and must be rewritten, not deleted: it becomes 'asks at most twice, and never for the same reason twice', plus a new case that it never asks once the OS has said no.

**Tests.** jest, in the existing primer-store.test.ts: a second reason gets its own offer after the first was declined; the same reason never gets a second; a third reason is refused once the cap is spent; nothing is asked when pushPermissionState() is 'denied'; nothing is asked when pushPossible() is false (already covered, keep it). jest for use-hello-received-primer: the ask fires once on the first non-empty inbox and not again on a refetch returning the same rows. The E2E suite cannot photograph this (pushPossible() is false on a simulator), and that is fine.

**Risk.** This is the package that changes a written rule, so it must not overshoot: two asks, ever, keyed per reason, with the settings row as the always-available third path. The migration of the AsyncStorage key from v1 to v2 means every existing device becomes un-asked once; on a pre-launch app with no users that is free, and after launch it would be a one-time re-ask of everybody, which is worth knowing before shipping it late.

**Waits on.** May the app ask about notifications a second time? For: the one ask is spent on an outbound moment, so the person most likely to benefit, somebody who has been written to and has not seen it, is never asked at all, and a per-reason key with a cap of two is not nagging. Against: the code comment at primer-store.ts:44-46 states the opposite rule in the founder's own terms, and every second ask is a chance to teach a reflexive decline.

**After.** `notif-settings-row`

### `notif-trip-clocks` — Three within-trip clocks: trip starts tomorrow, your plan is soon, last call

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

Nothing in this app ever brings a person back. All thirteen cron jobs are janitorial or content jobs and not one writes push_queue; every push-writing function is a reaction to another person typing or to moderation. A traveler lands in Bangkok with a trip already posted and the app does not mention it. A pin dies at midnight with two people in it and nobody is told. The three clocks below are the part of that which is genuinely in scope: they fire inside a trip window, which is the retention metric the brief actually names at PRODUCT_BRIEF.md:230, and each one arrives at a moment when the app is about to be useful rather than as a reminder that it exists.

<details><summary>Closes 1 audit findings</summary>

- No lifecycle notifications exist, in a product whose stated killer is churn between trips

</details>

**Changes**

- supabase/migrations/20260901090000_three_clocks_inside_a_trip.sql (new), part 1 — `create table public.notification_prefs (user_id uuid primary key references public.users(id) on delete cascade, chat boolean not null default true, trip_clocks boolean not null default true, created_at timestamptz not null default now())`, RLS on, select and update policies scoped to auth.uid(), insert scoped the same way. Every clock below reads it. Chat and account pushes must never consult `trip_clocks`.

- same migration, part 2 — `public.push_trip_starts_tomorrow()`, scheduled `cron.schedule('trip-starts-tomorrow', '0 * * * *', ...)` and firing for trips whose start_date is tomorrow in the city's own clock. Approximate that clock from `cities.lng` the way src/features/business/vocabulary.ts:cityNow already does for opening hours: local hour is utc hour plus round(lng/15). Body carries the overlap count only when it is at least `launch_cities.heat_k` for that city (default 3, 20260816210000:24); below that, send the same push with no number in it. That floor is the heat-cell rule applied to a sentence: a push must never disclose a city population the map itself would refuse to render. data = `jsonb_build_object('type','trip', 'city_id', ...)`, routed to /(tabs)/travelers by the routing hook.

- same migration, part 3 — `public.push_plan_is_soon()`, hourly, for joinable pins whose intent_date is today and whose local evening is about three hours away, only when at least one other person has joined. Reads `groups.pin_id` and counts room_members. data = `{'type':'message','kind':'room','chat_id':...}` so it lands in the plan's chat.

- same migration, part 4 — `public.push_last_call()`, hourly, four hours before `pins.expires_at`, only when joiners exist. Never send an expiry ping for a pin nobody joined: that is a notification whose content is that you failed. This is also where the "5 more people are in" digest belongs for a plan that went past the five-join push cap in notif-plan-join-is-felt, rather than as a second timer inside the trigger. It reads pins.expires_at and so is inside the 72 hour ceiling by construction; assert that rather than assume it.

- same migration, part 5 — three `cron.schedule` calls guarded by the same `pg_available_extensions` check every other scheduler in this repo uses (20260816210000:279-286), so the migration stays valid on the local rig and CI.

- src/features/notifications/use-notification-prefs.ts (new) and src/features/notifications/notifications-row.tsx — the Notifications row gains a second line, a toggle for the trip clocks, visible only when permission is granted. Copy says what the clocks are, in the primer's register.

- src/features/notifications/use-notification-routing.ts — add the 'trip' case, routing to /(tabs)/travelers.

- src/features/notifications/copy.ts (new) or inline in the migration — the three strings. "Bangkok tomorrow. 14 travelers are there on your dates." / "Sky Bar at 8. Three people are in." / "Your Sky Bar plan closes at midnight. Three people are in." No em dashes, no "request", no "match", no "place" meaning a business.

**Database.** supabase/migrations/20260901090000_three_clocks_inside_a_trip.sql: new notification_prefs table with RLS, three new functions, three cron schedules behind the pg_cron availability guard. No existing function signatures change.

**Tests.** pgTAP: supabase/tests/database/32_three_clocks_inside_a_trip.test.sql. Assert each function queues exactly one row per eligible user and none for an ineligible one; that a trip starting the day after tomorrow queues nothing; that a pin with no joiners queues no last call; that a user with notification_prefs.trip_clocks false gets none of the three while an ordinary message push to the same user still lands (the invariant that a digest opt-out never silences a conversation); and that the overlap count in the body is suppressed when it is below the city's heat_k, written as an attack on the k rule rather than a happy-path check. jest: the copy strings, asserted for the banned vocabulary the same way any user-facing string in this repo is reviewed.

**Risk.** Three risks. The city clock is a longitude approximation, so a push aimed at 18:00 local can land an hour either side; that is the same approximation the business hours line already ships with, and it is acceptable for an evening notification and would not be for a morning one. The k floor is easy to leave out of one of the three bodies and it is a hard-rule-adjacent disclosure, hence the pgTAP attack. And the whole package is worthless before notif-tap-routing lands: a "14 travelers are there on your dates" push that opens the Map is worse than no push.

**Waits on.** May the app send a notification that is not a reply, a hello, or an account notice? The primer's own words are "Replies, hellos, and anything about your account. Nothing else, ever." (push-primer.tsx:25-31), and these three clocks are none of those. For: they fire inside the trip window the brief names as the retention metric, each arrives at a moment the app is about to be useful, and every one is about the person's own trip or their own plan rather than about somebody else. Against: the promise was made in writing and is part of why people say yes, so breaking it is how a whole channel gets switched off, and the honest alternative is to change the primer copy first and accept a lower grant rate.

**After.** `notif-tap-routing`

### `notif-config-plugin` — Declare expo-notifications in app.json, with an icon that exists

**Priority** later · **Effort** S · **Ships as** EAS build

expo-notifications ~57.0.11 ships in the bundle and push.ts registers tokens with it, but app.json's plugins array has no entry for it, so nothing declares a notification icon, colour, sound or default channel. On iOS today the cost is small because the app icon is used. It becomes a real cost the moment the three trip clocks land and every push arrives styled by defaults nobody chose, and again at the Android release, where an undeclared icon renders as a grey square.

<details><summary>Closes 1 audit findings</summary>

- expo-notifications is installed but not configured in app.json

</details>

**Changes**

- assets/images/notification-icon.png (new) — must be created first. The directory holds android-icon-foreground, android-icon-monochrome, brand-mark, favicon, icon, logo-glow, splash-icon and tabIcons; there is no notification icon, so the config block as originally proposed would fail the build on a missing asset. 96x96, white on transparent, since Android tints it.

- app.json — add `["expo-notifications", { "icon": "./assets/images/notification-icon.png", "color": "#0E1020", "defaultChannel": "default" }]` to the plugins array (:29-60). #0E1020 is right and already matches the splash backgroundColor. Verify the option names against the SDK 57 expo-notifications config-plugin docs before committing rather than recalling them.

- Verification step, not a file: establish whether the iOS `aps-environment` entitlement is being added by this plugin or by EAS credential detection on this project. A build where it is neither produces token registration that appears to succeed and never delivers, which is indistinguishable from every other bug in this subsystem.

**Tests.** There is no unit test for a config plugin. The evidence is a build: run one, install it on the phone, grant permission through the new Notifications row, send a message from a second account and confirm the banner arrives with the declared icon and colour. Record the EAS build id and the commit, per the change-review skill's rule that "published" without a run id is a guess.

**Risk.** This is the only package in the subsystem that costs an EAS build, and builds draw down real credit on the Starter plan. Do not spend one on this alone: batch it with the next native or config change that has to happen anyway (the invite-link associatedDomains work from the deep-link subsystem is the obvious partner, and app.json currently has no associatedDomains key at all). The other risk is shipping the plugin entry without the asset, which fails the build rather than failing quietly.

## Saying hi: the composer, moderation and connecting

Eleven findings collapse into ten packages, and the shape of the work is narrower than the count suggests: four are copy, three are the sender's record of what happened to their own words, two are the business side of the same composer, one is a picture nobody has ever taken. The through-line is that this subsystem is where the app's anti-creep thesis meets a stranger typing in a hostel, and every failure here is the app knowing something and not saying it. `screen_first_message` computes a category and throws it away. `apply_message_verdict` flips a row to blocked and the only trace is a push. `send_message_request` writes the same audit action for a regex hit as the LLM writes for a real verdict, and `apply_strike_policy` counts them forever, so three rewrites of "want to hook up at the night market" is a warning and five over a lifetime is a week's suspension for arranging a beer. What the founder is really deciding is two things. First: does a regex guess count against a person the same way a classifier verdict does, and do strikes decay? That is the only package with a policy question inside it, and it is recorded in ARCHITECTURE.md as designed rather than as reasoned. Second: is the prefilter's job to block or to warn, given `require_llm_moderation` is still false and the regex list is currently the only screen a first message gets. Everything else here is craft: one name for one act, a Close button on the app's most important modal, an error that says which kind of wrong, and four screenshots of the screen six of these findings are about.

### `hi-copy-the-database-ships` — Take the em dashes and the word "request" out of the copy Postgres sends

**Priority** now · **Effort** S · **Ships as** Supabase deploy only

Four live push notifications and sixteen curated map pins carry punctuation the brief bans, and two of the pushes also call a message a "request", which the design brief bans by name. The worst of them lands on a lock screen at the worst possible moment: right after somebody is told their first message was stopped. 20260821120000_moderation_copy.sql was written to strip the last of these and missed apply_message_verdict entirely, because it only redefined two of the three functions that carried the sentence. A lint step is the only reason the next copy pass will not miss one the same way.

<details><summary>Closes 1 audit findings</summary>

- Live push copy still contains an em dash, and so do fifteen seeded map pins

</details>

**Changes**

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql (new) — reissue `public.apply_message_verdict(uuid, jsonb)` verbatim from 20260820001000_copy_pass.sql:109-195 with the push body at :190 changed to 'Your message wasn''t delivered. It came across as explicit, so reword it and try again.' (returns void, so `create or replace` is correct here)

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql — reissue `public.enqueue_accept_push()` verbatim from 20260816220000_chat_realtime.sql:237-255 (never redefined since) with title 'Connected' and body 'Connected with ' || coalesce(v_name, 'a traveler') || '. Your chat is open.' — the exact phrase src/features/matching/connected-notice.tsx:72 already uses in the app, so the push and the in-app notice finally say the same thing

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql — reissue `public.enqueue_request_push()` verbatim from 20260817090000_trust_safety.sql:375-395 (the surviving definition) with title 'Somebody said hi' in place of 'New message request'; body unchanged

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql — reissue `public.throttle_messages()` from 20260817150000_launch_hardening.sql:27-41 with the raise message 'sending too fast, give it a moment'. Raised messages reach the user verbatim through the Alert in src/lib/query-client.ts:22-28, so this is user copy

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql — reissue `public.seed_launch_pins()` verbatim from 20260823020000_curated_pins_stay_current.sql:85-160 (the LIVE definition; 20260818010000 is superseded) with all sixteen em-dashed seed notes rewritten as two sentences, e.g. 'Open-air market under the bridge. Travelers meet at the main gate, 7pm.' Re-state `revoke all on function public.seed_launch_pins() from public, anon, authenticated;`

- supabase/migrations/20260830100000_the_app_never_writes_a_dash.sql — a DO block that deletes seeded pins whose seed_note still contains U+2014 and calls seed_launch_pins(), so the four launch cities are correct immediately rather than on the next daily sweep

- src/app/**tests**/copy-lint.test.ts (new) — read every file in supabase/migrations, strip `--` lines and `/* */` blocks, and fail on U+2014 inside a single-quoted literal that is not the payload of a `comment on` statement; also fail on the banned words (swipe, deck, match, and "request" meaning a message) inside push_queue insert literals and raise-exception literals

- supabase/migrations/.copy-lint-allow (new) — file:line allowlist for the historical strings a later migration has already replaced (20260818010000_seed_launch_content.sql:24-57, 20260817090000_trust_safety.sql:219/489/930, 20260816220000_chat_realtime.sql:250, 20260820001000_copy_pass.sql:190, 20260817150000_launch_hardening.sql:37, 20260823020000_curated_pins_stay_current.sql:34-67), so the gate polices new work without asking anyone to rewrite migration history

**Database.** One new migration, 20260830100000_the_app_never_writes_a_dash.sql. Five functions reissued with `create or replace`; all five return void, trigger or integer, so no OUT columns change and the drop-first rule does not apply. Re-state the seed_launch_pins revoke after the replace.

**Tests.** jest: the new copy-lint test fails on the current tree and passes after the migration. pgTAP: extend supabase/tests/database/08_trust_safety.test.sql (bump plan()) with an assertion that the push_queue row written by the LLM block path contains no U+2014; extend 07_chat_realtime.test.sql with the same assertion on the accept push plus `like 'Connected with%'`. Screenshots: none needed, none of this renders in-app.

**Risk.** Reissuing a function from an old file by hand is where a behaviour change sneaks in. Copy the body byte for byte and diff it before committing. seed_launch_pins is the one with teeth: the DO block deletes seeded pins, and if the replace has a typo the map is empty in all four launch cities until it is fixed. Run it against a branch database first and confirm the returned count is sixteen.

### `hi-one-name-for-one-act` — Retire "hello" as a countable noun from every string a person reads

**Priority** now · **Effort** S · **Ships as** over the air

"Hello" is internal jargon that leaked out of the code comments into five user-facing strings, two of which sit on the same screen and are already photographed in 15b-pin-join-mode.png: a traveler choosing how strangers reach them reads "No hello to answer" against "They send a hello and you decide". A non-native speaker cannot tell which of those is the safer choice, and that screen is exactly where the choice decides whether strangers can walk into your chat. The verb is "say hi" and the noun is "first message"; nothing else needs a name.

<details><summary>Closes 1 audit findings</summary>

- The app's core action has four names: "Say hi", "a hello", "Reply to...", and "Say you're in"

</details>

**Changes**

- src/features/pins/pin-form-sheet.tsx:362 — 'One tap and they are in a group chat with you. Nothing to accept.'

- src/features/pins/pin-form-sheet.tsx:368 — 'They send a first message and you decide, one person at a time.'

- src/app/message/[userId].tsx:58 — 'You are in a group together, so this goes straight through. Nothing to accept.'

- src/app/compose-request.tsx:255 — countOf(remaining, 'first message') in place of countOf(remaining, 'hello'); src/lib/plural.ts already pluralises it correctly

- src/app/compose-request.tsx:146 — 'More tomorrow. A few good ones beat a pile of forgettable ones.' (the cap screen currently says "hellos")

- src/features/notifications/push-primer.tsx:26 — 'Replies, first messages, and anything about your account. Nothing else, ever.'

- Leave every code comment and internal identifier alone (usePushPrimer's 'hello-sent' reason, chat.tsx's comments, the sent-hello row's function name). The jargon is fine where only the author reads it, and src/app/**tests**/business-home.test.ts:169 asserts the PrimerReason literal, so renaming it breaks a test for no user-visible gain

- Do NOT touch src/features/profile/profile-view.tsx:116. "Say you're in" is the VoiceOver label on the Top priorities chip only (the visible chip says "Reply" like every other section) and the comment at :114-115 records why: joining an existing plan is a different act from opening a first message

**Tests.** jest: a source-scan test in the shape of src/app/**tests**/step-flow.test.ts asserting that no JSX text or string literal under src/ outside comments contains the word 'hello' (case-insensitive, allowing the 'hello@' email placeholders in business-edit.tsx:650 and business-email.tsx:224 and the 'hello-sent' identifier). E2E: re-shoot 15b-pin-join-mode.png and 14-pin-form.png from the existing signed-in-tour steps and read them; those two frames are the only place these strings have ever been photographed.

**Risk.** Low. The only trap is the pin form's two detail strings sitting in a `as const` array (JOIN_MODES), so a stale snapshot or a Maestro assertion on the old text would fail — grep e2e/ for 'No hello' before pushing (there is currently no such assertion).

### `hi-a-way-out-and-a-reason` — Give the say-hi composer a Close button and a block notice that says which kind of wrong

**Priority** now · **Effort** M · **Ships as** over the air + Supabase deploy

compose-request is the only one of the three composers that never passes onClose to StepScreen, so the sole exit from the app's most important modal is the iOS sheet swipe: no announced control for VoiceOver, and a drag the multiline field and the ScrollView can swallow. Its two siblings both pass one. Separately, screen_first_message computes a category ('sexual' or 'flirtation') and every layer above throws it away, so a message caught by the flirtation patterns is told it "came across as explicit", which is simply not what the classifier said. The brief's own rule is that an error says what went wrong and what to do.

<details><summary>Closes 2 audit findings</summary>

- The say-hi composer is the only one of the three composers with no Close button

- The block notice cannot teach, because the reason is computed and then thrown away

</details>

**Changes**

- src/app/compose-request.tsx:178-186 — pass `onClose` mirroring src/app/message/[userId].tsx:62 (`router.canGoBack() ? router.back() : router.replace('/(tabs)')`); when `message.trim()` is non-empty, Alert.alert('Throw this away?', undefined, [Keep writing (cancel), Discard (destructive)]) first. Cancel the CONFIRM_MS timer in the same handler, the way the unmount effect at :74-81 already does

- src/app/compose-request.tsx:237-246 — add `testID="first-message-input"` to the FormTextField (it spreads into TextInput, same as message/[userId].tsx:66), so the E2E package can type into it

- src/features/matching/moderation-copy.ts (new) — a pure `blockedCopy(category: string | null): { title: string; body: string }` and `riskyCopy(category)`. 'flirtation' returns 'That reads as a come-on. Say what you would actually do together and it goes straight out.'; 'sexual' returns 'That reads as explicit. Reword it and it goes straight out.'; anything else keeps today's generic sentence. Never echoes the matched phrase — the blocklist is a table of regexes and naming the trigger hands out the evasion rule

- src/app/compose-request.tsx:260-280 and src/app/message-place.tsx:94-114 — render from blockedCopy/riskyCopy instead of the two hardcoded pairs; keep the highlight-vs-danger colour split as it is

- src/features/matching/hooks.ts:87-118 — useDraftWarning returns `{ risky: boolean; category: string | null }` instead of a bare boolean, keeping the derive-during-render trick (store `{ text, category }` rather than `text`)

- src/features/matching/api.ts:63-69 — previewFirstMessage returns `{ wouldBlock, category }`; preview_first_message already returns the category column, so no migration is needed on this path

- src/lib/database.types.ts:602-627 — add `category: string | null` to SendRequestResult, documented as null on every branch except blocked

- supabase/migrations/20260830110000_a_block_says_which_kind.sql (new) — reissue `public.send_message_request(uuid, request_source, text, text)` verbatim from 20260822235000_review_fixes.sql:195-352 with `'category', case when v_masked = 'blocked_by_moderation' then v_verdict ->> 'category' else null end` added to the returned jsonb; and reissue `public.message_business(uuid, text)` verbatim from 20260828160000_businesses_not_places.sql:56-137 adding the same key to both blocked returns. Both return jsonb, so `create or replace` is correct and no grants move

**Database.** 20260830110000_a_block_says_which_kind.sql. Two jsonb-returning functions reissued with an extra key. No RETURNS TABLE signature changes, so no drop-first. No new grants; the existing revoke/grant pair for message_business is unchanged.

**Tests.** jest unit: moderation-copy.test.ts over every category the blocklist can emit plus null, asserting no em dash, no banned word, and that the flirtation and sexual strings differ. jest source scan: compose-request.tsx passes onClose to StepScreen (same technique as step-flow.test.ts's attribute parser). pgTAP: extend supabase/tests/database/13_first_message_cap.test.sql with two assertions — send_message_request returns category 'flirtation' for a blocklist phrase in that class, and null on the delivered branch. Screenshot: the composer and its warning are photographed by hi-the-composer-gets-photographed.

**Risk.** The discard confirm is the piece most likely to annoy: it must not fire on an empty box, and it must not fire on the sent/capped screens (both return early before StepScreen renders, so check that path). Returning the category is safe — it is the sender's own message and preview_first_message already hands the same value to any authenticated caller — but do not extend it to the recipient side or to any other function's return.

### `hi-a-closed-business-says-so` — Tell a traveler writing to a closed business that the answer may wait

**Priority** now · **Effort** S · **Ships as** over the air

A message to a business goes through with no accept gate by design, so the owner gets every "do you have beds tonight" as a fresh conversation and the traveler has no idea when they will hear back. The app already knows the answer: openLine reads the business's own hours against the business's own clock, and place/[id].tsx:270 already calls it. One line above the composer sets the expectation with zero owner effort, which is the half of the owner-tooling problem that costs nothing.

<details><summary>Closes 1 audit findings</summary>

- An owner has no reply tools for the inbox the app exists to fill

</details>

**Changes**

- src/app/message-place.tsx:33 — call `useBusinessDetail(businessId)` unconditionally instead of only when params.name is missing. The query is already warm from place/[id].tsx in the ordinary path, so this is a cache read, and `name` keeps its params-first fallback

- src/features/business/vocabulary.ts — add `waitNote(hours, clock, lng): string | null` beside openLine (line 227): null when isOpenNow says open or unknown, otherwise a single sentence built from the same next-opening logic openLine already computes, e.g. 'Closed right now. They will probably answer when they open.' No em dash, no promise of a time the app cannot keep

- src/app/message-place.tsx — render the waitNote as a ThemedText type="small" themeColor="textSecondary" directly under the subtitle at :74, above the field. Above the composer rather than below it, because the point is to be read before five hundred characters are typed, not after

- src/app/message-place.tsx:74 — leave the existing subtitle alone; the two lines are different facts (where the reply lands, and when)

**Tests.** jest unit in src/features/business/**tests**/vocabulary.test.ts (which already has an openLine block at :80): waitNote returns null when open, null when the hours are unknown, and the sentence when closed, using the same fixed-clock helper the openLine tests use. Screenshot: optional; the signed-in tour has no message-a-business step and adding one is a bigger change than this package.

**Risk.** openLine returns null when it cannot be sure (isOpenNow == null), and waitNote must inherit that rather than defaulting to "closed" — a business with no hours filled in must say nothing at all, or every unclaimed-hours venue tells travelers it is shut.

### `hi-a-reword-is-not-a-strike` — Stop counting a regex guess as a strike, and let strikes decay

**Priority** next · **Effort** M · **Ships as** Supabase deploy only

Every prefilter block writes a moderation_event with action 'blocked'; is_strike_action counts 'blocked'; apply_strike_policy counts with no time window at all. So three attempts that all keep "hook up" is a guidelines warning, five over the life of an account is a seven-day suspension, and seven is a permanent ban, for trying to arrange a beer at the night market. The composer's own copy invites every one of those attempts ("Reword it and send again"). apply_message_verdict already draws exactly this distinction on the LLM side, excluding 'blocked_failsafe' from the ladder because the sender did nothing wrong; the prefilter path deserves the same treatment for the same reason.

<details><summary>Closes 1 audit findings</summary>

- Rewording a blocked message is a strike, and the app's own copy tells people to do it

</details>

**Changes**

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql (new) — reissue `public.send_message_request(...)` from the version this package's dependency produced, changing the audit action on the blocked branch from 'blocked' to 'prefilter_blocked'. Follow the precedent apply_message_verdict already sets with 'blocked_failsafe' vs 'llm_blocked' at 20260820001000_copy_pass.sql:180-183

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql — backfill: `update public.moderation_events set action = 'prefilter_blocked' where entity_type = 'message_request' and action = 'blocked' and source = 'prefilter-v1';`. moderation_events.action is free text with no check constraint (20260816190000_core_auth_profiles.sql:93), so no enum work

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql — leave `is_strike_action` alone. 'prefilter_blocked' is simply not in its list, which is the whole mechanism

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql — reissue `public.apply_strike_policy()` verbatim from 20260821120000_moderation_copy.sql:19-93 adding `and created_at > now() - interval '90 days'` to the count at :36-39. Trigger-returning, so create or replace is correct

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql — `create or replace view public.admin_report_queue` with the same 90-day predicate on the reported_user_strikes subquery (20260817090000_trust_safety.sql:885), so the queue and the ladder agree. Column list and order are unchanged, so replace is legal; re-state `revoke all on public.admin_report_queue from anon, authenticated;` after it

- supabase/migrations/20260830120000_a_reword_is_not_a_strike.sql — `create or replace view public.admin_moderation_stats` (20260817150000_launch_hardening.sql:470-482) adding 'prefilter_blocked' to the blocked filter, to blocked_prefilter, and to the attempts action list. Without this the creep metric silently loses every prefilter block the day the rename lands. Re-state its revoke too

- docs/ARCHITECTURE.md:238-241 — rewrite the strike-ladder bullet: name the four strike actions correctly (prefilter_blocked is not one), say the count is over ninety days, and record why a regex hit is not a strike

**Database.** 20260830120000_a_reword_is_not_a_strike.sql. One function reissue with an action rename, one data backfill, one trigger function reissue, two view replacements. Views keep identical column names and types so `create or replace view` is legal; both revokes must be re-stated after the replace. No RETURNS TABLE signature changes.

**Tests.** pgTAP in supabase/tests/database/08_trust_safety.test.sql (bump plan()): (a) a prefilter-blocked send writes action 'prefilter_blocked' and leaves the account's strike count unchanged; (b) six admin_strike rows dated 100 days ago plus one today leaves the user active — the ladder counts one, not seven; (c) admin_moderation_stats.blocked_prefilter still counts the prefilter block after the rename, so the creep metric did not quietly drop it. The existing assertion at :312-314 that counts strikes by action list needs its list updated in the same commit.

**Risk.** The backfill and the rename must land in one transaction or the ladder reads a mixed table mid-deploy. The real trap is the views: `create or replace view` silently keeps the OLD definition's privileges but a typo in the column list makes Postgres refuse the replace outright and the migration fails after the function reissue has already applied — put the view replacements FIRST in the file so a failure leaves nothing half-done. And if this migration is written before hi-a-way-out-and-a-reason lands, its copy of send_message_request will drop that package's `category` key; whichever ships second must carry both changes.

**Waits on.** Should strikes expire? ARCHITECTURE.md:238-241 records "strikes never expire in v1" as a design, and this package changes it to a ninety-day rolling window. For: a lifetime counter means an account banned in month eighteen for four bad nights spread over two years, and the ladder was written before the prefilter's false-positive rate was known. Against: a decaying counter lets a patient bad actor stay just under the line forever, and ninety days is a number nobody has evidence for.

**After.** `hi-a-way-out-and-a-reason`

### `hi-a-blocked-message-leaves-a-trace` — Keep a message the classifier stopped after sending, and let it be rewritten

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

With require_llm_moderation on, the composer says "Sent to Theo. You'll hear back in Chat if they answer" and the row appears under "You said hi". When the worker later returns a block, apply_message_verdict flips the status and the only signal is a push. chat.tsx:790 filters that section to state === 'sent', so on the next refetch the row silently disappears: the app confirmed a message, then deleted the record of it, and the unique (sender_id, recipient_id) constraint means the sender cannot write to that person again. This is the same instinct as failOptimistic in src/features/chat/outgoing.ts:98-112 — never destroy the only copy of what somebody wrote. The comment at chat.tsx:788-789 is right that a prefilter block is the sender's own doing and does not belong in a waiting list; it is wrong about the asynchronous one, which the sender was never told about, so the fix is to tell the two apart in the database rather than to show both.

<details><summary>Closes 2 audit findings</summary>

- A hello blocked after it was sent vanishes, with no in-app trace and no way to rewrite it

- The sent confirmation is 1100ms long and says nothing the sender needs to know

</details>

**Changes**

- supabase/migrations/20260830130000_a_blocked_hello_leaves_a_trace.sql (new) — `drop function public.sent_requests();` then recreate it (body from 20260816200000_trips_matching.sql:618-648) with one extra OUT column `blocked_after_send boolean`, computed as `status = 'blocked_by_moderation' and coalesce(moderation_verdict ->> 'engine', '') <> 'prefilter-v1'`. This is the OUT-column case AGENTS.md warns about, so it must be drop-first

- supabase/migrations/20260830130000_a_blocked_hello_leaves_a_trace.sql — re-state the privileges the drop destroys: `revoke execute on function public.sent_requests() from public, anon;` and `grant execute on function public.sent_requests() to authenticated;`. The original file only ever revoked (trips_matching.sql:728-734) and leaned on Supabase's default grant, which is precisely the trap 20260823020000_curated_pins_stay_current.sql:96-104 was written about

- src/lib/database.types.ts:452-461 — add `blocked_after_send: boolean` to SentRequestRow

- src/features/matching/sent-rows.ts (new) — pure `waitingRows(rows: SentRequestRow[])` returning rows where state === 'sent' or (state === 'blocked' and blocked_after_send), so the filter is testable without rendering the Chat tab

- src/app/(tabs)/chat.tsx:790 — call waitingRows instead of the inline filter, and update the comment at :788-789 to say what is now true

- src/app/(tabs)/chat.tsx:230-272 (SentHelloRow) — trailing label reads 'Not delivered' instead of 'Sent' when blocked_after_send; onPress routes to /compose-request with { userId: request.recipient_id, name, photoPath, source: request.source, element: request.profile_element, draft: request.first_message } instead of the profile. Update the accessibilityLabel and accessibilityHint to match ('Opens the message so you can rewrite it')

- src/app/(tabs)/chat.tsx:996-998 — under the 'You said hi' heading, one standing line: 'Waiting on an answer. You only hear back when somebody replies.' This is the durable half of the sent-confirmation finding and it belongs where a sender goes looking later, not in a card that lives 1100ms

- src/app/compose-request.tsx:60 — no change needed; params.draft already prefills the field, which is the whole reason the retry path is cheap

**Database.** 20260830130000_a_blocked_hello_leaves_a_trace.sql. `drop function public.sent_requests()` then create with the added OUT column, then the revoke and the grant, in that order. Nothing else in the schema references the function so the drop is safe without CASCADE.

**Tests.** pgTAP, new file supabase/tests/database/30_a_blocked_hello_leaves_a_trace.test.sql: (a) a message blocked by the prefilter comes back state 'blocked' with blocked_after_send false; (b) one blocked by apply_message_verdict with engine 'claude-moderator' comes back true; (c) one blocked with engine 'failsafe' also comes back true, since the sender was equally not told; (d) the recipient still cannot see any of them (the message_requests_select_recipient policy, re-asserted as an attack); (e) anon cannot execute sent_requests() after the recreate. jest unit on waitingRows in src/features/matching/**tests**/sent-rows.test.ts. No screenshot: the state cannot be produced in a tour without a live classifier verdict.

**Risk.** The drop-and-recreate is the whole risk, and it is the exact failure AGENTS.md names: if the grant is not re-stated the Chat tab returns permission denied for every signed-in traveler, and if the revoke is not re-stated anon regains execute (harmless today because auth.uid() is null inside the function, but it is a hole nobody meant to open). Second risk: re-sending spends one of the day's eight and is screened again — say so in the composer's subtitle on the retry path, or somebody rewrites three times and hits the cap without understanding why.

### `hi-the-composer-gets-photographed` — Put the say-hi composer in the E2E tour, four frames, without sending anything

**Priority** next · **Effort** S · **Ships as** over the air

The design brief says a critique of this app runs against the screenshots from the last E2E run, because reading source and imagining the result is how a screen with two concatenated fields passed review. The say-hi flow is the product's chokepoint and the subject of six findings in this subsystem, and none of the 94 PNGs shows it: no composer, no anchor card, no counter, no warning, no cap, no blocked notice. The flow file explains itself at signed-in-tour.yml:225-229 — reaching chat needs no second person if you use a group — which is sound for the thread and says nothing about the composer, since Travelers already renders a real candidate at 17-travelers-signed-in.png and Say hi is one tap away from a screen that needs nobody else.

<details><summary>Closes 1 audit findings</summary>

- Nothing in this entire area has ever been photographed

</details>

**Changes**

- e2e/flows/signed-in-tour.yml, immediately after `takeScreenshot: 17-travelers-signed-in` (line 150) — tapOn 'Say hi'; extendedWaitUntil visible 'Your first message' (the field's label, not the title, since the title repeats the button's words the same way the group-name step at :251-254 already guards against); takeScreenshot 17a-composer

- e2e/flows/signed-in-tour.yml — tapOn { id: 'first-message-input' }; inputText 'Hey, I am in Bangkok the same week. Any good night markets?'; takeScreenshot 17b-composer-typed. This frame is the one that shows the anchor card, the counter and the /500 together, because the Travelers Say hi path passes a target so pickingElement is false

- e2e/flows/signed-in-tour.yml — eraseText; inputText 'Want to hook up at the night market?'; extendedWaitUntil visible 'This might not go through' timeout 8000 (well past DRAFT_CHECK_DEBOUNCE_MS = 700 in src/features/matching/hooks.ts:118); takeScreenshot 17c-composer-warned

- e2e/flows/signed-in-tour.yml — tapOn 'Close'; tapOn 'Discard'; assertNotVisible 'Your first message'. This exercises the exit and the unsaved-draft guard the exit package adds, and it is the assertion that proves the tap landed rather than being swallowed

- src/app/compose-request.tsx — the testID the flow needs is added by hi-a-way-out-and-a-reason

- Do NOT add a Send step. 20260816200000_trips_matching.sql:394 makes a first message one-shot per pair forever, so a sent hello makes the tour non-idempotent on the seeded account and turns a teardown delete into a required step. The blocked notice and the cap screen are better served by a render test than by a live send

**Tests.** The package is the test. src/app/**tests**/e2e-flows.test.ts already validates that every selector key the flows use is one Maestro has, so the new steps are checked in the pre-push gate. Evidence is the four new PNGs read by eye, per the change-review brief: a green run is not evidence the app looked right.

**Risk.** Two. The draft warning is a network round trip, so 'This might not go through' can be slow on a cold function — extendedWaitUntil with a generous timeout, never a bare assertVisible. And the composer is a presented modal, so the Close tap sits on top of the traps entry about navigating out from under a modal; assertNotVisible after it, and if the following tapOn 'Map' ever comes back byte-identical three frames running, that is the dropped-presentation bug, not a flaky selector.

**After.** `hi-one-name-for-one-act`, `hi-a-way-out-and-a-reason`

### `hi-count-what-the-warning-deterred` — Count the drafts the warning stopped, so the creep metric is not measuring its own success

**Priority** next · **Effort** S · **Ships as** over the air

"% of first messages blocked by moderation" is the brief's creep early-warning (§6). The draft warning exists to turn would-be blocks into rewrites before anybody presses send, which removes events from the numerator of exactly that metric. Blocked % will fall over time for a reason that has nothing to do with how many people are trying to send creepy first messages, and the founder will read a safety improvement that is a measurement artefact. Because the preview is prefilter-only while the send path adds the LLM, the mix also shifts toward llm_blocked, so the trend will additionally look like a classifier regression.

<details><summary>Closes 1 audit findings</summary>

- The draft warning quietly suppresses the creep early-warning, and nothing counts what it deterred

</details>

**Changes**

- src/features/matching/hooks.ts:95-111 — inside useDraftWarning, when previewFirstMessage comes back blocking and the flagged text is new, `analytics.capture('draft_flagged', { category, surface })`. Category only, never the text and never the matched pattern — 20260822140000_featured_and_caps.sql:295-297 records why the pattern is not returned in the first place. Fire once per distinct flagged draft, not once per keystroke

- src/features/matching/hooks.ts:87-118 — return `everFlagged` alongside risky and category, so a sender who rewrote after a warning can be distinguished from one who never saw one

- src/app/compose-request.tsx:67 and src/app/message-place.tsx:43 — pass a `surface` ('first_message' / 'business') into useDraftWarning and hand everFlagged to submit()

- src/features/matching/hooks.ts:131-136 — add `rewrote_after_warning: boolean` to the existing request_sent capture, taken from everFlagged

- docs/DASHBOARD.md:14 and :24 and :38-39 — define the creep signal as (prefilter_blocked + llm_blocked + draft_flagged) / (attempts + draft_flagged), and say in as many words that admin_moderation_stats.blocked_pct is a lagging, deliberately suppressed number because the draft warning is designed to remove events from it

- docs/DASHBOARD.md — one further line the audit did not raise but the code says: message_business (20260828160000_businesses_not_places.sql:100-127) and open_direct_chat (20260830000000_a_business_is_served_no_travelers.sql:306+) both screen and both write no moderation_event at all, so every block on those two paths is invisible to admin_moderation_stats. Document it rather than fixing it — see the dropped list

**Database.** none. The SQL half of the metric moves in hi-a-reword-is-not-a-strike; this package only defines and documents the combined number.

**Tests.** jest unit on useDraftWarning with @testing-library/react-native's renderHook (already a devDependency), mocking previewFirstMessage and the analytics module: one capture for one flagged draft, none for a clean one, none repeated while the same text sits in the box, and a fresh one after the text changes and blocks again. Assert the captured properties contain a category and do not contain the draft text — that assertion is the privacy invariant, and it belongs in a unit test because there is no database boundary to attack.

**Risk.** Double-counting. The hook's effect re-runs on every text change, so the guard has to key on the flagged text and not on the boolean, or a person editing a blocked sentence character by character floods the metric and makes the creep number worse than useless. The other risk is scope: draft_flagged is only ever a prefilter signal, so it must never be compared like-for-like against llm_blocked.

**After.** `hi-a-way-out-and-a-reason`, `hi-a-reword-is-not-a-strike`

### `hi-an-owner-can-answer-fast` — Three saved replies an owner writes once and taps into any chat

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

Messages to a business go through with no accept gate, so an owner receives every "do you have beds tonight" as a fresh conversation with a blank composer. There are no canned replies and no away message anywhere in src/. The rating that judges a business is comparative and public and responsiveness is most of it, and for a bar mid-service the difference between three taps and three sentences is whether the app is useful or another notification to ignore. Saved replies stay plain text the owner taps IN, never auto-sent, so nothing about the moderation path changes.

<details><summary>Closes 1 audit findings</summary>

- An owner has no reply tools for the inbox the app exists to fill

</details>

**Changes**

- supabase/migrations/20260830140000_an_owner_can_answer_fast.sql (new) — `create table public.business_saved_replies (id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses (id) on delete cascade, position int not null check (position between 0 and 2), body text not null check (char_length(body) between 1 and 500), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (business_id, position));`

- supabase/migrations/20260830140000_an_owner_can_answer_fast.sql — `alter table ... enable row level security;` `revoke all ... from anon, authenticated;` `grant select, insert, update, delete on public.business_saved_replies to authenticated;` and one policy per verb, all `using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_user_id = auth.uid()))` with the same expression as `with check`. These are private notes: nobody but the owner ever reads them, including the traveler on the other side of the chat

- src/features/business/api.ts — fetchSavedReplies(businessId) and saveSavedReplies(businessId, bodies: string[]) writing positions 0..2 and deleting the rows a shortened list leaves behind; plain table access, matching updateOwnBusiness at :102-118

- src/features/business/hooks.ts — useSavedReplies(businessId) and useSaveSavedReplies, keyed ['saved-replies', businessId]

- src/app/business-replies.tsx (new) — a StepScreen modal with three FormTextFields, an onClose that mirrors message-place.tsx:78, and Save

- src/app/\_layout.tsx, beside :289 — `<Stack.Screen name="business-replies" options={{ presentation: 'modal' }} />`

- src/app/(tabs)/my-business.tsx — a DetailRow inside the existing 'Your chat' Section (around :635) linking to /business-replies, showing how many are set

- src/features/chat/composer.tsx:29-48 — new optional `quickReplies?: string[]`; when present, a horizontal chip row above the composer row whose onPress does `setDraft(current => current.length ? current : reply)` and focuses the field. It INSERTS, never sends: the send button stays the only thing that sends

- src/app/chat/[id].tsx:436 — pass quickReplies when `viewerIsBusiness` (already computed at :280) and the chat kind is 'business'

**Database.** 20260830140000_an_owner_can_answer_fast.sql: one new table with RLS and four policies. Note that supabase/tests/database/19_rls_everywhere.test.sql asserts every public table has RLS enabled, so this table has to be registered there or that test fails.

**Tests.** pgTAP, new supabase/tests/database/31_business_saved_replies.test.sql, written as attacks: another business's owner cannot select, insert, update or delete my rows; a plain traveler in a chat with the business cannot select them; anon gets nothing; the position check and the unique (business_id, position) both hold. jest render test with @testing-library/react-native on composer.tsx: tapping a chip puts the text in the field and does NOT call onSend; tapping it with a draft already typed leaves the draft alone. E2E: add a My business to Quick replies frame to e2e/flows/business-tour.yml so the editor is photographed.

**Risk.** Two things to keep straight. First, saved replies must not be readable by the traveler — do not be tempted to put them in a granted column on businesses, whose select grant already goes to anon for the listed columns. Second, the chip row sits directly above the composer inside KeyboardFloor: a horizontal ScrollView there needs keyboardShouldPersistTaps="always", or the first tap on a chip while the field is focused is eaten by the scroller (traps, Keyboard).

**Waits on.** Does an owner get canned replies at all? For: a bar mid-service either answers in three taps or does not answer, and the public comparative rating is largely a responsiveness score, so the tooling is the feature. Against: the app's whole tone is "write like a person who has travelled", and canned text is the first step toward every business message reading the same, which is the thing travelers already ignore on other platforms.

### `hi-a-verdict-in-your-language` — Answer a rejected selfie or storefront in the language its owner speaks

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

**Status: done (2026-09-01), except that half of `reason_en` has no reader.** `profiles.locale` is written once per sign-in, the worker passes the tag into both prompts, and `reason_en` is required by both verdict schemas rather than optional — which is what this package's own Risk paragraph asks for. But "required" is not "read". Of the two:

- The **storefront** English copy has exactly one reader, and it is the right one: `apply_business_verification_verdict`'s `uncertain` branch mails the founder and quotes `p_verdict ->> 'reason_en'` (`20260903010000:137`), falling back to `reason` for verdicts written before the deploy.
- The **selfie** English copy has none. `apply_verification_verdict` (`20260817090000:811`) stores the verdict whole into `verification_requests.verdict` and into `moderation_events.metadata`, mails nobody, and there is no admin surface over either. So the sentence written specifically so the founder could adjudicate an appeal about somebody's face is reachable only by opening the SQL editor and knowing the key is there. (The traveler-facing half does work: `reason` is rendered at `src/features/profile/verification-capture.tsx:164-165`, which is where the route this package cites as `verification.tsx:124-130` moved to, because signup needs the same capture and cannot reach that route.)

Reading it out of a jsonb column by hand is not a reader. The gap is written up as `hi-a-verdict-the-founder-can-read` below rather than left as a field nothing looks at — that pattern has cost this project eight columns already.

The classifier is language-agnostic, which is the hard part and it is done. But two verdicts speak directly to a person about their own face or their own livelihood, and both come back in English and are rendered verbatim: src/app/verification.tsx:124-130 and src/app/business-storefront.tsx:219-228. A Thai hostel owner whose storefront photo is rejected gets a sentence they may not read at the exact moment the app most needs to sound fair rather than arbitrary. The storefront verdict's own comment already shows the right instinct, three outcomes rather than two because "a hand-painted sign in a script the model reads poorly is a real business having a bad day", and then the explanation is in the wrong language.

<details><summary>Closes 1 audit findings</summary>

- Moderation reads every language but explains itself only in English, at the two moments that hurt most

</details>

**Changes**

- supabase/migrations/20260830150000_a_verdict_speaks_your_language.sql (new) — `alter table public.profiles add column locale text check (locale is null or char_length(locale) <= 16);` plus adding `locale` to the existing grant update and grant select column lists at 20260816190000_core_auth_profiles.sql:350 and :354

- src/lib/… wherever the session bootstraps (the same place analytics.identify is called) — write `Localization.getLocales()[0]?.languageTag` once per sign-in. expo-localization is already a dependency and is currently unused in src/

- supabase/functions/moderation-worker/index.ts:57-62 and :65-72 — add `reason_en: z.string()` to VerificationVerdict and StorefrontVerdict, so the audit trail keeps an English copy whatever language `reason` comes back in

- supabase/functions/moderation-worker/index.ts:680-712 — select the subject's profiles.locale alongside the profile photos and append one line to the content block: write `reason` in that language and `reason_en` in English. Same at :795-840 for the storefront queue, using the business owner's locale

- supabase/functions/moderation-worker/index.ts:670-696 and :838-843 — the hardcoded English fallbacks ('We could not process your selfie. Please try again.') stay English and set reason_en to the same string; a failsafe is not the place to add a translation round trip

- supabase/functions/moderation-worker/prompts.example.json — document the language instruction and the reason_en key, and add the tone rules the app cannot enforce on model-written text: no em dashes, never an accusation, say what to do differently

- Nothing changes on the message path: apply_message_verdict never shows the model's reason to anybody, so there is nothing there to translate

**Database.** 20260830150000_a_verdict_speaks_your_language.sql: one nullable column on profiles plus two grant column lists restated. No function signatures move.

**Tests.** pgTAP: extend supabase/tests/database/02_profiles_photos_rls.test.sql with an assertion that a user can write their own locale and cannot write anybody else's. jest: a unit test on whatever helper picks the tag, asserting a missing locale falls back to null rather than to a guess. The worker itself has no test harness in this repo, so the evidence for the prompt half is a manual run against a branch project with a non-English locale set, and the moderation_events row read back to confirm reason_en survived.

**Risk.** The founder cannot read a rejection written in Thai, which makes an appeal harder to adjudicate — reason_en is the mitigation and it must be required by the schema, not optional. Second, languageTag is the phone's language, not necessarily one the person reads well, and a business owner's profile row may have nothing useful in it at all; null must fall back to English silently rather than to a nearest guess.

**Waits on.** Is a rejection sentence written by a model, in a language nobody at Samewhere reads, acceptable on a screen about somebody's face or livelihood? For: the alternative is a sentence they cannot read at all, at the moment the app most needs to sound fair. Against: it is unreviewable copy on the two most consequential screens the app has, and the English original only helps after somebody complains.

### `hi-a-verdict-the-founder-can-read` — An admin surface for the English half of a moderation verdict

**Priority** next · **Effort** S · **Ships as** Supabase deploy only

**Status: OPEN. Nothing in this package is in the tree** — do not read it as shipped behaviour.

`hi-a-verdict-in-your-language` made `reason_en` required on both verdict schemas so that a rejection written in Thai stays adjudicable. The storefront half got its reader in the same pass (the `uncertain` mail to the founder). The selfie half did not: `apply_verification_verdict` writes the verdict into `verification_requests.verdict` and `moderation_events.metadata` and stops there, and neither table has an admin surface. A person whose selfie was refused appeals through Contact us, the founder opens the support inbox, and the one sentence written for exactly that moment is not on screen anywhere.

**Changes**

- `supabase/migrations/<new>_a_verdict_the_founder_can_read.sql` — `create view public.admin_verification_queue`, modelled exactly on `admin_report_queue` (`20260817090000:873-891`): a service-role surface for the SQL editor, `revoke all ... from anon, authenticated` on the next line, no RPC. Select `v.id, v.user_id, v.created_at, v.reviewed_at, v.status, v.reason, v.verdict ->> 'reason_en' as reason_en, v.verdict ->> 'engine' as engine, v.attempts` from `public.verification_requests v` where `v.status <> 'pending'`, newest first. `reason` and `reason_en` side by side is the whole point: one is what the person was shown, the other is what it says.

- Same migration — the business half, for symmetry and because the `uncertain` mail is a one-shot a founder can lose: the same shape over `public.business_verifications`, joined to `public.businesses` for the name. Its `verdict` already carries `reason_en` from `20260903010000`.

- No new column, no function signature moves, nothing on the client. This is a read.

**Database.** One migration, two views, two revokes. No `drop function` dance: nothing here has OUT columns.

**Tests.** pgTAP, `supabase/tests/database/<n>_a_verdict_the_founder_can_read.test.sql`, written as an attack rather than a happy path: as `authenticated`, `select` from each view is refused; as `anon`, refused; and the service role sees a rejected row whose `reason_en` is the English string while its `reason` is not. Verify each assertion fails with the grant or the column removed before believing it — the point of the file is that a traveler cannot read the moderation queue, and a view created without the `revoke` passes a happy-path test perfectly.

**Risk.** A view over `verification_requests` is a list of everybody whose selfie was refused, which is about as sensitive as this database gets. The `revoke` is the whole security of it and it must be in the same migration as the `create view`, not a follow-up: a view inherits nothing useful by default and `public` keeps read on it. Do not add an `admin_resolve_verification` RPC in the same package — re-running a verification is a separate decision with its own consequences for `profiles.verified`, and this package is only about being able to READ the verdict.

**Waits on.** Nothing. The founder question this hangs off (may a model write a rejection in a language nobody here reads?) is recorded on `hi-a-verdict-in-your-language` and is unchanged by giving the English copy a reader — if anything, this is the mitigation that makes answering "yes" reasonable.

## Cross-cutting platform: errors, offline, copy pipeline, i18n, links, instrumentation, store compliance

Forty-nine findings collapse into eighteen packages, and they cluster into four real problems. First, the app has a second voice nobody wrote: `src/lib/query-client.ts` alerts whatever string Postgres raised, and among the 368 `raise exception` strings in the schema are "cannot unmatch a closed conversation", "request already sent to this traveler" and "sending too fast — wait a moment" — a banned word, a banned word, and an em dash, all shipping today under a heading that names the wrong action. Second, four of the six §6 metrics are PostHog-only and no workflow in the repo passes `EXPO_PUBLIC_POSTHOG_API_KEY`, so every OTA update ships ~50 analytics calls that discard their events silently; the two events that would answer the map-led thesis are also double-fired and mis-shaped, so even with the key the number would be wrong in a flattering direction. Third, the app is legally reachable but not legally readable: the full privacy policy exists only as a markdown draft, `ConsentNote` asks agreement to guidelines alone, and App Store Connect wants two hosted URLs that do not exist. Fourth, everything link-shaped is a custom scheme with nothing behind it — invites, password resets — which breaks precisely for the person who does not have the app yet. Two findings I am dropping outright: `featured_traveler` no longer ignores the audience setting (the live definition at `20260830000000_a_business_is_served_no_travelers.sql:234` calls `discovery_pair_ok`, and `supabase/tests/database/17_profile_visibility.test.sql:297` already asserts it), and the app is now free of curly quotes except two strings. What the founder is really deciding here is whether the database gets to write user copy, and whether business analytics reopen a scope decision `docs/BUSINESS_ACCOUNTS.md` §10 already closed.

### `platform-error-vocabulary` — Give database failures written copy, and stop banned words reaching an alert

**Priority** now · **Effort** L · **Ships as** over the air + Supabase deploy

The global mutation handler alerts any Postgres exception verbatim under the title "Could not save". A traveler leaving an already-closed chat is shown "cannot unmatch a closed conversation" — the banned word, in a user-facing alert, in the app that exists not to be a dating app. Someone who already said hi gets "request already sent to this traveler", banned again. A sixth trip gets "active trip limit reached (5)", a parenthesised integer out of a schema file. Someone rate-limited gets "sending too fast — wait a moment", an em dash the design brief bans by name. None is capitalised, none says what to do next, and only four screens in the whole app intercept one.

<details><summary>Closes 3 audit findings</summary>

- Raw Postgres exception text reaches users in a "Could not save" alert, including the banned words "unmatch" and "request"

- Server error strings reach users verbatim, using the banned word for a message, titled "Could not save"

- Raw Postgres error strings reach users in an alert titled "Could not save", including banned vocabulary

</details>

**Changes**

- src/lib/failure-message.ts — replace the raw passthrough in saveFailureMessage with three steps: (1) if the error carries a `hint` matching a known code, return that entry's sentence; (2) else if the raw message starts with an uppercase letter and ends with '.', '!' or '?', pass it through unchanged (this is the mechanical form of the header comment's own rule, and it is what every migration since 20260827 already writes: 'That date has already passed.', 'This chat has ended.', 'You were removed from this group. Ask an admin to let you back in.'); (3) else look the lowercase fragment up in a DB_COPY table and fall back to 'Something went wrong. Try that again.' — never the raw string. Rewrite the header comment to record that the rule changed and why: the old rationale holds for 'trip is entirely in the past' and fails for 'cannot unmatch a closed conversation'.

- src/lib/failure-message.ts — the DB_COPY table, keyed on the exact lowercase fragment, covering every one reachable from the UI: 'active trip limit reached (5)' → 'Five trips is the most you can have posted at once. Delete one from your profile to add this.'; 'active pin limit reached (10)' → 'Ten pins is the most you can have up at once. One will expire soon, or take one down from the map.'; 'photo limit reached (9 per user)' → 'Nine photos is the most a profile can hold.'; 'daily trip limit reached' / 'daily pin limit reached' / 'daily photo upload limit reached' → 'That is as much as you can post today. More tomorrow.'; 'cannot unmatch a closed conversation' and 'chat not found' → 'This chat has already ended.'; 'request already sent to this traveler' → 'You already said hi. It will be in Chat if they answer.'; 'already connected with this traveler' → 'You two already have a chat.'; 'recipient unavailable' → 'You cannot say hi to this traveler right now.' (ONE identical sentence for every relationship failure, preserving the oracle-proofing the migration comments at review_fixes.sql:266-272 exist to protect); 'daily request limit reached' → 'That is all your first messages for today. More tomorrow.'; 'daily block limit reached' → 'You have blocked a lot of people in one day. If somebody is making new accounts to reach you, write to us from House rules and help and we will deal with it at our end.'; 'daily report limit reached' → same shape; 'not authenticated' → 'You have been signed out. Sign in and try that again.'; 'account banned' / 'account suspended' → 'Your account is closed. Write to us from House rules and help if you think that is wrong.'; 'sending too fast — wait a moment' → 'One moment, then try again.'; 'trip is entirely in the past' → 'That trip has already finished.'; 'make an account first' and its siblings → 'Make an account to do that.'; 'that text breaks our community guidelines' → 'That breaks our community guidelines. Reword it and try again.'

- src/lib/query-client.ts — take the fourth argument React Query v5 passes to MutationCache.onError (`(error, variables, context, mutation)`) and read `mutation.meta?.failureTitle`, falling back to 'Could not save'. No new alert buttons: a second navigating button fired from a global handler is exactly the modal-during-dismiss shape the traps skill warns about, so the copy names the route instead.

- src/features/matching/hooks.ts — add `meta: { failureTitle: "Couldn't send that" }` to useSendRequest; src/features/chat/hooks.ts — the same on useSendMessage, useSendPhoto, useBlockUser ('Could not block them'), useReportUser ('Could not send that report'), useLeaveChat; src/app/report.tsx already relies on the global handler and needs no local change once the title is right.

- src/app/edit-prompt.tsx:66-74, src/app/edit-priorities.tsx:284-292, src/app/room/[id].tsx:400-410, src/features/auth/reset-password-screen.tsx:47-53 — delete the four ad-hoc regex intercepts and let saveFailureMessage answer, so there is one place to look. Keep reset-password-screen's non-DB branch ('The link may have expired') since that failure has no DB string behind it.

- src/app/guest-name.tsx:76, src/app/add-to-group/[userId].tsx:48, src/app/message/[userId].tsx:51, src/app/add-people/[chatId].tsx:116 — no code change, but re-shoot these screens: they render saveFailureMessage inline rather than in an alert, so the new copy has to fit a form's error line.

- supabase/migrations/<new>\_a_failure_says_what_to_do.sql — no signature changes; add `hint = '<STABLE_CODE>'` to the raise clauses for the reachable fragments above so the client keys on a code rather than English prose. The same sentences are duplicated across seven migrations (grep 'request already sent to this traveler' hits 20260816200000, 20260816210000, 20260817090000, 20260817150000, 20260819210000, 20260821090000, 20260822140000, 20260822235000), so a string-keyed map stops matching the day one is reworded. Only the LIVE definition of each function needs the hint; the string map stays as a belt.

- docs/DESIGN.md — record the capital-and-full-stop rule so the next migration author knows that writing a sentence is what makes it shippable.

**Database.** One migration adding `hint = '<code>'` to raise clauses in the live definitions of send_message_request (20260822235000), create_trip/create_pin caps, unmatch_chat (20260816220000:86), the launch_hardening rate limiters and assert_good_standing. No RETURNS TABLE signature changes, so no drop-function-first requirement and no grants to re-state — but re-state them anyway on any function that does get recreated.

**Tests.** jest, src/lib/**tests**/failure-message.test.ts: extend to assert (a) 'cannot unmatch a closed conversation' never returns itself, (b) every relationship failure returns the identical sentence, (c) 'This chat has ended.' passes through unchanged, (d) an unmapped lowercase fragment returns the generic and never itself. New jest source-scan src/lib/**tests**/db-strings.test.ts, modelled on live-camera.test.ts: read every supabase/migrations/\*.sql, extract every `raise exception '...'` literal, and fail on any containing 'request', 'match', 'unmatch', 'swipe', 'deck' or U+2014 unless it is listed in an explicit allowlist inside the test with a one-line reason; assert separately that no VALUE in DB_COPY contains any of them. E2E: re-run e2e/flows/signed-in-tour.yml and read 15b/16 and the chat screens as pictures — the inline error sites are the ones a screenshot catches.

**Risk.** The capital-and-full-stop rule is a behaviour change to every unmapped error at once: a good sentence a migration wrote in lowercase now becomes the generic. That is the intended trade and the allowlist test makes it visible, but scan the 368 raise strings once by hand before shipping and promote any genuinely good lowercase sentence into DB_COPY. Second risk: mutation.meta is typed as `Record<string, unknown>` so `failureTitle` needs a cast or a declaration-merged MutationMeta — typecheck will catch it. Do not add a Contact-us button to the alert.

**Waits on.** failure-message.ts's own header comment records the passthrough as deliberate: "a message the DATABASE wrote is already a sentence somebody chose... those are worth showing verbatim." It carries no 'Founder, <date>:' attribution, so it is an engineering choice, not a ruling — but overturning it is the point of this package. FOR: the rationale is true of 'That date has already passed.' and false of 'cannot unmatch a closed conversation', which ships a banned word to a user. AGAINST: a lookup table is one more thing to keep in step with the schema, and a migration that adds a new failure now needs a client change or falls to a generic sentence. Recommended: overturn it, but keep the rationale alive as the capital-and-full-stop rule so a migration author who writes a proper sentence still gets it shown.

### `platform-analytics-key-reaches-builds` — Make the PostHog key reach a build, and fail loudly when it does not

**Priority** now · **Effort** S · **Ships as** over the air

Every one of the ~50 capture calls is a no-op in TestFlight and in every over-the-air update, because `EXPO_PUBLIC_POSTHOG_API_KEY` appears in .env.example and nowhere else. Four of the six §6 metrics are PostHog-only, so they have literally zero data, and the gap is invisible because a missing key is a no-op rather than an error. The behaviour is also unrecoverable: the launch window cannot be evaluated retrospectively. The Supabase pair gets a preflight that fails the run loudly; analytics got nothing.

<details><summary>Closes 2 audit findings</summary>

- No PostHog key reaches any build, so every analytics call in the app is a no-op in production

- The nutrition-label table under-declares what PostHog actually collects, and sends it to a US host for an EU-first launch

</details>

**Changes**

- .github/workflows/testflight.yml:78-105 — add `PH: ${{ secrets.EXPO_PUBLIC_POSTHOG_API_KEY }}` to the 'Check required secrets' env block and `[ -n "$PH" ] || missing+=(EXPO_PUBLIC_POSTHOG_API_KEY)` to the missing array, exactly the shape the Supabase pair already uses at :93-94.

- .github/workflows/testflight.yml:120-130 — add EXPO*PUBLIC_POSTHOG_API_KEY and EXPO_PUBLIC_POSTHOG_HOST to the 'Publish an over-the-air update' env block. This is the one that actually matters: Metro inlines EXPO_PUBLIC*\* on THIS runner, so an update published without them ships analytics dead even when the binary underneath had a key baked in.

- .github/workflows/expo-go-publish.yml:39-45 and :68-73 — same two additions, so the two publish paths cannot drift.

- eas.json — no change needed. The build profiles already name `"environment": "production"` / `"preview"`, so EAS reads the value from its own environment; docs/APP_STORE.md already documents `eas env:create --name EXPO_PUBLIC_POSTHOG_API_KEY`. Add a line to APP_STORE.md marking that command as required rather than optional.

- src/lib/analytics.ts:5-8 — warn once in **DEV** when apiKey is absent, mirroring src/lib/supabase.ts:14-19, so the no-op state is visible to whoever is testing. Change the host default from 'https://us.i.posthog.com' to 'https://eu.i.posthog.com': the first launch city is in the EU and docs/legal/PRIVACY_POLICY.md already tells users their data lives in the EU, which today is true of Supabase and false of analytics.

- .env.example:16 — update EXPO_PUBLIC_POSTHOG_HOST to the EU endpoint to match.

- docs/DASHBOARD.md — add a line saying every PostHog-derived number is unavailable until this lands, and that the four SQL admin views in 20260817150000_launch_hardening.sql are unaffected because they read Postgres truth rather than events.

**Tests.** No unit test can prove a workflow secret exists. The proof is a run: publish an update from Actions → TestFlight → `action: update`, and confirm the preflight step fails when the secret is absent (delete it locally in a fork, or read the step log). Then confirm the first event lands in PostHog with the run id and commit recorded, per change-review's evidence rule. Add a jest assertion in src/lib/**tests**/ that analytics.capture does not throw when the client is null, so the no-op path stays safe.

**Risk.** The host change moves the project to a different PostHog cloud: a project created on us.i.posthog.com is not readable from eu.i.posthog.com and the key differs. If the founder has already created a US project, either recreate it in the EU region before any real data exists, or leave the host and correct the policy sentence instead — do not ship a US host under an EU promise. This is an EXPO*PUBLIC* value inlined at bundle time and touches no native code, so it goes out as `eas update`.

**Waits on.** none — the key itself is already recorded as a founder ask in docs/PROGRESS.md:1884. The wiring should land regardless so the day the key exists is the day data starts.

### `platform-poll-when-focused` — Stop the map polling every minute while somebody is reading a chat

**Priority** now · **Effort** S · **Ships as** over the air

useCityPins refetches every 60s and useHeatCells every 120s, unconditionally. NativeTabs keeps the Map tab mounted, and focusManager is wired only to AppState, so both timers keep firing while the user is in Chat or on a profile. On a phone abroad on data that is a request a minute for a screen nobody is looking at. The reason the comment gives — expired pins lingering — is satisfied just as well by refetching when the tab comes back, which the existing staleTime already does.

<details><summary>Closes 1 audit findings</summary>

- The map polls every 60 seconds while you are reading a chat

</details>

**Changes**

- src/features/pins/hooks.ts:28-48 — `const focused = useIsFocused();` from expo-router, then `refetchInterval: focused ? 60_000 : false` on useCityPins and `focused ? 120_000 : false` on useHeatCells. Keep both staleTimes so returning to the tab refetches once.

- src/features/pins/hooks.ts — the same treatment on the guest map hooks if they carry intervals; check useMapPins/useMapHeat in src/features/guest/hooks.ts alongside.

- src/features/pins/hooks.ts — update the comment at :34-35 to say the interval is now tab-scoped and why.

**Tests.** jest: the hooks take useIsFocused, so mock it the way src/features/notifications/**tests**/push-primer.test.tsx:20 already does (`useIsFocused: () => true`) and assert the query options object carries `refetchInterval: false` when unfocused. No E2E — a screenshot cannot see a timer.

**Risk.** useIsFocused re-renders the hook's owner on every tab change, which for map-screen.tsx means a render on each switch. That is already true of my-business.tsx:310 and push-primer.tsx:60, so the precedent is proven in this codebase. Low.

### `platform-event-hygiene` — One event per thing that happened, carrying the property the question needs

**Priority** now · **Effort** M · **Ships as** over the air

Two of the events the map-led thesis rests on are broken at the call site. Every guest generates two `travelers_viewed` events and the first carries no guest flag, so filtering `guest != true` does not remove guests from matching DAU — the untagged copy still counts. And `message_sent` ships two incompatible shapes: the text path sends `{chat_id}` and never `kind`, the photo path sends `{kind:'photo'}` and never `chat_id`, so any breakdown on kind yields 'photo' versus undefined and any per-conversation analysis silently drops every photo. Neither event says whether a conversation is a direct chat or a joinable-pin room, which is the question the whole thesis rests on: do pins produce conversation, or just taps.

<details><summary>Closes 2 audit findings</summary>

- The guest travelers screen fires travelers_viewed twice, one of them untagged

- message_sent ships two incompatible property shapes and never says direct-versus-room

</details>

**Changes**

- src/app/(tabs)/travelers.tsx:83 — delete the guest component's own capture. src/app/(tabs)/travelers.tsx:500-502 — change the parent effect to `analytics.capture('travelers_viewed', { guest: isGuest })`. `isGuest` is already in scope above the early returns, so exactly one event fires and always carries the flag.

- src/features/pins/map-screen.tsx:786-789 — add the same `guest` property to `map_viewed`. It is one component for both audiences, so without it the two sides of the thesis ratio are wrong in opposite directions.

- src/features/chat/hooks.ts:145 and :204 — one helper used by both paths emitting `{ chat_id, kind: 'text' | 'photo', surface: kind === 'room' ? 'room' : 'direct' }`. useSendMessage already receives `kind` as its second parameter (:122) and useSendPhoto knows its chatId, so both values are in scope at both call sites today.

- src/features/rooms/hooks.ts:116,128 — leave room_joined/room_left alone; they already carry chat_id and are correctly shaped.

- docs/DASHBOARD.md — redefine map DAU as unique users on `map_viewed` with `guest = false`, and matching DAU the same way on `travelers_viewed`; add a derived metric, share of accepted hellos and joined pins that reach a second inbound message, which is the marketplace-health number accept rate is only a proxy for.

**Tests.** jest: a render test around the Travelers screen (mount it as a guest, assert analytics.capture is called exactly once with `{guest: true}`) — src/app/**tests**/ already holds screen-level tests of this shape. Unit test the message_sent helper directly: assert both call shapes produce all three properties. E2E: e2e/flows/guest-tour.yml already walks the guest Travelers screen; no assertion change, but it is the flow that would have caught the double fire had anything been counting.

**Risk.** Deleting GuestTravelers' capture changes the meaning of historical `travelers_viewed` volume, but there is no history — the key has never reached a build. That makes now the only free moment to fix it. Low.

**After.** `platform-analytics-key-reaches-builds`

### `platform-business-two-numbers` — Show a business owner the two numbers the screen already has

**Priority** now · **Effort** S · **Ships as** over the air

My business answers "what have I configured" and never answers "did anyone see it". A bar owner in Lisbon posts a quiz night, opens the app the next day, and learns nothing, so they stop opening it. Two of the numbers that would help are already fetched by this screen and rendered nowhere useful: the count of live posts, and the room's member_count. Landing those costs nothing and is not the analytics pipeline docs/BUSINESS_ACCOUNTS.md §10 deferred.

<details><summary>Closes 1 audit findings</summary>

- My business shows a hostel owner nothing about whether the listing worked

</details>

**Changes**

- src/app/(tabs)/my-business.tsx:552-572 — the What's on section already maps over `posts`; add a line above the cards reading how many are live, using countOf from src/lib/plural.ts the way the Links and Photos rows at :604-624 already do.

- src/app/(tabs)/my-business.tsx:635-648 — the Your chat section already reads `detail.member_count` and prints 'N people here'. Promote that number so it reads as the audience number it is rather than a detail row value, and keep the 'Nobody in yet' fallback, which is honest.

- src/app/(tabs)/my-business.tsx — do NOT add marker taps, listing opens or per-post 'seen by N'. There is no listing-event capture in the app, so those need a new events table, RLS confining an owner to their own business_id, and a nightly rollup. That is the build cost §10 parked and it is the founder decision below.

**Tests.** E2E: e2e/flows/business-tour.yml already lands on My business (70-business-my-business.png, 74-business-back-on-my-business.png). Re-shoot both and read them — this is a 'does it look right' change and per change-review nothing but a screenshot answers it. jest: no new logic worth a unit test.

**Risk.** member_count is the room's membership, not a reach number, and labelling it as an audience risks an owner reading it as views. Word it as membership ('N travelers in your chat'), never as impressions.

**Waits on.** Reopen business analytics, or leave §10 closed? docs/BUSINESS_ACCOUNTS.md §10 lists 'business analytics' in the deferred bucket, not the refused one (written reviews sit in the refused bucket, explicitly), so it is legitimately re-openable. FOR: this is the clearest reason the business side will churn, and every mature owner app leads with it. AGAINST: it means a new events table, per-owner RLS, a nightly rollup and a k-threshold so a count of one can never resolve to a person — real build cost, at a moment when there are no businesses yet to churn. Recommended: land the two free numbers now, revisit the event table after the first ten real listings exist, and apply the heat layer's k-threshold when it is built ('Not enough yet' below k) since §7 rule 6 is the precedent.

### `platform-privacy-in-app` — Ship the privacy policy the way the guidelines already ship, and put back the meeting-safety advice

**Priority** next · **Effort** M · **Ships as** over the air

The app collects email, age, gender, photos, a verification selfie, travel dates and message content, and asks the user to agree to community guidelines and nothing else. Grep for 'privacy policy' across src/ returns zero. The one paragraph of privacy copy that ships is four sentences buried as section four of the rulebook. A cautious traveler who wants to know what happens to her selfie has nowhere to look inside the app, and the App Store page will link a policy the app itself cannot show. Separately, policies.ts names docs/legal/COMMUNITY_GUIDELINES.md as source of truth and says to keep them in step; they have drifted, and the section that got dropped is the safety one — 'Make plans in public places; tell someone where you're going' and 'Report anything that feels off, you're never wasting our time' exist in the markdown and not in the app.

<details><summary>Closes 3 audit findings</summary>

- There is no privacy policy or terms link anywhere in the app

- The privacy policy is linked from nowhere inside the app

- The in-app guidelines drop the meeting-safety advice the source document has

</details>

**Changes**

- src/constants/policies.ts — add `PRIVACY_SECTIONS`, bundled the way GUIDELINE_SECTIONS is, sourced from docs/legal/PRIVACY_POLICY.md. Lead with 'What we deliberately do NOT collect' — the location denial is the strongest sentence in the document and it is currently on page two. Extend the header docblock to name the new file pairing.

- src/constants/policies.ts:24-26 — add a fifth GUIDELINE_SECTIONS entry, 'Meeting up', carrying the two lines from COMMUNITY_GUIDELINES.md:35-39, rewritten without the em dash the source uses.

- src/app/privacy.tsx — new screen, a straight copy of src/app/guidelines.tsx's structure (ScrollView of sections, Done footer, MaxContentWidth root), rendering PRIVACY_SECTIONS.

- src/app/\_layout.tsx:353 — declare `<Stack.Screen name="privacy" options={{ presentation: 'modal' }} />` in the same unguarded block guidelines sits in. This matters: ConsentNote is shown to a signed-out user being asked to agree, and a link declared inside a guard dead-ends for exactly that person.

- src/features/auth/consent-note.tsx:17-28 — second link, so the sentence reads 'By continuing you agree to our community guidelines and privacy policy.' Keep the accessibilityRole="link" on both child spans for the reason the existing comment gives.

- src/app/guidelines.tsx:39-49 — a row above Contact us pointing at /privacy, so the two documents are reachable from each other.

- src/app/profile-me.tsx:348-350 — the 'House rules and help' row stays; add a sibling 'Privacy' row pushing /privacy, and the same for the signed-out variant at :91-92.

**Tests.** jest render test in src/app/**tests**/: mount privacy.tsx and assert the first section heading is the do-not-collect one, and that PRIVACY_SECTIONS and GUIDELINE_SECTIONS are both non-empty. A source-scan assertion that src/app/\_layout.tsx declares 'privacy' outside every Stack.Protected block, in the shape src/app/**tests**/invite-exits.test.ts:59 already uses. E2E: extend e2e/flows/guest-tour.yml to tap through to the privacy screen from the signed-out consent line, and shoot it — 19-house-rules.png has a sibling now.

**Risk.** Bundled text drifts from docs/legal/. The existing header comment is the only mechanism keeping them in step and it already failed once (that is finding 9). Consider a jest test that asserts each PRIVACY_SECTIONS title appears as a heading in docs/legal/PRIVACY_POLICY.md, which catches a section being dropped without pretending to diff prose.

**Waits on.** none — but the bundled text is only as good as the source, so this should land after the legal-text rewrite rather than bundling a draft with three bracketed TODOs in it.

**After.** `platform-legal-text`

### `platform-legal-text` — Rewrite the two legal drafts so they describe the app that exists

**Priority** next · **Effort** M · **Ships as** over the air

Six separate gaps stack in docs/legal/. The policy names no third-party processors and carries no equal-protection clause, though messages, photos and selfies go to Anthropic's API server-side. It promises access and export that do not exist in any form, and an in-app change notification the app has no mechanism to deliver. It describes travelers only, while a business account collects a trading name, a street address and marker, hours, links, photos and an email loop, and is rated by travelers. It files the verification selfie as a sub-bullet reading 'compared automatically against your profile photos', which sounds like a human glancing at two pictures. Neither document mentions the DSA, and the first launch city is in the EU. And the featured-traveler paragraph tells a woman who does not want to be shown to signed-out visitors to delete her trip, which is telling her to stop using the product.

<details><summary>Closes 5 audit findings</summary>

- The consent moment does not disclose that messages and photos go to a third-party AI that can suspend the account

- Neither legal document acknowledges the DSA, and the EU is the first launch market

- The privacy policy and the label table describe travelers only; a business account collects a different set entirely

- The selfie check is a face comparison, and nothing anywhere says so

- The privacy policy promises data export and change notifications the app cannot deliver

</details>

**Changes**

- docs/legal/PRIVACY_POLICY.md — add an equal-protection paragraph naming every processor by name: Supabase (Postgres, storage, auth, EU region), Expo (updates, push), Apple (push delivery, Sign in with Apple), PostHog (product analytics), Anthropic (moderation and verification classification). App Review 5.1.1(i) asks for the confirmation that each provides equal protection; 5.1.2 asks for consent to the sharing, which is what the ConsentNote change in the privacy-in-app package supplies.

- docs/legal/PRIVACY_POLICY.md — a 'Verification' heading, not a sub-bullet, stating what the check actually is. I read the pipeline: supabase/functions/moderation-worker/index.ts:700-724 signs URLs for the selfie and up to two approved profile photos, sends them to a vision model with the literal question 'Is this selfie plausibly the same person as the profile photos?', and supabase/migrations/20260817090000_trust_safety.sql:829-841 stores only the verdict JSON. No face template is computed, nothing derived from the face is retained, and the selfie is deleted immediately after the verdict (index.ts:649-656). Say exactly that, in those words, because it is the strongest sentence available and it is true.

- docs/legal/PRIVACY_POLICY.md — an 'Appeals' line: any automated block, warning or suspension can be reviewed by a person via Contact us. That closes GDPR Art. 22 and DSA Art. 17 in one paragraph, and the machinery already exists (src/app/contact.tsx, reachable signed-out).

- docs/legal/PRIVACY_POLICY.md — a 'Business accounts' section: what a listing collects (src/app/business-edit.tsx and src/features/business/links.ts are the inventory), that a listing is deliberately public including to signed-out visitors, what the email confirmation is for, that ratings are anonymous to the business and nothing shows below five (the promise BUSINESS_RULE_SECTIONS already makes and the policy does not), and how a business deletes its listing. This mirrors the split src/constants/policies.ts:46-66 already made for the same reason.

- docs/legal/PRIVACY_POLICY.md 'Your rights' — either name a real email address and a real response window, or state that access and export are handled by hand via Contact us with a named turnaround. Do not leave a GDPR Art. 15/20 promise standing against a rate-limited inbox with no runbook. Delete or replace the in-app change-notification sentence, which no mechanism can deliver.

- docs/legal/PRIVACY_POLICY.md — correct the analytics bullet: replace the bracketed TODO with a real sentence, name the region the events actually go to, and say whether an opt-out exists (it does not today; see platform-event-context).

- docs/legal/PRIVACY_POLICY.md — rewrite the featured-traveler paragraph. It is currently harsher than the code: the live featured_traveler at supabase/migrations/20260830000000_a_business_is_served_no_travelers.sql:234 calls discovery_pair_ok(auth.uid(), ...), and audience_admits returns false for a null viewer on any audience but 'everyone', so anyone who has narrowed their audience is ALREADY invisible to signed-out visitors. Say that, and describe the remaining case (audience 'everyone', the default) accurately.

- docs/legal/COMMUNITY_GUIDELINES.md — a short DSA section: this is how you report content (the contact form, Art. 16), this is what happens when we restrict yours (the statement of reasons, Art. 17), this is how you appeal (a person reviews it). Fill the bracketed legal-entity and point-of-contact TODOs at the foot of both files — the same values unblock the GDPR TODO.

- docs/legal/ both files — strip the DRAFT banners only when the founder signs off; the files themselves say a legal review is a separate required step and that stays true.

**Tests.** Nothing here is code, so nothing here is jest. The evidence is the founder's sign-off plus the legal review the documents already say is required. One mechanical check worth having: extend the jest source scan from platform-privacy-in-app to assert every PRIVACY_SECTIONS title in src/constants/policies.ts appears as a heading in docs/legal/PRIVACY_POLICY.md, so a section can never be dropped from the app silently again.

**Risk.** Writing legal text that overstates is worse than writing none. The verification paragraph in particular must not claim more than the code does — re-read moderation-worker/index.ts:700-724 before writing it, and if the prompt or the model ever changes to compute an embedding, the paragraph is wrong and the label answer changes with it.

**Waits on.** Two. (1) Declare Sensitive Info / biometrics in App Privacy, or state the fact precisely instead? FOR declaring: Apple's Sensitive Info category names biometric data, GDPR Art. 9 treats biometric data used to uniquely identify a person as special category, and Illinois BIPA and the Texas CUBI Act attach statutory damages to face templates collected without written notice. AGAINST: the pipeline computes no template and retains nothing derived from the face, and a Sensitive Info declaration on an app whose pitch is that it does not track you is a self-inflicted wound that is also inaccurate. Recommended (medium confidence, and this is the one to put in front of the legal review the policy already requires): do not declare, and instead state in the policy, on src/app/verification.tsx and in the App Review notes that the comparison produces no biometric template and stores nothing derived from the face. (2) Build data export, or narrow the promise? FOR building: an Edge Function walking the same tables supabase/functions/delete-account already enumerates would cover GDPR Art. 15 and Art. 20 and reuses machinery that exists. AGAINST: it is a real build for a right nobody has yet exercised. Recommended: narrow the sentence now to a named address and a stated window, build the function when the first DSAR arrives — but do not leave the promise standing against no runbook.

### `platform-domain-and-web-endpoints` — Stand up the domain, and put a real page behind every link the app hands out

**Priority** next · **Effort** L · **Ships as** over the air

Privacy Policy URL and Support URL are both mandatory fields in App Store Connect; neither can be filled today, and guideline 1.2's 'published' contact means reachable from the listing, which an in-app form is not — a person who cannot get past the sign-in screen, or who deleted the app, has no route to a human. The same domain fixes the growth loop: src/app/group/[id].tsx:41 builds an invite with Linking.createURL, which in a standalone build is `samewhere:///join-group/<token>`, a string iMessage and WhatsApp will not linkify and Safari answers with 'the address is invalid'. The entire population an invite is for is people who do not have the app. And src/features/auth/api.ts:79 mails a `samewhere://reset-password` link, which fails identically for anyone reading email on a laptop.

<details><summary>Closes 4 audit findings</summary>

- No hosted privacy policy or support page exists, and App Store Connect requires both URLs

- The invite link is a custom scheme with no web fallback, so anyone without the app lands nowhere

- Neither the support URL nor the domain that would host the policy exists, and both are required fields

- An invite link on a first launch is swallowed, and the link is a custom scheme with no web fallback

</details>

**Changes**

- Register the domain (docs/LAUNCH_RUNBOOK.md step 2 already requires one for Resend's SPF/DKIM/return-path records, so this is one registration serving two blockers).

- Serve `/.well-known/apple-app-site-association` listing the app ID (TEAMID.com.mattmoore.samewhere) and the `/join-group/*` and `/reset-password` paths. Served as application/json, no redirect, no extension.

- Serve `/join-group/<token>` — the group name and member count (the same public preview the DB already grants a signed-out caller through get_group_invite_preview), an 'Open in Samewhere' button, an App Store link under it, and a smart-app-banner meta tag. This is the page that makes the invite work for the person it is for.

- Serve `/reset-password` — a page that says what to do when the app is not installed, so the browser stops answering with an invalid-address error.

- Serve `/privacy` and `/guidelines` — docs/legal/PRIVACY_POLICY.md and COMMUNITY_GUIDELINES.md as static pages, and `/support` fronting the same channel src/app/contact.tsx posts to.

- Stand up a support mailbox on the domain that forwards somewhere the founder reads; set the GitHub secret SUPPORT_FROM to an address on it and redeploy the functions, which also unblocks runbook step 2 (today only the Resend account owner's address can receive anything).

- Fill both App Store Connect fields, and both bracketed TODOs at the foot of docs/legal/.

- docs/APP_STORE.md — flip 'Published developer contact (1.2)' and 'Community guidelines + privacy policy (hosted)' from ⚠️/📄 to done, and add the two URLs.

- docs/LAUNCH_RUNBOOK.md step 2 — extend to cover the five static paths, so the domain is provisioned once for mail and links together.

**Database.** none — the invite preview page reads through the existing signed-out-readable group preview path (20260823050000_invite_opens_signed_out.sql). If a public page needs a narrower payload than the app's preview, that is a new SECURITY DEFINER function and a new migration, not a policy change.

**Tests.** Not app tests. Verify by walking it: open the invite URL on a phone with the app installed (it must open the app, not Safari), on a phone without it (it must show the group and an App Store button), and paste it into WhatsApp (it must linkify). Apple's AASA is cached by the CDN, so check https://app-site-association.cdn-apple.com/a/v1/<domain> after publishing. Add one Maestro assertion to e2e/flows/signed-in-tour.yml that the copied invite string starts with https:// rather than samewhere://.

**Risk.** associatedDomains is native config, so the app half of this cannot ship over the air — see platform-native-config-batch, which carries it. Publish the AASA BEFORE that build ships, or the entitlement points at a 404 and universal links silently fall back to Safari. Keep `samewhere://` registered so existing links keep working.

**Waits on.** none for the domain itself. But see platform-native-config-batch for the password-reset shape decision.

**After.** `platform-legal-text`

### `platform-native-config-batch` — Batch every app.json change into one EAS build

**Priority** next · **Effort** M · **Ships as** EAS build

Four separate needs all require a prebuild, and the ship skill is explicit that builds draw down real credit and should be batched. The camera permission string spends its 24 words listing three occasions and never answers where the picture goes or who sees it, which for the app's only permission dialog is the whole permissions first impression. No expo.locales key means the permission sheets are English-only by construction and iOS 16+'s per-app language picker never appears. No associatedDomains means every link the app hands out is a dead custom scheme. And ITSAppUsesNonExemptEncryption is declared false while src/lib/secure-session-store.ts AES-256-encrypts the session at rest, with nothing written down saying that was considered.

<details><summary>Closes 5 audit findings</summary>

- The camera dialog carries three unrelated jobs in one sentence and never says what happens to the photo

- Nothing declares a supported locale, so the permission prompts and the iOS per-app language picker are English-only by construction

- The encryption declaration says no non-exempt encryption while the app AES-encrypts the session at rest

- Password reset is a custom-scheme link with no universal link and no web page behind it

- The invite link is a custom scheme with no web fallback, so anyone without the app lands nowhere

</details>

**Changes**

- app.json:45-51 (expo-image-picker plugin) — rewrite cameraPermission to name the outcome rather than the occasion, under about 30 words so it does not truncate: something in the shape of 'For a profile photo, a photo in a chat, or a verification selfie. Every photo is checked before anyone sees it, and verification selfies are deleted straight after.' Rewrite photosPermission to say who sees the photo, not just what it is for.

- app.json — add `expo.locales` with a single `en` entry pointing at a strings file, so the permission text lives in the localisation system rather than inline and adding pt/es/th/id later is a data change to files that already exist. Add `ios.infoPlist.CFBundleAllowMixedLocalizations: true` at the same time.

- app.json ios block — add `"associatedDomains": ["applinks:<domain>"]`. Pair with src/app/group/[id].tsx:40-42, changing inviteUrl to return `https://<domain>/join-group/${token}`, and src/features/auth/api.ts:79, changing redirectTo to `https://<domain>/reset-password`. Those two are JS and could ship OTA, but must NOT ship before the entitlement exists or every link falls to Safari.

- app.json:15 — a comment beside ITSAppUsesNonExemptEncryption recording the conclusion after five minutes against Apple's export-compliance questionnaire, so the next person does not re-derive it. src/lib/secure-session-store.ts:7-13 already frames the AES as authentication material, which is probably the right reading; write it down rather than leaving it implied.

- docs/APP_STORE.md — a line recording the encryption conclusion, and a note that expo.locales is consumed at prebuild so it has the longest lead time of anything on the list.

**Tests.** jest source-scan asserting app.json declares associatedDomains and that src/app/group/[id].tsx no longer calls Linking.createURL for the invite — the shape src/app/**tests**/invite-exits.test.ts already uses. The rest is verified by the build: `npx expo prebuild --no-install --clean` on a scratch copy and diff the generated ios/ (the ship skill's own rule), then read the permission dialog on the device and check Settings shows a per-app language entry. Re-shoot 90-photo-library.png and 91-photo-crop.png so the permission copy is reviewed as a picture.

**Risk.** runtimeVersion is {policy: 'appVersion'}, so if this build also bumps `version` in app.json every existing install is orphaned from future updates until the build lands — do not bump version and add native config in the same breath unless that is intended. Publish the AASA file before this build ships. And per the ship skill, never promise a build number before the build starts.

**Waits on.** Password reset: universal link, or a typed six-digit code? FOR the universal link: it is one entitlement and one page, and it is needed for invites anyway. AGAINST: corporate mail gateways, Outlook Safe Links and scanners prefetch verify URLs and consume the single-use token, so the person taps a link already spent and gets the app's honest-but-wrong 'That link has expired'. FOR the code: businesses already get exactly this (supabase/migrations/20260829150000_a_code_that_never_arrives_says_so.sql, request_business_email_confirmation), a typed code cannot be consumed by a prefetch, and it works on any device. Recommended: ship the universal link now because the domain and entitlement are needed for invites regardless, then move travelers to the six-digit code as a follow-up — it is strictly more robust and the app already has the pattern.

**After.** `platform-domain-and-web-endpoints`, `platform-app-icon`

### `platform-invite-survives-first-launch` — Prove an invite survives a first launch before building anything for it

**Priority** next · **Effort** S · **Ships as** over the air

src/app/\_layout.tsx:236 returns IntroTour above the Stack that is the only place join-group/[token] is declared, and src/features/auth/use-auth-listener.ts:27-64 is the sole getInitialURL handler and parses recovery links only. So the claim is that a fresh install opening an invite gets a four-screen product tour that never mentions the group. But expo-router hands the initial linking state to the NavigationContainer, and React Navigation can rehydrate that state into a root navigator that mounts late, so dismissing the tour may already land the invitee on join-group. Nothing in the repo tests it, node_modules is not installed in this checkout, and building a capture path for a bug that may not exist is worse than the bug. Group invites are the app's only viral loop, so this is worth settling rather than guessing.

<details><summary>Closes 1 audit findings</summary>

- An invite link on a first launch is swallowed, and the link is a custom scheme with no web fallback

</details>

**Changes**

- e2e/flows/ — a new Maestro flow, or an addition to onboarding-tour.yml, that clears app state, opens `samewhere://join-group/<token>` on a launch with intro.seen false, dismisses the tour, and asserts the join screen's own text appears. This is the flow the change-review brief calls a whole flow a person walks, so Maestro is where it belongs, not jest.

- src/features/auth/use-auth-listener.ts:27-64 — ONLY IF the test fails: match `/join-group/:token` off Linking.getInitialURL() and the url event next to the recovery parse, and stash it with the store's existing inviteRemembered setter (src/features/auth/store.ts:81). PendingInviteHandoff at src/app/(tabs)/\_layout.tsx:21-54 already spends the token at the first moment there is a mounted stack and a real session, so the token then survives the tour, the auth stack and onboarding for free.

- src/features/intro/intro-tour.tsx — the alternative smaller fix if rehydration works but the tour is still wrong for this person: let the tour know an invite is pending and shorten or skip it, so an invitee lands on the group rather than on a product tour.

**Tests.** The Maestro flow above IS the test, and it is the deliverable whichever way the result goes. Keep it in e2e/flows/ permanently: this is a regression a refactor of the root layout would silently reintroduce, and per change-review never loosen the assertion to make it pass — assert the exact group name a human would read.

**Risk.** A Maestro flow that opens a deep link on a cold start needs the simulator's state cleared between runs; the existing flows already do device setup, so follow their shape. If the test passes, close the finding and say so in the plan rather than building the capture path anyway.

### `platform-offline-state` — Teach the app that a phone can be offline

**Priority** next · **Effort** M · **Ships as** EAS build

This is an app for people on hostel wifi, airport wifi and Thai SIM cards, and onlineManager is never imported: React Query believes the device is always online. Queries fire into a dead connection, retry twice, fail, and sit there. Every screen independently discovers the problem and prints its own version of the same sentence. Nothing tells the user the phone is the problem before they tap, nothing refetches when the wifi returns, and the only way back is to background and reopen the app, which nobody is told. A traveler who walks out of the cafe mid-conversation gets an app that is quietly wrong until they think to kill it.

<details><summary>Closes 1 audit findings</summary>

- The app has no concept of being offline: no NetInfo, no reconnect refetch, no connection banner

</details>

**Changes**

- package.json — add @react-native-community/netinfo. This is a native module, so it is what makes this package an EAS build; bundle it with platform-native-config-batch rather than spending a build on ten lines.

- src/lib/query-client.ts — wire onlineManager to NetInfo's listener, which gives automatic refetch-on-reconnect for every query in the app. Leave the AppState → focusManager bridge at :44-48 alone; the two are complementary.

- src/components/ui/connection-banner.tsx — new. A thin bar under the top safe-area inset reading 'No connection' and, on reconnect, 'Back online' for 1.5s before dismissing. Reuse the OFFLINE constant from src/lib/failure-message.ts:29 so there is one sentence in the product. Use warning (#FFC168) from src/constants/theme.ts, never danger — red is banned as a UI colour.

- src/app/\_layout.tsx:400-412 — render it as a sibling after <RootNavigator /> inside ThemeProvider, NOT in (tabs)/\_layout.tsx: chat/[id], place/[id], room/[id] and every modal live outside the tabs, and those are exactly the screens somebody is on when the wifi goes. The container needs pointerEvents="none" — an absolutely-positioned overlay that swallows touches is the same class of bug the traps skill records for ModalHostView.

- src/lib/failure-message.ts — no change; the LoadErrors stay, they are still right for a server-side failure.

**Tests.** jest: assert onlineManager.isOnline() follows a mocked NetInfo state, and that the banner component renders nothing when online. E2E: Maestro cannot toggle the simulator's network mid-flow reliably, so this one is proved by hand on a device with airplane mode, and by a screenshot of the banner added to the gallery. Add the banner to the screens skill's review list so it is looked at rather than asserted.

**Risk.** Named by the verifier and real: with onlineManager wired, queries PAUSE rather than error while offline, so the per-screen LoadErrors stop appearing on a dead connection and the pending/skeleton state becomes the offline state. Any screen that has only an error branch and no loading branch will sit blank instead of erroring — archived-chats and profile/[userId] are the two named in other agents' findings. Land those loading branches first or in the same change. Second risk: the banner must not collide with the map's Drop-a-pin control or the floating tab bar; render it top, not bottom, and keep it out of the E2E suite's tap targets.

**Waits on.** none. Explicitly not in scope: queueing mutations to fire on reconnect. A hello that sends itself three hours after it was written, to somebody who has since left the city, is worse than one that failed honestly.

**After.** `platform-native-config-batch`

### `platform-event-context` — Put account type, city and release on every event, and stop re-identifying on every launch

**Priority** next · **Effort** M · **Ships as** over the air

'Map DAU vs matching DAU' is the single number that validates the map-led thesis, and it is biased upward on the map side by exactly the number of business accounts: src/components/app-tabs.tsx:38 renders the map trigger unconditionally and :50 hides Travelers with `hidden={isBusiness}`, so businesses can reach the map and are structurally barred from the matching surface. No event carries an account_type property and there is no way to reconstruct the split after the fact, so as listings grow the ratio drifts in the direction the founder wants to see for a reason that has nothing to do with travelers — and a flattering failure is the dangerous kind. Separately, this project ships JavaScript over the air daily, and PostHog's $app_version comes from the native binary, so no metric change is attributable to the release that caused it. And src/features/auth/use-auth-listener.ts:87-90 calls identify() inside onAuthStateChange with the raw Supabase auth uid, so it re-fires on INITIAL_SESSION at every cold start and on every token refresh.

<details><summary>Closes 3 audit findings</summary>

- Business accounts inflate map DAU but not matching DAU, and no event can tell them apart

- Events carry no release identity, so an OTA regression is invisible on every chart

- PostHog holds a de-anonymised social graph keyed to real user ids, with no opt-out

</details>

**Changes**

- src/lib/analytics.ts — add `setContext(props)` holding a module-level object, and merge it into every capture. Do NOT depend on the SDK's register()/super-properties API without first checking node_modules/posthog-react-native types, per AGENTS.md; a merged context object works regardless of what the SDK exposes.

- src/lib/analytics.ts — guard identify(): keep the last id in a module variable and return early when it has not changed, so a token refresh stops minting an $identify. reset() clears it.

- src/features/auth/use-auth-listener.ts:87-92 — call setContext alongside identify with `{ account_type: 'traveler' | 'guest', is_guest }`, derived from session.user.is_anonymous the way src/features/guest/hooks.ts:27-29 already does. Call it again where useOwnBusiness resolves (src/features/business/hooks.ts) to upgrade account_type to 'business'.

- src/lib/analytics.ts — register `update_id` (short form) and `is_embedded` in the same context, reusing exactly the expression src/components/ui/build-stamp.tsx:23-26 already derives, so the number on screen and the number in the chart always agree.

- src/features/pins/map-screen.tsx:787 — city_id is already on map_viewed; move it into setContext so every event carries it and the per-city breakdown works on the safety and funnel events too.

- src/lib/analytics.ts + a settings row — an analytics opt-out. 5.1.1(i) asks the policy to describe how consent is revoked, and there is nothing to describe today. Wire it to the SDK's opt-out rather than to dropping the key, and persist it in the existing zustand store; put the row on src/app/profile-me.tsx next to the Privacy row.

- docs/DASHBOARD.md — define map DAU as unique users on map_viewed with account_type='traveler', add 'break down by update_id' to the insight definitions, and write the full property inventory in as the reviewed list so the next event added is checked against it. Add the same to .claude/skills/ship as a post-publish check.

**Tests.** jest, src/lib/**tests**/: assert setContext properties appear on a subsequent capture; assert identify() called twice with the same id fires once and twice with different ids fires twice; assert reset() clears the context so the next account never inherits the previous one's account_type. That last assertion is the privacy-relevant one.

**Risk.** account_type resolves asynchronously — useOwnBusiness settles after the first paint, which is exactly the race src/components/app-tabs.tsx:44-49 documents for the tab list. Early events will carry account_type 'traveler' for a business until the query lands. Either accept it and say so in DASHBOARD.md, or hold the first map_viewed until businessSettled the way src/app/\_layout.tsx:139-147 holds routing.

**Waits on.** Identify with the raw Supabase uid, or a salted hash? FOR hashing: joining PostHog's distinct_id to the app's own database reconstructs who talked to whom and when, in a third-party processor, for a product whose whole positioning is privacy-forward and whose users are disproportionately EU travelers; docs/PROGRESS.md:2099 records a previously-shipped bug where a real traveler's display name reached analytics from a signed-out screen, which shows the property surface is not reviewed. AGAINST: a salt embedded in the bundle protects only against someone holding a PostHog export and not the app, and hashing costs the ability to look up one user's session when answering a support ticket — a real loss for a solo founder. Recommended (medium confidence): take the two free wins regardless — guard identify() so it fires only on change, and hash chat_id, which is attached at src/features/chat/hooks.ts:145 and src/features/rooms/hooks.ts:116,128 and is never needed as a joinable key, only as a stable counter. Decide the uid separately; it is the only half with a cost.

**After.** `platform-analytics-key-reaches-builds`

### `platform-request-funnel-db` — Make accept rate answerable by source, by city, and by declined-versus-ignored

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

Three decisions are blocked by one view. 'Do hellos that start on the map get accepted less than hellos from the travelers list?' is the core map-led thesis question and it is unanswerable from SQL. A falling accept rate cannot be diagnosed, because admin_request_funnel's denominator folds pending, ignored and declined together, so the same drop is produced by a push outage, by slow responses, or by people never seeing the hello. And the rate is global while creep is local, so one bad cohort in one launch city is diluted across all of them, exactly inverting the early warning the brief calls for. One correction to the finding: `source` is already a column on message_requests (20260816200000_trips_matching.sql:383) and `responded_at` already exists (:392), so only city_id is genuinely new.

<details><summary>Closes 1 audit findings</summary>

- Accept rate cannot be split by source, by city, or by declined-versus-ignored

</details>

**Changes**

- supabase/migrations/<new>\_a_funnel_that_names_its_city.sql — add `city_id int references public.cities (id)` to public.message_requests, nullable for existing rows, and populate it in the live send_message_request (currently 20260822235000_review_fixes.sql:195). The trip_match branch already joins the sender's and recipient's trips and has mine.city_id in scope at :275-289; the pin branch already selects the recipient's live pin at :291-297 and can take p.city_id from it.

- Same migration — `drop view public.admin_request_funnel;` FIRST, then recreate it. A view has the same restriction a RETURNS TABLE function does: create-or-replace cannot change the column list, and this rewrite changes it entirely. Then re-state the revoke at 20260817150000_launch_hardening.sql:523, which names admin_request_funnel in a multi-object revoke — restate the whole statement, not a fragment.

- The new view — group by city_id and source, with four explicit buckets rather than one folded denominator: accepted, declined, still pending, expired-unanswered; plus median hours to respond from `responded_at - created_at`. Keep blocked_by_moderation out of the denominator, which the current view already gets right.

- src/features/matching/hooks.ts:175 — mirror source and city onto the request_responded event so PostHog can break down by them. Note the event is emitted by the RECIPIENT, a different distinct_id from the sender's request_sent, so the two can never form a PostHog funnel.

- docs/DASHBOARD.md — stop describing insight 3 as a PostHog funnel. Cross-user funnels do not work and the doc currently implies they do; the SQL view is the answer and the events are only for breakdowns.

**Database.** One migration: alter table message_requests add city_id; create or replace send_message_request (jsonb return, no OUT columns, so no drop needed); DROP VIEW admin_request_funnel then recreate it and re-state the revoke from launch_hardening.sql:523.

**Tests.** pgTAP, a new file in supabase/tests/database/ alongside 09_launch_hardening.test.sql: insert requests from two cities and both sources in known states, then assert the view splits them correctly, that a blocked_by_moderation row is in no denominator, and that a pending row is counted as pending rather than as a decline. Per change-review this is a database invariant and belongs in pgTAP, not a mocked jest test. Also assert the view is still invisible to anon and authenticated after the drop-and-recreate — that is the assertion the re-stated revoke exists for.

**Risk.** The drop-function-first rule bites here in its view form, and the failure mode is the one AGENTS.md warns about: the deploy fails after the migration's earlier statements have already applied. Put the drop at the top of the file, before the ALTER TABLE, so a failed run leaves nothing half-done. Existing rows get a null city_id; the view must not silently drop them, so bucket them as 'unknown' rather than filtering them out.

### `platform-pin-funnel-events` — Make a low pin rate diagnosable

**Priority** next · **Effort** M · **Ships as** over the air

Pins are the supply side of the entire product — no pins, no map, no heatmap, no reason to open the app — and pin creation rate is a §6 metric. Today the funnel is two events wide: map_viewed then pin_created. That tells the founder the number is low and nothing about why, across a composer that spans place search, category, date and duration. The decision blocked is a build decision: is the composer too long, is place search failing, or do travelers simply not want to publish intent? Those have completely different fixes. Failed posts are invisible too — the mutation's onError at src/features/pins/hooks.ts captures nothing, so a broken RPC reads identically to disinterest.

<details><summary>Closes 1 audit findings</summary>

- The pin funnel is one step, so a low pin rate has no diagnosis

</details>

**Changes**

- src/features/pins/map-screen.tsx — `pin_compose_started` with the entry point ('map_fab', 'empty_state', 'venue_sheet'), fired where the composer is opened rather than inside it, so the entry point is known.

- src/features/pins/pin-form-sheet.tsx — `pin_compose_step` with a stable step name at each stage the form advances, and `pin_compose_abandoned` with the last step reached, fired on unmount without a successful post.

- src/features/pins/hooks.ts:95-125 — add an onError to useCreatePin capturing `pin_post_failed` with the error CLASS only, never the message. The message can carry a venue name somebody typed, and docs/PROGRESS.md:2099 records what happens when user text reaches analytics by accident.

- docs/DASHBOARD.md insight 2 — replace the two-event 'map_viewed → pin_created conversion' with the real funnel, and name the lever each drop-off points at.

**Tests.** jest: render pin-form-sheet, advance it, unmount without posting, assert exactly one pin_compose_abandoned carrying the last step. Assert pin_post_failed carries no property whose value came from user input — that is the privacy-relevant assertion and it is worth writing as an explicit test rather than a comment.

**Risk.** Five new events on a form is easy to overdo; keep step names stable and few, or the funnel becomes unreadable and the events become noise nobody breaks down by. Do not fire a step event on every keystroke of place search.

**After.** `platform-analytics-key-reaches-builds`, `platform-event-context`

### `platform-app-store-metadata` — Write the submission pack: rating questionnaire, screenshots, listing copy, review notes

**Priority** next · **Effort** L · **Ships as** over the air

This is the single highest-leverage surface in the product and most of it is unwritten. docs/APP_STORE.md's age-rating guidance names 17+, a tier that no longer exists, and skips a questionnaire that now gates submission — and the new in-app-controls questions are precisely where a moderated-chat app argues for a lower rating than unmoderated chat earns, which is a discovery and Screen Time question for exactly the young solo travelers in the brief. The screenshot spec targets 6.7" and 6.1", neither of which is the required class, and its first shot is a feature that does not currently render. There is no name, subtitle, keyword field, description or What's New anywhere in the repo, and the surface most likely to import dating grammar by accident is the one being written last, under deadline, from references that are all dating apps. And the review notes ship with an empty demo account on an app with two account types and different tab sets.

<details><summary>Closes 8 audit findings</summary>

- The age-rating guidance is written for a rating tier that no longer exists

- The planned screenshot set targets two retired display classes and leads with a feature that does not render

- No App Store listing copy exists anywhere in the repo

- The App Store listing ships in one language to four non-English launch markets

- The review notes ship with a placeholder demo account, and the moderation pipeline they describe ships dark

- The name is locked into the bundle id and the App Store search it depends on was never run

- The nutrition-label table under-declares what PostHog actually collects, and sends it to a US host for an EU-first launch

- iPad and Mac distribution has never been decided, and the default sends an iPhone-only build to both

</details>

**Changes**

- docs/APP_STORE.md 'Age rating' — rewrite against the current questionnaire and answer the in-app-controls questions with the evidence this app already has: every first message screened before delivery (§7 rule 5, live per LAUNCH_RUNBOOK step 1), photo moderation, report and block from every surface, DB-enforced 18+ (core_auth_profiles.sql:36, age between 18 and 120), pre-accept handle gating, no location permission.

- docs/APP_STORE.md 'Assets still to produce' — respecify at 6.9" and reorder as claims rather than labels: (1) the map with pins and a tapped pin card, because that is what no competitor has; (2) the traveler with overlapping dates; (3) a first message being written against a specific part of a profile; (4) the chat with socials unlocked; (5) the 72h expiry and the no-location promise as a caption over the map. Rename the filenames off 'request compose', which carries the banned word into the asset names and then inevitably into the caption. Do not gate shot one on the heat layer.

- docs/APP_STORE.md — a new listing-copy section, drafted in the same voice as src/constants/policies.ts. The 30-character subtitle has to answer 'is this a dating app?' before the reader asks; the first three lines of the description, all that show before More, must contain the map, the overlapping-dates idea and the word platonic; keywords spend no character on 'dating'; and one line states that discovery, the map and messaging are free forever, because free in this category is not believed unless said.

- docs/APP_STORE.md — a localisation section recording the honest split: the app's own strings stay English for v1, the LISTING is localised for pt-PT, es-MX, th and id. Localised metadata is per-territory, needs no build, ships independently of the binary, and 'travel friends' and 'amigos de viagem' are different search markets. Record it as a decision rather than leaving it an omission.

- docs/APP_STORE.md review notes — supply two demo accounts, traveler and business, plus a five-line walkthrough naming which tab shows which claim, so the reviewer can verify the pre-accept handle gate and the 72h expiry rather than take them on faith. Add one line stating the app requests no location permission and that any location framework present is used only for address geocoding.

- docs/APP_STORE.md readiness table — promote 'Moderation pipeline actually ON' from an adjacent ⚠️ warning to a blocking row in the submission checklist. Claim one in the review notes is that every first message is screened before delivery; a reviewer who tests that against a dark pipeline finds the notes false, which is worse than not having claimed it.

- docs/APP_STORE.md privacy-label table — add Device ID under Identifiers and diagnostics under Usage Data (the PostHog RN SDK mints and persists its own distinct_id and attaches device model, OS version, app version, locale and timezone to every event, none of it declared), and a business row covering trading name, address, hours, links, photos and the email loop.

- docs/NAMING.md — a blocking pre-submission row: run the App Store search from a phone for Samewhere and near-misses, plus USPTO and EUIPO word-mark checks in classes 9 and 42. The bundle id com.mattmoore.samewhere is already in app.json:11 and cannot change after the first submission, so the one irreversible decision in the launch rests on a check the doc itself says was never performed. Ten minutes, and this is the last moment it is cheap.

- docs/APP_STORE.md — one line recording the iPad and Mac distribution decision either way (see below).

**Tests.** Nothing here is code. The evidence is the screenshots themselves, produced by the screens skill from a real build and reviewed as pictures, per change-review. One mechanical guard worth adding: extend the banned-word scan from platform-error-vocabulary to cover docs/APP_STORE.md's listing-copy section, so the draft cannot ship with 'swipe', 'deck', 'match' or 'request' in it.

**Risk.** Screenshots need a running build, so this is gated on the Apple Developer membership like everything else in APP_STORE.md. The listing copy is not — write it now, in the guidelines' voice, before the deadline makes a dating app the nearest reference.

**Waits on.** iPad and Mac distribution. app.json:11 sets supportsTablet:false, which is a decision by omission: an iPhone-only app still installs on iPad in a scaled compatibility window, and by App Store Connect default is also offered on Apple silicon Macs, where nothing in this build — Sign in with Apple, the camera step, react-native-maps, push — has been exercised once. FOR turning it on: the first place a traveler plans a trip is often a laptop or a tablet in a hostel common room, and the layout groundwork is already there (MaxContentWidth = 800 on twenty-plus centred roots), so the pass is far cheaper here than in most codebases — check the profile hero at heroWidth \* 1.15, the intro tour's fixed 320pt artwork, and the sheets. AGAINST: it is a whole surface to look at before launch. Recommended: leave supportsTablet off for v1 and explicitly opt out of Mac and Vision Pro distribution in App Store Connect, so the app is not shipped to two platforms nobody has looked at. Write the choice down either way.

**After.** `platform-legal-text`

### `platform-guardrails` — Three source scans, so the rules hold by construction rather than by vigilance

**Priority** next · **Effort** M · **Ships as** over the air

Three rules this project cares about are enforced today only by attention. The strongest claim the app makes — no device location, ever — rests on two well-commented call sites and a config block, and if anyone calls requestForegroundPermissionsAsync iOS does not prompt or degrade, it hard-crashes on the missing usage description, for everyone, discovered in TestFlight. Two shipped strings still carry curly apostrophes while everything else uses ASCII, which for a legal-adjacent page reads as pasted from another document. And every directional style in the app is physical, which is harmless today and becomes a forty-file retrofit the day an RTL locale is declared. The project has already decided how it handles exactly this class of risk, one directory over, in src/lib/live-camera.ts and its source-scanning test.

<details><summary>Closes 3 audit findings</summary>

- Nothing prevents a future call site from reintroducing a location prompt, and the failure mode is a crash

- A curly apostrophe in one sentence of the house rules, straight quotes everywhere else

- Every directional style in the app is physical, which turns a future Arabic launch into a forty-file retrofit

</details>

**Changes**

- src/lib/**tests**/no-device-location.test.ts — new, modelled on the scan at src/lib/**tests**/live-camera.test.ts:108-141. Assert no file under src/ imports anything from expo-location other than geocodeAsync and reverseGeocodeAsync. The only two call sites today are src/features/pins/pin-form-sheet.tsx:97 (reverseGeocodeAsync) and src/features/pins/use-place-search.ts:108 (geocodeAsync), both geocoding-only. Put the reasoning in the comment the way live-camera.ts:4-23 does, so the rule is learnable at the place it is enforced. This makes APP_STORE.md's review-notes sentence 'the app never requests device location' true by construction.

- src/constants/policies.ts:25 — straight apostrophe in "someone else's". src/features/pins/map-filter-sheet.tsx:194 — straight apostrophe in "travelers' plans". Those are the only two remaining in shipped strings; the whole rest of src/ is already clean, so the finding's 'straight quotes everywhere else' is now true.

- A new jest scan asserting no U+2018/2019/201C/201D and no U+2014 in any string literal under src/\*_/_.ts(x), excluding **tests** (src/features/pins/**tests**/filters.test.ts:84 and src/features/chat/**tests**/photo-review.test.ts:50 use curly apostrophes in test titles) and excluding comments, which legitimately use em dashes throughout and are not user-facing.

- The same scan, extended: flag `left:`, `right:`, `marginLeft`, `marginRight`, `paddingLeft`, `paddingRight` and `textAlign: 'left' | 'right'` in StyleSheet blocks, as a warning list rather than a hard failure at first, so new code uses paddingStart/paddingEnd, marginStart/marginEnd, start/end and leaves textAlign at its default 'auto'. Do NOT do the RTL retrofit; do the discipline now, while it is free. src/app/place/[id].tsx:746 is the example to convert as the demonstration.

- .claude/skills/design-review/SKILL.md — add the logical-property rule and the curly-quote rule to the Words and tokens sections, so a design critique catches them too.

**Tests.** The scans are the tests. Follow live-camera.test.ts's convention of stripping comments before scanning, since the comment saying 'never this' is the cheapest place to learn a rule and must survive.

**Risk.** The directional-style scan will light up on existing code, which is why it starts as a warning list with an explicit allowlist of the files that exist today. A scan that fails on day one gets disabled on day two.

### `platform-locale-and-language-search` — Ask the phone what locale it is, and let people search a language by its code

**Priority** next · **Effort** S · **Ships as** over the air

expo-localization is a declared dependency (package.json:26) with zero call sites: grep for it across src/ and app.json returns nothing. Every locale-dependent fact in the app is hardcoded or guessed — clock format, the calendar's first weekday, date order, the device timezone — and all of them are single properties on getLocales()[0] and getCalendars()[0]. Separately, src/constants/languages.ts:210-217 matches on the English name and the endonym and never searches the ISO code, so a Spanish speaker typing 'aleman', a French speaker typing 'allemand' and a Portuguese speaker typing 'alemão' all get an empty list from a 200-entry corpus that contains their answer. Languages is a required onboarding field and gates finishing signup (src/app/onboarding/index.tsx:131), so that failure lands inside the funnel on a screen with no fallback.

<details><summary>Closes 2 audit findings</summary>

- expo-localization is a declared dependency with zero call sites, so the app never asks the phone anything

- The language picker only matches English names and endonyms, so travelers must know what the app calls their language

</details>

**Changes**

- src/lib/locale.ts — new. Read getLocales()[0].languageTag, getCalendars()[0].uses24hourClock, .firstWeekday and .timeZone once at startup and export them as constants. One file, and it is the dependency several other agents' findings (clock format, calendar first weekday, date order) need before they can be fixed.

- src/constants/languages.ts:210-217 — add `language.value === needle` to matchesLanguage. One line. The matcher itself is good work and should not otherwise change; 'de', 'pt' and 'th' are codes travelers genuinely know from every airline and hotel site. The alphabetical-by-English-name ordering is the only fallback when search returns nothing, and it is also English-ordered, so this makes the search do the work the ordering cannot.

- docs/ARCHITECTURE.md — record the English-only decision explicitly, with its expiry condition ('revisit when a non-English launch city is added'), so the next agent does not re-derive it. There is currently no mention of localisation, i18n, RTL or non-English users anywhere in docs/ or the skills.

**Tests.** jest, extending src/constants/**tests**/languages.test.ts: assert matchesLanguage finds German by 'de', 'German' and 'Deutsch', and that a two-letter query does not over-match (check 'pt' does not return every language containing those letters — fold() lowercases, so 'Portuguese' would match 'pt' only by code equality, which is the point of using === rather than includes). For locale.ts, a unit test with a mocked expo-localization asserting the constants read from the first locale and first calendar.

**Risk.** locale.ts reading at module load means the values are frozen for the process; a user who changes their phone language mid-session sees stale formatting until relaunch. That is standard and acceptable, but say so in the file's comment rather than letting someone discover it.

### `platform-photo-pipeline` — Stop re-downloading every photo on every cold launch, and refuse one too small to fill the frame

**Priority** next · **Effort** M · **Ships as** over the air

Signed URLs are the image cache key. src/features/profile/hooks.ts:209-217 signs for 3600s and src/features/business/photo-url.ts:18-35 for 3000s, src/lib/query-client.ts has no persister so nothing survives a process restart, and no <Image> in the app passes cacheKey (grep returns nothing). So every cold start re-signs every path, producing new URLs, and expo-image's disk cache misses on photos it already holds byte-for-byte. A pass through Travelers, the chat list and two profiles re-pulls a dozen 1440px JPEGs; on hostel wifi that is the difference between a screen that appears and a screen of grey rectangles, and it repeats every session and again 50 minutes into a long one. Separately src/lib/image-upload.ts:42-45 only ever shrinks, so a 320px photo saved out of a chat app passes straight through and is stretched to nearly four times its width in a hero that renders full-bleed at roughly 1170 device pixels — and the person who uploaded it sees the same soft image on their own profile and is told nothing.

<details><summary>Closes 2 audit findings</summary>

- Signed URLs are the image cache key, so every photo is re-downloaded on every cold launch

- No minimum resolution, so a screenshot or a saved thumbnail is accepted and blown up into a hero

</details>

**Changes**

- src/lib/photo-source.ts — new, a one-line helper returning `{ uri, cacheKey }` from a signed URL and its immutable storage path. First verify cacheKey exists on expo-image's ImageSource in SDK 57 against node_modules/expo-image types, per AGENTS.md; node_modules is not installed in this checkout so I could not confirm it.

- src/features/profile/hooks.ts:209-217 (usePhotoUrl), src/features/business/photo-url.ts:20-36 (useBusinessPhotoUrl), src/features/chat/hooks.ts:254 (useChatPhotoUrl) and the featured-photo hook in src/features/guest/hooks.ts — return the object rather than a bare string, so the cacheKey travels with the URL and no call site has to remember the storage path separately.

- The 20-odd signed-photo call sites, of the 34 `source={{` sites in src/: src/components/photo-grid.tsx:100, src/components/ui/profile-hero.tsx:37, src/components/ui/avatar-button.tsx:62, src/app/place/[id].tsx:72, src/app/compose-request.tsx:190,212, src/app/business-edit.tsx:460, src/app/business-signup.tsx:895, src/app/group/[id].tsx:135,329, src/app/chat/[id].tsx:199, src/app/join-group/[token].tsx:259, src/app/add-people/[chatId].tsx:168, src/app/(tabs)/travelers.tsx:175, src/app/(tabs)/my-business.tsx:433, src/app/(tabs)/chat.tsx:85,113, src/features/matching/connected-notice.tsx:62, src/features/pins/pin-marker.tsx:119,192, src/features/pins/map-screen.tsx:165,293,514, src/features/business/place-sheet.tsx:161, src/features/profile/profile-view.tsx:63, src/features/chat/message-thread.tsx:248,312,363 — change `source={{ uri: url }}` to `source={photo}`. Mechanical, and typecheck catches every one. Leave the local-file sites alone: src/app/verification.tsx:159, src/app/business-storefront.tsx:282, src/app/new-group.tsx:108, src/features/chat/composer.tsx:94 and src/features/groups/invite-qr.tsx:43 are file:// URIs and data URIs with no storage path.

- src/lib/image-upload.ts:42-45 — read the height as well as the width (Image.getSize already returns both; sourceWidth currently discards it) and refuse below about 512px on the short edge, throwing a named error the caller can distinguish. 512 rather than 640: a legitimately cropped photo off an older phone lands between the two, and rejecting a real photo is worse than accepting a soft one.

- The photo-picking callers (src/components/photo-grid.tsx, src/app/business-edit.tsx) — catch that error and say something specific rather than generic: "That one is a bit small to fill the frame. Something straight off your camera will look sharper." Offer the library again in the same dialog so it costs one tap, not a restart.

**Tests.** jest: unit-test photo-source (uri and cacheKey both present, cacheKey is the storage path not the signed URL) and the image-upload floor (a 400x1200 source is refused, a 520x520 accepted, an unreadable size falls through to the existing resize path rather than blocking an upload). E2E: the cache change is invisible to a screenshot but the rejection copy is not, so shoot the photo-add flow (90-photo-library.png, 91-photo-crop.png) with a deliberately small file.

**Risk.** Thirty call sites is where a mechanical change goes wrong quietly. Typecheck is the safety net, so change the hooks' return types first and let the compiler enumerate the sites rather than grepping. Second risk: a cacheKey keyed on storage_path means a photo REPLACED at the same path would serve the stale image — check whether any upload path reuses a path. src/lib/image-upload.ts:49 generates a fresh random id per upload, so it does not, but a future edit-in-place would break this silently.

### `platform-in-app-browser` — Wire up the in-app browser this project already built

**Priority** next · **Effort** S · **Ships as** over the air

src/app/place/[id].tsx:228 calls Linking.openURL for every link kind including website and menu, so a traveler tapping Menu on a bar listing at 9pm leaves Samewhere entirely: no Done button, no return path except the app switcher, and the pin they were about to drop is behind two gestures they have to think about. The row's own accessibilityHint at :222-232 says 'Opens outside the app', which is honest about a behaviour that does not need to be true. expo-web-browser is already a dependency and src/components/external-link.tsx already wraps openBrowserAsync with WebBrowserPresentationStyle.AUTOMATIC — grepping ExternalLink across src returns exactly one hit, its own definition. It was written and never wired up.

<details><summary>Closes 1 audit findings</summary>

- Every outbound link kicks the user to Safari, and the in-app browser the project already built is dead code

</details>

**Changes**

- src/app/place/[id].tsx:226-232 — branch on the link kind: route `website` and `menu` through openBrowserAsync so they present as SFSafariViewController with a Done button that lands back on the exact screen.

- src/app/place/[id].tsx — keep Linking.openURL for phone, email, whatsapp and the social handles enumerated in src/features/business/links.ts. Those https URLs are universal links the native Instagram, TikTok and WhatsApp apps claim, and an in-app browser would steal them into a logged-out web view, which is strictly worse.

- src/app/place/[id].tsx:216-224 — update the accessibilityHint so it stops promising 'Opens outside the app' for the two kinds that no longer do.

- src/components/external-link.tsx — make it the shared entry point rather than dead code, so there is one place the presentation style is decided. Do not delete it.

**Tests.** jest: unit-test the kind-to-opener mapping directly (website and menu → the browser opener, phone/email/whatsapp/social → Linking), which is the whole logic and is worth isolating out of the component. E2E: the business tour already reaches a listing; add a tap on the website row and shoot the result, because 'does it look right' is the only question that matters here.

**Risk.** SFSafariViewController is iOS-only presentation; expo-web-browser degrades on Android, which is fine for an iOS-first app kept cross-platform-clean. Verify against the SDK 57 docs at docs.expo.dev/versions/v57.0.0/ before writing it, per AGENTS.md.

### `platform-report-underage` — Give someone a way to say a traveler is under 18

**Priority** next · **Effort** S · **Ships as** over the air + Supabase deploy

The 18+ rule is a CHECK on a typed integer (supabase/migrations/20260816190000_core_auth_profiles.sql:36) mirrored by validateAge, whose error text names the number to type. That is the honest state of things for a free app and may be acceptable. What is not acceptable is that the app then discards the only signal that could actually find a minor: src/app/report.tsx:13-20 offers a fixed six-reason set with no underage option and no field to say it in, while docs/legal/PRIVACY_POLICY.md promises 'We remove underage accounts' through a mechanism that does not exist.

<details><summary>Closes 1 audit findings</summary>

- Nothing stops a 17-year-old, and a report that someone is underage has nowhere to go

</details>

**Changes**

- supabase/migrations/<new>\_a_report_can_say_underage.sql — `alter type public.report_reason add value if not exists 'underage';`. The repo has already done exactly this on this enum (20260827090000_business_enums.sql:31 added 'impersonation'), so the pattern is proven here and the heavier rebuild the nonbinary_audience migration used is not needed. Keep it in its own migration and do not reference the new literal in the same file — Postgres refuses to use a new enum value in the transaction that added it, which is the trap that forced the rebuild in 20260823040000.

- src/app/report.tsx:13-20 — add `{ value: 'underage', label: 'They are under 18' }` to REASON_OPTIONS. Note while you are there that 'impersonation' was added to the enum a month ago and never surfaced in this list; either add it or record why 'Fake profile' covers it.

- src/lib/database.types.ts — regenerate so ReportReason carries the new value.

- Fast-tracking in the moderation queue is optional for v1 and can be a query the founder runs; the cheap half is making the signal collectable at all, which is what makes the policy sentence true.

**Database.** One migration, alter type report_reason add value 'underage', in its own file with nothing else in it. No function signature changes, no grants to re-state.

**Tests.** pgTAP, extending supabase/tests/database/08_trust_safety.test.sql: assert report_user accepts the new reason and that the row lands in reports with it. Per change-review a database invariant belongs in pgTAP, not a mocked jest test. jest: assert REASON_OPTIONS covers every value in the ReportReason union, which is the test that would have caught 'impersonation' going missing.

**Risk.** Adding an enum value is one-way — Postgres cannot remove one. That is fine here. Do not let the label read as an accusation form; 'They are under 18' matches the neutral tone of the other five.

**Waits on.** none for the report reason. Apple's Declared Age Range API is a separate question and I am not planning it — see dropped.

### `platform-app-icon` — Draw the App Store icon as artwork, not as an upscale

**Priority** next · **Effort** M · **Ships as** EAS build

assets/images/android-icon-foreground.png, brand-mark.png and splash-icon.png are all exactly 17,919 bytes: the same file three times, with different safe areas and different jobs. icon.png is a fourth, 21,639 bytes, and docs/APP_STORE.md records it as the working placeholder with 'App icon final pass' not started. The campfire mark on 00-welcome.png is genuinely good and exactly on-brand, but it was drawn to be seen at 200pt in the middle of a dark screen with a glow behind it. At 60pt in a search row, against whatever background the store uses, the glow is gone and the crossed logs are two white bars. The icon is the first impression in the most literal sense and it sits above the screenshots on the product page.

<details><summary>Closes 1 audit findings</summary>

- One 17KB PNG is doing four jobs and none of them is the App Store icon

</details>

**Changes**

- assets/images/icon.png — a 1024px pass drawn as separate artwork rather than an upscale: no transparency, no rounded corners (Apple applies the mask), no glow. Check it at 60pt and in a grayscale rendering before accepting it.

- assets/images/splash-icon.png — its own crop for the splash's safe area, referenced from app.json's expo-splash-screen plugin at imageWidth 200.

- assets/images/android-icon-foreground.png — its own crop for the adaptive-icon safe area, which is a different circle than either of the above.

- assets/images/brand-mark.png — leave as the in-app mark; it is the one of the three that is currently correct for its use.

- docs/APP_STORE.md — flip 'App icon final pass' once done, and record the three-crops-not-one-file rule so it is not re-collapsed.

**Tests.** None automated. This is 'does it look right' and per change-review nothing but the pictures answers it: render the 1024 at 60pt, in grayscale, and beside five competitors in a mock search row before accepting it.

**Risk.** The icon path is native config, so replacing the file needs an EAS build — land it before platform-native-config-batch so one build carries both, or the icon waits for the next one. A placeholder shipping as the store icon is the kind of thing noticed only after launch.

**Waits on.** none, beyond approving the artwork.

## Businesses: signup, My business, the listing, and the traveler-facing page

The business side is well built in pieces and badly joined at the seams. Three seams do most of the damage: the twelve-step signup builds a whole listing before telling the owner it is invisible without an email code; the photo step gates on a count that only counts approved photos and renders an empty black screen while it waits; and four steps that look like signup drop the owner into the middle of a 1,430-line settings form. None of those is a missing feature, they are all wiring between things that already exist, which is why most of this plan is medium-sized and ships over the air. A second theme is that the business is the one account with an incentive to market the app for free, and it is given nothing to market with: no share, no QR, no link, no number that comes back from the world. A third, smaller theme is one voice: the same fact is stated two ways on two tabs, the banned noun "place" still ships in three strings on the traveler page, and the boot screen says "Retry" where every other screen says "Try again". What the founder is really deciding here is how much of §10's deferred list to un-defer: a what's-on list, any business-facing number at all, and a real domain for shareable links are each individually cheap and each individually something the plan said would wait. Only two things in this plan touch the database in a way that matters, and one of them (the rename trigger) is a safety control being narrowed, not removed.

### `biz-copy-pass` — One voice: kill the banned noun, the developer word, and the two-sided facts

**Priority** now · **Effort** S · **Ships as** over the air

Three shipped strings on a business's own page call it a "place", which the founder banned on 2026-08-28, and one of them sits eleven lines under "Rate this business" so the screen contradicts itself inside one scroll. The boot-failure screen says "Retry" directly under body copy that says "try again". The storefront loading note reads as an idiom about winning custom. Chat says "0 people here" about the same room My business calls "Nobody in yet". And the higher-stakes of the two report forms omits the anonymity promise the lower-stakes one gives, which converts directly into unfiled reports by the people the product most needs to keep.

<details><summary>Closes 8 audit findings</summary>

- The guest report action on a business page uses the banned word "place"

- "Report this place" ships the banned word to travelers on every business page

- "Report this place" ships the banned word, and disagrees with the screen it opens

- Two labels for retrying, one of them a developer's word

- "Getting your business." is a loading note that reads as an idiom

- The owner's first day says "0 people here" in one place and "Nobody in yet" in another

- Reporting a person never says it is anonymous, though reporting a business does

- The first business screen is headlined with a traveler question and a paragraph of admin

</details>

**Changes**

- src/app/place/[id].tsx — line 528 Alert title, line 534 guest link text and line 631 signed-in link text all become 'Report this business', matching src/app/report-place.tsx:57. Leave the accessibilityLabels (`Report ${place.name}`) and the internal `where="place"` analytics key at :516 alone.

- src/app/\_layout.tsx — line 60 `label="Retry"` becomes `label="Try again"`, which also makes the button echo its own body text at :58.

- src/app/business-signup.tsx — line 371 'Try loading the cities again' shortens to 'Try again'; the body copy at :446 already names the city list.

- src/app/business-storefront.tsx — line 177 'Getting your business.' becomes 'Finding your business.' Leave the neighbouring note at :178 untouched.

- src/app/(tabs)/chat.tsx — line 316 wraps the member-count preview so a room with zero members reads 'Nobody in yet', matching src/app/(tabs)/my-business.tsx:640-644, keeping the count for one or more and keeping the ` · you leave …` clause.

- src/app/report.tsx — subtitle at :66-69 becomes 'A real person reads every report. They are never told who reported them.' and the confirmation body at :50 becomes 'Thanks. A real person reads every report, and they will not know it was you.' No timeframe claim; the two action buttons at :50-59 stay above the fold.

- src/app/(auth)/join.tsx — line 139 'customers' becomes 'travelers' and 'when creating your profile' becomes 'on your business page', matching CHANGE_LATER at business-signup.tsx:81. The title branch and the shorter subtitle are the founder decision below, not this package.

- src/app/(tabs)/my-business.tsx — line 436 `transition={180}` becomes `transition={Motion.standard}`; add `Motion` to the '@/constants/theme' import at :17-24.

**Tests.** jest: add to the existing 'does not call a business a place' test in src/app/**tests**/business-edges.test.ts — `expect(src('src/app/place/[id].tsx')).not.toContain('Report this place')`. E2E: re-shoot the place page in the signed-in tour and 72-business-chat.png; the chat row must read 'Maestro Cafe / Nobody in yet'. Do not loosen the assertion to a wildcard.

**Risk.** Low. The one thing to get wrong is editing the analytics `where` keys for tone — sign-up-gate.tsx:24-31 documents them as deliberately stable labels, and renaming one silently breaks a funnel nobody is looking at.

### `biz-where-step` — Step 4: grey the blocked Continue, say the launch state, and take a name for city five

**Priority** now · **Effort** S · **Ships as** over the air

On "Where is it?" with no city chosen, Continue renders in full accent blue and tapping it does nothing at all — no haptic, no message, not even a change to the note, because the note is computed from `city == null` alone and setTouched changes nothing on this step. Every other step in the app greys a blocked primary. The same screen shows four cities with no explanation that the app has only launched in four, says the same thing twice in two different sentences, and leaves roughly 800pt of void under the chips. A hostel in Porto hits a wall, quits, and the app never learns they existed, which is exactly the demand signal a launch-dense GTM needs to pick city five.

<details><summary>Closes 2 audit findings</summary>

- Business signup step 4: a full-brightness Continue button that silently does nothing when tapped

- Four cities, no explanation, and no path for a business anywhere else

</details>

**Changes**

- src/app/business-signup.tsx — step 4's StepShell (:339-375) gains `continueDisabled={city == null || coords == null}`, which routes through PrimaryButton's unavailable path (surfaceSunken fill, textSecondary label) rather than the opacity fade the traps skill measures at 2.35:1. Do NOT also add the shake: PrimaryButton passes `disabled` down to PressableScale, so a disabled button never fires onPress and the shake could not play.

- src/app/business-signup.tsx — the note at :346-354 drops its `city == null` branch (the grey button now carries that), leaving the addressFocused and coords branches.

- src/app/business-signup.tsx — the placeholder body at :443-453 becomes the launch-state sentence: "We're in four cities so far. Pick yours above and the map shows up." derived from `launchCities.length` rather than hardcoded, so it stays true when city five lands.

- src/app/business-signup.tsx — under the ChipRow at :376-396, add a quiet PressableScale row reading 'Somewhere else? Tell us where.' that pushes '/contact' (the route already exists and is used from profile-me.tsx:154). This is also what fills the void the screenshot shows.

- src/app/business-signup.tsx — step 4's subtitle at :345 keeps 'Type your address, then check the marker is on your door.'; the launch state belongs in the body, not the subtitle, so the sentence a person reads while typing does not change.

**Database.** none. The `city_interest` table is deliberately not built — /contact carries the same signal with zero schema, and "request" is a word §7 rule 7 keeps out of this app even in a table name.

**Tests.** jest in src/app/**tests**/business-edges.test.ts: assert business-signup.tsx contains `continueDisabled={city == null || coords == null}` and no longer contains `'Pick your city first.'`. E2E: re-shoot 42-business-where-empty.png — the Continue must be grey and the screen must not repeat itself. Screenshots are the evidence here, not the exit code.

**Risk.** Low. Watch that the /contact route opens as a modal over a StepShell rather than under a Sheet — business-signup is a plain screen, not a Sheet, so the `leavingSheet` trap does not apply, but confirm the back gesture returns to step 4 with the chips still unset.

### `biz-photo-grid-in-place` — Put the real photo grid inside step 7, and count the photo the owner can see

**Priority** next · **Effort** L · **Ships as** over the air

Step 7 is a headline, three lines of subtitle and roughly 1000pt of black, and its Continue gates on `detail?.photos?.length`, which comes from business_detail and filters `moderation_status = 'approved'`. With require_photo_moderation ON — which is how production runs — an owner adds their cover, sees it chipped "In review" in the editor, comes back, and is told "One photo is the only thing we need here" with a button that still says "Add photos". A photo the worker rejects pins that state forever with no reason given. The same approved-only read makes My business say "Nothing yet" about a photo that is on screen one tap away, and fall back to a category glyph while a real cover is in review. Meanwhile the editor's Cover chip and its remove-confirm are computed from the lowest position regardless of moderation, so the confirm asks "Remove your cover photo?" about a photo nobody outside can see.

<details><summary>Closes 5 audit findings</summary>

- The cover photo wall never lifts: signup counts only approved photos

- The business photo step is a blank screen: a title, a subtitle, and roughly 1000pt of nothing

- The photo, description, hours and links steps are ninety percent empty black

- Signup's clean steps hand off into the middle of a 1,430-line settings form

- The business editor labels a photo "Cover" that the public cannot see

</details>

**Changes**

- src/features/business/business-photos.tsx — NEW. Move PhotoTile (business-edit.tsx:439-492), BusinessPhotos (:494-640), uploadBusinessPhoto (:190-210), deleteBusinessPhoto (:212-226), useBusinessPhotos (:244-250), the PHOTOS_MAX / PHOTO_COLUMNS / PHOTO_GAP constants (:69-72) and the tile/grid/emptyTile/tileChip/removeAnchor/removeDot styles (:1387-1429). Export a pure `coverIdOf(photos)` that returns the id of the first photo with `moderation_status === 'approved'`, else null. Add an optional `registerPick?: (fn: () => void) => void` prop so a docked button can drive the same picker as the dashed tile.

- src/features/business/business-photos.tsx — the helper line 'Photos of the business, not of a person. The first one is your cover.' becomes '…The first one that clears is your cover.' When no approved photo exists, render one line under the grid: 'Nobody sees a cover until one of these clears.' confirmRemove's title uses coverIdOf, so a pending photo gets 'Remove this photo?'.

- src/app/business-edit.tsx — delete the moved code and import BusinessPhotos from the new file at :1299. The `section` param, the measure() anchors and the Save semantics are untouched.

- src/app/business-signup.tsx — step 7 (:605-637) renders `<BusinessPhotos businessId={business.id} userId={userId} registerPick={…} />` inside StepShell instead of routing to /business-edit. `photoCount` comes from useBusinessPhotos (owner-scoped, RLS'd by business_photos_select_own) not `detail?.photos`. Continue is enabled on `photos.some(p => p.moderation_status !== 'rejected')`; the docked button says 'Add photos' and calls the registered picker while the grid is empty, and 'Continue' once it is not. Note branches: in review → "We're having a look at your photos. This usually takes a minute." (the string my-business.tsx:514 already ships); all rejected → "That one didn't pass. Try another, of the business rather than a person."; otherwise CHANGE_LATER.

- src/app/business-signup.tsx — the step 7 subtitle at :612 and the ListingPreview cover at :886 both assume photo[0]; the subtitle takes the same 'first one that clears' wording and the preview keeps reading `detail.photos` (approved-only) because that preview is honestly showing what a traveler gets.

- src/app/(tabs)/my-business.tsx — the hero cover at :277 and the Photos row at :618-627 read useBusinessPhotos instead of `detail.photos`. The row's value says e.g. '1 photo, in review' when nothing has cleared yet, so the owner is never told they have nothing.

- src/app/**tests**/business-edges.test.ts — the existing assertion `continueLabel={photoCount > 0 ? 'Continue' : 'Add photos'}` no longer matches and must be rewritten against the new gate, not deleted.

- e2e/flows/business-tour.yml — lines 180-210: after pick-a-photo, assert the tile chip 'In review' is visible on step 7 rather than waiting up to 120s for '1 added. Add more', and drop the `optional: true` from that wait so a failure is a failure. The conditional block at :213-260 can then run unconditionally, which is what finally photographs steps 8 through 12.

**Database.** none.

**Tests.** jest: src/features/business/**tests**/business-photos.test.ts on `coverIdOf` — empty list, all pending, first pending and second approved (the cover is the second), first rejected. jest in business-edges.test.ts: business-signup imports BusinessPhotos and gates on `moderation_status !== 'rejected'`. E2E: re-shoot 48/49/50 — 48 must show dashed tiles, not void, and 50 must show a tile with an 'In review' chip and an enabled Continue. This is exactly the case the change-review brief means by "does it look right": read the pictures.

**Risk.** Two. (1) Do NOT fix this by widening business_detail — it is `security definer` and granted to anon (20260829160000:332), so a pending-photo count added there tells any traveler that a non-approved photo exists. The owner-scoped table read is the safe door. (2) Run 87 photographed two identical 'Add photos' buttons adrift on this step; the dashed tile and the docked button must not become that pair again, which is why the docked button drives the same picker and relabels the moment a photo lands.

### `biz-progress-and-numbering` — Make the progress bar speakable, numbered, and honest about how many steps there are

**Priority** next · **Effort** M · **Ships as** over the air

The bar is two plain Views with no accessibilityRole, no accessibilityValue and no text alternative, so a VoiceOver user swiping thirteen screens gets a Back button and a form and no idea how much is left. Sighted users get a 4pt hairline. Worse, the business flow's arithmetic is wrong twice: /join passes SIGNUP_TOTAL_STEPS = 13 for both account kinds, so a business goes 1/13, 2/13, then 3/12 and the bar jumps backwards in meaning; and "One last thing" renders as step 12 of 12 so the bar fills completely, then hands over one more screen — the code entry that, in the flow's own words, is what turns the lights on — drawn by StepScreen with no bar at all. docs/ONBOARDING.md §4 already says step 12 is the code and has never listed the extra screen.

<details><summary>Closes 2 audit findings</summary>

- The 13-step progress bar is invisible to VoiceOver and carries no number for anyone else

- The business progress bar reaches 100% one screen before the flow ends, and the last screen has no bar at all

</details>

**Changes**

- src/features/signup/step-shell.tsx — the track View at :104 gains `accessibilityRole="progressbar"`, `accessibilityValue={{ min: 1, max: total, now: step }}` and `accessibilityLabel={`Step ${step} of ${total}`}`. The right-hand `backSlot` at :107 (currently an empty mirror) holds a `caption`/textSecondary `${step} of ${total}`, which also balances the header row.

- src/features/signup/steps.ts — export `BUSINESS_TOTAL_STEPS = 12` beside SIGNUP_TOTAL_STEPS, with the same note about spanning two stacks.

- src/app/(auth)/join.tsx — lines 129 and 215 take `total={forBusiness ? BUSINESS_TOTAL_STEPS : SIGNUP_TOTAL_STEPS}`.

- src/app/business-signup.tsx — line 59's local `TOTAL_STEPS = 12` is replaced by the imported BUSINESS_TOTAL_STEPS so one constant serves both stacks.

- src/app/business-signup.tsx — the step 12 screen (:783-803) is folded into step 11: the ListingPreview stays, the 'SENDING IT TO <email>' card and the 'Use a different address' ghost move up beneath it, the continue label becomes 'Email me a code' and calls sendCode. The 'One last thing' screen goes away; the consequence sentence it carried moves to step 6 in biz-email-lands-early.

- src/app/business-email.tsx — swap StepScreen (:9, :182) for StepShell with `step={12} total={BUSINESS_TOTAL_STEPS}`, no onBack (this screen is arrived at by router.replace, so there is nothing behind it). Keep the whole body, the resend path and the `router.replace('/(tabs)')` on success unchanged.

- docs/ONBOARDING.md §4 — the step 11 row gains 'and sends the code'; the table's step count is already right and does not move.

**Tests.** jest component test (src/features/signup/**tests**/step-shell.test.tsx, alongside the existing visibility.test.tsx pattern): render StepShell at step 5 of 13 and assert the progressbar role, the accessibilityValue and the visible '5 of 13'. jest in src/app/**tests**/onboarding-sequence.test.ts: assert `BUSINESS_TOTAL_STEPS = 12` and that join.tsx branches its total on forBusiness. E2E: re-shoot 41/42/48 and add a screenshot of the code screen showing a full bar and '12 of 12'.

**Risk.** Do not renumber steps 3-11 — business-signup.tsx:304-756 already matches docs/ONBOARDING.md:105-117 exactly, and the mismatch is one extra screen, not a shifted sequence. The other risk is business-email.tsx: it currently owns its own chrome, and StepShell adds a KeyboardFloor around a six-digit field. That is the right primitive (traps: KeyboardAvoidingView measures against its parent), but the code field's autofocus must be re-checked on a device-sized screen.

### `biz-email-lands-early` — Say what the email costs where the email is asked for, and let the code be typed at any point

**Priority** next · **Effort** L · **Ships as** over the air

A bar owner types a name and category, an address checked against a marker, a contact block, photos through the triple permission chain, a description, hours and links, then reviews the finished listing on step 11 under the heading "Exactly what a traveler sees when they tap you" — and only then reads "Nobody can find you until an email proves somebody reads that inbox." Step 11 makes step 12 read as a bait. register_business has already inserted the row as 'unconfirmed' and city_businesses filters on `state = 'listed'`, so every owner who abandons in their mail app has done nine screens of work that produce a row no traveler can see, and cannot start again as a traveler either.

<details><summary>Closes 1 audit findings</summary>

- A business builds its entire listing before being told it is invisible until an email

</details>

**Changes**

- src/app/business-signup.tsx — EMAIL_REASON at :72-73 states the cost where the email is asked for: 'The code goes here, and this is the address travelers write to. Nobody can find you on the map until you type that code in.'

- src/app/business-signup.tsx — saveContacts (:230-276) fires `requestCode.mutateAsync(email.trim())` after the contacts save succeeds and before `go(7)`, without awaiting it into the Continue path (a mail failure must not block the form; the code screen and the dashboard both already surface a bounce through useBusinessCodeStatus).

- src/app/business-signup.tsx — a new `ConfirmEmailFooter` rendered as StepShell's `footer` on steps 7, 8, 9, 10 and 11: a six-digit FormTextField plus a quiet 'Confirm your email' action calling useConfirmBusinessEmail() INLINE. It must not push /business-email — that screen ends with `router.replace('/(tabs)')` (business-email.tsx:153), which would drop a mid-signup owner out of the flow with an unfinished listing. On success it navigates nowhere; `business.state` flips to 'listed' and the footer collapses to 'You are on the map.'

- src/app/business-signup.tsx — the footer also reads useBusinessCodeStatus + the twenty-minute run-out (the same shape as my-business.tsx:66-78) and offers 'Send a fresh code' once the first has expired, so an owner who spends 25 minutes on photos is not typing a dead code.

- src/app/business-signup.tsx — step 11's ListingPreview is badged 'Not on the map yet' while `business?.state === 'unconfirmed'`, so the promise the heading makes is qualified on the screen that makes it.

- src/app/business-signup.tsx — step 11's continue (now the send-the-code step after biz-progress-and-numbering) branches: if the state is already 'listed', the label reads 'You are on the map' and it routes to /(tabs); otherwise it sends and replaces to /business-email as today, and it must NOT send a second code when one is already live and unexpired.

**Database.** none. request_business_email_confirmation and confirm_business_email are unchanged.

**Tests.** jest in src/app/**tests**/business-edges.test.ts: assert saveContacts calls requestCode before go(7), that the steps-7-to-11 footer calls useConfirmBusinessEmail and contains no `router.replace`, and that EMAIL_REASON names the consequence. E2E business-tour.yml: after the contact step, assert the 'Confirm your email' footer is visible on the photos step, and screenshot it. Nothing here is testable in pgTAP; the server side is unchanged.

**Risk.** The daily cap on codes is five. Sending at step 6 and again at step 11 spends two, which is fine, but a resend loop in the footer could burn the rest — cap the footer's resend on the same run-out timer rather than letting it be pressed freely. Second risk: confirming inline while the signup form holds its own state means `business.state` changes underneath a mounted StepShell; useOwnBusiness has a 5-minute staleTime, so the confirm mutation's existing invalidation of ['my-business', userId] is what makes the badge update — check it actually re-renders rather than sitting on the cached row.

**After.** `biz-progress-and-numbering`

### `biz-rename-is-not-a-hijack` — Stop punishing accuracy: a diacritic or a ten-metre nudge must not cost the check

**Priority** next · **Effort** M · **Ships as** Supabase deploy only

business_rename_resets compares name, city_id, lat and lng with `is distinct from`, so changing "Cafe Janis" to "Café Janis", or moving the marker onto the actual door, nulls verified_at and drops a listed business back to 'unconfirmed'. The badge was earned by somebody standing outside taking two photos, and it is destroyed by a typo fix. The alert warns honestly, which means the app is honestly telling owners that the safest thing they can do is leave a wrong name and a wrong marker alone — and those are exactly the corrections that make the map better.

<details><summary>Closes 1 audit findings</summary>

- Fixing a typo in your name deletes your verification and takes you off the map

</details>

**Changes**

- supabase/migrations/20260901000000_a_typo_is_not_a_hijack.sql — NEW. `create or replace function public.business_rename_resets()` (it is a trigger function, not a RETURNS TABLE function, so no drop-and-regrant is needed here; the drop rule in AGENTS.md applies to OUT columns). Compare names normalised: `public.immutable_unaccent(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))` — that helper already exists (20260816200000:19). Replace the raw lat/lng comparison with `public.haversine_km(old.lat, old.lng, new.lat, new.lng) > 0.075` (haversine_km exists, 20260816210000:65). Keep the display_name mirror at :362-365 on any literal name change. Keep the full reset — verified_at nulled, state back to 'unconfirmed', listed_at cleared — for a normalised rename, a city change, or a move over 75m. A case or accent change alone resets nothing.

- src/app/business-edit.tsx — the save alert at :985-997 no longer promises the check goes with it on a name change: 'Travelers stop seeing {name} until you type a new email code. Your check stays.' Only a city change or a >75m move keeps the old wording.

- src/app/business-edit.tsx — `markerMoved` at :926-927 stays as the trigger for calling update_business_location (any move should still be saved), but a new `markerMovedFar` (same 75m haversine, in JS) is what drives the warning footnote at :1174-1178 and the alert branch. A ten-metre nudge then produces no warning at all.

- src/app/business-edit.tsx — the always-on footnote under the Name field at :1087-1091 loses its claim about the check and says only that the listing comes off the map until the email is confirmed again.

- src/app/(tabs)/my-business.tsx — with verified_at preserved through a rename, the !business.verified notice at :506-533 stops firing after a typo fix, so a renamed business is pointed at /business-email and not at /business-storefront. Verify no other branch sends them to the storefront screen for a reason that no longer exists.

**Database.** 20260901000000_a_typo_is_not_a_hijack.sql — create or replace of the business_rename_resets trigger function. No signature change, no OUT columns, so no drop-and-regrant. Re-state nothing.

**Tests.** pgTAP, written as the attack, in a new supabase/tests/database/30_a_typo_is_not_a_hijack.test.sql: (1) 'Cafe Janis' → 'Café Janis' leaves verified_at and state untouched; (2) a 10m marker nudge leaves both untouched; (3) 'Surf Shack' → 'Marriott' nulls verified_at AND drops state to 'unconfirmed'; (4) a 500m move does the same; (5) a city_id change does the same. jest: a unit test on the shared 75m JS helper. This is a privacy/anti-impersonation control, so the test has to try the hijack, not assert the happy path.

**Risk.** This narrows an anti-impersonation control, which 20260827120000:480-483 records as existing precisely to stop a verified surf shack becoming the Marriott. The threshold is the whole argument: 75m is wider than a doorway and narrower than a different building, and normalisation is what makes 'Marriott' still trip while 'Café' does not. Do not go further and preserve verified_at through a genuine rename — the re-confirmation email goes to the same inbox the surf shack registered, so the badge would survive the exact attack.

### `biz-share-your-listing` — Give a hostel something to point at: a link, a share sheet and a QR for the counter

**Priority** next · **Effort** M · **Ships as** over the air

The map is the only route to a business page. An owner who wants "we're on Samewhere" on the wall behind the bar, in a booking confirmation or on Instagram has nothing to point at. `Share` appears exactly once in all of src/ — the group invite at group/[id].tsx:293 — so the feature exists for chats and not for the businesses whose foot traffic is supposed to seed the map. §2.6's whole GTM is hostel partnerships and creator marketing, and both of those are links. This is the cheapest liquidity lever in the product and it is entirely wiring: app.json:8 already declares the scheme and src/features/groups/invite-qr.tsx already renders any URL as a scannable square with no native module.

<details><summary>Closes 3 audit findings</summary>

- A hostel has no way to tell anyone it is on Samewhere

- Nothing but a group chat can be shared, and a business has no way to tell anyone it is listed

- Nothing in the app can be shared: no listing link, no plan link, no invite a friend

</details>

**Changes**

- src/features/business/share-listing.ts — NEW. `listingUrl(id)` returning `Linking.createURL(`/place/${id}`)` and `shareListing({ id, name })` calling `Share.share` with one string, the same single-message shape group/[id].tsx:293 uses so it lands intact in a text message or the clipboard.

- src/app/(tabs)/my-business.tsx — a 'Share your page' Section above 'Your account' with two DetailRows: one calling shareListing, one toggling `<InviteQr url={listingUrl(business.id)} />` open. The QR is the hostel-counter case and needs no native module, so it ships over the air.

- src/app/place/[id].tsx — a 'Share this business' ghost button in the signed-in traveler actions block (after 'Rate this business' at :607-617) and in the isOwner block at :500-510. Not in the guest branch: a guest's next move is the account, which SignUpGate already asks for.

- src/features/business/share-listing.ts — the copy must say 'business', never 'place' (vocabulary.ts:16-21), and must not be worded as an invite to a person.

**Tests.** jest: src/features/business/**tests**/share-listing.test.ts asserting listingUrl builds a /place/<id> path and that the shared message contains the business name and no banned vocabulary. E2E: add a screenshot of My business with the QR open, so the founder can point a phone at it.

**Risk.** A `samewhere://` custom-scheme link opens nothing for a recipient who does not have the app, so today this is useful for the QR-at-the-counter case and half useful for the Instagram case. Making it a real link is the founder decision below and it needs a build, not this package. Do not add a web fallback card that publishes a business page on the open web without asking — that is a second door onto content the app currently gates.

**Waits on.** Do we own samewhere.app, and do we spend an EAS build on universal links now? FOR: a custom-scheme link is dead for anyone who does not already have the app, which is every person a hostel is trying to reach, so the share feature only half works without it. AGAINST: it costs an EAS build, an apple-app-site-association file on a domain that may not exist yet, and an app.json change, and the QR at the counter — the case §2.6 actually names — works today without any of it.

### `biz-my-business-worth-opening` — Make My business worth opening on a Tuesday, and turn the account page into settings

**Priority** next · **Effort** M · **Ships as** over the air

My business shows what's on, your details, your chat, your rating, your account — every one of them something the owner typed in. The only signal that comes back from the world is a rating that renders nothing until five travelers have rated. Nothing is recorded either: analytics.capture fires nowhere on place/[id].tsx or place-sheet.tsx at all, so when the founder does want a Tuesday number there will be no history to draw it from, and §6 asks for liquidity metrics from day one. Meanwhile the Your details section is a column repeating "Nothing yet" four times with nothing to say which of them changes what travelers see, ordered by data model rather than impact. And the account page it points at opens with a large button back to My business, with a subtitle admitting the loop.

<details><summary>Closes 3 audit findings</summary>

- An owner is given no reason to open the app on Tuesday, and no return is even recorded

- My business reads as five rows of "Nothing yet" to an owner who has just signed up

- The business account page and the My business tab are two doors to the same room

</details>

**Changes**

- src/app/place/[id].tsx — fire `analytics.capture('business_page_viewed', { business_id: place.id })` in an effect, guarded on `!isOwner` so the owner's own visits do not dominate the history. Fire `business_link_tapped` from LinkRow's onPress at :227-231 with the link kind, not the value.

- src/features/business/place-sheet.tsx — fire the same `business_page_viewed` when the sheet opens on a tapped marker, with a `source: 'sheet'` property so the two surfaces stay separable.

- src/app/(tabs)/my-business.tsx — a 'How it's going' Section above 'Your rating' with one honest line built from data that already exists: `detail.member_count` for the room, and the count of business-kind chats created in the last seven days from useMyChats() — 'Two travelers wrote to you this week'. It counts conversations, never senders, so nothing about who wrote or who rated appears beside the rating block, which :654-657 records as the anti-retaliation control.

- src/app/(tabs)/my-business.tsx — reorder the Your details rows (:586-627) by impact on the map: photos, hours, description, links, with 'Where you are' staying first. Replace the four 'Nothing yet' values with what each buys, in the register :569-571 already sets ('Nothing on right now. A quiz night, a happy hour, whatever's happening this week.'): 'Add photos so you have a cover', 'Add hours so travelers know when to come', 'Say what it is like', 'A menu, a booking page, your socials'. Keep 'No address yet' as it is.

- src/app/(tabs)/my-business.tsx — a single progress line above the section, '3 of 5 done', so the owner can see the end. Keep the skeletons at :543-552.

- src/app/profile-me.tsx — in BusinessAccount (:113-210) drop the 'Manage your business' PrimaryButton (:125-129) and the subtitle at :124 that explains it; retitle the page 'Account' under the business name. The back gesture is the way back, and removing the button also removes the surface of the bug the comment at :118-123 describes. Note the page is also reachable from avatar-button.tsx:55, where back returns to whatever tab the owner came from, which is correct for a settings screen.

**Tests.** jest in a new src/app/**tests**/business-home.test.ts case (the file exists): assert my-business renders the four detail rows in the photos/hours/description/links order and contains none of the bare 'Nothing yet' strings; assert the How it's going line names no user id. jest: place/[id].tsx guards business_page_viewed on !isOwner. E2E: re-shoot 70-business-my-business.png and 73-business-account.png — 73 must no longer open with a button back to the tab that sent you.

**Risk.** docs/BUSINESS_ACCOUNTS.md:884 defers 'business analytics', so the visible half of this needs the founder's word (below). The events themselves are three lines and are not an analytics product — they are the history that makes one possible later. Keep the 'How it's going' line to what already exists; the moment it needs a table it has stopped being this package.

**Waits on.** Does 'How it's going' count as the business analytics §10 defers? FOR shipping it: it is one sentence from data already on the screen, it costs no table, and it is the only thing that makes the tab worth opening before five people have rated you. AGAINST: §10 deferred business analytics deliberately, and a number on a dashboard is how a scope creeps into a views/taps/saves product nobody asked for.

### `biz-report-conduct` — Let a traveler report how a business behaved, not just whether the listing is accurate

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

Businesses on this map are hostels and bars — the physical places travelers are being encouraged to go and meet strangers at. Four of the five report reasons are map-accuracy complaints and the fifth is "Spam or something offensive". A woman harassed by whoever is behind a hostel's business account has no honest option, and reporting the individual is no better: the chat header menu pushes /report with `chat.other_user_id`, which on a business thread is the owner as a person, so the report lands in the wrong queue named after the wrong subject. Research finding 2 says the negative reviews in this category cluster on creep and unaddressed harassment.

<details><summary>Closes 1 audit findings</summary>

- A business can only be reported for being the wrong listing, never for how it treated a traveler

</details>

**Changes**

- supabase/migrations/20260901010000_a_business_can_behave_badly.sql — NEW. `alter type public.business_report_reason add value if not exists 'harassment_or_conduct';` and the same for `'unsafe'`. No function signature changes, so no drop-and-regrant. Then `create or replace function public.on_business_report()` (20260827120000:619) gains a branch: for those two reasons it also writes a moderation_events row with `entity_type = 'business'`, `action = 'conduct_report'` so the human queue sees it beside person reports, and the outbound_mail subject says conduct rather than listing.

- src/features/business/vocabulary.ts — REPORT_REASONS (:97-103) gains { value: 'harassment_or_conduct', label: 'Somebody here treated me badly' } and { value: 'unsafe', label: 'It felt unsafe' }, placed above 'Spam or something offensive'.

- src/app/report-place.tsx — the Details field's placeholder at :106 branches on the chosen reason: for the two conduct reasons it asks 'What happened?' rather than 'Anything else worth knowing?'. The confirmation at :45-49 gains one clause for those reasons: a conduct report can take a listing off the map, since the current copy only promises anonymity.

- src/app/chat/[id].tsx — the Report item in openMenu (:137-145) branches: when `chat.kind === 'business'` and the viewer is not the business, push /report-place with the business id from useBusinessForChat(chat.chat_id) and the business name; when the viewer IS the business, keep /report with other_user_id, which is a real traveler.

- src/lib/database.types.ts — regenerate for the two new enum values.

**Database.** 20260901010000_a_business_can_behave_badly.sql — two enum values added to public.business_report_reason, plus a create-or-replace of on_business_report(). No RETURNS TABLE signature changes, so no drop function needed; grants on on_business_report are unchanged by a create-or-replace.

**Tests.** pgTAP in supabase/tests/database/23_business_messages_ratings.test.sql: a traveler can file a conduct report; the owner cannot report their own listing; a business account is refused outright (is_business_account, 20260828160000:38); the moderation_events row exists for a conduct reason and does not for an accuracy reason. jest: chat/[id].tsx routes a business thread to /report-place. E2E: screenshot the report screen showing all seven reasons.

**Risk.** `alter type … add value` cannot be used in the same transaction that adds it, which is fine here (nothing in the migration inserts one), but if a later statement in the same file references the new label the deploy dies after the earlier statements have applied — the exact failure mode AGENTS.md warns about for function signatures. Keep the enum addition and any use of it in separate migrations if that ever changes.

### `biz-value-before-the-form` — One screen that says what a listing is, that it is free, and who is here

**Priority** next · **Effort** M · **Ships as** over the air

The entire value proposition a business is given is one 14-word radio subtitle — "A listing on the map, and travelers who can message you" — on a screen headlined "What is your email?". Then twelve steps of work begin. The word free appears nowhere an owner can read it: grep across src/ returns sign-up-gate.tsx:56 and profile-me.tsx:364, both traveler-facing. A hostel manager handed a flyer has no idea whether this costs money, who the travelers are, or what a listing looks like, and is asked to type an address before finding out. §7 rule 1 makes the app permanently free and nothing in the business flow says so.

<details><summary>Closes 1 audit findings</summary>

- Nothing in the business flow says what an owner gets, or that it is free

</details>

**Changes**

- src/app/business-signup.tsx — a new step 3 before 'What's your business called?', pushing the existing steps to 4-12 and BUSINESS_TOTAL_STEPS to 13 (which then matches the traveler count, so /join's branch collapses back to one constant — keep the branch anyway, it costs nothing and is honest if the two diverge again).

- src/app/business-signup.tsx — the new step renders the existing ListingPreview (:874) filled with a seeded venue for whichever city is picked, plus two sentences: what a listing is, and 'Free, always. No paid placement, no promoted listings.' No new component and no new data model — useLaunchCities and the businesses seed (20260827150000_seed_business_content.sql) already hold everything.

- src/app/business-signup.tsx — the step gets no Skip: it is one tap and it is the offer.

- docs/ONBOARDING.md §4 — insert the new row and renumber the table so the doc and the code do not drift again.

- src/app/**tests**/onboarding-sequence.test.ts — update the expected business count.

**Database.** none, unless the founder wants the live traveler count (see the decision), which needs a new city-level aggregate floored at launch_cities.heat_k.

**Tests.** jest in business-edges.test.ts: the new step exists before the name step, contains the word 'Free', and renders ListingPreview rather than a bespoke card. E2E business-tour.yml: assert the new headline before 'What's your business called?' and screenshot it — this is the screen that decides whether a bar owner keeps going, so the picture is the evidence.

**Risk.** Adding a screen to a twelve-step flow is the wrong instinct unless the screen removes work later, which this one does by answering the question every later step assumes has been answered. The number-of-travelers line is the part that can go wrong: launch_cities (20260816210000:20) has no such column, so it needs a new aggregate, and a quiet city publishing '1 traveler here' is the same shape of leak §7 rule 6 exists to stop.

**Waits on.** Do we show a live traveler count per city on this screen? FOR: 'four hundred travelers in Lisbon this month' is the single most persuasive sentence we could put in front of a hostel manager, and §6 wants that number computed anyway. AGAINST: launch_cities has no such column so it needs a new aggregate, and in a thin city an honest number is an argument against signing up — it would have to be floored at the same k-threshold the heatmap uses, which means in a quiet city it says nothing at all.

**After.** `biz-progress-and-numbering`

### `biz-hours-gap-named` — Say "Hours not set" rather than silently omitting the question a traveler came to answer

**Priority** next · **Effort** S · **Ships as** over the air

Signup rightly tells owners not to guess their hours and lets step 9 be skipped. The consequence on the traveler side is that place/[id].tsx renders no open line in the meta row and no Hours section at all, so "should I go there tonight" is not answered and not acknowledged — the absence is indistinguishable from a section that failed to load. A traveler standing on a street at 22:00 gets a description and a photo and no way to tell whether the door is open.

<details><summary>Closes 1 audit findings</summary>

- A business with no hours silently omits the question a traveler came to answer

</details>

**Changes**

- src/app/place/[id].tsx — the gate at :433-435 always renders the Hours section; when `hours.length === 0 && !place.hours_note` it renders one line, 'Hours not set'. The meta row at :367-382 is left alone: an absent open line there is correct, and duplicating the gap in two places would make it louder than the business.

- src/app/place/[id].tsx — where `place.claimed` is true (the flag already checked at :586), put the existing Message button directly beneath that line so the traveler's next move is obvious rather than three sections down.

- src/features/business/place-sheet.tsx — the same one-line treatment on the tapped-marker card, so the sheet and the page do not disagree about whether a business has told anyone when it is open.

**Tests.** jest: src/features/business/**tests**/vocabulary.test.ts already covers openLine; add a case asserting it returns null for an empty hours array so the new branch is reached. E2E: screenshot a seeded business with no hours on both the sheet and the page.

**Risk.** Low. Do not turn this into a nag on the owner's side — my-business already has a Hours row and the copy work in biz-my-business-worth-opening covers what it should say.

### `biz-edit-one-save-model` — Stop the edit screen promising you only lose what you typed

**Priority** next · **Effort** S · **Ships as** over the air

On business-edit, deleting a photo or removing a link is permanent the moment you tap it — BusinessPhotos owns a remove mutation on deleteBusinessPhoto and BusinessLinks owns its own add and remove — while the name, description, hours and marker are held until Save. `dirty` at :936 is `detailsChanged || hoursChanged || markerMoved`, so photos and links are not in it, and the guard alert at :1005 then says "You'll lose what you just typed", which is true of the text and false of the photo already destroyed. An owner tidying their page, changing their mind and tapping "Drop them" finds the photos gone and the description restored, with no way to tell which was which.

<details><summary>Closes 1 audit findings</summary>

- One edit screen, two save models: photos and links commit instantly, everything else does not

</details>

**Changes**

- src/app/business-edit.tsx — close() at :1000-1009: when photos or links have been touched this session, the alert reads 'Photos and links are already saved. Drop the rest?' and only offers to drop the held text. Track a session flag from the two child components rather than widening `dirty`, which drives Save and must not start saving photos.

- src/features/business/business-photos.tsx — confirmRemove's body says what it means: 'This one goes now, and it cannot be undone.' The delete stays immediate.

- src/features/business/business-photos.tsx and the links block — both call back to the parent on a successful mutation so the guard knows something is already committed.

**Tests.** jest in business-edges.test.ts: assert business-edit.tsx no longer contains the bare "You'll lose what you just typed" alert and that `dirty` still excludes photos and links. E2E: not worth a flow — the alert is a screenshot at most.

**Risk.** The tempting bigger fix — moving photos and links to their own routes — is a larger change than the bug, and business-edit already takes a `section` param that my-business's DetailRows deep-link into. Do the copy first; if the split ever happens it belongs with biz-inline-content-steps.

**After.** `biz-photo-grid-in-place`

### `biz-post-edit-and-repeat` — Let a post be fixed and put up again instead of only taken down

**Priority** next · **Effort** M · **Ships as** over the air

Once a post is up, a typo cannot be fixed: PostCard's only action is an alert offering "Keep it up" or "Take it down", so correcting "Live music at 9" means deleting and retyping. A weekly quiz night means retyping it every week. business_posts already carries `grant insert, update, delete … to authenticated` and the business_posts_write_own policy covers all of it, so both are client work on a permission that already exists.

<details><summary>Closes 1 audit findings</summary>

- A post has no default shape and cannot be edited or repeated

</details>

**Changes**

- src/app/(tabs)/my-business.tsx — PostCard's alert at :184-189 gains an 'Edit' option beside 'Take it down', pushing '/business-post' with a `postId` param.

- src/app/business-post.tsx — read `postId` from useLocalSearchParams; when present, seed title, body, shape, happensAt and endsAt from the row (a straight table read under business_posts_select_own), change the submit to an update rather than an insert, and change the docked label from 'Put it up' to 'Save it'. The cap logic at :199-236 must exclude the post being edited from the live count, or editing your third post tells you you are at the cap.

- src/app/(tabs)/my-business.tsx — a collapsed 'Recently taken down' list under What's on, reading business_posts directly where `archived_at is not null` (business_detail filters them out and always will), each row offering 'Post this again' which opens the composer prefilled with a fresh date.

- src/features/business/api.ts and hooks.ts — an `updateBusinessPost` and a `useUpdateBusinessPost` beside archiveBusinessPost (:274+), invalidating ['business-detail', id], ['business-posts', id] and ['city-businesses'] exactly as useArchiveBusinessPost does.

**Tests.** jest in business-edges.test.ts: the cap count excludes the post being edited; the composer's label changes with postId. pgTAP in an existing business test: an owner can update their own post and cannot update another business's, and screen_business_post still screens the edited text on UPDATE (it already branches on tg_op at 20260827110000:367-370). E2E: edit a post and screenshot the corrected card.

**Risk.** screen_business_post runs on UPDATE as well as INSERT and counts a re-archived post against the cap when archived_at goes back to null, so 'Post this again' must go through the composer rather than flipping archived_at directly, or the cap check is bypassed.

**Waits on.** Should the composer default `shape` to 'happens' at tonight 20:00? FOR: behind a bar during service, one required tap on a decision with an obvious answer is a tap that costs posts, and defaulting to the DATED shape cannot cause the accident the founder was guarding against. AGAINST: business-post.tsx:31-36 records the decision in as many words — 'keep it up has to be a choice somebody makes rather than the one they land on by not choosing' — and any default weakens that.

### `biz-inline-content-steps` — Give the description, hours and links steps something to look at and somewhere small to edit

**Priority** later · **Effort** M · **Ships as** over the air

Steps 8, 9 and 10 look like the rest of signup — one question, one docked button — and then the button drops the owner into a 1,430-line settings form scroll-positioned at a section. Screenshot 49 is what an owner sees after asking for photos: 'Add different hours for some days', a links list, an orphaned 'What is it? / Pick one' dropdown showing no selection, '2 of 10', then a dashed square, '0 of 10', and Save. Three times in a row signup promises a step and delivers a settings screen. Two of the three screens are also mostly empty black before the handoff, so the owner has nothing to look at while deciding whether this app is real.

<details><summary>Closes 2 audit findings</summary>

- Signup's clean steps hand off into the middle of a 1,430-line settings form

- The photo, description, hours and links steps are ninety percent empty black

</details>

**Changes**

- src/app/business-signup.tsx — step 8 (description) takes the text inline: a multiline FormTextField saving through useUpdateOwnBusiness, mirroring business-edit.tsx:1093-1108 including the 600-character cap and the characters-left hint. No handoff at all.

- src/app/business-edit.tsx — gate the rendered blocks on the `section` param read at :865. With a section present, render only that block and title the screen for it ('Your hours', 'Links and contact', 'Where you are'), so the four steps and my-business's DetailRows never reveal a Save button that saves nine other fields. `details` renders name, description and website; `location` renders address, city and picker. `commit()` (:1011-1039) is already safe under this — an unmounted block leaves its state equal to the row, so detailsChanged / hoursChanged / markerMoved are false — but assert that.

- src/app/business-signup.tsx — steps 9 and 10 render greyed example content at the size the real thing will occupy: unfilled day rows on hours, two empty link rows with the glyphs LinkRow uses on links. Step 9 already carries its footnote at :711-714 and does not need new prose.

- src/app/**tests**/business-edges.test.ts — the assertion at the 'every docked button says what pressing it does' test loses the description entry (that step no longer hands off) and the 'no two buttons doing one thing' assertion must not be broken by the new example content.

**Tests.** jest in business-edges.test.ts: business-edit renders only the named section when `section` is present, and business-signup's description step contains no router.push. E2E: re-shoot 49, 60, 61 and 62 — 49 is the picture that made this a finding and it has to stop looking like somebody else's form.

**Risk.** business-edit is presented as a modal (\_layout.tsx:346) and pushed from a StepShell, not from a Sheet, so the leavingSheet trap does not apply — but the section-gated render changes what mounts on a screen that measures layout in an effect (measure() at :873-877), and a block that never mounts never calls onLayout, so the scroll-to must be skipped rather than left waiting on a targetY that never arrives.

**After.** `biz-photo-grid-in-place`

### `biz-cover-control` — Let a business choose its cover instead of deleting its way to one

**Priority** later · **Effort** M · **Ships as** over the air

The cover is the business's entire presence on the map, in the place sheet and in the chat list, and it is whichever photo survives at the lowest position. To replace it an owner has to delete every photo ordered before the one they want — a cascade of destructive confirms, each losing a photo that has already passed moderation. The helper line "The first one is your cover" is only true by accident: after any delete it means "the lowest surviving position", which is not something a bar owner can reason about.

<details><summary>Closes 1 audit findings</summary>

- A business cannot choose its cover either; it is whichever photo survives at the lowest position

</details>

**Changes**

- src/features/business/business-photos.tsx — each PhotoTile gains a 'Use as cover' action (a long-press menu or a second small control, not a third chip on a tile that already carries a status chip and a remove dot). It swaps the tapped photo's `position` with the current cover's, through the existing `grant update (position)` on business_photos (20260827110000:79-81). There is no unique constraint on (business_id, position), so a two-row swap needs no temporary value.

- src/features/business/business-photos.tsx — the action is offered only on an approved photo, because coverIdOf already ignores the others and promoting a pending photo would promise a cover that is not there.

- src/features/business/business-photos.tsx — the helper line becomes something stable and true: 'The cover is the one people see on the map. Tap and hold a photo to make it the cover.'

- src/app/business-signup.tsx — the step 7 subtitle drops 'The first one is your cover' for the same sentence.

**Database.** none, unless the swap is made atomic, in which case a small SECURITY DEFINER function with a grant to authenticated. It returns void, so no OUT columns and no drop-first requirement.

**Tests.** jest on a pure `swapPositions(photos, id)` helper: swapping with the cover, swapping with itself (a no-op), swapping when the cover is pending (refused). pgTAP: an owner can update position on their own photos and cannot on another business's — business_photos_write_own is the policy under test, and the attack is the test. E2E: promote the second photo and re-shoot My business's hero.

**Risk.** Two rows updated in two statements is not atomic; a failure between them leaves two photos at the same position, which every reader resolves by `order by position limit 1` plus its secondary sort, so the visible result is a cover that may not be the one just chosen. Either write both in one RPC or accept and re-read.

**After.** `biz-photo-grid-in-place`

### `biz-photo-ratio` — One ratio for a business photo, and a crop frame that shows it

**Priority** later · **Effort** L · **Ships as** over the air

Both business pickers call launchImageLibraryAsync with allowsEditing and no aspect, and the iOS system editor is square-only. That one approved square is then shown at 3:2 as the cover on place/[id].tsx, place-sheet.tsx and the My business hero, at 4:3 in the gallery strip, and at 16:9 on a post photo. A square at 3:2 loses a third of its height off the top and bottom; at 16:9 it loses 44%. The owner approves a framing once and it is honoured nowhere, cannot see it coming at crop time, and cannot correct it afterwards. For a business that framing is the storefront sign.

<details><summary>Closes 1 audit findings</summary>

- One square crop feeds six different display ratios, so faces and storefronts are cut on every surface

</details>

**Changes**

- src/app/place/[id].tsx — the post photo style at :734 moves from 16/9 and the gallery strip at :771 from 4/3 to the same 3/2 the cover already uses at HERO_RATIO (:51), so a business photo has exactly one shape in the app.

- src/features/business/business-photos.tsx — the grid tiles keep their square shape but gain a 3:2 inset guide, so the tile shows what will survive.

- src/features/business/business-photos.tsx — drop `allowsEditing: true` from the picker and hand the picked asset to a new in-app crop step at a fixed 3:2 with a pan/pinch gesture, so the frame the owner drags is the frame the map gets.

- src/lib/image-upload.ts — processAndUploadImage takes an optional crop rect and applies `ImageManipulator.crop` before the resize at :41-44. expo-image-manipulator is already imported at :1 and already in the pipeline, so this is JavaScript and ships over the air.

**Tests.** jest: a unit test on the crop-rect maths (a 3:2 rect inside a 4:3 source, a 3:2 rect inside a portrait source, a rect clamped at the edges). E2E: re-shoot 91-photo-crop.png and the place page hero — the picture is the only thing that answers whether the sign is still in frame.

**Risk.** The ratio unification is safe and is the first commit; the crop frame is where the effort is and it is a new gesture surface. Read the traps skill first — a pan/pinch over an image inside a scroll view is exactly the responder fight that ate the chat reaction menu, and `keyboardShouldPersistTaps` is not the fix here.

**After.** `biz-photo-grid-in-place`

### `biz-link-safety` — Close the one moderation gap where deleting the row does not undo the harm

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

Every other route out of this app is first-party or a phone number. A business listing can carry up to ten free-text links that a traveler taps from a screen wearing Samewhere's chrome, and the blast radius is entirely outside the app. validate_business_link already requires https and rejects IP literals on the generic kinds, and it screens the link's LABEL through the moderation classifier — but it never screens the VALUE, it does not reject IP literals on the four social kinds, and it has nothing to say about a shortener, which defeats any review of the destination. Meanwhile BUSINESS_RULE_SECTIONS tells owners "Your name, description, posts and photos go through the same check every message here does", and a reader will reasonably conclude links are in that list.

<details><summary>Closes 1 audit findings</summary>

- Business-supplied links are the one place user content sends someone to an arbitrary URL, and they are not moderated

</details>

**Changes**

- supabase/migrations/20260901020000_a_link_goes_where_it_says.sql — NEW. `create or replace function public.validate_business_link()` (20260827110000:199): apply the IP-literal check to the social kinds too, not just the else branch; reject a host in a small shortener denylist (bit.ly, tinyurl.com, t.co, is.gd, goo.gl, rb.gy, cutt.ly, shorturl.at, ow.ly) with the message 'Use the real address rather than a short link, so travelers can see where it goes'; and pass the value through screen_first_message alongside the label at :242.

- src/constants/policies.ts — line 60: 'Your name, description, links, posts and photos go through the same check every message here does.' Only once the migration is deployed; landing the copy first is the same half-shipped state 20260828160000's own comment warns about.

- src/app/business-edit.tsx — the client-side website check at :954-961 gains the shortener message, so somebody finds out while typing rather than through a database refusal after Save. The server enforces it either way.

**Database.** 20260901020000_a_link_goes_where_it_says.sql — create or replace of validate_business_link(), a trigger function with no OUT columns, so no drop-first. Its existing `revoke execute … from public, anon, authenticated` (20260827110000:255) survives a create-or-replace; re-state it anyway so the file reads on its own.

**Tests.** pgTAP in supabase/tests/database/22_business_listing.test.sql, written as the attack: an https shortener is refused; `https://1.2.3.4/x` filed as an instagram link is refused; a value the classifier blocks is refused; a plain menu URL still saves. jest: src/features/business/**tests**/links.test.ts gains the shortener cases against the client validator.

**Risk.** A denylist is a denylist and will be out of date the week it ships; it raises the cost of the lazy attack without claiming to stop the determined one, and the copy must not over-promise once links join the checked list. Also, screen_first_message is a flirt and harassment classifier, so running a URL through it is cheap but is not a URL reputation check — say that in the migration's comment so nobody later mistakes it for one.

### `biz-refresh-gesture` — Pull to refresh on the two business screens that have none

**Priority** later · **Effort** S · **Ships as** over the air

grep -rn RefreshControl across src/ returns exactly two lines, both in chat.tsx. Pull-to-refresh is the gesture every phone user reaches for first when a screen looks stale, and on My business and on a business page it does nothing. An owner whose listing failed to load has to find a LoadError button; a traveler on a thin business page has no recovery at all short of leaving and coming back.

<details><summary>Closes 1 audit findings</summary>

- Pull-to-refresh exists on one screen out of forty-four, so a failed load has no gesture-level recovery

</details>

**Changes**

- src/app/(tabs)/my-business.tsx — the ScrollView at :420-425 gains a RefreshControl with `tintColor={theme.textSecondary}` refetching ownQuery, detailQuery and ratingQuery.

- src/app/place/[id].tsx — the ScrollView at :338 gains the same, refetching detailQuery and ratingQuery.

- Keep every existing LoadError 'Try again' button. The gesture is an addition, not a replacement, and the boot screen's own button is fixed in biz-copy-pass.

**Tests.** jest: assert both files import RefreshControl and pass a refetch. Nothing else proves a gesture; the E2E driver does not pull.

**Risk.** Low here. The reconnect-refetch half of the original finding is deliberately not in this package: react-query's onlineManager needs a connectivity source and no netinfo dependency exists, so wiring it would mean a native module and an EAS build to fix a gesture problem. The travelers and map screens named in the finding belong to other subsystems and should not be edited from here — on travelers in particular, a RefreshControl on the per-profile card scroller would fire whenever somebody scrolls a profile back up.

### `biz-post-photo` — Let a post carry the photo the schema and the traveler page already expect

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

business_posts.photo_path exists (20260827110000:316), business_detail selects it, and place/[id].tsx:116-118 renders it inside PostCard. The composer has no picker, no upload and no field — a grep for photo across business-post.tsx returns nothing. A bar posting "Live music, no cover" cannot show the band; on a dark map where the only thing distinguishing a live business is a brighter ring, the post is the one piece of fresh content a business produces and it is text-only by omission rather than by decision.

<details><summary>Closes 1 audit findings</summary>

- A post cannot carry a photo, though the column exists and the traveler page renders it

</details>

**Changes**

- supabase/migrations/20260901030000_a_post_photo_is_checked.sql — NEW, and this is the half the finding missed: business_posts has no moderation column, so adding a picker today would publish an unmoderated image on a public page while BUSINESS_RULE_SECTIONS promises photos are checked. Add `photo_status public.moderation_status not null default 'pending'` and a trigger mirroring moderate_business_photo_stub (20260829180000:31) — approve on insert when require_photo_moderation is off, otherwise hold and queue a moderation_events row.

- supabase/migrations/20260901030000 — `create or replace function public.business_detail(uuid)` returning photo_path only when `photo_status = 'approved'`. The OUT columns do not change, so this is a body change and create-or-replace is correct; if a later edit ever adds a column, drop the function first and re-state the anon/authenticated grant at 20260829160000:332.

- supabase/functions/moderation-worker/index.ts — a branch for the new entity type beside the business-photo branch at :546-637, including the failsafe-reject path after MAX_ATTEMPTS.

- src/app/business-post.tsx — one optional photo control using the extracted BusinessPhotos uploader, writing through processAndUploadImage to the business-photos bucket and setting photo_path. Render it in the composer with the same 'In review' chip business-photos.tsx draws, so the pending state is visible.

- src/app/(tabs)/my-business.tsx — PostCard shows the photo to the owner regardless of photo_status, with the chip, so the owner never thinks the upload failed.

**Database.** 20260901030000_a_post_photo_is_checked.sql — a column, a trigger, and a create-or-replace of business_detail(uuid) whose OUT columns are unchanged. No drop-first needed; do not add a column to the signature in the same file.

**Tests.** pgTAP in a new supabase/tests/database/31_a_post_photo_is_checked.test.sql: a fresh post photo is not returned by business_detail to an anon caller; it is returned once approved; a rejected one never is; the owner's own read still sees the row. jest: the composer's ready state does not require a photo. E2E: post with a photo and screenshot the composer and the traveler page.

**Risk.** This is the package where the easy version is wrong. Shipping the picker without the moderation column puts an unreviewed image on a page granted to anon, which breaks the promise in policies.ts and is a worse outcome than the missing feature. Do the migration and the worker branch first or do not do the package.

**After.** `biz-photo-grid-in-place`

### `biz-whats-on-tonight` — A Tonight sheet from the map, so a post reaches somebody

**Priority** later · **Effort** L · **Ships as** over the air + Supabase deploy

A hostel posts a quiz night. The only way a traveler learns is by tapping that exact marker among six clusters, prompted by a dismissible banner that literally instructs them to go hunting. The map does brighten a marker's ring for a live post (city_businesses returns has_live_post), so which businesses have news is visible — but not what the news is. Posts are dated, public, authored content in a product whose headline promise is "see what is happening in this city tonight", and they are unbrowsable. That makes the post feel pointless to the owner, which is why they stop posting, and removes the one reason a traveler with no plans opens the app on a Tuesday.

<details><summary>Closes 1 audit findings</summary>

- A business post reaches nobody: there is no what's-on list anywhere in the app

</details>

**Changes**

- supabase/migrations/20260901040000_what_is_on_tonight.sql — NEW. `city_whats_on(p_city_id int)` returning live posts joined to their listing: title, body, happens_at, business id, name, category and cover_path. It must inherit the same filters city_businesses and business_detail use — `b.active and b.state = 'listed'`, `po.archived_at is null`, cover from `moderation_status = 'approved'` — because city_businesses returns only the has_live_post boolean and carries neither the text nor the time. Grant execute to anon and authenticated, matching city_businesses (20260827110000:479).

- src/features/business/api.ts and hooks.ts — fetchCityWhatsOn and useCityWhatsOn beside fetchCityBusinesses (:129 region), keyed ['city-whats-on', cityId] and invalidated wherever ['city-businesses'] already is (business-post.tsx:195, hooks.ts:128).

- src/features/business/whats-on-sheet.tsx — NEW. A time-ordered list in the slot the map's legend banner sits in now, each row opening /place/[id]. Presented through components/ui/sheet.tsx, and any navigation out of it wrapped in `leavingSheet(close)` — the traps skill records this exact bug twice, and a row that pushes a route from inside a Sheet leaves an invisible full-screen scrim that kills touch.

**Database.** 20260901040000_what_is_on_tonight.sql — one new RETURNS TABLE function with a grant to anon and authenticated. New function, so nothing to drop; if its OUT columns are ever changed later, drop it first and re-state the grants.

**Tests.** pgTAP in a new test file: an archived post is absent; a post on an unlisted business is absent; a post on a flagged business is absent; an anon caller gets the same rows a traveler does. jest: the sheet's ordering helper. E2E: open the sheet from the map and screenshot it — this one is a new surface and only a picture says whether it belongs.

**Risk.** If traveler plans are ever mixed into the same list it stops being a what's-on list and becomes a browsable roster of people, which is a different product and a §7 problem. Keep it to businesses, at venue level, showing only what the map already shows publicly. The Sheet-presentation traps apply in full.

**Waits on.** Do we build a what's-on list before launch? FOR: it is the marketing promise in §2.6 said back to the user, it gives the map a second reason to open, and it is the only thing that makes posting twice worth a bar's time. AGAINST: docs/BUSINESS_ACCOUNTS.md:884 defers 'a Places directory tab' by name, and this is that tab in a sheet — it also needs a new RPC, which the finding's own recommendation wrongly assumed was free.

### `biz-one-clock` — One clock: chat times should match the business hours in the same app

**Priority** later · **Effort** S · **Ships as** over the air

src/features/chat/separators.ts:6 formats every in-thread separator and every chat-list row with `new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })`, and 'en' defaults to 12-hour with nothing overriding it. Against that, place/[id].tsx:49 and my-business.tsx:43 both pass `hour12: false`, and shortTime slices '18:00:00' to '18:00'. All four launch cities sit in 24-hour markets, as do the home countries of most European backpackers, so the same traveler reads "9:14 PM" on a message and "Open · till 02:00" on the bar they are messaging about, on the same evening.

<details><summary>Closes 1 audit findings</summary>

- Chat times are locked to 12-hour AM/PM worldwide, while business hours in the same app are 24-hour

</details>

**Changes**

- src/features/chat/separators.ts — read the device's own preference once and pass `hour12` to the formatter, rather than flipping everything to 24-hour: US and UK travelers are a real share of the audience and read 24-hour times badly.

- expo-localization is already a dependency (package.json:26) so it is in the binary and reading it ships over the air. node_modules is not installed in this checkout, so verify the exact accessor against https://docs.expo.dev/versions/v57.0.0/ or the installed types before writing the call — AGENTS.md forbids recalling an Expo API from memory, and this is a one-line call where a wrong name fails silently to undefined and quietly keeps the 12-hour default.

- Leave place/[id].tsx:49, my-business.tsx:43 and shortTime alone: business hours are the business's own clock and are correctly absolute.

**Tests.** jest: src/features/chat/**tests**/separators.test.ts with the preference stubbed both ways, asserting '21:14' and '9:14 PM' from the same instant. Assert the exact strings; do not match a wildcard.

**Risk.** Reading a locale preference at module scope means it is captured once at launch and will not follow a settings change mid-session. That is acceptable for a clock format, but read it inside a small memoised accessor rather than at import time so a test can stub it.

## Account, settings, safety, support and leaving

This subsystem is where Samewhere's safety promises are either kept or quietly broken, and the audit's fourteen findings collapse into three real stories plus a handful of small honest fixes. Story one is vocabulary: one rulebook has four names in the app and a fifth in the database, and I found the audit undercounted badly — six live Postgres functions raise 'that text breaks our community guidelines' and src/lib/query-client.ts shows database messages to users verbatim, so those are user-facing strings too, and two client screens pattern-match that exact phrase to replace it. That ordering trap (broaden the matcher before renaming the string, or the friendly message silently stops firing) is why the rename is two packages, client first. Story two is that the app's safety model is invisible where it matters and its appeal route is unreachable where it matters: no location, 72h pins, hidden socials and screened first messages appear nowhere in the sign-up funnel, and a suspended user gets exactly one button (Sign out) because AccountGate replaces the whole navigator before /guidelines and /contact are ever mounted. Story three is the closing of an account: deleting never revokes the Sign in with Apple token, which is a documented App Review rejection since 2022 and is the only item here that can stop a submission outright. The rest is smaller: no +not-found route, no privacy policy anywhere in the binary, a report form that cannot name a minor even though the rules ban them, a contact form with no way to say "this is urgent", a photo rejection that gives no reason and cannot tell a guidelines breach from a timeout, and a dashboard doc promising two events that do not exist. What the founder is really deciding here is how much friction to put in front of leaving and appealing, and whether the privacy draft is finished enough to render in the app; almost everything else is cheap and clearly right.

### `acct-one-name-for-the-rules-client` — Call the rulebook one thing in the app, and stop the friendly errors depending on the old name

**Priority** now · **Effort** S · **Ships as** over the air

A traveler taps "House rules", lands on a screen titled "Community guidelines", is refused a prompt answer because it "breaks our community guidelines", is told by the gate screen they broke "our community guidelines", and if they run a bar the row is called "Account and rules". Somebody who has been warned by a push and goes looking for the rules scans the profile screen for the words they were shown and does not find them. This package fixes every string the app itself owns, and prepares the two client-side matchers so the database half can follow without breaking them.

<details><summary>Closes 1 audit findings</summary>

- The button says "House rules", the screen it opens says "Community guidelines", and the errors say a third thing

</details>

**Changes**

- src/app/guidelines.tsx — line 23 title 'Community guidelines' becomes 'House rules'; update the file header comment (line 13) to match.

- src/app/(tabs)/my-business.tsx — line 703 DetailRow label 'Account and rules' becomes 'House rules and account'.

- src/app/\_layout.tsx — AccountGate lines 94-99: 'for breaking our community guidelines' / 'for repeatedly breaking our community guidelines' become 'for breaking our house rules' / 'for repeatedly breaking our house rules'. The audit missed this one entirely.

- src/app/edit-prompt.tsx — line 71 matcher becomes /community guidelines|house rules/i (broadened BEFORE the database changes, never after); line 72 message becomes 'That answer breaks our house rules. Reword it and try again.'

- src/app/edit-priorities.tsx — line 289 matcher broadened the same way; line 290 becomes 'That one breaks our house rules.'

- src/features/auth/consent-note.tsx — line 26 link text 'community guidelines' becomes 'house rules'.

- src/constants/policies.ts — extend the header comment (lines 1-9) to say that 'House rules' is the one user-facing name and that docs/legal/COMMUNITY_GUIDELINES.md keeps its filename.

- e2e/flows/signed-in-tour.yml — line 207 extendedWaitUntil visible 'Community guidelines' becomes 'House rules'. Line 202/205 ('House rules and help') is already correct and does not change.

**Tests.** E2E: the existing signed-in-tour.yml step at line 205-207 now asserts the new title, and 19-house-rules.png is re-shot and read as a picture (the label and the page heading must agree in one screenshot). Jest: nothing new — the two matcher regexes are three lines of a component, and the honest proof is that the pgTAP suite in the next package asserts both phrasings match.

**Risk.** The one real hazard is ordering. If the database strings are renamed first, edit-prompt.tsx:71 and edit-priorities.tsx:289 stop matching and the user gets the raw Postgres sentence through the global 'Could not save' alert in src/lib/query-client.ts:22-27. Shipping this package first, with matchers that accept both phrasings, makes the two deploys independent in either order.

**Waits on.** Is the rulebook called "House rules" or "Community guidelines"? For House rules: it is the hostel-native phrase, it matches the app's voice, and it is already the label on the two buttons that open it. Against: "Community guidelines" is the phrase App Review, Apple's own forms and any future dispute expect to see, and docs/legal/COMMUNITY_GUIDELINES.md is titled that way.

### `acct-not-found-route` — Add a +not-found route in the app's own voice

**Priority** now · **Effort** S · **Ships as** over the air

There is no src/app/+not-found.tsx and no +html.tsx anywhere under src/app. Any truncated invite, any link from an older build after a route rename, any push payload resolving to a deleted chat, and any typo in a hand-typed deep link falls through to expo-router's default unmatched screen: framework typography on a light background inside an app declared userInterfaceStyle dark, with a "Go to home screen" link written by nobody on this team. The header comment in src/app/reset-password.tsx records the founder hitting exactly this, and the fix taken then was to add the one missing route, which left the hole open.

<details><summary>Closes 1 audit findings</summary>

- There is no +not-found route, so an unrecognised link renders Expo's own screen

</details>

**Changes**

- src/app/+not-found.tsx — new file. ThemedView/ThemedText/PrimaryButton, one headline, one line saying the link did not point at anything here, one button that does router.replace('/(tabs)'). Copy the shape of the 'This invite is not open' branch at src/app/join-group/[token].tsx:135-160 so the terminal states of the app look like one family.

- src/app/\_layout.tsx — declare <Stack.Screen name="+not-found" /> after the join-group screen at line 374-377, i.e. LAST. The comment at line 349-352 records why an unguarded screen must not sit in the first child slot: the first child becomes the anchor route and swallows every cold start.

**Tests.** E2E: nothing existing covers this, and a flow that opens a bad deep link is worth adding to e2e/flows/guest-tour.yml as a final step (openLink samewhere://nothing-here, then assert the headline and tap through to the map). Screenshot it as 06b-bad-link.png — this is exactly the 'does it look right' case that only a picture answers.

**Risk.** Low. The only thing to get wrong is the declaration slot in \_layout.tsx: put it first and every cold start lands on it. Declare it last, next to guidelines and contact, and verify a cold start still lands on the tabs before pushing.

### `acct-dashboard-inventory-is-true` — Make the DASHBOARD event inventory match the events the app actually sends

**Priority** now · **Effort** S · **Ships as** over the air

docs/DASHBOARD.md is the artefact the PostHog project will be built from, and its closing inventory is headed "Event inventory (all wired, no-op until the key exists)" while listing two events that exist nowhere in src/: matches_viewed and unmatched. Both produce permanently empty charts, and an empty chart reads as "nobody uses matching" rather than "this event was never written". The same section's retention insight offers a database fallback — "read it from the database instead" — that is not buildable: no migration defines any last_seen, last_active or seen_at column, so a visit is never recorded server-side and the one metric the brief asks for by name has no accurate implementation on either side.

<details><summary>Closes 1 audit findings</summary>

- DASHBOARD.md lists events that do not exist and offers a database fallback the schema cannot deliver

</details>

**Changes**

- docs/DASHBOARD.md — in the closing inventory, delete matches*viewed and unmatched; add the events that exist and are missing (gate_shown, gate_tapped, gate_signin_tapped, intro_completed, signup_step_completed, onboarding_completed, guest_joined, pin_joined, room_joined, room_left, left_chat, trip_deleted, direct_chat_opened, group_created, support_message_sent, push_primer_shown, push_primer_answered, and the business*\* set). Verify against `grep -rn "analytics.capture(" src/`.

- docs/DASHBOARD.md — insight 4: strike the sentence "or read it from the database instead". Replace it with a plain statement that in-trip-window retention has no server-side implementation today and what it would cost (see the founder decision below), so the doc stops promising an escape hatch that does not exist.

**Tests.** No code changes, so no test. The evidence is the grep: every name left in the inventory must appear in a src/ analytics.capture call, and every capture call in src/ must appear in the inventory. Run it and paste the diff in the commit message.

**Risk.** None to the app — nothing here reaches a phone. The risk of NOT doing it is the founder building six PostHog insights on top of two events that will never fire.

**Waits on.** Should the app record a day-granularity last-seen server-side so in-trip-window retention can be computed? For: it is the one §6 metric PostHog cannot get right (it cohorts on event date, not on the trip's date range), and a users.last_seen_on date column plus an admin_trip_window_retention view answers it exactly, with no vendor. Against: it is new personal data collection on an app whose pitch is what it does not store, it needs a line in the privacy policy, and a date column is one join away from a per-user activity history.

### `acct-privacy-policy-in-the-app` — Put a privacy policy in the binary and link it from the screen that creates the account

**Priority** now · **Effort** M · **Ships as** over the air

src/features/auth/consent-note.tsx links only /guidelines, and there is no /privacy route anywhere under src/app. This is an app that collects a face, an age, a gender, a home city and travel dates, and whose whole pitch to a safety-conscious traveler is what it does NOT do with that data. The screen where somebody agrees to hand it over offers nowhere to read the policy. App Review 5.1.1(i) expects the policy reachable in-app, not only on the store listing. The audit's claim that the app "says nothing about it" is wrong and I am correcting it: src/constants/policies.ts:27-30 already carries a "Your privacy" section with all four promises, rendered on /guidelines. What is missing is a document called a privacy policy and a link that says so.

<details><summary>Closes 2 audit findings</summary>

- The consent line at account creation links the guidelines but no privacy policy

- Guidelines and privacy are modal-only, so nobody can read them before deciding to install

</details>

**Changes**

- src/constants/policies.ts — add PRIVACY_SECTIONS, same shape as GUIDELINE_SECTIONS, distilled from docs/legal/PRIVACY_POLICY.md: what we collect, what we deliberately do not collect (device location, never), what other travelers see, moderation, where data lives, retention and deletion, your rights and how to exercise them. Bundled rather than fetched for the reason the file header already gives: readable offline and before sign-up.

- src/app/privacy.tsx — new screen, a near-copy of src/app/guidelines.tsx (ScrollView over PRIVACY_SECTIONS, Done footer button). Do not fetch anything.

- src/app/\_layout.tsx — register <Stack.Screen name="privacy" options={{ presentation: 'modal' }} /> immediately after the guidelines screen at line 353, outside every guard, and extend that block's comment to cover both.

- src/features/auth/consent-note.tsx — the sentence becomes 'By continuing you agree to our house rules and privacy policy.' with BOTH as accessibilityRole='link' children (the existing comment at lines 18-20 explains why the role is what makes each one reachable by VoiceOver). Keep 'Keep it casual and friendly.'

- src/app/profile-me.tsx — add a ghost PrimaryButton 'Privacy' next to the existing 'House rules' at line 89-93 (guest branch) and next to 'House rules and help' at line 346-350 (member branch), both pushing /privacy.

- docs/legal/PRIVACY_POLICY.md — remove the DRAFT banner once the founder signs off, and add a line naming src/constants/policies.ts PRIVACY_SECTIONS as the in-app summary that must be kept in step.

- src/constants/policies.ts — extend the header comment (lines 5-8) to say that two documents in docs/legal AND the hosted store-listing URLs move together.

**Tests.** E2E: extend e2e/flows/signed-in-tour.yml after the house-rules block (line 202-224) to tap Privacy from profile-me, assert a line only the privacy screen carries ('We never collect your location'), and takeScreenshot 19c-privacy. Also add an assertion in e2e/flows/onboarding-tour.yml that both link words are visible under the create-account button, since the consent line is the App Review 1.2 surface. Jest: a test in src/constants/**tests** asserting PRIVACY_SECTIONS is non-empty and carries no em dash and none of the banned words, the same discipline the copy rules ask for.

**Risk.** docs/legal/PRIVACY_POLICY.md is explicitly a DRAFT with bracketed founder decisions ('[If PostHog is not enabled at launch, delete this bullet]', '[region — confirm: eu-west]'). Shipping a bracketed sentence into the app is worse than shipping nothing. Build PRIVACY_SECTIONS only from the uncontested paragraphs and leave the two bracketed ones out until they are answered. Second risk: a second modal declared next to guidelines must not land in the first-child slot — see the comment at \_layout.tsx:349-352.

**Waits on.** Two bracketed items in docs/legal/PRIVACY_POLICY.md have to be answered before the summary can be written: is PostHog enabled at launch (the analytics bullet stands or goes), and which Supabase region holds the data (the draft guesses eu-west). For answering now: nothing else in this package is uncertain and the policy is an App Review prerequisite. Against: a wrong region or a stale analytics claim in a published policy is worse than a late one.

**After.** `acct-one-name-for-the-rules-client`

### `acct-one-name-for-the-rules-database` — Rename the rulebook in the six Postgres functions whose exception text users read

**Priority** next · **Effort** M · **Ships as** Supabase deploy only

The audit treated this as a client copy problem. It is not. src/lib/query-client.ts:22-27 shows a database message to the user verbatim in a 'Could not save' alert, and src/lib/failure-message.ts:36-37 says so on purpose ("a message the DATABASE wrote is already a sentence somebody chose"). Six live functions raise 'that text breaks our community guidelines', and only two screens map it to friendlier words — everywhere else (business name, business description, business posts, business links, business address) the traveler or owner reads the Postgres sentence as written. So the fifth name for the rulebook is the one most people will actually see.

<details><summary>Closes 1 audit findings</summary>

- The button says "House rules", the screen it opens says "Community guidelines", and the errors say a third thing

</details>

**Changes**

- supabase/migrations/20260830110000_the_rules_have_one_name.sql — new migration. create or replace, with the whole body copied verbatim from the current live definition and only the string changed, for each of: public.screen_profile_text() (live at 20260817150000_launch_hardening.sql:174), public.screen_prompt_answer() (20260822160000_profile_prompts.sql:54), public.screen_priority_text() (20260827080000_profile_priorities.sql:57), public.screen_business_text() (LATEST definition, 20260829160000_a_business_says_where_it_is.sql:52 — not the two earlier ones), public.validate_business_link() (20260827110000_business_content.sql:199), public.screen_business_post() (20260827110000_business_content.sql:347). New text: 'that text breaks our house rules'.

- supabase/migrations/20260830110000_the_rules_have_one_name.sql — restate the revokes for all six after the replaces, per this repo's rule.

- src/app/edit-prompt.tsx / src/app/edit-priorities.tsx — no change needed IF the previous package broadened the matchers. Verify that before deploying, not after.

**Database.** One migration, six create-or-replace of trigger functions. No RETURNS TABLE and no signature change, so the drop-function-first rule does not bite here — but restate the revokes anyway, which is what this repo does after every replace.

**Tests.** pgTAP: extend supabase/tests/database/08_trust_safety.test.sql (or a new 30_the_rules_have_one_name.test.sql) with throws_ok assertions on each of the six paths asserting the exact new sentence — an assertion loosened to a substring is what let a concatenated form field through review here before. Jest: a unit test over the two client matchers proving they still fire on BOTH phrasings, so the deploy order cannot silently regress.

**Risk.** Copying six function bodies by hand is where a subtle behaviour change gets introduced. Copy each from the LATEST migration that defines it (screen_business_text has three definitions and only the newest is live), diff the two bodies before committing, and let the pgTAP suite for business text prove nothing else moved. Deploy this only after the client matchers accept both phrasings.

**Waits on.** none (settled by the naming decision in the client package)

**After.** `acct-one-name-for-the-rules-client`

### `acct-a-way-back-from-the-gate` — Give a suspended or banned account the rules and a way to appeal, and say so in the notification

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

src/app/\_layout.tsx:192-194 returns AccountGate INSTEAD OF the <Stack> at line 213, so the whole navigator is unmounted. guidelines and contact are declared at :353 and :356 inside that Stack — reachable for literally everyone except the one person who needs them. docs/legal/COMMUNITY_GUIDELINES.md:41-43 tells a suspended user to "use Contact us in the app", and the app has hidden it from them. Meanwhile the two notifications that create the need are, live, 'Your account has been permanently banned for repeated guideline violations.' and 'Your account is suspended for 7 days for repeated guideline violations.' (supabase/migrations/20260821120000_moderation_copy.sql:56-58 and :73-75 — the copy_pass strings the audit quoted never reach a phone). Neither names a breach, a date, or a route back. The moderation pipeline is an LLM verdict, so false positives exist by construction, and this is the moment a wrongly-caught traveler writes an App Store review instead.

<details><summary>Closes 2 audit findings</summary>

- A suspended or banned user's only button is Sign out, while the guidelines promise appeals

- Ban and suspension notifications close the door without saying where the handle is

</details>

**Changes**

- src/features/support/guidelines-body.tsx — new component, extracted from the ScrollView content of src/app/guidelines.tsx:22-50 (ZERO_TOLERANCE card, GUIDELINE_SECTIONS, the Contact us block). Takes an onContact callback instead of calling router.push, so it can render with no navigator mounted.

- src/features/support/contact-form.tsx — new component, extracted from src/app/contact.tsx:64-105 (StepScreen, both fields, the footnote). Props: initialBody, onDone, onClose. StepScreen itself touches no router, so this works outside a navigator; only contact.tsx's own router.back at :56 and :71 stays behind in the screen.

- src/app/guidelines.tsx — becomes a thin screen rendering GuidelinesBody with onContact={() => router.push('/contact')} plus the existing Done footer.

- src/app/contact.tsx — becomes a thin screen rendering ContactForm with the same router wiring it has now.

- src/app/\_layout.tsx — AccountGate (lines 78-110) gains a useState view mode ('gate' | 'rules' | 'appeal'). Two extra ghost PrimaryButtons under the status sentence: 'Read the house rules' switching to the extracted GuidelinesBody, and 'Appeal this' switching to ContactForm with initialBody pre-filled 'Appeal: account suspended' (or 'Appeal: account closed'), each with a way back to the gate. Do NOT do this with router.push — with the Stack unmounted, a push is a no-op, which is the reason the audit's own recommendation would not have worked. Also state the appeal window in the copy, not only the end date.

- supabase/migrations/20260831090000_a_notice_says_where_to_go.sql — create or replace public.apply_strike_policy() and public.admin_resolve_report(uuid, text, text), bodies copied verbatim from 20260821120000_moderation_copy.sql, changing four strings: the ban body to 'Your account is closed for repeated house rules breaches. If you think that is wrong, tap Appeal this on the screen you land on.', the suspension body to the same shape with 'paused for 7 days', and BOTH 'Community guidelines warning' push titles (moderation_copy.sql:86 and :129) to 'House rules warning'. Restate the two revokes at the end, as moderation_copy.sql:191-192 does.

- src/app/\_layout.tsx — the gate headline pair at :91 ('Account suspended' / 'Account banned') should read the same as the push titles the person just got: 'Account paused' / 'Account closed'.

**Database.** One migration replacing apply_strike_policy() and admin_resolve_report(uuid,text,text). Both are returns-trigger / returns-void, no OUT columns, so create-or-replace is correct; restate the revokes after, per the repo rule. Nothing about this touches the strike thresholds — copy only.

**Tests.** pgTAP: supabase/tests/database/08_trust_safety.test.sql already asserts push_queue rows at lines 129, 161, 281, 350, 391 — extend those to assert the exact new title and body strings for the warn, suspend and ban rungs. E2E: a gated account cannot be produced from a Maestro flow without an admin call, so the honest proof here is a unit test in src/app/**tests** over AccountGate's three view modes (the repo already tests navigation branches this way in business-exits.test.ts), plus a screenshot taken by hand against a test account suspended from the SQL editor, saved alongside the run. Live: tests/live/live-backend.mjs already exercises submit_support_message — add a case asserting a suspended user can still submit one, since the whole appeal route depends on the support insert having no standing check (support_messages_insert at 20260821000000_support_messages.sql:95-97 checks only authorship).

**Risk.** The tempting alternative — moving the gate inside the Stack as a Stack.Protected group — means adding && !gated to every other guard in the file and getting initial-route resolution right on a cold start, in the one file whose comments record four separate routing bugs already paid for. Keep the gate outside the router. Second risk: extracting the contact form must not lose the keyboard handling; StepScreen wraps KeyboardFloor for the documented reason that KeyboardAvoidingView measures against its parent, so extract the CONTENTS and keep StepScreen as the wrapper. Third: the support rate limit is three per address per hour, so an appealing user can hit it — the DB's own message is friendly and surfaces through the global alert, which is acceptable.

**After.** `acct-one-name-for-the-rules-client`

### `acct-safety-promises-in-the-funnel` — Say the four safety promises where somebody decides to install and decides to say hi

**Priority** next · **Effort** M · **Ships as** over the air

The reason a woman picks this over GAFFL, Couchsurfing or Bumble BFF is that it collects no location, expires pins in 72 hours, hides socials until both sides agree, and screens every first message. All four are true and enforced in Postgres. None of them appear in the intro tour (src/features/intro/intro-tour.tsx:70-92 is three pages about tabs), in the guest gate (src/components/ui/sign-up-gate.tsx:56 is 'Takes a minute. Always free.'), or above the fold on the Travelers card. They live in the fourth section of a rulebook behind a button nobody opens. The product's whole differentiator is invisible at the two moments it decides an install.

<details><summary>Closes 1 audit findings</summary>

- Nothing in the sign-up funnel mentions a single safety promise

</details>

**Changes**

- src/features/intro/intro-tour.tsx — add a FOURTH entry to the PAGES array at lines 70-92, after 'Say hi, then make plans' (which must stay: it is the only explanation of the accept gate anywhere in the funnel). Title and body drawn from the existing GUIDELINE_SECTIONS 'Your privacy' text: 'We never ask where you are' / 'Pins are plans you type, and they are gone within 72 hours. Your socials only show once you are both chatting.' Use a lock or shield SF Symbol.

- src/features/intro/intro-tour.tsx — line 95 PAGE_COUNT derives from PAGES.length, and lines 274, 283, 289, 359 and 485 all derive from PAGE_COUNT, so the dots, the skip fade and the choice index adapt on their own. Deliberately let the choice land on the new last page rather than pinning it: the strongest place for 'We never ask where you are' is directly above 'Make my profile'. I disagree with the verifier's suggestion to pin the choice back to the chat page, and the founder should look at both.

- src/components/ui/sign-up-gate.tsx — line 56 becomes 'Takes a minute. Always free, and we never ask where you are.' One string, and it changes every gate in the app (map, travelers, chat, place, room, group invite) at once.

- src/features/profile/profile-view.tsx — SocialsSection at 491-513 already renders 'Shared once you're chatting.' to a stranger, which the audit missed; strengthen it to 'Your socials stay hidden until you are both chatting.' rather than adding a second line. Do NOT put a footnote under Say hi: screenshot 17-travelers-signed-in.png shows that button on a floating bar directly above the tab bar with no room beneath it.

- src/constants/policies.ts — the intro page body and the gate line should be exported constants here, so GUIDELINE_SECTIONS, the tour and the gate cannot drift apart.

- e2e/flows/guest-tour.yml — the flow walks the tour with two swipes (lines 31-38) and then expects 'Just looking for now'. Add a third swipe and a takeScreenshot 00d-tour-privacy before the choice screenshot at line 45.

**Tests.** E2E: guest-tour.yml gains one swipe, one screenshot, and an assertion on the new page's headline; 00c-tour-choice.png and 06-guest-gate.png are re-shot. This is a 'does it look right' change, so the pictures are the evidence, not the exit code — the tour is a fixed full-screen composition capped at 1.2x Dynamic Type (intro-tour.tsx:55-61), so check the new page at that cap before believing it.

**Risk.** The tour is the one composition in the app that does not scroll, so a fourth page with two sentences can push the choice buttons off a small screen at 1.2x text. Keep the body to the length of the existing three. Second: five dots instead of four is a visible change to the first thing anybody ever sees, and it is worth the founder looking at the screenshot before it ships.

**After.** `acct-privacy-policy-in-the-app`

### `acct-report-what-the-rules-ban` — Let a report say "they are under 18" and "somebody is in danger"

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

src/constants/policies.ts:24 and docs/legal/COMMUNITY_GUIDELINES.md:33 both ban anyone under 18, and the report form (src/app/report.tsx:13-20) has no way to say a profile is one. A traveler certain the 19-year-old she is chatting with is 15 has to file it as 'Other' or 'Safety concern' and it lands in the same undifferentiated queue as a spam complaint. For a platform that puts strangers in the same city, an underage report is the one category that must never queue behind spam, and it is the category Apple and regulators ask about by name.

<details><summary>Closes 1 audit findings</summary>

- Neither report form offers "They are under 18", though the guidelines ban under-18s

</details>

**Changes**

- supabase/migrations/20260901090000_a_report_can_name_a_minor.sql — new migration containing ONLY: alter type public.report_reason add value if not exists 'underage'; and alter type public.report_reason add value if not exists 'immediate_danger'; Nothing else in this file.

- supabase/migrations/20260901090100_urgent_reports_go_first.sql — a SECOND migration (the new enum values cannot be referenced in the transaction that adds them, which is the same class of mid-migration deploy failure AGENTS.md already warns about for RETURNS TABLE). Redefine public.admin_report_queue (defined at 20260817090000_trust_safety.sql:873-891) so its ORDER BY puts reason in ('underage','immediate_danger') first, then created_at. create or replace view, then restate `revoke all on public.admin_report_queue from anon, authenticated`.

- supabase/migrations/20260901090100_urgent_reports_go_first.sql — extend public.log_report() (trust_safety-era trigger, defined at 20260816220000_chat_realtime.sql:135-147) to enqueue a push to public.support_duty_user_ids() (20260821150000_support_delivery.sql:45) when the reason is urgent, so a minor report wakes a phone instead of waiting for someone to open the SQL editor. Restate the revoke after the replace.

- src/lib/database.types.ts — line 599-600, add 'underage' and 'immediate_danger' to the ReportReason union. This file is hand-maintained (see its header), so this is an edit, not a codegen run.

- src/app/report.tsx — add two entries to REASON_OPTIONS at lines 13-20: { value: 'underage', label: 'They are under 18' } and { value: 'immediate_danger', label: 'Somebody here is in danger' }. Put them first: the chip order is the triage order the reporter reads.

- docs/DASHBOARD.md — the admin query set section lists admin_report_queue; note that it is now ordered by urgency, not by age.

**Database.** Two migrations, in this order and never merged: one adds the enum values, the next uses them. Restate grants after every view and function replace.

**Tests.** pgTAP: new supabase/tests/database/30_urgent_reports.test.sql — assert the enum accepts both new values; assert admin_report_queue returns an underage report ahead of an older spam report (the attack version: file spam first, then underage, assert the order); assert log_report enqueued a push row for a configured duty user on the urgent reason and did not on 'spam'; assert anon and authenticated still have no grant on admin_report_queue. E2E: extend the report step in e2e/flows/signed-in-tour.yml to screenshot the chip row so the two new labels are in the picture record.

**Risk.** The two-migration split is the whole risk. Merging them fails the deploy AFTER the enum has already been added, leaving the database half-migrated. Second risk, and the reason I am NOT planning the audit's suggested auto-soft-hide: suppressing a profile on one unverified report hands any user a one-tap way to darken a stranger, which is exactly what src/app/\_layout.tsx:280-286 records report_business being guarded against. Suppression stays a moderator action.

**Waits on.** Should an underage report auto-suppress the reported profile pending review? For: a minor on the platform is the one harm that cannot wait for a human, and the shadowban path already suppresses without notifying. Against: it is a one-tap weapon against any stranger, and this codebase has already refused that trade once for business reports. I recommend against, with a priority queue and a push to the duty phone instead — high confidence.

### `acct-what-happens-after-you-write-in` — Say what happens after a report, and let a message say how urgent it is

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

After reporting, src/app/report.tsx:48-58 says 'Report received' / 'Thanks. A real person reads every report.' and returns. No timeframe, no statement of what a reviewer can do, no assurance the reported person is not told who reported them. She keeps sharing a hostel with that person and has no signal the report was more than a form. Separately, src/app/contact.tsx:64-104 is one email field and one message box serving an appeal against a ban, a bug report, and "a man I met from this app followed me back to my hostel" — nothing lets the sender mark which, so nothing lets a solo founder triage, and on a one-person support queue that difference is measured in hours.

<details><summary>Closes 2 audit findings</summary>

- A report ends in a thank-you and vanishes; there is no what-happens-next and no record

- The contact form is one free-text box, so an urgent safety message queues behind feature requests

</details>

**Changes**

- src/app/report.tsx — extend the alert body at line 48 to: 'We look at it within a day. If we act, we never tell them who reported it. You will not hear back unless we need more from you.' Keep BOTH buttons exactly as they are — the destructive 'Block them too' at :50-56 exists because somebody who has just reported a person is the likeliest person to want them gone, and the code comment at :44-47 says so.

- supabase/migrations/20260902090000_a_message_says_how_urgent.sql — alter table public.support_messages add column category text check (category is null or category in ('safety','account','other')); extend the insert grant at 20260821000000_support_messages.sql:100 to include the new column.

- supabase/migrations/20260902090000_a_message_says_how_urgent.sql — drop function public.submit_support_message(text, text) FIRST, then create public.submit_support_message(p_reply_to text, p_body text, p_category text default null). This is not the RETURNS TABLE rule but a worse cousin: create-or-replace with an extra parameter makes an OVERLOAD, and a two-argument call then resolves ambiguously ('function is not unique') the moment an older bundle calls it. Dropping first and defaulting the new parameter keeps every already-installed build working through the OTA gap. Restate `grant execute ... to anon, authenticated` after the drop.

- supabase/migrations/20260902090000_a_message_says_how_urgent.sql — create or replace public.enqueue_support_push() (20260821150000_support_delivery.sql:82-103) so the push title carries the category ahead of the address, e.g. 'Safety: alice@example.com', and restate its revoke. Triage should be possible from a lock screen.

- src/app/contact.tsx — a ChipRow above the message field (the component is already imported by report.tsx:5), three options: 'Something happened' -> safety, 'My account' -> account, 'Something else' -> other. No chip label may contain the word 'request'. Make the confirmation at :54 set an expectation per category rather than the flat 'we read every one'.

- src/features/support/api.ts — sendSupportMessage at :17-26 gains p_category; src/features/support/hooks.ts:6-13 passes it through. Keep analytics.capture('support_message_sent') carrying only the category, never the body or the address.

- supabase/functions/support-mailer/index.ts — line 124 select gains category; line 156 subject becomes `Samewhere support (${category}): ${reply_to}` and the text/html bodies at :158-166 name it.

- src/lib/database.types.ts — add the third parameter to the submit_support_message entry near line 1388.

**Database.** One migration: a nullable checked column on support_messages, a drop-then-create of submit_support_message with a defaulted third parameter (grants restated), and a create-or-replace of enqueue_support_push (revoke restated).

**Tests.** pgTAP: extend supabase/tests/database/11_groups_support.test.sql — assert a two-argument call still succeeds (the OTA-gap case), assert the category check constraint rejects a junk value, assert the push row's title carries the category, and assert support_messages still has no select policy for authenticated. E2E: e2e/flows/signed-in-tour.yml already photographs the contact form at 19a/19b — add a chip tap before typing so the category row is in the picture. Jest: nothing new; there is no logic here worth mocking Supabase for.

**Risk.** The overload trap above is the one that bites: get it wrong and every contact-form submit from every installed build starts failing with 'function is not unique', on the app's only route to a human. Deploy the migration and confirm a two-argument call from the live suite BEFORE publishing the JS. Second: the category is user-declared, so it is a triage hint and never an authorisation — nothing may branch on it in the database beyond ordering and the push title.

### `acct-apple-token-revoked-on-delete` — Revoke the Sign in with Apple token when an account is deleted

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

supabase/functions/delete-account/index.ts clears five storage buckets, hard-deletes every chat, deletes an owned business and calls admin.auth.admin.deleteUser — and never contacts Apple. A grep across supabase/functions/ and src/ for appleid.apple.com, auth/revoke or revokeToken returns nothing outside group-invite revocation, and src/features/auth/api.ts:117-134 discards credential.authorizationCode, keeping only identityToken. Apple has rejected apps for exactly this since 2022 when they offer both Sign in with Apple and account deletion, and app.json:13 sets usesAppleSignIn with the button rendered on both src/app/(auth)/join.tsx:10 and email.tsx:12. There is a user-visible failure too: the deleted account stays listed forever under iOS Settings, and because Apple returns name and email only on the FIRST authorization, a deleted user who signs up again with Apple arrives with no email and no name, and so with no address to recover with.

<details><summary>Closes 1 audit findings</summary>

- Deleting an account never revokes the Sign in with Apple token

</details>

**Changes**

- src/features/auth/api.ts — signInWithApple at :117 captures credential.authorizationCode alongside identityToken and, after a successful signInWithIdToken, posts it to a new edge function. Failure to store must never block the sign-in: log and continue, the way delete-account's storage branch does at index.ts:82-85.

- supabase/migrations/20260904090000_apple_can_be_told_to_forget.sql — create table public.apple_refresh_tokens (user_id uuid primary key references public.users(id) on delete cascade, refresh_token text not null, created_at timestamptz not null default now()). enable row level security, create NO policies, and `revoke all ... from public, anon, authenticated`. This is a service-role-only table, the same shape as the other server-only surfaces in this schema, and the comment must say so.

- supabase/functions/store-apple-token/index.ts — new function. Verifies the caller's JWT the way delete-account/index.ts:26-38 does, exchanges the authorization code at https://appleid.apple.com/auth/token using a client secret JWT signed with the Sign in with Apple .p8 key, and upserts the refresh token with the service role. Secrets (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID) come from function env, never the client bundle.

- supabase/functions/delete-account/index.ts — between step 4 (line 141) and step 5 (line 143): read the row, POST it to https://appleid.apple.com/auth/revoke with the same client secret, and log-but-do-not-block on failure, exactly as the storage cleanup branch already does. Extend the file's numbered header comment (lines 1-21) with the new step so the ordering stays documented.

- supabase/functions/guest-janitor/index.ts — no change. A guest can never hold an Apple identity today; note that in a comment rather than adding a call that does nothing.

**Database.** One migration adding a service-role-only table with RLS enabled and zero policies. No function signature changes.

**Tests.** pgTAP: new supabase/tests/database/31_apple_tokens_are_server_only.test.sql, written as the attack — assert an authenticated role cannot select, insert, update or delete apple_refresh_tokens, and that the row cascades away when the user does. Live: extend tests/live/live-backend.mjs with a delete-account case that asserts the row is gone afterwards. The Apple call itself cannot be tested without a real membership; log the revoke response status into the function log and check it against a real TestFlight account once, by hand, and record the run.

**Risk.** Blocked on an Apple Developer membership, a Sign in with Apple key and the .p8 private key, none of which exist yet (docs/APP_STORE.md:22 lists the membership as an open founder item). The code can be written and the table shipped ahead of that; the revoke will simply log a failure until the secrets are set, which is the correct failure mode. Second risk: an exchange that throws on sign-in would break sign-in itself — the store call must be fire-and-log, never awaited into the auth path's error handler.

**Waits on.** This needs the Apple Developer membership and a Sign in with Apple key (.p8, Key ID, Team ID) provisioned before it can work end to end. For doing it now: it is a documented App Review rejection reason and the app already ships both halves that trigger it, so it will block the first submission. Against: nothing here is testable until the membership exists, so the code sits unproven for as long as that takes.

### `acct-photo-rejection-says-why` — Tell somebody why a photo was refused, and stop calling a timeout a rules breach

**Priority** next · **Effort** M · **Ships as** over the air + Supabase deploy

src/components/photo-grid.tsx:44 renders the single word 'Removed' on theme.danger, and src/app/business-edit.tsx:465 renders "Didn't pass". A rejection with no reason cannot be acted on: the person re-uploads the same photo and takes a second strike (photo_rejected feeds apply_strike_policy via is_strike_action at 20260817090000_trust_safety.sql:145), or gives up on having a photo, which in this product means giving up on being discoverable. Worse, the failsafe case — explicitly NOT a strike, 'photo_rejected_failsafe' at trust_safety.sql:680 — is shown with the identical word and colour as a guidelines breach, so somebody whose photo hit a classifier timeout is told they broke the rules. The push already splits the two cases (trust_safety.sql:687-690); the UI does not.

<details><summary>Closes 1 audit findings</summary>

- A rejected photo gives no reason, no example and no way to appeal from where it is shown

</details>

**Changes**

- supabase/migrations/20260903090000_a_photo_says_why.sql — alter table public.profile_photos add column moderation_category text and add column moderation_engine text. Both nullable, both readable by the owner through the existing profile_photos_select_own policy (20260816190000_core_auth_profiles.sql:275-277) and NOT by others, since profile_photos_select_approved requires moderation_status = 'approved'.

- supabase/migrations/20260903090000_a_photo_says_why.sql — create or replace public.apply_photo_verdict(uuid, jsonb) (live at 20260817090000_trust_safety.sql, rejection branch at :673-692), setting moderation_category = p_verdict->>'category' and moderation_engine = p_verdict->>'engine' in the same update. Signature unchanged, so no drop needed; restate the revoke at :696-697 anyway. Store the CATEGORY, never the model's free-text 'reason' — the worker's schema (supabase/functions/moderation-worker/index.ts:51) constrains category to ok/explicit/suggestive/violent/other_violation, and prose written by a classifier is not copy this app should show anyone.

- src/lib/database.types.ts — add the two nullable columns to ProfilePhotoRow (near line 596).

- src/components/photo-grid.tsx — StatusChip at :33-46 gains a third state. Failsafe (engine 'failsafe') reads 'Try again' on theme.warning, not theme.danger; a guidelines rejection keeps 'Removed'. Make the chip a PressableScale that opens a short sheet naming the category in fixed copy the app owns, restating the one relevant rule, and offering a way to /contact.

- src/app/profile-me.tsx — the notice at :302-306 currently says 'removed and nobody else can see it' for any non-approved photo. Split it the same way: a failsafe hold is 'could not be checked' and is not a rules breach, and saying otherwise to somebody who did nothing wrong is the whole point of this package.

- src/app/business-edit.tsx — line 465 gets the same two-state treatment once profile photos are proven; business photos live in a different table and go through apply_business_photo_verdict (20260829180000_a_business_photo_is_ever_seen.sql:120-130), so treat that as a follow-on inside this package rather than a copy-paste.

**Database.** One migration: two nullable columns on profile_photos and a create-or-replace of apply_photo_verdict with the revoke restated. A second, optional pass does the same for business_photos and apply_business_photo_verdict.

**Tests.** pgTAP: extend supabase/tests/database/25_photo_says_it_is_being_checked.test.sql — apply a failsafe verdict and assert moderation_engine = 'failsafe' and the moderation_events action is photo_rejected_failsafe (i.e. still not a strike); apply a guidelines verdict and assert the category lands; and, as the attack, assert another user cannot read either new column on a rejected photo. E2E/screenshot: a rejected tile cannot be produced from a Maestro flow, so shoot it by hand against a test account with a verdict applied from the SQL editor and keep the picture with the change.

**Risk.** Do not show the classifier's free-text reason. It is model prose, it can be blunt or wrong, and it is one screenshot away from being the app's voice. Map the five known categories to fixed sentences and fall back to a generic one for an unknown value. Second: photo-grid's chip currently sits on theme.danger; the design brief's ban on red as a UI colour has danger in the palette as a token, so this is not a violation, but a timeout must not use it.

### `acct-deleting-asks-who-you-are` — Ask who is holding the phone before deleting the account

**Priority** later · **Effort** M · **Ships as** over the air

src/app/profile-me.tsx:385-418 opens one Alert and, on confirm, calls deleteAccount() with no identity check, and supabase/functions/delete-account/index.ts:93-108 hard-deletes every chat the user belongs to for BOTH members. An unlocked phone left on a hostel table is enough to irreversibly destroy the account and delete the other side's copy of every conversation, including conversations belonging to people who are not present and never consented. For an app whose entire safety model assumes the people around a traveler are strangers, a one-tap irreversible destructive action with no identity check is out of step with everything else in the product. (The audit also asked for the dialog to say what deletion does to the other side; it already does — line 392 reads 'chats, for both sides'.)

<details><summary>Closes 1 audit findings</summary>

- Permanently deleting the account, and every chat on both sides, takes one tap from anyone holding the phone

</details>

**Changes**

- src/features/auth/api.ts — a new confirmIdentity() that branches on how the session was created: for an Apple account, re-run AppleAuthentication.signInAsync and check the returned credential.user against the stored subject; for an email/password account, ask for the password and call signInWithPassword against the session's own email. supabase.auth.reauthenticate() is NOT a general answer here — it sends a nonce for a password change and has nothing to do for an Apple identity.

- src/features/profile/hooks.ts — a useConfirmIdentity mutation wrapping it, so the screen stays declarative.

- src/app/profile-me.tsx — the traveler branch at :385-418 and the business branch at :171-208 both call confirmIdentity() before deleteAccount(), and both surface a failure as 'That did not check out. Try again.' rather than proceeding.

- src/app/(auth)/join.tsx and src/app/(auth)/email.tsx — no change, but note in a comment that a guest account has no identity to confirm and therefore keeps the single-confirm path.

**Tests.** Jest: a unit test in src/app/**tests** (same style as business-exits.test.ts) asserting deleteAccount is not called when confirmIdentity rejects, for both the traveler and the business branch. E2E: not worth a flow — a Maestro run cannot drive the Apple sheet, and a flow that deletes its own account is a flow that cannot run twice.

**Risk.** Friction on the one control App Review requires to be reachable and easy (5.1.1(v)). Apple's guidance is that deletion must not be hidden or obstructed; a re-authentication step is normal and accepted, an obstacle course is not. Keep it to one system-standard prompt. Second: a password-based confirm has to use the session's own email, never an email the user types, or it becomes a way to test other people's passwords.

**Waits on.** Should deleting an account require re-authentication? For: it is irreversible, it destroys other people's conversations without their knowledge, and an unlocked phone on a hostel table is exactly the threat model this app is built around. Against: it is friction on the control App Review wants easy to find, and there are no users yet, so the risk is theoretical while the review risk is not. I lean toward doing it, medium confidence, and it is the right thing to do at the same time as the Apple revocation work since both touch the delete path.

### `acct-your-reports-and-messages` — A settings row showing what became of each report and message you sent

**Priority** later · **Effort** M · **Ships as** over the air + Supabase deploy

src/features/support/api.ts:34-40 defines fetchSupportMessageStatus, calling an RPC written specifically so a sender can learn what became of their message without the inbox becoming readable (20260821150000_support_delivery.sql:116-131) — and a grep across src/ finds no caller anywhere. Nothing renders it. A traveler who reports somebody and hears nothing concludes the app does not moderate, and says so in a review. The plumbing for half of this is already built and dead.

<details><summary>Closes 1 audit findings</summary>

- A report ends in a thank-you and vanishes; there is no what-happens-next and no record

</details>

**Changes**

- supabase/migrations/2026xxxxxxxxxx_what_became_of_mine.sql — a new SECURITY DEFINER function public.my_report_status() returning (id uuid, created_at timestamptz, reason public.report_reason, state text) for reports where reporter_id = auth.uid(), mapping reports.status to a coarse three-value state (received / reviewed / action taken) and never returning the raw 'resolved:ban' string or anything about the reported person. reports already grants the reporter select on everything EXCEPT status (20260816220000_chat_realtime.sql:127-129, 'review status is admin-only'), which is why this needs a function and not a policy. Grant execute to authenticated only.

- src/features/support/api.ts — add fetchMyReports alongside the existing fetchSupportMessageStatus, and finally give the latter a caller.

- src/features/support/hooks.ts — useMyReports and useSupportMessageStatus queries.

- src/app/support-history.tsx — new screen listing reports (date, reason, state) and support messages (date, category, delivered or not), reusing the row styling from the guidelines screen so it reads as part of the same set.

- src/app/\_layout.tsx — register it as a modal next to guidelines/contact at :353-356, guarded on signedIn.

- src/app/profile-me.tsx — a ghost button 'Your reports and messages' beside 'House rules and help' at :346-350.

- src/features/support/hooks.ts — the message id returned by submit_support_message is currently thrown away; persist it per-device (the store pattern in src/features/auth/store.ts) so a guest's message can still be looked up.

**Database.** One migration adding my_report_status(). If support_message_status ever gains an OUT column in the same change, drop function first and restate grants — the repo rule and the traps skill both name this exact failure.

**Tests.** pgTAP: new supabase/tests/database/32_what_became_of_mine.test.sql, written as the attack — assert my_report_status returns only the caller's own rows, returns nothing for a report filed by somebody else, never exposes the reported user's status or the raw resolution string, and that anon has no execute grant. E2E: add a step to signed-in-tour.yml opening the screen and screenshotting its empty state, which is the state most users will see.

**Risk.** Telling a reporter that 'action was taken' leaks a moderation outcome about another person. Keep the coarse states genuinely coarse, and consider collapsing 'reviewed' and 'action taken' into one 'we looked at it' if the founder is uneasy — the retention value is in knowing it was read, not in knowing what happened.

**After.** `acct-what-happens-after-you-write-in`

## First run: intro tour, auth, guest mode, onboarding steps

Twenty-six findings collapse into fourteen packages, and the shape of the work is lopsided. Six packages are copy and instrumentation that can ship in an afternoon; the other eight are all versions of one structural problem, which is that this app has no idea what to do when a session, an intent, or a half-finished flow ends without being asked to. The funnel package comes first because every argument about signup below it is currently unmeasurable: six of the thirteen steps emit no analytics at all, including the photo gate and the trip step, and the two that do emit send a string where the rest send an integer. The single most consequential defect is also the smallest: gender sits below the fold on step 3 behind an autofocused keyboard, basicsOk never checks it, and the safety filter the brief calls the differentiator for the 54% of solo travelers who are women therefore fills with 'unspecified'. The two genuinely large pieces of work are the business account that falls into traveler onboarding the moment somebody backs out of a listing form that has no exit, and the intent a guest loses when they take the sign-up gate at the highest-intent moment in the product. What the founder is really deciding here is not whether signup is too long: that is a recorded decision, and the reachable win inside it is reordering the trip step rather than shortening the flow. It is whether a business's intent belongs in the database, whether the tour may show pictures of the app that will need re-shooting, and whether a domain gets bought, which is the only item on this list that is a purchase rather than a judgement.

### `firstrun-signup-funnel` — Instrument every signup step with one ordered event schema

**Priority** now · **Effort** M · **Ships as** over the air

analytics.capture('signup_step_completed') fires only inside saveAndGo, so steps 5, 8, 9, 10, 11 and 12 advance through go() and emit nothing. The two most likely places to lose somebody, the photo gate with its three iOS permission dialogs and the trip step that decides whether a profile is visible to the matching feature at all, are both dark. The two auth-stack steps do emit, but with a string where onboarding sends an integer, so a PostHog breakdown on `step` returns an unorderable mixed axis and no funnel chart can be drawn from it. The brief's section 6 liquidity metrics cannot be read until this is one scheme.

<details><summary>Closes 2 audit findings</summary>

- Six of the thirteen signup steps emit no analytics, including photo and trip

- signup_step_completed mixes string and numeric steps, so the funnel cannot be ordered

</details>

**Changes**

- src/features/signup/steps.ts — add `signupStepName(step: number)` returning a stable slug for a 1-based step number (email, password, who, home, photo, occupation, bio, prompts, priorities, trip, socials, audience, review), beside SIGNUP_TOTAL_STEPS.

- src/app/onboarding/index.tsx — delete the capture from saveAndGo (:141-155) and put it in go (:133-137), which every step already routes through; give go a second argument `{ skipped }` and pass `{ skipped: true }` from the six onSkip props (:322, :348, :377, :422, :468, :517); emit `{ step_index, step_name, skipped }`. Step 13 is already covered by onboarding_completed at :588, so this closes the funnel end to end.

- src/app/(auth)/join.tsx — :74 becomes `{ step_index: 1, step_name: 'email' }` and :97 becomes `{ step_index: 2, step_name: 'password', business: forBusiness }`; add `signup_started` with `{ business: forBusiness }` on mount, so the largest drop-off in the product (arriving and leaving) has a denominator.

- src/features/auth/apple-button.tsx — :48 stops emitting signup_step_completed. Apple is an alternative to steps 1 and 2, not a step, and counting it there double-counts the funnel's first rung; it emits `signup_apple_used` instead.

- src/features/profile/hooks.ts — add `analytics.capture('profile_photo_added', { position })` to useUploadPhoto's onSuccess (:192-194), so loss inside the iOS permission chain is separable from loss on the Continue button. PhotoGrid takes no props today, so instrumenting the mutation is the change that needs no new plumbing.

- src/app/business-signup.tsx — emit `business_step_completed` with the same `{ step_index, step_name }` shape from its own go(), covering the ten screens that emit nothing between business_registered (:209) and business_email_confirmed (src/app/business-email.tsx:133).

**Tests.** New jest source-assertion suite src/app/**tests**/signup-funnel.test.ts, in the style of the existing step-flow.test.ts shell parser: every StepShell block's onContinue and onSkip in onboarding/index.tsx reaches go(; saveAndGo contains no analytics.capture; every signup_step_completed call site under src/ passes a numeric step_index and a string step_name and never a bare `step:`; steps.ts names thirteen steps. No screenshot proves an event, so the other half of the evidence is a PostHog funnel from one manual signup run, with the run named in the commit.

**Risk.** Renaming the property orphans whatever `step` data PostHog already holds. That is free today because there are no production users, and it will not be free after launch, which is the argument for doing it now. The go() move must not double-count: saveAndGo calls go(), so leaving the old capture in place emits twice for steps 3, 4, 6 and 7.

### `firstrun-one-signup-cta` — Make every sign-up gate ask for the same thing

**Priority** now · **Effort** S · **Ships as** over the air

A guest can meet two gates in one session and be asked to do two apparently different things. Tapping Drop a pin gives a sheet whose button says Make a profile; tapping a pin to see who is going gives a sheet whose button says Create an account. Both are map-screen.tsx and both push /join. Five of the seven overrides already say Make a profile, so the component default is the odd one out, and every one of these is the only conversion moment this app has.

<details><summary>Closes 1 audit findings</summary>

- Three different calls to action for making an account, two of them in the same file

</details>

**Changes**

- src/components/ui/sign-up-gate.tsx — :20 default becomes `cta = 'Make a profile'`, and the `cta` prop is removed from the signature so no caller can drift again. The gate's own reasons are about the profile ("Pins come with your name on them", travelers.tsx:225 "Make a profile to see theirs"), and "account" is the word the business flow needs to keep for itself (profile-me.tsx:363).

- src/features/pins/map-screen.tsx — delete cta at :1543 and :1647.

- src/app/room/[id].tsx — delete cta at :484.

- src/app/(tabs)/travelers.tsx — delete cta at :242.

- src/app/(tabs)/chat.tsx — delete cta at :870 and :878.

- src/app/join-group/[token].tsx — delete cta at :210.

- src/app/place/[id].tsx:516 and src/features/business/place-sheet.tsx:261 pass no cta already and change only by the new default.

- src/app/profile-me.tsx:81 and src/features/intro/intro-tour.tsx:405 are left alone. Both are first person, one sitting under the user's own guest name and one in the tour's own voice, which is the one place "Make my profile" is right.

**Tests.** New jest source assertion src/components/ui/**tests**/sign-up-gate.test.ts: no `cta=` appears anywhere under src/, and the default string is 'Make a profile'. E2E needs no change: guest-tour.yml:114-119 and business-tour.yml:30-34 already wait on and tap 'Make a profile' at the drop-pin gate, and nothing in e2e/ asserts 'Create an account'. Add an assertion on the pin-card gate to guest-tour.yml, which no flow photographs today, and re-shoot 06-guest-gate.png and 04-chat-guest.png.

**Risk.** The room gate at room/[id].tsx:484 carries a comment drawing the line between an account and a guest name. That line is about which identity may post in a public venue room, not about the words on the button, so this does not touch it. If the founder wants the room to keep the heavier phrasing it becomes the one override and the rule is dead again, so it is worth settling inside this package rather than after it.

### `firstrun-join-copy` — Settle the words on /join and the account-kind rows

**Priority** now · **Effort** S · **Ships as** over the air

The screen headed "What is your email?" is answered by a full-width white Apple pill that skips the email entirely, so the heading contradicts its own loudest action. The row that introduces the traveler identity says "I'm travelling", the only British spelling anywhere in src/, sitting two lines above "travelers who can message you". And a business owner is told they will enter contact details "when creating your profile" on step 1 and "Your listing is next" one tap later, two nouns for the same object at the moment somebody is deciding whether this app understands what they are.

<details><summary>Closes 3 audit findings</summary>

- 'What is your email?' is answered by a white Apple button that makes the question moot

- 'I'm travelling' is the app's only British spelling, on the screen that names the two account kinds

- A business is told 'profile' on one screen and 'listing' on the next

</details>

**Changes**

- src/app/(auth)/join.tsx:130 — title becomes "Make your account", which covers the account-kind rows, the Apple button and the email field rather than only one of the three. The subtitles at :137-141 are untouched: the comment at :131-136 records them as the founder's words and docs/ONBOARDING.md:74 quotes the traveler one verbatim.

- src/app/(auth)/join.tsx:139 — "...where customers can reach you when creating your profile." becomes "...where customers can reach you when you build your listing.", so step 1 and step 2 (:274) use one noun. The 22-word length stays: it is founder copy and compressing it is a separate proposal.

- src/app/(auth)/join.tsx:174-178 — a hairline "or" divider between styles.appleRow and the Email field, so the two read as alternatives rather than as a stack. The order is unchanged: the comment at :169-172 records the decision that the kind rows come before Apple.

- src/features/auth/account-kind.tsx:47 — title becomes "I'm a traveler", which fixes the spelling and makes both rows noun phrases against "I run a business" (:55).

**Tests.** New jest source assertion src/features/auth/**tests**/copy.test.ts, in the shape of the existing src/features/business/**tests**/vocabulary.test.ts: no user-facing string under src/ contains "travelling", and join.tsx's business subtitle and step-2 line use the same noun. E2E passes unchanged: guest-tour.yml:127 and business-tour.yml:39 tap 'I run a business', and onboarding-tour.yml asserts the subtitle rather than the title. Re-shoot 07-account-kind.png, 08-account-kind-business.png and 50-signup-email.png and read them.

**Risk.** "Make your account" replaces a question with a statement on the first screen of signup, and the business step-2 line already says "This is for your business account". That is correct rather than a collision: an account is what both kinds are making, and the listing is what only one of them gets. The ~103pt of dead canvas under the Email field on 50-signup-email.png is not fixed here; it belongs to step-shell.tsx and lands in firstrun-step3-gender-and-shell-floor.

### `firstrun-onboarding-step-copy` — Turn step 12 into a statement and say what each skip is skipping

**Priority** now · **Effort** S · **Ships as** over the air

Step 12 asks a brand-new account to choose an audience it is structurally not permitted to change. set_visibility refuses a narrowed audience from an account with no badge, and AudiencePicker's pick() at :38 returns early on every row for an unverified account, including the one already selected. It is also the only step between 6 and 12 with no skip, so a question whose only possible answer is the default sits between a finished person and the app. Separately, the six skippable steps all say "Skip for now", which does not tell somebody what they are giving up at the moment they give it up.

<details><summary>Closes 2 audit findings</summary>

- Step 12 is the only signup step with no Skip, and every option on it is inert

- Six consecutive self-description screens sit between the photo and the app

</details>

**Changes**

- src/app/onboarding/index.tsx:524-534 — title becomes "Who can see you" and continueLabel becomes "Got it" for an unverified account, keeping the question form and "Continue" where profile.verified is true. The step stays, because the discovery it exists for is the founder's reason for it; it stops asking for a decision that cannot be made.

- src/app/onboarding/index.tsx:541-554 — move the AUDIENCE_NEEDS_BADGE line above the AudiencePicker, so the reason the rows are inert is read before they are tapped rather than after. AUDIENCE_BOTH_WAYS and AUDIENCE_GENDER_NOTE (src/features/profile/audience.ts:70-77) are shared with src/app/visibility.tsx and are not touched.

- src/app/onboarding/index.tsx:322, 348, 377, 422, 517 — a skipLabel per step naming its own subject: "Skip what you do for now", "Skip the bio for now", "Skip the prompts for now", "Skip this for now", "Skip your socials for now". Step 10 already says "I have not booked anything yet" (:469) and keeps it.

- src/app/**tests**/onboarding-sequence.test.ts:32-45 — the step-12 title case in the it.each table changes with the copy.

**Tests.** Update the title table in onboarding-sequence.test.ts and add two cases: step 12 still passes no onSkip (the copy is the answer, not a skip), and every step that passes onSkip also passes a skipLabel. E2E: add an assertVisible on "Got it" and a takeScreenshot inside onboarding-tour.yml's `when: notVisible` branch, which is the only branch that reaches step 12; the step has never been photographed.

**Risk.** The verified branch is unreachable today, because verification lives behind the onboarded guard and this step runs before that stamp exists. Writing it anyway is what stops the copy from being wrong the day verification moves earlier. The alternative fix, adding onSkip={() => go(13)} to match step 11, is cheaper and worse: it hides the setting from exactly the person the founder added the step for.

### `firstrun-step3-gender-and-shell-floor` — Put Gender in the first viewport and stop the footer eating the question

**Priority** now · **Effort** M · **Ships as** over the air

51-signup-who.png shows the Age field sliced in half by the Continue button, with Gender nowhere on screen and the keyboard up, because the Name field autofocuses (:212) and step 3's footer carries three controls. basicsOk (:130) checks name and age only, so Continue works and gender falls through at its column default, 'unspecified', which is the value AUDIENCE_OPTIONS.verified_women does not match (20260823030000_profile_visibility.sql:74-76). The person also just watched a form field get cut by a button on screen three, which reads as a broken app. The same shell is used by all thirteen traveler steps and all twelve business steps, and its footer has no cap while its scroller has no floor.

<details><summary>Closes 2 audit findings</summary>

- Step 3 hides the Gender field behind the keyboard, so the women-only filter's data ships as 'unspecified'

- StepShell's footer can grow until the question it belongs to is off screen, and there is no floor under the scroll area

</details>

**Changes**

- src/app/onboarding/index.tsx:209-236 — drop `autoFocus` from the Name field, for the same reason and with the same comment shape that join.tsx:182-186 already uses for Email; move the Gender SelectField above the Age field so it sits in the first viewport; extend the subtitle at :196 past "The name people will see, and your age." to name all three.

- src/app/onboarding/index.tsx:125-130 — add a `genderTouched` piece of state set from SelectField's onChange and fold it into basicsOk, so Continue explains what is missing. 'Rather not say' already exists in GENDER_OPTIONS (:65) as the honest opt-out; it just happens to be the silent default too. Add a `note` on the shell saying which answer is outstanding, the pattern step 4 already uses at :249.

- src/features/profile/validation.ts — extract `basicsProblem({ name, age, genderTouched })` so the rule is a pure function with a test rather than an expression inside a component, beside the existing validateDisplayName and validateAge.

- src/features/signup/step-shell.tsx:222-226 — styles.content gets `flexGrow: 1`, so a short step distributes its space instead of pooling all of it above the pinned footer. That is also the dead canvas under the Email field on 50-signup-email.png.

- src/features/signup/step-shell.tsx:137-169 and :234-238 — cap the footer at `maxHeight: height * 0.45` from useWindowDimensions and let it scroll internally with keyboardShouldPersistTaps="always", so the note, the button, the skip and an arbitrary footer slot can never grow past the question at AX5. The PrimaryButton itself stays outside the scroll area, which is the rule in traps.

**Tests.** jest on basicsProblem in src/features/profile/**tests**/validation.test.ts, including the case that made this a finding: name and age valid, gender never touched, Continue refused. e2e/flows/onboarding-tour.yml gains a gender tap between the age input and Continue, waiting for the SelectField's sheet (it opens a native Modal and dismisses the keyboard first, select-field.tsx:53-62), plus an assertVisible on the note before it. Re-shoot 51-signup-who.png at default size, and shoot step 3 and step 5 at AX5, which carry the longest footers.

**Risk.** Requiring a deliberate tap does not produce more gendered profiles: 'Rather not say' writes the same 'unspecified' it writes today. What it buys is that nobody reaches the women-only filter having never been shown the question, and that is the honest claim to make to the founder rather than a promise about the data. Do not add a fourteenth step for gender: docs/ONBOARDING.md section 3 puts name, age and gender together on step 3 as the founder-derived spec. The 45% footer cap is a number chosen without a device; check it at AX5 on the smallest supported screen before believing it.

### `firstrun-signout-hygiene` — Make sign out local, take the push token with it, and stop promising what it never set

**Priority** now · **Effort** M · **Ships as** over the air

signOut (api.ts:95-100) passes no options, so supabase-js's default global scope revokes every refresh token the user holds. That function is wired to the ghost button on "Can't load your profile" (\_layout.tsx:64), the suspended gate (:103), the footer of every onboarding step (onboarding/index.tsx:166) and Cancel on the password-reset screen (reset-password-screen.tsx:63), so a flaky cold start on hostel wifi signs a traveler out on their iPad and Cancel means sign out everywhere. Nothing deletes the device's push_tokens row on the way out, so a signed-out phone keeps showing a real sender's name on the lock screen, which is the one place in this app where a name reaches somebody who is not signed in. And reset-password-screen.tsx:121 makes a security claim about other sessions that no code in this repo sets.

<details><summary>Closes 3 audit findings</summary>

- Sign out is global, so the escape hatch on one device signs the user out everywhere

- Signing out leaves the device's push token bound to the account, so a signed-out phone keeps buzzing

- The reset screen promises a session behaviour the code does not set

</details>

**Changes**

- src/features/auth/api.ts:95-100 — signOut takes `{ scope }` defaulting to 'local', and forgets this device's push token before calling supabase.auth.signOut. Verify the library default against the installed @supabase/auth-js types (package.json pins ^2.112.3) rather than trusting this description, per AGENTS.md.

- src/features/notifications/push.ts — export `forgetPushToken()` beside refreshPushToken (:73-86): getExpoPushTokenAsync, then `supabase.from('push_tokens').delete().eq('token', token)`. The delete-own policy already permits it (supabase/migrations/20260816220000_chat_realtime.sql:171-173) and nothing in the app has ever called it. It must run while the session is live, so before signOut, and it is a no-op wherever pushPossible() is false (:39-41).

- src/features/auth/api.ts:88-93 — setNewPassword calls `supabase.auth.signOut({ scope: 'others' })` after a successful updateUser, which makes the sentence on the reset screen true instead of depending on a dashboard toggle nobody in this repo controls.

- src/features/auth/reset-password-screen.tsx:59-64 — giveUp signs out locally and nothing more, which is what Cancel means.

- src/app/profile-me.tsx — a "Sign out on all devices" row beside the existing Sign out (:381), which is the standard remedy after a lost phone and the only place the global scope belongs.

**Database.** none. The delete-own policy exists already and the app has simply never used it.

**Tests.** jest with a mocked supabase client in src/features/auth/**tests**/sign-out.test.ts asserting the order (token deleted, then signOut) and the default scope. That mock is legitimate here because it proves call order in client code, not that a policy works. Extend supabase/tests/database/09_launch_hardening.test.sql with the attack written as an attack: one user cannot delete another user's push_tokens row, and can delete their own. Source assertion that no signOut call site outside api.ts passes a scope.

**Risk.** If `scope: 'others'` turns out to kill the current session on this GoTrue version, a button labelled "Save and sign in" would drop the person straight back to sign-in. Test it against the live project before shipping; if it does, the copy and the route change instead and that becomes the version of this package. Also note that a token delete that throws must never block the sign out: catch and continue, the way refreshPushToken already does at :83-85.

### `firstrun-pending-intent` — Carry what the guest was doing through sign-up

**Priority** next · **Effort** M · **Ships as** over the air

The gate at map-screen.tsx:1536-1549 hands SignUpGate a reason, a `where` label and a cta, and nothing else. Six screens later the new account lands on the map at the default city in browse mode: the venue they had centred is gone and the plan they were about to write never existed. The same is true of "Make a profile to say hi to Dev" (travelers.tsx:234-243), which does not land them on Dev. This is the highest-intent moment in the product and the one place where finishing the funnel costs the person their work.

<details><summary>Closes 1 audit findings</summary>

- Signup discards the thing the guest was doing, at the highest-intent moment in the app

</details>

**Changes**

- src/features/auth/store.ts — add `pendingIntent: { kind: 'drop-pin'; cityId: number; lat: number; lng: number } | { kind: 'say-hi'; userId: string } | null` beside pendingInvite (:42-54), with intentRemembered and intentHandled. In memory only, matching the recorded rule at :50-52 for exactly this class of state rather than reversing it. The mechanism already exists twice in this file; the audit's grep missed it by searching for returnTo and redirectTo rather than the names this codebase uses.

- src/features/pins/map-screen.tsx:830-838 — enterPlaceMode's guest branch records the intent from lastRegion.current (:764, written at :924) and activeCityId before setGate('drop'). That is the camera the person chose, not a device position: nothing new is collected, and nothing leaves the device until the pin itself is posted through the existing venue-level flow, so section 7 rule 2 is untouched.

- src/app/(tabs)/travelers.tsx:234 — records `{ kind: 'say-hi', userId }` from the featured traveler before its gate renders.

- src/features/auth/handoff.ts (new) — a pure `nextHandoff({ signedIn, listingIntent, viewerIsBusiness, pendingInvite, pendingIntent })` returning at most one action, so the invite and the intent can never both navigate into one freshly mounted stack. Two navigations racing to the top of one stack is the coin toss the comment at (tabs)/\_layout.tsx:25-31 already describes.

- src/app/(tabs)/\_layout.tsx:21-54 — PendingInviteHandoff becomes PendingHandoff and spends whatever nextHandoff returns, clearing before it navigates exactly as :46-50 already does.

- The drop-pin consumption restores the city and camera and puts the map into `place` mode. It deliberately does not open PinFormSheet: that is a native Modal, and this is a data event rather than a tap, which the traps skill names as the dangerous case. Place mode leaves the person one tap from "Pin here" (map-screen.tsx:1406-1412) with no presentation to drop. The say-hi consumption pushes /profile/[userId], which is a plain screen rather than a modal.

**Tests.** jest on nextHandoff in src/features/auth/**tests**/handoff.test.ts, covering every pair of pending states including both set at once and the business case the existing effect already handles. E2E: inside onboarding-tour.yml's `when: notVisible` branch, after "Looks right, finish", assert "Pin here" is on screen and photograph it. That branch runs only when a photo actually landed, so it is honest evidence when it runs and silent when it does not.

**Risk.** Restoring the camera animates the map on the first paint after onboarding, in the same commit that mounts the tabs. If it flickers, move the animation to the map screen's first focus rather than doing it in the handoff. Not persisting means a cold start between the gate and the finished account loses the intent, which is the documented trade at store.ts:50-52; if the founder wants it to survive a relaunch that is a change to the store's stated rule and belongs in the decision list, not in a silent exception.

### `firstrun-resume-onboarding` — Reopen onboarding on the first step that is actually empty

**Priority** next · **Effort** M · **Ships as** over the air

src/app/onboarding/index.tsx:116 is `useState(3)`. Every field is prefilled from the saved profile (:117-124) and saveAndGo writes on the way past each step, deliberately, so no data is lost. But somebody who quit at the photo step, whose phone killed the app, or who reinstalled is put back at "Who are you?" and has to re-confirm screens that each show their own answer already filled in, which reads as though the app did not register them the first time. The saving is done right; only the position is thrown away.

<details><summary>Closes 1 audit findings</summary>

- Onboarding always restarts at step 3

</details>

**Changes**

- src/features/signup/resume.ts (new) — `resumeStep({ profile, hasProfilePhoto, prompts, priorities, trips })` returning a step in [3, 12]. The rule is monotonic: one past the highest step that has data, floored at the first required step that is unsatisfied. That handles the skip case honestly, so a person who passed the bio but added a trip resumes at socials rather than being walked back through four screens they chose to pass.

- src/app/onboarding/index.tsx:94-116 — ProfileSteps seeds `useState(() => resumeStep(...))`. That means the four queries it reads (useOwnPhotos, useProfilePrompts, useProfilePriorities, useMyTrips at :99-107) must have settled before the component mounts, so extend the hold in OnboardingScreen (:82-84) past `if (!profile)` to cover them. Seeding from a query that lands late is a step number that changes under the person's finger.

**Tests.** jest table on resumeStep in src/features/signup/**tests**/resume.test.ts, one case per step boundary plus the skipped-bio-with-a-trip case that decides the rule and the fresh-account case that must still return 3. E2E cannot cover this without killing the app mid-flow, and a state clear is banned from these flows (the OTA note in traps), so the rest of the evidence is one manual relaunch.

**Risk.** Holding on four more queries adds a beat to the first paint of onboarding on a cold start. It is the same kind of hold rootIsReady already takes for profile, standing and business (routing.ts:62-85), and the alternative is worse. If the founder would rather resume at the furthest screen reached rather than the first empty one, that needs a persisted integer and becomes a migration; the derived rule is what avoids one.

### `firstrun-account-credentials` — Let somebody change their email and password without signing out

**Priority** next · **Effort** M · **Ships as** over the air

The only path to a password change is "Forgot your password?" on the signed-out screen (email.tsx:180), so a traveler whose phone was taken has to give up her session, remember which address she used, leave for her mail app on hostel wifi and come back through a deep link. There is no way to change an email address at all, so losing access to an inbox loses the only recovery route. profile-me.tsx has no credentials row in either the traveler branch or the business one, and grep finds updateUser at exactly two call sites, neither of them reachable from inside the app.

<details><summary>Closes 1 audit findings</summary>

- No way to change a password or an email from inside the app

</details>

**Changes**

- src/app/account-credentials.tsx (new) — one StepScreen with two sections. Password: current, then new, and the current one is verified by calling signInWithPassword with the session's own email before updateUser, because supabase.auth.updateUser({ password }) does not check the old one. Email: the new address, then the confirm flow, with the confirm-in-both-inboxes state drawn rather than assumed.

- src/features/auth/api.ts — `changePassword(current, next)` and `changeEmail(next)` beside the existing updateUser callers at :55 (upgradeGuestToAccount) and :89 (setNewPassword, which only works while a recovery session is live).

- src/app/\_layout.tsx — register `account-credentials` as a modal inside the `guard={signedIn}` block at :263-272 rather than the onboarded one, so a business account reaches it too. A business never satisfies `onboarded` by design (routing.ts:32-40), and that is exactly how three other routes ended up doing nothing for them.

- src/app/profile-me.tsx — an "Email and password" row in the traveler actions (:333-352) and in the business account list.

- An account made through Sign in with Apple has no password. Read session.user.app_metadata.provider and render the password section as one line saying the account signs in with Apple, rather than a form that cannot succeed.

**Database.** none. Both operations are GoTrue calls.

**Tests.** jest on a pure `credentialsProblem({ current, next, provider })` validator. The round trip is live-backend behaviour, so the rest of the evidence is a manual change on a throwaway account plus a screenshot of the new screen added to e2e/flows/signed-in-tour.yml.

**Risk.** Confirm-both-addresses is a Supabase project setting (Secure email change). Check it is on before writing copy that promises it: the copy is a security claim, and asserting one the project does not set is the exact mistake at reset-password-screen.tsx:121. The reauth call also means a wrong current password produces a real failed sign-in attempt against rate limits, so the error copy has to survive being throttled.

**Waits on.** Ship the email change now on Supabase's built-in auth mailer, or hold it until a verified sending domain exists? For shipping now: an inbox somebody has lost is the failure this closes, and holding it leaves them with no route at all. Against: the built-in mailer is rate-limited and unbranded, and docs/ONBOARDING.md section 6 already records one address in this project that silently never received mail.

### `firstrun-forced-signout` — Say what happened when a session ends without being asked to

**Priority** next · **Effort** L · **Ships as** over the air

use-auth-listener.ts:106-111 handles SIGNED_OUT by resetting analytics and clearing the query cache, and supabase-js emits that same event whether the person asked or the server forced it: another device signed out globally, the account was deleted elsewhere, the guest janitor swept them. In every forced case the app silently becomes the signed-out app, chats and pins disappear, the avatar becomes a guest avatar, and nothing is said. Separately, nothing under src/ calls getCredentialStateAsync or addRevokeListener, so somebody who tells iOS to stop using their Apple ID with this app stays signed in and reachable in chat indefinitely, which is a trust failure in a product whose whole story is who can reach you.

<details><summary>Closes 3 audit findings</summary>

- A revoked or expired session drops the user into guest mode with no explanation

- Nothing handles a revoked Sign in with Apple credential

- Nothing remembers who this device was, so every reinstall and every forced sign-out starts from a blank field

</details>

**Changes**

- src/features/auth/api.ts — a module-level "the user asked for this" flag set immediately before every deliberate sign out and cleared in the SIGNED_OUT branch. It lives beside the scope parameter added by firstrun-signout-hygiene, which is why that lands first, and it is set in api.ts rather than at the six call sites so there is one place to be right.

- src/features/auth/use-auth-listener.ts:106-111 — when SIGNED_OUT arrives without the flag, record a reason in the auth store instead of falling through to the signed-out stack.

- src/features/auth/store.ts — `signedOutNotice: { reason: 'revoked' | 'apple-revoked' | 'unknown' } | null`, cleared by the screen that shows it.

- src/app/\_layout.tsx — render a SignedOutNotice screen instead of the tabs while that is set, in the same position the recovery branch already pre-empts everything else (:196-202). One line naming the likely reason and a Sign in button, prefilled.

- src/features/auth/apple-revoke.ts (new) — store credential.user at sign-in (api.ts:117-134), call AppleAuthentication.getCredentialStateAsync on every foreground and register addRevokeListener; on 'revoked', sign out locally and set the notice with the Apple reason. Verify both APIs against the installed expo-apple-authentication types (~57.0.1) before writing the calls.

- src/lib/last-email.ts (new) — write the last successfully used address to SecureStore on sign-in and clear it on Delete account; src/app/(auth)/email.tsx:25 seeds its email state from it, which turns both the reinstall path and this notice screen into one tap. The sign-in failure copy deliberately will not say whether the address or the password was wrong (:52-58), which is exactly why the address should not also be a guess.

**Tests.** jest on a pure `signedOutReason(event, userInitiated, appleState)` mapping, and on last-email against a mocked SecureStore (src/lib/**tests**/secure-session-store.test.ts is the same shape and the same store). An Apple revoke cannot be produced in the simulator, so that path's evidence is a manual test on a device and it should be said out loud rather than claimed. Screenshot of the notice screen.

**Risk.** Getting the flag wrong in the other direction is worse than the bug: a deliberate sign out that then shows "You have been signed out" with a reason reads as a fault in the app. Belt and braces: treat an unflagged SIGNED_OUT that arrives within a second of a flagged one as the same event. Also, iOS keychain items survive an uninstall, so the last-email store outlives the app on a resold phone; that is the founder decision attached to this package.

**Waits on.** Keep the last-used email in the keychain across an uninstall? For: the returning user is the person this exists for, and the sign-in error copy deliberately will not tell them whether the address or the password was wrong. Against: iOS keychain items survive a reinstall, so a resold or handed-on phone prefills the previous owner's address.

**After.** `firstrun-signout-hygiene`

### `firstrun-listing-intent-persisted` — Stop a half-finished listing from turning into traveler onboarding

**Priority** next · **Effort** L · **Ships as** over the air + Supabase deploy

join.tsx:108-111 calls listingStarted() and replaces into /business-signup, and business-signup.tsx:105-109 puts the flag back down in a mount effect. From that moment owesOnboarding (routing.ts:17-42) reads the account as a traveler who has not finished, so \_layout.tsx:220-225 filters (tabs) out of the tree and mounts onboarding. Steps 4 to 11 of the listing form have no exit at all and step 3's is undefined whenever canGoBack is false, which is the normal case after a replace, so the real abandonment is killing the app, and the flag is in-memory zustand. The bar owner reopens and is asked for their first name, their age and their photos, in the one flow a business must never finish: completing it stamps onboarding_completed_at and register_business then refuses the account (20260829160000:108-118).

<details><summary>Closes 1 audit findings</summary>

- Abandoning business signup drops a bar owner into traveler onboarding

</details>

**Changes**

- supabase/migrations/<timestamp>\_listing_intent.sql — `alter table public.profiles add column wants_business boolean not null default false`, in the same column grant the client already reads, plus `set_listing_intent(p_wants boolean)` as a security-definer RPC scoped to auth.uid(). No RETURNS TABLE function changes OUT columns here, so no drop-function is needed; if a profile-reading function is widened to carry it instead, that function must be dropped first and its grants re-stated.

- src/features/auth/routing.ts:17-42 — a fourth branch: an account carrying the flag with no business row does not owe traveler onboarding. It returns false, which mounts the tabs, which is what gives the person somewhere to back out to. Returning a third value and mounting business-signup as the stack would leave the back button with nowhere to go, which is the bug this package exists to close.

- src/app/(auth)/join.tsx:38-45 and :108-111 — chooseKind and submitPassword write the column through the RPC as well as setting the in-memory flag, so the answer survives a cold start.

- src/app/business-signup.tsx — every step from 3 to 11 gets the same explicit close to /(tabs). Today only step 3 has one (:309) and it evaluates to undefined after a replace, so steps 4 to 11 have no exit whatsoever.

- src/app/profile-me.tsx:352-375 — for an account carrying the flag, the "Run a business?" alert that tells a traveler to sign out is replaced by a row that resumes the listing.

- src/features/guest/hooks.ts:59-70 — fold the flag into the `anonymous` predicate, so an account waiting to become a business reads the faceless map feed rather than the traveler directory while it waits. It is about to be covered by the business rule that a business never reads a traveler discovery surface, and there is no reason to hand it names in the meantime.

**Database.** One new migration: a boolean column on profiles plus a security-definer set_listing_intent RPC scoped to auth.uid(). No OUT columns change, so no drop function is required; if that turns out to be wrong because a RETURNS TABLE profile function has to carry the column, drop it first and re-state its grants.

**Tests.** pgTAP supabase/tests/database/30_listing_intent.test.sql written as the attack: one account cannot set another account's flag and cannot read it, and register_business still refuses an account that has finished traveler onboarding. jest cases for the fourth branch in src/features/auth/**tests**/routing.test.ts. E2E in e2e/flows/business-tour.yml: start the listing, exit at step 3, assert "Drop a pin" is on screen. Add business-signup.tsx to the exempt list in src/app/**tests**/business-exits.test.ts with the reason written down, because its replace is deliberately unguarded.

**Risk.** Making owesOnboarding return false for these accounts widens what the tabs mount for them. Everything a traveler does is still guarded on `onboarded` (\_layout.tsx:273), so the exposed surface is the map and Travelers, which the guest-hooks change closes. Get that half wrong and a bar owner is handed a traveler directory, which is a finding another subsystem has already paid for once.

**Waits on.** Where should the listing intent live, and what should an account see while it waits? For a column on profiles: it survives a cold start and a reinstall, which is the whole point, and it is the only thing that lets the profile page offer to resume rather than telling somebody to sign out. Against: it puts a business-shaped fact on a traveler table, and it hands a not-yet-business account the traveler tabs for as long as the listing takes, which is why the guest-hooks change is part of the same package rather than a follow-up.

### `firstrun-finish-your-profile` — Offer back the sections onboarding was allowed to skip

**Priority** next · **Effort** M · **Ships as** over the air

Steps 6 through 11 are six one-tap skips by design, and docs/ONBOARDING.md section 2 records the founder asking for exactly that shape, so moving them out of the funnel is not the answer. What is missing is the second ask: nothing anywhere notices that a profile has no prompt, no priorities and no bio, while the Travelers screen is built to show all three. A person who skipped everything ends with a photo and a name, and no surface ever tells them.

<details><summary>Closes 1 audit findings</summary>

- Six consecutive self-description screens sit between the photo and the app

</details>

**Changes**

- src/features/profile/completion.ts (new) — a pure `profileGaps({ profile, prompts, priorities, trips, handles })` returning the ordered list of unanswered sections and a count, reading the same queries onboarding already reads at index.tsx:104-107.

- src/features/profile/finish-card.tsx (new) — a card listing the gaps, each row deep-linking to the editor that already owns it (/edit-prompt, /edit-priorities, /add-trip, /edit-profile), which are the same routes onboarding pushes to at :378, :423, :470.

- src/app/profile-me.tsx — render it at the top of the owner's profile when there are gaps, dismissible for the session.

- src/features/profile/profile-view.tsx — surface the prompts row the first time somebody reads another traveler's prompts, which is the moment its value is obvious. Keep the trigger there and the card here, so there is one component that knows what a complete profile is.

**Tests.** jest table on profileGaps in src/features/profile/**tests**, including the empty case, which is the one that must draw nothing at all. Screenshots of the profile tab with gaps and without, added to e2e/flows/signed-in-tour.yml.

**Risk.** This is the third surface asking for the same six answers, after the funnel and the editors. If it is not dismissible, and if it does not vanish the instant the last gap closes, it becomes a nag on the one screen a person owns. The empty case is the important test. profile-me.tsx and profile-view.tsx belong to the profiles subsystem; this is written from the onboarding side and should be merged with whatever that subsystem plans for the same screen before either is built.

### `firstrun-tour-composition` — Show the product in the tour and give the choice its own page

**Priority** next · **Effort** L · **Ships as** over the air

Each explainer page is a 104pt grey rounded square with a generic SF Symbol in it (intro-tour.tsx:70-92, styles.iconBadge:555), with roughly 200pt of empty canvas above it and 230pt below the Next button. The brief names dead cities as one of the two killers of this category, and the most persuasive asset the product has, a Bangkok map with fifteen warm pins that this app already renders, is replaced by a map-shaped icon that proves nothing. The last page then does two jobs at once: four controls stack under a heading about chat, with the sign-in link and the business door competing at the bottom of the visual stack. And the welcome screen crams the wordmark, the one sentence carrying the whole proposition, and the button into the bottom third.

<details><summary>Closes 3 audit findings</summary>

- The tour explains the product without ever showing it: three grey glyphs and the largest dead regions in the app

- The account decision is bolted onto the third feature explainer, so four choices arrive under a heading about chat

- The welcome screen puts its whole argument in the bottom third and leaves the top half empty

</details>

**Changes**

- assets/images/tour-map.png, tour-travelers.png, tour-chat.png (new) — three stills captured from the simulator suite (.claude/skills/screens), cropped tall. The traveler and chat stills are composed with placeholder content: scripts/demo-travelers.json is AI-generated portraits that LAUNCH_RUNBOOK schedules for purge, and none of those faces goes into a bundled asset.

- src/features/intro/intro-tour.tsx:63-92 and :367-371 — Page gains an image, and the SymbolView inside PageLayer is replaced by it at the same factor 0.55, so the parallax is unchanged. Cap each image at 45% of page height so the title, body and Next pill stay above the fold at MAX_FONT_SCALE 1.2 (:61).

- src/features/intro/intro-tour.tsx:95, :283, :289, :402-454, :485 — the choice moves to a fifth page of its own, headed with the promise rather than a feature. PAGE_COUNT is derived as PAGES.length + 1 and feeds the dot row, the emblem dock interpolation and `last`, so the new page needs its own render branch rather than a fourth PAGES entry. The chat explainer keeps its own Next, which is the rule written out at :384-393.

- src/features/intro/intro-tour.tsx:434-452 — a hairline above "Run a business? Put it on the map" so the business door reads as a different kind of thing rather than a fourth option. This half is cheap and can ship on its own.

- src/features/intro/intro-tour.tsx:518-525 and :544-547 — close the welcome gap from below by reducing welcomeAction's marginTop and the welcomeBlock gap. The mark does not move: welcomeTop (:293) is the splash handoff target, and rescaling it either breaks the cross-fade or leaves a raised wordmark sitting on top of a static mark at rest.

**Tests.** jest source assertion that the dot row and the emblem interpolation both read the derived PAGE_COUNT, since a hardcoded 4 is exactly the bug a page split invites. Re-shoot 00-welcome.png, 00a-tour-map.png, 00b-tour-travelers.png, 00c-tour-choice.png and a new fifth, and read them at MAX_FONT_SCALE. guest-tour.yml taps 'Skip' and is unaffected, but its page-count comment needs updating.

**Risk.** A view at opacity 0 is skipped by UIKit hit-testing, so the new page's Next must not sit behind a delayed entrance; that trap already cost this file once and the comment at :340-344 records it. Bundled assets do ship in an EAS Update, but they are downloaded rather than embedded, so the first launch after an update fetches them: check the tour on a cold install of the binary, not only after an update.

**Waits on.** Bundle screenshots of the app inside the tour? For: it is the only thing on the first screen anybody sees that proves the map is real, and the brief names an empty-looking product as one of two category killers. Against: every still has to be re-shot whenever the screen it photographs changes, which is a standing maintenance cost on a screen nobody revisits.

### `firstrun-reset-web-path` — Land password reset on a web page instead of a custom scheme

**Priority** later · **Effort** S · **Ships as** over the air + Supabase deploy

api.ts:79-80 points resetPasswordForEmail at samewhere://reset-password. iOS Mail follows it, but Gmail's in-app webview and several corporate clients will not hand an unknown scheme to the OS and show a blank page or an error instead. The common case of opening the email on a laptop has no path at all, and there is nothing that says to open it on the phone. The careful parsing on the far side, features/auth/recovery.ts, never gets a chance to run.

<details><summary>Closes 1 audit findings</summary>

- Password reset depends on a mail client following a redirect to a custom scheme, with no web path at all

</details>

**Changes**

- src/features/auth/api.ts:79-80 — redirectTo becomes https://<domain>/reset.

- The Supabase project's Auth redirect allowlist has to carry that URL. This is a dashboard change, not a migration.

- The page itself attempts the samewhere://reset-password handoff with the fragment intact, falling back to a line saying to open the link on the phone with the app installed, plus the store link.

- app.json carries no associatedDomains today and does not need one for this: the page does the handoff in JavaScript rather than relying on a universal link, so no EAS build is involved.

**Database.** none. The Supabase-side change is an Auth redirect allowlist entry in the dashboard.

**Tests.** Nothing automatable. The evidence is the emailed link opened three ways: iOS Mail, Gmail's in-app webview, and a laptop browser, with what happened in each written down.

**Risk.** Pointing redirectTo at a domain that does not resolve is strictly worse than the custom scheme it replaces, so this ships only after the page is live and only after the allowlist entry exists. Until then, leave api.ts alone.

**Waits on.** This cannot start until a domain is bought, which docs/UX_PLAN.md already carries as its first Tier 1 decision and docs/LAUNCH_RUNBOOK.md step 2 records as deferred on 2026-08-29. For: it is the same afternoon's errand as the Resend DNS records and the invite links, and it turns a dead laptop link into a working one. Against: nothing about the app, except that it is a purchase rather than a decision.

---

# Part 5 — What is deliberately not being done

150 findings were judged not worth acting on. Recorded with the reason, so the choice is visible.

### Pin

| Finding                                                                                                           | Why not                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venue names are stored in whichever language MapKit spoke to the pinner, so one bar becomes two places on the map | Refuted by the code, on three counts. Markers are merged by COORDINATE, not by name: clusterPins (src/features/pins/cluster.ts:47-62) groups any pins within 30m, so a Thai phone's pin and an English phone's pin on the same rooftop  |
| Make 'other' always pass the category filter in src/features/pins/filters.ts                                      | The cure is worse. It turns the Other chip into a no-op and puts non-bars on a map somebody deliberately filtered to Bar. The honest fix is at the source, which is what pin-category-from-plan-text and pin-nearby-venues do.          |
| Bring drop-pin.tsx to parity with the sheet, or share a category rail between them                                | Superseded by deleting it. map-screen.web.tsx:14-15 already records that web is a dev convenience and iOS is the product, and the sheet's category comes from a tapped POI that a web list cannot produce. Parity would mean maintaini  |
| Give the pin sheet a taller detent so the location, day and plan field fit above the keyboard                     | Not available. components/ui/sheet.tsx:252 already sets maxHeight to `height - insets.top - Space.lg`, and measuring 14-pin-form.png puts the sheet's top edge at exactly that cap. The sheet is as tall as it can be; content cost is  |
| Label the expiry chips Tonight / Tomorrow / 72h                                                                   | The intent-date rail directly above already reads Today / Tomorrow / Monday, and two rails sharing those words is worse than one control that needs a scroll. pin-sheet-fits puts the value in the heading and pins a one-line readout  |
| Change drop-pin.tsx:75's subtitle to 'A plan for later. It disappears on its own within 72 hours.'                | The file is being deleted. It is also reachable only from map-screen.web.tsx:59, so the edit would have moved nothing on the shipped iOS app even if the file stayed. Worth noting the audit's premise was wrong twice over: the line   |
| Add a useDiscardGuard hook with gestureEnabled: !dirty to compose-request.tsx                                     | Different subsystem and a different mechanism. compose-request is a native-stack modal declared at \_layout.tsx:289, where a swipe dismissal cannot reliably be intercepted — which is exactly why edit-profile.tsx:105-107 settled for |
| The web pin list bypasses the audience setting, so the two clients disagree about who can see whom                | Refuted. map-screen.web.tsx:45-56 reads city_pins, which is SECURITY INVOKER on purpose (20260829120000_a_pin_anyone_can_join.sql:177-184) and therefore governed by pins_select_visible (20260816210000_map_pins.sql:132-145): expiry  |
| Delete the sender's message_requests row when a hello is withdrawn                                                | It frees the `unique (sender_id, recipient_id)` slot (20260816200000_trips_matching.sql:394, commented 'one shot per direction, ever (anti-pester)'), turning one shot into unlimited re-sends at the same person, and it destroys the  |
| System messages answer the safety question 'who else is in this group'                                            | Already answered elsewhere. src/app/group/[id].tsx:538-580 renders a full roster with photos, names and roles behind the (i), and the thread header prints the member count. What is missing is the change record, not the membership   |
| Add the top fade and grabber inset in components/ui/sheet.tsx                                                     | It would wash out the first row of every other Sheet in the app — select-field, language-field, trip-editor, push-primer, the map's four call sites — none of which scrolls. The defect is also not quite what the finding says: the g  |

### Map

| Finding                                                                                                                     | Why not                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first traveler a guest ever sees has "[demo]" glued to the end of their bio (and its two duplicates)                    | Not the map. The Travelers card is another subsystem's surface, and the marker is a deliberate, documented safety device with a scheduled purge in docs/LAUNCH_RUNBOOK.md:149 and a workflow that finds the rows BY that string. Raise |
| The safety setting most women open the app for is four greyed rows and a clipped sentence                                   | src/features/profile/audience-picker.tsx and visibility.tsx — the profile subsystem. The map only consumes the resulting audience through AudienceChip, which already works. Note for whoever owns it: the verifier established the di |
| Every group in the Chat tab wears the same house icon; the Groups list flattens three objects into one row                  | src/app/(tabs)/chat.tsx — the chat subsystem. The map's contribution is that PinGlyph and the category set already exist for it to reuse. The expiry half of the second finding is refuted outright: post_joinable_pin inserts the pla |
| Three competing ways to start the same message on one traveler screen                                                       | src/features/profile/profile-view.tsx — the profile subsystem, and the verifier showed the floating bubble is already the photo's own anchored Reply. The residue is a missing visible label, which is a one-line fix in a file the ma |
| The group invite QR is a 460pt block of pure white; the invite screen never says what the link grants                       | src/features/groups/ and src/app/group/[id].tsx — the groups subsystem. Also the QR measurement was overstated by more than double (about 200pt, not 460), and the proposed inversion would trade a brightness complaint for scan fail |
| Group and chat photos get no crop control; three different ways of asking for a photo                                       | src/lib/pick-image.ts and the photo subsystem. Nothing on the map picks a photo.                                                                                                                                                       |
| The trip calendar is hardcoded Sunday-first with English letters; the language picker sizes its list from the window height | src/features/trips/trip-calendar.tsx and src/components/form/language-field.tsx. Both are real and both are one-line-ish fixes, but neither is on the map and bundling them here would hide them from whoever owns those screens.      |
| Device-local state is not scoped to the account (passed travelers, celebration, push primer)                                | Only the heat-legend half is mine, and it is folded into the message-slot package. The passed-travelers and push-primer keys are the ones that actually harm a second account on the same phone, and they belong to matching and notif |
| The daily smoke test is a SQL query nobody runs — no alerting on the pipeline the metrics depend on                         | Ops and infrastructure, not the map. It is worth doing — moderation fails closed, so a dead worker looks like a product problem — but it has nothing to do with markers, camera or heat and would be invisible in this plan.           |
| Collapse every cluster to a single numbered disc (the second half of the three-circles finding)                             | It reverses the recorded decision at pin-marker.tsx:145-150 and throws away the faces that make a cluster worth tapping once people have photos. The planned marker package fixes the photoless case, which is the only case any scree |
| Tapping the already-selected city chip does nothing (the premise of the pan-away finding)                                   | False. map-screen.tsx:1145 calls selectCity unconditionally and selectCity has no same-city early return, so it animates home at 0.09 delta. The real problem is that nobody would guess a selected chip is a recentre button, which i |
| Opening a pin card does not move the map (the headline of the camera-nudge finding)                                         | False as stated. map-screen.tsx:1068-1079 does animate on a single-pin tap, under a comment saying exactly why. Only the cluster handler at :1046 and the BusinessMarker handler at :1027 lack it, which is what the camera package fi |
| The Filters sheet needs a shorter detent                                                                                    | There are no detents. components/ui/sheet.tsx:246-253 sizes to content under one maxHeight, so the fix is a maxHeight on the filter sheet's own body — planned that way rather than as a detent system nobody would build for one scre |

### Travelers

| Finding                                                                                        | Why not                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tapback row floats a bubble's height away from the bubble and lands on the day separator   | Not this subsystem, and mostly not true. src/features/chat/message-thread.tsx:705 already positions the emoji row from the same measured rect as the action card, exactly LIFT_GAP = 10pt above the lifted bubble, so the recommendati  |
| The members explainer describes a control the reader cannot see                                | Groups subsystem — src/app/group/[id].tsx, nothing to do with the travelers queue or matching. Worth noting for whoever owns it that the named action sheet the finding asks for already exists at group/[id].tsx:68-107; the only rea  |
| Accepting a hello, joining a plan and taking down a pin all wait for the server                | Two of the three claims fail on inspection and the survivor is not mine. src/features/pins/map-screen.tsx:390-407 already spins the join button and navigates on success, and 'Take it down early' dismisses the card on the tap at :3  |
| Blocking is permanent: there is no unblock anywhere in the app                                 | Real, confirmed, and not the travelers queue — it is trust and safety plus the account page: two RPCs, a delete policy on public.blocks (which does not exist today, contrary to the finding's assumption), and a blocked-travelers sc  |
| The guest Travelers tab and the signed-in one are two unrelated screens with the same tab icon | Half of it is answered elsewhere and the other half is a bad trade. The 'no title, no orientation' complaint on the member screen is closed by tq-queue-scope, which puts a persistent line above the hero on every traveler. Convergi  |
| Strip "[demo]" from every seeded bio and mark the seeds in a column instead                    | docs/LAUNCH_RUNBOOK.md step 4 purges the six demo travelers before real users arrive, so this is a marker that deletes itself on launch day. Relocating it costs a column on profiles, a drop-and-recreate of a guest-facing SECURITY   |
| Drop the floating reply bubble over the photo and add bottom padding equal to the dock height  | Both halves are refuted by the code. The bubble is labelled for VoiceOver (profile-view.tsx:802 passes label="Reply to this photo") and it does something different from Say hi — it opens the composer anchored to the hero photo. An  |
| Make the Travelers card hero 4:5 to match the profile hero                                     | The cited style is the guest teaser card, not the signed-in one (the member hero is heroWidth \* 1.15 in profile-view.tsx:755, not 3:2). And the 3:2 is a recorded trade with its reason in the comment at travelers.tsx:165-172: a ful |
| Drop `disabled` on Say hi and route the press to the Chats tab                                 | It fixes a state that cannot happen. The queue filter at travelers.tsx:543-553 removes every candidate present in sentByRecipient or chatByUser before `current` is chosen, so `requested` and `chatId` are always undefined and the b  |
| Demote Decline to a text button so the two answers are not the same weight                     | Already shipped. src/app/(tabs)/chat.tsx:197 gives Decline variant='ghost', and src/components/form/primary-button.tsx:36-80 renders ghost as transparent, unraised, 44pt minimum against Accept's 52, with haptic='none' against Acce  |
| Rename the spotlight chip to "Today's pair" or "Both of you got this today"                    | "Pair" is dating grammar sitting directly above a stranger's photo, which is the frame the whole package exists to remove. The chip stays 'Today in {city}' — it is accurate, it names the city, and it is the line beneath it that wa  |

### Profile

| Finding                                                                                                           | Why not                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finding 16's city-aware placeholder table (per-launch-city priority examples keyed on the soonest trip's city_id) | Three arrays and a lookup is cheap; the content is not. Every launch city needs two hand-written examples reviewed against the copy rules, and the set has to be maintained as cities open. Reordering PRIORITY_PLACEHOLDERS so index  |
| Finding 44's blurhash/thumbhash placeholder                                                                       | Needs a column on profile_photos, generation inside processAndUploadImage, a backfill for existing rows, and a decoder on the client, to replace a Skeleton that costs three lines and is already the pattern place-sheet.tsx:168 uses |
| Finding 47 as a standalone orientation package                                                                    | Lifting the lock per screen needs expo-screen-orientation, which is a native dependency and therefore an EAS build, for two screens one of which does not exist yet. Folded the viewer's half into prof-photo-viewer and raised the ge |
| Finding 28's 'show what proportion of travelers in this city are verified' on the visibility screen               | A new aggregate over the discovery population, which is precisely the class of thing hard rule 6 constrains, and it would need its own k-threshold reasoning before it could be rendered. That is real privacy risk for a nudge.       |
| Finding 26's one-time reminder after the badge lands, and finding 50's day-25 guest push                          | There is no notification-preferences surface anywhere in src/app — only the primer in src/features/notifications/push-primer.tsx. A lifecycle push people cannot turn off is worse than the sentence that replaces it, and both findin |
| Finding 13's 'rename edit-priorities continueLabel to Save list'                                                  | 'Done' is the shared StepScreen footer vocabulary (step-screen.tsx:56 default, visibility.tsx:37). Renaming one screen leaves the same collision on every other StepScreen whose continueLabel is Done. Fixed the one keyboard bar tha |
| Finding 3's broader 'eight different words for cancel' audit                                                      | The count is wrong: seven distinct labels, and 'Fair enough' is a PrimaryButton on compose-request.tsx:149, not a cancel. Most of the variation is good writing — Stay/Leave and Keep it up/Take it down are proper antonym pairs and  |
| Finding 8's 'wrap the About paragraph in PressableScale' and the one-shot hero pulse                              | profile.bio is free text up to 500 characters; one giant button costs text selection and hands VoiceOver a single enormous element. And a teaching animation needs a reduce-motion check plus a once-per-install AsyncStorage flag to  |
| Finding 37's determinate upload progress ring                                                                     | supabase-js exposes no upload progress. The alternative — an XHR to a signed endpoint — would move the upload off processAndUploadImage, which is the single place the image pipeline lives for profile photos, verification selfies a |
| Finding 19's 'make sendMessageRequest's failure path keep the composer mounted with the text intact'              | Already implemented. compose-request.tsx:118-123 catches the rejection with an empty body and the comment 'Surfaced by the global mutation error alert; stay on the composer' — the screen stays mounted and the typed text survives.  |
| Finding 41's 'pass aspect explicitly on Android where a ratio matters'                                            | Android is not shipping and AGENTS.md asks only that the code stay cross-platform-clean. Removing the no-op aspect from verification.tsx and documenting that the option only reaches Android achieves that; adding Android-specific r |
| Finding 32's proposed unblock_user(p_blocked_id uuid) RPC                                                         | blocks_delete_own already exists and delete is still granted to authenticated (20260816200000_trips_matching.sql:91-96). An RPC would be ceremony around a policy that already says the right thing, and it would add a second place w |
| Finding 34's 'add Notifications and Email address rows to the business account page'                              | Same reason as the traveler side: nothing is built behind either. A row that opens nothing is worse than no row. Revisit when the notification preferences screen exists.                                                              |
| Finding 7's 'move AUDIENCE_NEEDS_BADGE above the AudiencePicker on visibility.tsx'                                | visibility.tsx:57-60 records that placement being deliberately fixed after E2E run 55 photographed the Get verified button falling off a 6.1" screen, and 18b-who-can-see-you.png shows the explanation and the button both fully visi |
| Finding 35's 'change ProfileHero's aspectRatio at profile-hero.tsx:69'                                            | src/components/ui/profile-hero.tsx is dead code. A repo-wide grep for ProfileHero returns only its own definition, so editing that number would have changed nothing on any screen. The file is deleted in prof-photo-input instead.   |

### Design system

| Finding                                                                                                                            | Why not                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Give Sheet a `detents` prop with a large detent, so the pin card, place card and venue stack can be pulled taller                  | Does not survive the file. The sheet's maxHeight is already `height - insets.top - Space.lg` (sheet.tsx:252), essentially full screen, and it sizes to content — PlaceSheet's ScrollView (`flexShrink: 1`, place-sheet.tsx:459-461) al  |
| Render the guest Travelers card with the same full-bleed ProfileView the signed-in tab uses                                        | Recorded decision, and the screenshot does not support the premise. travelers.tsx:135-141: "Compact on purpose. This is a teaser with a sign-up card under it, and a full-height photo pushed that card off the bottom of the screen -  |
| Elevation runs backwards; add a `surfaceRaised` token above surfaceSunken                                                          | The palette premise is false. Sheets are `theme.surface` #171A2E (sheet.tsx:251), not surfaceSunken #20243D, and GlassSurface's non-glass fallback uses the same #171A2E, so the fallback would be invisible rather than darker. The h  |
| Give the segmented thumb an accentSoft fill and Elevation.raised                                                                   | accentSoft #1D2742 against surface #171A2E is 1.17:1, a 0.03 improvement on today's 1.13:1 and still nowhere near a perceivable difference, so it buys a token change and no legibility. Elevation.raised is a drop shadow at 6% opaci  |
| Set `automaticallyAdjustKeyboardInsets` on the StepScreen ScrollView                                                               | It would double-count. The ScrollView is already inside KeyboardFloor (step-screen.tsx:69), which pads the parent by `keyboard.height - insets.bottom`, and KeyboardFloor is this project's settled answer for exactly this class of b  |
| Use `accessibilityLiveRegion="polite"` and `accessibilityRole="alert"` as the mechanism for state announcements                    | Both are Android-only in React Native and are no-ops on iOS, which is this app's platform. `AccessibilityInfo.announceForAccessibility` is the mechanism that works, so it becomes the primary path in ds-voiceover-state and the live  |
| Flip themed-text's precedence to `(Type[type] ? type : LEGACY[type])` as a one-liner                                               | Not safe as a one-liner: it silently shrinks all 19 `type="title"` sites from 32pt to 24pt in a single commit while leaving `subtitle` resolving to 24pt as well, so two roles collide at the same size with different names. The same  |
| The real Type.title at 24pt cannot be produced at all, and there is no step between a screen title and the biggest thing the scale | Both halves are false and the finding contradicts itself one sentence later. `type="subtitle"` resolves to Type.title and components/form/step-screen.tsx:80 uses exactly that; headline 18/24 also exists between them. The shadowing  |
| Fire PressableScale's haptic in onPress rather than onPressIn for row-shaped controls                                              | The component's whole documented press feel is touch-down — "a quick spring down on touch, a slightly bouncier spring back on release, and a haptic on the way in" — and it is used on every button in the app. Changing the timing ap  |
| "Leave this chat" shows no confirmation, so the red label is doing all the warning work                                            | Not true. src/app/group/[id].tsx:228-239 has `confirmLeave` with an `Alert.alert('Leave this chat?', 'You stop getting its messages.', ...)`. The screenshot simply predates the tap. The haptic on that confirm is real and is in ds-  |
| Extract a bespoke components/ui/stack-header.tsx                                                                                   | Wrong mechanism. The lone circular back button is the native iOS 26 Stack header with `headerTitle: ''` set on eight routes in src/app/\_layout.tsx (:237-305), plus `headerBackButtonDisplayMode: 'minimal'` globally at :213. The row |
| Give the traveler Chat tab the same "Messages" title the business version has                                                      | It would put a title above a Segmented control the business branch does not have, adding a second header row on one branch only — reintroducing exactly the divergence the empty-state package exists to remove. If the tab wants a ti  |
| Drop the legacy theme.tint / theme.backgroundElement reads so the alias block at the bottom of theme.ts can be deleted             | Out of proportion to the chip work. `backgroundElement` has more than forty readers across src/, including `ThemedView type="backgroundElement"` on about twenty screens, and `tint` is read by verified-seal, guidelines, verificatio  |
| Add Increase Contrast handling                                                                                                     | There is no meaningful app-level knob here. The palette is dark-only and every functional pair is already computed well above its floor (text 16.7:1, accent 7.9:1, border 3.4:1 for edges), and iOS's Increase Contrast mostly affect  |
| The pt measurements in the empty-state finding (600pt of dead space above, 1100pt below) and in the header finding (150pt of heade | Impossible numbers on an 874pt-tall screen; they are raw pixel counts at 3x. Measured off the screenshots the guest gap is roughly 200pt and the signed-in void roughly 470pt, and profile-me's first card starts about 57pt below the  |

### Chat tab

| Finding                                                                                                                    | Why not                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Have an invite?" is dressed as a conversation — give it no avatar well, an accent-tinted label and a section gap above it | Refuted by the picture. 27a-chat-list-with-a-row.png shows the row already carries a link glyph rather than the house, tint="quiet", a chevron none of the conversation rows have, and a visible section gap. Three of the four differ |
| Push a 24-hour warning before an auto-archive, for chats where the other person wrote last                                 | It needs a per-chat scheduled job the product does not have, and its privacy carve-out — never push for a chat where YOU wrote last, because that tells the sender their message went unanswered, which is a decline in everything but |
| Reorder the swipe actions to Pin, Archive, Mute so the far-right slot is not the most destructive-looking                  | Once Archive is painted accentDeep instead of danger, the far-right slot is not the one that reads as destructive, so the reorder buys nothing and costs the muscle memory people build on a gesture they use daily.                   |
| Collapse the extra incoming hellos behind a chevron into a dedicated screen                                                | A new route for a list that is at most a handful of cards. Expanding in place keeps the accept-or-decline decision on the screen the person is already standing on, and it is one useState instead of a route, a header and a back pat |
| Draw a small cluster of member photos on a traveler group's row                                                            | A photo cluster is a bespoke composite inside a 52pt circle, and my_chats returns one photo_path per row, not the members'. Rendering the group's own photo when it has one gets the same recognisability for a one-line change; the c |
| Put the business's cover thumbnail on its room row                                                                         | my_chats returns g.photo_path for every room, so a business room's photo_path is null there. Adding it means a third OUT column AND a bucket branch in the row, because a business photo signed through usePhotoUrl comes back a 404 w |
| Add a test asserting no user-facing string matches /\b(here now/near you/right now)\b/                                     | The 'right now' third would fail src/app/business-post.tsx:340-343 ("3 of 5 up right now") and src/app/verification.tsx:96 ("One selfie, taken right now"), both of which are correct copy. The test in chat-honest-city-and-counts as |
| Heading should read "Open chats in Bangkok, where you are Aug 30 to Sep 4"                                                 | It states a date range back at the person who typed it, on a section heading, and it runs past one line at large Dynamic Type on a screen that already has a fixed-height row problem. Naming the city is the whole fix; the date adds |
| On a successful block, pop back to the chat list and show the row with a blocked marker                                    | my_chats gives a blocked chat and one the other side left the same chat_status ('closed', per sever_on_block), so the list marker needs the same blocks lookup the composer branch needs and says less with it. And popping the person |
| Move useMessages to useInfiniteQuery keyed on the oldest loaded created_at                                                 | The ['messages', chatId] key is written as a flat MessageRow[] by the realtime handler at hooks.ts:52-62 and by every optimistic send, fail and discard path in features/chat/outgoing.ts. Switching to useInfiniteQuery changes that  |
| Add "Your chat opens when a traveler writes to you" as the business's empty-room detail line                               | It would be a third statement of emptiness on a screen that already has two. Suppressing the zero count and folding the sentence into the one card, with the Post something button, is the version that leaves the owner with somethin |
| Hide the segmented control on the guest Chat tab because neither segment has anything behind it                            | Only half true, and acting on it would remove a feature. The guest Groups segment renders RoomDiscovery at chat.tsx:862, city_rooms is granted to anon, and 21-chat-groups.png shows it returning a real row. Hiding the control would |

### Thread

| Finding                                                                                                                           | Why not                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constrain the long-press menu's emoji row to the lifted bubble's width and align it to the bubble's edge (from "The reaction menu | I looked. styles.menuSide (message-thread.tsx:1213-1217) already applies sideOf(mine), so the pill IS aligned to the bubble's side. It looks full-width because it cannot be narrower: six 44pt hit targets plus the plus button plus  |
| Show a count on the reaction pill when more than one person has used the emoji                                                    | Already built. message-thread.tsx:202-206 renders the count whenever row.count > 1 and the accessibility label at :187 is `${emoji} ${count}` unconditionally. Screenshot 26 shows a bare heart because that reaction has exactly one  |
| Put a header block at the top of group settings with the photo, name, member count and end date; add rename                       | All of it is already the FIRST block in the ScrollView: src/app/group/[id].tsx:308-357 is the photo picker plus a prefilled Name field for admins (saveName at :274-285) or a title for members, :537-540 is the member count, :378-50 |
| Give the per-member control an accessible label naming both actions ("Manage {name}")                                             | Already shipped: src/app/group/[id].tsx:162 is `accessibilityLabel={`Manage ${name}`}` on the ellipsis in the canManage branch. Deleting the position-based paragraph above it is the part worth doing and is in the words package.    |
| Add expo-clipboard's setStringAsync as a "Copy" action, and add dataDetectorTypes to the bubble text                              | Both are wrong as written and I checked each. expo-clipboard is not in package.json:13-36, so it is native code and costs an EAS build, which AGENTS.md and the ship skill both say to avoid for a JavaScript-shaped change. `dataDete |
| Add `selectable` to the bubble body as a cheap second copy path                                                                   | It cannot work here. The bubble owns a 220ms long press (message-thread.tsx:452) and claims the responder in the bubble phase, so iOS's own text-selection recogniser never starts. This is precisely the class of change the traps sk |
| Give the composer's photo attach button the same disabled-state and press-feedback fix as Send                                    | It does not have that bug. PhotoButton is src/components/ui/photo-button.tsx, not composer.tsx; it already has a pressed style and already expresses disabled by COLOUR (`tintColor={disabled ? theme.textSecondary : theme.accent}`). |
| Add an explicit accessibilityState to Send so VoiceOver says "dimmed"                                                             | React Native folds the `disabled` prop into accessibilityState already. A second, hand-written one can only contradict the first.                                                                                                      |
| A room fetches its entire history on every mount because room_messages takes no limit                                             | False. `room_messages(p_chat_id uuid, p_limit int default 60)` ends `limit greatest(1, least(p_limit, 200))` (20260828180000:22, :83). src/features/rooms/api.ts:66 simply never passes the parameter, so a room is capped at 60 — the |
| Reply needs a nullable parent id on messages AND on room_messages                                                                 | There is one table. public.messages (20260816220000:15-21) serves direct chats and rooms alike; room_messages is an RPC over it. One column, one index, one trigger — and then the RPC's OUT columns change, which is where the drop-f |
| Drop the invite-code line from the share message because the token appears twice                                                  | The token is the same secret in the same message — the URL already carries it — so printing it once more adds no new exposure, and it is the only recovery path while samewhere:// stays untappable in most text-message apps. Removin |
| Print the invite code under the QR in large type so it can be read across a table                                                 | group_invite_token mints two UUIDs' worth of hex — 64 characters (20260821010000:353-356). No type size makes that readable across a table, and shortening the token is a security change nobody asked for. The caption fix ships; the |
| Build an accept-or-decline step for being added to a group                                                                        | The heavier of the two options and unnecessary once the per-user setting exists. It also duplicates the join-group/[token] flow with a second, subtly different one, which is exactly how the two copies of the anchor vocabulary drif |
| In-thread message search                                                                                                          | Real, but it needs a server-side ilike RPC scoped to one chat plus a result-jump, and the jump should reuse the scroll-to-index work from the unread divider rather than inventing a second one. Scoped out of the search package deli |
| Design and claim the whole URL space (/i, /b, /c, /u) in the app entitlement now                                                  | Not work until the domain exists — it is the second half of a founder decision, surfaced there. Designing an AASA path list against a domain nobody owns is speculative, and the entitlement change is app config plus an EAS build, w |
| Apple Maps is the only way out of a pin, over http                                                                                | src/features/pins/open-in-maps.ts is the map subsystem's file and nothing in the chat surfaces calls it. Worth saying out loud so it does not fall between two plans: the http-to-https change is one character and unambiguously righ |
| Swipe-right-on-a-bubble to reply, and tap-the-quoted-strip to scroll to the parent                                                | Deferred out of the reply package on purpose, not dropped forever. The gesture is polish once the menu item exists, and the scroll needs the same onScrollToIndexFailed handling as the unread divider — doing it twice is how two scr |

### Notifications

| Finding                                                                                                                            | Why not                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-arm the primer by clearing the 'samewhere.push.primer.v1' AsyncStorage key when the first inbound hello arrives (the second hal | Dropped as a mechanism and replaced by per-reason keys in notif-second-ask. Clearing the key does not clear an OS-level denial. worthAsking (primer-store.ts:89-94) tests pushPermissionGranted(), which returns false for 'denied' an |
| Add PrimerReason 'profile-live' and fire the primer from the success path that stamps onboarding_completed_at at src/app/onboardin | Dropped. The store is single-shot today, so this would spend the one offer at the moment of least earned trust, on a promise rather than a payoff, and permanently suppress the hello-sent and pin-posted asks that are timed to somet |
| FIRST MORNING: a 09:00 local push on start_date, "Here is what is on in Bangkok today".                                            | Dropped. It repeats the trip-starts-tomorrow push fifteen hours later. Two notifications about the same trip inside one day is how a channel gets switched off, and the evening-before one is strictly better because it arrives while |
| NEW TRAVELERS: a batched digest when the overlap count crosses a step, "Three new travelers landed in Bangkok on your dates".      | Dropped for v1. A count of people who might be interested in you is the closest this product can get to the "see who liked you" grammar hard rule 1 exists to forbid, even without faces or names. It also needs its own k floor to av |
| WHERE NEXT: a push two days after end_date, "Put your dates in and we will tell you who else will be there".                       | Dropped. This is between-trip retention, which PRODUCT_BRIEF.md:119 explicitly defers out of v1 ("a known later problem... Do NOT build a home-city mode in v1"), and line 230 names the metric as D1/D7 within a trip window precisel |
| Give existing plan members a push for the first two joins, the way Partiful tells a host on every RSVP.                            | Dropped. Members already get pushed for every real message in the room, and a push about somebody else arriving is a notification nobody asked for. The join line in the thread plus the unread dot on the chat row tells them, which  |
| Change the signed-in Travelers subtitle from "In Bangkok right now" to "In Bangkok on your dates".                                 | Dropped: there is no such string. travelers.tsx:126-134 sits inside GuestTravelers (opens at :69), so it renders only on the signed-out teaser; the signed-in view already shows a shared date window, which screenshot 17-travelers-s |
| Report the share of returns within N hours of a queued push from the database side, using last_seen_on.                            | Dropped for now. There is no last_seen_on column anywhere in this schema (grep returns nothing across src/, supabase/ and docs/), so this is a new column plus a write path on every launch plus a query, to answer a question the two |
| Add a `badge` column to push_queue, populated from the recipient's waitingTotal at enqueue time.                                   | Dropped in favour of computing the count once per drain batch in push-worker. A stored column freezes the number at enqueue time, so a row drained a minute later carries a stale badge, and it would have to be populated at every on |

### First hello

| Finding                                                                                                                       | Why not                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace "Say you're in" at src/features/profile/profile-view.tsx:116 with "Say hi about this"                                 | Not drift. It is the VoiceOver label on the Top priorities chip only (every section's visible chip reads "Reply"), and the comment at :114-115 records the reason: joining an existing plan is a different act from opening a first me |
| Change the visible "Reply" chip on profile sections to "Say hi"                                                               | The chip answers one specific thing on the profile, the composer's target card already says "Replying to their bio", and the composer's title already says "Say hi to Theo". The verb and the anchor are two different words on purpos |
| Add "Most answers come within a day or two" to the sent confirmation                                                          | The app has no reply-latency data. That sentence is an invented promise, and the first week it is wrong is the week somebody screenshots it.                                                                                           |
| The 1100ms sent confirmation "says nothing the sender needs to know"                                                          | Overstated. compose-request.tsx:171 tells a first-time sender exactly where an answer will surface, which is the one fact they do not have, and the founder note at :115-121 records why the timer exists. The durable half of that fi |
| Echo the matched phrase back in the block notice ("try 'meet up' instead")                                                    | moderation_blocklist is a table of regexes and naming the trigger token hands a sender the evasion rule. The category is enough to change the sentence, and it is what the planned copy branches on.                                   |
| Split the blocklist by confidence so hook-up and sexy warn but never block                                                    | Not ordinary work, and not safe as written: require_llm_moderation is still 'false' (20260817090000_trust_safety.sql:43), so the regex list is the ONLY screen a first message gets, and demoting those two patterns would deliver the |
| Send a real hello in the E2E tour and delete the row in teardown                                                              | 20260816200000_trips_matching.sql:394 makes a first message one-shot per pair forever, so a sent hello turns the tour non-idempotent on the seeded account and makes a teardown delete a required step rather than a nicety. Four read |
| Fix the em dashes in 20260818010000_seed_launch_content.sql:24-57                                                             | Superseded. 20260823020000_curated_pins_stay_current.sql redefines seed_launch_pins with the same sixteen notes and is the version that runs daily, so editing the older file changes nothing live. It goes in the lint allowlist; the |
| Fix "This app is for platonic travel friends — further violations will suspend your account" at trust_safety.sql:219 and :930 | Already fixed. 20260821120000_moderation_copy.sql redefined both apply_strike_policy and admin_resolve_report and removed the sentence. Same for trust_safety.sql:489, superseded by copy_pass.sql. The lines are dead code in histori |
| Translate the message-moderation verdict's reason field                                                                       | apply_message_verdict never shows the model's reason to anybody; the sender sees a fixed string chosen by the client. There is no English sentence on that path to translate.                                                          |
| Write moderation_events for blocks in message_business and open_direct_chat so they appear in admin_moderation_stats          | Tempting and wrong. Both currently write no event, so a block on those paths is not a strike; adding an event would feed apply_strike_policy and undo the point of hi-a-reword-is-not-a-strike. The gap is real and belongs in DASHBOA |

### Platform

| Finding                                                                                                                    | Why not                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| featured_traveler ignores the audience setting and is granted to anon, contradicting the screen that promises who sees you | Refuted by the current code. The finding cites 20260822140000_featured_and_caps.sql:16, but that definition has been superseded twice. The live one is supabase/migrations/20260830000000_a_business_is_served_no_travelers.sql:234, a |
| Apple's Declared Age Range API for age assurance                                                                           | An iOS 26.2 native API with no Expo module. Adopting it means a local native module under modules/, an entitlement, an EAS build, server-side handling of the coarse band, and handling for a parent-consent-withdrawal server notific |
| Queue mutations while offline and fire them on reconnect                                                                   | Implied by the offline finding and deliberately not planned. A hello that sends itself three hours later, to somebody who has since left the city, is worse than one that failed honestly and let the person decide. Pausing queries o |
| Delete src/components/external-link.tsx as dead code                                                                       | The opposite is right. The component is correct, it is the only place the presentation style is decided, and deleting it means the next person re-derives openBrowserAsync at a call site. Wire it up instead.                         |
| Add a Contact us button to the daily-block-limit alert                                                                     | A second, navigating button fired from the global MutationCache handler is the modal-during-dismiss shape the traps skill records as having killed touch for the whole app on Fabric. The mapped sentence names the route in words ('w |
| Normalise the whole app's quotes to curly, or run a full RTL retrofit                                                      | Both are the expensive halves of cheap findings. The app is already straight-quoted everywhere but two strings, so 'normalise to curly' would be a hundred-file change to reach the same consistency the other direction reaches in tw |
| Gate App Store screenshot one on the heatmap rendering                                                                     | Not my subsystem to fix and not a reason to hold the asset spec. Specify the shot list now at 6.9" with the map-and-pin-card as shot one, which is the differentiator and renders today, and add heat when whoever owns it lands it.   |
| Business listing analytics: marker taps, listing opens, chat opens, per-post seen-by-N                                     | Not dropped, but not planned as ordinary work either. docs/BUSINESS_ACCOUNTS.md §10 parked it deliberately, and building it means a new events table, per-owner RLS, a nightly rollup and a k-threshold. Surfaced as a founder decisio |

### Business

| Finding                                                                                       | Why not                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thirty-eight of thirty-nine remote images snap in with no transition                          | Miscounted and almost entirely outside this subsystem. `grep -rn 'transition=' src/` returns three hits, not two — place/[id].tsx:75, place-sheet.tsx:164 and my-business.tsx:436 — and several of the 36 bare sites are local assets  |
| The plan-link and "Bring a friend" legs of "Nothing in the app can be shared"                 | Both are outside this subsystem — a plan link is the pins surface and a friend invite is the profile surface — and the friend invite has nothing to point at until the app is on the App Store. The plan link also carries a privacy c |
| Undo on the photo delete (the second half of the two-save-models finding)                     | There is no toast or snackbar primitive anywhere in src/components/ui, and adding one is a larger change than the bug it would soften. The honest fix is the confirm copy saying the delete is immediate, which is in biz-edit-one-sav |
| Wiring react-query's onlineManager for a reconnect refetch                                    | src/lib/query-client.ts wires focusManager to AppState and nothing configures onlineManager, which is true — but there is no netinfo dependency, so this needs a new native module and therefore an EAS build to fix a stale-screen pr |
| A `city_requests` / `city_interest` table for businesses outside the four launch cities       | /contact already exists and is already used from profile-me.tsx:154, so the demand signal can be captured today with zero schema. A table only earns its place once somebody is actually reading the answers, and nobody is. (If it is |
| Adding a pending-photo count to business_detail (the photo finding's original recommendation) | business_detail is `security definer` and granted to anon (20260829160000:332). A pending or rejected count returned from it tells any traveler that a non-approved photo exists on a listing, which is exactly the kind of leak the R |
| Adding "Report this place" to the BANNED map in e2e-flows.test.ts                             | src/app/**tests**/e2e-flows.test.ts:105 is a Maestro COMMAND blocklist keyed by command name and matched against `- command` lines in the flow YAML; its only entry is hideKeyboard. A copy string would never match it and the guard  |
| "A real person reads every report, usually within a day"                                      | That is an SLA the report queue has no owner for — docs/legal/COMMUNITY_GUIDELINES.md:45-46 notes even the support address does not exist yet. A missed promise in a safety flow costs more than the vagueness it fixes, so biz-copy-p |
| Renumbering business signup steps 3 through 11                                                | business-signup.tsx:304-756 already matches docs/ONBOARDING.md:105-117 exactly. The mismatch is one screen the doc has never listed — 'One last thing' — so the fix is to fold that screen into step 11, not to shift nine steps and b |
| Preserving verified_at through a genuine rename                                               | The re-confirmation email goes to the same inbox the surf shack registered, so preserving the badge across shack-to-Marriott is precisely the attack 20260827120000:480-483 records the trigger existing to stop. biz-rename-is-not-a- |
| Splitting photos and links out of business-edit into their own routes                         | business-edit already takes a `section` param and my-business's DetailRows already deep-link into it, so splitting the routes is a bigger change than the bug it solves. The section-gated render in biz-inline-content-steps gets the |
| A refusal shake plus haptics.error on the blocked Continue                                    | PrimaryButton passes `disabled` down to PressableScale (primary-button.tsx:60), so a disabled button never fires onPress and the shake could never play. Getting both would need a new `blocked` variant that paints the unavailable c |

### Account, settings,

| Finding                                                                                                                            | Why not                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish the guidelines and privacy policy as hosted web pages at /guidelines and /privacy on a domain, so a hostel manager, a jour | Nothing about this lives in the app repo, and it is already tracked: docs/APP_STORE.md:21 records the two drafts in docs/legal/ as "founder review, then host for the App Store URL field", and the store listing needs a hosted priva  |
| Auto soft-hide a reported profile on a single underage report, the way the shadowban path already suppresses without notifying     | One unverified report becoming a one-tap way to darken any stranger is precisely the abuse vector src/app/\_layout.tsx:280-286 records report_business being guarded against, and report_business now refuses a business caller outrigh |
| Give the reporter a case reference so they can quote it later                                                                      | There is one person reading the queue and no support portal to quote a number into. A case id that appears in a confirmation and is never asked for again is noise, and it invites a follow-up message the queue then has to handle. T  |
| Implement matches_viewed on the travelers queue render, since it is more precise than travelers_viewed for the thesis ratio        | "Match" is on this project's banned vocabulary list, and adding a permanent event name carrying it puts the dating frame into the analytics schema, the dashboard and every chart built on it. travelers_viewed already fires at src/a  |
| Implement or keep the unmatched event                                                                                              | There is no unmatch surface. unmatch_chat is called only from src/features/chat/api.ts:137 and nothing in src/ calls that wrapper; src/app/chat/[id].tsx:116 records the deliberate decision to offer Archive instead, and the live ev  |
| Say in the delete confirmation what deletion does to the other side                                                                | It already does. src/app/profile-me.tsx:392 reads "Deletes your profile, photos, trips, pins and chats, for both sides. Can't be undone." The verifier did not check this half. The part of that finding worth acting on is the missin  |
| Rename docs/legal/COMMUNITY_GUIDELINES.md to match the in-app name                                                                 | It is an internal legal document, not user-facing copy, and its filename is referenced from docs/APP_STORE.md and src/constants/policies.ts. Renaming buys consistency nobody sees and breaks two doc links. Only the user-facing name  |

### Onboarding

| Finding                                                                                                  | Why not                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named guest mode is unreachable from a cold first run, so the open business chats stay dark for visitors | The consequence is false and I checked it. useIsGuest (src/features/guest/hooks.ts:27-29) is true for a signed-out visitor, and src/app/(tabs)/chat.tsx:806 enters that branch and renders RoomDiscovery on the Groups segment at :862 |
| Split gender onto its own step between 3 and 4 (from the step 3 finding)                                 | docs/ONBOARDING.md section 3 puts name, age and gender together on step 3 as the founder-derived spec, and steps.ts:24 fixes the count at thirteen. Fixing it in place costs less and breaks nothing: dropping autoFocus and moving Ge |
| Put the Apple button first on /join and rewrite the subtitle (from the email-screen finding)             | Half of it already ships verbatim ("Your email is never shown to other users.") and the other half is rejected by a recorded decision in the file: join.tsx:169-172 says the account-kind rows come before Apple because whoever is ty |
| Cut the business step 1 subtitle from 22 words to 13                                                     | join.tsx:131-136 marks both subtitles as the founder's words and docs/ONBOARDING.md:105 records step 1 as founder's copy. The noun collision between profile and listing is a real defect and is fixed; a wholesale compression of fou |
| Scale the welcome mark to 0.75 and raise welcomeTop (from the welcome-screen finding)                    | welcomeTop (intro-tour.tsx:293) is the splash handoff target, and the mark's resting position is what the cross-fade depends on. Moving it either breaks the handoff or, if the mark only moves during scroll, leaves the raised wordm |
| Give step 12 the Skip its neighbours have (the fallback in the audience finding)                         | A skip would hide the setting from exactly the person the founder added the step for. The copy fix costs the same afternoon, keeps the discovery, and stops asking for a decision the server will refuse. Doing both would be doing th |
| Persist the pending intent to AsyncStorage with a 24-hour TTL                                            | src/features/auth/store.ts:50-52 records the decision not to persist this class of state, in the founder's own reasoning: worth carrying across a sign-up in one sitting, not worth resurrecting later. The in-memory carrier gets the |
| Let a named account with no photo post a pin drawing the plain glyph marker                              | docs/ONBOARDING.md section 2 rule 3 records the mandatory photo as the founder's call, in as many words. This is raised as a decision instead.                                                                                         |
| Move steps 6, 7, 8, 9 and 11 out of the funnel into a card                                               | The founder's brief quoted at the top of docs/ONBOARDING.md asks for exactly this shape: prompted for each part of the profile during onboarding, with a small skip for non-essential items. All six of those steps already pass onSki |
