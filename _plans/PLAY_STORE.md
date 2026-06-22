# Omnitext, Google Play publication checklist

The long pole is time, not work: a new personal developer account must run a **closed
test with at least 12 testers opted in for 14 continuous days** before it can apply for
production, and account verification itself can take a few days. So do steps 1 and 5
as early as possible.

## What is already prepared

- **Signed App Bundle (AAB)**: built by CI on every push to `main` once the signing
  secrets are set. Download the latest one with:
  `gh run download <run-id> -n play-aab` (the `play-aab` artifact = `omnitext.aab`),
  or from the run's Artifacts section on GitHub. This is what you upload to Play.
- **Privacy policy URL**: https://hikashop-nicolas.github.io/omnitext/privacy.html
- Signing is via your own upload key (Play App Signing will manage the app signing key).

## Still to generate (I can produce these next)

- App icon (512x512 store icon + adaptive launcher icons).
- Feature graphic (1024x500).
- Phone screenshots (2 to 8) - I can capture them from the app at phone size.

## Steps

1. **Create the Play Console account** (do now): https://play.google.com/console ,
   one-time 25 USD. Identity verification can take a few days; start it first.
2. **Create the app**: name "Omnitext", default language English (United States), type
   "App", "Free". Accept the declarations.
3. **App content / Policy declarations** (required before any release, including closed
   testing). Suggested answers:
   - Privacy policy: the URL above.
   - Data safety: **No data collected and no data shared.** (Everything stays on the
     device; no analytics, no accounts.) Answer "No" to data collection and sharing.
   - Ads: **No ads.**
   - Content rating questionnaire: category "Utility/Productivity"; no violence, no
     sexual content, no profanity, no controlled substances, no user-to-user content,
     no data sharing. Result should be "Everyone" / PEGI 3.
   - Target audience: choose the adult age groups (e.g. 18+ or 13+); the app is a
     productivity tool, not aimed at children.
   - App access: **All functionality is available without special access** (no login,
     no restrictions). Provide no test credentials (none needed).
   - News app: No. Government app: No. COVID-19 app: No. Financial features: No.
4. **Closed testing release**:
   - Testing -> Closed testing -> create a track (e.g. "alpha").
   - Create a release, upload `omnitext.aab`, add release notes.
   - Testers: add at least 12 testers' Google account emails (a list or a Google
     Group). Share the opt-in URL; each tester must accept. The 14-day clock needs 12+
     opted-in testers continuously.
   - Roll out the closed test. Note the date; the earliest you can request production
     is 14 days later.
5. **During the 14 days**: finish the **Store listing** (needed for production):
   - App icon (512x512), feature graphic (1024x500), 2 to 8 phone screenshots.
   - Short and full descriptions (drafts below).
   - Category: "Productivity". Contact email. Privacy policy URL (same as above).
6. **After 14 days with 12+ testers**: apply for production access, then promote a
   release to Production and submit for review.

## Listing copy (draft)

**App name**: Omnitext

**Short description** (<= 80 chars):
> Private, offline editor for text, code, PDF, Word, spreadsheets and more.

**Full description** (draft):
> Omnitext is a private, offline editor that adapts to whatever file you open: code and
> data formats (JSON, YAML, XML, CSV, Markdown and more) in a proper editor, and PDF,
> Word (.docx), OpenDocument (.odt) and spreadsheets (.xlsx/.ods) in dedicated editors,
> all on your device.
>
> Everything runs locally. Your files are never uploaded, there is no account, no
> tracking, and no ads. Open a file, edit it, and save it back, entirely offline.
>
> - Edit PDFs: change text in place, add text and images, pinch to zoom.
> - Edit Word, OpenDocument and spreadsheets, preserving the parts you do not touch.
> - Code and data editor with syntax highlighting for many formats.
> - Version history so you can roll back changes.
> - Private by design: nothing leaves your device.

## Data safety summary (for the console form)

- Does your app collect or share any of the required user data types? **No.**
- Is all user data encrypted in transit? Not applicable (no data is sent).
- Do you provide a way to request data deletion? Not applicable (no data is collected;
  local data is cleared by clearing app storage).
