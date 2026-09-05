---
name: screens
description: Review the app as pictures. Use after any UI change, before telling the founder something is ready, or when asked "how does it look?" / "show me the screens". Runs the simulator suite, pulls the screenshots, builds a gallery page, and publishes it as an artifact the founder can open on a phone.
---

# Reviewing the app by eye

A green E2E run says a robot walked the app. It does not say the app looked
right. This project has shipped a screen where two form fields had been
concatenated into one and the suite was still green. **Always look.**

## 1. Run the suite

GitHub Actions → **E2E simulator** → `workflow_dispatch`.

Leave `build` **false** unless native code changed or `app.json`'s `version`
moved — a false run reuses the last simulator binary and pushes the current
JS to it over the `e2e` channel, which costs no EAS build quota. `build: true`
spends one.

**After any `version` bump, one run needs `build: true`.** `runtimeVersion`
follows `appVersion`, so the reused binary cannot take an update from the new
version and the "Fetch the published update" gate fails outright rather than
screenshotting old JavaScript. The 0.2.0 one was run 109 (2026-09-04); every
run since reuses that binary with `build` false.

The run takes ~15 minutes. Do not poll it in a tight loop; check back.

## 2. Get the pictures

The `drive` job force-pushes every screenshot to the **`e2e-results`**
branch (workflow artifacts cannot be downloaded from this sandbox; a branch
can). The `gallery` job then builds `screens.html` on that same branch.

```bash
git fetch origin e2e-results --depth 1
mkdir -p /tmp/shots && git --work-tree=/tmp/shots checkout FETCH_HEAD -- results screens.html
git reset                     # the line above stages into the CURRENT index
```

That last `git reset` is not optional. Checking out into a work-tree stages
those files on the working branch, and a session has twice been reported for
"uncommitted changes" because of it. Never commit screenshots to the dev
branch.

`results/RUN` holds the run's timestamp and commit — confirm it matches what
you expect before trusting the shots.

**A matching commit is necessary and was once not sufficient.** Reused
binaries run the JS embedded at build time unless the published update is
downloaded AND applied on a later launch, and for weeks the suite captured
the wrong code while reporting green (see `traps`, "Over-the-air updates"). The workflow now fails outright rather than falling back to
embedded JS, so a green run is trustworthy again. If shots ever look like an
older version of a screen, suspect this before suspecting the screen.

## 3. Publish it

If `screens.html` came down with the shots, publish that file directly with
the `Artifact` tool. Otherwise build it:

```bash
node scripts/screens-gallery.mjs /tmp/shots/results /tmp/shots/screens.html
```

Publish with the same file path each time so the founder's link keeps
working, and keep the favicon stable.

## 4. Actually review

Open the images yourself with `Read` — reading the file names is not
reviewing. Look for:

- text clipped, wrapped, or concatenated between fields;
- a primary button under the keyboard or off the bottom edge;
- placeholder or seed content that a real user would never see;
- an empty state rendered where data should have loaded;
- a screen that is simply blank because a modal never presented.

**Look for what is illegible, not only for what is missing.** Run 44 was
fully green and every element it asserted on was present and correct. Four
things on it could not be read by a human: a menu that dimmed nothing behind
it, a "Pin to the top" in destructive red, an overlap window half dissolved
into the gradient under a floating bar, and a close button in clear glass
over a bright photograph. A test asserts a node exists. It cannot see
contrast, and it cannot see one thing on top of another.

**Crop and zoom before you conclude.** Three of those four were invisible at
thumbnail size and obvious at full resolution. The `results/` shots are
@3x — open them, crop the band you doubt, and read the pixels if you are
still unsure:

```bash
python3 -c "
from PIL import Image
im = Image.open('/tmp/shots/results/17-travelers-signed-in.png')
w, h = im.size
im.crop((0, int(h*0.76), w, int(h*0.90))).save('/tmp/crop.png')"
```

**Where things go wrong is where a floating thing meets a scrolling thing.**
Docked action bars, glass controls over maps and photos, avatars over rails,
menus over threads. Check every one of those seams on every run.

Report what you saw, naming screens. If something is wrong, fix it and run
again — do not describe a defect and ship anyway.

## Adding a screen to the record

Add a `takeScreenshot: NN-name` to the flow in `e2e/flows/`, and a caption
in the `CAPTIONS` map in `scripts/screens-gallery.mjs`. Uncaptioned shots
still appear (with a tidied filename), so nothing silently vanishes.
