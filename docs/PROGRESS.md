# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## **A business goes where its door is** (2026-09-05)

The founder, the day after the pin fence went: _"businesses shouldn't be
limited on where they can put their pin. It should instead just be a simple
search bar where they can put in the business on the 'where is it?' page. The
search bar should just be where they put in their business address, and then
they can click the recommended option as it comes up as they search, or there
can be an option in smaller text below that allows them to just set their pin
if their address isn't popping up ... I'd rather have that for full
flexibility and scalability than forcing business users to pick from preset
cities set by me."_ So the "Which city?" chips, the launch-state sentence and
the "Somewhere else? Tell us where." door are gone from step 5, and the server
files a listing under the city its marker is in.

### What changed, and where the fence went

- **`resolve_business_city(p_lat, p_lng, p_hint)`** (20260905130000), three
  tiers and never a refusal: the hint stands when the marker is within 20 km
  of it (`validate_pin`'s rule, verbatim, which is what keeps a nudge from
  ever changing `city_id`); else `nearest_city()` (distance over the fourth
  root of population, null beyond about 55 km); else the nearest city on
  earth by plain haversine, a full scan that runs only at sea or in the
  outback, because `businesses.city_id` is NOT NULL and a business signing up
  has no browsed city to fall back on. A forged hint that is no `cities` row
  falls through to the marker. Authenticated only, like `nearest_city`.
- **`city_for_spot(p_lat, p_lng, p_hint)`**, jsonb: `city_json` of the same
  resolver with the same hint (null on a first registration, the stored city
  on a re-entry), so "That lists you under Lisbon, Portugal.", the confirm card
  and the stored row cannot disagree. Definer, because `city_json` is
  authenticated-only; a guest cannot call either door.
- **The two write doors, signatures unchanged.** `register_business` replaces
  its `launch_cities` lookup with the resolver; `update_business_location`
  passes `coalesce(p_city_id, stored city)` as the hint, so a nudge keeps the
  city and a move past 20 km re-files the listing. Both `create or replace`
  with grants restated, on purpose: no OUT list, argument or return type
  moved, so there is no drop-first to do. The register door gains the
  explicit `grant execute ... to authenticated` it had only by default
  privileges until now.
- **The label or the circle.** `city_businesses`, `city_whats_on` and
  `city_rooms` read `b.city_id = p_city_id or haversine_km(...) <= map_radius_km()`,
  bodies only. A Cascais door draws on the Lisbon map like a Cascais pin, and
  a lodge filed 300 km from its city is still on that city's list, which the
  circle alone would have dropped.
- **Two raise literals are gone**, not reworded: "we have not launched in that
  city yet" and "that marker is not in %. Drag it onto your door, or pick the
  right city." `failure-message`'s `MARKER_OUTSIDE` goes with them. Column
  comments say `launch_cities.radius_km` has no caller (kept because build
  17's bundle still selects it) and that `businesses.city_id` is resolved on
  every write, any city. Migration first, then the update: the new bundle
  sends `p_city_id: null`, which the old function would have refused. Build
  17 against the new functions, until the update lands: its chip city stands
  while the marker is within 20 km of it; from 20 to 40 km (the old
  `radius_km`) the listing is filed under the marker's own city instead of
  being refused, and that build's confirm card, listing preview and City
  select keep naming the chip until the update. No rows need fixing.

### The client

- **One box, one list, one small line.** Step 5 is `BusinessAddressField`
  searching the world: MapKit with a continent-sized region hint, in its own
  order, then `geocodeAsync` on the bare text; three characters before
  anything fires, and only while the box has focus, so walking back from "Is
  this right?" never pops a list under a settled address. Under it, "Not
  coming up? Place the marker yourself." shows the picker with no marker, centred
  on the near-miss the list had if it had one, else the featured city whose
  clock is the phone's Intl zone at country scale, else the world, and the
  person pinches in. The map appears once a marker exists or the line is
  tapped; a pick sets both halves, a drag moves only the marker, and the city
  line under it ("That lists you under Lisbon, Portugal.") comes from
  `city_for_spot` and follows a drag across a border honestly.
- Step 6's card carries "Cafe · Lisbon, Portugal" from the same answer, its
  map is draggable, and the way back is "Fix the address or the marker".
  `business_registered` carries the resolved `city_id`.
- **`useCity(id)`** reads a `cities` row by id, and that is how the map flies
  to the owner's own city, the place sheet reads its clock, and step 12's
  preview names it: none of them look the business up in the launch list any
  more. business-edit loses its City select and the plain Address fallback;
  the search box and the draggable marker are the whole of "Where you are",
  and the editor prints no city line of its own.
- **A rough tap is not a marker yet.** A tap on the by-hand map at country
  scale drops the marker as a guess and holds Continue, the city line and the
  "move it as much as you like" note until a tap or a drag made with the map
  showing about two kilometres or less (`PRECISE_DELTA`); the picker's own
  caption asks for the zoom, the footer says nothing while the map is on
  screen, and a tap never moves the map (the four-reviewer pass found the
  first cut flying to street scale around wherever the finger landed).
- **"Marker", never "pin", in business copy.** The founder's words said
  "pin"; on screen it is "Place the marker yourself", because a pin is the
  traveler's 72-hour object (`vocabulary.ts`); the founder read the wording
  and kept it (2026-09-05). The line is in the accent
  colour: in the same grey as the search's message it read as a second hint.
  "That lists you under Lisbon, Portugal." rather than "puts you in", because
  the city is the label the listing is filed under, and a door outside every
  seeded town of 5,000 is filed under the nearest one.

### What did not move

Rule 2: the only centres the client computes are a marker the person placed,
the first geocoded suggestion for text the person typed (the by-hand map's
near miss), a featured city picked by Intl timezone, the world view (20, 0) as
a constant, or the origin as MapKit's ranking hint; none is a device read, no
expo-location position API appears anywhere, and app.json's location
permissions stay false. (The migration's header under-lists them; applied
migrations are not edited, so this paragraph is the record.) Rule 5: the address
is still screened by `screen_business_text` on every write. Rule 8: the
traveler refusal in `register_business` and the six triggers are untouched.
`lat`, `lng` and `city_id` are still server-owned columns.
`business_rename_resets` is untouched and now unreachable by a nudge across a
city line: the stored-city hint keeps `city_id` for every move inside 20 km,
and a re-file is always over 75 m, which the trigger already resets. The
seeders keep their `launch_cities` join; `validate_pin` is untouched, because
pins were the day before's change. No return type moved: `register_business`
still answers a uuid, and the city reaches the client through `city_for_spot`
before the write and `my_business` after it.

### Proof

`77_a_business_goes_where_its_door_is.test.sql` (`plan(33)`), written as
attacks: Midtown with no hint files under New York City and not Hoboken;
Monaco under a Nice hint stands at 13 km; the Croisette under the same hint
re-files to Cannes; a marker in the mid-Atlantic lands on the nearest city by
plain distance; a forged hint that is no city is ignored; a 30 m nudge keeps
the city and the badge, a move to Cannes re-files and costs it; Cascais draws
on the Lisbon map, room list and What's on and not on Porto's; a far-filed
listing is still on its own city's list; a guest can call neither door; the
preview names Porto and honours the hint like the write; rule 8 restated.
`21_business_accounts.test.sql` goes from `plan(41)` to `plan(45)`, four
assertions flipped or added: "a marker in Porto under a Lisbon hint is saved,
not refused" and filed under Porto; "a marker in Bairro Alto keeps the Lisbon
hint: the hint stands within 20 km"; "moving the marker to Porto is allowed
now" and the listing follows; back to Lisbon, "the stored Porto hint is 270 km
away, so the marker decides". Every positional
`register_business(..., pg_temp.lisbon(), 38.71, -9.14)` caller in the suite
stays green through the first tier. Jest: `use-place-search.test.ts` (the
continent hint, the marker bias, city mode byte-for-byte, the three-character
floor, the bare text to the geocoder, honest emptiness, a stale answer never
landing) and `address-field.test.tsx` (the placeholder, no search until focus,
the small line and what pressing it does); business-edges, business-map and
business-exits rewritten for the new step 5, the by-id map and the shared
footer; browsing-city gains `cityInZone`; failure-message asserts
`MARKER_OUTSIDE` is gone.

### Shipped

Migration 20260905130000 went through `supabase-deploy.yml` on 2026-09-05,
before any bundle sent `p_city_id: null`. The trip picker, the horizon and the
way-home fix went over the air first (TestFlight run 87, iOS update
01a06eb2-9ce9-72f4-908f-04a66bfbd1c0, commit 0b913ae); the business change,
the rough-tap rule, the map framing and the wall fix followed (TestFlight run
88, iOS update 01a071e4-f40e-7f7a-a4d2-9e7d055ea125, update group
a1285906-aff4-4928-9536-9c2406944c3f, commit aac7b6b), runtime 0.2.0 on build
17. E2E run 121 photographed the flow on the simulator: 42 (the empty address
box), 42b (the by-hand map at world scale under "Zoom in, then tap your
door."), 43 (the suggestions under typed text), 44 (a picked address and its
marker), 45 ("That lists you under Lisbon, Portugal." with Continue lit), 46
(the confirm card naming the city) and 71 (the owner's map on the listing).

## **Which trips the queue is for, and no limit on how far ahead** (2026-09-05)

The founder, on the Travelers tab: "remove the descriptions around each distance,
the km conversion is enough", and "you should be able to select at the top near
where it says 'today in Mexico City' ... which of your trips you want to show in
the travelers section ... one, multiple, or all ... people could even put trips on
their profile for the full year at the beginning of the year ... there'd be no
limit."

### What the code did before

The queue already spanned every active trip: `get_matches` joined all of them,
kept one row per other traveler and attributed it to whichever trip reached them
soonest. Nothing let a person narrow it, the "8 more on your dates in Mexico
City" line borrowed the city of whoever was on screen, and an overlap starting
more than 180 days out was invisible in three places at once: the trips policy's
predicate (`overlaps_own_trip`), `get_matches` and the hello.

### What shipped

- **The horizon is gone** (20260905090000). All three functions are restated
  without `current_date + 180`; a trip added a year ahead is matched from the day
  it is added. pgTAP 10's "not shown yet" became "shown: there is no horizon any
  more", and the hello to somebody 200 days out goes through inside a savepoint.
- **`get_matches(p_trip_ids uuid[] default null)`.** The only argument the queue
  takes, and it is the caller's own trip ids: joined to `trips where user_id =
auth.uid()`, so a foreign id names nothing (pgTAP 76 asserts the argument list
  and all four shapes). Null is every trip, so `daily_spotlight`'s zero-argument
  call and build 17's bundle are unchanged.
- **The trip rail** at the top of Travelers, where "Today in <city>" was: the
  app's own `ChipRail` in multi mode, "All trips" first, then one chip per
  upcoming trip in date order, city names only (the month when a city repeats,
  the day when the month does too), dates spoken to VoiceOver. "All trips" is a
  zero state: one tap on a city narrows to that trip; untapping the last lit chip
  is every trip again. Shown only with two or more trips. Kept per account on the
  device (`features/matching/trip-selection`), read before the first fetch so the
  tab never flashes the wrong queue, and read as every trip when it names a trip
  that ended. `useMatches` keeps the last queue on screen while the next loads,
  so a tap never drops the screen into its skeleton.
- **The sentences follow, from one phrase.** `queueScope` says what the queue
  is for ("in Lisbon", "in Lisbon and Porto", "across these 3 trips", "across all
  your trips") and the count line, the empty wall's title and the VoiceOver
  settle all read it, so they cannot disagree; the wall's title lost "with
  travel plans matching yours" on the way, the one banned root on the screen.
  While a tap's new queue loads the count line says "Checking Lisbon…" over the
  face that stays. An empty wall the selection emptied says "You're only looking
  at Lisbon, Mar 4 – 9." (or "sometime in September" for rough dates, or "2 of
  your 7 trips") with "Show all trips" as the way back. The spotlight's sparkles
  stay beside "Shown to you and Freja today."; its chip is gone.
- **The radius rows** carry the conversion and nothing else ("32 km"); "This
  city only" has no second line.

### What did not move

Who can see whom. The selection changes only what the person's own queue is
built from: their profile is shown to everyone the audience setting allows, on
every trip. The audience wall outranks the trip wall, because the audience hides
people on every trip and its sentence stays true. No device location anywhere:
the ids are the person's own trips, and every distance is still city centre to
city centre (rule 2).

### The review's grafts

Four reviewers over the diff before the push. The empty wall now carries the
rail too, with "Show all trips" whether or not the audience setting is what
emptied it (a person narrowed to a trip nobody overlaps who had also set
"verified only" had no way back), and while a chip tap's queue loads its title
says "Checking Lisbon…" rather than "That's everyone" about a queue not yet
fetched. The E2E account has a second trip now, Lisbon 400 days out, so the
signed-in tour photographs the rail, the wall it produces (17i), the way back,
and the queue narrowed to Bangkok (17j) for the rest of the tour. The workflow
also seeds the launch venues' posts back before every run, through the
Management API, because the guest tour's "something on tonight" row is a
72-hour pin and went red in runs 110 to 115 while the app was fine. The header
is rendered once above the page
keyed on the person, so a Next no longer tears the rail down and resets its
scroll. The first fetch waits for the trips as well as the stored choice, and
the focus refetch waits on the same flag, because `refetch()` ignores
`enabled`. A tap toggles from the selection the chips show, not the raw stored
one, so a stored set that covers every remaining trip narrows on a tap rather
than dropping a chip. The chip hints say what the tap does in its state
("Looks at just this trip." from All trips). pgTAP 76 first proves the foreign
id is real before proving it names nothing. The brief says the rule that
holds: a start date up to two years ahead (a typo guard, not a plan limit),
and no matching horizon. `expire_message_requests` keeps its 180-day term: its
own 30-day cap makes the term unable to change a result, and the migration
header says so.

### The map's way home is where the app framed the city

Frame 09 of run 115 photographed Denpasar right after a relaunch with "Back
to Denpasar" over it. The map frames every plan a city has, and Denpasar's run
from Ubud to Uluwatu, so the fit itself sits 6 km from the city's centroid;
the pill measured from the centroid with a 4 km threshold, so the app's own
framing counted as having drifted, on every cold start and chip tap. Home is
now `homeRegion`: the fit once the plans are in, the city's box until then.
The pill measures from it and lands on it, and a tap on the chip that is
already lit lands there too instead of on the centroid (which for Denpasar
summoned the pill again). camera.test.ts holds the Denpasar case.

Run 119 then photographed what the pill had been hiding: the relaunch frame
was a box on the rice fields between Seminyak's nine plans and a business chip
in Ubud, saying "No plans over here", because `fitRegion` clamps a spread wider
than the widest frame to the middle of that spread. It frames the most of its
data now: each point anchors a window of the clamped size, the fullest wins,
ties go to the middle. The same run showed the onboarding tour passing by
skipping steps 6 to 14 (its "gate line gone" blocks were judged ten seconds
after the pick, while the upload was still working); it waits the upload out
first now, and pgTAP 56's 40-hour expiry became 48, because tomorrow at 19:00
in Lisbon is past 40 hours from any clock between midnight and 02:00 UTC.

### Run 116: the rail reached the pin form, and stopped there

The first run on the update (0b913ae). Onboarding, business, invite and the
large-text tour green; the guest tour red on the "something on tonight" row,
as expected until the seed step lands; the signed-in tour red three steps
after 14-pin-form, with a failure frame identical to it. The pin form's two
text fields sit under the join choice, the day, the time and the expiry, and
with a venue on the Where card (the chip tap earlier in the tour leaves it
there) "What's the plan?" is fully below the scroller's fold. Maestro found
the id anyway, tapped its coordinates, focused nothing, and typed two
sentences into the void. The tour scrolls to the field first now, as it
already did for Details.

**Founder question, answered.** The same fold is there for a person: the form
opens on Where, the join choice, When and Time, and the button underneath says
"Say what the plan is first." about a field they cannot see until they scroll.
The join choice was put above the fields on purpose (run 76: with a keyboard
up the scroller is two rows tall and the choice was clipped in half), and the
day, the time and the expiry could have moved below the two fields. Founder,
2026-09-05: leave it as it is. Not changed.

### A design panel first

Three independent designs (least UI, trips as the hero, the words first), two
judges, one synthesis, before a line of UI. The rail above is the synthesis;
what it deliberately left out is recorded in the component: no sheet, no "All"
that lights with every chip, no dates on the visible chips, no counts on chips,
no "now" or "here" mark on a trip in progress, no automatic widening when a new
trip is added while narrowed.

## **A pin goes where the traveler goes** (2026-09-04)

The founder tried to drop a pin in Manhattan and got "Could not save". The
map had let them pan there, the geocoder had named the corner, and then
`validate_pin` measured the spot against the centre of the city whose chip
was lit - Bangkok, 13,924 km away - and refused it. The rule was the brief's
"launch dense, not wide" (§2.6), doing its job. The founder's decision retires
it: _"There is no reason to ever block someone from putting down a pin ...
never limit travelers on where they can put their trips or pins."_ And with
it: the rail becomes featured cities, nobody asks for a city to be opened,
the time on a pin is optional and can be a window or TBD, the Details box is
not cut off, and Travelers reaches a radius the person sets.

### What changed, and where the fence went

- **Every city knows its clock.** `cities.timezone` (20260904110000), seeded
  for all 49,025 cities down to a population of 5,000 by `geo-tz` against
  each coordinate (20260904110100; `scripts/generate-cities-seed.mjs` takes
  `--min` and `--out`, and a rerun into a NEW file refreshes clocks without
  rewriting a name a trip already points at). The threshold came down from
  50,000 because the founder's own example - Nice, Cannes, Antibes, Monaco -
  had Monaco missing, and the towns backpackers actually go to (Tulum, El
  Nido, Byron Bay, Ericeira) are small. `city_clock_zone()` is the one
  reader: a launch city's hand-set zone first, the seeded one otherwise.
- **The pin's city is resolved, not trusted** (20260904120000). `pins.city_id`
  points at `cities` now, and `validate_pin` keeps the browsed city when the
  spot is within 20 km of it and otherwise asks `nearest_city()`: distance
  over the fourth root of population, which is the smallest weighting that
  says New York for Midtown (nearest by distance alone is Hoboken), Monaco
  for Monaco and Jersey City for Jersey City. Nothing near anything (the
  Atlantic) keeps the browsed city. Never a refusal.
- **The map is a circle.** `city_pins`, `public_city_pins`, `heat_cells` and
  `public_heat_cells` read every live pin within `map_radius_km()` (50) of
  the browsed city's coordinate. A plan on the Croisette is on the Nice map
  and the Cannes map both; `city_id` is a label for the funnel and the rail.
  The two-door pattern (INVOKER for members, DEFINER with restated
  visibility for guests) is unchanged, and k is `coalesce(launch_cities.heat_k, 3)`
  everywhere - the founder can still raise a city's floor, nothing can lower
  it. `heat_history` follows `cities` too, so the sweep remembers a city
  nobody opened.
- **Featured, not open.** `featured_cities()` and its guest twin replace the
  `city_pin_counts` pair: every active launch city plus any city whose
  visible plans clear its k, most plans first, eight at most. A city below
  its k is not named - a chip reading "Podunk" with no number would still
  say somebody has a plan in Podunk, which is the enumeration the floor
  refuses. `request_city()` is dropped; `city_requests` stays as the record.
- **A time is optional, a window, or TBD.** `intent_time_end` and `time_tbd`
  on `pins`, through both feeds and `post_joinable_pin` (two defaulted
  parameters, so the old signature is dropped and regranted). A window may
  cross midnight ("10 PM to 2 AM"; an end at or before the start reads as
  tomorrow) and its end is checked against the expiry exactly like the
  single hour was (rule 3). The write path now answers with the CITY the pin
  resolved to, so the map can follow it there.
- **Travelers within a radius.** `profiles.travelers_radius_km` (default 32,
  about twenty miles; 0 is this city only; CHECK 0..500) and
  `cities_within_km()`, a plain SQL function the planner inlines, with a
  latitude-band prefilter on the new `cities_lat_lng_idx`. The VIEWER's
  radius from the VIEWER's trip city, read by every surface that has to
  agree: `overlaps_own_trip` (the `trips_select_overlap` policy - a radius on
  `get_matches` alone returned nothing new, because RLS hid the rows first),
  `get_matches` (dropped and recreated with `distance_km`, `my_city_id`,
  `my_city_name`), `send_message_request`'s trip branch, `incoming_requests`
  (dropped and recreated with `overlap_my_city`) and `meet_prompt_due`. A
  hello to somebody the queue just showed is never "recipient unavailable".
- **The three clocks read every city's zone.** `push_trip_starts_tomorrow`,
  `push_plan_is_soon` and `push_last_call` inner-joined `launch_cities`, so
  a trip to Porto got no push at all. Left joins and `city_clock_zone()`;
  the trip clock's rough-window exclusions are kept verbatim.

### The client

- The rail draws `useFeaturedCities()` with the browsed city in front when
  it is not featured; the fifth chip is **Anywhere**, a search over
  `search_cities` that browses any pick through the same `selectCity` door a
  chip tap uses. The city store (`samewhere.map.city.v2`) keeps the whole
  city - name, coordinate, clock - so a cold start can fly to a city the
  rail has never listed; the live count is not persisted. `pickBrowsingCity`
  resolves to any trip's city, built from the trip's own row.
- The pin form's Time rail starts dark, leads with TBD, and grows an "Until"
  rail under a chosen hour (`intentEndOptions`: eight hours, past midnight
  included, never past the expiry). Tapping the lit chip puts it out. The
  scroller carries bottom padding so Details clears the fade. `whenLabel`
  says "Today, 19:00 to 22:00" and "Today, time TBD"; a pin with no hour
  says the day alone, as before.
- Travelers: a dial chip in the queue header ("Within 20 mi" / "Within 32
  km", by the phone's region - `USES_MILES` in `lib/locale`), a five-row
  sheet saved on the tap, "Look further than within 20 mi" on the empty
  wall, and the shared-dates sentence names both cities when they differ:
  "In Cannes while you're in Nice, Sep 3 – 8". The scope line counts the
  reader's own city.

### The replay that ran in the dark

Runs 109 and 110 both failed the onboarding tour's last assertion: after
finish-profile the map should have come back in place mode (the drop-pin
door had been taken) and came back in browse mode instead, welcome notice
and all. The intent had been recorded and consumed; nothing was on screen
to show for it. The replay effect was keyed on `isGuest`, and a guest's
session is upgraded at signup's FIRST step (`updateUser` on the anonymous
session), so the map - still mounted under the signup route - replayed the
intent into a screen nobody could see, entered place mode in the dark, and
had lost it by the time the tabs came back. The effect now also waits for
`useIsFocused()`: the intent is consumed only once a person can see the
result. That guard was right and it was not enough: run 112 failed the
same tail with the guard in place, and the log for run 111's onboarding
tour turns out to be cut off before its tail, so the "passed end to end"
this entry used to claim rests on nothing that can be re-read (the results
branch is force-pushed each run). Run 111's four other failures were the
suite, not the app: the sign-in form remembers the last address that
signed up on the device (lib/last-email) and the tour typed the E2E address
onto the end of the throwaway's, so the large-text tour after it ran signed
out and met the gate instead of place mode; the business description step
autofocuses and "Skip for now" sits under the keyboard it raises; and the
filter sheet's category chip sat under the Done band, which the fade and
the padding above now clear. The flows erase the field and hide the
keyboard first. One thing in the app did come out of it: Reanimated's
keyboard height leaves out the input accessory view, so every
`KeyboardFloor` that lifted a footer above the keyboard lifted it 36pt
short and the Hide keyboard bar lay across the bottom of Continue (screen
60). The floor adds the bar's height while the keyboard is up.

### Run 113: the replay works, and what it exposed

The first run on the merged tree, with the timer held in a ref. The
onboarding tour's guarded tail passed for the first time on record:
`75-signup-done` shows the map back in place mode after finish-profile, spot
card and venue chips and all. Three reds around it, each read from its
picture rather than its assertion:

- **The business tour landed in place mode too.** A guest who taps Drop a
  pin, takes the business door, and finishes the listing later reaches the
  tabs with the drop-pin intent still in the store, and now that the replay
  actually fires it fired for them. The store's listing flag is cleared by
  business-signup's own mount effect, so both guards (the map's replay and
  the tabs handoff) now read `useWantsBusiness`, which also reads the column,
  and the handoff lets the intent go for an owner-to-be the way it does for a
  business. `pending-intent.test.ts` pins both.
- **The sign-in tour's address had a tail.** `10b` photographs the typed
  address followed by the end of the prefilled one: SecureStore lives in the
  keychain, the workflow's state reset never touched it, so the onboarding
  tour's throwaway was prefilled, iOS landed the caret where the tap was,
  and `eraseText` only deletes backwards. Runs 111 to 113 all failed here,
  each a different symptom of the same thing. The workflow resets the
  simulator keychain before every flow now (a first-run app has an empty
  one), and the field gets iOS's clear button while editing, because a
  person with a second address had the same problem without a keychain
  reset to save them.
- **The guest tour's category chip was still under the footer.** Maestro
  reports an element 100% visible from its frame, not from what is drawn
  over it, so `scrollUntilVisible` was satisfied with the chip's lower half
  behind the Done band and the tap on its centre landed on the band. The
  step centres the element now.
- And the tail itself tapped Cancel inside the drop-pin block, which made
  the pin-variant block's `notVisible: 'Pin here'` true and ran it against a
  map with no card. Place mode is left after both checks.

The gallery is republished from run 113 (56 of 69 shots). The production
update went out before this run finished (TestFlight run 85, iOS update
01a06de1-2bb9-70cf-82ff-eb9ac40f35f8, commit cdeb3b6): the founder asked
whether he could test, the gate was green, and the run's findings are all
either the suite or the one rare path above, which ships next.

### The bottom card came across, and a word came out of the database

The founder compared the gallery's bottom strip with his phone and asked whether
the update would put the old one back. It would have. The card on his phone
(TestFlight run 84, cb1979d) came from `claude/popup-menu-layout-nrqpsc`, which
forked from the same base as this branch and carried five commits this branch
did not: the bottom of the map as one card (the plan list's sheet runs to the
screen edge, the dock stands on a plate cut from the same surface,
`features/pins/bottom-stack.ts`), the dock on the tab bar's real inset, the "not
busy enough" chip removed, and the one-to-one refusal that says why once. That
branch is merged here now, verbatim on the bottom stack; the one conflict was
the removed chip, which had just been given a width ceiling, and the ceiling
moved to the two chips that remain in the strip. Three independent reviewers
then read the merge against both parents before it was pushed.

The full jest run before that push found one more thing: the four raise
literals reworded away from "request" said "hello", and the client's one-name
rule keeps "hello" out of anything a person reads, which includes the strings
the client matches those raises by. The reworded file had already applied, so
the wording is restated in a fix-forward migration
(`20260904200000_say_hi_in_the_databases_words`) as "already said hi to this
traveler", "daily limit for saying hi reached" and "unknown source for saying
hi", with the hints unchanged. Production raises the 2026-09-02 wording until
that deploys; the client maps both.

### Run 114: three of four green, and two flows behind the app

With the timer held in a ref, the keychain reset per flow and the owner-to-be
guard, run 114 photographed what runs 109 to 113 could not: the signup replay
tail end to end (75-signup-done, then the ordinary map), a sign-in that lands
on the map (11-signed-in-map), "Finish this later" landing an owner-to-be on
the browse map with its dock (40a), and the large-text tour signed in through
place mode, Travelers, Chat and a Say hi (zz-ax5-01 to 05). The guest tour
cleared the filter chip it had failed on since run 111.

What was still red was the suite trailing the app. The guest tour tapped
'Denpasar' and the chip says "Denpasar 10" now (Maestro matches the whole
string); it taps 'Denpasar.*'. The signed-in tour tapped Drop a pin on a map
that was already in place mode, because the replay carries a guest's drop-pin
intent across a sign-in as well as a signup - which is the feature - so the
flow enters place mode only when the replay did not. The business tour reached
the photo step for the first time in days and lost the cover to "stuck while
preparing it" at 90 seconds, on a run that took fifteen minutes longer than
the one before it; no crash report was written, the same pipeline uploaded the
profile photo minutes earlier, and its retry sat on the splash. Slow hardware
rather than the app, and left alone: the bound exists to end hangs, and the
budget was raised twice already for exactly this.

### The replay that cancelled itself

The mechanism, found by putting the effect's shape on the real React in a
test rather than by reading it again. The replay effect consumes the intent
first (`intentHandled()`, a store write), then schedules `applyCity` and
`enterPlaceMode` on a 0ms timer, and returned a cleanup that cleared that
timer. A store write inside a passive effect is flushed synchronously,
before React returns to the event loop, so the intent going null re-ran the
effect, and its cleanup cleared the timer before the timer could fire. Every
replay was cancelled by the act of recording that it had happened; the
focus guard, the hydration guard and the rail guard all read correctly
around a tick that never came. `features/pins/__tests__/replay-outlives-
its-clear.test.tsx` shows both shapes: the cleanup-owned timer never fires,
a ref-held timer cleared on unmount only fires exactly once. The map has
the second shape now, `pending-intent.test.ts` refuses the first, and the
traps skill carries the rule (an effect that consumes its trigger and
defers its action must not own the deferral through its own cleanup).

The sign-in half of run 112 is unexplained and worked around. The tour
typed the address correctly, pressed Return, typed the password, and
photographed an EMPTY password box under "do not match" - a submit that
the form's own gate should not have allowed with nothing in that field.
The flow now fills the sign-in form the way business-tour fills the join
form and passes: tap the field, type, Hide keyboard, tap the next field,
and it photographs each field after typing so the next run says where the
password went if it goes anywhere again.

### Seven seams the pictures showed

Eight reviewers read run 109's ninety screenshots as pictures and fifteen
verifiers tried to refute them; the confirmed list is long and most of it is
design work for a later sitting. Seven were cheap and plainly wrong, and
they are fixed: the onboarding scroller and the map's filter sheet fade at
their bottom edge instead of slicing the last row of tiles, options or
chips through the letters (54, 55, 72, 73, 05a); the profile-photo caption
keeps the founder's sentence after a photo lands rather than swapping back
to the old line (55); "Something else" gets its second line instead of
clipping to "Somethi..." (71); the "Not busy enough" notice wraps inside
the screen rather than losing its dot off one edge and its close off the
other, and stops being a lozenge at five lines (40a, zz-ax5); the Filters
chip grows with Dynamic Type instead of chopping the word (zz-ax3); and the
signed-out Chat tab says "Chats at hostels and bars are under Groups"
rather than calling one thing a chat, a room and a group in two sentences
(04). Still open from that review, for the record: the business flow's
Continue pill under the keyboard bar (60), the "1 of 14" on the role step
before a business has said it is one (40), the empty-state steps that draw
the same control twice with a void between (58, 59, 70), the business
offer card with no photo (40c), and the address step with no keyboard bar
(43), which needs a picture from run 111 before it is believed.

### What did not move

§7 rule 2: every radius is measured from a city a person CHOSE; `get_matches`
takes no argument and the pgTAP asserts its `pronargs` is 0. Rule 3 and rule
6 as above. Rule 8: businesses still register in a launch city, which is the
business side's decision and not this one's. `launch_cities` narrows to what
it always half was: where a business can list, the seed of the rail, and a
per-city override for k and the clock. _Superseded 2026-09-05: businesses
register anywhere too; see the entry above._

### Proof

`76_a_pin_goes_where_the_traveler_goes.test.sql` (56 assertions): the
Manhattan pin, its resolution, the Monaco/Cannes/Atlantic cases, the circle
from New York and Hoboken and not Bangkok, both doors, the clock and its
CHECK, a window past midnight, TBD, the rule 3 edge for a window at every
hour of the day, the rail's ranking and its k, heat and the sweep for a city
nobody opened, the retired functions, and Nice/Cannes/Antibes/Lisbon through
`get_matches`, the policy, the hello and the inbox chip at 0, 20 and 32 km.
Five existing files changed with the decision (06, 26, 56, 64, 72) and the
rest of the suite passed unchanged. Client: browsing-city, city-store, the
rail scan, pin-form-hour (window, TBD, put-out), the hour helpers, the radius
words, and the two-city overlap sentence.

## **The keyboard bar was built three times and bound once** (2026-09-04)

The founder sent two screenshots and six comments. The one that mattered most
was the one they had made before: "I've said it many times but it still isn't
there. EVERY KEYBOARD MUST HAVE THE DISMISS KEYBOARD BUTTON." The bio step,
keyboard up, no bar, and the footer riding on top of the keyboard.

Every piece of that bar was in the tree. `StepShell` mounted it, `FormTextField`
pointed at it by id, a source scan asserted both halves, and it had been
written on 2026-08-24, widened on 08-28 and lifted into the shell on 08-30. It
was on the phone for exactly one field per screen, and the reason is in React
Native's own source rather than in any of the three attempts.

### The cause

Under Fabric, `RCTInputAccessoryComponentView.didMoveToWindow` is guarded by
`if (self.window && !_textInput)`: it walks the window ONCE, when the BAR enters
it, takes the first field whose `inputAccessoryViewID` matches, caches it, and
never looks again. The field side never looks at all —
`RCTTextInputComponentView.setDefaultInputAccessoryView` returns early the
moment an id is set, so a field that missed the one-shot bind gets nothing, not
even iOS's default toolbar. The documented shape (one bar per screen, one
shared id, every field pointing at it) was right under Paper, where the FIELD
looked the bar up on its own mount, and is quietly wrong under Fabric: the bar
bound to whichever field existed when the shell first mounted, and every field
mounted later — the next signup step, a search box revealed by a tap — had
none. That is the screenshot: step 7, reached from step 6.

So it is one bar per field now, mounted with it, rendered BEFORE it.
`KeyboardDone` (`components/form/keyboard-done-bar.tsx`) is a render prop that
draws the bar and hands the field a `useId`, so neither half can be forgotten
or reordered; `FormTextField` uses it and the seven raw `TextInput`s wrap
themselves in it. Before, not after, read out of `Differentiator.cpp`: a new
subtree is assembled bottom-up and attached whole, so `didMoveToWindow`
cascades parent-first over a subtree that is already complete, and an
earlier-sibling bar binds before the field's own `didMoveToWindow` fires
`autoFocus`. The eight shell mounts and the shared id are gone.

**The old scan let two fields through with no bar at all.** `language-field`
spread the props onto a `SymbolView` icon; `pin-form-sheet`'s venue input had
none, because a `FormTextField` elsewhere in the same file carried them. A file
that mentions a prop is not an element that has it. The new test walks the
rendered tree for the pair (bar first, ids equal, ids unique) and the scan
requires every `<TextInput` to sit between a `<KeyboardDone>` and its close.
Mutation-checked three ways, each breaking a named assertion. Recorded in the
`traps` skill, under Keyboard, with the file paths.

### The rest of the list

- **The footer goes under the keyboard.** "Just keep these options at the
  bottom but have the keyboard go over them when the user is typing."
  `KeyboardFloor` takes an `allowance` (the measured footer height) and
  `StepShell` puts the floor under the scroller only, so the field's last line
  meets the keyboard's top edge and Continue, the skip and Sign out are
  covered until the bar is used. **Sign out is a footnote-sized line** under
  the skip rather than a ghost button: "not really a need for the sign out
  prompt to be so prominent". Still 44pt, still on every step, for the
  hostel-wifi reason it exists.
- **"Rather not say" is gone from both gender pickers.** "It goes against our
  filters", and it did exactly: `audience_admits` puts an unspecified profile
  in none of the three gendered audiences while `set_visibility` let it choose
  one, so somebody could narrow to verified women without being filterable as
  anything. `basicsProblem` refuses the value now rather than honouring a tap;
  the `genderTouched` flag goes with the option it existed to tell apart;
  edit-profile cannot save without one; `resumeStep` lands a legacy opt-out
  back on step 3. No migration: `'unspecified'` is the column default every
  row is born with and the guest trigger compares against it, so the enum
  value stays and only the offer goes.
- **Copy.** The photo tile says "Make sure your face is clearly visible in
  your profile photo." Step 9 is titled "Add your top priorities for your
  trip". The badge subtitle ends "so you can choose verified travelers only
  and filter by gender".
- **The badge is a step.** It was a door on the audience step, opened only by
  tapping a locked row, and the founder walked the whole sequence without
  meeting it: "There should be an option to verify your profile during
  onboarding." Step 12 is Get your badge, skippable, with the cost of skipping
  said under the skip (the verified-only rows on the next screen stay locked);
  audience is 13, the review 14, the door on 13 stays for whoever skipped.
  `SIGNUP_TOTAL_STEPS` is 14 and the slug `badge` is inserted rather than any
  renamed, since the slugs are the funnel's event schema.
- **Place mode: the venue chips scroll, and the spot's name is not a fourth
  chip.** The second screenshot, Bangkok: three venue names clipped at both
  screen edges, and "the actual location bubble is no different than the
  three that are above it". The chips sat in a centred flex row where a chip
  could shrink and its text could not; they are a horizontal scroller now,
  centred while they fit, capped at 240pt with an ellipsis. The spot's name
  was a pill in the chips' own surface, footnote and shadow; it is a card:
  the pin's glyph in the pin's colour, the place over its district or street
  (`splitSpotLabel`, at the first ", " the map itself joined them with), the
  sunken surface with a hairline and a card's corner. Photographed by the
  signed-in tour's `12-place-mode` / `13-place-after-pan` on the next run.

### Verification: the two questions, and the hole the second one found

**"Will the verification fail if their profile photo includes multiple
people?"** The code cannot say. The worker sends the selfie, the first two
APPROVED profile photos by position, and the one question "Is this selfie
plausibly the same person as the profile photos?"; the verdict schema is
`approve | reject` with a reason, nothing counts faces, and the decision lives
in the classifier prompt, which is a secret by design. What the code does with
each answer is fixed: approve stamps the badge, reject shows the reason and
allows a retry (three a day), a refusal or an unparseable answer retries up to
ten times and then rejects. Two adjacent facts: a group shot can BE the
approved position-0 photo (photo moderation has no "one person" category), and
only the first two approved photos are ever compared.

**"If they change their profile photo, will the account need to be
re-verified?"** It did not, and that was a hole. The only write of
`profiles.verified = true` in the schema was the approve branch; every trigger
on `profile_photos` was INSERT-only; the verdict recorded nothing about which
photos it compared. So a verified traveler could delete the lead, upload a
different face, move an unchecked gallery photo into the lead, and keep the
badge and the narrowed audience it had earned — while `submit_verification`
refused to let even an honest person re-verify ("already verified"). The
badge's own explanation to strangers, "we compared it against their profile
photos", was false after the first swap.

Now the badge follows the face (`20260904100000_a_badge_follows_the_face`):
the verdict records the photo ids it compared; an AFTER trigger on
`profile_photos` revokes the badge when a photo that was not compared becomes
the lead (arrives at position 0, is approved into the lead, or inherits the
lead because a compared one was deleted or un-approved); revoking flips
`verified` so `profiles_reset_visibility` drops the audience to everyone, marks
the approved request rejected with a reason the app already renders, writes a
`verification_revoked` event that is not a strike, and queues a push. The rule
is keyed on the ROW that changes, never on "the lead is not compared" derived
after each write, because `photoWritePlan` on a full gallery vacates slot 0 for
one round trip. `submit_verification` accepts a pending photo and the worker
waits for it rather than rejecting (counted as `waiting` in its report),
which is what lets the badge step sit seven screens after the photo step. The
verdict and the trigger take the per-user advisory lock `submit_verification`
already took, so a verdict and a photo write in the same instant cannot leave
a badge judged against a snapshot. pgTAP `75_a_badge_follows_the_face`: 53
assertions, every guard broken in turn and the first failing assertion
recorded in the file's header; one guard (`old.moderation_status <>
'approved'` on the approval rule) is unreachable by any state and is kept as
change-detection, said so in the header rather than left to look tested.

### Evidence

E2E run #109, `build: true` — the one-time 0.2.0 simulator build the
workflow's own note has been asking for since the version bump. The flow now
taps `Hide keyboard` by its label wherever a button sits under a keyboard
(password, age, bio; business password and phone), so a bar that is not on
that field fails the run rather than a screenshot. `57-signup-bio` is taken
with the keyboard up; `57b` after the bar is tapped; `71b` is the badge step.

Deploy order: the migration first (it only widens `submit_verification` and
adds a trigger, and an OTA bundle is never applied on the launch that
downloads it), then the production update.

## **Sign in with Apple, as far as a browser can take it** (2026-09-03)

The founder has no local machine, so everything Apple-side runs through GitHub
Actions — the same fact `scripts/asc-provision.mjs` and the APNs push key exist
for. Sign in with Apple was the last Apple thing still written as a `supabase
secrets set` recipe for a laptop nobody has. It is now two steps in
`.github/workflows/supabase-deploy.yml`, and the founder's remaining work is a
browser and two pastes.

**The two halves are independent, and this doc had been running them together.**

1. **The sign-in working at all (a)** needs the Supabase Auth provider enabled
   with the bundle id as an acceptable token audience. **No key of any kind.**
   New step "Enable the Apple auth provider" →
   `.github/scripts/enable-apple-provider.mjs`, on every non-dry-run deploy.
2. **The revoke on account deletion (b)**, App Review 5.1.1(v), needs a Sign in
   with Apple `.p8`. New step "Sync Sign in with Apple secrets" maps two new
   repository secrets onto the four env names
   `supabase/functions/_shared/apple.ts` reads.

(a) without (b) is an app that signs people in and is rejected. (b) without (a)
is a revoke path nobody reaches.

### Now automatic

- **The provider.** PATCH `/v1/projects/{ref}/config/auth` with
  `external_apple_enabled` and `external_apple_client_id`, then a **fresh GET**
  that fails the run if the provider is not on or the bundle id is not in its
  client IDs. That read-back is the push-key script's lesson applied before it
  could be paid for a second time: its first version reported a success that was
  true of the account and not of the app. Idempotent (appends the bundle id only
  when missing, does nothing when the state already holds, never reorders an
  existing entry), and skipped in `dry_run`.
- **The four function secrets**, from `APPLE_SIGNIN_KEY_ID` →`APPLE_KEY_ID`,
  `APPLE_SIGNIN_KEY_P8` → `APPLE_PRIVATE_KEY`, the existing `APPLE_TEAM_ID` repo
  secret, and `APPLE_CLIENT_ID` as a literal (`com.mattmoore.samewhere`) the way
  `SUPPORT_INBOX` is one. Absent, the step **warns and the deploy stays green** —
  a deploy must not go red for a founder errand that has not happened yet.
  Malformed, it **fails loudly**, because both callers swallow their exceptions
  and a key that looks set and cannot be parsed is the worse failure.

### Established this pass, not assumed

- **`external_apple_client_id` is the BUNDLE ID, not a Services ID.** The app
  calls `supabase.auth.signInWithIdToken({ provider: 'apple' })`
  (`src/features/auth/api.ts:564`). GoTrue's handler for that grant
  (supabase/auth `internal/api/token_oidc.go`) builds `acceptableClientIDs` from
  `config.External.Apple.ClientID` plus `IosBundleId` and requires the token's
  `aud` to contain one of them; a device's identity token is audienced to the
  bundle id. A Services ID there refuses every sign-in with "Unacceptable
  audience in id_token".
- **`external_apple_secret` is not needed and is never sent.** It is the web
  redirect flow's client secret: GoTrue reads it only in `NewAppleProvider`,
  whose `ValidateOAuth()` also demands a redirect URI, and the id_token path
  never touches it. Supabase's own guide: "If you're building a native app only,
  you do not need to configure the OAuth settings." Sending `""` would also wipe
  a secret somebody had set on purpose.
- **The five Apple field names** were checked against
  `apps/docs/spec/transforms/api_v1_openapi_deparsed.json` in supabase/supabase
  rather than recalled; all five exist on `UpdateAuthConfigBody` and on
  `AuthConfigResponse`, all nullable, none required.
- **PATCH is partial**, on the evidence of the schema (no required fields),
  Supabase's own docs (their example patches three of 234 properties), and HTTP.
  That is good evidence and not proof, so the script **fingerprints every
  non-Apple key before and after and fails if any moved** — naming keys, never
  values, because the same response carries the Twilio token and the captcha
  secret. If it ever fires, PATCH is not what everyone thinks it is.

### Both steps have now run (2026-09-04, run #105, commit `0cefdbd`)

The founder created the key and added `APPLE_SIGNIN_KEY_ID` and
`APPLE_SIGNIN_KEY_P8`, and the deploy that followed is the first execution of
either step. Read out of the job log rather than off a green tick, because the
secrets step exits 0 **with a warning** when the secrets are absent, so its
conclusion alone cannot tell "synced" from "nothing to sync":

```
Apple provider enabled: true
Apple client IDs: com.mattmoore.samewhere
Non-Apple auth settings: 238 keys, fingerprint 575d25567319e7dc
Already enabled with com.mattmoore.samewhere in the client IDs. Nothing to change.
Read back — enabled: true
Read back — client IDs: com.mattmoore.samewhere
Non-Apple auth settings unchanged (238 keys, fingerprint 575d25567319e7dc).
Verified against a fresh GET: ...
Finished supabase secrets set.
Apple revocation secrets synced: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID
(com.mattmoore.samewhere, a literal, so it is readable) and APPLE_PRIVATE_KEY.
```

Three things that were open are now settled, and one of them the other way
round from how it was written:

- **The fingerprint is identical before and after**, so PATCH really is partial
  against the live Management API and not only on the schema's word. That was
  the one claim in this entry resting on inference.
- **`supabase secrets set` does accept a multi-line PEM as an argument value.**
  `apple.ts` was written to survive a shell that mangles the newlines; it did
  not have to.
- **The provider was already on** ("Nothing to change"), so the idempotent
  branch is what ran, not the write. The read-back is therefore the whole of the
  evidence for (a) — which is why the read-back was built, after the push-key
  script reported a success that was true of the account and not of the app.

The prior draft of this entry claimed the provider step had been "tested against
a local stand-in for the Management API — five scenarios". That was never true
and could not be: the script hardcodes `https://api.supabase.com` with no env
override and runs on import, so there is no seam a stand-in could use. What had
actually been done was a reading of the published OpenAPI spec and reasoning
about the branches. Left in the record because a fabricated test is worth more
as a scar than as a deletion.

### The hand-run happened, and the log is the record (2026-09-04)

The founder created an account with Sign in with Apple and deleted it. Their
report was "everything seems to be working", and the uncomfortable thing about
that sentence is that it is the expected observation in the failure cases too:
`delete-account` returns `{ deleted: true }` down every branch of its revoke
block, so full success, no-token-stored, wrong-key-and-Apple-refuses and
store-call-failed are identical in the app, byte for byte. So a reader was built
(`.github/workflows/apple-revoke-log.yml`, first run 2026-09-04) and the answer
came out of the log:

```
2026-09-03T19:19:58  [quiet]  delete-account: no stored Apple token, nothing was revoked
2026-09-04T12:33:11  [pass]   delete-account: Apple accepted the revoke
                              HTTP 200 from appleid.apple.com/auth/revoke
```

**Those two lines are the before and the after, and neither was staged.** The
19:19 one is a deletion from the evening of the 3rd, hours before run #105 set
the secrets at 00:16 on the 4th: with no key, `store-apple-token` returned early
and stored nothing, so that deletion had nothing to spend. It is the false pass
this entry has been warning about, caught in the wild. The 12:33 one is today's,
after the key, and it is the whole path working.

What the pass proves, precisely: `delete-account` found a stored refresh token
(without one it takes the 19:19 branch), signed an ES256 client secret with the
`.p8` that Apple accepted as belonging to this bundle id (a wrong key, team or
client id is `400 invalid_client`), and posted a revoke Apple answered 2xx. All
four function secrets are therefore correct, and `store-apple-token` is proven
too — by inference, since its success path logs nothing at all.

What it does not prove on its own: **Apple answers 200 both for "revoked" and
for "that token was already invalid"** (developer.apple.com, revoke-tokens: "the
provided token has been revoked successfully or was previously invalid"). A
single `ok (200)` is therefore not proof that a live grant was withdrawn at that
moment. Here it is, because the only way a token existed at 12:33 is a sign-in
after 00:16, and nothing between them could have invalidated it — the 19:19 line
is what rules out an older one. The general lesson stands: read `ok (200)` as
"the wiring is correct", and let the sequence, not the status code, carry "a
grant was withdrawn".

### Two things this pass got wrong elsewhere

- **`20260901090000_apple_can_be_told_to_forget.sql:11-14` is half wrong.** It
  says Apple returns "a name and an email only on the FIRST authorization".
  Apple's own docs say the identity token carries the email on **all**
  subsequent responses; only the name is first-authorization-only. The migration
  has applied and is not to be edited, and the error is in a `--` comment rather
  than in any behaviour, so it is corrected here instead. It matters because it
  made a re-signup look like a server-side test of whether the revoke landed,
  and it is not one.
- **The `FULL_NAME` scope is requested and thrown away.** `signInWithApple`
  (`src/features/auth/api.ts:554`) asks for it, and `credential.fullName` is read
  nowhere: `grep -rn 'fullName\|givenName\|familyName' src/` returns nothing. Not
  a defect — onboarding collects a name anyway — but it means the name half of
  the re-signup test cannot be read from the database either, and anyone who ever
  wants to prefill a name from Apple should know the data is already arriving and
  being dropped.

### Still owed

- **Nothing on Sign in with Apple.** Both halves are wired, deployed, and now
  observed working end to end against the live project.

## **The dock stood 50pt too high on every tab** (2026-09-03)

The founder, on the card that shipped an hour earlier: _"can you move everything
down a bit so that the 'drop a pin' button and part where it shows plans in your city
aren't taking up so much room on the bottom? It looks like there is empty space below
the button."_ There was, and it was a bug on every tab, not a taste question.

**What was wrong.** `useTabDockBottom` was `tabBarInset + insets.bottom + Space.sm`,
and on iOS the tab bar is ALREADY INSIDE `insets.bottom`: expo-router wraps every
native tab screen's content in a `SafeAreaProvider` of its own, and a provider
publishes its own view's insets, which UIKit has already grown by the bar. So the
constant was being added to a measurement that already contained it. The hook's doc
comment asserted the opposite in as many words ("NativeTabs publishes no height to
JS, so the inset is DERIVED from fontScale"); that sentence was false and is deleted.

**Measured, not guessed**, off the founder's screenshot at 3x (iPhone 15/16 Pro):
the tab capsule's top edge is at 83.3pt and the Drop-a-pin button's bottom edge at
141.3, and `141.3 - BottomTabInset(50) - Space.sm(8) = 83.3` exactly. Second,
independent check: the plan card's top edge measured 257, and
`141.3 + 52 + 8 + PLAN_LIST_PEEK(56) = 257.3`. The "it is really a high fontScale"
alternative is refuted by the same picture, because at ~2x the button could not
measure 51.7pt against a `DOCK_MIN_HEIGHT` of 52.

**The fix keeps one formula and one hook.** `tabDockBottomOf` trusts the inset when
it exceeds the window's own bottom inset, and otherwise falls back to exactly
today's sum. The fallback is load-bearing twice: `ConnectedNotice` is mounted as a
sibling of the tabs, so its inset is the home indicator alone and it must not move;
and a tab provider seeds from its parent until its native view lays out, so the
first frame reports the window's inset. That frame is why this is not a bare
`insets.bottom` - the old bug slid "Drop a pin" and "Say hi" under the bar, and no
frame may do that again. A wrong read on a device we cannot see therefore degrades
to today's behaviour, never to a buried button.

On the founder's phone: the dock rises 141.3 -> 91.3, the plan card's top edge drops
257 -> 207, and the map gains 50pt. Travelers, my-business and the placeholder
screens gain the same 50 (the placeholder was adding the constant on top of a
`SafeAreaView` whose edges are all additive).

**The message that failed.** He also messaged somebody in his own group and got
"Something went wrong. Try that again." twice over, inline and as an alert.
`open_direct_chat` refuses a guest RECIPIENT, which Kate is, and the raise carries
no hint and no terminator, so `saveFailureMessage` fell through to the generic
sentence; the alert was the global mutation cache firing on top of the screen's own
catch. Both fixed on the client: the raise maps to "You cannot message this traveler
one to one right now.", and `meta: { inlineFailure: true }` stops the cache alerting
for a mutation whose screen always prints its own failure.

**Founder question, and it is a product decision, not a bug.** The guest rule is
deliberate and written down twice - ARCHITECTURE.md ("Guests are neither end of it
... cannot ... open or receive a one-to-one chat") and the `add_people_without_a_link`
migration's own header - on the grounds that an unaccountable identity is not put in
front of somebody one to one, and that the janitor deletes a guest when its last
membership goes. It is NOT a §7 hard rule; it is not mentioned in PRODUCT_BRIEF.md at
all. So it can change on the founder's word. If it does, it is a Supabase deploy and
it is not a one-line predicate removal: `stale_guest_ids` keys guest liveness on
group membership and recent messages and never looks at `chat_participants`, so a
guest who leaves the group and goes quiet for 30 days would be deleted and
`messages.sender_id ... on delete cascade` would take her half of the thread with
her. That clause has to move in the same deploy.

## **The bottom of the map is one card** (2026-09-03)

The founder sent a screenshot of the Map tab: _"it looks bad with the pop up menu being
above the drop a pin button like that, and also the not busy enough to show yet pop up can
be removed."_ Both halves are done.

**The pop-up over the button.** The plan list's sheet stopped 152pt short of the screen, so
its lower edge was a hard cut across the map with the Drop-a-pin pill floating in the strip
of bare map below it, and the tab bar floating below that: three slabs where there is one
thing. The sheet now runs to the screen's bottom edge and the dock stands on an opaque plate
cut from the same `theme.surface`, so the peek strip, the button and the tab-bar clearance
read as one card. The two browse docks moved AFTER `<PlanList>` in the JSX, so the button is
painted over the sheet at every detent instead of being buried by it — which also means the
primary action is now on screen with the list open, where before an expanded list covered
it.

**Nothing moved that a person had learned the position of.** The arithmetic came out of the
screen into `src/features/pins/bottom-stack.ts` and is unit-tested by execution against the
old expressions as its oracle: every detent's top edge and every `messageSlot` value lands
where the split layout put it, on four device heights × four footings × four peek heights.
The one deliberate move is the peek strip, `PLAN_LIST_PEEK` 76 → 56: its content measures
48pt, so the old value carried 28pt of empty surface under one line of text, which is a good
part of why one sentence read as a slab. The map gains those 20pt back.

**Two bugs fixed on the way.**

1. The plan list's `ScrollView` had no bottom clip, so at any detent under full its frame
   hung below the screen and the content down there could not be scrolled into view at all —
   234pt of it at the half detent. `marginBottom: heights.full - target`.
2. `messageSlot` composed the `PLAN_LIST_PEEK` CONSTANT while the strip rendered at its
   Dynamic Type height, so at the accessibility sizes every banner and chip sat behind the
   card's own top edge. Both heights it composes are measured now, and the peek measurement
   is held on the map screen rather than inside the list, which remounts on every mode
   change.

**"Not busy enough to show yet."** Gone entirely: `useHeatEmptyLegend`, its storage key, its
`SLOT_ORDER` entry, its gate on the places legend, and its JSX. The strip stays empty on a
quiet map unless another occupant claims it.

**Founder question.** With `heat-empty` gone, `places-legend` ("Tap a business to see what's
on") is next in `SLOT_ORDER` and now inherits that strip on a quiet, business-filtered map.
You asked for one fewer floating layer and by default you get a different chip in the same
place. Should the teaching chips leave that strip as a class, or keep their one read each?

**Known and accepted.** Collapsing from the half detent shrinks the list frame in one commit
while the sheet springs for 350ms, so rows blank to bare surface for that beat before the
sheet slides down over them — transient only, and no map shows through. VoiceOver's swipe
order is now dock-then-list where the eye reads list-then-dock; both fixes cost more than
they buy. `connected-notice` floats at `dockBottom`, which now lands it on the card rather
than on map; it is an overlay and the card is a legitimate ground, but it is unphotographed.

Not yet seen on a device or in the simulator gallery — the screens run is the next step.

## **Three closures, so the build is the last thing that lands** (2026-09-02)

The founder asked for the one EAS build the native changes are waiting on, and for any
remaining work to finish first. Three things were open, and all three are Supabase deploys;
the second also carries an over-the-air client half. None of the three is native. What IS
native, and what the build is for, is the rest of this tree: `expo-store-review` and the
`version` bump to 0.2.0 that goes with it, plus the notification config that has been
waiting since 2026-09-01 (below, "The 0.2.0 build"). Details, entry points and the
enumeration tables for the three closures are in
[`ARCHITECTURE.md`](ARCHITECTURE.md) under "Three closures before the build".

1. **The selfie verdict's English has a reader.** `admin_verification_queue` and
   `admin_business_verification_queue` (20260903040000) are two service-role views for the
   SQL editor, `reason` beside `reason_en`, revoked from anon and authenticated on the line
   after each `create`. `66_a_verdict_the_founder_can_read` is written as the attack, and
   every one of its refusals was shown to fail with the revoke deleted. Package
   `hi-a-verdict-the-founder-can-read` in UX_PACKAGES.md is done; no RPC, no client.

2. **A group's own photo is checked.** The gap `src/features/groups/api.ts` recorded on
   2026-09-01 is closed (20260903050000): `groups.photo_status`, a trigger scoped to
   `photo_path` that does nothing persistent unless the path moved, a worker queue with its
   own slice of the tick, `apply_group_photo_verdict` and `note_group_photo_attempt`, the
   storage policy tightened to approved-only, and `my_chats` and `group_invite_preview`
   masking the path from everyone but its uploader until it clears. On the phone: the group
   page shows the admin their picture behind a spinner with "Checking this photo. Only you can
   see it until it clears."; other members see the group glyph and NOTHING said beside it (an
   earlier draft of this line said they are told "A new group photo is being checked.", which
   the code never did and must not — a member who could watch that sentence turn into nothing
   would know the picture was refused); and a refused photo is removed with "That photo was
   not approved and has been removed. Pick another." The room header says "Checking your group
   photo" to the uploader for the few seconds it takes. Not a strike. A phone still on the
   previous bundle draws the group glyph for an unapproved photo, because the bucket refuses
   to sign it.

   **The status half of that was enforced by the client alone until 20260903130000.**
   `grant select on public.groups` was table-level, so any member could
   `select photo_status from public.groups where name = '...'` and read 'pending', then
   'rejected' — the very inference the paragraph above forbids — whatever `photo.ts`
   returned. `groups` is column-granted now (the three photo columns and the new
   `photo_set_by` are granted to nobody), the app reads the row through `group_detail()`,
   the `chat_photos_select_group` policy reads the columns through `can_view_group_photo()`
   because an RLS expression runs with the READER's privileges, and
   `74_a_verdict_is_for_its_subject_alone` is the attack. Cost: one launch of the old bundle
   sees a LoadError on the group settings page, because `select('*')` on a column-granted
   table is `permission denied`.

   Two things this did not do, on purpose. The chat list row shows the uploader their own
   pending photo without a "checking" label: saying it there needs a `photo_state` column
   on `my_chats` and a reader in `chat-row.tsx`, and a column with no reader is the pattern
   this project keeps paying for. The invite screen was another agent's file this round and
   needs nothing: its RPC masks server-side and the frame already falls back to its glyph.

3. **A verdict on a business no longer re-reads its words.** `businesses_screen` ran the
   blocklist and stamped `updated_at` on every write to the row (20260903060000 fixes it).
   Established rather than assumed, every non-text write is enumerated in ARCHITECTURE.md;
   the one that mattered is `apply_business_scan_verdict`, whose `state = 'flagged'` is the
   write that takes a plausible impersonator off the map and would have failed on the
   impersonator's own old description once the blocklist grew past it. `updated_at` on
   businesses is not client-readable, so unlike profiles this was not a leak.

**Seen in passing, for the founder.** `apply_business_photo_verdict` and
`apply_business_post_photo_verdict` file a refusal as `photo_rejected` against the owner,
and `is_strike_action('photo_rejected')` is true, so a business owner's rejected photos DO
count toward the ledger that suspends accounts, while the comments beside those functions
say "explicitly NOT a strike". The group-photo door uses `group_photo_rejected` for exactly
this reason. Not touched this round (outside its files); one migration renaming the two
actions would close it.

**Fixed, and the diagnosis above it was wrong twice.** `56_a_pin_carries_an_hour` was
recorded here as failing "between 00:00 and 03:00 UTC" on a plan "at 19:00". Both numbers
were wrong. The plan is at **21:30** and the pin expired at `now() + 40 hours`, so the
expiry is later than the plan only when the suite runs after **05:30 UTC**: at 04:07 UTC
`now() + 40h` is tomorrow 20:07 and the plan is tomorrow 21:30, and `validate_pin` correctly
refuses a plan that outlives its own pin. So it failed on rather more than a fifth of all
runs, not in a three-hour window, and it was the test that was wrong rather than the schema.

The expiry is now anchored to the plan — `(current_date + 1)::timestamptz + interval '23
hours'` — which is after 21:30 by construction and at most ~47 hours out, inside rule 3's 72. The rule-3 refusal it exists to guard is still held by the `throws_ok` immediately
below it. 73 files, 1648 assertions, green at 04:10 UTC.

The general lesson is the one this round kept meeting: a test that is red on the hour of the
day teaches people to read red as weather, and the note explaining the window is what lets it
live. Two other clock-dependent assertions were found and fixed the same way this round.

### The 0.2.0 build: what it carries, what it orphans, and the order it goes in

**The build record, read back from EAS on 2026-09-02 rather than remembered.** Build 15
(`a2616922`, commit `7005e31`, 2026-08-30 18:23 UTC) finished and was submitted, and Apple
refused it at delivery with ITMS-90683: the binary references the motion APIs (expo-location,
used only for geocoding, and reanimated's sensor support) and carried no
`NSMotionUsageDescription`. Build 16 (`c9128c55`, commit `1cbe144`, 2026-08-30 19:05 UTC)
carries the string through the expo-location plugin option, was accepted, and is what the
phone has. Build 14 (`ab6c4e8d`) errored at signing and burned its number. The e2e channel's
binary is simulator build 13 (`6a6824e4`, 2026-08-22). Every one of them is runtime 0.1.0.

**What the 0.2.0 build carries** that no build before it does: `expo-store-review` and the
review ask (`docs/APP_STORE.md`, "Shipped in 0.2.0: the App Store review prompt"; package
`tq-store-review` is done, not deferred), and the whole `expo-notifications` plugin block
including `aps-environment: production` ("Shipped in 0.2.0: the notification config"). The
workflow's "Prove the binary carries what it should" step now checks `StoreReviewModule` and
the PostHog key as well as `LocalSearchModule`, the Supabase host and the entitlement, because
on TestFlight the review module's `isAvailableAsync` answers false by Apple's design and a
phone cannot tell a linked module from an absent one; the native strings fallback excludes
the JS bundle, which names both modules whether or not either linked.

**What the bump orphans.** `runtimeVersion` follows `version`, so from the moment 0.2.0 is
on the branch every update publishes against runtime 0.2.0: build 16 on the phone stops
receiving them, silently, and simulator build 13 stops taking the e2e channel's updates the
same way (the fetch gate fails rather than screenshotting old JavaScript). The order of
operations, and it is an order: (1) run the build with the bump in it, `build-then-submit`,
as the LAST thing in the batch; (2) confirm it installs from TestFlight and opens; (3) only
then publish updates. An update published between the bump and the install reaches nobody
and no run goes red to say so. The first E2E run after the bump needs `build: true` once;
after that `false` is right again. The review ask itself is safe on build 16 in the meantime:
the module is required late, inside a catch, so a phone whose JavaScript moved ahead of its
binary never asks and never crashes.

**To fill in when the build has run** (the hand-runs are in APP_STORE.md):

| Fact                                                                                      | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2.0 build number and EAS build id                                                       | **build 17**, `c351bf03-c26f-449e-9ed6-bfa47c19f16d`, commit `f477025`, submitted 2026-09-02 04:41 UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `aps-environment` per the step summary                                                    | **`production`**, read off the binary's own code signature (the profile branch fell through; either source answering is enough, and this one did)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `StoreReviewModule` linked and PostHog key baked in, per the step summary                 | **both yes**, plus `LocalSearchModule` and a real Supabase host. The EAS `production` environment was also confirmed to carry all four `EXPO_PUBLIC_*` values BEFORE the builder ran — the thing three docs recorded as not done and no build had ever proved                                                                                                                                                                                                                                                                                                                                                                                           |
| Push hand-run: a notification landed on the lock screen                                   | **DONE, 2026-09-03 23:30 UTC.** Sent from expo.dev/notifications to `ExponentPushToken[M3Px…]`, arrived on the lock screen with the app icon. That closes the whole chain end to end: `aps-environment` production in the binary, APNs key `JK5M6367VN` attached to the app's iOS credentials, and a token registered by build 17 (`push_tokens.updated_at` 23:27, five days newer than the stale one that had been there). NOTE the row's old title was wrong: the plugin's `icon` and `color` are ANDROID-ONLY, so nothing about them is visible on an iOS notification — what shows there is the app icon. They stay unproven until an Android build |
| Review-ask hand-run: `review_prompt_requested { available: false }` in PostHog, timestamp | _pending_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## **Four things this pass owes the next one** (2026-09-01)

A review round closed four design-system findings (the gate inside the place
sheet, the chip's missing border and bold, the filter sheet's 34pt "Clear
all", and a test whose title claimed a universal it did not check). Four
things did NOT close, and each is written down here rather than left to be
rediscovered.

1. **`ds-stack-header` is one route of seven.** `archived-chats` has its
   title; six `headerTitle: ''` routes in `src/app/_layout.tsx` still spend a
   header row on a lone back button. The exact six, what each one's title
   should be, and the two of them that are NOT actually bare (`profile-me`
   and `profile/[userId]` set their own titles from inside the screen) are in
   a table under the `ds-stack-header` package in
   [`UX_PACKAGES.md`](UX_PACKAGES.md), written so it can be applied without
   re-deriving it.

   An earlier draft of this note said nothing was applied because
   `_layout.tsx` was held by another agent. That was wrong, and the diff of
   this very pass disproves it: `_layout.tsx` is edited twice here — the
   `archived-chats` title at `:466`, and the `muted-words` route registered at
   `:514`. What is actually done is one route of seven, end to end:
   `archived-chats` carries `headerTitle: 'Archived'` and the duplicate
   `<ThemedText type="title">` is gone from `archived-chats.tsx`. What remains
   is the other six, and they were left because four of them need work in the
   SCREEN as well as in the layout, not because the layout was unavailable:
   `first-messages` needs its in-body title at `first-messages.tsx:41`
   deleted, `place/[id]` needs its title set from inside the loaded branch
   (the name only exists once the query resolves), and `join-group/[token]`
   and `i/[token]` are one screen re-exported twice and must be given the same
   string. The other two, `profile-me` and `profile/[userId]`, already set
   their own titles and want nothing at all.

2. **The selfie verdict's English copy still has no reader.** `reason_en` is
   now required by both moderation verdict schemas. The storefront half is
   read (the `uncertain` mail to the founder quotes it); the selfie half is
   written into `verification_requests.verdict` and read by nothing, so the
   sentence that exists specifically to make an appeal about somebody's face
   adjudicable is reachable only from the SQL editor. New package
   `hi-a-verdict-the-founder-can-read` in UX_PACKAGES.md specifies the fix:
   two service-role views modelled on `admin_report_queue`, with the
   `revoke` in the same migration and a pgTAP file written as an attack. It
   is a Supabase deploy and nothing else.

3. **The notification config reaches nobody until an EAS build runs.** The
   whole `expo-notifications` plugin block is new, and `plugins` is prebuild
   input: the icon, the tint colour, the Android channel id and `mode` are
   read when the native projects are generated, so no installed build has seen
   any of it. The trap, while `version` was still `0.1.0`, was that shipping
   it over the air looked like it worked — `runtimeVersion` is
   `{ policy: 'appVersion' }`, so an `update` carrying this app.json WAS
   accepted by the TestFlight build already on the phone. It got the
   JavaScript and none of the native config. **A green update run is evidence
   about JavaScript and nothing else; it says nothing about whether a push
   will arrive.** _Superseded 2026-09-02:_ the build is batched with the App
   Store review prompt and `version` is 0.2.0 in the tree, which closes that
   window and opens the orphaning one (the entry at the top of this file,
   "The 0.2.0 build"). The table is under "Shipped in 0.2.0: the notification
   config" in [`APP_STORE.md`](APP_STORE.md), and the workflow reads the
   entitlement off every build, so the `codesign` check is no longer a hand
   step. The JavaScript half (registration, the foreground handler, the
   Android channel `push.ts` now creates, the primer, the routing) does ship
   over the air — after the 0.2.0 build installs, not before.

4. **The APNs entitlement is set, and not yet proven.** `app.json` now passes
   `"mode": "production"` to the expo-notifications plugin, which is what
   writes `aps-environment`; the plugin's own default is `development`, this
   config has no `ios.entitlements` to pre-set it, and a TestFlight binary
   carrying the sandbox value registers a token that never delivers.
   `src/app/__tests__/notification-config.test.ts` fails if the mode is
   dropped. What could NOT be established from here is whether anything
   downstream rewrites the value: Expo's own SDK 57 notes say Xcode does it
   at archive time, and the EAS capability-sync page reads the key's presence
   and says nothing about its value. The one-line check to run against the
   first real build, and both sources, are under "The APNs entitlement" in
   [`APP_STORE.md`](APP_STORE.md).

### One rule this pass added: source slices are cut by an anchor that has to exist

A lot of this repo's checks are "this block of that file does not do X", which
can only be asserted against the text. Cutting the block with
`code.slice(code.indexOf(a), code.indexOf(b))` fails silently in two ways: `a`
is not in the file any more (indexOf gives -1, slice reads it as one character
from the end, the result is `''`), or `b` occurs earlier in the file than `a`
(the range inverts, the result is `''`). Every negative assertion passes
against `''`.

Both had shipped. `muted-words-reach.test.ts` was asserting that the folded
first message never writes, never calls an RPC and never tells the sender —
the one invariant that feature may not break — against an empty string, since
a fix round put `{checkingList ? (` in front of the anchor it was cut by.
`business-home.test.ts` cut its memo from line 403 to line 100 and had been
asserting about nothing since it was written.

`src/lib/__tests__/source.ts` now exports `between(code, from, to)` and
`after(code, from)`: a missing anchor throws with the anchor printed, and the
closing anchor is searched for AFTER the opening one so a pair cannot invert.
All 56 call sites across 26 test files use them, and
`src/lib/__tests__/source-anchors.test.ts` fails if any test starts a slice at
an `indexOf` again.

## Current: **e2e run 96 is green end to end** (2026-08-31)

The first fully green simulator run since 89 — and 89 never checked that a
photo landed, where 96 gates on it twice. The full arc, for the record:

- Run 92's stage-named timeouts disproved the "hung upload" theory: uploads
  succeed; the business grid's read-back was answering `permission denied`
  (the ungranted-column bug below). Grant deployed (#72), live suite 68/68.
- Run 93 photographed the alert naming its stage — "stuck while preparing
  it" — which measured the real variable: expo-image-manipulator takes 16
  to 90+ seconds on a cold CI simulator for what a phone does in 1 to 3.
  Prepare budgets went 20s to 45s (a bound ends hangs; it should not race
  slow hardware).
- Run 94 passed the business tour end to end (the grant fix proven where it
  broke) and lost signup to PHPicker swallowing a tap that landed while its
  remote grid was still waking; the subflow re-taps when the sheet visibly
  stayed open.
- Run 95 showed the flows' patience was still wrong: a 60s wait and an
  alert check ten seconds after the pick, against a pipeline whose own
  contract is "landed or alerted within 150s". Both tours now wait that
  budget out on the success signal, recover once through the app's own
  try-again, then gate hard; the drive job got 55 minutes so a slow run
  still publishes its screenshots.
- Run 96: everything green. Production carries the same JS over the air
  (update #62): bounded stages, the stage-named error, the grid's LoadError
  state.

## **The "upload hang" was a read that lied** (2026-08-31)

e2e runs 90 to 92 watched the business photo tile spin and land back on
"0 of 10", five throwaway accounts in a row, and the working theory was a hung
upload — bad enough that run 92 shipped stage-named timeouts to make the next
failure name its own stage. Run 92's pictures then disproved the theory: the
spinner CLEARS, no error shows, and the count stays at zero. The upload and
the insert succeed. It is the read-back that fails.

Root cause, proven against the full migration chain on a shadow database:
`business_photos` is guarded by column-level select grants, and
`20260829180000` added `moderation_attempts` without granting it — Postgres
then refuses `select *` outright, so the grid's read has answered
`permission denied` to the photo's own owner since that migration deployed
(Aug 29, before run 89; run 89 stayed green only because its flow never
checked the photo landed). A failed query renders as its empty state, which
is why three runs of pictures showed "no photos" instead of an error.

Shipped: the one-line grant (`20260831120000`), pgTAP file 31 pinning
`select *` on every table the app star-reads (831 tests across 31 files), a
`LoadError` state on the photo grid so a failed read stops impersonating
"0 of 10", and a `traps` entry for the pattern. The stage-named upload
timeouts stay — an unsettled promise on hostel wifi deserves an error and a
retry regardless of what this particular bug turned out to be.

Production impact, corrected from the earlier caution: uploads were never
broken — profile, chat, verification and business photos all reach storage
and the database. The only user-visible break was the business editor's
photo grid never showing what had landed.

## **Wave 0 is implemented** (2026-08-31)

All 58 Wave 0 packages from [`UX_PLAN.md`](UX_PLAN.md) are in the tree: ten in
the first wave, forty-four across eight batches this weekend, and a handful
found already satisfied by neighbours when their batch reached them. Every
batch went through one implementer, two adversarial reviewers, and the full
gate before its commit; the review pass caught and fixed, among others: a
sign-out that could hang forever on unreachable APNs, a geocode timer that
fired into the open pin form, a congratulations card rendered on the exact
text the server had just refused, a Say hi bar offered where the server would
refuse the hello after it was written, and a tab-return that silently stopped
refreshing expired pins.

Five new migrations carry the database's share (push copy, curated pin notes,
the block-category, tap-routing payload kinds, and a copy-lint gate with an
allowlist whose stale entries fail the build). pgTAP grew to 820 tests across
30 files; jest to 757 across 82 suites.

**Deliberately queued, not done:** the five "request"-noun raise strings
reissued verbatim inside this batch's migrations (rewriting them was outside
every spec; the copy-lint allowlist pins them and its stale-entry test forces
the cleanup when their own package lands).

### Next

1. **Supabase deploy FIRST, the over-the-air update SECOND, and in that order.**
   Seven migrations in the tree plus the `store-apple-token` Edge Function and
   the four `APPLE_*` secrets (docs/APP_STORE.md). The ordering is not a
   preference: `20260901110000_a_message_says_how_urgent.sql` gives
   `submit_support_message` a third, defaulted parameter, which buys the
   old-bundle-against-a-new-database direction only. The new bundle's contact
   form requires the category chip before Send is available, so it ALWAYS
   sends three arguments, and shipping the JS to a project that has not taken
   the migration breaks the app's only route to a human, which is also the
   appeal route for a suspended or closed account. Then the live-backend
   suite: a green functions deploy is not evidence the workers run.
2. The simulator suite for the ~40 pending screenshot re-shoots, then the
   screens gallery for the founder.
3. On-device checks that need a person: build 16's universal-link test, the
   haptics walk, Reduce Motion, AX5 on the smallest screen.
4. **Owed: per-decision automation disclosure in ONE remaining moderation
   push body.** DSA Art. 17(3)(c) asks whether a decision was taken by
   automated means. Four of the five notifications now say so: both photo
   bodies (20260901100000, which also splits the failsafe hold from a rules
   breach) and the warning, pause and closure bodies (20260901130000). The
   fifth, "Message not delivered", lives in `apply_message_verdict` and was
   left alone rather than copied verbatim into a photo migration for the sake
   of one sentence; it belongs with a messaging-copy package. Whether the
   general disclosure in the house rules and the privacy policy satisfies
   17(3)(c) on its own is still a question for the founder's lawyer,
   bracketed in docs/legal/COMMUNITY_GUIDELINES.md.
5. **Owed: a Report action for a group ITSELF.** The whole reporting path is
   per-person (`reports.reported_user_id` is NOT NULL), so a traveler-made
   group can only be reported one message at a time. The house rules, the two
   web pages and the App Store notes now say so and point at Contact us; they
   widen again when `chat-group-page-mute-and-report` lands (see the note in
   its spec).

---

## Current: **The domain went live, and the app now answers for it** (2026-08-30)

`link.samewhere.io` is live on Cloudflare Pages — the subdomain, not the apex,
which stays on Squarespace with the Workspace mail records. The association
file is verified (200, `application/json`, zero redirects, real Team ID), mail
sends from `hello@samewhere.io` through Resend with Google receiving, and the
Supabase reset allowlist holds both spellings of the reset redirect.

Two bugs came out of making it real:

- **Cloudflare rejected both `_redirects` rules at deploy time** — a rewrite
  targeting `/i/index.html` is canonicalised back to `/i/`, re-matches `/i/*`,
  and is dropped as an infinite loop ("Parsed 0 valid redirect rules"). Fixed
  by targeting the directory, plus a real `404.html`; both verified live.
- **Every shared invite was a `samewhere://` scheme link** — dead for the one
  audience an invite exists for, somebody without the app. Invites and the
  lobby QR now use `https://link.samewhere.io/i/<token>`; the association file
  was trimmed to the one pattern the route tree answers (`/i/*` — `/b/*`,
  `/c/*`, `/u/*` and `/reset*` all resolved to +not-found and are dropped, see
  `ARCHITECTURE.md`, "The URL space the app claims"); `src/app/i/[token].tsx`
  answers the path in the app; the paste fallback now digs the token out of a
  whole pasted message and exists for guests, who are the people the invite
  page sends to it; and `parseRecoveryLink` recognises the hosted `/reset`
  spelling so a rerouted recovery token is spent on a reset instead of on
  +not-found.

The App Store ID is filled in across `web/` (id6802889254, read out of App
Store Connect; the store URL 404s until release, which is expected).

### Waiting on the founder

1. **Test build 15 on the phone.** _Superseded the same day, recorded
   2026-09-02:_ Apple refused build 15 at delivery (ITMS-90683, no
   `NSMotionUsageDescription`); build 16 (`c9128c55`, commit `1cbe144`)
   carries the string and is the one on the phone, so the checks below apply
   to build 16. The EAS build shipped (run #58, commit
   7005e31): Apple's CDN was already serving the trimmed association file, the
   App ID gained the Associated Domains capability (the first attempt failed
   at signing without it and burned buildNumber 14), and build 15 was
   submitted to TestFlight. Once it installs: tap
   `https://link.samewhere.io/i/<real token>` from Messages — the app should
   open straight onto the join screen with no Safari — and scan a group QR
   with the Camera app for the same. The full first-install check needs a
   device that has never had the app.
2. **The legal items** stand: no legal entity yet (the forcing function is
   Apple's DSA trader status for EU distribution more than GDPR), and the
   privacy policy's biometric paragraph still needs a lawyer. One of its three
   orange markers is now answerable: the Supabase region is eu-central-1,
   Frankfurt.

---

## Current: **The audit finished, and the plan that comes out of it** (2026-08-30)

The founder asked for the audit to be completed to the last item, and for a plan
they could sign off. Both are done.

### The audit, completed

Seven more lenses were run over the ground a screen-by-screen sweep structurally
misses: language and localisation, form factor and the extremes of Dynamic Type,
the account lifecycle, whether §6's own metrics are measurable at all, photos
from picker to pixel, everything that happens outside the app, and the App Store
first impression. They found three launch blockers no amount of screen-reading
would have surfaced.

**436 findings across 22 reports. 435 verified**, by an adversarial pass whose
only instruction was to refute them: 293 confirmed, 120 corrected in detail, 13
shown to be recorded founder decisions, 9 refuted outright.

The nine refutations are the reason the pass was worth running. The most serious
claimed `featured_traveler` ignores the audience setting and is granted to `anon`,
which would have been a privacy-invariant break. It is false, the design
anticipated exactly that case, and `17_profile_visibility.test.sql:286` already
asserts it. Two of the nine were the audit's own earlier errors.

### The plan

Thirteen subsystem planners merged the survivors into **211 work packages**, each
naming the files it changes, the migration if it needs one, the test that proves
it, and whether it ships over the air or costs a build. 150 findings were
deliberately dropped with a reason recorded.

- **58 packages ship this week over the air with nothing to decide.** 33 are under
  an hour each.
- **6 decisions block the start**, and one of them is a purchase.
- **7 launch blockers** gate submission rather than quality.

[`UX_PLAN.md`](UX_PLAN.md) carries the tiered decisions, the blockers and the
waves. [`UX_PACKAGES.md`](UX_PACKAGES.md) carries every package in full.

### Waiting on the founder

1. **Buy a domain.** This is the big one. `NAMING.md:243` records that
   `samewhere.com` belongs to someone else; `LAUNCH_RUNBOOK.md` step 2 is headed
   "Not done. Founder action, and nothing in the repo can do it." It was deferred
   on 2026-08-29 when it cost one thing. It now gates seven: group invites, the
   lobby QR, laptop password reset, the App Store privacy-policy URL, the App
   Store support URL, business confirmation mail, and a support address for the
   privacy policy. The domain, the Resend DNS records and the
   `apple-app-site-association` file are one errand.
2. **Is a profile photo a square or a 4:5 frame?** `photo-grid.tsx:195-200`
   already concluded "take the square they approved and show it as a square" and
   the display was never changed.
3. **May the database write user-facing copy?** Two banned words and an em dash
   reach an alert today.
4. **Does business analytics reopen, and does the what's-on list?** Both sit in
   §10's deferred bucket rather than its refused one.
5. **Device locale for dates, or English everywhere?** Two date engines currently
   disagree on one screen.
6. ~~**Provision the Apple Developer membership and a Sign in with Apple key**,
   so token revocation on account deletion can be finished.~~ _Answered
   2026-09-04:_ membership is live, the key exists, both secrets are set, and
   Supabase deploy run #105 enabled the provider and synced all four function
   secrets. All that is left is the hand-run at the top of this doc.

Thirty-four further decisions are tiered in the plan with a recommendation each,
and fifteen more have a stated default that proceeds unless overruled.

### Still open, honestly

Nothing in the app changed. This is an audit and a plan, not a diff. The E2E
suite takes 81 screenshots and still photographs none of the first-hello loop:
no composer, no connected notice, no blocked hello, no incoming card. That is a
package in Wave 1, and until it lands the product's own chokepoint is the one
surface nobody has ever reviewed as a picture.

## Current: **The whole app, audited with fresh eyes** (2026-08-30)

The founder asked for a full audit of every part of the app, focused on user
experience and benchmarked against the most popular apps with similar
features. The result is [`UX_AUDIT.md`](UX_AUDIT.md) and an artifact the
founder can read on a phone.

Fifteen auditors: seven read one product area each across every dimension,
six read one dimension each across the whole app, two did nothing but
research reference apps and come back. Every one of them read source AND
opened the 94 screenshots from the last simulator run, because the design
brief says to critique pictures. Then fifteen adversarial verifiers, whose
instructions were to refute what the auditors had written.

**321 findings. All 138 critical and high ones were verified: 94 confirmed,
34 corrected in detail, 7 shown to be recorded founder decisions, 3 refuted
outright.** The refutations and the founder decisions stayed in the table
rather than being deleted, so the record shows what was checked.

### The eight structural themes, by leverage

1. **The map answers "where are some pins", not "what's on tonight".** No
   list anywhere in the app, nothing on a marker carries a date, a pin has a
   date but no _time_, the camera never frames its own pins, and the heatmap
   has never rendered in any of the 94 screenshots (`heat_k` is 3 distinct
   posters per ~550m cell; at seeded density that is met in one cell, in
   Lisbon).
2. **The funnel charges everything up front, then forgets you.** 22 screens
   and ~119 typed characters from cold launch to greeting somebody; joining
   a plan with an account is 2 screens, 3 taps, zero typing. Signup drops
   the pin you tapped, the person you wanted to greet and the city you were
   browsing.
3. **The thread is missing the half of iMessage that handles coming back.**
   No reply, no copy, no unread divider, no restore-position, and the
   long-press overlay does not dim.
4. **Nothing brings anyone back.** A push opens the app and nothing else,
   joining a plan is silent, and all thirteen cron jobs are janitorial.
5. **The business side asks for everything and gives nothing legible back.**
   No proposition on the first screen, a photo gate that forgets the photo
   just added, and no return of any kind.
6. **Safety is enforced in Postgres and never felt.** No settings screen, no
   unblock anywhere, and the four promises that make this app safer than its
   competitors live behind a button labelled "House rules and help".
7. **Two design systems wearing one palette.** `type="title"` renders at
   display size, so the documented 24pt role is unreachable in 19 places,
   and `docs/DESIGN.md` still describes a palette that does not ship.
8. **The app waits where it should feel instant.** Optimistic exactly once,
   and no concept of being offline at all.

Plus the biggest single product opportunity: the map and the chat never
touch, so an app built on "I want to go to X on Y" cannot send X on Y into a
conversation.

### The audit is a document, not a diff

Nothing in the app changed. `UX_AUDIT.md` carries the eight themes, the
counted funnels, a guardrails section listing the fixes that would break a
§7 rule or reverse a recorded founder decision, a suggested sequence, and
the full 321-finding table with evidence and verdict per row.

### Founder decisions the audit is waiting on

- Splitting onboarding so a pin can be dropped before the profile is
  finished. `ONBOARDING.md` records the founder asking for the opposite.
- Lowering `heat_k` so the heatmap can render at all.
- Defaulting the map to Today, and a business to My business.
- Whether "You're top of their list too." stays. The sentence is **true**
  (`daily_spotlights` is a symmetric pair, scored with no appearance input),
  so the only question is whether its grammar sits too close to the
  see-who-liked-you mechanic the brief bans.
- Reopening business analytics, which `BUSINESS_ACCOUNTS.md` §10 defers.

## Current: **The business account, audited surface by surface** (2026-08-30)

The founder tested the app as a business and wrote that the build was
"extremely clunky and completely unacceptable for business users expecting a
tailored experience". Four defects by name, and a demand for a full audit.

Eleven reviewers read every screen a signed-in business can reach, and the
findings were verified adversarially before anything was written. Fifty-five
defects fixed across the map, the chat surfaces, the business's own tabs, the
invite link, and the database.

### The four the founder named

**Deleting the account left the phone signed in.** The server had always done
its job: `delete-account` empties five storage buckets, deletes the chats, the
listing and the auth user. The client fired it without awaiting and never
signed out, and this page sits outside every route guard, so it survived its
own sign-out still showing a deleted business's name. It now awaits the
delete, shows a spinner while it runs, awaits the sign-out and replaces to the
create-an-account screen. The traveler branch had the same three faults.

**A business was offered joins it could never make.** The map's pin card
offered "Join this plan" on any traveler's open pin, and the map's place sheet
offered "Join the chat" and "Message" on every business chip, including the
owner's own. `assert_not_business` refuses all of it in the database, so each
was a button that failed in the app's internal words. The buttons are gone,
and each surface says what it is for instead.

**A business was offered its own chat to join.** Same sheet, same cause: the
sheet never asked whose listing it was drawing. It leads with the owner's own
ringed chip now, and one button into My business.

**A business was asked when it was leaving.** The departure date is
`join_room`'s second argument, so guarding the join removed it everywhere the
room screen shows it. The other door was the group invite link, which is
registered outside every guard: a business tapping one got the whole traveler
flow, "Stay in the group until" and a date picker included.

### What the audit found beyond that

The map was serving a business the identity-carrying traveler feed: names,
ages, faces and verified badges for every discoverable traveler in the city,
plus the roster of up to twenty people on any open plan. That is §7 rule 8
broken in the one place nobody had looked. A business now reads the same
faceless feed a guest does, and `city_pins`, `traveler_trips`, `pin_crew` and
`featured_traveler` return it zero rows regardless.

The Chat tab counted unread messages in the business's own room and then
filtered that room out of the only list it could draw, so the badge pointed at
a screen saying "No chats yet". The owner of a room had no moderation controls
in it, because `my_chats` reads a role off a `groups` row a business room does
not have. "Leave chat" in a customer thread called `unmatch_chat`, which
hard-deletes the conversation for the traveler too.

And a failed `my_business` fetch was read as "not a business", which handed
`owesOnboarding` a false and mounted the TRAVELER onboarding stack: a bar
owner on bad wifi asked for their first name, their age and their photos.

### Verified

Client: **503** unit tests, 50 files. Database: **804** pgTAP assertions, 29
files. Typecheck, lint and format clean. The E2E business tour now relaunches
after registering, which lands on the business tabs, and photographs My
business, the map, chat and the account page for the first time.

### Still open, honestly

`business_staff` is not wired to anything, and when it is, `add-to-group` will
list a business room as a group to add somebody to. The unread count for an
owner's own room falls back to the first message, so a first launch shows a
large number. And the last screens past the photo wall in signup remain
unphotographed while the iOS picker stays flaky in CI.

## Current: **Onboarding, both kinds, and the business bugs** (2026-08-29)

The founder listed four things after trying to list a business, and two of
them were bugs with real root causes.

### The crash after typing the confirmation code

They typed the code, the app died, and on reopening the business was live. The
server half had already committed; the client's last line was the problem.

Registering the business flips `needsProfile` false, and expo-router filters
`onboarding` out of the navigator underneath whichever business screen is
showing — `StackRouter.getStateForRouteNamesChange` only filters routes, it
never inserts the anchor, and `unstable_settings.anchor` applies at
`getInitialState`, not on a routeNames change. So the stack goes to
`[business-email]` with the index clamped to 0. react-native-screens forces
the first screen of a stack to be a push controller **whatever its
stackPresentation**, so a modal landing there is the state its own source
calls "illegally reshuffle presented controllers", and
`router.replace('/(tabs)')` then hands that slot to a group whose layout
mounts a native `UITabBarController` in the same commit.

Fixed at the source: `business-signup` and `business-email` are no longer
modals. They are the only two screens that can legitimately be the sole route
in the root stack, and both are full-screen `StepShell` flows that were never
sheets.

### The code that never arrived

`@wustl.edu` got nothing while a second address did. That is Resend's sandbox
rule: with no verified sending domain, `onboarding@resend.dev` may deliver only
to the Resend account's own address. The mailer has always recorded the refusal
in `outbound_mail.delivery_error` and **nothing had ever read it**, so the
screen went on saying "we sent a code" about mail a provider had already
declined to carry.

`my_business_code_status()` is that read, and the screen titles itself "That
address bounced" and promotes "Use a different address". The code also stops
waiting on the clock: `poke_worker`'s allowlist was missing `support-mailer`
while `invoke_edge_worker` already had it, so a code with a twenty-minute life
could spend five of them waiting for a cron tick.

**Founder action, and the real fix:** verify a domain in Resend and set
`SUPPORT_FROM`. Until then no business but the founder's own can receive a code.
Deferred to go-live by the founder on 2026-08-29 ("I'll verify a domain later
closer to go-live... For now I'll just keep using my own email to test"), and
written down where it will be read at the right moment:
[`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 2, with the DNS records, the
secret to set, and the proof to run.

### Where is it, and who to call

The business location step asked for a city chip and a tap on a map. No
address, ever. `place_label` looks like the place for one and is not — it is
the finding-the-door note travelers read under "Getting there", and an address
would overwrite the more useful of the two. So `businesses.address`, and the
two live side by side, which is the only shape in which the founder's rule
holds: **moving the marker leaves the typed address alone.**

And **there was no geofence on a business at all.** `haversine_km` had exactly
one caller in the schema and it was `validate_pin`; `register_business`
checked the caller and nothing about geography; `businesses.city_id` pointed at
`cities` rather than `launch_cities`. A marker could sit anywhere on earth
while the listing claimed Bangkok — and business-signup carried a comment
saying the server refused exactly that. It does now. The city is also a real
choice: it used to default to whatever the launch-cities query returned first.
_The geofence this added was retired 2026-09-05._

Phone and WhatsApp are contact details now, on the founder's call that they
need no code for the moment. They land as `business_links` rows, off the
critical path: a number the validator refuses must not cost somebody the
listing they just registered.

### Onboarding, rebuilt for both

Signup was seven screens and never mentioned **prompts, top priorities or
trips**. Trips are the worst of the three, because trips are what the matching
runs on: a profile with no trip is invisible to the feature the app exists for.

Thirteen screens now, each asking one thing with a line saying what it is for.
Photos move from last to fifth. Optional steps carry a small "Skip for now" and
the absence of one is how you can tell a step is required. The last step is the
profile itself, rendered by the component a stranger gets and deliberately not
in owner mode — owner mode's edit links point at routes the account cannot
reach yet.

The business flow gets the same treatment and the four steps
`docs/BUSINESS_ACCOUNTS.md` §5 specified and nobody ever built: photos,
description, hours, links, then the listing as a traveler sees it, then the
code. The row is created at the confirm step so everything after it is an
ordinary edit of an existing business, and an `unconfirmed` listing is dark.

### What reading it again found

Three things, before any of it reached a phone:

- **"Where is it?" had a dead end.** Its Continue said `go(3)` where it meant
  `go(5)`, so pressing it sent an owner back to the name screen. The confirm
  step the founder asked for was unreachable and the middle of business signup
  was a loop. `src/app/__tests__/step-flow.test.ts` is the guard now: for every
  step shell in both flows, Continue and Skip move forward and Back moves
  exactly one. It fails on the bug and passes on the fix.
- **A correction after registering was accepted and dropped.** `register`
  short-circuits once the row exists, so walking back to the address step from
  a later one changed nothing. `update_business_location` existed for exactly
  this and nothing had ever called it; it does now, through the SECURITY
  DEFINER door that re-runs the city radius check, because lat, lng and city_id
  have no client UPDATE grant on purpose.
- **The prompt, priority and trip cards were not cards.** Transparent border,
  no background: padding with text in it. They now use the surface every other
  card in the app uses.

### And two flows that had never been photographed

The business path and making a profile. Both run on throwaway accounts, both
stop before writing anything that reaches the map, and the profile one says in
its own header that steps 6 to 13 are held by source assertions rather than
pictures — which is weaker, and worth saying out loud.

Database: **771** pgTAP assertions. Client: **442** unit tests.

## Current: **A plan anyone can join, and the people you already know** (2026-08-29)

Four asks in one message from the founder, three of which turned out to be
the same missing idea: the app knew who you had met and never used it.

### A pin can be open

Until now a pin had one door: read it, say hi, wait to be accepted. That is
the right door for meeting one person and the wrong one for "I'm at this bar
at 9, come along". So the pin form asks how people come along — **Anyone can
join** (the new default) or **Message me first** (exactly what existed) — and
an open pin arrives carrying a group chat. One tap puts you in it.

Four decisions in that, each of which could have gone the other way:

- **The link points from the group at the pin, not the other way round.**
  `groups.pin_id ... on delete set null`. Pins are hard deleted — the 15-minute
  `expire_pins` cron, a poster taking one down, the 72-hour ceiling that is §7
  rule 3 — so a `chat_id` on `pins` would take the conversation with it. The
  founder's call, in their words: the chat lives on, the pin disappears. From
  that moment it is an ordinary group with no end date.
- **The poster keeps the pin.** Joiners are members; the pinner is the group's
  admin and `pins.user_id` never moves. That is what decides who may SEE the
  pin, and it is the founder's other rule: a pin posted by a verified man is on
  the map of everyone whose audience admits a verified man, whoever has since
  joined. There is a pgTAP assertion whose only job is to fail if a later
  change re-keys that to the joiners.
- **Joining borrows the pin's visibility, not the group's.** No token. If you
  can see it you can join it; if you cannot, the id tells you nothing — every
  refusal is the same sentence.
- **Its own daily budget.** `create_group` refuses a sixth group in 24 hours
  because a group row is durable and carries an invite link. An open pin makes
  one too, so it is counted — in its own bucket, with its own sentence, because
  "You have started a few groups today already" is a baffling thing to be told
  by a map.

`city_pins` and `public_city_pins` were DROPped and recreated with `chat_id`
and `crew` (the trap in AGENTS.md; grants restated, `public_city_pins` keeps
anon). An open pin's marker carries a small people badge — a badge and not a
third marker colour, because the map is deliberately two colours and a third
would need a legend. Its sheet shows the faces of whoever is already in.

### People you already know

The other three asks. Adding somebody to a group meant sending a link: leave
the app, find their phone number, paste. Messaging somebody meant saying hi and
waiting, even when you had been talking in the same group all day.

One idea, written down once: **you know somebody if you share an active direct
chat or an active traveler group with them.** Never a venue's open room — that
is open to anybody signed in, so free messaging out of one would be a
stranger-messaging channel with the say-hi gate removed. Never a guest, who can
talk in the group they were let into and nothing else.

Three doors hang off it: `people_you_know` (search), `add_to_group` (any
member, not only the admin — a link was always copyable by everyone, so
"admins only" was never true, just slower), and `open_direct_chat`.

On the client: a member row opens the person now, and so does a face in the
thread. The admin's role and remove tools moved to the button on the right of
the row, where the ellipsis already was. A profile you share a chat with offers
**Message** and **Add to a group**. And a group's page finally has **Leave**,
which it simply did not have — the room screen offers it for a venue's chat and
not for a group, so the only way out of a group was to be removed from one.

### Two §7 rules that needed care, and were kept

**Handles are never visible before an accept.** These chats have no accept
anywhere, and a direct chat with two participant rows is exactly what unlocks
handles. So the gate moved rather than widened: `chats.opened_from_room`, and
the `social_handles` policy now reads `handles_unlocked_for`, which for a
room-opened chat requires **both** people to have spoken. That is stricter than
the single tap it stands in for, and no chat that exists today is affected.
`has_accepted_chat` is deliberately untouched — its six other callers ask "do
these two have a conversation", and the answer to that is yes.

**Every first message passes moderation.** There is no accept step to hold a
bad first message behind, so `open_direct_chat` screens it with
`screen_first_message` and a blocked one creates nothing at all. That is the
shape `message_business` already uses, for the same reason.

### The audience setting is the first thing on a profile

It was a ghost button below the fold, and the map carried a second, weaker copy
of it. "Verified travelers only" is gone from the filters: it narrowed what you
saw without narrowing who saw you, so somebody could tick it, believe they were
hidden, and not be. Signup asks the question outright now, as its own step
before photos (seven steps, not six).

**One honest constraint for the founder to rule on.** `set_visibility` refuses
any narrowed audience without a verified badge, and a brand-new account is
never verified. So the signup step shows the four narrowed rows greyed with the
reason and says the setting lives at the top of the profile once the badge
lands. Relaxing that rule would let an unverified account pick "verified women
only" and be invisible to everyone until it verified — a real choice, not an
oversight, so it stays as it is until asked.

Database: **757** pgTAP assertions. Client: **370** unit tests.

## Current: **Eleven things from a group chat** (2026-08-28)

The founder tested the app while actually using it — texting a group, sending
a link, sending a photo — and came back with eleven things. They are grouped
below by what was really wrong, which is not always what was reported.

### The invite link "crashed", and there was no way out of it

"When I sent the link to someone to join it crashed the first time then worked
the second time."

Nothing threw. A deep link opened from a cold start builds a navigation state
containing ONLY the linked route: no tab bar, no back chevron, and a
`router.back()` that dispatches a GO_BACK no navigator handles — silently.
The second tap came in warm, on an app that already had the tabs mounted, so
it worked. `unstable_settings = { anchor: '(tabs)' }` puts the app underneath
every cold-start link.

Four more on the same screen. Every terminal branch has a marked exit and the
join form has a real Close, all falling through to the map when there is
nothing to go back to — the founder's "they should be able to just view the
app without joining the chat". Typing a name now returns to the invite instead
of pushing a second copy of it over the first, which is why picking one of the
two doors made the other unreachable. Taking "Make a profile" keeps the invite:
the token is parked in the auth store and handed back the moment the tabs mount
with a session, so six screens of onboarding no longer end on a map with no
memory of why you opened the app. And an invite with no token painted a blank
screen forever, because the query never runs and `isPending` never resolves.

### The colour scheme was not the problem

"The 'or create a profile' section had some wording that was a bit hard to read
due to the colour scheme."

Measured every string on that screen: 7.9:1 or better against the ground, and
neither `hairline` nor `textTertiary` appears on it. What made it hard to read
is that it opened with a fragment ("Or make a profile") and then repeated
itself one line down on its own button, under a filled button offering the
other answer. It asks a question now and answers it once.

The contrast defect is real and it is elsewhere. `opacity: 0.4` dims a label
and its ground together, so it cannot lower one without lowering the other. The
filled variant measured 2.35:1 and was fixed by swapping the fill; ghost and
danger kept the fade at **2.28:1** — under the 3:1 floor for a control, on
pills that still looked tappable. Nothing fades now.

### The chat list was a stack of cards

"I want all chats to appear almost exactly as they do when using popular
messaging apps like iMessage... right now the page is confusing and ugly."

Conversations were separate filled cards floating on the canvas with 16pt
between them, which is a layout for a feed of unrelated things. iMessage,
WhatsApp, Telegram and Signal all landed on the same answer and it is the one
that scans: flush rows on one surface, a hairline that starts where the text
starts, a fixed row height. 52pt avatar, text column at x=80, separator inset
to match, both preview lines always reserved. The unread dot moved out of the
text and into a leading gutter, so the list can be scanned for what is waiting
without reading a word of it.

And the `+` means one thing on both segments now. It used to change under the
person's hand — a new group on Groups, the Travelers tab on Chats — so tapping
it in the tab you were reading messages in took you out of Chat entirely.

### A photo and its caption were two messages, in the wrong order

Text is delivered immediately; a photo waits for a moderation verdict. So a
picture captioned "look at this" delivered the caption FIRST and the image some
seconds later, underneath it. One row now, which also means one thing to
unsend, one thing to react to, and one bubble.

The wait itself was drawn as the words "Photo in review" in a text bubble — a
small grey rectangle that then jumped to 220pt square, which is the founder's
"tiny bubble". It is the photo's real frame now, with the picture behind it for
the person who took it, saying "Checking this photo. We check every photo
before it goes out. Usually about 5 seconds."

The tile is keyed off the STATE, not off `image_path`, because a room masks the
path from everybody but the sender: keying off the path drew nothing at all for
the rest of the group, which is the empty bubble people were actually looking
at. `room_messages` answers `photo_state` now.

And nothing was listening for the verdict. It arrives as an UPDATE, and both
realtime subscriptions only watched INSERT — so the screen most likely to be
open while a photo cleared was the one screen that could not notice.

### The five seconds are real, and they were forty

The founder asked for a number and said to work it out. The honest answer at
the time was ~40 seconds, and almost none of it was Claude: a cron firing every
minute means a mean of thirty seconds doing nothing at all, and chat photos
drained third of six queues behind work nobody was waiting on.

So the insert pokes the worker directly now. `worker_pokes` throttles to one
invocation every three seconds, so a room where six people paste photos at once
is still one call, and `poke_worker` swallows its own failures — a photo that
cannot be SENT would be far worse than one that waits for the cron, which stays
as the backstop. The worker drains chat photos first and held hellos second,
and runs those two at low effort; verification, storefronts and impersonation
keep full effort, because those decide who somebody IS and nobody is staring at
a screen while they run.

`admin_moderation_latency` measures queued-to-verdict per queue over seven
days. It is the only thing the app's "usually about N seconds" may be quoted
from, and the 5 is an engineering estimate until there is enough live traffic
to read a p95 off it.

### Sending, Sent

"I'd also like it if in chats it said 'sending' and 'sent' below messages...
so that users can feel more confident if their messages were delivered."

Under the newest of your own messages that landed, and nothing else — the rule
every messaging app follows, and the reason it works. Not under a photo still
being checked: it has not been delivered to anybody yet, and its own tile is
already saying so. Delivered and Read are deliberately NOT built: there is no
recipient-scoped column to hang them on, and read receipts create exactly the
response pressure this app's safety posture is trying not to create.

### Three date chips were not a filter system

"The all, today, tomorrow filters are confusing. You should instead just add a
filters icon that takes users to a different screen and select any type of
filter they want."

They filtered the dimension people ask about least, and there was no way at all
to ask the question they actually have. One button now, with a count on it,
opening four groups: **when** (any day, today, tomorrow, the day after — three
days is the whole universe, a pin expires with the day it is about), **what to
show** (travelers, businesses, Samewhere picks), **kind of plan** (the eight pin
categories; nothing ticked means everything), and **who** (verified travelers
only).

Two judgement calls worth recording. The last marker family cannot be unticked,
because an empty map reads as broken rather than as filtered. And "verified
only" keeps our own picks: nobody stands behind one, so it can neither hold the
badge nor be fairly refused for lacking it, and asking would silently empty a
map somebody only meant to narrow.

It is an inline sheet, so the map answers every tick behind it — which is the
argument against an Apply button, and why there isn't one. Never a pushed
route: a route opened from inside a presented sheet goes under its scrim and
the scrim outlives it, which is the map freeze this app has already paid for.

### And then it was reviewed against itself

Seven more, all found by reading the diff back rather than by anything
failing.

A **poke could have failed the message that fired it.** `poke_worker` claimed
its throttle slot with `on conflict do update`, which takes a row lock, so two
people posting a photo in the same second serialised on one row — on the path
of SENDING A MESSAGE. In practice the wait is microseconds, and "in practice"
is not the standard here: a wait long enough to hit `statement_timeout` raises
`query_canceled`, which plpgsql's `when others` does not catch, so the handler
written precisely to keep a poke harmless would have let it through. A
try-advisory lock removes the wait; losing that race is the same answer the
throttle gives anyway.

**Two more empty bubbles**, the same defect the founder reported on the other
surface. A photo the classifier refuses is emptied and flagged removed; a room
said so and a one-to-one chat said nothing at all, for both people, forever.

**Three sheets could stack on one map.** The header stays live under an inline
sheet, so Filters was reachable with a pin card or a venue stack already open.
It clears them, and is gated on browse mode like everything else — while
somebody is placing a pin, the map is a viewfinder.

**The review tile's words sat on a photograph.** The scrim is not a background
you can measure against: the effective ground is whatever somebody
photographed, and `textSecondary` over a 0.62 veil on a bright picture is
2.5:1. No veil opacity fixes that without hiding the photo the tile exists to
show. The two lines sit on a solid card now.

**The filter sheet could not shrink**, so four groups on a small phone pushed
Done off the bottom of a sheet already at its maximum height.

**Em dashes in three new strings**, which are on the banned list for anything
the app shows. And "Places we put on the map ourselves" sat directly under a
row called Businesses, where "places" is exactly the word the founder asked us
to stop using.

**The invite screen read three clocks** in one render and its exits said "Go
back" on the screen most likely to have nothing to go back to.

### Counts, and what the pictures said

Database: **707** pgTAP assertions across 25 suites. Client: **353** unit
tests across 39 suites. Simulator run **75** green.

The screenshot runs earned their keep twice over. Run 71 showed the fourth
filter group sitting under the pinned Done button and the tab bar — the
robot's tap on it landed on the Travelers TAB, which is how a person would
have missed it too. Run 72 showed the trim had worked and that the last row's
second line was still clipped. Run 73 photographed the filtered map: one
`Filters · 1` pill where three date chips used to be, and a Bangkok showing
only cocktail pins with everything else gone. And run 75 finally photographed
the chat list with a conversation actually IN it — every earlier picture of
that screen was of an empty list, which is the one state the redesign does not
change.

## Current: **Business, not place. And the keyboard.** (2026-08-28)

Three things the founder asked for, all of them about being understood.

### The account kind is a question now

"When I click sign in, it isn't clear how to sign up or sign in as a
business... it should be extra clear when you are creating your profile by
entering your email if you are proceeding with creating an individual or
business account."

It was neither asked nor shown. The only door to a business account was one
line on the last page of the welcome tour, so anybody who reached signup any
other way had no idea the choice existed. That is not just confusing: finishing
traveler onboarding stamps `onboarding_completed_at`, and `register_business`
refuses an account that carries it, so a bar owner who guessed wrong was locked
out of listing for good.

Two rows above the email field, each with a sentence, because "traveler" and
"business" do not by themselves say what you are about to get. The choice
drives the listing flag rather than the submit handler, so Apple carries the
answer too. `autoFocus` came off that field: a keyboard that opens on arrival
scrolls the field into view and the question out of it. Sign in says it covers
both kinds and carries its own door to the business side.

### Every keyboard closes

"Every keypad in the app should be able to be closed without pressing enter."

The second time this has been asked. The first pass made it a judgement per
field, on the reasoning that a return key which ends typing is an exit. It is
not: Return submits, or it jumps to the next field, and somebody who has just
finished typing wants neither. `FormTextField` points at the Done bar by
default now, so a screen gets it by using the app's own field. `Sheet` mounts a
bar of its own, because a sheet presented through a Modal is its own iOS window
and cannot reach the one underneath, which is what stranded the trip editor and
the language picker. The chat and room composers stop being exemptions.

### A business is a business

"I don't think we should refer to businesses as 'places', we should always call
them businesses to keep it consistent and also less confusing."

This reverses a rule the codebase had written down in four places and enforced
across every traveler-facing string. All four are gone, including one sitting
on the map marker that no search for "place" would have found, and the design
brief carries the new rule so the next pass does not restore the old one.

Seventy-odd strings, found by reading every file rather than by find and
replace, which is what kept the route names, enum values, testIDs and the
genuine map-location meanings out of it. "Place the marker on the map" stays:
that is a verb.

Two were more than a swap. The catch-all category read "Somewhere else" under a
heading that now says "What kind of business?", which was the location word
sneaking back in; it is "Something else". And "Places you stay run open chats"
needed a preposition to survive: "Businesses you stay at run open chats".

Five Postgres exception strings reach the screen verbatim by design, so an
alert said "nobody runs this place yet" on every unclaimed listing. Three
functions restated, with the pgTAP and live-canary assertions that quote them
moved in the same commit.

## Current: **The sheet that opened halfway, and eight more** (2026-08-28)

The founder: "When I click the business pins, they don't open all the way
(they only open partially, then I have to close out of them and re-tap on the
pin to open it completely). Please fix this and any other issues you find."

### The sheet

Reanimated's Slide presets animate the view's real LAYOUT — `SlideInDown`
animates `originY`, not `translateY`, which is in `Slide.js` in as many words
— and for as long as one is running the library re-applies the frame it
snapshotted at the start, once per frame, width and height included. A real
layout update lands and is immediately overwritten by
`addOngoingAnimations`; when the spring settles nothing restores it, because
from React Native's side the layout was committed and has not changed.

So a sheet whose content arrives after the tap that opened it stays the size
it was at the tap. The place card's data lands after the tap the first time
and is served from cache the second, which is exactly the founder's "close it
and tap again". It only became visible when the card became a ScrollView in
the last session, because a ScrollView clips — before that the content spilled
out of the frozen frame and off the bottom of the screen, which was the "card
runs off the bottom" the audit had already found. One bug, two faces.

The entrance is a `translateY` in the sheet's own animated style now, so
layout stays React Native's and the sheet grows the instant its content does.
`components/ui/__tests__/sheet.test.ts` keeps the preset from coming back, and
`traps` carries the mechanism. Fade and Zoom are clear of this — they animate
opacity and transform — and a sweep of `src/` found the sheet was the app's
only Slide entrance.

### And the eight the sweep found

Five lenses over the codebase, every finding then handed to a skeptic told to
refute it. Three died there, including two that tried to apply the frame-
freeze above to `FadeInRight`. Nine survived and all nine were confirmed by
hand before anything was changed:

- **The trip calendar swallowed the page and hid its own Save button.** It is
  a fourteen-month vertical ScrollView; inside StepScreen's page scroller it
  took every drag and had nothing to scroll, so Add a trip froze once the
  header scrolled away, and inside the trip editor's sheet its wrapper could
  not shrink, so Save changes was laid out below the bottom edge. You could
  not save a trip from your profile at all.
- **An invite nobody could accept.** With no end date there was nothing to
  default the invitee's stay to, so Join the group was greyed out under a
  picker already showing a date. Every new group has no end date, so that was
  every invite.
- **A radio that set an expiry.** Tapping the already-selected "No end date"
  row in group settings quietly gave the chat thirty days.
- **A place card from the last city.** Switching cities cleared the selected
  pin but not the selected place, so a Bangkok bar stayed parked on the Lisbon
  map with Join the chat still wired to it. Tapping empty basemap missed it too.
- **A pin that posted into thin air.** Drop a pin for tomorrow while the map is
  filtered to today and both the marker and the confirmation card read from the
  filtered list: the sheet closed on a map that looked untouched.
- **WhatsApp and social handles were dead buttons.** A WhatsApp link is stored
  as a phone number — the database insists on it — and became
  `https://+34 600 123 456`, which iOS opens in Safari on a dead host rather
  than erroring. `@yourplace` went the same way.
- **A business saw every traveler as a storefront.** `kind = 'business'` goes
  to both sides and `my_chats` already flips per reader; the client did not.
- **Report fell off the bottom of the long message worth reporting.** Two
  clamps, and the second assigned where it should have clamped.
- **A closed group stopped being readable a week later.** Yesterday's change
  kept the `room_members` row, but every gate asks `expires_at > now()` and
  none asks whether a row exists. `is_room_member` and `my_chats` know what a
  closed group is now; the pgTAP that "covered" this asserted only the half
  that was already true.

### And a second sweep, over the half the first one never lensed

Five more lenses — first run and routing, profiles and the Travelers queue,
chat, sentences the app says that the code does not keep, and the seven hard
rules. Twelve more survived refutation. Three were refuted, including two that
tried to read a documented tradeoff as a defect.

- **Unsending in a group left a blank bubble for everyone.** `room_messages`
  predates unsend and returned neither `unsent_at` nor anything else to mark
  it, so a withdrawn message came back empty with `removed = false` and the
  thread drew a coloured pill with nothing in it, under the sender's name and
  face, still long-pressable and still reactable. The confirmation had just
  said "It disappears for everyone."
- **Mute never reached the phone.** The push trigger's direct arm had no mute
  test at all, and its room arm read a column `authenticated` cannot write.
  The bell struck through, the badge went, and the phone kept ringing.
- **Password reset did not work.** The email points at a route that did not
  exist, so expo-router matched a wildcard outside the root layout and the
  whole recovery branch was dead. People got "Unmatched Route".
- **Editing a trip could save a range nobody entered** — the start moved, the
  old end stayed, and the Travelers queue is joined on exactly those columns.
- **The whole app could disappear** because one background profile refetch
  failed while the cached profile was still in memory.
- **Signing up to list a place landed in traveler onboarding**, the one flow a
  place must never finish.
- **A guest who tapped Apple lost every chat they had made.** The email path
  upgrades the anonymous row; a native Apple token cannot.
- A hello the moderation filter refused deleted that traveler from the queue
  for good; a room promised a week where the database grants three days; two
  hellos in one chat listed the conversation twice; a seventh priority could
  overwrite the sixth.
- **Hard rule 3, closed at the grant.** The 72-hour ceiling is a CHECK
  anchored to `created_at`, and `created_at` was a column a client could
  INSERT — Supabase grants every column by default. A forged one bought a pin
  a month of life and walked past the rate limit, which counts the same
  column. The app never sends it; the anon key ships inside the app, so the
  grant is the control, not the client.

Left alone, deliberately: the heat k-threshold behaviour (documented tradeoff,
three places) and the pin audience predicate (real, no user-visible failure).

Database: **675** pgTAP assertions. Client: **313** unit tests.

## Current: **Chat is active until** (2026-08-27)

The founder asked for a no-end-date option, the rename from "People can stay
until", and copy clarifying that the chat is active through that date and
closes the following day.

The third was not true in three ways — the date capped joiners rather than the
chat, every membership got seven more days of grace, and nothing had ever
closed a group chat — so this is the mechanism rather than the words.
`docs/ARCHITECTURE.md` has the design; the two calls that were the founder's
and were asked before anything was written:

- **A new group starts on "No end date."** Under the old meaning a 30-day
  default was harmless. Under the new one, anybody who made a group and never
  touched that control would have built a conversation that died in a month
  without ever being told.
- **Existing groups keep their dates**, and any already in the past is pushed
  30 days forward, so nothing goes dark on deploy day and no admin's stated cap
  is thrown away.

### What the adversarial pass caught

Three designs, two judges and three attackers, one of whom stood up a real
Postgres 16 cluster rather than reasoning about it. What it found in the
winning design, all fixed before shipping:

- `groups_max_stay_sane` is anchored to `created_at`, so on a group older than
  400 days there is no future date its admin can set — including the one that
  reopens it. The constraint is gone; the ceiling is in the RPCs.
- Adding a defaulted parameter to `update_group` creates an OVERLOAD, and a
  six-argument call then fails with "function is not unique" from every client
  at once.
- "You can still read everything here" would have been true for a week, then
  the sweep would have taken the seat and the conversation with it.
- Reacting borrows `can_send_in_chat`, so it dies with sending — the heart row
  has to go when the composer does, or the refusal arrives as a raw
  row-level-security sentence.
- `'infinity'` reaches the phone as the string `"infinity"`, which is truthy
  and renders "you leave Invalid Date".

### And one bug of my own, found by looking at a screenshot

No place was ever drawn on the map. `displayPriority="low"` on the place marker
is not a layering control — it is MapKit's decluttering priority, defaulting to
`required`, where `low` means "hide whenever this collides with anything
higher". Every traveler pin is higher, and so is every one of Apple's POI
labels, which this map deliberately keeps. Every chip lost every collision.
A decluttered annotation leaves the accessibility tree too, which is why
nothing could tap one either.

Also learned, at the cost of two runs: **a MapKit annotation cannot be
addressed by label from Maestro at all**, for a place or a traveler pin. The
marker's evidence is the screenshot. The flow now asserts the places legend
instead, which renders only when the data arrived at a zoom where markers draw.

## Current: **Places is built and audited** (2026-08-27)

### The final audit, and what it found

Four independent passes over the whole surface before the founder tests it —
copy and voice, layout and contrast, client correctness against the migrations,
and a walk through five user journeys. They converged, which is the useful part:
the same handful of problems came back from passes that could not see each
other's notes.

Every finding that mattered was **silent**. The app did nothing, or it said it
had done something it had not. That is the class of bug a green test suite
cannot see and a screenshot cannot either.

**Dead on arrival, all now fixed:**

- **A business account could not open a single chat.** `chat/[id]` sat behind
  `signedIn && onboarded`, and a business's `onboarding_completed_at` is NULL
  forever by design. A traveler's message reached the owner's Chat tab, the
  owner tapped it, and nothing happened. Ever. The whole inbound feature was
  dead on the receiving end.
- **Message was offered on the four unclaimed launch venues**, where
  `message_business` refuses — after five hundred characters and a Send.
  `business_detail` now returns `claimed`.
- **An `uncertain` storefront verdict was a permanent dead end.** The writer set
  status `uncertain`; its own guard refuses anything not `pending`. Nobody could
  finish it, and the business sat on "someone is looking at these by hand" with
  the retry button taken away. `admin_resolve_business_verification` is the way
  back in.
- **A second message to the same place was thrown away.** The RPC short-circuited
  on the existing chat and never inserted. Success haptic, straight into a thread
  holding only what you said last week.
- **A post could never be taken down**, so three standing notices permanently
  bricked an unverified place's own composer — which then told it to take one
  down.
- **`register_business` never set `display_name`**, so every message a place sent
  was authored by nobody.
- **`report_business` let a business report a rival.** One report emails support
  and queues a Claude impersonation scan, one verdict from darkening a
  competitor. **`is_business_account`** was the one helper with no revoke, so any
  user id could be posted to it. **`website_url`** skipped the validator every
  link row passes.
- **Deleting a place's account left the listing up.** `owner_user_id` is ON
  DELETE SET NULL, so the name, photos, posts, hours, links and chat all outlived
  the account. 5.1.1(v) applies to a business account too.

**Wrong on screen:** the place sheet could run off the bottom with nothing to
scroll; every text field in the app had a 1.24:1 edge while `theme.border`
existed unused and documented for exactly that; chips were 34-40pt against a 44
floor; a place's chat was drawn as a person's, down to signing the cover photo
against the profile bucket and linking to the owner's stub profile; nothing on
the map said what the new markers were.

**Wrong in words:** the storefront screen promised a fifteen-minute rule nothing
enforced (it does now); a post said it appeared in the chat, which nothing does;
"Paused" told an owner they had switched their own listing off when moderation
had taken it down; two em dashes; "a map pin" for a commercial listing, which is
the one word §7 rule 3 needs to keep.

The audits also found the **one door** to listing a place was a ghost button
below the fold on step 3 of traveler signup. There is one on the welcome tour
now, and it carries through signup — finishing traveler onboarding refuses
`register_business` permanently, so dropping somebody there was a trap.

## What was built (2026-08-27)

The founder gave the all clear, and phases 13 to 18 are implemented. What is on
the branch:

- **Phase 13, identity and the rename.** `establishments` is `businesses`, all
  eight dependent functions recreated in the same migration (a function body is
  stored as TEXT and `ALTER TABLE ... RENAME` does not rewrite it, so a bare
  rename fails at runtime with a green deploy). `city_rooms` and `join_room`
  keep their names because shipped iOS builds call them over the wire. §7 rule 8
  is six BEFORE INSERT triggers. Routing gets the guest bug's sequel before it
  happens: a business's `onboarding_completed_at` is null forever by design.
- **Phase 14, the public surface.** Photos, links, hours and posts, all hanging
  off one `is_visible_business` predicate, so a dark listing takes its content
  with it. Posts expire when the business says, including never; the live-post
  cap bounds the surface instead, and an unverified business gets three rather
  than ten. Links are the one chokepoint a URL can enter through, so the scheme
  allowlist lives in that trigger.
- **Phase 15, listing and the badge.** A six-digit code lights the listing up
  and grants no badge. Two live camera shots of the storefront earn the badge.
  Renaming or moving clears it. The first report emails `SUPPORT_INBOX` and
  queues a Claude read of the whole listing.
- **Phase 16, inbound messages.** Straight through on a clean prefilter verdict,
  no accept step, no romance classifier. `kind = 'business'` is what keeps the
  handle gate shut in both directions.
- **Phase 18, ratings.** Buckets, head-to-head comparisons, a score derived from
  where it lands, no text anywhere, public number only past five raters.
- **Phase 17, the business side**, and the traveler screens for all of the
  above.

**643 pgTAP assertions.** The client gate runs on every commit.

### One honest correction, and the fix that followed it

**The selfie screen was not camera-only — now it is.**
`docs/BUSINESS_ACCOUNTS.md` §3.9 claimed the storefront check would enforce
"the same rule the selfie screen already enforces". It did not:
`src/app/verification.tsx` fell back to `launchImageLibraryAsync` on web or
when camera permission was denied, which meant the badge could be earned with
a picture of a face rather than a face. The founder's answer was to close it,
so both screens now capture through `src/lib/live-camera.ts` — camera only, a
refused permission gets an explanation and an Open Settings button, and
`src/lib/__tests__/live-camera.test.ts` scans the source of both screens and
the helper so no future kindness can reopen it.

**`business_chats` is not built.** Decision 12 is one chat per business at v1,
which `businesses.chat_id` already models exactly. The separate table only earns
its place alongside multi-room, which §10 defers. Nothing else in the plan
depended on it.

### What the founder has to do

**Nothing before testing.** `MODERATION_PROMPTS_BUSINESS` is set and synced, so
the storefront and impersonation queues are live. `RESEND_API_KEY` and
`SUPPORT_INBOX` were already set, and the business mail rides the same path the
contact form does.

Two things to know while testing:

1. **A verification photo can never come from the library**, for a person or for
   a place. Both screens go through `src/lib/live-camera.ts` and a
   source-scanning test keeps them there. Refusing the camera gets an
   explanation and an Open Settings button, not a second route.
2. **An `uncertain` storefront verdict now waits for you**, and the founder's
   email says exactly what to run:
   `select public.admin_resolve_business_verification('<request id>', true);`
   (or `false, 'reason'`). Before this it waited forever.

## Planned: **Top priorities on the profile** (2026-08-27)

Founder request, deliberately separate from the business work: up to six very
short things a traveler wants to do out there, listed on the profile. Plan in
**docs/TOP_PRIORITIES.md**.

Why it is worth its own doc rather than another prompt: everything else on a
profile describes a person, trips describe a place and a window, and this is
the only section that describes a **plan**. A plan is the one thing a stranger
can say yes to without having to be charming first, which is why each entry is
a tappable RSVP that opens the composer anchored to it ("Say you're in").

Shape: a `profile_priorities` table modelled on `profile_prompts` (slot 0-5, so
six is enforced by the primary key rather than by client code), 40 characters
per entry, screened by the same classifier the prompts and the bio go through,
visible exactly where the profile is. The editor is one screen where the return
key commits a row and opens the next, so six entries cost six lines of typing
and no taps in between. **One list per profile**, settled by the founder;
adding a nullable `trip_id` later is one migration with no backfill if that
ever changes.

## Planned: **Phase 13-17 — business accounts ("Places")** (2026-08-27)

The founder asked for business accounts: a persistent place on the map with
photos, hours, links, posts, and one open chat anyone can join; inbound DMs
with no matching; three speaking modes; departure+3d / 90d membership; the
whole thing replacing the hostel-room dynamic. The full plan is
**docs/BUSINESS_ACCOUNTS.md** - researched across five lenses, then
adversarially reviewed by three critics whose findings (a departure-date leak
through group_members, anti-scraping refusals with no migration to live in, a
dropped RPC that would break deployed clients' Join button) are folded in.

Headline findings: the chat spec is closer to built than it reads
(room_members already carries roles, departure dates and the expiry sweep;
groups.speaking is two of the three modes); the genuinely new surface is the
business identity, verification against impersonation, and two §7 amendments.

**Revised 2026-08-27** after the founder read the plan. Twelve changes, all
folded in:

- Posts expire when the business says so, including never. No mandatory 30
  days.
- "Run a business? Put it on the map." and the tab is **My business**.
- **Getting listed is a confirmation link, and nothing more** (§3.9). The
  two-path scheme drafted first (domain-matched email, or a code planted on the
  website) is written down as tier 2 of a ladder and deliberately not built.
  The founder's call, and the Google Maps research backs it: Google picks the
  method by risk rather than offering one; video verification is now their
  primary method because it proves physical presence rather than domain
  ownership; email is their weakest and rarest; re-verification triggers on a
  name or address edit; reporting is a structured first-class path feeding
  machine review; and even so, verification takes 5-14 days and there is a
  consultancy industry built on wrongly-suspended listings. Nobody solves this
  at signup.

  Three things came out of that. **There is no verified badge** — a link click
  proves an inbox exists, and a check mark next to it would lend an impersonator
  the app's credibility, so v1 ships the absence of the feature and "verified"
  keeps meaning exactly one thing in this app. **Reports are structured and
  escalate without the founder** — Google's reason list, one voice per account,
  three distinct reporters trigger a Claude read of the reports plus the
  listing, and a plausible impersonation verdict darkens it immediately. And one
  recommended optional addition: **a camera-taken storefront photo with the sign
  in it**, checked by the photo worker that already runs. That is video
  verification's cheapest 20%, and it removes every fake listing made by
  somebody who never leaves their laptop.

- Messages to a business always go through, with no accept step. A business
  cannot open a conversation with a person who has not written first.
- The member list in a business chat is open to everyone in it. It is an app
  for meeting people, and this reverses the earlier decision 18.
- The departure question is a date picker with "I'm not sure", and says plainly
  that you leave the chat three days after that date, or after ninety, and can
  go or come back whenever.
- Only admins can send photos in a business chat, even in the everyone mode.
  Enforced by a trigger, not by hiding the button.
- **Anyone with an account can rate a business, Beli-style** (§3.10). This
  reverses an earlier refusal of mine, and the reason it reverses is specific:
  the extortion lever in reviews is the free text, and Beli's mechanic has
  none. You pick loved / fine / not for me, then answer three or four "which did
  you prefer" comparisons, and the score falls out of where the place lands in
  your own ranked list. No written reviews anywhere. Public number only past
  five raters, mirroring the heatmap's k-threshold, and a business never learns
  who rated it. The founder dropped both gates the draft had: verified-only and
  been-in-the-city. Somebody who stayed there in 2024 has a better-informed
  opinion than somebody who joined the chat yesterday.
  `app_config.ratings_require_verified` is the lever if brigading ever appears,
  one row rather than a migration.
- Category names and the capitalisation kept as proposed.

**Signed off 2026-08-27**: §7 rules 3, 4, 5 and proposed rule 8, all as
recommended, plus the last four decisions (6 agreed; 20 total members with the
"quiet lately" label dropped; 21 agreed; 22 no blockers to rating). Nothing is
blocked. One optional yes or no is outstanding and holds nothing up: the
storefront photo at §3.9 tier 1.5.

Build order is seven phases, 13 through 19, everything over the air. Phase 13
is the rename and the identity and ships with zero visible change; the proof is
that nothing broke.

## Current status: **Phase 12 — the founder's second review batch** (2026-08-23)

### Phase 12 — what the founder asked for after testing on the phone

- **Heart back on the reaction row.** The "no hearts" rule is about the romantic
  vocabulary this app avoids; a tapback is none of those. Both rule docs now carry
  that exception explicitly, scoped to the reaction row and expanded grid.
- **Trip dates are one range calendar.** Tap the day you arrive, tap the day you
  leave, everything between fills in. `src/features/trips/trip-calendar.tsx`, used by
  add-trip and the trip editor. This also retired the picker that rendered near-black
  on near-black; the three remaining native pickers are told `themeVariant` explicitly.
- **The "Sent" row stopped impersonating a chat.** It borrowed the chat row's card,
  avatar and preview whole, so tapping one and landing on a profile read as a bug.
  Outlined instead of filled, smaller, quotes your own words back, has a chevron.
- **Travelers' exhausted state** reads "that's everyone with travel plans matching
  yours" and sits clear of the profile avatar.
- **Demo travelers: 6 → 12, 2 cities → 4.** Each carries a gender, an occupation and
  three prompt answers, and holds four trips instead of one. Rotation by index puts
  three of them in every launch city today (so every city has avatar pins) and
  staggering the later windows gives at least three matches in any city for any trip
  in the next four months. The old single 27-day window was why the tab said nobody
  matched.
- **An invite link opened for nobody.** `group_invite_preview` was granted to signed-in
  users only, so a signed-out tap got 42501 and the client turned a permission error
  into "could not load this invite, try again". The screen already had a branch that
  shows the group and offers an account; it was unreachable behind that one grant.
- **Guests can chat.** Anonymous sign-in, a name, and a long list of refusals. See
  ARCHITECTURE "Guests can chat" for the table of what is blocked where and why, the
  three abuse ceilings, and the daily janitor. Anonymous sign-ins were enabled in the
  dashboard on 2026-08-23 (rate limit 150/hour) and live-backend run 11 proves it:
  40 assertions, 0 failed, including the sign-in itself, the onboarding-stamp refusal,
  the signed-out invite preview, join-and-post, and conversion keeping the room and the
  messages on the same auth row.
- **Three client bugs that no test could have seen.** Every migration assertion and all
  196 unit tests passed while the feature was unusable end to end, because all three
  were in routing rather than in logic. The root gated the tabs on `!signedIn ||
onboarded`, and a guest is signed in and can never be onboarded — the database
  refuses that stamp on purpose — so typing a name unmounted the tabs and dropped
  somebody into an onboarding flow whose last step the server would refuse forever.
  `guest-name` sat inside `signedIn && onboarded`, the one pair of states it is never
  used in, so "Join with a name" pushed a route that was not registered. And the boot
  hold, which unmounts the navigator, went up in the same tick `guest-name` called
  `router.replace(next)`, so a new guest landed on the map instead of the invite. Both
  root decisions are named, tested functions now (`src/features/auth/routing.ts`).
- **A guest could not post in the group they had joined.** The room footer branched on
  `isGuest`, which answers true for a named guest as well as a signed-out visitor, so
  the client refused the one thing the feature exists for. `isGuest && !isMember` now:
  a venue room stays a read-only public front door, a chat somebody was handed a link
  to is theirs to answer.
- **A guest could reach their group exactly once.** Joining took them into the room;
  after that the Chat tab showed the guest view — a line about venue rooms and a
  discovery list — with no chat list in it at all, so the group they had just been
  invited to was unreachable from anywhere in the app. The Groups tab lists their own
  rooms now.
- **And that line is in the database now**, not only in the footer. The anon key ships
  inside the app, so an anonymous sign-in could insert straight into a venue's room. A
  venue room and a traveler group are the same shape and differ by one row — the group
  has a `groups` row — so that is the check.
- **Group threads name their senders**, and somebody with no photo gets their initial
  instead of an empty circle.
- **Nothing user-facing says "hostel"** any more; hostels stay in the App Store keywords
  because they are the expected primary users.
- **The map was too dark to read**, and the cause was two treatments doing the same
  job. `mutedStandard` drops label contrast as well as saturation, and the ink wash
  over it took another third, which put a street name at roughly 2:1 against the
  ground. Now `standard` in a dark interface style (Apple's own night map: legible,
  already navy) with the wash cut from 0.34 to 0.14, doing only the job an overlay is
  good at. The pin picker also draws the wash now: the shared constant covers props,
  the wash is an overlay, and only the map tab had ever drawn one.
- **Who can see you.** Verified-only / verified-men / verified-women / verified-non-binary
  audiences for the map and Travelers, gated on holding the badge, enforced in the
  database. See
  ARCHITECTURE "Who can see you" for the three boundaries it respects and why the
  heatmap is deliberately outside them.

### Phase 12 — the filter, after the founder tested it

Three complaints, one real code defect between them, and a lot of copy that made a
working feature read as a broken one.

- **The map lagged the setting by up to a minute.** `useSetVisibility` invalidated
  `['city-pins']`, which is the WEB pin list; the native map reads
  `['map-pins', cityId, isGuest]`. On a phone the invalidation matched nothing, so the
  map sat on the old audience until its 60-second poll. `useCreatePin` had already paid
  for this exact trap and invalidates both families with a comment saying why. The key
  list now lives in `src/features/profile/discovery-cache.ts` with its own test, because
  the call site is where it went wrong.
- **"Verified only" emptied the Travelers queue, and the screen said "that's everyone".**
  The SQL is correct: nothing in the app can set `profiles.verified` (only
  `apply_verification_verdict`, behind the service role), so an audience is only as
  populated as the by-hand flip makes it. The defect was the empty state asserting a
  supply problem it had not checked. It names the audience now, says the setting cuts
  both ways, and leads with a button back to the picker. The map's empty banner does the
  same.
- **The picker framed the setting one way five times and corrected itself once**, in
  13pt secondary text, last on the screen, inside a `verified` branch that hid it from
  the person deciding whether the badge is worth a selfie. Title, subtitle and all five
  option details now name both directions, and the both-ways note is unconditional.
- **The audience did not reach the signed-out map.** 20260823030000 reasoned about the
  guest case for `featured_traveler` and not for `public_city_pins`, the other function
  granted to `anon`, so a traveler who narrowed to verified was hidden from the queue and
  the signed-in map and still pinned on every logged-out visitor's. That is the one
  direction the setting exists to control. Fixed in 20260823140000.
- **The documented verification SQL was non-deterministic.** `limit 4` with no
  `order by`, over twelve travelers in four cities on four staggered windows, yields
  about one verified traveler per city and a real chance of zero in the city you are
  testing from. It flips all twelve now, and ARCHITECTURE carries the per-city gender
  spread so the gendered audiences are tested where they can pass.

### Phase 12 — founder questions

- **Verifying demo travelers.** Testing the new audiences end to end needs a verified
  demo traveler, and the seed script is anon-key-only on purpose. The SQL to flip a
  few by hand is in ARCHITECTURE under "Who can see you".
- **Gendered audiences and nonbinary travelers — ANSWERED.** The first cut had only
  `verified_men` and `verified_women`, which left nonbinary travelers as the only group
  that could be asked for and never ask. Founder called it: `verified_nonbinary` shipped
  the same day. Non-binary was already a gender option in onboarding and profile
  editing, so nothing was needed there. Anyone on "Rather not say" is still in none of
  the three gendered audiences, and the picker says so.

## Current status: **Phase 11 — the unaudited-areas sweep** (2026-08-21)

### Phase 11 — what nobody had looked at yet

Phase 10 answered the founder's ten-item list. This phase went after the parts
of the app that list never touched: onboarding, profile editing and photos,
trips and matching, accessibility, failure states, security beyond the pgTAP
suite, the data layer, the section 7 rules end-to-end through the client, App
Store shippability, and every user-facing string. Ten areas, audited in
parallel and then adversarially verified.

**Caveat on the verification.** The verifiers ran after most of the fixes had
already landed, so a "refuted" verdict there usually means "the code no longer
does this" rather than "the finding was wrong". Nineteen findings survived as
confirmed. One of them corrected me: I had dismissed a keyboard finding on the
strength of a screenshot of the sign-in screen, and the verifier pointed out
that `(auth)` sets `headerShown: false` while `onboarding` set it `true` — the
same shell, two stacks, only one of them broken.

The things that would have hurt most:

- **Every over-the-air update so far shipped an app pointed at nothing.** The
  TestFlight workflow's update step passed `EXPO_TOKEN` and no Supabase
  variables. Metro inlines `EXPO_PUBLIC_*` at bundle time and that bundling
  happens on the runner, so the published bundle fell back to
  `placeholder.supabase.co`. Builds were unaffected — they read the EAS
  environment named in `eas.json` — which is why this survived. The step now
  requires the secrets, passes them, and proves the bundle before publishing.
- **Posting in a group did nothing.** `useSendMessage` merged into the
  direct-chat cache key; rooms and groups read a different key holding a
  different shape. `useSendPhoto` had always invalidated both.
- **Rooms and groups had no realtime at all.** Two people in the same chat,
  both with it open, never saw each other.
- **Sending a photo in a one-to-one chat always failed.** `push_queue.body` is
  NOT NULL and a photo message has a null body, so the after-insert trigger
  took the message down with it.
- **The composer sat under the keyboard**, from a hardcoded
  `keyboardVerticalOffset` of 90 that is not the height of anything.
- **Removal from a group did not stick** — the same invite link still worked.
- **A group's photo was unreadable by everybody**, including the admin who
  chose it.
- **The three cron workers authorized nobody**, and the anon key ships in the
  app. The first guard was written, deployed, and **reverted the same hour**:
  it took the moderation worker down with it, so first messages were held and
  never released, with every check green. The second one is in and proven; the
  lasting change is that the deploy now POSTs each worker and requires a 401,
  so this class of failure cannot be silent again.
- **The binary asked for location, motion and Face ID**, in Expo's default
  wording, on an app whose whole promise is that it never asks.
- **Failure was reported as emptiness everywhere.** Offline, you were told you
  had no chats, no trips, no travelers, and that a friend's invite was dead.

Also: the privacy policy was describing an app that no longer exists, deleting
an account left every chat photo behind, a reinstall opened with a queue of
old celebrations, and the last em dashes in user-facing copy are gone.

### Still open after this phase

- ~~The cron workers are unauthenticated again~~ — the guard is back and
  verified on both sides. It reads the JWT's `role` claim rather than
  comparing key strings, and is written inline in each function rather than
  imported from `_shared`, which removes both candidate causes of the outage
  instead of picking one. Deploy run 25's smoke step got exactly 401 from all
  three workers using the anon key (alive, and refusing the credential that
  ships in the app), and live-backend run 8 on the same commit passed all
  fourteen assertions including the clean-message release, which is the cron
  path still getting through.

- **The reaction menu never opened, and the menu was never the problem.**
  Two fixes aimed at it (`0a2e28a` moving groups onto the shared thread,
  `c26bdd4` opening before the measurement lands) missed, because the long
  press never reached the bubble at all. The thread's `FlatList` was the only
  scroller in the app without `keyboardShouldPersistTaps`; the default is
  `'never'`, and React Native implements that by claiming the responder in the
  CAPTURE phase whenever a field has focus, so `Pressability` never runs
  `onResponderGrant` and never schedules its long-press timer. On release the
  list blurs the composer. E2E run 34's failure screenshot is that mechanism
  photographed: keyboard gone, thread slid down one keyboard height, no scrim,
  no menu, nothing crashed — and with a real keyboard up, only a list that had
  become the responder can produce that blur.

  It broke identically for a person: send a message, press and hold your own
  bubble, and nothing happens but the keyboard closing. The second press
  works. Same defect swallowed the first tap on a reaction chip, and it was
  live in one-to-one chats too, since both render `MessageThread`.

  Fixed with `keyboardShouldPersistTaps="handled"` (`64ec1b1`). The six
  component tests could never have caught it — `fireEvent` calls the handler
  directly and never enters the responder system — and the file's own comment
  used to claim Maestro could not drive a Pressable, which is false and is
  what excused a real failure once. Both are corrected, and the flow now
  asserts a `message-menu` testID as well as the Dismiss label so the next
  failure says which half broke. Recorded in the `traps` skill.

- **Shipped.** The JavaScript went out as iOS update
  `01a0250e-a712-7f38-ab5b-86d99eeb1702` (group
  `86c5c34b-2b4c-4a65-88b4-9c66ceec4bfc`) from commit `289ef67`, on branch
  `production`, runtime `0.1.0`. The database side went out on Supabase deploy
  run 26, which also proved all three workers alive and refusing the anon key.
  E2E run 38 is the picture of what that update contains.

- **The reaction menu now behaves like Messages.** The scrim was doing
  nothing visible (`rgba(6,7,16,0.62)` over `#0E1020` resolves to `#090A16`),
  so the menu floated over a live thread with the date separator legible
  between the pill and the actions. Darker now, and local to this menu rather
  than a change to `theme.scrim`, which every sheet shares.

  The keyboard also steps aside on the founder's call (`01622f8`). The
  ordering is the trick: the thread stands on a keyboard-sized floor and an
  inverted list is anchored to its own bottom, so every bubble slides DOWN by
  the keyboard's height as that floor collapses. Measuring at the press would
  pin the menu roughly a third of a screen above the message. Dismiss, wait
  for `keyboardDidHide`, two more frames for the floor's Reanimated style to
  commit, then measure. A 400ms failsafe means a press always produces a menu.
  Recorded in `traps`.

- **The contact form now delivers without a key.**
  `20260821150000_support_delivery.sql` adds a second channel: name yourself
  in `app_config.support_notify_recipients` and every incoming message raises
  a push on your phone, addressed so it can be read off the lock screen. One
  statement, and it takes your **email** rather than your user id:

  ```sql
  update public.app_config
     set value = jsonb_build_array('you@example.com')
   where key = 'support_notify_recipients';
  ```

  Email is still the better channel for App Review and still needs
  `RESEND_API_KEY` + `SUPPORT_INBOX` (founder-side). Neither channel can lose
  a message: the row lands first and delivery is only the notification.

- **The Info.plist change needs a build**, not an update. It is native config.
- **Being featured to signed-out visitors has no opt-out.** The policy now
  says so plainly; whether it should exist is a founder decision.
- ~~Rooms and groups send no push notifications~~ — fixed in
  `20260821140000_room_push.sql`. The room is the title and the sender opens
  the body, muting is honoured, and expired or archived members are skipped.

## Phase 10 — the launch-readiness pass (2026-08-21)

### Phase 10 — the founder's ten-item review, and what the screenshots found

Every item from the founder's device testing on 2026-08-20 is addressed.

- [x] **The E2E harness was screenshotting the wrong code.** expo-updates
      applies a downloaded update on the NEXT launch, and Maestro's
      `clearState` deleted the download first, so every reused-binary run
      pictured the binary's embedded JS while reporting green. The workflow
      now publishes with `--json`, primes the update and polls `expo-v2.db`
      for StatusReady, resets state by hand between flows, and FAILS rather
      than falling back. Recorded in the `traps` and `screens` skills. Every
      "verified by screenshots" claim made before this is suspect.
- [x] **Chat, rebuilt around the interaction.** Long press lifts the bubble
      out of a dimmed thread with the emoji row directly above it and the
      actions directly below (it was a slab in the middle of the screen);
      one reaction per person per message, enforced by the primary key;
      unsend, archiving the original first so a report stays reviewable;
      photos wait in a preview until you press send; timestamps moved out of
      the bubbles into separators; sent bubbles use the brand blue as a fill
      under white.
- [x] **Individual / Groups** segmented header; the big "Chat" title is gone.
- [x] **Traveler groups** — anyone can start one, speaking permissions that
      are real permissions, admin removal, invite links with a stay-until
      date capped by the admin's maximum, membership that expires on its own.
- [x] **Pin search suggests as you type**, and the drop-a-pin form fills its
      own location block from the search result, links into Maps, drops the
      activity-type row, and gives the lifetime a 1–72 hour slider. The
      details box no longer traps the keyboard.
- [x] **The map went warm** — amber pins and an amber-to-ember heat scale, so
      it reads on the dark basemap; controls went back to the brand blue.
- [x] **Traveler profile** — photo, then everything the profile says, then
      the rest of the photos, one per row; a reply bubble on every photo and
      every written block opens the composer quoting that specific thing.
- [x] **Languages** — the full ISO 639-1 set, searchable, English pinned.
- [x] **Contact form** replaces the founder's published email address.
- [x] **The map freeze** after viewing a pin's profile (a Sheet's scrim
      surviving a `router.push` out from under it).
- [x] **The traveler counter** is gone.

**Found by the first honest screenshots** (and fixed): sign-in could not be
completed because tapping the password field with the keyboard up does not
move focus on iOS; the sign-in back button said "join"; React Navigation's
DarkTheme left a seam at every header; the segmented control was inside out;
the selected city was nearly invisible; the guest travelers card pushed its
own sign-up card off the screen and rendered an empty photo frame.

**Shipped 2026-08-21.** All three migrations
(`20260820230000_chat_reactions_and_unsend`, `20260821000000_support_messages`,
`20260821010000_traveler_groups`) applied on Supabase deploy run 20, and the
JavaScript went out as iOS update `01a021dc-3e10-7739-a751-7245751b745c`
(group `167d5dae-f8a0-42d0-b2c7-cbc8e6ccab5d`) from commit `5e58d48`.

**Waiting on the founder:**

1. **The contact form needs two repo secrets** to actually email:
   `RESEND_API_KEY` and `SUPPORT_INBOX` (plus `SUPPORT_FROM` once a domain
   is verified). Until they exist, messages still land in the
   `support_messages` table and are readable from the dashboard — the deploy
   skips that step, which is the expected state. The push channel above needs
   nothing but the one SQL statement, so the form can be live before either
   secret exists.
2. **Add a `TEST_EMAIL_BASE` repo secret** (any inbox you can read; the
   suites plus-address it). Hosted Supabase rejects RFC-2606 test domains, so
   the test accounts fall back to a literal address in `tests/live` and
   `e2e/account.mjs` — both workflows now pass the secret when it exists, and
   the literal comes out of the repo the moment it does.
3. **A real support address** is still needed for App Store Connect and the
   privacy policy. Removing the personal one from the repo stops it
   spreading; it does not unpublish it from the history of a public repo.
4. **Visual reviews now cost a build credit.** The simulator on GitHub's
   runners cannot reach `u.expo.dev` (TLS, environment not config), so the
   E2E suite must embed the code under test rather than fetch it. `build`
   defaults to true for that reason; see the `traps` skill.

## Current status: **Phase 9 — the craft pass** (2026-08-19)

### Phase 9 — Research-backed beauty + the founder's fix list

Six parallel research agents surveyed the HIG, award-tier apps, map UX,
motion, color, and the RN engineering of all of it — full synthesis and the
deliberately-deferred ideas list in [`DESIGN.md`](DESIGN.md) ("The craft
pass"). Shipped on top of it:

- [x] **Drop-a-pin rebuilt in place** (founder ask): docked amber action →
      placement mode on the same map — fixed center pin with lift/settle
      springs + haptics, on-device address search (CLGeocoder, no keys, no
      user location), form as a sheet over the map, posted pin drops in
      selected
- [x] **Map pins redesigned** (founder ask): emoji stickers → ringed indigo
      category-glyph markers, amber star for curated seeds; correct Apple
      Maps anchoring (`centerOffset` — `anchor` is Google-only), collision
      priority, camera nudge above the detail sheet
- [x] **Avatar first-tap bug** (founder ask): root causes addressed — glass
      is now decorative-only under touch targets, and press-scale transforms
      moved off the Pressable's hit rect (Fabric hit-tests transformed rects)
- [x] **Press physics + haptic vocabulary everywhere** — PressableScale +
      semantic haptics; spring tokens match the iOS system feel
- [x] **HIG iOS 26 fixes** — untinted glass tab bar, Title Case sections,
      warm ink text, staggered card entrances, brand-indigo splash overlay
      (was template blue), campfire mark on the welcome hero
- [x] **E2E now drives the signed-in app** — throwaway account created and
      onboarded per run, Maestro signs in, drops a real pin through the new
      flow, opens the profile via the avatar, account destroyed after

**Audit outcome (2026-08-19):** live-backend canary 17/17 twice; simulator E2E
walked sign-in → place mode → pan → form → **a real pin posted and refetched
onto the map** → signed-in Travelers → profile via the avatar's FIRST tap.
Screenshots confirmed the indigo tab tint and the amber dock. Two cosmetic
fixes from the screenshots (back chevron said "(tabs)"; PHOTOS → Photos) are
committed but their on-device validation run could not start: the GitHub
Actions minutes ran out. **Decision: the repo goes PUBLIC while building**
(unlimited free standard-runner minutes) and flips private before real users
arrive — runbook step 4 is the gate. Prep is done: the moderation classifier
prompts moved to the `MODERATION_PROMPTS` secret and were redacted from all
git history before publication. The founder adds that GitHub secret, flips
visibility, then the next Supabase deploy re-arms the worker (it fails closed
until then). The one stray test account (an early workflow bug skipped its
teardown) was deleted by the founder on 2026-08-19 — no test data remains
visible to real users.

**The founder's idea batch (2026-08-19)** — all shipped and E2E-validated:

- [x] **First-run tour, now cinematic** — the splash dissolves into an indigo
      welcome scene (the campfire mark never leaves the screen), "Connect.
      Plan. Explore. / Welcome to the Samewhere community." staggers in, and
      "Show me around" starts the tour: the mark glides up into a docked
      emblem while pages parallax underneath, dots and all driven by the live
      scroll offset. Ends in join-or-browse; 'Skip' stays in the corner (the
      E2E flows key off it)
- [x] **Guest profile screen** — the header avatar always lands somewhere real
      now: signed out it invites join/sign-in (root cause: the route lived
      inside the auth guard, so guest taps silently no-oped)
- [x] **Demo travelers** — Actions → **Demo travelers** seeds/purges six
      AI-portrait personas (Lisbon ×3, Bangkok ×3) with pins and overlapping
      trips so Travelers/matching/requests are testable on a phone; `[demo]`
      bios, `DEMO_PASSWORD`-gated sign-in; purge is a runbook step 4 gate
- [x] **Pins wear their poster's face** — signed-in users see the poster's
      photo in the marker (guests get plain glyphs, enforced server-side);
      the pin sheet links to profile and message request
- [x] **One clear signup** — email/password page says it's step one of two,
      then a single profile builder (photos, basics, bio) ends in "Create
      account"; everything editable later
- [x] **Copy pass + the yes moment** — casual, direct copy throughout, em
      dashes gone from app copy; when a message request is accepted, a
      full-screen celebration springs the accepter's photo in with haptics
      and opens the chat ("Connected with {name}")

### Phase 10 — The founder's review batch (2026-08-19)

A full pass on a real device produced thirteen asks, all researched with a
subsystem-by-subsystem map before anything was rewritten. Shipped:

- [x] **Signup is six screens, not two.** Email, then password twice, then
      name/age/gender (a dropdown, no explainer), home and languages, the
      optional bio/occupation/socials, and photos last. One shared shell with
      a springing progress bar and slide-through transitions. **The tour's
      "Make my profile" now opens account creation** — `/email` opened in
      sign-in mode for everyone, so every new user was asked for a password
      they had never set
- [x] **One profile.** Own and other-traveler profiles were two different
      pages; they are now the same component, photo first with the name over
      it, so what you see of yourself is what a stranger sees. Owner gets
      edit affordances on the same page
- [x] **Trips are the headline.** Add, edit and delete them on the profile,
      every planned trip visible to others, and every shared window shown in
      Travelers instead of only the nearest one. Matching looks a season
      ahead rather than a fortnight
- [x] **Travelers is one person at a time** — full profile, say hi or move
      on; skipped people return after a fortnight
- [x] **Optional occupation/school line**, and **socials with real platform
      logos**, an automatic @ where it belongs, and one-tap add
- [x] **The handles bug**: the public profile drew a hardcoded "hidden" card
      and never fetched. It asks now, RLS decides, and accepting invalidates
      the query so the unlock is immediate
- [x] **Chat looks like chat** — grouped bubbles with tails, day separators,
      in-bubble timestamps, long-press reactions. Hostel rooms take your real
      checkout date instead of three preset buttons
- [x] **Drop-a-pin works.** The search field's input was mounted inside a
      native visual-effect view, so it never received a tap; the sheet's
      keyboard lift was unclamped, so the form rode off the top of the
      screen. Pins now carry details and the street they sit on, and "Ask
      about this plan" opens a chat with the question already written
- [x] **Tone.** No more "not a dating app", "keep it platonic", "no
      flirting", or the 3/5/7 ban tally; a first message is a message, not a
      "request"; the celebration says "Connected with {name}" with a "Go to
      chat" button. Push notification copy rewritten to match

**Privacy note for the founder:** making trips visible on profiles is a
deliberate widening — upcoming trips of a discoverable traveler are readable
by any signed-in traveler now, where before you could only see trips that
overlapped your own. Past trips stay private, blocked and hidden accounts
stay invisible, and no live location is involved. A first pass exposed the
whole trips table to a bulk read; that was caught in review and replaced
with a gated call before any client used it.

## Phase 8 complete — Samewhere is on TestFlight, audited end-to-end (2026-08-19)

### Phase 8 — Identity, TestFlight, and Claude's eyes

- [x] **Name: Samewhere** (six rounds, ~950 candidates — [`NAMING.md`](NAMING.md)); slug,
      scheme, and bundle ID (`com.mattmoore.samewhere`) all wired. Apple accepted the app
      record under the name, which doubles as the availability check
- [x] **Dusk palette** — indigo `#2A4C9B` + burnt amber, every pair WCAG-checked
      ([`DESIGN.md`](DESIGN.md)); **campfire mark** (O4) rendered to icon / splash /
      adaptive-icon / in-app brand from `assets/icon-src/`
- [x] **TestFlight pipeline** — Actions → **TestFlight** builds, signs, and submits with
      zero interactive steps; certificates are minted per-build straight from the App
      Store Connect API ([`APP_STORE.md`](APP_STORE.md) has the war stories). **The app
      is live on TestFlight**
- [x] **Claude's eyes: simulator E2E** — Actions → **E2E simulator** builds the app,
      drives it with Maestro on an iOS simulator, and pushes screenshots to the
      `e2e-results` branch, so the agent can see and audit real native pixels
- [x] **Live-backend canary** — anon-key-only integration tests against the production
      Supabase (Actions → **Live backend tests**, weekly + on demand): 17/17 green,
      including a real Claude moderation release (~21 s) and a flirty message that never
      arrived
- [x] **Two real bugs caught by the harnesses**: signups were silently dead-ended by the
      email-confirmation toggle (now off for v1 — see runbook), and the selected tab
      rendered iOS system blue instead of the accent (fixed: `NativeTabs` needed
      `tintColor`)

---

## Phase 7 complete — design overhaul + guest mode + rooms (2026-08-17)

### Phase 7 — Beautiful, frictionless, and room-shaped

Research-backed redesign (sources in [`DESIGN.md`](DESIGN.md)): iOS 26 Liquid
Glass is the native language now, and `expo-glass-effect` ships in our SDK, so
"modern" means native rather than imitated.

- [x] **Design system** — trail-green palette (deliberately unlike every dating
      app), warm canvas, seven-role type scale, 4pt spacing, elevation/motion
      sets, `GlassSurface` primitive with an opaque fallback
- [x] **Three tabs** — Map · Travelers · Chat, with Profile behind the header
      avatar; 9 photo slots per profile
- [x] **Guest mode** — the tabs are the front door for everyone. No account
      needed for the map (curated pins in full, user pins with no identity
      attached), the heat layer, one featured traveler, or reading an
      establishment room. The account is asked for at the moment of action
- [x] **14-day traveler window** — matching opens two weeks before arrival, and
      cards show the whole stay, not just the overlap
- [x] **Establishment rooms** — hostels/hotels run a room; joining asks only
      when you leave; membership ends 7 days after that, capped at 30; staff
      can remove messages and members; pin/mute/archive plus 14-day
      auto-archive (Hinge-style: archived stays readable)
- [x] **Reactions and photo messages** — long-press for quick emoji; chat
      photos go through the same moderation pipeline as profile photos, which
      is not optional in a publicly-readable room
- [x] 36 new database assertions (suite: **268**)
- [x] **Screen-by-screen visual redesign** — map pin detail is a real bottom
      sheet under floating glass controls; traveler cards lead with a 4:5
      photo; the chat list splits into requests / pinned / chats / rooms /
      archived; both profile screens open on a full-bleed hero photo with the
      name set over a gradient scrim, and your own gallery shows empty slots up
      to the six-photo target rather than describing the gap
- [x] **Web preview is honest again** — the web-only tab bar was anchored to
      the top and floating over every screen title (web reports a zero top
      safe-area inset). It now sits at the bottom like the real iOS tab bar,
      and screens reserve room for it

---

## Phase 6 complete (2026-08-17)

### 🎉 The backend is LIVE

The Supabase project exists and is provisioned: all migrations applied (schema + 9,062
cities), `push-worker`, `moderation-worker`, and `delete-account` deployed. Provisioning
runs from GitHub Actions (**Supabase deploy** workflow) because development happens from a
phone — credentials live in GitHub's encrypted secret store, never in the repo or a chat.

**Before real users touch it, do [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 1**: the
moderation pipeline ships _dark_ (photos auto-approve; messages get the regex filter only)
until `ANTHROPIC_API_KEY` is set, both workers are scheduled, and the two `app_config`
flags are flipped.

### Phase 6 — Launch hardening: done

**Database (pgTAP suite now 232 asserts, all green):**

- [x] **Velocity caps** on every hot write path — messages 30/min; requests 30/day; reports
      10/day; trips 20/day; pins 30/day; photos 25/day; blocks 50/day; profile updates
      30/day; plus storage-object ceilings (30 photos / 10 selfies). The Phase 2–5 caps
      bounded _state_; delete-and-recreate churn defeated them, so these bound _rate_
- [x] **Oracle-proof errors**: every relationship failure in `send_message_request` now
      returns one indistinguishable message — distinct errors let a sender detect a block
- [x] **Profile text screening**: `display_name`/`bio` (broadcast to every overlapping
      traveler) now pass the same pre-filter as first messages
- [x] **Admin metrics views** (service-role only): `admin_liquidity` (the liquidity
      number), `admin_request_funnel`, `admin_moderation_stats`, `admin_pin_stats`, and
      `admin_ops_health` — the one-query liveness check for both workers and pg_cron
- [x] Account-deletion cascade proven: profile, photos, trips, pins, requests, tokens, and
      reports all die; the moderation audit spine survives with the subject nulled

**App:**

- [x] **In-app account deletion** (App Review 5.1.1(v)) — Profile → Delete account →
      `delete-account` Edge Function (storage both buckets, chats for both sides, auth user)
- [x] **Guidelines + consent + support contact** (App Review 1.2) — `/guidelines` readable
      before sign-up, consent line on the welcome screen, support mailto
- [x] "Be the first pin" empty state on the map, per city and per date filter
- [x] `eas.json` build profiles, encryption declaration, microphone permission suppressed
- [x] `trip_created` now carries `starts_within_days` so §6's _within-trip-window_
      retention is actually computable

**Docs (the launch-operations set):**

- [x] [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — go-live in order, with rollback levers
- [x] [`APP_STORE.md`](APP_STORE.md) — privacy labels, review notes, TestFlight, EAS env vars
- [x] [`DASHBOARD.md`](DASHBOARD.md) — every §6 metric mapped to a PostHog insight or SQL view
- [x] [`legal/`](legal) — community guidelines + privacy policy drafts (founder review, then legal)
- [x] `supabase/seed/launch_pins.sql` — 20 curated pins across the four launch cities

**Verification:**

- [x] Adversarial launch audit (4 lenses → 23 agents, App Store / abuse / privacy / ops):
      22 findings, 15 confirmed, all fixed. Standouts: the block-detection oracle; unbounded
      storage uploads; profile text bypassing moderation entirely; Edge Functions having no
      static checks; cloud builds shipping with no backend keys
- [x] typecheck, lint, format, 25 Jest, 232 pgTAP, Deno typecheck of all three functions

---

Previous phases below.

## Phase 5 complete (2026-08-17)

### Phase 5 — Trust & safety: done

**Database (pgTAP suite now 209 asserts, all green):**

- [x] **Hard rule 5 completed**: with `require_llm_moderation` on, a first message that
      clears the regex pre-filter is HELD (`pending_moderation` — invisible to the
      recipient, masked as "sent" to the sender, no push) until the Claude classifier's
      verdict; the only exit from the held state is a service-role-only RPC. Fail-closed:
      API outages never deliver an unscreened message (and never strike innocent senders —
      failsafe blocks are non-strike and retryable)
- [x] Server-only `app_config` flags (`require_llm_moderation`, `require_photo_moderation`,
      both default off) keep keyless dev/CI on exact Phase 2–4 behavior
- [x] **Strike ladder** on the `moderation_events` audit spine: 3 strikes → warning push,
      5 → 7-day suspension, 7 → permanent ban; suspensions auto-lift (pg_cron, guarded);
      all transitions audit-logged and pushed
- [x] **Standing gates in Postgres**: suspended/banned accounts refused at
      `send_message_request`, `respond_to_message_request`, chat-message RLS, and
      verification; blocks filed while a message is held sever it, and release re-validates
      the pair (belt and braces — both tested)
- [x] Photo moderation swap-in: flag on → uploads hold at `pending` (owner-only visible)
      for Claude vision review; reject = strike + push; flag off = Phase 1 stub behavior
- [x] Selfie verification: write-only `verification-selfies` bucket (no client reads,
      ever), `submit_verification` RPC (own-folder + object checks, one pending, 3/day),
      Claude-vision likeness verdict → `profiles.verified` badge + server-only evidence.
      Honestly labeled a likeness check, not identity/liveness verification
- [x] **Admin report review queue**: `admin_report_queue` view (status, strike count,
      report totals per reported user) + `admin_resolve_report`
      (dismiss/warn/strike/suspend/ban/shadowban) — service-role only, runtime-guarded
- [x] 75 new pgTAP assertions covering every gate, privilege, and ladder step above

**Edge Function (`supabase/functions/moderation-worker`):**

- [x] Drains all three queues (~1/min schedule): held messages, pending photos, pending
      verifications; `claude-opus-5` with structured outputs (typed allow/block verdicts);
      model refusals treated as blocks; retry bookkeeping with failsafe caps;
      `ANTHROPIC_API_KEY` lives only as a Supabase secret

**App:**

- [x] Account gate screen (suspended-with-date / banned) at the root navigator —
      `users.status` + `suspended_until` are self-readable; DB enforcement is independent
- [x] Get-verified flow: profile-tab entry → selfie capture (front camera, library
      fallback) → write-only upload → status card (in review / rejected reason / verified)
- [x] Photo grid shows "In review" / "Removed" badges from the live moderation status
- [x] Code-review pass: 12 findings, all fixed. Standouts: the strike ladder's
      suspend→lift path could launder a shadowban into a fully active account; a
      shadowbanned sender's released message would have ghost-notified its recipient (now
      full-illusion suppression: "delivered" to the sender, silently declined in the DB);
      the Phase 5 migration would have failed on any already-provisioned database (enum
      value now lands via its own ALTER TYPE migration); admin actions that can't apply
      logged phantom audit events (now raise); verification selfies are deleted from
      storage the moment a verdict lands
- [x] Verified: typecheck, lint, format, 25 Jest tests, 209 pgTAP tests

### Phase 5 deliverable check

"A flirtatious first message from a test account is blocked before delivery and logged":
proven twice over in `08_trust_safety.test.sql` — the pre-filter path blocks instantly
(Phase 2, still tested) and the classifier path holds → blocks → strikes → notifies without
the recipient ever seeing a row. Live end-to-end additionally needs the Supabase project +
`ANTHROPIC_API_KEY` secret + the two flags flipped (see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)).

---

Previous phases below.

### Phase 4 — Chat & realtime: done

**Database (pgTAP suite now 134 asserts, all green):**

- [x] `messages`: member-only RLS, active-chat-only sends, streamed via RLS-filtered
      Supabase Realtime (publication add guarded for keyless environments)
- [x] **Block vs unmatch semantics**: block freezes the chat (history preserved as report
      evidence; unmatch refused on closed chats so an abuser can't delete the record);
      unmatch hard-deletes chat + messages for both (brief §1), request row survives
- [x] `reports` (reason enum + details + context) — insert-only, auto-logged to
      `moderation_events` for the Phase 5 review queue
- [x] Push pipeline: server-only `push_queue` filled by triggers (new request → recipient,
      accept → sender, message → other member), `push_tokens` with shared-device
      reassignment RPC, `push-worker` Edge Function (chunked Expo API delivery, dead-token
      pruning, retry-on-failure) ready to deploy + schedule

**App:**

- [x] Live chat screen: realtime message stream + always-refetch-on-mount (no lost
      messages), composer, first-message context bubble, unlocked-socials strip, closed-
      chat state
- [x] Safety tooling everywhere: chat menu (view profile / report / block / unmatch with
      confirmations), report + block on public profiles, report modal with platonic-app
      reason set ("Flirting / sexual" is front and center)
- [x] Push registration wired post-sign-in (silently skips Expo Go/simulator/pre-EAS;
      never prompts signed-out users)
- [x] Inbox: last-message previews, activity ordering, closed badges
- [x] Verified: typecheck, lint, 25 Jest tests, 134 pgTAP tests, iOS+web export (27 routes)
- [x] Code-review pass: 5 findings, all fixed (incl. unmatch-on-closed evidence deletion
      and a lost-messages cache bug)

### Phase 4 deliverable check

Full loop from either surface to a live conversation: overlap-or-pin → request →
moderation → accept → push → realtime chat → socials unlocked — every hop implemented, the
DB legs proven by tests. Live end-to-end still waits on the Supabase project keys.

---

Previous phases below.

### Phase 3 — The Map (hero feature): done

**Database (pgTAP suite now 98 asserts, all green):**

- [x] `launch_cities` geofence/flag table seeded with Lisbon, Mexico City, Bangkok,
      Denpasar (per-city radius + heat-k; founder toggles `active`)
- [x] `pins`: venue-level future intent. **Hard rule 3 structural**: 72h CHECK + no UPDATE
      grant (immutable) + RLS hiding expired pins from everyone _including the owner_ +
      hard-delete sweep (pg_cron on hosted, guarded locally)
- [x] Geofence trigger (haversine, no PostGIS needed), active-city check, 10-pin cap
- [x] **Hard rule 6 structural**: `heat_cells()` is the only heat path — k distinct pinners
      per ~550m cell or nothing renders; identifier-free output; seeded pins feed the
      cold-start heat
- [x] Seeded pins (admin-inserted, no user attached, `seed_note` for curated events)
- [x] `send_message_request` extended with the `pin` source (recipient must have a live pin)

**App:**

- [x] Native map (react-native-maps/Apple Maps — decision resolved, see ARCHITECTURE):
      city switcher chips, emoji category markers, heat-cell underlay, pin detail card
      (profile + Say hi, or curated note for seeded pins, Remove for own), drop-pin FAB
- [x] Drop-pin modal: venue text, category, intent day, **user-set duration ≤72h**
      (brief §1), tap/drag map placement — no venue-search API needed for v1 (flagged)
- [x] Pin → compose-request flow with `source='pin'`
- [x] §6 metrics: `map_viewed`, `heatmap_rendered`, `pin_created`, `pin_tapped`
- [x] Verified: typecheck, lint, 25 Jest tests, 112 pgTAP tests, iOS+web export (26 routes)
- [x] Adversarial review (rounds for Phases 2 and 3) — all confirmed findings fixed and
      regression-tested. Standouts: a trip-cap bypass via cancel/reactivate that would have
      enabled travel-plan scraping (critical); a heatmap differencing attack that could
      localize a user who blocked you (critical — `heat_cells` is now SECURITY INVOKER, so
      heat can only ever summarize pins the caller's own RLS already shows them, making the
      attack impossible by construction); blocks now sever pending requests and active chats
      instantly; accept-time re-validation; full public-profile view before accept/decline;
      clock-skew-safe pin expiry; coherent intent-date/duration pairing; today/tomorrow heat
      filter on the map

### Phase 3 deliverable check

"The map is compelling with 15 pins on it": the rendering path (markers + heat + cards) is
built and the seeded-pin mechanism exists to guarantee those 15 pins in each launch city on
day one. Actual visual verification on a device needs the Supabase keys + a seeded project
— the seed SQL is one INSERT per curated pin (documented in ARCHITECTURE).

---

Previous phase (2) summary below.

Phases 0 and 1 finished earlier the same day (CI green, incl. the DB RLS job). Phase 1's
adversarial review findings were all fixed and regression-tested before Phase 2 started.

### Phase 2 — Trips & matching: done

**Database (pgTAP suite now 77 asserts, all green):**

- [x] `cities` reference table: 9,062 GeoNames cities (pop ≥50k) bundled as a generated
      seed migration + `search_cities` autocomplete RPC — **no places-API key needed for
      v1** (deviation from brief §5 "places API", rationale in ARCHITECTURE; approve or
      veto)
- [x] `trips` with overlap-gated visibility: travel plans readable only through a real
      city+date overlap; blocks + shadowban + onboarding gates respected; ≤5 active trips
      (anti-scrape); no past trips
- [x] `message_requests` via RPCs only: **moderation pre-filter before delivery** (hard
      rule 5 seam — regex blocklist now, Claude classifier in Phase 5), blocked messages
      never reach recipients and are audit-logged, retry-after-rewrite allowed, one
      delivered request per pair ever
- [x] **Invariant 4 enforced**: senders read outgoing requests only through
      `sent_requests()`, which collapses pending/declined/expired into 'sent' — a decline
      is indistinguishable from silence (tested)
- [x] Accept path creates the chat that unlocks social handles — the full loop
      (overlap → request → moderation → accept → chat → handle reveal) is covered by tests
- [x] `blocks` table live ahead of Phase 4 UI

**App:**

- [x] Travelers tab: trip chips (add/cancel), match cards (photo, verified badge, shared
      window, bio) with per-recipient request state (Say hi / Requested / Open chat)
- [x] Add-trip modal: city autocomplete + native date pickers, client-side mirrors of the
      DB date rules
- [x] Compose-request modal: Hinge-style profile-element anchor + message, moderation-block
      feedback with rewrite guidance
- [x] Inbox: incoming requests with accept/decline → chat; chat list
- [x] Chat shell (`/chat/[id]`): first-message bubble, **socials-unlocked card** proving
      the accept-gate end-to-end, Phase 4 note for live messaging
- [x] PostHog liquidity events (`trip_created`, `request_sent{delivered,blocked}`,
      `request_responded`) — no-op until a key exists
- [x] Verified: typecheck, lint, 19 Jest tests, 77 pgTAP tests, iOS+web export of all 24
      routes

### Phase 2 deliverable check

Two accounts with overlapping trips: request → accept → chat shell — the exact flow is
proven end-to-end at the DB layer by `05_message_requests.test.sql` and implemented in the
UI. Live execution still waits on Supabase keys (below).

### Phase 1 — Auth & profiles: done

**Database (fully tested):**

- [x] Migrations for `users`, `profiles`, `profile_photos`, `social_handles`,
      `moderation_events`, and read-only `chats`/`chat_participants` stubs
      (`supabase/migrations/`)
- [x] **Hard rule 4 enforced in Postgres**: social handles readable only by the owner or a
      user sharing an active accepted chat; unmatch re-hides them
- [x] Server-owned columns (`verified`, `moderation_status`, `users.status`) stripped from
      client grants — self-verification is impossible at the DB layer
- [x] Photo moderation stub trigger (auto-approve + audit log) at the exact chokepoint the
      Phase 5 pipeline will occupy; 7-photo cap; shadowban visibility semantics
- [x] Private `profile-photos` storage bucket with owner-folder write policies
- [x] **43 pgTAP assertions** proving all of the above, runnable anywhere via
      `scripts/db-test.sh` (local Postgres + Supabase shim, no Docker) — wired into CI as a
      second job

**App:**

- [x] Email/password auth + Sign in with Apple flow (Apple needs an EAS dev build + provider
      config; gated off gracefully in Expo Go)
- [x] Encrypted session persistence (keychain AES key + AsyncStorage ciphertext),
      unit-tested
- [x] Route guards: signed-out → welcome/email; signed-in-incomplete → 6-step onboarding
      (resumable; each step saves server-side); complete → tabs
- [x] Onboarding: name/age/gender → home → languages → photos (picker → client resize →
      private bucket upload) → bio → socials
- [x] Profile tab: real profile view (avatar, gallery, languages, bio, verified badge slot,
      locked-socials card) + modal edit screen covering every field
- [x] Verified: typecheck, lint, 15 Jest tests, 43 pgTAP tests, and full iOS+web bundle
      export of all 16 routes
- [x] Adversarial multi-agent review (RLS security, brief compliance, React/Expo, Supabase
      client lenses) — 8 confirmed findings all fixed, incl. a critical relationship-graph
      leak via viewer-parameterized RPC-exposed policy helpers (now caller-scoped +
      regression-tested), client-readable verification evidence (now column-gated), an
      offline dead-end in the route guards (now an error screen with retry/sign-out), and
      silent mutation failures (now surfaced globally)

### Phase 1 deliverable check

Create account → build full profile → view own profile: **implemented and compiling**, but
end-to-end execution needs a real Supabase project (keys below). The DB layer is fully
tested locally; the moment `.env` is filled and migrations are pushed, the flow is live.

## Next: ship it

All six phases are built. What remains is founder-gated, not engineering-gated:

1. **Runbook step 1** — Anthropic key + schedule the workers + flip the two flags, so
   moderation is live before anyone real uses it.
2. **Apple Developer Program** → EAS build → TestFlight (guide written and waiting).
3. **Decide the name**, set the support email, get the legal drafts reviewed.
4. **Open Lisbon only**, seed pins every couple of days, watch `admin_liquidity` toward
   500–1,000 before opening city #2.

## Needs founder input

1. **PostHog key** — §6 metrics ("instrument from day one") are fully wired but no-op
   until `EXPO_PUBLIC_POSTHOG_API_KEY` exists. Create a free PostHog project and drop the
   key in `.env` whenever you want the liquidity dashboard to start filling.
2. **Card-stack deviation** — the brief says "browsable card stack"; v1 ships a scrollable
   card _list_ (each card links to the full profile). A swipe-paged stack is a contained UI
   change on the same data if you want it — say the word. (Hinge itself is a scroll feed;
   the accept-gate mechanics are what matter and are fully implemented.)
3. **Places-API deviation (cheap to veto now)** — v1 city autocomplete uses a bundled
   GeoNames table (9k cities) instead of a paid places API. Zero keys/cost, works offline;
   tradeoff: prefix-only search of city names (no neighborhoods/venues). Phase 3 venue
   search will need its own answer regardless. Say the word if you want Google/Mapbox
   autocomplete instead.
4. **Supabase project (the one real blocker)** — full step-by-step walkthrough now lives
   in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) (~15 min: create project → copy two keys →
   `.env` → `supabase db push` → auth settings → verify).
5. **Anthropic API key + live moderation** — ✅ **DONE 2026-08-18.** Key synced to Edge
   Function secrets; both workers scheduled by pg_cron from
   `20260817230000_schedule_workers.sql`; Vault credentials set via
   `public.set_worker_credentials()`; both `app_config` flags flipped to `true`.
   Verified: `worker_status()` shows 200s on consecutive ticks and
   `admin_ops_health` reads all zeros.

   **Exercised 2026-08-19.** The live-backend canary (Actions → **Live backend tests**,
   `tests/live/live-backend.mjs`, also scheduled weekly) ran the runbook's own check
   against the production project: a clean first message was released by a real Claude
   verdict in ~21 s, a flirty first message was still undelivered after a 4-minute
   watch, and 17/17 checks passed — handle gating pre/post-accept, guest RLS, and
   delete-account teardown included.

   **Email confirmation is OFF for v1.** The canary's first run caught that with
   Supabase's "Confirm email" toggle on, `signUp` returns no session and the app has no
   confirmation deep-link flow — every real signup silently dead-ended. The toggle is
   now off (founder, 2026-08-19). Before public launch: either keep it off knowingly or
   build the deep-linked confirmation flow, then re-enable.

6. **Apple Developer Program** ($99/yr) — needed before Apple Sign-In can be tested
   end-to-end (entitlement + Services ID, then enable the Apple provider in Supabase Auth).
   Email auth works without it. Also unlocks EAS dev builds, push (Phase 4), TestFlight
   (Phase 6).
7. **Bundle identifier** — now `com.mattmoore.samewhere`. Deliberately kept under the
   `com.mattmoore` namespace rather than `com.samewhere.*`, because the convention is to
   use a reverse-domain you actually control and `samewhere.com` belongs to someone else.
   This is the last comfortable moment to change it — it is fixed after the first App
   Store submission.
8. **Working name** — **Samewhere**, chosen after six rounds and ~950 candidates
   ([`NAMING.md`](NAMING.md)). One check is still owed and only the founder can run
   it: an **App Store search** for the name. The sandbox can reach neither the
   iTunes Search API nor RDAP/WHOIS, so no collision check was possible from here.
   Everything is wired up, but treat the name as provisional until that search
   comes back clean — it is cheap to swap now and expensive after submission.
9. **Branch** — everything is on `claude/travel-app-initial-setup-ephphz`; merge to `main`
   via PR whenever you're ready.

## Open technical flags

Note per brief §6 ("instrument from day one"): PostHog wiring is scheduled for Phase 2 with
the first liquidity events (trips/matching) — Phase 1 has no meaningful liquidity events to
record. Flagging the small deferral for your sign-off.

See "Technical flags" in [`ARCHITECTURE.md`](ARCHITECTURE.md). New this phase: selfie
verification shipped as an honestly-labeled Claude-vision likeness check — a certified
liveness vendor stays a deliberate deferral until fraud data justifies the cost; LLM
moderation adds ~1min max delivery latency (worker schedule) while the flag is on.

## Phase ledger

| Phase                 | Status  | Deliverable                                               |
| --------------------- | ------- | --------------------------------------------------------- |
| 0 — Repo & scaffold   | ✅ done | Fresh clone → `npx expo start` works                      |
| 1 — Auth & profiles   | ✅ done | Account + full profile viewable in app (E2E pending keys) |
| 2 — Trips & matching  | ✅ done | Overlap request → accept → chat shell (E2E pending keys)  |
| 3 — The Map (hero)    | ✅ done | Compelling map with 15 pins (seeding path ready)          |
| 4 — Chat & realtime   | ✅ done | Full loop to live conversation (E2E pending keys)         |
| 5 — Trust & safety    | ✅ done | Flirty first message blocked + logged (proven in pgTAP)   |
| 6 — Launch hardening  | ✅ done | Rate limits, deletion, dashboards, runbook, store prep    |
| 7 — Design overhaul   | ✅ done | Guest-first 3-tab app, rooms, photo-forward screens       |
| 8 — Name & TestFlight | ✅ done | Samewhere on TestFlight; E2E + live canary both green     |
| 9 — UX/UI audit build | ✅ done | All 43 audit findings implemented (see below)             |

## Phase 9 — the UX/UI audit build

Ten researchers looked at the app against Hinge, Raya, Tinder and Bumble and came
back with 43 findings: a top ten, 21 quick wins and 12 bigger bets. All 43 are in.

**The ten that mattered most.** An unread nervous system (`last_read_at`,
`my_chats.unread_count`, row dots, tab badge, mark-read on open and on receipt);
the Travelers hero repaired (the photo was being SHRUNK by the name under it);
the say-hi loop closed (confirmation, queue advances, a "You said hi" section);
Apple Sign-In and the consent line rescued from an orphaned welcome screen;
push-permission priming instead of an ambush at signup; a featured traveler with
a profile worth teasing; password recovery that recovers; a heat layer that merges,
glows and explains itself; a non-modal pin card over a live map; and your own
profile reachable from every tab.

**The bigger bets.** Travel prompts with reply chips (`profile_prompts`); the
daily mutual spotlight (`daily_spotlight`, symmetric score, no appearance
input); an optimistic composer with a real delivery ladder; avatar-stack
markers for same-venue pins; verification surfaced where trust is spent; a
daily first-message cap (safety limit, **never** a tier — §7 rule 1); exhausted
states that create supply; two-sided moderation softening; invite QR codes;
pinned messages; run-final avatars; and skeletons on the two cold lists.

Database: six migrations, 417 pgTAP assertions (up from 351). Client: 141 unit
tests (up from 75).

### And then the pictures found the one that mattered

The simulator run after all of that posted a pin and stopped responding.

Three screenshots — the confirmation card, the next tab, and the failure
shot — came back BYTE-IDENTICAL. Between them the driver tapped Close,
Travelers, Map and the profile avatar; Maestro found every one of those
elements in the tree and reported all four taps as successful. Nothing moved.
The last frame, a minute later, is the same frame with a different clock. The
run only failed four steps afterwards, on a name that was never going to
appear.

Posting a pin unmounts the pin form, which is a Sheet and therefore a native
Modal. In the same tick `useCreatePin.onSuccess` asks the push primer to
appear, which mounts a second Modal while the first is still dismissing. iOS
drops that presentation — the trap `traps` already carried, and the map
already works around for its own card with a 450ms delay. What `traps` did
NOT say, and now does, is what a dropped presentation costs on Fabric: the
`ModalHostView` is laid out full screen, mounts its children into the modal's
own view controller rather than into itself, overrides no `hitTest`, and so
returns itself for every point on the screen. An invisible, full-screen touch
sink, permanent, because RN marks itself presented before presenting and only
retries on a re-parent.

Proven by bisect: the run before the primer existed completed this flow; the
run after it dies on the first four taps.

**What is NOT proven is that it would have hit the founder's phone.** An
adversarial pass refuted that half, correctly. The device path serialises a
real `getNotificationSettingsWithCompletionHandler:` round trip that the
simulator short-circuits, and that hop is in the one variable a sub-frame
race turns on — the phone might lose it too, or might simply show the sheet.
Every artifact here is a simulator. The fix is pure JS with no
`Device.isDevice` in it, so it behaves the same either way.

The primer is the only thing in the app that presents a sheet on a schedule
of its own rather than because somebody tapped something, which is why it is
the only thing that has to ask whether the screen is free. It waits on three
facts now: the tabs focused, no sheet registered, and a settle delay, because
unmounted in React and gone from the screen are not the same fact. Six
component tests; two of them fail against the code they replace.

The suite would have slept through it again, too. A tap that is allowed to do
nothing is how a frozen app passes as a working one, so the flow now proves
the first tap out of the pin card landed — by the card's own headline going
away, not by "Drop a pin" (also the Travelers empty state's button) or
"Travelers" (the tab's own label), both of which are true either way.

**One audit item does less than it says on the tin, and this is where that is
written down.** The featured traveler now has to have an approved first photo
before the server will surface them. The intent was a face on the guest
teaser; the face cannot arrive. The photos bucket is private and its only
SELECT policy is `to authenticated`, so a signed-out device is refused the
image whatever the card asks, and `featured_traveler` has no signed-in caller
to pay the requirement off elsewhere. Widening the bucket to `anon` would hand
every primary photo in the app to anybody holding the public key, which is not
a trade to make for a teaser — so the requirement stays (it still selects
somebody who bothered to add a photo, which is a decent proxy for a profile
worth showing) and the card leads with a monogram instead of an empty frame.
Revisit only if the founder decides a stranger's face may be seen without an
account.

**Deferred, and the only thing that is.** BB11's "Copy" in the message
long-press menu needs `expo-clipboard`, which is a native module and therefore
an EAS build. The other half of that item — the blurred menu backdrop — turned
out not to need a build at all, because `expo-glass-effect` already ships in
the binary. Batch Copy with the next native change.

**Also fixed on the way past:** CI had been failing every run since the
component tests landed, on three undeclared dependencies
(`@testing-library/react-native`, `react-test-renderer`,
`@react-native/jest-preset`) that this sandbox happened to have installed. And
the lint step was `npx expo lint -- --max-warnings 0`, which exits 2 with
"Value for 'max-warnings' of type 'Int' required" — a step that could only ever
fail, hidden behind a typecheck that was already failing.

### Then the build was reviewed against itself

Six review dimensions over the whole diff, every finding handed to a verifier
told to refute it and to default to "not real". Twenty survived. The four that
matter, all reproduced on a real Postgres before they were believed:

- **The spotlight reached past a block.** `daily_spotlight()` is SECURITY
  DEFINER and calls `get_matches()`, which is SECURITY INVOKER and does none of
  its own filtering — the account status, the onboarding check, the block check
  and the trip status all live in the `trips_select_overlap` POLICY, and a
  definer does not run policies. It handed a blocked person's name, age, bio,
  occupation, languages and photo to the person they blocked. Every filter is
  restated inside the function now, in both the scan and the read-back.
- **The pairing could be raced.** Two unique indexes cannot express "one
  spotlight per person per day": a user may be `user_a` in one row and `user_b`
  in another, so the `unique_violation` the function catches is never raised.
  A per-day advisory lock, and a re-read under it.
- **The daily cap counted and then inserted**, while every other counted cap in
  the schema takes `pg_advisory_xact_lock` first.
- **A dead pin held its slot.** `pin_message` counted the table; `room_pins`
  reads the join. Unsending a pinned message left a slot nothing could free.

And on the client, the one worth naming: a failed send lives only in the query
cache, and the thread refetches on every realtime insert — so the greyed "Not
sent" bubble, and the sentence inside it, were deleted by the next message
anybody else posted. Failed rows survive a refetch now.

The rest: two divergent implementations of "what this hello was a reply to",
neither knowing about the prompts added in the same build; an anti-flirting
lecture the project's own design brief bans by name; a verified badge dead to
touch on every profile with a photo; a reaction grid positioned as though it
were the row it replaces, growing 152pt down over the Report button; a
confirmation timer that popped the screen underneath; the push primer
presented from beneath a modal iOS had not dismissed, which iOS silently
drops; a real traveler's display name shipped to analytics from a signed-out
screen; "1 hellos left today"; and a red **0** on the Chat tab, permanently,
for every account with nothing waiting — expo-router's `Badge` reads
`children` before it consults `hidden`.

Database after the fixes: **428** pgTAP assertions. Client: **162** unit
tests.

### Then the build was reviewed as pictures

Run 44 was the first fully green simulator run: 27 screenshots, all distinct,
and `16-pin-posted` finally different from `17-travelers-signed-in`, which is
the proof that the post-pin freeze is gone. Every screen was then opened as an
image rather than read as an exit code, and four things that no test could see
turned up. All four are the same failure — a control or a sentence that a
human eye cannot read, on a screen the checks call passing.

- **The reaction menu did not dim anything.** The scrim was painted only when
  liquid glass was unavailable, so on any OS that has it the menu floated over
  a thread at full brightness — the composer legible right beside it. Glass
  alone over a dark ground dims nothing. And every action label took
  `theme.danger`, so "Pin to the top" was the same destructive red as
  "Unsend". This is the founder's #1 complaint area and it had regressed
  behind a passing test.
- **"Both there Aug 23 - 28" was half dissolved.** The fade under the Say hi
  bar was given `ACTION_BAR_CLEARANCE`, 30pt taller than the bar it protects,
  so it began a line and a half above the buttons and ate whatever was there.
  On a one-trip traveler that is exactly the overlap window: the one fact that
  explains why this person is on your screen. Scrolling recovered it and
  nothing said to scroll. The band is now the bar's own height plus a ramp,
  and the window is also said in the hero beside the name, where no screen
  size and no text size can push it under anything.
- **The X that leaves place mode was invisible.** `variant="clear"` glass over
  a traveler's avatar pin: both strokes cut off halfway down, on the only
  control that leaves the mode. Regular glass with a hairline ring.

The general lesson, and it is now in the `screens` skill: a green E2E run
means the flow completed, not that a person could have completed it. Three of
these four shipped under a full green gate.

Client after the fixes: **172** unit tests.

## Phase 10 — the founder's audit: an empty map, Raya, and fewer words

Three asks: audit everything against the research, make the map look like
Raya's, and cut the words back everywhere. A twelve-agent fan-out read the
map end to end, re-verified all 43 findings against the code, swept every
user-facing string and walked every empty/loading/error state; 203 findings,
each survivor put to an adversarial refuter told to default to "not real".
Forty-two were rejected because they had already been fixed hours earlier in
the same session.

### The map was empty, and nothing was broken

`seed_launch_pins()` puts twenty curated pins across the four launch cities,
and its own header says "Re-run every couple of days during launch". Nobody
did. Seeded pins expire in 48h because rule 3 caps every pin at 72h, so two
days after that migration deployed the map went back to "be the first to drop
a pin" and stayed there. A comment asking a human to remember something every
48 hours is not a mechanism; it is on pg_cron now, beside the four workers
that already run that way.

Then the same function was letting its plans rot: the guard skips any venue
that still has a LIVE seeded pin, so on day two every venue is skipped and
yesterday's `intent_date` survives. The pins stayed on the map and the Today
and Tomorrow chips — the brief's own hook — went empty, because they match
that column exactly. And the client compared it against the phone's LOCAL
calendar day while the seed writes Postgres's UTC `current_date`, which for a
travel app means the normal case is comparing one clock against another.

**Heat had never rendered once, in any run, and the reason was in the SQL.**
The k-threshold was applied per (cell, CATEGORY): three people had to be
planning the same KIND of thing inside the same 550m square. Three people
planning three different things IS a busy corner. Grouping by cell alone is
also the safer version — the bucket gets larger and the row carries one fewer
attribute about the people in it, which moves away from rule 6, not toward
it.

### The Raya look was three props and an overlay

`mapType="mutedStandard"` is MapKit's own "somebody else's data on top" style.
`showsPointsOfInterests={false}` — the plural; the singular is not a prop —
kills the venue pills. Both were nearly wasted: on iOS 16+ the POI prop writes
a `pointOfInterestFilter` onto `preferredConfiguration`, and `mapType` is
written to the same state twenty-five lines LATER in the same props pass and
installs a fresh default configuration, discarding the filter. Both change
together on mount, neither changes again, and the native remap is guarded on
old != new, so nothing re-applies it. It flips on `onMapReady` now, one commit
later. The drop-a-pin picker had no treatment at all, which matters more than
the main map rather than less: it sits at venue zoom, exactly where Apple
draws bright pills for restaurants and bars.

What no prop can remove is labels, roads and water. An overlay can, and it is
the right lever: MapKit draws every overlay BENEATH every annotation, so a
polygon wash dims the cartography and leaves the faces, the heat and the
curated stars exactly as bright as they were.

### Two rules the app had quietly broken

The **match ceremony** had crept in — it is on three of the four do-not-copy
lists. A full-screen takeover over every tab: the brand field, a 168pt photo
springing in behind an amber ring, a glow breathing on an infinite repeat with
no reduce-motion check, and a verification upsell riding along. The words were
always right ("Connected with {name}", "Go to chat"); the presentation was the
banned thing. It is a card at the bottom of the current screen now.

And the **heart** led the reaction row, against "no hearts" in DESIGN.md
principle 5 and in the design brief in as many words. On a dimmed thread it
was the brightest, most saturated element on screen. A wave replaces it; it
stays in the expanded grid. Flagged to the founder as reversible in one line,
since a heart tapback is also ordinary iMessage grammar.

### The faceless featured traveler was not unfixable

Top 6 is "never ship a faceless featured traveler", and the previous session
recorded it as impossible: the photos bucket is private, its only SELECT
policy is `to authenticated`, and widening it to anon would hand every primary
photo in the app to anybody holding the public key. The way through is an
Edge Function that takes a CITY — not a path, not a user id — picks the person
by calling the same function the card calls, and signs that one photo for five
minutes. Nothing to walk, no policy widened. The card leads with a 3:2 hero
now, verified against the live backend.

### Five screens that could not say what was happening

A signed-out visitor could read a hostel room forever with no way to join one
(`useMyChats` is disabled without a user id, so the guest branch sat behind a
query that never leaves `isPending`). Archiving a conversation made it
unreadable, and an archived room offered to let you join a room you are
already in. The guest Travelers tab was permanently blank whenever the city
list failed. And the Chat tab painted "No chats yet" under its own loading
skeletons and under "You said hi — Sent".

Plus roughly a hundred strings shortened, and two dev-phase badges that were
being shown to real users in a code font.

Database: **429** pgTAP assertions. Client: **178** unit tests. Run 51 green
end to end, 32 screenshots, all distinct.

### Still open, honestly

`bb2` (anchored opener as the DEFAULT path), `bb4` (owner-mode completeness
dashboard), `bb7`/`bb9`/`bb10`, per-pin audience, a tap target on the heat
layer, timestamps-on-demand and a typing indicator all remain partial — they
were confirmed by the refuters and are not done. `bb11`'s Copy action still
needs `expo-clipboard`, which is a native build.

### Two decisions taken without the founder, and one thing that cannot ship yet

**D17 was overridden.** The recorded recommendation was "no setting" for who
can add you to a group. The setting was built anyway, and UX_PLAN's D17 row now
says so rather than reading as though the plan had been followed. The reasoning:
a per-user control is the only version matching the consent-before-exposure
grammar the rest of the product keeps, and `visibility.tsx` IS the privacy
screen, so a second row there is where somebody looks for it. It is enforced in
the database (`profiles.group_adds`, `set_group_adds`, and a guard inside
`add_to_group`), never client-side. The link half of D17 was taken as written:
any member may mint the invite link, the admin keeps the kill switch, and a
guest member is refused — the same refusal `add_to_group` already makes one RPC
over, now proven in pgTAP.

**D38's email half shipped early**, on the reading that its stated condition
(the sending domain) has since been met. Recorded in ONBOARDING.md 6a with the
evidence, so the decision list is not quietly rewritten.

**A business still has no listing to share, and that is the one thing
`chat-business-room-has-a-next-action` could not close.** The group invite works
because `/i/<token>` is a real hosted page with a store fallback; there is no
equivalent page for a place, and `is_room_moderator` covers establishments and
their staff rather than businesses, so a business owner cannot mint a room
invite either. A custom-scheme link is dead for anybody who does not already
have the app, which is every person a hostel is trying to reach. So the empty
owner room now ends on the action the owner actually holds — "Say what's on
tonight", which is what earns the brighter marker `city_businesses.has_live_post`
draws — and the share half waits on a hosted page for a listing. Founder
question: is that page worth building, and on which domain?

## Phase 11 — Wave 1 of the UX plan

### The Business batch, and the crash that was finally answered

Eleven packages landed together (`c1e481d`). The signup half moved the photo
grid out of the 1,500-line editor into one shared component and mounted it
inside step 7, which had been a headline over 1,000pt of black; Continue now
counts the photo the OWNER can see rather than only an approved one, so an
owner whose cover is in review is no longer told "one photo is the only thing
we need here" by a screen already showing their photo. The progress track
gained a role, a value and a spoken "Step N of M". The email is asked for with
its consequence named where it is asked, and the code can be typed from any
later step. A new step 3 says what a listing gets you before the form starts.

The owner's tab got the thing it never had: something that came back from the
world. "How it's going" is one sentence built from two numbers already on the
screen. It counts CONVERSATIONS, never senders, and names nobody — the rating
block one section below is the anti-retaliation control, and a leak from next
door would undo it. Your details is reordered by what each row does to the
listing, every empty value says what filling it buys instead of four identical
"Nothing yet"s, and "3 of 5 done" gives the list an end. Share your page offers
the link and a QR for the counter.

**The business-tour crash is answered.** Three fixes had failed. The cause was
that `(tabs)` stays mounted underneath `business-signup`, so `BusinessLanding`'s
navigate ran from a route below the focused one and expo-router's StackRouter
appended a second `(tabs)` rather than replacing. All four navigating handoffs
are now gated on `useIsFocused`. The evidence is the run itself: the tour drove
deep into signup — name, address, marker, confirm, contact, photos — which it
could not do at all while crashing at the door.

### Three e2e failures that were not the app

Run 97 went red in six flows, and none of it was app behaviour.

**One system alert cost four flows.** `invite-first-launch` opens
`samewhere://join-group/...` against a stopped app; iOS answers with "Open in
Samewhere?". That is a SYSTEM alert — not in the app's view hierarchy, and it
outlives `stopApp`. Nothing tapped it, so that flow failed and then
`large-text-tour`, `onboarding-tour` and `signed-in-tour` each failed on their
first assertion, in alphabetical order, with the intro tour plainly visible
behind the dialog in every failure screenshot. Worth recording as a class: a
flow that opens a custom-scheme link poisons every flow that runs after it.

**A bound set inside its own tolerance.** The photo stage was capped at 45s
next to a comment describing the case it covers as "16-60s on a cold CI
simulator". It failed exactly as that arithmetic predicts, twice. Now 90s, and
the two stages no longer share the word "preparing it", so the next failure
screenshot says whether the render or the JPEG encode stalled.

**The same misdirection, one step further along.** `guest-tour` tapped the
business post, warned past an OPTIONAL wait for the sheet, warned past an
optional scroll, and went red on a missing 'Website' — reporting a missing link
when the sheet was what was missing. That is the exact failure the paragraph
standing above it already described; only the first of four steps had been made
hard. All of them are hard now, with a budget the machine can meet.

### Still open, honestly

Whether the business sheet's "See the whole page" was slow or genuinely absent
is not yet settled — 10s could not tell those apart, and 30s will. The photo
pipeline's real timing on CI is likewise unmeasured; the raised bound ends the
symptom without proving which stage was slow, and the split stage names exist
to answer that on the next failure rather than to claim it is answered now.

## Wave 2 backend: four migrations, and the order they have to be deployed in

Four migrations are in the tree and **not yet deployed**: 20260902230000 (`trips.approximate`
plus a rebuilt `traveler_trips()` and a narrowed `push_trip_starts_tomorrow()`),
20260902240000 (`meet_answer`, `chat_meet_answers`, `meet_prompt_due()`,
`answer_meet_prompt()`, `admin_meet_answers`), 20260902250000 (`my_report_status()`,
`my_support_messages()`) and 20260902260000 (`featured_traveler()` returning three).
`docs/ARCHITECTURE.md` carries what each one is for and why it is shaped the way it is;
this is the status and the open questions.

**Deploy order does not matter, and that is deliberate.** `supabase-deploy` and `testflight`
are independent `workflow_dispatch` jobs with no `needs:` between them, so an over-the-air
update can land on the founder's phone before the migrations apply. Every read added in this
change was written for that window (`FeaturedTravelerRow.approximate` is optional,
`useFeaturedPhoto` accepts both row shapes, `useMeetPromptDue` carries `retry: false`), and
the trip WRITE path now matches:

- `createTrip` omits `approximate` entirely when it is false. False is the column's own
  default, so the row written is identical either way, and the key is the difference between
  an ordinary trip posting and PostgREST answering PGRST204 and refusing the whole insert.
- `updateTrip` still SENDS false — omitting it always would leave a rough trip unfixable,
  since an absent field is dropped — and retries once without it on PGRST204. A project with
  no column has no rough trips in it, so false is what a re-read would say anyway.
- A `true` is sent in both writers and is allowed to FAIL against a database with no column.
  Storing a guessed window as an exact one would print it as a fact on a stranger's screen,
  which is the sentence 20260902230000 exists to stop. The person tries again after the
  deploy; nobody is told a date that was never entered.

`src/features/trips/__tests__/a-trip-survives-the-deploy-window.test.ts` holds all four cases.

### Still open, honestly

**The overlap sentence still states exact days.** "Both in Lisbon Sep 3 – 8" is printed on
three surfaces from three sources, and only one of them (the profile, through `ProfileTrip`)
knows whether the window is a guess. `get_matches()` was left without the column on purpose,
because whether a rough trip matches at full weight, is de-ranked, or is excluded is the
founder question recorded on prof-rough-trip-dates in `docs/UX_PACKAGES.md` and it decides
how wide a rough window's read access to other people's trips is. Hedging the one surface
that can would put the same pair of people in front of two different sentences about their
own dates, which is the drift `features/matching/overlap` exists to close — and even that
surface knows only half, because the window is an intersection and the READER's own trip may
be the rough one. Hedge all three at once, after the founder question is answered.

**A rough trip's read access is unchanged.** Until that same question is answered,
`overlaps_own_trip()` and the `trips_select_overlap` policy treat a rough window exactly like
an exact one. A 90-day guess therefore reads as wide a slice of other people's trips as a
90-day plan. That is today's behaviour and not a regression, but it is the thing the answer
changes.

## What Wave 2 did NOT build: the App Store review prompt

_Superseded 2026-09-02._ The deferral below lasted a day: `tq-store-review`
was un-deferred and batched with the notification config into the 0.2.0
build, exactly as the last line here said to. `expo-store-review ~57.0.2` is
a dependency, `version` is 0.2.0, `useAcceptedCelebration` asks after the
notice's X, and `use-accepted-celebration.test.tsx` covers every gate. The
write-up moved to "Shipped in 0.2.0: the App Store review prompt" in
`docs/APP_STORE.md`; the record of the build itself is at the top of this
file under "The 0.2.0 build". What follows is the deferral as it was written
on 2026-09-01.

`tq-store-review` was **deferred, not done**, written down here so the package
list and the tree agreed. Nothing had shipped: `expo-store-review` was not a
dependency, `useAcceptedCelebration` called nothing new, and there was no test
for a prompt that did not exist.

The reason is the package's own "Waits on" question, answered rather than
dodged. It is a native module, so it cannot go over the air; an EAS build
draws down real credit; and on a pre-launch app with no users the prompt has
nothing to convert yet. What DID get produced was the runbook —
`docs/APP_STORE.md` carried "Queued for the next build: the App Store
review prompt" (since renamed "Shipped in 0.2.0: the App Store review
prompt"), listing the four things that must land in one change (the
dependency, the `version` bump so `runtimeVersion` moves with it, the
`requestReview()` call after the notice is dismissed, and a hand-run on
TestFlight because Apple owns the dialog and no screenshot can prove it) and
the rules for when it may fire: once per install ever, never during
onboarding, never after a block or a report, and no custom pre-prompt.

Un-defer it when the next native change is queued and batch the two.
`docs/UX_PACKAGES.md` carries the same status line on the package itself.
