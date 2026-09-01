import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const SURFACES = [
  ['a stranger’s profile', 'src/app/profile/[userId].tsx'],
  ['the map’s pin card', 'src/features/pins/map-screen.tsx'],
] as const;

/**
 * The note beside a disabled Say hi has to stay true after the sweep.
 *
 * Both of these screens promised "It'll be in Chat if they answer." beside a
 * control they had already switched off — for a hello that, once
 * expire_message_requests has ended it, nobody can answer at all:
 * respond_to_message_request only takes a row that is still 'pending'. Two
 * surfaces asked the same question, so both had to be found, and a third
 * would have to be too.
 */
describe('what a surface says about a hello that has run out', () => {
  it.each(SURFACES)('%s branches its note on the sweep stamp', (_where, file) => {
    const code = src(file);
    // Named imports rather than the exact line, so a surface may learn a
    // fourth question without this failing for the wrong reason - but it
    // must still ask BOTH of these.
    expect(code).toContain("from '@/features/matching/already-sent'");
    expect(code).toContain('helloExpired(sentRequests,');
    expect(code).toContain('saidHiAlready(sentRequests,');
    expect(code).toContain('You said hi a while back. That one has run out.');
  });

  it.each(SURFACES)('%s keeps the live sentence for a live hello', (_where, file) => {
    expect(src(file)).toContain("You said hi. It'll be in Chat if they answer.");
  });

  it.each(SURFACES)('%s never offers a second hello either way', (_where, file) => {
    // One shot per direction, ever. An expired row does not free the pair, so
    // the honest note must not turn into an invitation to try again.
    const code = src(file);
    expect(code).not.toMatch(/[Ss]ay hi again/);
    expect(code).not.toMatch(/[Tt]ry again.{0,40}hello/);
  });

  it.each(SURFACES)('%s also says so when the sender took it back', (_where, file) => {
    // The third thing that can have happened to an unanswered hello, and the
    // only one the sender chose. Withdrawing empties the recipient's inbox,
    // so "it'll be in Chat if they answer" became a promise about a message
    // nobody has. This test exists because the note was fixed on ONE of these
    // two surfaces first, and the docstring above had already warned that
    // both ask the same question.
    const code = src(file);
    expect(code).toContain('helloWithdrawn(sentRequests,');
    expect(code).toContain('You took that one back.');
    // Still no retry: withdrawing stamps the row, it does not free the pair.
    expect(code).not.toMatch(/[Ss]ay hi again/);
  });
});
