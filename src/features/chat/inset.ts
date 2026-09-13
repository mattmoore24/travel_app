import { Space } from '@/constants/theme';

/**
 * How far a thread's bubbles sit in from the screen edge, and therefore how
 * far its composer does.
 *
 * One number in one place, because the two drifted: the composer row padded
 * 24 of its own inside a room wrapper's 16 while the bubbles above it were
 * set in 12, so a room's field was 40pt from each edge and 222pt wide on a
 * 402pt screen (E2E run 142, zz-ax5-07). iMessage, WhatsApp and Telegram
 * run the field and the bubbles to one edge; so does this. The thread's
 * list (message-thread) and the composer's row, reply banner, staged photo
 * and saved-reply strip (composer) all read it, and the room's "added you"
 * note above the composer does too.
 */
export const ThreadInset = Space.md;
