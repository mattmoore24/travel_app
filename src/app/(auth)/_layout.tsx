import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'welcome',
};

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="email" options={{ headerShown: true, headerTitle: '' }} />
    </Stack>
  );
}
