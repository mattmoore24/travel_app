# End-to-end: the app, driven by a robot

`.github/workflows/e2e.yml` runs the real native app in an iOS Simulator on a
macOS runner, drives it with [Maestro](https://maestro.mobile.dev) flows from
`e2e/flows/`, and force-pushes every screenshot to the **`e2e-results`**
branch — which is how a session with no macOS and no phone gets eyes on the
actual product. Fetch that branch and read the PNGs.

Inputs: `build` defaults to **true** and should stay there. It produces a
fresh EAS simulator build, which costs a build credit and about twenty
minutes, and is the only way this suite can picture the code under test —
see below.

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

**And on GitHub's runners, that fetch never succeeds.** expo-updates' own
log records `A TLS error caused the secure connection to fail` on every
check against `u.expo.dev`, while the same simulator talks to Supabase over
HTTPS in the same run and expo-updates uses a plain
`URLSessionConfiguration.default`. It is the environment, not the config,
and it is why `build` defaults to true: a fresh binary embeds the commit
under test and needs no fetch at all.

The freshness gate below stays in place regardless. If the update path ever
starts working, it will be trusted only when it can prove itself.

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
