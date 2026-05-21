# Runtime Save and Onboarding Reliability Plan

- [x] Canonicalize setup/runtime state as `setup_required`, `starting`, `onboarding`, or `ready` so UI and server gates share one read model.
- [x] Gate impossible actions while setup is incomplete, including direct server requests for regular sessions.
- [x] Contain runtime event stream cancellation and upstream read failures so a dropped browser stream cannot crash the app process.
- [x] Keep room configuration saves independent from post-save runtime restart side effects.
- [x] Refine onboarding so OAuth completion reconciles desired-running rooms, pending intro sessions redirect automatically, and operator replies are asynchronous. (The intro opener is now asynchronous too, so setup can expose the intro session immediately.)
- [x] Persist room intro output through the canonical room profile and visible memory sections, while failed tool calls replay as failed.
- [x] Verify the observed failure modes with regression tests for stream cleanup, setup gates, onboarding profile capture, and post-save runtime isolation.
