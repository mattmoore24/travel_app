import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';

import { SignUpGate } from '@/components/ui/sign-up-gate';

/**
 * The gate leads with the invitation. `reason` carries what you get, in the
 * imperative; the caveat lives in `detail`, in small print under it — and
 * the compact card carries no doubled bottom spacing of its own.
 */
const SRC = path.join(__dirname, '..', '..', '..');
const read = (file: string): string => fs.readFileSync(path.join(SRC, file), 'utf8');

describe('SignUpGate', () => {
  it('renders the reason and the detail, in that order', () => {
    render(
      <SignUpGate
        reason="Put your plan on the map"
        detail="Your name and photo go on the pin, so people know who they are meeting. It disappears within three days."
        where="test-gate"
        compact
      />
    );
    expect(screen.getByText('Put your plan on the map')).toBeTruthy();
    expect(
      screen.getByText(
        'Your name and photo go on the pin, so people know who they are meeting. It disappears within three days.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Takes a minute. Always free.')).toBeTruthy();
  });

  it('renders no detail row when none is given', () => {
    render(<SignUpGate reason="Join the plan and the chat" where="test-gate" compact />);
    expect(screen.getByText('Join the plan and the chat')).toBeTruthy();
    expect(screen.queryByText(/name and photo/)).toBeNull();
  });

  it('the compact variant carries no spacing of its own', () => {
    const gate = read('components/ui/sign-up-gate.tsx');
    expect(gate).toMatch(/compact: \{\},/);
    expect(gate).not.toContain('marginTop: Space.sm');
  });

  it('the map gates lead with the invitation, not the privacy warning', () => {
    const map = read('features/pins/map-screen.tsx');
    expect(map).toContain("'Put your plan on the map'");
    expect(map).toContain("'Join the plan and the chat'");
    expect(map).not.toContain('Pins come with your name on them');
    expect(map).not.toContain('Joining puts you in the chat, with a name');
    // The disclosure survives, as the small print it always should have been.
    expect(map).toContain('Your name and photo go on the pin');
    // The pin-card gate already had the right shape.
    expect(map).toContain(`reason="See who's going and say hi"`);
  });

  it('the contract is written where the next writer will look', () => {
    const gate = read('components/ui/sign-up-gate.tsx');
    expect(gate).toContain('"what do I get"');
    expect(gate).toContain('detail?: string;');
  });
});
