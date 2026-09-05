# Naming

How the name was chosen, and what is still owed before the first submission.

**The name is decided: Samewhere.** It is in `app.json`, in the bundle
identifier `com.mattmoore.samewhere`, on `link.samewhere.io`, and in every
string the app shows. The rest of this document is the record of how that was
picked, plus one checklist at the foot that is still open and is blocking.

## What was actually verified

**Domains** were screened by DNS from the build sandbox: nameservers present
means the domain is registered; `NXDOMAIN` means it is almost certainly free.
About 500 candidates were tested this way. RDAP and WHOIS are blocked by the
network policy, so this is a strong signal, not registrar-grade confirmation.

**App Store names were NOT verified.** The iTunes Search API
(`itunes.apple.com/search`) is blocked by the same policy — DNS resolves, the
proxy denies CONNECT. Collision notes below come from model knowledge with a
May 2026 cutoff and are ranked by confidence, not looked up. **Every finalist
still needs a real App Store search from a device.**

## The domain finding

No good name in this space has a free bare `.com`. Not real words, not invented
words, not bird names, not compounds. `overlap`, `alongside`, `waypoint`,
`cairn`, `tern`, `agora`, `lobby`, `commons`, `coterie` and `lodestar` are taken
in _every_ form tested, including `.app`, `.co`, `.io` and even `getX.com`.

This turned out not to matter much. Nobody types a URL to find an iOS app — they
search the App Store. The domain's real jobs are a marketing page and the
privacy-policy and support URLs App Review requires, and a prefixed `.com` or a
`.app` serves all three. **The name should be chosen on merit, not availability.**

## Candidates

Grouped by the idea each expresses. "Availability" is domains only.

### The ask — phrases people already say

| Name           | Note                                                                                |
| -------------- | ----------------------------------------------------------------------------------- |
| **Tagalong**   | "Can I tag along?" is the exact request the app enables; forecloses the dating read |
| **Who's In**   | The phrase for making a plan. Purely positive; apostrophe is awkward on an icon     |
| **Come Along** | Gentler than Tagalong, without the burden connotation                               |

Tagalong's risk: as a noun, a "tagalong" is someone unwanted. The verb reading
dominates in context, but it is a real edge. Girl Scouts also sell Tagalongs.

### Found company — says "friends" without saying it

| Name             | Note                                                          |
| ---------------- | ------------------------------------------------------------- |
| **Kith**         | "Kith and kin." Premium and explicitly non-romantic           |
| **Buddy System** | Platonic _and_ nods to safety, a core product value           |
| **Sidekick**     | Warm and loyal, but implies a hierarchy — someone is the star |

Kith collides with a culturally prominent streetwear brand. Different trademark
class, but a permanent search fight. Recommended against for a solo founder.

### The place it happens

| Name            | Note                                                            |
| --------------- | --------------------------------------------------------------- |
| **Common Room** | Precisely where this behaviour already occurs in hostels        |
| **Bunkroom**    | Signals platonic and communal instantly; narrows toward hostels |
| **Front Desk**  | Where you ask what's on tonight                                 |

Common Room likely collides with the B2B community platform of that name.

### Short and brandable

| Name      | Note                                                                   |
| --------- | ---------------------------------------------------------------------- |
| **Amble** | Unhurried walking. Travel-native without the wander/nomad cliché       |
| **Mosey** | Warm and underused; possible collision with a compliance startup       |
| **Cairn** | Stones left to guide whoever follows — the best _meaning_ of any name  |
| **Flock** | A group that travels together; crowded (Flock Safety, Flock messaging) |
| **Tern**  | Longest migration of any animal. Elegant and quiet                     |

Cairn almost certainly collides with an existing hiking-safety app.
Recommended against for the same reason as Kith.

### Same place, same time — the mechanic

| Name           | Availability                      | Note                               |
| -------------- | --------------------------------- | ---------------------------------- |
| **Samewhere**  | `.co` `.io` + all `.com` prefixes | Sharpest description; ownable      |
| **Hereabouts** | `.co` `.io` + all `.com` prefixes | "Who's hereabouts" is the ask      |
| **Coincide**   | none                              | Precise but clinical               |
| **Crosspaths** | —                                 | Plainly stated                     |
| **Here Now**   | —                                 | Present-tense, exactly the promise |

### From the founder's original list

| Name          | Availability                  | Verdict                                       |
| ------------- | ----------------------------- | --------------------------------------------- |
| **Overlap**   | nothing, any form             | Most accurate name; completely unobtainable   |
| **Crossings** | `.co`, `get-`, `try-`         | Workable but thinner                          |
| **Meanwhile** | `getmeanwhile.com` only       | Implies _elsewhere_ — opposite of the product |
| **Pinned**    | `joinpinned.com` only         | Pinterest-adjacent and crowded                |
| **Waypoint**  | nothing, any form             | Heavily used in GPS/outdoors apps             |
| **Nightbus**  | everything but bare `.com`    | Widest availability tested; slightly gritty   |
| **Roamkin**   | `.app` `.co` `.io` + prefixes | "Kin" carries found-family; slightly twee     |
| **Wheatear**  | everything but bare `.com`    | Obscure, and reads as "wheat ear"             |
| **Farflung**  | `.app` `.io` + prefixes       | Means _distant_; the product is about _near_  |

### Short and modern — the founder's stated preference

Roughly 800 names have now been screened. The structural result: **every short
real English word is domain-squatted.** The 4–6 letter space is entirely gone —
`rove`, `cove`, `nook`, `trove`, `terra`, `vamos`, `bora`, `ciao`, `huddle`,
`mingle`, `flock`, `arc`, `rise`, `loom`, `ramp`, `verge` all return saturated.
What survives is unusable (`wenn`, `rovi`, `gaggle`, `swarm`). Further hunting in
that space is wasted effort.

**Read domain saturation carefully.** For short common words it is a _bad_ proxy
for App Store crowding: squatters register them regardless of whether any product
uses the name. It is only a useful signal for coined or compound names, where a
registration usually implies a real brand (this is what made Amble's 16-of-17 a
genuine warning). Do not let squatters veto a good name.

Best short names on merit, domains ignored:

| Name       | Len | Why it fits                                                | Risk                                              |
| ---------- | --- | ---------------------------------------------------------- | ------------------------------------------------- |
| **Rove**   | 4   | To wander freely; sounds like a current app; travel-native | Slightly archaic; Land Rover / Rover associations |
| **Bora**   | 4   | Brazilian Portuguese "let's go" — everyday slang in Lisbon | Opaque to non-speakers; English ear hears "bore"  |
| **Vamos**  | 5   | "Let's go"; widely understood; inherently social           | Common, so collisions likely                      |
| **Huddle** | 6   | A group gathering briefly to plan — never romantic         | Slack Huddles dilute it badly                     |
| **Covey**  | 5   | A small flock that stays together; 2/8 domains free        | Obscure — the flaw that sank Amble                |

Ruled out despite strong meaning: **Sonder** (Sonder Holdings is a hospitality
company — direct category conflict) and **Yalla** (well-known MENA social app).

### Round four — temporary stays, open doors, groups on a route

| Name          | Len | Free | Note                                                                  |
| ------------- | --- | ---- | --------------------------------------------------------------------- |
| **Ajar**      | 4   | 1/8  | A door left open — best short/modern option found; leans on subtitle  |
| **Also Here** | 8   | 7/8  | Literally what the app tells you; plain words for non-native speakers |
| **Awhile**    | 6   | 5/8  | "Stay awhile" — matches the temporary overlap; a touch passive        |
| **Caravan**   | 7   | 1/8  | Strangers joining for company on a route; in UK/AU it means an RV     |
| **Serendip**  | 8   | 3/8  | Root of "serendipity", from a Persian tale of travelers' chance finds |
| **Bunkmate**  | 8   | 6/8  | Hostel-native, explicitly platonic; narrows toward hostels            |
| **Meantime**  | 8   | 3/8  | Fixes Meanwhile's flaw — during _this_ window, not elsewhere          |
| **Wayside**   | 7   | 2/8  | The roadside resting place; but "fall by the wayside" means to fail   |
| **Tavola**    | 6   | 4/8  | Italian for table; reads as a restaurant app                          |
| **Flashpack** | 9   | 5/8  | Real backpacker slang; meaningless outside the subculture             |

**Also Here** is the only name that competes with Samewhere on its own terms:
both state the shared-presence fact. Samewhere is coined, so more ownable and
brandable; Also Here is built from words any English learner knows and is
slightly more available. That is the whole trade.

### Round five — plain-language co-presence phrases

The founder liked Also Here's direction: plain words stating a fact about being
in the same place, rather than a metaphor. Mining that vein produced the first
bare `.com` hits in ~900 candidates.

| Name             | Free              | Note                                                          |
| ---------------- | ----------------- | ------------------------------------------------------------- |
| **Same Here**    | 5/8               | Everyday agreement _and_ literal co-location — double meaning |
| **Here Too**     | 6/8               | The most concise form of the fact                             |
| **Both Here**    | 7/8               | States mutuality, not just presence                           |
| **Someone Here** | 8/8 · `.com` free | Warm and faintly poetic; best availability found anywhere     |
| **Same Town**    | 7/8               | Plainest and clearest; zero ambiguity                         |
| **Anyone Here**  | 7/8               | The question you call into a room                             |
| **Same Week**    | 6/8               | Says the _temporal_ overlap where the others say spatial      |
| **Who Else**     | 5/8               | The literal question the app answers                          |
| **New Here**     | 4/8               | The exact sentence a traveler says; invites welcome           |
| **Same Boat**    | 4/8               | Warm idiom, unmistakably platonic, quietly travel-adjacent    |

Discarded despite perfect availability: **Who's Else** (`whoselse.com` is free
because it is ungrammatical) and **Same Scene** (vague, and a "scene" is
something you are outside of).

**Same Here** is the strongest result of this round. It is not a compromise
between Samewhere and Also Here — it is their overlap: it shares the `Same` root
with the former, has the plain-language legibility of the latter, and adds a
genuine double meaning neither has. A name that means two true things at once is
usually a good sign.

### Round six — descriptive compounds (Travel Friends, Travel Meet…)

Best availability of any round (most 4–5 of 6 free). That is the tell, not the
win: squatters ignore generic compounds because they have no resale value.

| Name               | Free | Note                                                    |
| ------------------ | ---- | ------------------------------------------------------- |
| **Meet Travelers** | 5/6  | Clearest statement of the use case                      |
| **Travel Kin**     | 5/6  | "Kin" is warmer and slightly more ownable               |
| **Travel Folk**    | 5/6  | Warm, less transactional than most here                 |
| **Wandermates**    | 5/6  | "Mates" reads platonic; in US English can skew romantic |
| **Hostelmates**    | 5/6  | Narrows to hostels                                      |
| **Friends Abroad** | 5/6  | Clear, faintly expat-flavoured                          |
| **Travel Friends** | 4/6  | The most literal version                                |
| **Travel Buddy**   | 0/6  | Fully taken — most-attempted name in the category       |

**Recommended against as a direction**, for four reasons:

1. **Legally weak** — descriptive names are largely unprotectable. Anyone can
   use "Travel Friends"; there is no trademark and no defence.
2. **Apple discourages generic names** — metadata rules require distinctiveness
   and prohibit keyword-stuffing.
3. **Most competed territory in the category** — which is precisely why
   `travelbuddy` is the one name here at 0/6.
4. **The benefit is already free.** The App Store field structure puts the
   keywords in the title, subtitle and keyword field regardless of the brand.
   Making the brand _itself_ the keyword is redundant: it adds nothing and
   costs everything ownable.

**The useful find:** "Never Travel Alone" is a weak name but an excellent
subtitle — 18 characters, states the promise, forecloses the dating read in
three words. Recommended regardless of which name is chosen.

### The space is now covered

Six rounds, ~950 candidates, across every direction available to this category:
the mechanic (Samewhere, Overlap), plain-language co-presence (Also Here, Same
Here), the ask (Tagalong, Who's In), places (Bunkroom, Common Room), short and
modern (Rove, Ajar, Amble), evocative (Cairn, Tern, Sonder), non-English (Junto,
Vamos, Pamoja), and descriptive (Travel Friends). There is no seventh direction
being held back.

## DECIDED: Samewhere (2026-08-17)

Chosen after six rounds and ~950 candidates. It led on the combination that
mattered — meaning (it states the mechanic: same place, same time), ownability
(coined, so trademarkable and clean in search), and availability (6/8, the least
crowded of any strong name) — and it was the founder's favourite in five
consecutive rounds, which is its own signal.

Wired through: `app.json` (name, slug, scheme), bundle identifier, the welcome
screen, `README.md`, `package.json`, `APP_STORE.md`, and the privacy policy.

**Still provisional in one respect.** No App Store collision check was possible
from the build sandbox — the iTunes Search API is blocked. Until the founder
searches the App Store for "Samewhere" and near-spellings, treat the name as
unverified. Swapping it now costs minutes; after the first submission the bundle
identifier is permanent.

**Bundle identifier: `com.mattmoore.samewhere`** — kept under the existing
`com.mattmoore` namespace rather than `com.samewhere.*`, because the convention
is to use a reverse-domain you control, and `samewhere.com` is registered to
someone else.

### Runners-up, for the record

1. **Same Here** — the strongest late find. Shares the `Same` root, adds a real
   double meaning (agreement + co-location). Would be the first alternative.
2. **Also Here** — plain-language legibility for non-native speakers; 7/8 free.
3. **Rove** — the pick had "short and modern" won out.
4. **Ajar** — best four-letter option; the open-door image is the right feeling.

Withdrawn: **Tagalong** was ranked first before its saturation was measured; it
came back 8/8 taken. **Amble** was a founder favourite but is 16/17 taken
including `amble.travel` and `amble.social`, which points to an active travel
brand. **Somewhere** (as distinct from Samewhere) is fully saturated.

### The name does not have to carry search

The founder's concern was that people search "how to meet people while
travelling," so the name should say the use case. On the App Store these are
different fields, and all of them are indexed:

| Field       | Limit     | Content                                                   |
| ----------- | --------- | --------------------------------------------------------- |
| App Name    | 30 chars  | `Rove: Meet People Traveling` (27)                        |
| Subtitle    | 30 chars  | `Travel friends, never dates` (27)                        |
| Keywords    | 100 chars | `solo travel,backpacker,hostel,trip buddy,meet travelers` |
| Home screen | ~12 chars | `Rove` (this one is NOT indexed — it is pure brand)       |

So a short brand costs nothing in discoverability. The pattern is standard:
_Hostelworld: Hostel Travel App_, _Meetup: Social Events & Groups_.

## BLOCKING before the first App Store submission

The bundle identifier `com.mattmoore.samewhere` is already in `app.json:11`,
and **it cannot be changed after the first submission**. So the one
irreversible decision in this launch currently rests on a check this document
says was never performed. It is ten minutes of work and this is the last
moment it is cheap.

| Check                                                                                         | Why it is here                                                                                |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **App Store search from a real phone** for `Samewhere`, `Same Where`, `Somewhere`, `Samewear` | The iTunes Search API is blocked from this sandbox, so no collision note above was looked up. |
| **Plain web search** for travel or social apps using the name or a near-spelling              | A live app that never shipped to the App Store still owns the search result and the goodwill. |
| **USPTO word-mark search** (TESS) in classes 9 and 42                                         | US registration is where an objection is most likely to arrive with a lawyer attached.        |
| **EUIPO word-mark search** in classes 9 and 42                                                | The first launch city is in the EU.                                                           |
| **Sanity check the App Store name field** is not already taken by a live app                  | Apple rejects a duplicate app name outright, at submission, with no warning beforehand.       |

[LEGAL: classes 9 (software) and 42 (SaaS) are the obvious two. Confirm
whether class 45, where online social networking services sit, needs adding
before anything is filed.]

Record the outcome of each check here, with the date, whichever way it goes. A
negative result is worth as much as a positive one the day somebody asks.
