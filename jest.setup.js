/* eslint-env jest */
// Native AsyncStorage has no JS implementation under Jest; use the official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
