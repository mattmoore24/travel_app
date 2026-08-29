# Nomadtable — the competitive read

> Gathered 2026-08-28. **Sourcing caveat:** the session's network blocked direct page
> fetches, so everything here comes from search-result summaries rather than pages opened
> and read. Growth numbers and the founder's story are corroborated across several
> independent write-ups. The exact subscription prices are NOT reliable — reported figures
> ranged from €70 to $65/yr to a $49/$199 pair, which cannot all be true.
>
> Founder-facing version, with the full argument:
> https://claude.ai/code/artifact/433eb038-271e-4192-96c0-cd33f422b241

## What it is

A solo-travel meetup app by Jay Raavi (Nomadtable Inc.), built solo. Roughly **1M+
downloads and $65K/month within a year of launch**, via 75K MAU and $18K MRR at the
six-month mark. Google Play shows **4.46★ from ~84K ratings**, ~180K installs in the last
30 days, top-100 Travel & Local. Strongest cities: **Lisbon, Bali, Bangkok** — three of the
four Samewhere has seeded, and Lisbon is our launch city.

Core loop: see who is **nearby right now** in your current city, join or create an
**activity**, and get dropped into a **group chat** with people whose future trip dates
match yours. Plus AI activity suggestions.

## Where we overlap

Not an adjacent product. Same job, same person, same cities, and it states the same
non-negotiable in its guidelines: **it is not a dating app**. So "we're not a dating app"
is not a differentiator — everyone in this category says it. What differs is whether the
app is built so it cannot become one.

Both have: a city map, future-trip matching, group chats, a business surface, free download.

## Where we split

|                         | Nomadtable                                                                                               | Samewhere                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| The map                 | Who is nearby, **right now**                                                                             | Where somebody **intends to be**, venue-level, ≤72h (§7 rule 2)       |
| Paying for people       | Plus gates **the full nearby list**, boosts, profile-view pings                                          | Nothing about people is behind a wall (§7 rule 1)                     |
| Value with zero matches | AI suggestions                                                                                           | The k-thresholded **heatmap** (§7 rule 6)                             |
| Businesses              | **Sponsored pins**, self-serve, dynamically priced by city demand, monthly, 30% off on a prepaid quarter | Free verified listing + room + ratings. No paid placement             |
| Reaching someone        | **Join an activity — one tap**                                                                           | Request → accept → chat, every first message screened (§7 rules 4, 5) |
| Reach                   | iOS + Android, ~84K ratings, a year of compounding                                                       | iOS, pre-launch, zero users                                           |

**The row that matters most is the fifth.** Their funnel to a conversation is one tap; ours
is three steps with a human gate in the middle. The gate is right for a stranger writing to
one person and wrong for joining six people going to a bar. That is their real product
advantage and it is fixable.

## How they grew — a real sequence

1. **Content before code.** Validated by posting about the problem before building; three
   MVPs, two pivots, same problem throughout.
2. **The founder shot every video himself for months.** Dozens of hooks, no creators, no spend.
3. **One metric decided it:** % still watching past 3 seconds. At a consistent 75–80% the
   format was called viral-ready.
4. **Then ~60 creators**, managed personally over WhatsApp, paid **performance CPM at
   $1–2 per 1,000 views**. No retainers.
5. **The videos are not about the app** — they are solo-travel content (making friends
   alone, safety tips) with the app as the payoff. ~44M views/month.

There is no second channel to copy. This is the whole engine.

## What their users complain about

Their reviews are a specification for our positioning:

- **Price, and what it buys.** The commonest complaint, aimed specifically at paying to see
  who is around. "The premium subscription is not justified given the persistent bugs."
- **Empty outside the hubs.** "Super basic and has like 3 users on it."
- **It breaks.** Buggy, laggy, crash-prone, worse on Android; one user saw "our servers are
  full" on every launch for five weeks.
- **Moderation without a human.** Random flagging, pre-written support replies, a refused
  refund after cancellation.

## Recommended moves

**Positioning**

- Lead with **"nobody can see where you are, ever"** — architecturally closed to a proximity
  product, and the sharpest wedge into solo female travelers.
- Say **"plans, not presence."** It reframes the 72-hour expiry as the point rather than a limit.

**Product**

- **Make a pin joinable.** The pinner ticks "anyone can join"; joining opens a small group
  chat. Closes their one-tap gap without touching the request gate for 1:1. Mostly wiring —
  group chats, invites, moderation and expiry all exist.
- **Auto-group overlapping trips.** Post a trip to Lisbon in October, land in a chat with
  everyone else going. Their strongest cold-start mechanic; ours needs both sides to act.

**Go-to-market**

- Start the content account **now**, founder-shot, one metric, and only then creators on CPM.
- **Stay in Lisbon until it is dense.** Our runbook already says so and their reviews prove why.
- **Business rooms are the seeding mechanism.** A forty-bed hostel is forty travelers who all
  arrived this week — and we can give it free what Nomadtable charges for.

**Money**

- **Decide the revenue path before launch.** Their $65K/month comes from gating people, which
  §7 forbids and their users hate. But they proved businesses will pay for map placement. The
  brief makes the _core_ free; the business side is where a paid tier can live without
  breaking that.
- **Market the reliability.** 707 DB assertions, 353 unit tests, every screen photographed
  before it ships. Nobody markets on this, which is why it lands against an incumbent whose
  reviews say the opposite.

## The tension worth naming

Their paywall is not incidental to their growth — it funds it. Subscriptions pay the creator
CPMs that make the views that make the downloads that make the subscriptions. The loop
closes. Our free-core rule breaks that loop by design, which means the growth engine gets
paid for by the business side, the founder's pocket, or slower growth. All three are
legitimate; choosing none of them is not.

And they are a year and a million downloads ahead in the three cities we want. Their
thinness everywhere else is the opening, and it argues for picking a launch city on where
they are _absent_ rather than where nomads are thickest. Lisbon is their turf. That may
still be the right fight — but it should be a decision, not an inheritance.
