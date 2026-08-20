# End-to-end: the app, driven by a robot

`.github/workflows/e2e.yml` runs the real native app in an iOS Simulator on a
macOS runner, drives it with [Maestro](https://maestro.mobile.dev) flows from
`e2e/flows/`, and force-pushes every screenshot to the **`e2e-results`**
branch — which is how a session with no macOS and no phone gets eyes on the
actual product. Fetch that branch and read the PNGs.

Inputs: `build=true` produces a fresh EAS simulator build first (uses an EAS
build credit, ~10 min); `build=false` reuses the latest finished one and
pushes the current JS to it over the air — right for JS-only changes, wrong
after native changes, which an update cannot carry.

## How the current JS actually reaches the simulator

This is the part that went wrong silently for weeks, so it is written down.

A reused binary carries the JavaScript that was embedded when it was built.
`eas update --branch e2e` publishes the commit under test to the channel the
binary listens on, but **expo-updates does not run it on the launch that
downloads it**: `launchWaitMs` defaults to 0, so the app starts on the bundle
it already has and fetches the new one in the background. The download
becomes the running code on the _next_ launch. Worse, it is stored inside the
app's data container, so Maestro's `clearState` deletes it before it is ever
applied.

The workflow therefore does three things, and all three matter:

1. Publishes the update and **fails the run** if nothing was published.
2. Launches the app once with no flow attached, polls the expo-updates
   database until the published update id reaches `status = 1` (StatusReady),
   and kills the app. Fails the run if it never arrives.
3. Resets state between flows by deleting exactly what the app persists
   (`Library/Application Support/<bundle id>`, the old AsyncStorage paths
   under `Documents`, caches, tmp) instead of clearing the whole container —
   so the downloaded update survives while the tour and the session do not.

If you add a flow, do not put a state clear in it. If you run a flow by hand,
do step 3 yourself first.

Costs to know: macOS runners bill GitHub minutes at 10x, so a ~15-minute run
charges ~150 of the 2000 free monthly minutes. Simulator limits: no push
notifications, no camera, Sign in with Apple is unreliable — those stay
human-tested on TestFlight.
