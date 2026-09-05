import fs from 'node:fs';
import path from 'node:path';

/**
 * The wiring, as a source scan, because that is the only way to see this
 * class of defect.
 *
 * Five things shipped here this week with a fully green unit suite and no way
 * for anybody to reach them: a screen nothing navigated to, a component
 * mounted nowhere, an option defaulted off that no caller set, a queue no
 * worker drained, a table with no client. Rendering a component directly
 * proves the component works. It does not prove the app can get to it.
 *
 * So each case below names the CALL SITE and asserts it is still there.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const MIGRATION = 'supabase/migrations/20260902200000_a_pin_in_a_conversation.sql';

describe('a plan reaches the thread', () => {
  it('rides on every row room_messages returns, so no screen has to ask for it', () => {
    const sql = src(MIGRATION);
    for (const column of [
      'pin_id uuid',
      'pin_venue_name text',
      'pin_plan text',
      'pin_category public.pin_category',
      'pin_intent_date date',
    ]) {
      expect(sql).toContain(column);
    }
    // And the drop that has to come first, or the deploy dies after the
    // statements above it have already applied.
    expect(sql).toContain('drop function if exists public.room_messages(uuid, int, timestamptz);');
    expect(sql).toContain(
      'grant execute on function public.room_messages(uuid, int, timestamptz) to anon, authenticated;'
    );
  });

  // HARD RULE 3 lives in the RPC, not in the app. If this join condition ever
  // moves to the client, an expired plan becomes readable inside a chat by
  // anybody whose bundle is a day old.
  it('is nulled at expiry by the server rather than hidden by the app', () => {
    expect(src(MIGRATION)).toContain('and pin.expires_at > now()');
  });

  it('is drawn from the row, not from a prop a caller has to remember', () => {
    const thread = src('src/features/chat/message-thread.tsx');
    expect(thread).toContain('const pin = pinOnMessage(message);');
    expect(thread).toContain('{pin ? <PinCard pin={pin} mine={mine} /> : null}');
  });

  it('can be attached to a message the whole way down', () => {
    // The RPC → the api → the hook. The composer's picker is the one link
    // still missing and it is named in the report: src/features/chat/
    // composer.tsx is not this session's file.
    expect(src('src/features/chat/api.ts')).toContain('pinId?: string | null');
    expect(src('src/features/chat/api.ts')).toContain('...(pinId ? { pin_id: pinId } : {})');
    expect(src('src/features/chat/hooks.ts')).toContain('input.pinId ?? null');
  });

  it('can be joined from the card, through a hook with a real caller', () => {
    expect(src('src/features/rooms/api.ts')).toContain("'copy_plan_from_message'");
    expect(src('src/features/rooms/hooks.ts')).toContain('joinPlanFromMessage(messageId)');
    expect(src('src/features/chat/message-thread.tsx')).toContain(
      'const join = useJoinPlanFromMessage();'
    );
  });
});

describe('who reacted reaches the thread', () => {
  it('is refused for a one-to-one chat in the DATABASE, not only in the screen', () => {
    const sql = src(MIGRATION);
    expect(sql).toContain('create function public.message_reactors(p_message_id uuid)');
    // The rule itself. A chat and a business chat both have two people in
    // them; rooms and groups are both kind = 'room'.
    expect(sql).toContain("and c.kind = 'room'");
    // Never anon: a signed-out visitor reading a public room must not be able
    // to enumerate who is in it.
    expect(sql).toContain(
      'revoke execute on function public.message_reactors(uuid) from public, anon;'
    );
    expect(sql).toContain(
      'grant execute on function public.message_reactors(uuid) to authenticated;'
    );
  });

  it('is opened by the thread itself, from the chip it belongs to', () => {
    const thread = src('src/features/chat/message-thread.tsx');
    expect(thread).toContain('onLongPress={onOpenReactors}');
    // Groups and rooms only, decided from a prop rooms already pass rather
    // than a new option somebody has to opt into.
    expect(thread).toContain('const namesReactors = avatarFor != null;');
    expect(thread).toContain('<ReactorSheet messageId={reactorsFor}');
  });
});

describe('a group records its churn', () => {
  it('emits from triggers, so no join path can be added without one', () => {
    const sql = src(MIGRATION);
    expect(sql).toContain('create trigger room_members_log_arrival');
    expect(sql).toContain('create trigger room_members_log_departure');
    expect(sql).toContain('create trigger groups_log_end_date');
  });

  it('never rings a phone for a line nobody wrote', () => {
    expect(src(MIGRATION)).toContain("if new.kind::text <> 'said' then");
  });

  /**
   * The kind-agnostic rule, guarded.
   *
   * `systemLine` asks "is this anything other than somebody talking", which
   * covers every value the enum has and every one it will grow. Turning that
   * into a list of known kinds is the edit that would silently render the next
   * one as a bubble the person appears to have typed, and this is what catches
   * it: every value in the enum, from the migrations themselves.
   */
  it('renders every kind the enum carries as a line, not as a bubble', () => {
    const dir = path.join(REPO, 'supabase', 'migrations');
    const kinds = new Set<string>();
    for (const file of fs.readdirSync(dir)) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of sql.matchAll(/create type public\.message_kind as enum \(([^)]*)\)/g)) {
        for (const v of m[1].matchAll(/'([a-z_]+)'/g)) kinds.add(v[1]);
      }
      for (const m of sql.matchAll(
        /alter type public\.message_kind add value if not exists '([a-z_]+)'/g
      )) {
        kinds.add(m[1]);
      }
    }
    // The enum is real and has grown past its first value.
    expect(kinds.has('said')).toBe(true);
    expect(kinds.size).toBeGreaterThan(4);

    const thread = src('src/features/chat/message-thread.tsx');
    // One predicate, covering all of them at once.
    expect(thread).toContain(
      "return kind != null && kind !== 'said' ? (message.body ?? null) : null;"
    );
    // And the caller's own answer still wins where a screen passes one.
    expect(thread).toContain('systemFor?.(m) ?? systemLine(m)');
  });
});
