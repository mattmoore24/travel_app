import { render, screen } from '@testing-library/react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';

/**
 * Build-hygiene insurance, and the test IS the deliverable: nothing in the
 * E2E suite can reach this state. Five screens used to render a code-styled
 * 'waiting on backend keys' badge over .env instructions. For an EAS build
 * that genuinely cannot ship — the flag is a build-time check on inlined
 * EXPO_PUBLIC_ vars — but this project ships JavaScript over the air, and an
 * OTA bundle published by a workflow run missing those secrets ships the
 * flag false to every phone on the channel. What they see must be a written
 * sentence, never a support ticket addressed to a developer.
 */

const ICON = { ios: 'map.fill', android: 'map', web: 'map' } as const;

declare const global: { __DEV__: boolean };

describe('the config-error placeholder in a production bundle', () => {
  const devWas = global.__DEV__;
  afterEach(() => {
    global.__DEV__ = devWas;
  });

  it('renders the written sentence and no code badge', () => {
    global.__DEV__ = false;
    render(<PlaceholderScreen configError icon={ICON} />);
    expect(screen.getByText("Can't reach Samewhere")).toBeTruthy();
    expect(
      screen.getByText('Something is wrong on our end. Try again in a few minutes.')
    ).toBeTruthy();
    expect(screen.queryByText('waiting on backend keys')).toBeNull();
  });

  it('never renders any phase badge outside a dev bundle', () => {
    global.__DEV__ = false;
    render(
      <PlaceholderScreen icon={ICON} title="Somewhere" description="A screen." phase="phase 9" />
    );
    expect(screen.queryByText('phase 9')).toBeNull();
  });

  it('still shows the badge to a developer, where it is useful', () => {
    global.__DEV__ = true;
    render(<PlaceholderScreen configError icon={ICON} />);
    expect(screen.getByText('waiting on backend keys')).toBeTruthy();
    // The person-facing sentence stays either way.
    expect(screen.getByText("Can't reach Samewhere")).toBeTruthy();
  });
});
