// Turns the screenshots an E2E run pushed to the `e2e-results` branch into a
// single self-contained HTML page, so the app can be reviewed as pictures
// rather than described in prose. The founder works from a phone; scrolling
// real screens beats reading someone's account of them.
//
//   node scripts/screens-gallery.mjs <results-dir> <out.html>
//
// Images are inlined as data URIs (an artifact may not fetch anything), so
// the page is bounded by a byte budget and fills it in priority order.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Resolved at runtime, not declared: it rides in with Expo's own tree, and a
// gallery that still renders (at full PNG weight) beats one that crashes if
// that ever changes.
const Jimp = await import('jimp-compact').then((m) => m.default ?? m).catch(() => null);

const [, , resultsDir = 'results', outFile = 'screens.html'] = process.argv;

/** Roughly 9 MB of base64 keeps a long way clear of the 16 MB page cap. */
const BUDGET_BYTES = 9_000_000;

/**
 * A simulator shot is 1179x2556 of flat UI. Inlined as PNG, five of them eat
 * the whole budget and the run gets reviewed half-blind. Downscaled to a
 * retina-sharp 720px and re-encoded, all twenty fit with room to spare — and
 * the page opens over a phone connection.
 */
const SHOT_WIDTH = 720;
const SHOT_QUALITY = 82;

// What each shot is actually showing. Anything not listed still appears, with
// its filename tidied up — a new screenshot should never silently vanish.
const CAPTIONS = {
  '00-welcome': ['Welcome', 'The splash dissolves into this. The mark never moves.'],
  '00a-tour-map': ['Tour: the map', 'The mark has docked; pages parallax under it.'],
  '00b-tour-travelers': ['Tour: travelers', 'Same dates, same city.'],
  '00c-tour-chat': ['Tour: saying hi', 'Send a first message; they accept, the chat opens.'],
  '00d-tour-privacy': [
    'Tour: the promise, and the choice',
    'We never ask where you are. Make a profile, or keep looking.',
  ],
  '01-cold-start': ['Straight to the map', 'Dismissing the tour lands on the app itself.'],
  '02-map-tab': ['Map, as a guest', 'Plain glyphs: no faces until you have an account.'],
  '03-travelers-guest': ['Travelers, as a guest', 'One real person, then the gate.'],
  '04-chat-guest': ['Chat, as a guest', 'Rooms are readable before signing up.'],
  '05-back-to-map': ['Back to the map', 'Tab state survives the round trip.'],
  '10-auth-gate': ['The gate', 'Asked at the moment of action, not at the door.'],
  '11-signed-in-map': ['Map, signed in', 'Faces on the pins, and one docked action.'],
  '12-place-mode': ['Placing a pin', 'The map moves under a fixed pin.'],
  '13-place-after-pan': ['Panned', 'The pin lifts and settles as the map moves.'],
  '14-pin-form': ['What is the plan?', 'Name, the street it sits on, details.'],
  '15-pin-form-filled': ['Filled in', 'Put it on the map stays above the keyboard.'],
  '16-pin-posted': ['Posted', 'The plan, the street, and how long it has left.'],
  '17-travelers-signed-in': [
    'Travelers',
    'One person at a time, and the days you overlap said beside the name.',
  ],
  '18-profile-me': ['Your profile', 'Exactly the page a stranger sees, plus edit.'],
  '19-house-rules': ['House rules', 'What is not allowed, and what is never collected.'],
  '19a-contact-form': ['Contact us', 'A form, rather than an address anyone can harvest.'],
  '19b-contact-typed': [
    'Writing to us',
    'Send lifts clear of the keyboard as soon as there is a message.',
  ],
  '20-chat-individual': ['Chat', 'A switch where a page title used to be.'],
  '21-chat-groups': ['Groups', 'Venue rooms and your own groups, kept apart.'],
  '22-new-group': ['Starting a group', 'Name, who can post, how long anyone may stay.'],
  '23-group-created': ['The group', 'Straight into it, with the details button top right.'],
  '24-group-message': ['A message', 'Bubble geometry, and the time between clusters.'],
  '25-reaction-menu': ['Long press', 'The emoji row sits ON the message. This is the shot.'],
  '26-reacted': ['Reacted', 'One reaction per person; a second choice moves it.'],
  '27-group-settings': ['Group details', 'Who can post, who is in it, and the invite link.'],
  '27a-chat-list-with-a-row': ['The chat list', 'One column, newest first.'],
  '27b-group-add-and-leave': ['Add and leave', 'Both at the bottom of the details sheet.'],
  '27c-add-people': ['Adding people', 'Anyone you already share a group with.'],
  '28-map-with-places': ['Places on the map', 'Small chips are businesses; discs are people.'],
  '15b-pin-join-mode': [
    'How people come along',
    'Anyone can join, or message me first. Above the fields, where it is read.',
  ],
  '18b-who-can-see-you': ['Who sees you', 'Both directions at once, and what a badge unlocks.'],
  '33-priorities-empty': ['Top priorities, empty', 'The section, before anything is in it.'],
  '34-priorities-editor': ['Adding a priority', 'The editor the onboarding step hands over to.'],
  '35-priorities-typed': ['Typed', 'Saved on the way out.'],

  // The business path. None of this had a picture before 2026-08-29.
  '40-business-email-copy': [
    'Signing up as a business',
    "The founder's line: this email is only for signing in.",
  ],
  '41-business-name': ['Name and kind', 'The name over the door, and what it is.'],
  '42-business-where-empty': [
    'Where is it, empty',
    'One box for the address, and a quiet line for placing the pin by hand.',
  ],
  '42b-business-where-pin-yourself': [
    'Set the pin yourself',
    'The map at country scale, waiting for a tap.',
  ],
  '43-business-address-typing': [
    'Typing an address',
    'The map steps aside so the suggestions get the screen.',
  ],
  '44-business-address-and-marker': [
    'Picked',
    'The address stays as written; the marker moves to the street.',
  ],
  '45-business-where-final': [
    'Where is it, done',
    'The address as written, the marker on the street, and the city the server filed it under.',
  ],
  '46-business-confirm': [
    'Is this right?',
    'What a traveler sees when they tap you, at street zoom so the door can be checked.',
  ],
  '47-business-contact': [
    'How to reach you',
    'The email takes the code. Phone and WhatsApp are yours.',
  ],
  '48-business-photos': ['Show the place', 'One photo is the only thing this step needs.'],
  '49-business-photo-added': ['A photo, uploading', 'The editor the step hands over to.'],
  '50-business-photo-counted': [
    'Counted',
    'The photo is live, which is what lets this step be passed.',
  ],
  '60-business-description': ['What is it like?', 'Skippable, and it says so.'],
  '61-business-hours': ['When are you open?', 'Past midnight is fine.'],
  '62-business-links': ['Anywhere else?', 'Menus, bookings, socials, in one list.'],
  '63-business-review': ['Here it is', 'The listing as a traveler meets it, before it goes live.'],
  '64-business-code-step': ['One last thing', 'The address the code goes to.'],

  // Making a profile. Same: no picture before 2026-08-29.
  '50-signup-email': ['Signing up as a person', 'Your email is never shown to other users.'],
  '51-signup-who': ['Who are you?', 'The name people see, and your age.'],
  '52-signup-home': ['Where are you from?', 'Home base, not where you happen to be.'],
  '53-signup-home-filled': ['Languages', 'Searchable, and this step will not go without one.'],
  '54-signup-photo-gate': ['Add a photo', 'The one mandatory thing on every profile.'],
  '55-signup-photo-added': ['A face', 'Which is what makes the rest worth answering.'],
  '56-signup-occupation': ['What do you do?', 'The first step that may be skipped.'],
  '57-signup-bio': [
    'A bit about you',
    'Keyboard up: the Hide keyboard bar above it, and Continue under it rather than on top of it.',
  ],
  '57b-signup-bio-keyboard-away': [
    'A bit about you, keyboard away',
    'The bar was tapped, so the footer is back and Continue is reachable.',
  ],
  '58-signup-prompts': ['Answer a prompt', 'The bit people actually read.'],
  '59-signup-priorities': ['What are you after?', 'So the right people say hi.'],
  '70-signup-trips': ['Where are you going?', 'The one step the whole matching engine runs on.'],
  '71-signup-socials': ['Your socials', 'Nobody sees these until you are both in a chat.'],
  '71b-signup-badge': [
    'Get your badge',
    'The selfie check as a step of its own, skippable, with the cost of skipping under it.',
  ],
  '72-signup-audience': ['Who sees you', 'A default rather than a decision you must make now.'],
  '73-signup-review': ['Here you are', 'Exactly what a stranger sees.'],
  '74-signup-review-scrolled': ['The rest of it', 'Same page, further down.'],
  '75-signup-done': ['In', 'The stamp landed and the tabs are there.'],
  '90-photo-library': ['The photo picker', "Apple's, driven by the suite to get past the wall."],
  '91-photo-crop': ['Cropping', 'The square iOS always gives, which is the square the app shows.'],
  'zz-final-state': ['Final state', 'Raw capture at the end of the run.'],
};

/** Three passes through the app; the order is the order a person meets them. */
const SECTIONS = [
  {
    title: 'First run',
    note: 'What someone sees before they have an account.',
    match: (n) => /^0/.test(n),
  },
  {
    title: 'Signed in',
    note: 'The loop: sign in, drop a pin, read a traveler.',
    match: (n) => /^1/.test(n),
  },
  {
    title: 'Chat',
    note: 'Starting a group, saying something, and reacting to it.',
    match: (n) => /^2/.test(n),
  },
  {
    title: 'Making a profile',
    note: 'Thirteen steps, each asking one thing. None of this had a picture before today.',
    match: (n) => /^(5[0-9]|7[0-5]|9[01])-signup|^(5[0-9]|7[0-5])-signup|^9[01]-photo/.test(n),
  },
  {
    title: 'Listing a business',
    note: 'Twelve steps, from the name over the door to the code that turns the lights on.',
    match: (n) => /^(4[0-9]|5[0-9]|6[0-4])-business/.test(n),
  },
  { title: 'Everything else', note: null, match: () => true },
];

const files = readdirSync(resultsDir)
  .filter((f) => f.endsWith('.png'))
  .sort();

if (files.length === 0) {
  console.error(`::error::no screenshots in ${resultsDir}`);
  process.exit(1);
}

let runStamp = '';
let runCommit = '';
try {
  const [stamp, commit] = readFileSync(join(resultsDir, 'RUN'), 'utf8').trim().split('\n');
  runStamp = stamp ?? '';
  runCommit = (commit ?? '').slice(0, 7);
} catch {
  // A gallery without run metadata is still a gallery.
}

// Budget order, most-wanted first. Run 84's page spent the whole budget on
// the oldest screens and its footer listed EVERY new signup and business shot
// as left out — the exact screens the run existed to photograph. Failures
// still lead, because a step that found nothing is the one thing worth
// finding by eye; then the two signup journeys, then everything else.
const priority = (name) => {
  if (name.startsWith('step-')) return 0;
  if (/-signup|-business|-photo-(library|crop)/.test(name)) return 1;
  if (name.startsWith('zz-')) return 3;
  return 2;
};
const ordered = [...files].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));

let used = 0;
const embedded = new Map();
for (const file of ordered) {
  const source = readFileSync(join(resultsDir, file));
  let bytes = source;
  let mime = 'image/png';
  try {
    if (!Jimp) {
      throw new Error('no encoder');
    }
    const image = await Jimp.read(source);
    if (image.bitmap.width > SHOT_WIDTH) {
      image.resize(SHOT_WIDTH, Jimp.AUTO);
    }
    image.quality(SHOT_QUALITY);
    bytes = await image.getBufferAsync(Jimp.MIME_JPEG);
    mime = 'image/jpeg';
  } catch {
    // Unreadable or already tiny: inline the original rather than drop it.
  }
  const cost = Math.ceil((bytes.length * 4) / 3);
  if (used + cost > BUDGET_BYTES) {
    continue;
  }
  used += cost;
  embedded.set(file, `data:${mime};base64,${bytes.toString('base64')}`);
}
const skipped = files.filter((f) => !embedded.has(f));

const label = (file) => {
  const key = file.replace(/\.png$/, '');
  if (CAPTIONS[key]) {
    return CAPTIONS[key];
  }
  if (key.startsWith('step-')) {
    const what = key.replace(/^step-\d+-/, '').replace(/[_-]/g, ' ');
    // Not necessarily a failure: steps marked optional (dismissing iOS system
    // dialogs) leave one of these behind on a perfectly healthy run.
    return [`Unmatched step: ${what}`, 'The screen at a step that found nothing to act on.'];
  }
  return [key.replace(/[_-]/g, ' '), null];
};

const escape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

const plates = (list) =>
  list
    .map((file) => {
      const [title, note] = label(file);
      const flagged = file.startsWith('step-');
      return `
        <figure class="plate${flagged ? ' plate--flagged' : ''}">
          <div class="shot">
            <img src="${embedded.get(file)}" alt="${escape(title)}" loading="lazy" />
          </div>
          <figcaption>
            <h3>${escape(title)}</h3>
            ${note ? `<p>${escape(note)}</p>` : ''}
            <code>${escape(file)}</code>
          </figcaption>
        </figure>`;
    })
    .join('');

const taken = new Set();
const sections = SECTIONS.map((section) => {
  const list = [...embedded.keys()].filter((f) => !taken.has(f) && section.match(f)).sort();
  list.forEach((f) => taken.add(f));
  if (list.length === 0) {
    return '';
  }
  return `
      <section>
        <header class="section-head">
          <h2>${escape(section.title)}</h2>
          ${section.note ? `<p>${escape(section.note)}</p>` : ''}
        </header>
        <div class="plates">${plates(list)}</div>
      </section>`;
}).join('');

const html = `<title>Samewhere Screens</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
/>
<style>
  /* The app's own Dusk palette, so the gallery and the thing it shows agree. */
  :root {
    --ink: #211e1a;
    --ink-soft: #585f6b;
    --ground: #fbfaf7;
    --raised: #ffffff;
    --sunken: #f0efea;
    --line: rgba(33, 30, 26, 0.1);
    --indigo: #2a4c9b;
    --amber: #9a5709;
    --shadow: 0 18px 40px -24px rgba(33, 30, 26, 0.5);
  }
  /* Un-nested on purpose: an older WebKit without CSS nesting drops the whole
     block, and the gallery would render dark text on a dark ground. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --ink: #f4f4f2;
      --ink-soft: #a3aab8;
      --ground: #0d0f14;
      --raised: #171a21;
      --sunken: #212630;
      --line: rgba(255, 255, 255, 0.1);
      --indigo: #8aa6f0;
      --amber: #f0a93c;
      --shadow: 0 18px 40px -24px rgba(0, 0, 0, 0.8);
    }
  }
  :root[data-theme='dark'] {
    --ink: #f4f4f2;
    --ink-soft: #a3aab8;
    --ground: #0d0f14;
    --raised: #171a21;
    --sunken: #212630;
    --line: rgba(255, 255, 255, 0.1);
    --indigo: #8aa6f0;
    --amber: #f0a93c;
    --shadow: 0 18px 40px -24px rgba(0, 0, 0, 0.8);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
    line-height: 1.55;
  }
  .wrap {
    max-width: 1080px;
    margin: 0 auto;
    padding: clamp(24px, 5vw, 56px) clamp(16px, 4vw, 32px) 96px;
    display: flex;
    flex-direction: column;
    gap: clamp(40px, 7vw, 72px);
  }
  header.top h1 {
    font-family: 'Fraunces', ui-serif, Georgia, serif;
    font-weight: 600;
    font-size: clamp(2rem, 6vw, 3rem);
    line-height: 1.05;
    margin: 0 0 8px;
    text-wrap: balance;
  }
  header.top p { margin: 0; color: var(--ink-soft); max-width: 62ch; }
  .meta {
    margin-top: 20px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .meta span {
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--raised);
  }
  .section-head { border-top: 1px solid var(--line); padding-top: 20px; margin-bottom: 24px; }
  .section-head h2 {
    font-family: 'Fraunces', ui-serif, Georgia, serif;
    font-weight: 600;
    font-size: 1.5rem;
    margin: 0 0 4px;
    letter-spacing: -0.01em;
  }
  .section-head p { margin: 0; color: var(--ink-soft); font-size: 0.95rem; }
  .plates { display: flex; flex-direction: column; gap: clamp(32px, 6vw, 56px); }
  .plate { margin: 0; display: grid; gap: 20px; align-items: start; }
  @media (min-width: 760px) {
    .plate { grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 32px; }
    figcaption { position: sticky; top: 32px; }
  }
  .shot {
    border-radius: 22px;
    overflow: hidden;
    background: var(--sunken);
    border: 1px solid var(--line);
    box-shadow: var(--shadow);
    line-height: 0;
  }
  .shot img { width: 100%; height: auto; display: block; }
  figcaption h3 {
    font-family: 'Fraunces', ui-serif, Georgia, serif;
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 6px;
  }
  figcaption p { margin: 0 0 10px; color: var(--ink-soft); max-width: 46ch; }
  figcaption code {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--ink-soft);
    background: var(--sunken);
    padding: 3px 7px;
    border-radius: 6px;
  }
  /* A failed step is the one thing worth finding by eye alone. */
  .plate--flagged .shot { border-color: var(--amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 22%, transparent); }
  .plate--flagged figcaption h3::before {
    content: 'UNMATCHED';
    display: inline-block;
    margin-right: 8px;
    padding: 2px 7px;
    border-radius: 5px;
    background: var(--amber);
    color: #fff;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    vertical-align: 3px;
  }
  footer { color: var(--ink-soft); font-size: 0.85rem; border-top: 1px solid var(--line); padding-top: 20px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="top">
    <h1>Every screen, as it actually renders</h1>
    <p>
      Captured by driving the real app on an iOS simulator against the live backend. These are
      photographs of the running app, not mockups.
    </p>
    <div class="meta">
      <span>${escape(runStamp || 'run time unknown')}</span>
      <span>commit ${escape(runCommit || 'unknown')}</span>
      <span>${embedded.size} of ${files.length} shots</span>
    </div>
  </header>
  ${sections}
  <footer>
    ${
      skipped.length > 0
        ? `Left out to keep the page under its size limit: ${skipped.map(escape).join(', ')}.`
        : 'Every screenshot from the run is included.'
    }
  </footer>
</div>
`;

writeFileSync(outFile, html);
console.log(
  `wrote ${outFile} — ${embedded.size}/${files.length} shots, ~${(used / 1e6).toFixed(1)} MB inlined`
);
