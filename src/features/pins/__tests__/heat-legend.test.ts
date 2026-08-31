import { LEGEND_REARM_MS, legendDismissed, legendKey } from '@/features/pins/heat-legend';

// The one-shot legends used to store a bare '1' under a device-wide key:
// "re-arm after 60 days" was inexpressible, and a guest-then-signup on one
// phone inherited the other identity's dismissals.

const NOW = Date.parse('2026-08-31T12:00:00Z');

describe('legendDismissed', () => {
  it('holds inside the re-arm window', () => {
    const yesterday = new Date(NOW - 24 * 3_600_000).toISOString();
    expect(legendDismissed(yesterday, NOW)).toBe(true);
  });

  it('re-arms once a dismissal is older than sixty days', () => {
    const old = new Date(NOW - LEGEND_REARM_MS - 1).toISOString();
    expect(legendDismissed(old, NOW)).toBe(false);
  });

  it('treats nothing stored as never dismissed', () => {
    expect(legendDismissed(null, NOW)).toBe(false);
  });

  it('treats an unreadable value as never dismissed, not as forever', () => {
    // The legacy '1' lives under the old un-scoped keys and never reaches
    // here; anything unparseable costs one extra read, then overwrites.
    expect(legendDismissed('not a date', NOW)).toBe(false);
  });
});

describe('legendKey', () => {
  it('scopes the dismissal to the account', () => {
    // A different user on the same phone sees an un-dismissed legend.
    expect(legendKey('samewhere.heat.legend.v2', 'user-a')).not.toBe(
      legendKey('samewhere.heat.legend.v2', 'user-b')
    );
  });

  it('gives the signed-out state a stable key of its own', () => {
    expect(legendKey('samewhere.heat.legend.v2', null)).toBe('samewhere.heat.legend.v2.anon');
  });
});
