import { router } from 'expo-router';

import { ContactForm } from '@/features/support/contact-form';

/**
 * Reaching a human, without the app printing anybody's personal address.
 *
 * Open to guests on purpose: someone who cannot sign in is exactly the
 * person most likely to need to write in. The form itself lives in
 * features/support/contact-form so the account gate can render it with no
 * navigator mounted, which is the other case of the same idea.
 */
export default function ContactScreen() {
  return (
    <ContactForm
      onDone={() => router.back()}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
    />
  );
}
