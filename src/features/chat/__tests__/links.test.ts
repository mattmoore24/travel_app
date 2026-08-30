import { splitLinks } from '@/features/chat/links';

describe('splitLinks', () => {
  it('finds a full URL and leaves the words around it plain', () => {
    expect(splitLinks('menu at https://samewhere.io/help tonight')).toEqual([
      { text: 'menu at ', url: null },
      { text: 'https://samewhere.io/help', url: 'https://samewhere.io/help' },
      { text: ' tonight', url: null },
    ]);
  });

  it('links a bare domain, with a scheme added for Linking', () => {
    expect(splitLinks('book on hostelworld.com before 8')).toEqual([
      { text: 'book on ', url: null },
      { text: 'hostelworld.com', url: 'https://hostelworld.com' },
      { text: ' before 8', url: null },
    ]);
  });

  it('does not hang the sentence’s full stop on the link', () => {
    expect(splitLinks('see samewhere.io.')).toEqual([
      { text: 'see ', url: null },
      { text: 'samewhere.io', url: 'https://samewhere.io' },
      { text: '.', url: null },
    ]);
  });

  it('carries two URLs in one sentence', () => {
    const spans = splitLinks('either https://a.example/x or b.example/y works');
    expect(spans.filter((s) => s.url != null)).toEqual([
      { text: 'https://a.example/x', url: 'https://a.example/x' },
      { text: 'b.example/y', url: 'https://b.example/y' },
    ]);
  });

  it('leaves an @handle alone, dots and all', () => {
    // §7 rule 4 means a handle only ever arrives inside a chat, and
    // "@rua.da" is somebody's Instagram, not a website called rua.da.
    expect(splitLinks('find me at @rua.da on insta')).toEqual([
      { text: 'find me at @rua.da on insta', url: null },
    ]);
  });

  it('returns one plain span for a message with nothing to tap', () => {
    expect(splitLinks("we're at Rua da Bica 42, 8pm")).toEqual([
      { text: "we're at Rua da Bica 42, 8pm", url: null },
    ]);
  });
});
