import { inviteTokenFrom } from '@/features/groups/invite-token';

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);

describe('what people actually paste', () => {
  it('takes the bare code', () => {
    expect(inviteTokenFrom(` ${TOKEN} `)).toBe(TOKEN);
  });

  it('takes the https link', () => {
    expect(inviteTokenFrom(`https://link.samewhere.io/i/${TOKEN}`)).toBe(TOKEN);
  });

  it('takes the whole message, which is what copying a bubble gives you', () => {
    expect(
      inviteTokenFrom(
        `Join "Lisbon crew" on Samewhere: https://link.samewhere.io/i/${TOKEN}\n\nIf that link does not open, put this code into the app: ${TOKEN}`
      )
    ).toBe(TOKEN);
  });

  it("still takes an old scheme link out of somebody's message history", () => {
    expect(inviteTokenFrom(`samewhere:///join-group/${TOKEN}`)).toBe(TOKEN);
  });

  it('shrugs off tracking a messenger bolted onto the end', () => {
    expect(inviteTokenFrom(`https://link.samewhere.io/i/${TOKEN}?fbclid=xyz`)).toBe(TOKEN);
  });

  it('returns something usable for a token shape it has never seen', () => {
    // The 64-hex match is an optimisation, not a contract: if the DB ever
    // changes the shape, the link parse still finds the last path segment.
    expect(inviteTokenFrom('https://link.samewhere.io/i/short-token')).toBe('short-token');
    expect(inviteTokenFrom('short-token')).toBe('short-token');
  });

  it('gives back nothing for an empty paste rather than navigating', () => {
    expect(inviteTokenFrom('')).toBe('');
    expect(inviteTokenFrom('   ')).toBe('');
  });
});
