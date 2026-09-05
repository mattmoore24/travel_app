/**
 * Why a signed-in account's own profile did not load.
 *
 * The root layout replaces the whole navigator when this read fails, and it
 * always said "Check your connection and try again" over a Try again button.
 * For the one case that is not a connection - the row is genuinely gone,
 * deleted on another device, swept by the guest janitor, removed by an admin -
 * that button can never succeed, and the person is left tapping it.
 *
 * `PostgrestError` is not an `Error`, so `catch (e) { if (e instanceof Error) }`
 * swallows every database message (traps, change-review). The code is read off
 * the object instead, defensively: this runs on an error whose shape nobody
 * has promised.
 */
export type AccountLoadFailure = 'gone' | 'network';

/** The codes that mean "there is no such row, or you are not it any more". */
const GONE_CODES = new Set([
  // .single() with no rows — what fetchOwnProfile throws for a deleted row.
  'PGRST116',
  // JWT expired / not acceptable: this session is not anybody any more.
  'PGRST301',
]);

/**
 * 42501 is NOT here, and that is the point.
 *
 * It is insufficient_privilege: a missing or revoked GRANT, not a missing
 * row. This project has already shipped a migration that revoked a table and
 * failed to re-state one column's grant, and it took three e2e runs and a
 * wrong production warning to find. If that happened to profiles, every
 * signed-in person's fetchOwnProfile would raise 42501 at once — and with
 * 42501 in this set, the root layout would tell all of them "This account has
 * been closed. We cannot find it any more", which is a lie, and one that
 * sends people to support instead of showing a Try again.
 *
 * A grant regression is an outage. An outage should read as a transient
 * failure, because that is what it is.
 */

export function accountLoadFailure(error: unknown): AccountLoadFailure {
  if (error == null || typeof error !== 'object') {
    return 'network';
  }
  const shape = error as { code?: unknown; status?: unknown };
  if (typeof shape.code === 'string' && GONE_CODES.has(shape.code)) {
    return 'gone';
  }
  // AuthError and a raw fetch failure both carry a numeric status; a
  // PostgrestError does not, which is why the code list above exists at all.
  const status = typeof shape.status === 'number' ? shape.status : Number(shape.status);
  if (status === 401 || status === 403 || status === 404) {
    return 'gone';
  }
  return 'network';
}
