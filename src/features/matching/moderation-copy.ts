/**
 * What the composer says when a draft is (or would be) stopped, by the
 * category the prefilter actually computed.
 *
 * Since 2026-09-10 the prefilter refuses one kind of thing: a slur. Founder:
 * "I don't think we should be trying to police speech rather than a few
 * explicit curse words that are almost always used in a derogatory fashion
 * ... and can rely on users to report/block each other." So there is one
 * sentence for that, and one for whatever a future row of the table might
 * be, and neither of them says "explicit" any more, because nothing is
 * refused for being explicit.
 *
 * Never echoes the matched word: the blocklist is a table of regexes, and
 * naming the trigger hands out the evasion rule. Category only.
 */

export type ModerationNotice = { title: string; body: string };

/** A send was refused. */
export function blockedCopy(category: string | null): ModerationNotice {
  const title = "That message can't be sent";
  switch (category) {
    case 'slur':
      return { title, body: 'That word is not allowed here. Reword it and it goes straight out.' };
    default:
      return { title, body: 'That breaks our house rules. Reword it and send again.' };
  }
}

/** The live preview thinks the draft would be refused. */
export function riskyCopy(category: string | null): ModerationNotice {
  const title = 'This might not go through';
  switch (category) {
    case 'slur':
      return { title, body: 'That word is not allowed here. Reword it and it goes straight out.' };
    default:
      return {
        title,
        body: 'That would break our house rules. Reword it and it goes straight out.',
      };
  }
}
