import { after, between, source } from '@/lib/__tests__/source';

/**
 * A push Expo refused is not recorded as a push that went.
 *
 * push-worker inspected its tickets for exactly one thing, DeviceNotRegistered,
 * and stamped every row sent_at regardless. So the wall the founder is about
 * to walk into with the 0.2.0 build - a perfect entitlement and no APNs key -
 * was invisible: registration succeeds, InvalidCredentials comes back on every
 * ticket, the worker prunes nothing, stamps everything, and answers
 * `delivered: N`. Every check in the repo stayed green through it.
 *
 * Source-reading, like moderation-worker-queues.test.ts and for the same
 * reason: the worker is a Deno file jest cannot import, and what is being
 * asserted is that a specific branch exists and writes a specific thing. Each
 * anchor is cut with `between`/`after`, which throw on a missing anchor rather
 * than answering the empty string every negative assertion passes against.
 *
 * Every assertion here was run against the mutation that removes what it
 * names (2026-09-02); the mutation and the assertion it fails are recorded in
 * the round's report, not here, so this file does not become a second copy
 * of the worker.
 */
const worker = source('supabase/functions/push-worker/index.ts');

describe('the push worker reads every ticket', () => {
  it('reads the attempts counter with the row, or it cannot count', () => {
    expect(worker).toContain("select('id, user_id, title, body, data, attempts')");
  });

  it('names every error that is not DeviceNotRegistered, counts it, and refuses the row', () => {
    const triage = between(worker, 'function triageTickets(', '\nDeno.serve(');
    // The one error that is about the token rather than the send.
    expect(triage).toContain("detail === 'DeviceNotRegistered'");
    expect(triage).toContain('into.invalidTokens.push(');
    // Everything else: counted under its name, and the row is not finished.
    expect(triage).toContain('into.errors[name] = (into.errors[name] ?? 0) + 1');
    expect(triage).toContain('into.refused.set(outgoing.rowId, name)');
    // A notification with no ticket at all is a refusal, not a delivery.
    expect(triage).toContain("'NoTicket'");
  });

  it('treats an answer with no tickets in it as a refusal of the chunk, never as nothing to inspect', () => {
    const send = between(
      worker,
      'for (let i = 0; i < notifications.length; i += 100)',
      '// -- write back'
    );
    expect(send).toContain('!Array.isArray(result?.data)');
    expect(send).toContain('triage.refused.set(outgoing.rowId, name)');
    expect(send).toContain("'NoTickets'");
    // And the tickets it does get go through the one triage function.
    expect(send).toContain('triageTickets(result.data, chunk, triage)');
  });

  it('says each error name out loud in the function log', () => {
    const send = between(
      worker,
      'for (let i = 0; i < notifications.length; i += 100)',
      '// -- write back'
    );
    expect(send).toContain(
      'console.error(`push-worker: ${count} notification(s) refused by Expo: ${name}`)'
    );
  });
});

describe('and stamps sent_at only when it is finished with the row', () => {
  const writeBack = after(worker, '// -- write back');

  it('stamps the rows no ticket refused, and only those', () => {
    expect(writeBack).toContain('.filter((q: any) => !triage.refused.has(q.id))');
    expect(writeBack).toContain('update({ sent_at: now, last_error: null })');
    expect(writeBack).toContain(".in('id', delivered)");
  });

  it('leaves a refused row for the next tick with the count and the reason', () => {
    expect(writeBack).toContain('const attempts = (item.attempts ?? 0) + 1');
    expect(writeBack).toContain("update({ attempts, last_error: name }).eq('id', item.id)");
    // The retry branch must not carry a sent_at. Cut to the else branch alone.
    const retry = between(writeBack, '} else {', 'retried.push(item.id)');
    expect(retry).not.toContain('sent_at');
  });

  it('gives up after MAX_ATTEMPTS, keeping the error beside the stamp', () => {
    expect(worker).toContain('const MAX_ATTEMPTS = 10');
    expect(writeBack).toContain('if (attempts >= MAX_ATTEMPTS)');
    expect(writeBack).toContain('update({ sent_at: now, attempts, last_error: name })');
  });

  it('reports the refusals by name, so a tick that delivered nothing says why', () => {
    expect(writeBack).toContain('errors: triage.errors');
    expect(writeBack).toContain('gave_up: gaveUp.length');
  });
});

describe('the guard still runs first', () => {
  it('refuses a non-service caller before touching the queue, so the deploy probe gets its 401', () => {
    const head = between(worker, 'Deno.serve(async (req) => {', "from('push_queue')");
    expect(head).toContain('if (!isServiceCaller(req))');
    expect(head).toContain('return refuse()');
  });
});
