import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function OnboardingLayout() {
  return (
    <Stack
      // No native header, matching (auth). StepShell draws its own back
      // chevron and progress bar, so the native one was an empty bar — and
      // an expensive one: react-native-screens starts the screen's content
      // BELOW a visible non-translucent header, while KeyboardAvoidingView
      // measures its frame against its parent, so the footer holding
      // Continue was lifted about a hundred points short and sat behind the
      // keyboard. Steps 3 and 4 autofocus their first field, so the keyboard
      // is already up when you arrive. The identical shell has always worked
      // at /join for exactly this reason: that stack sets headerShown false.
      screenOptions={{ headerShown: false }}
    />
  );
}
