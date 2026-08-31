/**
 * What the composer says when a draft is (or would be) stopped, by the
 * category the prefilter actually computed. Before this existed the category
 * was thrown away and a message caught by the flirtation patterns was told it
 * "came across as explicit", which is not what the classifier said - and the
 * brief's own rule is that an error says what went wrong and what to do.
 *
 * Never echoes the matched phrase: the blocklist is a table of regexes, and
 * naming the trigger hands out the evasion rule. Category only.
 */

export type ModerationNotice = { title: string; body: string };

/** A send was refused. */
export function blockedCopy(category: string | null): ModerationNotice {
  const title = "That message can't be sent";
  switch (category) {
    case 'flirtation':
      return {
        title,
        body: 'That reads as a come-on. Say what you would actually do together and it goes straight out.',
      };
    case 'sexual':
      return { title, body: 'That reads as explicit. Reword it and it goes straight out.' };
    default:
      return { title, body: 'That came across as explicit. Reword it and send again.' };
  }
}

/** The live preview thinks the draft would be refused. */
export function riskyCopy(category: string | null): ModerationNotice {
  const title = 'This might not go through';
  switch (category) {
    case 'flirtation':
      return {
        title,
        body: 'That reads as a come-on. Say what you would actually do together and it goes straight out.',
      };
    case 'sexual':
      return { title, body: 'That reads as explicit. Reword it and it goes straight out.' };
    default:
      return {
        title,
        body: 'Explicit messages are not delivered. Reword it and it goes straight out.',
      };
  }
}
