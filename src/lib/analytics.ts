import * as Updates from 'expo-updates';
import { PostHog } from 'posthog-react-native';

// Liquidity metrics from day one (brief §6). No-ops until
// EXPO_PUBLIC_POSTHOG_API_KEY exists, so dev without keys stays quiet.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
// EU by default: the first launch city is in the EU and the privacy policy
// says the data lives there, which was true of Supabase and false of
// analytics while this defaulted to us.i.posthog.com. A key made on the US
// cloud will not answer here — the project must be created in the EU region.
// `||`, never `??`: the publish workflows inline the HOST secret verbatim,
// and a secret that was never created inlines as the EMPTY STRING — which
// `??` accepts, handing PostHog host '' and losing every event silently.
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

const client = apiKey ? new PostHog(apiKey, { host }) : null;

// Loud in dev, the way src/lib/supabase.ts is about its pair: a missing key
// is a silent no-op on every capture(), which is how the app shipped with
// four of the six §6 metrics reading zero and nobody noticing.
if (!client && __DEV__) {
  console.warn(
    'PostHog key missing. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_POSTHOG_API_KEY, or every analytics.capture() is a no-op.'
  );
}

type EventProperties = Record<string, string | number | boolean | null>;

/**
 * Which JavaScript is running, derived once and shared with `BuildStamp` so
 * the id a person reads off the screen and the id on the chart cannot
 * disagree.
 *
 * This exists because the project ships JS over the air daily while
 * PostHog's own `$app_version` comes from the NATIVE binary — so without it
 * a week of updates all look like one release, and no metric change is
 * attributable to the update that caused it. An update is never applied on
 * the launch that downloads it (see the traps skill), so `update_id` is the
 * code that actually ran, not the code that was published most recently.
 *
 * Read at module load rather than per event: neither value can change
 * without a relaunch, and a relaunch re-imports this module.
 */
export const release = {
  /** True when the running bundle came out of the binary, not out of an update. */
  isEmbedded: Updates.isEmbeddedLaunch || !Updates.updateId,
  /** Short form, the same eight characters BuildStamp prints. */
  updateId: Updates.updateId ? Updates.updateId.slice(0, 8) : null,
};

/**
 * Properties on EVERY event, whoever fires it, for the whole life of the
 * process. Release identity only: nothing here is account-scoped, so
 * `reset()` must not clear it.
 */
const base: EventProperties = {
  update_id: release.updateId,
  is_embedded: release.isEmbedded,
};

/**
 * Account-scoped context, merged into every capture until the account
 * changes.
 *
 * A module-level object rather than PostHog's `register()` super-properties,
 * deliberately: `register` is async, persists to storage, and survives a
 * process the app did not choose to survive — so a stale `account_type` from
 * the PREVIOUS account can outlive the sign-out that was supposed to end it.
 * A plain object is cleared by `reset()` in the same tick, which is the
 * privacy-relevant half of this file.
 */
let context: EventProperties = {};

/**
 * The last id handed to `identify()`, so a token refresh cannot mint another
 * `$identify`.
 *
 * `onAuthStateChange` fires INITIAL_SESSION on every cold start and
 * TOKEN_REFRESHED roughly hourly, and each one used to be a fresh identify
 * call for an id that had not changed.
 */
let identified: string | null = null;

/**
 * Mirror of the SDK's persisted opt-out, so the setting can be read back
 * before the client has finished loading its own storage (and so the whole
 * module still behaves without a key, where `client` is null).
 *
 * SEEDED FROM THE SDK, not from false. The persisted answer is the person's
 * actual choice, and a mirror that starts false every launch made this
 * mirror actively harmful rather than merely stale: `reset()` below only
 * re-states the opt-out when the mirror says it is on, so a sign-out on a
 * launch where nobody had touched the setting yet saw false, skipped the
 * re-state, and let PostHog's own reset clear a choice made weeks earlier.
 * The setting silently turned itself back on.
 *
 * `optedOut` is a getter on the core client (@posthog/core
 * posthog-core-stateless.d.ts:129), read here rather than assumed. Wrapped
 * because it reads storage that may not have loaded yet on the very first
 * tick, and a throw here would take the whole module with it.
 */
let optedOut = (() => {
  try {
    return client?.optedOut ?? false;
  } catch {
    return false;
  }
})();

export const analytics = {
  /** §6 events: trip_created, travelers_viewed, request_sent, request_responded… */
  capture(event: string, properties?: EventProperties) {
    // Context first, the call site's own properties last: an event that
    // names a property itself (map_viewed's city_id) is the more specific
    // truth and wins.
    client?.capture(event, { ...base, ...context, ...properties });
  },

  /**
   * Add to the properties carried by every subsequent event.
   *
   * Merges rather than replaces, because the two facts that live here settle
   * at different moments: the account kind is known as soon as there is a
   * session, the city only once the map has one selected.
   *
   * NOTHING IDENTIFYING GOES IN HERE. City, account type and release are the
   * point; a display name, an email, a handle, a message body, a business
   * name or a raw user id are not, and this object multiplies whatever it
   * holds by every event in the app. docs/PROGRESS.md records a shipped bug
   * where a real traveler's display name reached analytics from a signed-out
   * screen; that was one call site, and this would be all of them.
   */
  setContext(properties: EventProperties) {
    context = { ...context, ...properties };
  },

  /**
   * Bind this device's events to a stable id.
   *
   * Guarded on the id itself: calling it twice with the same id is a no-op,
   * so a token refresh or a cold start's INITIAL_SESSION no longer sends an
   * `$identify` that says nothing new.
   *
   * NOT called with a raw Supabase auth uid — see the note in
   * src/features/auth/use-auth-listener.ts. It takes an OPAQUE id, and the
   * only opaque id that exists today is the one PostHog generates per
   * install for itself.
   */
  identify(distinctId: string) {
    if (distinctId === identified) {
      return;
    }
    identified = distinctId;
    client?.identify(distinctId);
  },

  /**
   * End the current account's analytics identity.
   *
   * Clears the context as well as the id, and that is the assertion this
   * function exists for: without it the next account on the device inherits
   * the previous one's `account_type` and city, and a business signing in
   * after a traveler counts as a traveler for as long as the process lives.
   * `base` survives on purpose — the release is a property of the running
   * code, not of whoever is signed in.
   */
  reset() {
    identified = null;
    context = {};
    client?.reset();
    // PostHog's own reset clears the persisted opt-out with everything else,
    // so somebody who turned analytics off and then signed out would be
    // silently turned back on. Re-state it.
    if (optedOut) {
      void client?.optOut();
    }
  },

  /** Whether this device has analytics switched off. */
  optedOut(): boolean {
    return optedOut;
  },

  /**
   * Turn analytics off, or back on.
   *
   * Wired to the SDK's own opt-out rather than to dropping the key: opting
   * out has to be revocable (App Store 5.1.1(i) asks the policy to say how
   * consent is withdrawn), and it has to hold across a relaunch, which is
   * what the SDK persists for us.
   */
  setOptedOut(next: boolean) {
    optedOut = next;
    if (next) {
      void client?.optOut();
    } else {
      void client?.optIn();
    }
  },
};
