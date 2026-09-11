import fs from 'node:fs';
import path from 'node:path';

/**
 * Founder, 2026-09-11: on Kate's profile while her hello is pending my
 * acceptance, the button at the bottom should say Accept, not Say hi. The
 * pending action is accepting, so the page must not offer a hello of its
 * own anywhere either.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'profile', '[userId].tsx'), 'utf8');

describe('a profile with their hello waiting on you', () => {
  it('finds their hello among the incoming ones by who sent it', () => {
    expect(source).toContain('const { data: incoming = [] } = useIncomingRequests();');
    expect(source).toContain(
      'const waiting = incoming.find((request) => request.sender_id === userId) ?? null;'
    );
  });

  it('says Accept on the docked bar, ahead of every other state', () => {
    expect(source).toContain("waiting != null\n              ? 'Accept'");
    expect(source).toContain(
      'disabled={waiting != null ? accepting : alreadySaidHi || helloCapped}'
    );
  });

  it('accepts the way the Chat tab does and lands in the chat', () => {
    expect(source).toContain('respond.mutateAsync({ requestId: waiting.id, accept: true })');
    expect(source).toContain('router.push(`/chat/${result.chat_id}`);');
    expect(source).toContain('? void acceptHello()');
  });

  it('offers no reply bubbles while their hello is waiting', () => {
    expect(source).toContain('known || alreadySaidHi || waiting != null || !userId');
  });

  it('shows the message being answered, above the decision', () => {
    expect(source).toContain('{`${name} said hi: "${waiting.first_message}"`}');
  });
});
