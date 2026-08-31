/**
 * Importing the push module installs the foreground handler. Without one,
 * expo-notifications presents nothing while the app is open, so a message
 * arriving mid-browse was completely silent — and a wrong field name fails
 * just as silently, which is why the exact keys are pinned here.
 */

const mockSetHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (handler: unknown) => mockSetHandler(handler),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

it('module import sets a handler that shows banners in the foreground', async () => {
  jest.isolateModules(() => {
    // A static import would hoist above the mock and dodge isolateModules;
    // the side effect under test IS the import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/features/notifications/push');
  });

  expect(mockSetHandler).toHaveBeenCalledTimes(1);
  const { handleNotification } = mockSetHandler.mock.calls[0][0] as {
    handleNotification: () => Promise<Record<string, boolean>>;
  };
  await expect(handleNotification()).resolves.toEqual({
    // The SDK 57 names: shouldShowAlert is deprecated and split into these
    // two, and a stale key would mean silence with no error.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  });
});
