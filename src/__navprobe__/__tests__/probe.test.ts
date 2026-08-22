import { getRoutes } from 'expo-router/build/getRoutes';
import { getReactNavigationConfig } from 'expo-router/build/getReactNavigationConfig';
import { inMemoryContext } from 'expo-router/build/testing-library/context-stubs';
import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { findDivergentState } from 'expo-router/build/global-state/stateUtils';

it('probe', () => {
  const ctx = inMemoryContext({
    './_layout': () => null,
    './(tabs)/_layout': () => null,
    './(tabs)/index': () => null,
    './(tabs)/travelers': () => null,
    './(tabs)/chat': () => null,
    './add-trip': () => null,
    './drop-pin': () => null,
  });
  const routes = getRoutes(ctx, { platform: 'ios' } as any);
  const config = getReactNavigationConfig(routes as any, true);
  // eslint-disable-next-line no-console
  console.log('TABSCONFIG', JSON.stringify((config as any).screens['(tabs)'], (k: string, v: any) => (k === '_route' ? undefined : v)));
  for (const href of ['/(tabs)', '/', '/travelers']) {
    const state = getStateFromPath(href, config as any);
    console.log('HREF', href, JSON.stringify(state));
  }

  // Simulate: currently on the Travelers tab inside the root stack.
  const rootState: any = {
    type: 'stack',
    key: 'stack-root',
    index: 0,
    routeNames: ['(tabs)', 'add-trip'],
    routes: [
      {
        key: 'tabs-1',
        name: '(tabs)',
        state: {
          type: 'tab',
          key: 'tab-1',
          index: 1,
          routeNames: ['index', 'travelers', 'chat'],
          routes: [
            { key: 'index-1', name: 'index' },
            { key: 'travelers-1', name: 'travelers' },
            { key: 'chat-1', name: 'chat' },
          ],
        },
      },
    ],
  };
  const action = getStateFromPath('/(tabs)', config as any);
  const div = findDivergentState(action as any, rootState, false);
  console.log('DIVERGENT navigatorType', div.navigationState?.type, 'navigatorKey', div.navigationState?.key, 'actionRoute', JSON.stringify(div.actionStateRoute));
});
