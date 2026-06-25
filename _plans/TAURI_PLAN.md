# Omnitext as a desktop app (Tauri) plan

Status: deferred. Polish the web app first; pick this up afterwards.

## Goal and hard constraints

- Ship Omnitext as a native desktop app on **Windows, Linux, and macOS** from the
  existing web build, with proper OS file association ("Open with Omnitext" and
  double-click a `.docx` / `.json` / ... to open it).
- The GitHub Pages site and the Android (Capacitor) app must keep working
  **exactly as today**. Same source, same `npm run build`, same `dist/`. No web
  or Android regressions. Tauri is additive.
- Preserve the offline / privacy story: the app bundles its own assets, depends
  on no server, nothing leaves the device.

## Why Tauri (vs Electron / PWA)

- **Tauri**: Rust shell around the OS's native webview. Small binaries (~5-10 MB),
  one project builds all three desktop OSes, first-class `fileAssociations`,
  native file dialogs, MIT/Apache (free). Chosen.
- **Electron**: bundles Chromium (~100 MB+), maximally consistent but heavy.
  Rejected for size; revisit only if a WebKit gap proves blocking.
- **PWA**: gives "Install" + File Handling API "Open with" on Chrome/Edge desktop
  only (no Safari/Firefox, no robust association). Worth doing separately as the
  zero-cost option, but it is not browser-independent. Tauri is the dependable
  native route.

## Why this is low risk for the web build

Same three facts that made Android additive (see ANDROID_PLAN.md) apply:

1. `vite.config.ts` already sets `base: "./"` (relative asset URLs), so the same
   `dist/` works from Pages, Capacitor, and Tauri's local origin. One build mode.
2. Every dependency is pure JS (CodeMirror, Quill, Milkdown, pdf.js, pdf-lib,
   fflate, fast-formula-parser, xlsx, the `*edit` libraries). No native modules.
3. `openFile()` / `saveFile()` already degrade: File System Access API when
   present (`window.showOpenFilePicker` / save handle), else the `<input
   type=file>` + download fallback. So a webview without that API still works.

## Engines and the one real gotcha

Tauri uses the platform webview, not a bundled Chromium:

| OS | Webview | Engine |
|---|---|---|
| Windows | WebView2 | Chromium (no API gaps) |
| Linux | WebKitGTK | WebKit (Safari-like) |
| macOS | WKWebView | WebKit (Safari-like) |

**The File System Access API is absent on WebKit (macOS + Linux).** Today that
silently falls back to download/upload, which works but is not a real
"edit in place, Ctrl+S to the same file" experience. The desktop fix is to route
open/save through Tauri's native layer when running under Tauri:

- Detect Tauri at runtime (`window.__TAURI__` / `window.__TAURI_INTERNALS__`).
- Open: use Tauri's `dialog.open` + `fs.readFile` (plugin-dialog, plugin-fs).
- Save: use `dialog.save` + `fs.writeFile`, keeping the path for plain re-save.
- Keep the current web path unchanged when not under Tauri.

This is the main app-code change. Everything else is wrapper/config/CI.

## File association ("Open with")

1. Declare associations in `src-tauri/tauri.conf.json` under
   `bundle.fileAssociations` (ext + mimeType + description + role=Editor) for the
   formats Omnitext owns: `.docx .odt .xlsx .ods .pdf .json .json5 .csv .tsv .md
   .markdown .yaml .yml .xml .html .txt .ini .toml` (final list = the registered
   format modules).
2. The installer registers Omnitext as a handler at install time on all three OS,
   so the OS "Open with" menu and double-click work regardless of the user's
   browser.
3. Receive the launched file path:
   - The OS launches/forwards the path. Use the `single-instance` plugin so a
     second "open with" reuses the running window, plus the `deep-link` / opened
     paths event (and on macOS the `RunEvent::Opened` files event) to get the
     path.
   - Bridge it to the web layer (emit a Tauri event the page listens for), then
     feed it into the same code path `openFile()` uses after it has bytes.

## Cost and signing (free path first)

Building everything is free (Tauri is OSS; CI on GitHub Actions). Money only
removes "untrusted app" warnings when distributing to other people:

- **Linux**: free, no signing, no warnings. Ship AppImage/.deb.
- **Windows**: free to build/run; unsigned shows SmartScreen "More info -> Run
  anyway" once. Code-signing cert (~$100-400/yr) removes it. Optional.
- **macOS**: free to build/run; unsigned needs right-click -> Open once (or
  `xattr -cr`). Apple Developer Program ($99/yr) enables signing + notarization
  for friction-free direct DMG distribution (and unlocks iOS later). Optional.

Decision for v1: **ship unsigned ($0)**; add signing only if distributing
publicly. For personal machines there is zero friction beyond a one-time allow.

## CI

- Add `.github/workflows/tauri.yml` using `tauri-apps/tauri-action` with a matrix
  of `ubuntu-latest` (AppImage + .deb), `windows-latest` (.msi/.exe), and
  `macos-latest` (.dmg/.app). macOS must build on a Mac runner; cross-compile is
  not viable.
- Reuse `npm run build` for the frontend; Tauri's `beforeBuildCommand` runs it.
- Publish the installers as workflow artifacts (and optionally a GitHub Release,
  like the Android `android-latest` release).
- Keep `deploy.yml` and `android.yml` untouched.

## Step-by-step task list

1. `npm create tauri-app` style init into `src-tauri/` (or `cargo tauri init`):
   `frontendDist = "../dist"`, `devUrl = "http://localhost:5173"` (the Vite dev
   server), `beforeBuildCommand = "npm run build"`. App id `app.omnitext`.
2. Add icons (reuse `@capacitor/assets` source / `~/Downloads/omnitext-store/`).
3. Add plugins: `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-single-instance`,
   and the opened-file path mechanism.
4. App code: a small `desktop.ts` that, when `window.__TAURI__` is present,
   overrides open/save to use the native dialog + fs, and listens for the
   "open-with" file path event. No change to the web/Capacitor paths.
5. `bundle.fileAssociations` for the format list.
6. `tauri.yml` CI matrix producing all three installers as artifacts.
7. Verify (below). Ship unsigned.
8. (Later, optional) Windows cert + Apple notarization for public distribution.

## Verification

- `cargo tauri dev` opens the app; editing/saving works on each OS.
- Build each target in CI; install locally:
  - Linux: AppImage runs; double-clicking a `.docx` opens it in Omnitext.
  - Windows: .msi installs; "Open with -> Omnitext" appears; double-click opens.
  - macOS: .dmg mounts; right-click -> Open once; "Open with" lists Omnitext.
- Round-trip a file opened via association: edit, save back to the same path.
- Confirm the web build (`npm run build` + Pages) and Android build are unchanged.

## Open questions / decisions for later

- Final list of associated extensions (= which format modules "own" their type;
  avoid grabbing `.txt`/`.json` from the user's existing editor if undesired).
- Native menu bar (File/Edit) + accelerators, or keep the in-app toolbar only.
- Auto-update (Tauri updater) vs manual download. Updater needs a signing key
  (free, self-managed) and a hosted update manifest.
- Whether to also produce a macOS build now or defer until there is an Apple
  account.
