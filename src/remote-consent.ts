// The one place Omnitext asks before something is fetched from outside the device. The AI
// features (OCR, translation, the writing assist, transcription) run locally, but download
// their model on first use; localml calls this handler before each of those downloads.
//
// The first time, a dialog names the feature, the size and where it comes from. The answer is
// kept in Settings (aiDownloads) and covers every AI feature from then on; Settings is also
// where it can be changed. Closing the dialog without answering refuses this once only.
import { setRemoteConsentHandler, type RemoteRequest } from "localml/consent";
import { t } from "./i18n";
import { getSettings, saveSettings } from "./settings";

export function formatSize(mb: number | undefined): string {
  if (!mb) return "";
  return mb >= 1000 ? `${(mb / 1000).toFixed(1).replace(/\.0$/, "")} GB` : `${mb} MB`;
}

export function installRemoteConsent(notify: (message: string) => void): void {
  setRemoteConsentHandler(async (req) => {
    const choice = getSettings().aiDownloads;
    if (choice === "allow") return true;
    if (choice === "deny") {
      notify(t("consent.turnedOff"));
      return false;
    }
    const answer = await ask(req);
    if (answer !== null) saveSettings({ aiDownloads: answer ? "allow" : "deny" });
    if (answer === false) notify(t("consent.turnedOff"));
    return answer === true;
  });
}

/** Show the dialog; true = allow, false = don't allow, null = closed without answering. */
function ask(req: RemoteRequest): Promise<boolean | null> {
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
    const body = document.createElement("p");
    body.textContent = t("consent.body", {
      feature: t(`consent.feature.${req.feature}`),
      what: req.label ? `${req.label}${req.sizeMb ? ` (${t("consent.about")} ${formatSize(req.sizeMb)})` : ""}` : formatSize(req.sizeMb),
      hosts: req.hosts.join(", "),
    });
    const note = document.createElement("p");
    note.className = "modal-hint";
    note.textContent = t("consent.note");

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
    card.append(title, body, note, actions);
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
