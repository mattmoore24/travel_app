import { Stack, router } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Text } from 'react-native';

const summary = (s: any): any =>
  s == null
    ? null
    : {
        type: s.type,
        index: s.index,
        routes: s.routes?.map((r: any) => ({ name: r.name, child: summary(r.state) })),
      };

it('push("/(tabs)") from Travelers switches to the Map tab', () => {
  const result = renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      '(tabs)/_layout': () => (
        <NativeTabs>
          <NativeTabs.Trigger name="index" />
          <NativeTabs.Trigger name="travelers" />
          <NativeTabs.Trigger name="chat" />
        </NativeTabs>
      ),
      '(tabs)/index': () => <Text>MAP</Text>,
      '(tabs)/travelers': () => <Text>TRAVELERS</Text>,
      '(tabs)/chat': () => <Text>CHAT</Text>,
      'add-trip': () => <Text>ADD TRIP</Text>,
    },
    { initialUrl: '/travelers' }
  );

  console.log('START', result.getPathname(), JSON.stringify(summary(result.getRouterState())));
  act(() => router.push('/(tabs)'));
  console.log('PUSH1', result.getPathname(), JSON.stringify(summary(result.getRouterState())));
  act(() => router.push('/(tabs)'));
  act(() => router.push('/(tabs)'));
  console.log('PUSH3', result.getPathname(), JSON.stringify(summary(result.getRouterState())));
  console.log('canGoBack', router.canGoBack());
  expect(screen).toHavePathname('/');
});
