// Font sources for the richdoc editors. "Get more fonts" (Google Fonts) is off in the F-Droid
// build, see __REMOTE_FONTS__ in vite.config.ts; "Show my fonts" stays on everywhere.
declare const __REMOTE_FONTS__: boolean | undefined;

export function richdocFonts(): { remote: false | { provider: "google" } } {
  const remote = typeof __REMOTE_FONTS__ === "boolean" ? __REMOTE_FONTS__ : true;
  return { remote: remote ? { provider: "google" } : false };
}
