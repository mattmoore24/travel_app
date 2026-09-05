/**
 * Copy for the daily spotlight ribbon.
 *
 * Lives in its own module so the sentence can be unit-tested, because the line
 * it replaced could not be: "You're top of their list too." was a literal in
 * the middle of a screen, and it told a reader that a named stranger had
 * ranked them. That is the reciprocal-interest reveal the product exists to
 * avoid, and the design brief bans the grammar by name.
 *
 * What the database actually guarantees is narrower and is worth saying
 * plainly: `daily_spotlights` is a canonically ordered pair with a unique
 * index on (day, user_a) and on (day, user_b), so one pairing exists per
 * person per day and BOTH sides are shown it. The score is symmetric —
 * `score(a,b) = score(b,a)` — and takes no photo input. So "shown to you and
 * them today" is exactly true, and carries no ranking.
 */
export function sharedTodayNote(name: string | null | undefined): string {
  const who = name?.trim();
  return who ? `Shown to you and ${who} today.` : 'Shown to you both today.';
}
