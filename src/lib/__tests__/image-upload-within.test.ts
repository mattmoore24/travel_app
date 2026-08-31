/**
 * The upload pipeline's stages are bounded. This tests the property, not the
 * network: a stage that settles wins, a stage that hangs is rejected with the
 * stage named, and a stage that fails keeps its own error.
 */
import { withinForTests as within } from '@/lib/image-upload';

describe('a photo upload stage cannot hang', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a settled value straight through', async () => {
    await expect(within(1000, 'sending it', Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('names the stuck stage after the deadline', async () => {
    const never = new Promise(() => {});
    const raced = within(1000, 'sending it', never);
    const failure = expect(raced).rejects.toThrow(
      'The photo did not go through. It got stuck while sending it, so try again.'
    );
    jest.advanceTimersByTime(1001);
    await failure;
  });

  it('keeps the original error when the stage fails on its own', async () => {
    const raced = within(1000, 'sending it', Promise.reject(new Error('storage said no')));
    await expect(raced).rejects.toThrow('storage said no');
  });
});
