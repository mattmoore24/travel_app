// The faces a signed-out visitor is allowed to see.
//
// featured_traveler() already picks the people per city and already requires
// each of them to have an approved first photo - but the guest could never see
// it. The profile-photos bucket is private and its only SELECT policy is `to
// authenticated`, so a signed-out device is refused the image however hard the
// card asks, and the card fell back to a monogram. The audit's Top 6 is "never
// ship a faceless featured traveler"; this is what was missing.
//
// Why a function and not a wider bucket policy: widening the bucket to `anon`
// would hand every primary photo in the app to anybody holding the public key.
// This hands over the photos of the people the SERVER picked, and the caller
// does not get to say who they are: it passes a city, the same function the
// card calls chooses the travelers, and each signed URL is minted for that
// person's position-0 approved photo and nothing else. There is no parameter
// here that can be walked.
//
// Consent is the founder's existing ruling on the featured slot: posting a
// trip is what puts somebody in it, and nobody can message them without an
// account (docs/ARCHITECTURE.md).
//
// THE RPC RUNS AS THE CALLER. THE SERVICE ROLE SIGNS, AND DOES NOTHING ELSE.
// featured_traveler() is SECURITY DEFINER but its guards are questions about
// the CALLER: `discovery_pair_ok(auth.uid(), ...)`, `is_blocked_pair(...)` and
// `viewer_is_business()` all read auth.uid() and nothing else. A service-role
// PostgREST call carries `{"role":"service_role"}` with no `sub`, so auth.uid()
// is null inside the function and every one of those guards answers as if
// nobody were asking. Calling it as admin therefore excluded NOBODY: the block
// filter added in 20260902260000 was silently off for this call, and the
// response carried the user_id and a live five-minute signed face URL of a
// traveler the caller had blocked or who had blocked them.
//
// It was worse than one leaked URL. The card's call applied the filter and this
// one did not, so the two calls disagreed about MEMBERSHIP by construction
// rather than by a race - and the old response was positional, read by index
// on every phone still running an older bundle, so a blocked traveler's face
// was drawn under a different traveler's name there. Two fixes in tension, and
// this was the seam.
//
// So the Authorization header the request already carries builds a per-request
// client, and that client makes the RPC. Three kinds of caller arrive, and all
// three were read off the installed supabase-js rather than remembered
// (`fetchWithAuth` in @supabase/supabase-js/src/lib/fetch.ts:91, which is
// `realToken ?? (allowKeyAsBearer ? supabaseKey : null)`):
//
//   * a signed-in caller, guest ACCOUNT included, always sends its own JWT, so
//     it now gets its own answer - blocks, audience and all - where the service
//     role got everybody's;
//   * a signed-out caller on the legacy anon key sends that key as the bearer:
//     role `anon`, no `sub`, auth.uid() null;
//   * a signed-out caller on a new-format publishable key sends NO
//     Authorization header at all (the functions client is built with
//     `omitApiKeyAsBearer`), which is why the header is optional below - the
//     client then falls back to SUPABASE_ANON_KEY and lands on role `anon` too.
//
// The last two are auth.uid() null, which is exactly what a service-role call
// evaluated to, so what a genuinely signed-out reader sees does not change at
// all. `featured_traveler` is granted to anon AND authenticated
// (20260902260000), and every function in `public` also carries Postgres's
// default EXECUTE for PUBLIC, so both reach it twice over;
// 10_rooms_guest_mode.test.sql asserts both grants because this call now
// depends on them and the admin call did not. Never restore the admin client
// here.
//
// EACH URL CARRIES WHOSE FACE IT IS, and that is the whole contract. `photos`
// is a list of { user_id, url }, and the screen looks a traveler's face up by
// their user_id (src/app/(tabs)/travelers.tsx). It used to be positional -
// the nth URL was row n - and that was wrong for a reason no ordering fix can
// reach: this call and the card's call are two separate evaluations of
// featured_traveler(), and its guards are per PERSON. Somebody who narrows
// their audience, is banned, blocks the viewer, or reaches the end of their
// trip drops out of one row set and not the other, every row after them
// shifts by one, and a real traveler's face is drawn under a different real
// traveler's name on a signed-out device. Keying by user_id makes the
// mismatch a monogram instead, which is the designed failure path. A missing
// or null entry is an ordinary answer.
//
// BOTH SHAPES GO OUT, and the window they cover is the PHONE, not the server.
// .github/workflows/supabase-deploy.yml runs `supabase db push` and then
// `supabase functions deploy` as two steps of one job, so this function and the
// migration it reads land together, seconds apart, on one run - there is no
// open-ended manual gap between them. What lags is the JavaScript: the bundle
// ships over the air, and an update is never applied on the launch that
// downloads it, so every phone runs the old bundle for at least one more
// launch. A bundle already on a phone reads exactly one field, `url`, and knows
// nothing about `photos` - so `url` stays, and stays first-of-the-list, or the
// guest's one face disappears for the whole of that window: the exact
// regression this function was written to fix, reintroduced by the change meant
// to make it safe.
//
// There is no `urls`. An earlier draft of this change emitted one and argued
// that an old bundle read it positionally; no bundle ever has. `git show
// HEAD:src/features/guest/hooks.ts` reads `data?.url` and nothing else, and the
// shipped function returned `{ url }` alone. A positional list is also the one
// shape that cannot be made safe here - see above - so shipping one as a
// compatibility field would have been shipping the defect under the name of the
// fix.
//
// Deployed by the Supabase deploy workflow above, with the migrations. By hand
// if it is ever needed: supabase functions deploy featured-photo
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Short, because the card is on screen for seconds and the URL is public. */
const TTL_SECONDS = 300;

Deno.serve(async (req) => {
  let cityId: number | null = null;
  try {
    const body = await req.json();
    cityId = Number(body?.city_id);
  } catch {
    cityId = null;
  }
  if (!Number.isInteger(cityId)) {
    return Response.json({ error: 'city_id required' }, { status: 400 });
  }

  // AS THE CALLER, never as admin - see the header. The guards inside
  // featured_traveler() are all questions about auth.uid(), and the service
  // role has none, so an admin call answers them for nobody and the block
  // filter excludes nobody. With no header at all the client falls back to the
  // anon key, which is the same role a signed-out reader arrives as.
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    authHeader === '' ? undefined : { global: { headers: { Authorization: authHeader } } }
  );

  // The SAME function the cards call, evaluated for the SAME person, so a photo
  // can never belong to somebody other than the person it is shown against.
  const { data, error } = await caller.rpc('featured_traveler', { p_city_id: cityId });
  if (error) {
    console.error(`featured_traveler: ${error.message}`);
    return Response.json({ error: 'lookup failed' }, { status: 500 });
  }

  const rows: { user_id: string; photo_path: string | null }[] = (data ?? []).map(
    (row: { user_id: string; photo_path: string | null }) => ({
      user_id: row.user_id,
      photo_path: row.photo_path ?? null,
    })
  );
  if (rows.length === 0) {
    // Nobody featured. Not an error - the card has a monogram for exactly
    // this, and an empty list is what the screen expects to see.
    return Response.json({ url: null, photos: [] });
  }

  // The service role, for the ONE thing that genuinely needs it: minting a
  // signed URL against a private bucket whose only SELECT policy is `to
  // authenticated`. It never chooses a person - the rows above already did
  // that, as the caller - and it is handed no path that did not come back from
  // them.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // One mint per person, in row order. Signed in parallel because the card is
  // waiting on this, and a failure to sign one face is not a failure to serve
  // the others: it becomes a null in place, the monogram renders there, and
  // everybody after it keeps their own photo.
  const photos = await Promise.all(
    rows.map(async ({ user_id, photo_path }) => {
      if (!photo_path) {
        return { user_id, url: null };
      }
      const signed = await admin.storage
        .from('profile-photos')
        .createSignedUrl(photo_path, TTL_SECONDS);
      if (signed.error) {
        console.error(`sign ${photo_path}: ${signed.error.message}`);
        return { user_id, url: null };
      }
      return { user_id, url: signed.data.signedUrl };
    })
  );

  // `url` is the lead face, which is all an older bundle draws.
  return Response.json({ url: photos[0]?.url ?? null, photos });
});
