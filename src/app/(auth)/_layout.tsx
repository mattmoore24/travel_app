import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'welcome',
};

export default function AuthLayout() {
  return (
    // A nested Stack does not inherit the root's screenOptions, which is why
    // the back button on this group read "join" — the route group's own name,
    // shown to the user.
    <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="join" />
      <Stack.Screen
        name="email"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
    </Stack>
  );
}
