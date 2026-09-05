/**
 * The line that stands where the composer was.
 *
 * `sever_on_block` closes the chat, and so does the other person leaving, so
 * one sentence covered both: a woman who had just blocked a man was shown the
 * same grey line she would have seen if he had walked away on his own, at the
 * one moment she most needed to know the app had heard her.
 *
 * Two sentences now, and which one shows is decided by the server's own list
 * of this account's blocks rather than by a flag held on the screen, so it
 * survives a remount and a cold start. The caller must pass `iBlockedThem`
 * false until that list has actually answered: a beat of loading state that
 * says the neutral sentence is a beat of nothing much, and a beat that says
 * the other one would be the app telling somebody they had not blocked a
 * person they just did.
 */
export function closedNotice(iBlockedThem: boolean, name: string | null): string {
  return iBlockedThem
    ? `You blocked ${name ?? 'this traveler'}. They cannot write to you.`
    : 'This chat is closed.';
}
