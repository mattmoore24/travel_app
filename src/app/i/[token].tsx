/**
 * The app end of https://link.samewhere.io/i/<token>.
 *
 * That address is what an invite looks like once it leaves the app: tappable
 * in a text message, readable off a QR code by a phone that has never heard
 * of Samewhere. The association file hands iOS this path; the screen that
 * answers it is join-group, and this route IS that screen rather than a
 * redirect to it, on purpose. An invite is very often somebody's first
 * launch, and a `router.replace` issued from a focus effect is exactly the
 * navigation the root hold throws away when it unmounts the stack
 * (src/features/auth/routing.ts, and _layout's "unmounting the stack also
 * loses the route"). A route that simply is the destination cannot be lost
 * that way.
 *
 * Without this file the same URL opens the app on +not-found, which tells
 * the reader the invite expired. It did not. That is why this file has to be
 * in the SAME commit as ios.associatedDomains, and why
 * src/app/__tests__/invite-links.test.ts pins the pairing.
 */
export { default } from '../join-group/[token]';
