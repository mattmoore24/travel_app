import fs from 'node:fs';
import path from 'node:path';

/**
 * The liquidity metric grows a second number, and something actually feeds it.
 *
 * `liquidity_reachable` counts the people in a city who have opened the app in
 * the last seven days, and it is null for everybody until `touch_last_seen()`
 * is called. A migration that ships the column with no client is the exact
 * shape of failure this project has paid for twice: the number reads zero for
 * every city, which is worse than no number at all, because it is a number the
 * founder would act on. pgTAP proves the column counts correctly; this proves
 * somebody calls the RPC that puts a date in it.
 *
 * The rest are rule-2 guards. `last_seen_on` is a DATE and must stay one: a
 * per-minute last-seen is a presence signal, and presence is one step from the
 * live-location promise the whole product is built on refusing.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

const sql = read('supabase', 'migrations', '20260902210000_a_hello_can_be_taken_back.sql').replace(
  /^\s*--.*$/gm,
  ''
);

describe('the reachable half of the liquidity number', () => {
  it('is fed by an RPC the app calls on every launch', () => {
    // THE CALL SITE. useMyChats is what the tab navigator mounts for the icon
    // badge before any tab is chosen, so it is the app's one reliable "we are
    // open" moment; useTouchLastSeen rides it and fires once per process per
    // account. A root-layout call would read better and belongs there the day
    // somebody owns that file.
    const api = read('src', 'features', 'matching', 'api.ts');
    const hooks = read('src', 'features', 'matching', 'hooks.ts');
    const tabs = read('src', 'components', 'app-tabs.tsx');
    expect(api).toContain("untypedRpc<null>('touch_last_seen', {})");
    expect(hooks).toContain('export function useTouchLastSeen()');
    expect(hooks).toContain('touchLastSeen().catch(() => {});');
    // Mounted, not merely exported.
    const inMyChats = hooks.indexOf('export function useMyChats(');
    expect(hooks.indexOf('useTouchLastSeen();', inMyChats)).toBeGreaterThan(inMyChats);
    expect(tabs).toContain('useSettledWaitingCount');
  });

  it('counts each account once a day and can only ever write the caller', () => {
    // No argument, so there is nowhere to put somebody else's id - the
    // strongest form of the guarantee. The where-clause is the once-a-day.
    expect(sql).toContain('create function public.touch_last_seen()');
    expect(sql).toContain('where user_id = auth.uid()');
    expect(sql).toContain('and (last_seen_on is null or last_seen_on < current_date)');
    expect(sql).toContain('revoke execute on function public.touch_last_seen() from public, anon;');
  });

  it('stores a day and never a time, and shows it to nobody', () => {
    expect(sql).toContain('add column if not exists last_seen_on date');
    expect(sql).not.toMatch(/last_seen_(on|at)\s+timestamptz/);
    // profiles is column-granted, so a column left out of the grant list is
    // unreadable by every client - about themselves and about anyone else.
    expect(sql).not.toMatch(/grant select \(last_seen_on\)/);
  });

  it('keeps the old number beside the new one rather than replacing it', () => {
    // liquidity 800 with reachable 90 is a different city from liquidity 800
    // with reachable 700, and a single corrected number would have hidden
    // which one you have.
    expect(sql).toContain('as liquidity,');
    expect(sql).toContain('as liquidity_reachable');
    // A dropped view loses its revoke, and this one now carries a count
    // derived from a column no client may read.
    expect(sql).toContain('drop view public.admin_liquidity;');
    expect(sql).toContain(
      'revoke all on public.admin_liquidity, public.admin_request_funnel,\n' +
        '  public.admin_moderation_stats, public.admin_pin_stats\nfrom anon, authenticated;'
    );
  });

  it('keeps a history of counts and never of rows', () => {
    // Pins hard-expire within 72 hours and delete within 15 minutes of expiry
    // (hard rule 3). A snapshot that stored pin rows, user ids or anything
    // with a location on it would be a way around that rule wearing an
    // analytics hat.
    expect(sql).toContain('create table public.liquidity_daily');
    expect(sql).toContain('alter table public.liquidity_daily enable row level security;');
    expect(sql).toContain('revoke all on public.liquidity_daily from anon, authenticated;');
    expect(sql).toMatch(/primary key \(city_id, day\)/);
    expect(sql).not.toMatch(/liquidity_daily[\s\S]{0,400}user_id/);
    expect(sql).toContain("cron.schedule('snapshot-liquidity'");
  });

  it('is written down where the founder will read it', () => {
    // The dashboard is the only place either number is ever explained, and a
    // metric nobody can interpret is a metric nobody should act on.
    const dashboard = read('docs', 'DASHBOARD.md');
    expect(dashboard).toContain('liquidity_reachable');
    expect(dashboard).toContain('liquidity_daily');
    expect(dashboard).toContain('last_seen_on');
  });
});
