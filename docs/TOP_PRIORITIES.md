# Top priorities

A profile section: up to six very short things a traveler wants to do out
there. Founder request, 2026-08-27, deliberately separate from the business
accounts work.

> "I think a key prompt that users should be able to respond to on their
> profile is just a list of things they want to do while on their trip. It
> could be listed as 'top priorities' and list places, activities, tourist
> attractions, restaurants, bars, clubs, etc. leave it up to them but be sure
> to explain what the section is for. They can add up to 6 priorities and it
> should be easy to add additional ones up to 6 when editing the profile.
> These should be very short and easy to read, so keep the max characters to
> only allow for a few words for each."

---

## 1. Why this is the strongest thing on the profile

Everything else on a Samewhere profile describes a **person**. Trips describe
a **place and a window**. This is the only section that describes a **plan**,
and a plan is the one thing a stranger can say yes to without having to be
charming first.

That is not a slogan, it is the product's whole thesis restated. The app
exists for the meeting, not the profile view. The hardest moment in the funnel
is not "do I like this person", it is "what on earth do I open with". Trips
already answer _where and when_. Six lines answering _what_ turn the opening
message from an introduction into a reply:

> **them:** sunrise hike up Adam's Peak
> **you:** I'm in for this. I land the 4th, is the 6th too soon?

Nobody has to be interesting. They just have to want the same thing on the
same day. Prompts (`profile_prompts`) do a version of this already and the
research behind them said the same thing, but a prompt answer is a paragraph
of personality that happens to be repliable. A priority is a plan with a
built-in RSVP, and six of them are six separate doors into the same
conversation.

So this section earns its place **directly under the trips**, above About.
Where and when, then what. Everything after that is who.

---

## 2. What it is not

- **Not a bucket list.** "See the Northern Lights before I die" is not
  something anyone can join you for this Thursday. The copy and the character
  cap both push toward the next two weeks, not the next ten years.
- **Not ranked.** It is the founder's name for the section and it stays, but
  the list is not numbered on screen. Slots are insertion order, not
  preference order, and printing `1..6` next to them would claim a ranking the
  traveler never made. The `design-review` rule is explicit that structural
  devices have to encode something true. No numbers, no reorder handles.
- **Not per-trip.** See decision D1.
- **Not a matching input.** Free text does not cluster; two people who both
  want to surf will write "learn to surf", "surf lesson" and "get in the water
  at Costa da Caparica". Feeding that into the queue would need embeddings and
  would silently reweight a discovery surface that §7 rule 6 already
  constrains. Out of scope; noted in §9.

---

## 3. Data model

### 3.1 `profile_priorities`

Modelled on `profile_prompts` on purpose, down to the slot column, because
that table has already answered every question this one raises.

```sql
create table public.profile_priorities (
  user_id uuid not null references public.users (id) on delete cascade,
  -- Six, and the cap is enforced by the primary key rather than by a count
  -- trigger or by the client. There is no sequence of inserts that produces
  -- a seventh row.
  slot int not null check (slot between 0 and 5),
  -- A few words. See §3.2 for why 40 and not 60 or 24.
  text text not null check (char_length(text) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index profile_priorities_user_idx on public.profile_priorities (user_id);
```

Slots rather than a `position` column with reindexing: the cap comes free from
the primary key, the read is `order by slot`, and deleting the middle entry
leaves a hole that `nextFreeSlot` fills on the next add. That helper already
exists in `src/features/profile/prompts.ts` and is generalised in §5.1.

### 3.2 The character cap is 40

The founder's constraint is "only allow for a few words". Forty is the number
that admits every real entry and refuses every sentence:

| Entry                          | Chars |
| ------------------------------ | ----- |
| learn to surf                  | 13    |
| Sagrada Família                | 15    |
| day trip to Sintra             | 18    |
| pastel de nata crawl           | 20    |
| sunrise at Angkor Wat          | 21    |
| techno night in Berghain       | 24    |
| eat at Mercado da Ribeira      | 25    |
| sunrise hike up Adam's Peak    | 27    |
| hike the Seven Hanging Valleys | 30    |

At forty the longest realistic entry has ten characters of headroom and the
shortest complete sentence ("I really want to see the old town at night", 43)
does not fit. It is also the width that keeps a chip readable: at `footnote`
size a 40-character chip is about 300pt, which wraps to a second line on a
small phone at large Dynamic Type and **never truncates**. A priority
rendered as `day trip to Sinâ€¦` is worse than no priority at all, so the chip
wraps rather than ellipsizes and the cap is what keeps that to two lines.

### 3.3 RLS, identical to prompts

```sql
alter table public.profile_priorities enable row level security;
revoke all on public.profile_priorities from anon;
revoke truncate, references, trigger on public.profile_priorities from authenticated;

create policy profile_priorities_select_own
  on public.profile_priorities for select to authenticated
  using (user_id = auth.uid());

create policy profile_priorities_select_visible
  on public.profile_priorities for select to authenticated
  using (public.is_visible_owner(user_id));

create policy profile_priorities_write_own
  on public.profile_priorities for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

`is_visible_owner` is the single helper that already carries blocks,
suspensions, shadowbans and the audience filter. Using it means a hidden
profile does not leave six lines of its plans behind, which is exactly the
bug the prompts table was written to avoid.

### 3.4 It is screened text

Non-negotiable, and the reason is in the prompts migration's own comment:
broadcast text that skips the filter is a hole straight around profile
screening. Same trigger shape, same classifier:

```sql
create function public.screen_priority_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (public.screen_first_message(new.text) ->> 'action') = 'block' then
    raise exception 'that text breaks our community guidelines'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger profile_priorities_screen
  before insert or update on public.profile_priorities
  for each row execute function public.screen_priority_text();

revoke execute on function public.screen_priority_text() from public, anon, authenticated;
```

Forty characters is short enough to be a handle ("insta: @me"), a phone
number, or an invitation off-platform, so this is not ceremony. The prefilter
in `screen_first_message` already catches contact patterns.

### 3.5 Deletion

The `on delete cascade` on `user_id` carries the rows out with the account.
Add `profile_priorities` to the deletion-coverage assertions in the existing
pgTAP suite rather than trusting the cascade silently, same as prompts.

---

## 4. On the profile

### 4.1 Placement

`ProfileView` renders your own profile and everybody else's from one
component, which is the only honest way to see what a stranger sees. The
section goes **between `TripsSection` and About**:

```
photo + name
trips                       <- where and when
TOP PRIORITIES              <- what
first woven photo
About
prompt 0
Details
...
```

`SectionHeader` already gives the title, the icon, the owner's Edit
affordance and the visitor's reply affordance. Icon:
`{ ios: 'list.star', android: 'checklist', web: 'checklist' }`.

### 4.2 How it renders

A wrapping row of chips on `surfaceSunken`, one line of text each, `Radius.pill`.
Not a bulleted list: six bullets down the page pushes About and the first
prompt below the fold on a small phone, and the whole point of the cap is that
the set is readable at a glance. Chips wrap to two lines when Dynamic Type is
large. No numbers, no checkboxes, no icons per chip.

The chips are the same visual family as the languages chips in Details, which
is deliberate: the profile should read as one page, not six widgets.

### 4.3 The chip is the RSVP

This is the feature.

- **Someone else's profile:** each chip is a button. Tapping it opens the
  message composer anchored to that priority, exactly the way tapping a photo
  or a line of bio does today.

  ```ts
  onRespondTo({
    key: `priority:${slot}`,
    label: 'something on their list',
    quote: priority.text,
  });
  ```

  Add `{ value: 'priority', label: 'Something on their list' }` to
  `ELEMENT_OPTIONS` in `compose-request.tsx` so the anchor is also reachable
  from the composer's own chip row.

  The section header's reply button reads **"Say you're in"** rather than the
  generic `Reply to "…"`, because that is what the traveler is actually
  doing and because a control should say exactly what happens.

- **Your own profile:** each chip is a button that opens the editor scrolled
  to that row. Consistent with `PromptCard`, where owner mode swaps the reply
  affordance for an edit one.

- **Hit targets.** A chip at `footnote` is about 30pt tall. `hitSlop` brings
  every one of them to 44, and the accessibility label is the text plus the
  action: `"Sagrada Família. Say you're in."` — unique in context, which the
  scrim/close precedent says matters.

### 4.4 The empty state

Owner only, and it is the nudge that makes the section exist at all, styled
like the existing "Answer a prompt" dashed action:

> **What do you want to do?**
> Places, food, a night out, the one thing you'd hate to miss. Up to six.

A visitor looking at a profile with no priorities sees no section at all, the
same way an empty About collapses.

---

## 5. Editing

The founder's actual ask is here: _"it should be easy to add additional ones
up to 6 when editing the profile."_ The failure mode is obvious and it is what
`edit-prompt.tsx` would do if copied — a modal per entry means six entries
cost six screen transitions and about twenty taps. That is not easy, it is a
form.

### 5.1 One screen, six rows, the keyboard walks down

New modal route `app/edit-priorities.tsx`, registered inside the
`signedIn && onboarded` guard in `_layout.tsx` alongside `edit-prompt`.

- Every saved priority is a row: a `FormTextField` and a remove button.
- Below the last one sits **one empty field**. Type into it, press **return**,
  and it commits and immediately spawns a fresh empty field below with focus
  already in it. Six entries is six lines of typing and zero taps in between.
  That is the whole design.
  - `returnKeyType="next"`, `blurOnSubmit={false}`, and focus moved by ref in
    `onSubmitEditing`.
  - `keyboardDoneProps` on every field regardless. The default keyboard has a
    working return key so it is not strictly required here, but the rule
    shipped in `keyboard-done-bar.tsx` is that every keyboard in this app has
    a visible way out, and the test in
    `src/components/form/__tests__/keyboard-done-bar.test.tsx` scans source
    for exactly this.
- At six, the empty field is replaced by a line of `textSecondary`:
  **"That's six. Remove one if you want to swap it out."**
- Removing row 3 of 5 closes the hole: the client renumbers slots so the list
  is always `0..n-1`. Cheaper than it sounds (at most six upserts) and it
  keeps `nextFreeSlot` honest.

Generalise the slot helpers out of `prompts.ts` into
`src/features/profile/slots.ts` (`nextFreeSlot(usedSlots, max)`) so prompts
and priorities share one implementation and one test.

### 5.2 Saving

Each row saves on blur or on return, through its own mutation, invalidating
`['profile-priorities', userId]`. Not a single Save button:

- The screen has no other fields, so there is nothing to save atomically.
- A traveler who types four priorities and swipes the modal away should keep
  four priorities. The discard-guard dance in `edit-profile.tsx` exists
  because that screen holds a bio somebody spent five minutes on; a
  twenty-character chip is not that.
- The moderation trigger can reject one row. Per-row saving means the
  rejection lands on the row that caused it, with the other five already
  safe. A single Save would have to explain which of six lines the server
  refused.

A row whose save is rejected keeps its text, shows the error under it, and
stays editable. The classifier's message is already user-facing.

### 5.3 Reaching it

Three doors, all of which the founder's phrasing implies:

1. The `SectionHeader` Edit pencil on the profile section.
2. Tapping any chip on your own profile (opens scrolled to that row).
3. A row in `edit-profile.tsx` reading **`Top priorities`** with
   `3 of 6` on the right, pushing this screen. This is the one that satisfies
   _"when editing the profile"_ literally: somebody who went to Edit Profile
   looking for it finds it there rather than having to back out.

`edit-profile.tsx` keeps its single-mutation shape. Priorities are rows in
another table with their own save and delete; folding them into that form
would mean its `dirty` check has to diff two tables and its Save button would
be saving half the screen through a different code path.

---

## 6. Copy

Every string, so it can be read aloud in one place before it ships. Casual,
travelled, no em dashes, nothing that reads as written by a machine.

| Where                  | String                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section header         | `Top priorities`                                                                                                                                                        |
| Header reply button    | `Say you're in`                                                                                                                                                         |
| Empty state, title     | `What do you want to do?`                                                                                                                                               |
| Empty state, sub       | `Places, food, a night out, the one thing you'd hate to miss. Up to six.`                                                                                               |
| Editor title           | `Top priorities`                                                                                                                                                        |
| Editor explainer       | `The stuff you actually want to do out there. Places, food, a night out, a hike, whatever it is. Keep them short. Someone who wants the same thing can say they're in.` |
| Field placeholder      | rotates: `pastel de nata crawl` / `day trip to Sintra` / `learn to surf` / `find a record shop` / `rooftop for the sunset` / `sunrise hike`                             |
| At the cap             | `That's six. Remove one if you want to swap it out.`                                                                                                                    |
| Remove button label    | `Remove "day trip to Sintra"`                                                                                                                                           |
| Too long               | `A few words is plenty.`                                                                                                                                                |
| Rejected by moderation | the classifier's own message, unchanged                                                                                                                                 |
| Edit Profile row       | `Top priorities` + `3 of 6`                                                                                                                                             |
| Composer chip          | `Something on their list`                                                                                                                                               |

The explainer is the founder's _"be sure to explain what the section is for"_.
It says what goes in it, that short is the point, and what happens next, in
three sentences at the top of the editor where somebody is about to type. It
does not appear on the profile itself, where the six chips explain
themselves.

`A few words is plenty.` rather than a live character counter: a counter
ticking toward 40 tells somebody to fill it, and the whole constraint exists
to stop that. The field simply stops accepting input at the cap (`maxLength`),
and the hint appears only if they hit it.

---

## 7. Client shape

```
supabase/migrations/..._profile_priorities.sql   table, RLS, screening trigger
supabase/tests/database/..._priorities.test.sql  pgTAP, written as attacks
src/features/profile/priorities.ts               MAX_PRIORITIES, PRIORITY_MAX,
                                                 PLACEHOLDERS, validate
src/features/profile/slots.ts                    nextFreeSlot, lifted from prompts.ts
src/features/profile/api.ts                      fetch / save / delete / renumber
src/features/profile/hooks.ts                    usePriorities, useSavePriority,
                                                 useDeletePriority
src/features/profile/profile-view.tsx            PrioritiesSection + empty state
src/app/edit-priorities.tsx                      the editor
src/app/edit-profile.tsx                         the row that pushes it
src/app/_layout.tsx                              route inside the onboarded guard
src/app/compose-request.tsx                      the new anchor option
```

`usePriorities(userId)` is one query for your own and anybody else's, like
`useProfilePrompts` — RLS decides what comes back and the profile renders both
identically.

---

## 8. Tests

**pgTAP, as attacks:**

- a seventh row is refused (slot 6 fails the check; slot 0..5 reused fails the PK)
- 41 characters is refused, 40 is accepted, empty is refused
- anon can read nothing and write nothing
- one traveler cannot read another's priorities when `is_visible_owner` is false
  (blocked, suspended, shadowbanned, and filtered out by audience)
- one traveler cannot write into another's slot
- text the classifier blocks is refused at insert **and** at update
- deleting the user deletes the rows

**Unit:**

- `nextFreeSlot` with holes, full, and empty, for both max values
- renumbering after a middle removal produces `0..n-1`
- validation: trim, cap, empty after trim

**E2E:** the simulator suite adds two priorities to the seeded account, and
the screenshot goes in the gallery. Per the `screens` skill, this section is
reviewed as a picture. Chips at large Dynamic Type wrapping to two lines is
exactly the kind of thing an exit code cannot see.

---

## 9. Decisions for the founder

**D1. One list per profile, not one per trip.** The request says "while on
their trip", and a traveler with a Lisbon trip and a Tokyo trip genuinely has
two different lists. Per-trip is more precise and costs about six times the
UI: a list per trip, an editor that asks which trip first, and a profile whose
priorities change depending on which of your trips overlaps the viewer's.
Recommendation: **one list**, standing, describing what this person is into.
The city is already on screen right above it, and someone who wants to be
specific writes "day trip to Sintra" rather than "day trip". Say the word and
it becomes per-trip.

**D2. Six is the cap and it is hard.** No paid tier, no "add a seventh".
Consistent with prompts capping at three, and the reason is the same: a
profile that lists twenty things is a form, not a person.

**D3. Not in the Travelers queue card, yet.** The queue reviews one person
full-page, so the priorities are already there when you scroll. Putting two of
them on a compact card as well is a real option and a real risk (the card gets
noisy fast). Recommendation: ship it on the profile, look at the screenshots,
decide then.

**D4. No matching on priorities in v1.** See §2. Worth revisiting once there
are enough real lists to see whether people write the same words as each
other. If they do, "3 travelers in Lisbon also want to do this" is a very
strong surface and it is an easy second act.

---

## 10. Build order

Small enough to be one pass, in this order so nothing is ever half-wired:

1. Migration + pgTAP. Prove the cap, the RLS and the screening before any UI.
2. `priorities.ts`, `slots.ts` (lifted from `prompts.ts`, prompts switched
   over), api, hooks, unit tests.
3. `PrioritiesSection` on the profile, read-only, with the empty state.
4. `edit-priorities.tsx` and its three doors.
5. The composer anchor and `Say you're in`.
6. E2E run, read the screenshots, then ship over the air. This is all
   JavaScript and one migration, so it is an `action: update` plus the
   Supabase deploy. No EAS build.
