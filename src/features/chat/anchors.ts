import { promptLabelInline } from '@/features/profile/prompts';

/**
 * What a first message was a reply TO, and the two ways the app says it.
 *
 * The vocabulary lived twice — `anchorLabel` in the chat thread and
 * `describeElement` in the Chat tab — and the two had already drifted: the
 * second knew nothing about pins, and neither knew about the profile prompts
 * added in the same build that added them, so a hello started from "I always
 * pack" was announced as having come from the recipient's bio. Both of those
 * are the same class of bug: a screen quietly attributing somebody's opening
 * line to the wrong thing.
 *
 * One parser, two renderers, because the grammar genuinely differs. In an
 * opened chat the anchor is narrated in the third person about the other
 * person's profile ("Started from Theo's photo"); on an incoming hello it is
 * addressed to the person reading it, about their own ("about your photo").
 */
export type Anchor =
  | { kind: 'trip' }
  | { kind: 'photo' }
  | { kind: 'languages' }
  | { kind: 'home' }
  | { kind: 'bio' }
  | { kind: 'priority' }
  | { kind: 'prompt'; promptKey: string }
  | { kind: 'pin'; venue: string | null };

/**
 * Element strings are written by the sender's client and read back much
 * later, so anything unrecognised — a retired anchor, a future one arriving
 * on an older build — falls back to the bio rather than rendering a key.
 */
export function parseAnchor(element: string): Anchor {
  if (element === 'trip') {
    return { kind: 'trip' };
  }
  if (element.startsWith('photo')) {
    return { kind: 'photo' };
  }
  if (element === 'languages') {
    return { kind: 'languages' };
  }
  if (element === 'home') {
    return { kind: 'home' };
  }
  if (element.startsWith('prompt:')) {
    return { kind: 'prompt', promptKey: element.slice('prompt:'.length).trim() };
  }
  if (element.startsWith('pin:')) {
    const venue = element.slice('pin:'.length).trim();
    return { kind: 'pin', venue: venue.length > 0 ? venue : null };
  }
  // Before the bio fallback, or a hello anchored on somebody's top priority
  // is announced as being about their bio — which they may not even have.
  if (element === 'priority' || element.startsWith('priority:')) {
    return { kind: 'priority' };
  }
  return { kind: 'bio' };
}

/**
 * Third person, for the line above an opened chat.
 *
 * Deliberately never quotes the profile back: a bio can change, a photo can
 * come down, and a chat is not the place a stale copy of either should live
 * on. Naming the KIND of thing is enough to make the first message make
 * sense again. The one exception is a prompt, where the question is the
 * thing being answered and is not the answer itself.
 */
export function anchorStartedFrom(element: string, name: string | null): string {
  const anchor = parseAnchor(element);
  const whose = name ? `${name}'s` : 'their';
  switch (anchor.kind) {
    case 'trip':
      return 'Started from the dates you share';
    case 'photo':
      return `Started from ${whose} photo`;
    case 'languages':
      return `Started from ${whose} languages`;
    case 'home':
      return `Started from where ${name ?? 'they'} ${name ? 'is' : 'are'} from`;
    case 'prompt':
      return `Started from ${whose} answer to "${promptLabelInline(anchor.promptKey)}"`;
    case 'pin':
      return anchor.venue ? `Started from a pin at ${anchor.venue}` : 'Started from a pin';
    case 'priority':
      return `Started from something on ${whose} list`;
    default:
      return `Started from ${whose} bio`;
  }
}

/**
 * Second person, for the line above an opened chat when the READER is the
 * one the hello was about. No name goes in: for the accepter the name on
 * the chat row is the sender, and the anchor is about the reader's own
 * profile, so a name here would attribute their photo to the other person.
 */
export function anchorTheyStartedFrom(element: string): string {
  return `Started from ${anchorAboutYours(element)}`;
}

/**
 * Which of the two renderers an opened chat's footer gets.
 *
 * The sender reads the third person about the other person's profile; the
 * accepter reads the second person about their own. A null sender id counts
 * as "not me" only when we know who "me" is — with no session (still
 * loading, or a reader the row was never written for) the third-person
 * string is the safe wrong answer, because it never claims the reader's
 * profile started anything.
 */
export function footerAnchor(
  element: string,
  firstMessageSenderId: string | null,
  ownUserId: string | null,
  title: string | null
): string {
  if (ownUserId != null && firstMessageSenderId !== ownUserId) {
    return anchorTheyStartedFrom(element);
  }
  return anchorStartedFrom(element, title);
}

/** Second person, for a hello that has just arrived. */
export function anchorAboutYours(element: string): string {
  const anchor = parseAnchor(element);
  switch (anchor.kind) {
    case 'trip':
      return 'your travel plans';
    case 'photo':
      return 'your photo';
    case 'languages':
      return 'your languages';
    case 'home':
      return 'where you are from';
    case 'prompt':
      return `your answer to "${promptLabelInline(anchor.promptKey)}"`;
    case 'pin':
      return anchor.venue ? `your pin at ${anchor.venue}` : 'your pin';
    case 'priority':
      return 'something on your list';
    default:
      return 'your bio';
  }
}
