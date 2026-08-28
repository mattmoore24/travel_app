import { Redirect } from 'expo-router';

/**
 * The far end of a password-reset email, and it exists mostly so that the
 * root layout gets a chance to run.
 *
 * `resetPassword` sends people to `samewhere://reset-password`, and there was
 * no route by that name — so expo-router matched its top-level `+not-found`
 * wildcard, which is a SIBLING of the `__root` slot. `app/_layout.tsx` never
 * mounted, `useAuthListener` never ran, `parseRecoveryLink` was never called,
 * and the whole `recovery != null` branch and `ResetPasswordScreen` behind it
 * were dead. What the person actually saw, cold start or warm, was expo's
 * "Unmatched Route". Email password reset did not work at all.
 *
 * With the file here the link resolves inside `__root`, the layout mounts,
 * and the recovery branch takes the screen over before this ever renders. So
 * this only draws for a link that carried no usable tokens — one already
 * spent, or opened twice — and the honest thing then is to put them back in
 * the app rather than on a blank screen.
 */
export default function ResetPasswordRoute() {
  return <Redirect href="/" />;
}
