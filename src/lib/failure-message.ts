/**
 * What to say to a person when something did not load or did not save.
 *
 * Two rules. A dropped connection is by far the commonest failure on the
 * road, and it is not the traveller's fault or the database's, so it gets its
 * own sentence instead of a stack frame. And a message the DATABASE wrote is
 * already a sentence somebody chose ("already connected with this traveler",
 * "trip is entirely in the past") — those are worth showing verbatim. What is
 * never worth showing is the transport's own words, which is what a traveller
 * on hostel wifi used to get: "Could not save: TypeError: Network request
 * failed".
 */

/** Anything that means "the request never reached the server". */
export function isOffline(error: unknown): boolean {
  const message = (error as { message?: unknown })?.message;
  const status = (error as { status?: unknown })?.status;
  if (status === 0) {
    return true;
  }
  if (typeof message !== 'string') {
    return false;
  }
  return /network request failed|failed to fetch|networkerror|fetcherror|timeout|typeerror/i.test(
    message
  );
}

const OFFLINE = 'No connection. This one needs the internet.';

/** For a mutation the user just triggered: something they tried to save. */
export function saveFailureMessage(error: unknown): string {
  if (isOffline(error)) {
    return OFFLINE;
  }
  const raw = (error as { message?: unknown })?.message;
  return typeof raw === 'string' && raw.trim() ? raw : 'Something went wrong. Try that again.';
}

/** For a query that failed: something the screen wanted to show. */
export function loadFailureMessage(error: unknown, what: string): string {
  if (isOffline(error)) {
    return `No connection, so ${what} could not load.`;
  }
  return `${what[0].toUpperCase()}${what.slice(1)} could not load.`;
}
