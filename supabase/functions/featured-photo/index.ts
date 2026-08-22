// The one face a signed-out visitor is allowed to see.
//
// featured_traveler() already picks exactly one person per city and already
// requires them to have an approved first photo - but the guest could never
// see it. The profile-photos bucket is private and its only SELECT policy is
// `to authenticated`, so a signed-out device is refused the image however
// hard the card asks, and the card fell back to a monogram. The audit's Top 6
// is "never ship a faceless featured traveler"; this is what was missing.
//
// Why a function and not a wider bucket policy: widening the bucket to `anon`
// would hand every primary photo in the app to anybody holding the public
// key. This hands over ONE photo, and the caller does not get to say which:
// it passes a city, the server picks the person (the same way the card does),
// and the signed URL is minted for that person's position-0 approved photo
// and nothing else. There is no parameter here that can be walked.
//
// Consent is the founder's existing ruling on the featured slot: posting a
// trip is what puts somebody in it, and nobody can message them without an
// account (docs/ARCHITECTURE.md).
//
// Deploy: supabase functions deploy featured-photo
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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // The SAME function the card calls, so the photo can never belong to
  // somebody other than the person on screen.
  const { data, error } = await admin.rpc('featured_traveler', { p_city_id: cityId });
  if (error) {
    console.error(`featured_traveler: ${error.message}`);
    return Response.json({ error: 'lookup failed' }, { status: 500 });
  }
  const path = data?.[0]?.photo_path ?? null;
  if (!path) {
    // Nobody featured, or nobody with a face. Not an error - the card has a
    // monogram for exactly this.
    return Response.json({ url: null });
  }

  const signed = await admin.storage.from('profile-photos').createSignedUrl(path, TTL_SECONDS);
  if (signed.error) {
    console.error(`sign ${path}: ${signed.error.message}`);
    return Response.json({ url: null });
  }
  return Response.json({ url: signed.data.signedUrl });
});
