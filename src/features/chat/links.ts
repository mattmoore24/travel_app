/**
 * Find the tappable parts of a message.
 *
 * §7 rule 4 means a social handle or an address only ever arrives inside a
 * chat, so the chat is the one place a URL can appear — and it used to be
 * dead grey text. This splits a message body into spans the thread can
 * render as nested Text, the matched ones pressable.
 *
 * Matches http(s) URLs and bare domains ("samewhere.io/help"), trims the
 * trailing punctuation a sentence hangs on them, and leaves @handles alone:
 * "@rua.da" is somebody's Instagram, not a website called rua.da.
 */
export type LinkSpan = {
  text: string;
  /** Where the span goes when tapped, or null for plain words. */
  url: string | null;
};

/** A full URL, or a bare domain with an optional path. */
const CANDIDATE = /https?:\/\/\S+|(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?:\/\S*)?/gi;

/** What a sentence leaves stuck to the end of a link. */
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

export function splitLinks(body: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  let cursor = 0;
  CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE.exec(body)) != null) {
    const start = match.index;
    // No lookbehind in the pattern (Hermes is not the place to find out),
    // so the "is this actually a handle or the tail of a word" check reads
    // the character before the match instead.
    const before = start > 0 ? body[start - 1] : '';
    if (before === '@' || /[\w.-]/.test(before)) {
      continue;
    }
    const text = match[0].replace(TRAILING_PUNCTUATION, '');
    if (text.length === 0) {
      continue;
    }
    const end = start + text.length;
    if (start > cursor) {
      spans.push({ text: body.slice(cursor, start), url: null });
    }
    const hasScheme = /^https?:\/\//i.test(text);
    // A bare domain needs a scheme before Linking can open it.
    spans.push({ text, url: hasScheme ? text : `https://${text}` });
    cursor = end;
    CANDIDATE.lastIndex = end;
  }
  if (cursor < body.length) {
    spans.push({ text: body.slice(cursor), url: null });
  }
  return spans;
}
