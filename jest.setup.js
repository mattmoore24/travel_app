/* eslint-env jest */
// Native AsyncStorage has no JS implementation under Jest; use the official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Reanimated pulls in react-native-worklets, whose native module does not
// exist under Jest: importing anything that touches it dies on "Cannot read
// properties of undefined (reading 'loadUnpackers')". That is why the chat
// separators were pulled into their own file — it was the only way to test
// anything in that folder at all.
//
// Reanimated's own mock does not help, because it re-imports the real index
// on its way in. So this is a stub of the surface the app actually uses:
// Animated views that render as plain views, entrance descriptors that are
// inert, and shared values that are ordinary objects. It is deliberately
// small — if a component needs more than this, add it here rather than
// reaching for the package's mock.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView, FlatList, Image } = require('react-native');

  const passthrough = (Component) => {
    const Wrapped = React.forwardRef((props, ref) => {
      // Entrance/exit descriptors mean nothing without a native driver.
      const { entering, exiting, layout, ...rest } = props;
      return React.createElement(Component, { ...rest, ref });
    });
    Wrapped.displayName = `Animated(${Component.displayName ?? Component.name ?? 'View'})`;
    return Wrapped;
  };

  const descriptor = () => {
    const chain = {};
    for (const key of ['duration', 'delay', 'springify', 'mass', 'stiffness', 'damping']) {
      chain[key] = () => chain;
    }
    return chain;
  };
  const entrance = () => Object.assign(descriptor(), { duration: () => descriptor() });

  const Animated = passthrough(View);
  Animated.View = passthrough(View);
  Animated.Text = passthrough(Text);
  Animated.Image = passthrough(Image);
  Animated.ScrollView = passthrough(ScrollView);
  Animated.FlatList = passthrough(FlatList);
  Animated.createAnimatedComponent = passthrough;

  return {
    __esModule: true,
    default: Animated,
    FadeIn: entrance(),
    FadeOut: entrance(),
    FadeInDown: entrance(),
    FadeInRight: entrance(),
    FadeOutLeft: entrance(),
    SlideInDown: entrance(),
    SlideOutDown: entrance(),
    Easing: { inOut: () => () => 0, quad: () => 0 },
    useSharedValue: (initial) => ({ value: initial }),
    useAnimatedStyle: (factory) => factory(),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    useAnimatedScrollHandler: () => () => {},
    useDerivedValue: (factory) => ({ value: factory() }),
    withSpring: (to) => to,
    withTiming: (to) => to,
    withRepeat: (to) => to,
    withSequence: (to) => to,
    interpolate: (value) => value,
    runOnJS: (fn) => fn,
    // Reduce Motion: the enum theme.ts stamps on every Springs preset, and
    // the hook the two infinite loops (skeleton, intro glow) gate on. The
    // test that flips the hook to true supplies its own per-file mock.
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useReducedMotion: () => false,
  };
});

// Gesture handler, stubbed to the surface the app uses: a builder chain that
// records nothing, a detector that renders its child, and a root view that is
// a view. The package ships its own jestSetup, and it is not enough here — it
// installs the native shims and then GestureDetector reaches into Reanimated's
// useEvent, which the stub above deliberately does not implement. Following
// this file's own rule is both smaller and less of a lie: nothing under test
// asserts on a gesture, only that a sheet containing one renders at all.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');

  const builder = () => {
    const chain = {};
    for (const key of ['onUpdate', 'onEnd', 'onBegin', 'onStart', 'onFinalize', 'enabled']) {
      chain[key] = () => chain;
    }
    return chain;
  };

  const GestureDetector = ({ children }) => children;
  const GestureHandlerRootView = ({ children, ...rest }) =>
    React.createElement(View, rest, children);

  return {
    __esModule: true,
    Gesture: { Pan: builder, Tap: builder, LongPress: builder, Simultaneous: builder },
    GestureDetector,
    GestureHandlerRootView,
    State: {},
    Directions: {},
  };
});
