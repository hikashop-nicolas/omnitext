# Omnitext, Google Play publication checklist (completed)

Historical record of getting Omnitext onto Google Play. All of it is done; the standing
release procedure lives in `../PLAY_STORE.md`.

The long pole was time rather than work: a new personal developer account had to run a
closed test with at least 12 testers opted in for 14 continuous days before it could
apply for production, and account verification itself took a few days.

## The steps, as executed

1. **Play Console account**: created, one-time 25 USD, identity verification first
   because it gates everything else.
2. **App created**: "Omnitext", default language English (United States), type "App",
   "Free".
3. **App content / policy declarations**, required before any release including closed
   testing. The answers given are kept in `../PLAY_STORE.md` under "Console answers",
   since they have to stay consistent across re-declarations.
4. **Closed testing**: an "alpha" track, first build 1.0 on 2026-07-09, 12+ testers
   opted in and held for the 14 continuous days.
5. **Store listing** completed during the 14 days: icon, feature graphic, screenshots,
   short and full descriptions, category "Productivity", contact email, privacy policy.
6. **Production access** applied for after the 14 days, then a release promoted to
   production and submitted for review.

## Signing

Signing uses our own upload key, held in CI secrets; Play App Signing manages the app
signing key. CI builds a signed AAB on every push to `main`, with the version code taken
from the run number so uploads never collide.
