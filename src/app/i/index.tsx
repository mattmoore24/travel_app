import { Redirect } from 'expo-router';

/**
 * https://link.samewhere.io/i with no token. The association file claims
 * `/i/*`, and `*` matches nothing as happily as it matches a token, so iOS
 * hands this path to the app too. A dynamic segment never renders empty, so
 * without this file it resolves to +not-found and tells the reader their
 * invite expired. The map is a better answer than a lie.
 */
export default function InviteWithoutToken() {
  return <Redirect href="/(tabs)" />;
}
