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

export const analytics = {
  /** §6 events: trip_created, travelers_viewed, request_sent, request_responded… */
  capture(event: string, properties?: EventProperties) {
    client?.capture(event, properties);
  },
  identify(userId: string) {
    client?.identify(userId);
  },
  reset() {
    client?.reset();
  },
};
