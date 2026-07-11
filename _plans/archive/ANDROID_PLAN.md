# Omnitext on Android (Google Play) plan

Status: shipped. The Capacitor Android app builds from the same `npm run build`
bundle, CI (`.github/workflows/android.yml`) publishes a signed release APK to
the rolling `android-latest` GitHub release on every push to `main`, and the app
runs on-device. Kept as the design record; Play Store publication is tracked
separately in PLAY_STORE.md.

## Goal and hard constraints

- Ship Omnitext as an Android app on the Google Play Store.
- The existing GitHub Pages site must keep working **exactly as today**: same
  source, same `npm run build`, same `deploy.yml`, same behaviour. No web
  regressions.
- Preserve the offline / privacy story: the app bundles its own assets and
  depends on no server (nothing leaves the device).

## Why this is low risk for the web build

Three facts from the current repo make Android additive rather than invasive:

1. **`vite.config.ts` already sets `base: "./"`** (relative asset URLs). The same
   `dist/` works from the Pages subpath (`/omnitext/`) AND from Capacitor's local
   origin (`https://localhost`). So there is **no base conflict and no separate
   build mode**: one `npm run build` serves both targets.
2. **Every dependency is pure JS** (CodeMirror, Quill, Milkdown, pdf.js, pdf-lib,
   fflate, fast-formula-parser, xlsx, the *edit libraries). No native modules.
   pdf.js web worker, IndexedDB (autosave + history) and localStorage (zoom) all
   work in a modern Android WebView.
3. **Open already degrades correctly**: `openFile()` uses the File System Access
   API when present, else `fileInput.click()`. Android WebView has no File System
   Access API, so it already falls back to the platform file picker for opening.

The web deploy pipeline (`deploy.yml` -> `npm run build` -> upload `dist`) is left
untouched. Capacitor consumes the same `dist` as its `webDir`. The two never run
in the same job: Pages CI runs `npm run build`; the Android build runs
`npm run build && npx cap sync` locally (or in a separate workflow).

## Approach: Capacitor (bundled, offline) — not a TWA

Capacitor wraps the built web assets inside the app and runs them in a WebView
with native bridges.

- Offline by default and no server dependency, which matches the privacy story.
- Reads as a real app for Google's "minimum functionality" policy.
- Gives an iOS target later for almost no extra work.

A Trusted Web Activity (thin Chrome shell over the live Pages site) is rejected as
the primary route: it loads from the server each launch (weaker offline/privacy)
and is more likely to be flagged as "just a website".

## How it is added to the repo (directory layout)

```
omnitext/
  src/ index.html vite.config.ts        # UNCHANGED (web app + Pages build)
  .github/workflows/deploy.yml          # UNCHANGED (Pages deploy)
  capacitor.config.ts                   # NEW: { appId, appName, webDir: "dist" }
  android/                              # NEW: native project (committed)
    app/build.gradle                    #   reads signing from a gitignored file
  src/core/platform.ts                  # NEW: isNative() + save() adapter
  _plans/ANDROID_PLAN.md                # this file
```

`package.json` additions:

- devDeps: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, plus
  `@capacitor/filesystem` and `@capacitor/share` for native save.
- scripts (the existing `build` is unchanged):
  - `"cap:sync": "npm run build && npx cap sync"`
  - `"android:open": "npx cap open android"`

`.gitignore` additions (keep the native project, drop its build output and any
secrets):

```
android/.gradle/
android/build/
android/app/build/
android/local.properties
android/app/release/
*.keystore
*.jks
keystore.properties
```

Note: `dist/` is already gitignored, which is fine; `npx cap sync` copies the
freshly built `dist` into the Android project on demand.

## Engineering tasks

### 1. Platform + save adapter (the only real code change)

Add `src/core/platform.ts`:

- `isNative()` -> `Capacitor.isNativePlatform()` (returns false on web, so the web
  path is byte-for-byte unchanged; `@capacitor/core` is a tiny no-op shim on web).
- `saveBytes(bytes, filename, mime)`:
  - **web**: the current behaviour (File System Access `createWritable`, else the
    blob download). Move the existing `downloadBytes` logic here untouched.
  - **native**: blob download does not work in a WebView. Write the bytes with
    `@capacitor/filesystem` and let the user place the file. Decide the UX in
    Phase 1 from these options:
    - Storage Access Framework "create document" picker (true Save As, best UX;
      may need a small community plugin or a thin native call).
    - Write to the Documents/Downloads directory and notify.
    - Share sheet (`@capacitor/share`) so the user routes it to Drive/Files/etc.

`saveFile()` in `main.ts` calls `saveBytes(...)` instead of inlining
`downloadBytes`. Open needs no change (the fileInput fallback already works);
verify the Android picker accepts arbitrary file types.

### 2. Verify the heavy editors on device

Confirm on a real device + emulator: pdf.js worker loads (Capacitor serves assets
from a fixed local origin, so relative URLs and the worker resolve), and the PDF /
sheet / docx / odt editors render and round-trip. Add a graceful message if a very
old System WebView cannot load module workers.

### 3. Mobile UX pass (incremental, not blocking for internal testing)

- `<meta name=viewport>` already present? confirm and tune.
- Responsive toolbar (wrap / overflow menu), larger touch targets.
- The side panel (history) as a bottom sheet on narrow screens.
- Touch behaviour of CodeMirror, the CSV grid, and the PDF contenteditable
  overlay.

### 4. App identity

- App icon (512x512 + adaptive icon), splash screen, app name.
- `applicationId` (permanent once published), e.g. `app.omnitext` or a
  domain-based id. Version code / name.
- Minimal permissions: aim for none beyond what SAF/share handle implicitly.

## Build and signing (local, macOS)

Tooling: Android Studio + JDK + Android SDK.

Flow:

```
npm run build          # the same web build Pages uses
npx cap sync           # copy dist into android/ and update native deps
npx cap open android   # build a signed AAB (App Bundle) in Android Studio
```

Signing (credentials, handle with care):

- Generate an **upload keystore**; enrol in Google Play App Signing (Google holds
  the release key, the upload key is recoverable).
- The keystore file and its passwords are secrets: keep the keystore **outside the
  repo** (gitignored), and **never paste signing passwords into the AI/chat**.
  Wire signing via a gitignored `keystore.properties` (or env vars) read by
  `android/app/build.gradle`. Nicolas enters the passwords directly.
- Optional later: a separate `.github/workflows/android.yml` that builds the AAB
  in CI using keystore secrets. Start manual via Android Studio.

## Google Play release (mostly calendar time)

- Play Developer account: 25 USD one-time.
- Upload the AAB; complete the store listing: 512 icon, feature graphic, phone +
  tablet screenshots, descriptions, category, content rating questionnaire.
- **Privacy policy URL** (required): host a short page (a route under the existing
  Pages site works). The **Data safety** form is easy and a selling point: no
  account, no network, no telemetry, nothing leaves the device.
- Testing tracks: internal -> closed -> production. A **new personal developer
  account must run a closed test with at least 12 opted-in testers for 14
  continuous days** before it can apply for production. This is the main calendar
  gate.
- Policy: "minimum functionality" / repackaging. A Capacitor offline app with
  native file handling clears this; a bare site wrapper might not.

## Phased roadmap

- **Phase 0 (proof)**: scaffold Capacitor, reuse `dist`, run on emulator/device,
  confirm all editors + the pdf.js worker render. No store work yet.
- **Phase 1 (I/O)**: native `saveBytes` adapter; verify save/open round-trips for
  pdf, xlsx, ods, docx, odt and text. Pick the native Save As UX.
- **Phase 2 (polish)**: mobile UX, icon/splash, privacy-policy page.
- **Phase 3 (package)**: keystore + signed AAB + internal testing track.
- **Phase 4 (release)**: closed test (12 testers / 14 days) -> production.

## Effort

- Phase 0 + 1 (functional app): about 1 to 3 days of work.
- Phase 2: a few more days for a good phone experience.
- Phases 3 to 4: 2+ weeks of calendar time, little of it hands-on (the testing
  gate and review dominate).

## Risks and open questions (decide before/while building)

- Native Save As UX: SAF document picker vs Downloads dir vs share sheet.
- `applicationId`: choose once, it is permanent after publishing.
- Old System WebView / module-worker support: set `minSdk` sensibly (Capacitor
  default 23 ~= Android 6); worker support depends on the installed WebView,
  usually fine on supported devices.
- Bundle size (Milkdown/Quill/pdf.js): acceptable for an installed app; lazy
  imports are already in place.

## What explicitly stays the same

`src/`, `index.html`, `vite.config.ts` (`base: "./"`), `deploy.yml`,
`npm run build`, and the live site behaviour. The only web-affecting code change is
moving the existing download logic into `saveBytes` and gating a native branch
behind `isNative()`, which is false on the web.
