# Naming

Working doc for the app's name. Nothing here is decided — the founder picks, and
the pick then flows into the bundle identifier, `app.json`, icon artwork, the App
Store listing and every string of user-facing copy.

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

## Current recommendation

1. **Tagalong** — does the most work. It is the sentence a traveler already says,
   it is warm, and it forecloses the dating read entirely.
2. **Who's In** — the safest strong choice. No negative reading, understood by a
   first-timer instantly, conversational in the way the product wants to be.
3. **Samewhere** — sharpest at describing the mechanic, most ownable, survived
   every round of shortlisting on merit.

## Before committing to a name

- [ ] App Store search (from a device) for the finalist and near-spellings
- [ ] Plain web search for existing travel/social apps using it
- [ ] Decide the bundle identifier — currently `com.mattmoore.travelapp`, and
      painful to change after the first App Store submission
