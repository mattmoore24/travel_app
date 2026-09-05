import type { ChatListRow } from '@/lib/database.types';

/**
 * Finding "the Lisbon dorm one" in an inbox with a dozen rooms in it.
 *
 * Client-side and deliberately so: my_chats already returns the whole list a
 * person can see, it is short, and the three fields worth searching are on
 * every row. A server-side ilike would be a round trip per keystroke for a
 * list that is already in memory.
 *
 * What it looks at is what the row actually SHOWS: the title, the preview
 * line, and the opening message, which is the only text a chat that has not
 * been answered yet has. Nothing here searches inside a thread — that needs an
 * RPC scoped to one chat and a way to jump to the result, and it is a
 * different feature.
 */
/**
 * How many conversations there have to be before a search field earns its
 * place. Four rows do not need finding; a dozen across three cities do, which
 * is the inbox the finding describes. Below it the field is not rendered at
 * all rather than rendered empty, so a new account's Chats tab stays as quiet
 * as it is now.
 */
export const SEARCH_APPEARS_AT = 8;

export function filterChats(chats: ChatListRow[], query: string): ChatListRow[] {
  const needle = query.trim().toLowerCase();
  // An empty field is not a filter. Identity rather than a copy, so a caller
  // that splits pinned rows from the rest is doing it to the same array it
  // was given.
  if (needle.length === 0) {
    return chats;
  }
  return chats.filter((chat) =>
    [chat.title, chat.last_message, chat.first_message].some(
      (field) => field != null && field.toLowerCase().includes(needle)
    )
  );
}
