import { DEVICE_LOCALE_TAG } from '@/lib/locale';
import { supabase } from '@/lib/supabase';

/**
 * The phone's own language, on the profile, so a verdict about somebody's
 * face or somebody's livelihood can be written in a sentence they read.
 *
 * Two screens in this app render a model's words verbatim to the person they
 * are about: the selfie result on /verification and the storefront result on
 * /business-storefront. Both came back in English. A Thai hostel owner whose
 * storefront photo is refused got a sentence they may not read at the exact
 * moment the app most needs to sound fair rather than arbitrary. The
 * moderation worker now asks for the verdict in the subject's language, and
 * this file is what puts that language on the row.
 *
 * IT DOES NOT ASK THE PHONE. `src/lib/locale.ts` is the one place that calls
 * expo-localization (docs/ARCHITECTURE.md, D5), and the first version of this
 * file was a second caller with a near-verbatim copy of that file's own
 * widening rationale in it. Two callers is how the app ended up with two
 * clocks and two date engines; the guard against a third is a test rather
 * than a review comment (`src/lib/__tests__/one-clock.test.ts`).
 *
 * NOT a profile field, and not shown anywhere. `profiles.locale` carries an
 * UPDATE grant and no SELECT grant at all
 * (20260903010000_a_verdict_speaks_your_language.sql), so the only readers are
 * this write and the worker running as the service role. Nothing renders it,
 * no discovery surface consults it, and no other traveler can ask for it.
 *
 * AND IT IS NOT A PRESENCE SIGNAL, which is not free either: the write fires
 * once per launch, and until 20260903020000 it tripped profiles' updated_at
 * trigger, which IS client-readable for every visible account. See that
 * migration - the client cannot avoid the redundant write itself, because the
 * column it would compare against is deliberately unreadable.
 */

/** The column's own ceiling. A tag longer than this is not a tag. */
const MAX_TAG = 16;

/**
 * The tag to store, or null.
 *
 * NULL IS A REAL ANSWER AND IT MEANS ENGLISH, silently. It must never fall
 * back to a nearest guess: the phone's tag is not necessarily a language the
 * person reads well, and inventing a better guess from a region, a name or an
 * IP is how somebody ends up with a rejection written in a language they do
 * not speak by an app that was sure it knew better. `DEVICE_LOCALE_TAG` is
 * the one export in lib/locale with no fallback, and that is why this reads
 * it rather than `DEVICE_LOCALE`, whose 'en-US' default is exactly the guess
 * this must not make.
 *
 * What is left here is the COLUMN's business: `profiles.locale` takes at most
 * 16 characters (check constraint, 20260903010000), and a blank tag is not a
 * tag. A value the column would refuse becomes null, so a bad answer from the
 * phone costs an English verdict rather than a failed write.
 */
export function deviceLocaleTag(): string | null {
  if (DEVICE_LOCALE_TAG == null) {
    return null;
  }
  const trimmed = DEVICE_LOCALE_TAG.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TAG) {
    return null;
  }
  return trimmed;
}

/**
 * What this process has already written, so a second SIGNED_IN event in the
 * same launch is not a second round trip.
 *
 * Per-process rather than persisted: the whole write is one small update
 * against a row the account already owns, and a stale flag surviving a
 * reinstall would be worse than repeating it once per launch. Keyed by user
 * so signing out and into a different account still writes.
 */
let writtenFor: string | null = null;

/**
 * Write it, once per sign-in.
 *
 * Never throws and never reports: this is bookkeeping beside the push-token
 * refresh, not something a person is waiting on, and a failed write costs an
 * English verdict rather than a broken screen. A null tag writes null, which
 * is what clears a stale locale when somebody changes their phone's language
 * to one it cannot read.
 */
export async function writeDeviceLocale(userId: string): Promise<void> {
  if (writtenFor === userId) {
    return;
  }
  writtenFor = userId;
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ locale: deviceLocaleTag() })
      .eq('user_id', userId);
    if (error) {
      // Let the next launch try again rather than pinning the failure for the
      // life of the process.
      writtenFor = null;
    }
  } catch {
    writtenFor = null;
  }
}
