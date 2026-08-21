import { Linking, Platform } from 'react-native';

/**
 * Hand a spot to the phone's own map app.
 *
 * Apple Maps takes `ll` plus a `q` that becomes the dropped pin's label, so
 * the place arrives named rather than as a bare coordinate. Everything else
 * gets the geo: URI, which Android maps and most desktop browsers honour,
 * with the same label carried in its query.
 *
 * Failures are swallowed on purpose: there is no useful thing to say when a
 * device has no map app, and an alert about it would be noise on the way to
 * somewhere else.
 */
export function openInMaps(place: { lat: number; lng: number; label?: string | null }) {
  const label = (place.label ?? '').trim();
  const coords = `${place.lat},${place.lng}`;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?ll=${coords}${label ? `&q=${encodeURIComponent(label)}` : '&q=Pin'}`
      : `geo:${coords}?q=${coords}${label ? `(${encodeURIComponent(label)})` : ''}`;
  Linking.openURL(url).catch(() => {});
}
