import { PostHog } from 'posthog-react-native';

// Liquidity metrics from day one (brief §6). No-ops until
// EXPO_PUBLIC_POSTHOG_API_KEY exists, so dev without keys stays quiet.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const client = apiKey ? new PostHog(apiKey, { host }) : null;

type EventProperties = Record<string, string | number | boolean | null>;

export const analytics = {
  /** §6 events: trip_created, matches_viewed, request_sent, request_responded… */
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
