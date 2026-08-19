# End-to-end: the app, driven by a robot

`.github/workflows/e2e.yml` runs the real native app in an iOS Simulator on a
macOS runner, drives it with [Maestro](https://maestro.mobile.dev) flows from
`e2e/flows/`, and force-pushes every screenshot to the **`e2e-results`**
branch — which is how a session with no macOS and no phone gets eyes on the
actual product. Fetch that branch and read the PNGs.

Inputs: `build=true` produces a fresh EAS simulator build first (uses an EAS
build credit, ~10 min); `build=false` reuses the latest finished one — right
for JS-only changes since OTA is not part of this loop, wrong after native
changes.

Costs to know: macOS runners bill GitHub minutes at 10x, so a ~15-minute run
charges ~150 of the 2000 free monthly minutes. Simulator limits: no push
notifications, no camera, Sign in with Apple is unreliable — those stay
human-tested on TestFlight.
