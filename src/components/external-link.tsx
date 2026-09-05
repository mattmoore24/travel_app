import { Href, Link } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { type ComponentProps } from 'react';

/**
 * The one place the in-app browser's presentation is decided.
 *
 * On iOS this is an SFSafariViewController: it comes up over the app with a
 * Done button, and dismissing it lands the reader back on the exact screen
 * they left, scroll position and all. `Linking.openURL` instead hands them to
 * Safari and the way back is the app switcher, which is two gestures somebody
 * reading a bar's menu at 9pm has to think about.
 *
 * NOT for every link. A social handle or a booking page is an https URL the
 * native Instagram, TikTok, WhatsApp or OpenTable app claims as a universal
 * link, and an in-app browser steals it into a signed-out web view, which is
 * strictly worse than leaving. Those go through `Linking.openURL`. See
 * `opensInAppBrowser` in src/features/business/links.ts for the rule.
 */
export async function openInAppBrowser(url: string) {
  await openBrowserAsync(url, {
    presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
  });
}

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: Href & string };

export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={async (event) => {
        if (process.env.EXPO_OS !== 'web') {
          // On the web the anchor does the right thing already; on native the
          // default is Safari, which is the behaviour this component exists
          // to replace.
          event.preventDefault();
          await openInAppBrowser(href);
        }
      }}
    />
  );
}
