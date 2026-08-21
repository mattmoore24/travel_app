import { isOffline, loadFailureMessage, saveFailureMessage } from '@/lib/failure-message';

describe('what a person is told when something fails', () => {
  it('recognises a dropped connection however it is dressed', () => {
    expect(isOffline(new TypeError('Network request failed'))).toBe(true);
    expect(isOffline({ message: 'Failed to fetch' })).toBe(true);
    expect(isOffline({ status: 0, message: '' })).toBe(true);
  });

  it('does not mistake a real answer from the database for one', () => {
    expect(isOffline({ message: 'already connected with this traveler' })).toBe(false);
    expect(isOffline({ message: 'trip is entirely in the past' })).toBe(false);
  });

  it('never shows the transport its own words', () => {
    // The exact string a traveller on hostel wifi used to be shown.
    expect(saveFailureMessage(new TypeError('Network request failed'))).toBe(
      'No connection. This one needs the internet.'
    );
  });

  it('passes through a sentence the database actually wrote', () => {
    expect(saveFailureMessage({ message: 'already connected with this traveler' })).toBe(
      'already connected with this traveler'
    );
  });

  it('says which thing did not load', () => {
    expect(loadFailureMessage({ message: 'Failed to fetch' }, 'your chats')).toBe(
      'No connection, so your chats could not load.'
    );
    expect(loadFailureMessage({ message: 'boom' }, 'your chats')).toBe(
      'Your chats could not load.'
    );
  });
});
