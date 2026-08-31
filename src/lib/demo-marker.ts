/**
 * The seeded demo travelers end their bios with a literal "[demo]" — the
 * fixture's own readme requires a visible marker because the portraits are
 * AI-generated and no real person's likeness is used. The intent must
 * survive; the rendering must not: a bracketed token appended to prose does
 * not read as a disclosure to anybody, it reads as unfinished software, and
 * profile-view quotes a bio into first messages, so the token could end up
 * inside somebody's hello.
 *
 * So the marker stays in the DATA (the launch runbook's purge and the
 * honesty commitment are untouched) and display strips it here, once, with
 * `isDemo` telling the card to draw its "Sample profile" chip instead. If
 * the chip does not render where isDemo is true, the app is showing an
 * AI-generated portrait with no marker at all — that is the failure mode
 * the test guards.
 */
const MARKER = /\s*\[demo\]\s*$/;

export function splitDemoMarker(bio: string | null | undefined): {
  bio: string | null;
  isDemo: boolean;
} {
  if (bio == null) {
    return { bio: null, isDemo: false };
  }
  const isDemo = MARKER.test(bio);
  const stripped = (isDemo ? bio.replace(MARKER, '') : bio).trim();
  return { bio: stripped.length > 0 ? stripped : null, isDemo };
}
