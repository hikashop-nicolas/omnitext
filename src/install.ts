import { isNative } from "./core/platform";
import { t } from "./i18n";

// "Install Omnitext" from a link: …/omnitext/#install opens a dialog whose button shows the
// browser's own install prompt. The prompt needs a click on this page, so the link cannot
// install by itself; where the browser offers no prompt, the dialog says how to install by hand.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallRoute = "prompt" | "running" | "safariMac" | "safariIos" | "firefox" | "android" | "menu";

/** How this browser installs a web app, when it gives the page no prompt to show. */
export function manualRoute(ua: string, touchPoints: number): Exclude<InstallRoute, "prompt" | "running"> {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (ios) return "safariIos";
  if (/Android/.test(ua)) return "android";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return "safariMac";
  return "menu";
}

interface InstallDeps {
  trapModalTab(card: HTMLElement, e: KeyboardEvent): void;
  /** Settles once the strings are loaded: the dialog waits for it, the listeners do not. */
  ready: Promise<unknown>;
}

let offer: InstallPromptEvent | null = null;
let installed = false;
let refresh: (() => void) | null = null;

const running = (): boolean =>
  matchMedia("(display-mode: standalone)").matches ||
  matchMedia("(display-mode: window-controls-overlay)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

export function initInstall(deps: InstallDeps): void {
  if (isNative()) return;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // kept for the dialog's button instead of the browser's own banner
    offer = e as InstallPromptEvent;
    refresh?.();
  });
  addEventListener("appinstalled", () => {
    offer = null;
    installed = true;
    refresh?.();
  });
  const check = (): void => {
    if (location.hash !== "#install") return;
    history.replaceState(history.state, "", location.pathname + location.search);
    openDialog(deps);
  };
  void deps.ready.then(() => {
    addEventListener("hashchange", check);
    check();
  });
}

function openDialog(deps: InstallDeps): void {
  if (document.getElementById("installdlg")) return;
  const back = document.activeElement as HTMLElement | null;
  const modal = document.createElement("div");
  modal.id = "installdlg";
  modal.className = "modal";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "installdlg-title");
  const title = document.createElement("h2");
  title.id = "installdlg-title";
  title.className = "modal-title";
  title.textContent = t("install.title");
  const text = document.createElement("p");
  text.className = "modal-text";
  text.setAttribute("aria-live", "polite");
  const how = document.createElement("p");
  how.className = "modal-text";
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn btn-primary";
  go.textContent = t("install.install");
  actions.append(cancel, go);
  card.append(title, text, how, actions);
  modal.append(card);
  document.body.append(modal);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
    else deps.trapModalTab(card, e);
  };
  const close = (): void => {
    refresh = null;
    document.removeEventListener("keydown", onKey);
    modal.remove();
    back?.focus?.();
  };
  const show = (): void => {
    const route: InstallRoute = installed || running() ? "running" : offer ? "prompt" : manualRoute(navigator.userAgent, navigator.maxTouchPoints);
    text.textContent = route === "running" ? t(installed ? "install.done" : "install.running") : t("install.intro");
    how.textContent = route === "running" || route === "prompt" ? "" : t(`install.${route}`);
    how.hidden = !how.textContent;
    go.hidden = route !== "prompt";
    cancel.textContent = route === "prompt" ? t("install.notNow") : t("install.close");
    // a button that just hid itself (Install, once used) must not keep the focus
    const a = document.activeElement as HTMLElement | null;
    if (!a || !card.contains(a) || a.hidden) (go.hidden ? cancel : go).focus();
  };
  refresh = show;
  show();

  go.addEventListener("click", async () => {
    const o = offer;
    if (!o) return show();
    offer = null; // a prompt can be shown only once
    await o.prompt();
    if ((await o.userChoice).outcome === "accepted") installed = true;
    show();
  });
  cancel.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", onKey);
}
