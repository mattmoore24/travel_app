import fs from 'node:fs';
import path from 'node:path';
import { between } from '@/lib/__tests__/source';

/**
 * A locale nothing writes, or a locale nothing reads, is the same bug twice.
 *
 * `profiles.locale` is a column stamped by the client and read by the
 * moderation worker, and neither half is visible to the other's tests: the
 * write is one line inside an auth event, and the worker has no test harness
 * in this repo at all. Source-reading is what closes that, the same way
 * src/app/__tests__/moderation-worker-queues.test.ts closes the gap between a
 * migration opening a queue and a worker draining it.
 *
 * The last assertion here is the one about restraint. NOTHING CHANGES ON THE
 * MESSAGE PATH: apply_message_verdict never shows the model's reason to
 * anybody, so a `reason_en` on MessageVerdict would be a translation of a
 * sentence nobody is allowed to read, and the first step toward showing it.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const worker = src('supabase/functions/moderation-worker/index.ts');

describe('the phone writes its language', () => {
  const listener = src('src/features/auth/use-auth-listener.ts');

  it('from the one place that fires once per sign-in', () => {
    expect(listener).toContain("from '@/lib/device-locale'");
    const branch = between(
      listener,
      "if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {",
      "if (event === 'SIGNED_OUT') {"
    );
    expect(branch).toContain('writeDeviceLocale(session.user.id)');
  });
});

describe('the worker reads it', () => {
  it('asks for an English copy of both verdicts a person is shown', () => {
    const verification = between(
      worker,
      'const VerificationVerdict = z.object({',
      'const StorefrontVerdict = z.object({'
    );
    const storefront = between(
      worker,
      'const StorefrontVerdict = z.object({',
      'const ImpersonationVerdict = z.object({'
    );
    // Required, not optional. An appeal about somebody's face or somebody's
    // livelihood has to be readable by the person adjudicating it, and an
    // optional field is absent exactly when it matters.
    expect(verification).toContain('reason_en: z.string(),');
    expect(verification).not.toContain('reason_en: z.string().optional()');
    expect(storefront).toContain('reason_en: z.string(),');
    expect(storefront).not.toContain('reason_en: z.string().optional()');
  });

  it('passes the subject their own language, in both queues', () => {
    expect(worker).toContain('languageLine(await localeOf(verification.user_id))');
    expect(worker).toContain('languageLine(await localeOf(business?.owner_user_id))');
    expect(worker).toContain("from('profiles')");
    expect(worker).toContain("select('locale')");
  });

  it('leaves the hardcoded failsafes in English, with reason_en the same string', () => {
    // A failsafe fires because something already failed ten times over. It is
    // not the place to add a translation round trip that can be the eleventh.
    for (const line of [
      'We could not process your selfie. Please try again.',
      'Add at least one profile photo before verifying.',
      'We could not review this selfie. Please try a different photo.',
      'We could not process those photos. Have another go.',
      'We could not review those photos automatically.',
    ]) {
      expect(worker).toContain(`reason: '${line}',`);
      expect(worker).toContain(`reason_en: '${line}',`);
    }
  });

  it('changes nothing on the message path', () => {
    const message = between(
      worker,
      'const MessageVerdict = z.object({',
      'const PhotoVerdict = z.object({'
    );
    expect(message).not.toContain('reason_en');
  });
});
