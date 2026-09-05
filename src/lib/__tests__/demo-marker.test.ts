import { splitDemoMarker } from '@/lib/demo-marker';

/**
 * The disclosure is the point: `isDemo` must be true whenever the marker was
 * present, or the app shows an AI-generated portrait with no marker at all.
 * And the stripped text must never carry the token, or it ends up quoted
 * inside somebody's first message.
 */
describe('splitDemoMarker', () => {
  it('strips a trailing [demo] and reports it', () => {
    const { bio, isDemo } = splitDemoMarker('Coffee first, plans later. [demo]');
    expect(isDemo).toBe(true);
    expect(bio).toBe('Coffee first, plans later.');
  });

  it('handles whitespace around the marker', () => {
    const { bio, isDemo } = splitDemoMarker('Learning to surf badly.   [demo]   ');
    expect(isDemo).toBe(true);
    expect(bio).toBe('Learning to surf badly.');
    expect(bio).not.toContain('[demo]');
  });

  it('leaves a real bio alone', () => {
    const { bio, isDemo } = splitDemoMarker('Architect, so I will make you look at a building.');
    expect(isDemo).toBe(false);
    expect(bio).toBe('Architect, so I will make you look at a building.');
  });

  it('does not strip the token mid-sentence, only as a trailing marker', () => {
    const { bio, isDemo } = splitDemoMarker('I saw [demo] on a sign once. True story.');
    expect(isDemo).toBe(false);
    expect(bio).toBe('I saw [demo] on a sign once. True story.');
  });

  it('returns null for a null, empty, or marker-only bio', () => {
    expect(splitDemoMarker(null)).toEqual({ bio: null, isDemo: false });
    expect(splitDemoMarker('')).toEqual({ bio: null, isDemo: false });
    expect(splitDemoMarker('[demo]')).toEqual({ bio: null, isDemo: true });
  });
});
