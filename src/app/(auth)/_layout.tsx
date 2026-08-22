import { Stack } from 'expo-router';

export const unstable_settings = {
  // Every gate in the app pushes /join or /email directly; there is no
  // separate welcome page any more. Its two live pieces — Sign in with
  // Apple and the community-guidelines line — now sit on both of those
  // screens, where the account is actually made.
  initialRouteName: 'join',
};

export default function AuthLayout() {
  return (
    // A nested Stack does not inherit the root's screenOptions, which is why
    // the back button on this group read "join" — the route group's own name,
    // shown to the user.
    <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="join" />
      <Stack.Screen
        name="email"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
    </Stack>
  );
}
