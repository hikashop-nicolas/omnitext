// The one place Omnitext asks before something is fetched from outside the device. The AI
// features (OCR, translation, the writing assist, transcription) run locally, but download
// their model on first use; localml calls this handler before each of those downloads.
//
// The first time, a dialog names the feature, the size and where it comes from. The answer is
// kept in Settings (aiDownloads) and covers every AI feature from then on; Settings is also
// where it can be changed. Closing the dialog without answering refuses this once only.
import { setRemoteConsentHandler } from "localml/consent";
import { t } from "./i18n";
import { getSettings, saveSettings } from "./settings";

export function formatSize(mb: number | undefined): string {
  if (!mb) return "";
  // Units are localized: French writes Mo and Go.
  return mb >= 1000
    ? t("consent.gb", { n: (mb / 1000).toFixed(1).replace(/\.0$/, "") })
    : t("consent.mb", { n: String(mb) });
}

export function installRemoteConsent(notify: (message: string) => void): void {
  setRemoteConsentHandler(async (req) => {
    const choice = getSettings().aiDownloads;
    if (choice === "allow") return true;
    if (choice === "deny") {
      notify(t("consent.turnedOff"));
      return false;
    }
    const answer = await ask(
      t("consent.body", {
        feature: t(`consent.feature.${req.feature}`),
        what: req.label ? `${req.label}${req.sizeMb ? ` (${t("consent.about")} ${formatSize(req.sizeMb)})` : ""}` : formatSize(req.sizeMb),
        hosts: req.hosts.join(", "),
      }),
      t("consent.note"),
    );
    if (answer !== null) saveSettings({ aiDownloads: answer ? "allow" : "deny" });
    if (answer === false) notify(t("consent.turnedOff"));
    return answer === true;
  });
}

/** The map editor's background tiles. Unlike a model download this repeats while the map is
 *  panned, so it gets its own question and its own setting rather than the AI one. A refusal
 *  leaves the features drawn on an empty canvas, which is a usable map. */
export async function requestBasemap(): Promise<boolean> {
  const choice = getSettings().mapBasemap;
  if (choice === "allow") return true;
  if (choice === "deny") return false;
  const answer = await ask(t("consent.mapBody", { hosts: "openstreetmap.org" }), t("consent.mapNote"));
  if (answer !== null) saveSettings({ mapBasemap: answer ? "allow" : "deny" });
  return answer === true;
}

/** Show the dialog; true = allow, false = don't allow, null = closed without answering. */
function ask(body: string, note: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement as HTMLElement | null;
    const back = document.createElement("div");
    back.className = "modal";
    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "consent-title");

    const title = document.createElement("h2");
    title.className = "modal-title";
    title.id = "consent-title";
    title.textContent = t("consent.title");
    const bodyEl = document.createElement("p");
    bodyEl.textContent = body;
    const noteEl = document.createElement("p");
    noteEl.className = "modal-hint";
    noteEl.textContent = note;

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn";
    no.textContent = t("consent.deny");
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn btn-primary";
    yes.textContent = t("consent.allow");
    actions.append(no, yes);
    card.append(title, bodyEl, noteEl, actions);
    back.appendChild(card);

    const finish = (answer: boolean | null) => {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      returnFocus?.focus();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      } else if (e.key === "Tab") {
        // Keep focus on the two buttons while the dialog is up.
        e.preventDefault();
        (document.activeElement === yes ? no : yes).focus();
      }
    };
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    back.addEventListener("click", (e) => {
      if (e.target === back) finish(null);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    yes.focus();
  });
}
