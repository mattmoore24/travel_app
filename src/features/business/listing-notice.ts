import type { BusinessState } from '@/lib/database.types';

/**
 * What the map tells an owner whose own chip is not on it.
 *
 * A business lands on a map of its own city, and when its listing is absent
 * the code has always known exactly why — the state is right there on
 * my_business() — and said nothing. One sentence per state, and only the
 * state the owner can fix themselves carries a tap (into /business-email).
 *
 * 'listed' is here for totality: the map never renders it, because a listed
 * business is answered by its own chip rather than by a card about it.
 */
export type ListingNotice = {
  line: string;
  detail: string;
  /** True only when tapping the card can do something about it. */
  pressable: boolean;
};

export function listingNotice(state: BusinessState): ListingNotice {
  switch (state) {
    case 'unconfirmed':
      return {
        line: 'Your business is not on the map yet.',
        detail: 'Confirm your email to put it here.',
        pressable: true,
      };
    case 'flagged':
      return {
        line: 'We are checking your listing.',
        detail: 'It goes on the map once that is done.',
        pressable: false,
      };
    case 'removed':
      return {
        line: 'Your listing is off the map.',
        detail: 'Contact us from My business if that seems wrong.',
        pressable: false,
      };
    case 'listed':
      return {
        line: 'Your business is on the map.',
        detail: 'Tap your ringed chip to see it as travelers do.',
        pressable: false,
      };
  }
}
