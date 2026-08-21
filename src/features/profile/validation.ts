import type { ProfileRow } from '@/lib/database.types';

// Client-side mirrors of the DB CHECK constraints (the DB is authoritative;
// these exist for instant form feedback).

export const AGE_MIN = 18;
export const AGE_MAX = 120;
export const BIO_MAX = 500;
export const NAME_MAX = 50;
export const LANGUAGES_MAX = 12;
export const PHOTOS_MAX = 9;
/**
 * Gallery photos (i.e. beyond the main one) a complete profile aims for. The
 * brief asks for at least 6; the DB allows 8, so there is headroom above the
 * target. This is a nudge, not a gate — onboarding still only requires the
 * profile photo, because the account is meant to be cheap to create.
 */
export const GALLERY_TARGET = 6;

export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Add the name you go by.';
  }
  if (trimmed.length > NAME_MAX) {
    return `Keep it under ${NAME_MAX} characters.`;
  }
  return null;
}

export function validateAge(value: string): string | null {
  if (!/^\d+$/.test(value.trim())) {
    return 'Enter your age as a number.';
  }
  const age = Number(value.trim());
  if (age < AGE_MIN) {
    return `You must be at least ${AGE_MIN} to use the app.`;
  }
  if (age > AGE_MAX) {
    return 'Enter a valid age.';
  }
  return null;
}

export function validateBio(value: string): string | null {
  if (value.length > BIO_MAX) {
    return `Bios are capped at ${BIO_MAX} characters.`;
  }
  return null;
}

/**
 * The last path segment of a pasted profile link, or null if this is not a
 * link. Instagram's share sheet hands you the whole URL and that is what
 * people paste, so storing it verbatim printed "@https://instagram.com/alice/"
 * to the person they connected with.
 */
function handleFromUrl(value: string): string | null {
  if (!/^(https?:\/\/|www\.)/i.test(value)) {
    return null;
  }
  const path = value
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 1] : null;
}

/**
 * Handles are stored the way their platform writes them.
 *
 * An @name is bare and lowercase ("@Alice.Travels " -> "alice.travels"), and
 * a pasted profile link gives up its last segment. A phone number or a real
 * name keeps its case and its spaces, because "Matt Moore" and
 * "+44 7700 900123" are exactly what Facebook and WhatsApp call you — and
 * lowercasing a name or refusing a spaced-out number is a dead end on a
 * field whose own placeholder asked for them.
 */
export function normalizeHandle(value: string, usesAt = true): string {
  const trimmed = value.trim();
  if (!usesAt) {
    return trimmed.replace(/\s+/g, ' ');
  }
  return (handleFromUrl(trimmed) ?? trimmed).replace(/^@+/, '').trim().toLowerCase();
}

export function validateHandle(value: string, usesAt = true): string | null {
  const normalized = normalizeHandle(value, usesAt);
  if (normalized.length === 0) {
    return 'Enter a handle.';
  }
  if (normalized.length > 80) {
    return 'Handles are capped at 80 characters.';
  }
  if (usesAt && /\s/.test(normalized)) {
    return 'A username cannot contain spaces.';
  }
  return null;
}

/** The fields a profile needs before onboarding can finish. */
export function missingOnboardingFields(
  profile: Pick<ProfileRow, 'display_name' | 'age' | 'home_city' | 'home_country' | 'languages'>,
  photoCount: number
): string[] {
  const missing: string[] = [];
  if (!profile.display_name?.trim()) {
    missing.push('name');
  }
  if (profile.age == null) {
    missing.push('age');
  }
  if (!profile.home_city?.trim() && !profile.home_country?.trim()) {
    missing.push('home');
  }
  if (profile.languages.length === 0) {
    missing.push('languages');
  }
  if (photoCount === 0) {
    missing.push('profile photo');
  }
  return missing;
}
