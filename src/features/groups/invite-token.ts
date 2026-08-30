/**
 * The invite is a link now, so the paste is rarely just the code. Long-
 * pressing a message copies the whole bubble, and the bubble carries the
 * link AND the fallback line. The token is two dashless uuids — 64 hex
 * characters — so it can be found inside whatever came along with it
 * (migration 20260821010000). Everything after that first match is a
 * fallback for a token shape that changes later.
 */
export function inviteTokenFrom(pasted: string): string {
  const text = pasted.trim();
  const hex = text.match(/[0-9a-fA-F]{64}/);
  if (hex) {
    return hex[0].toLowerCase();
  }
  const fromLink = text.match(/\/(?:i|join-group)\/([^/?#\s]+)/);
  const raw = fromLink
    ? fromLink[1]
    : (text
        .split(/[?#\s]/)[0]
        ?.split('/')
        .filter(Boolean)
        .pop() ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    // A stray % is somebody's typo, not a reason to lose the paste.
    return raw;
  }
}
