/**
 * The settings dialog: an icon rail picking between a General, a Sharing and an About pane.
 *
 * Everything here is about the dialog itself. What a setting then means to the running
 * document is the host's business, which is why the theme arrives back as a callback
 * instead of this module reaching for the session.
 */
import { checkForUpdate, once } from "./core/updates";
import { REPO_URL } from "./core/links";
import { BUILD_ID } from "./build-id";
import { t } from "./i18n";
import { getSettings, saveSettings, type Theme } from "./settings";
import { turnServers, type TurnProblem } from "./tools/collab/turn";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export interface SettingsDialogHost {
  /** Keep Tab inside the card. The app's other dialogs use the same helper. */
  trapModalTab(card: HTMLElement, e: KeyboardEvent): void;
  /** A new theme was saved: the palette is already applied, the editor may need remounting. */
  onThemeChanged(theme: Theme): void;
}

export interface SettingsDialog {
  open(): void;
  /** The service worker registration, once it resolves; never in the app or on the dev server. */
  setRegistration(reg: ServiceWorkerRegistration | null): void;
  /** True while this window is deliberately taking an update, so it does not warn itself. */
  isApplyingUpdate(): boolean;
}

/** Apply a theme choice to the palette. Exported because the boot path sets it too. */
export function applyThemeAttribute(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function initSettingsDialog(host: SettingsDialogHost): SettingsDialog {
  const dlgEl = $("settingsdlg");
  // The link lives in one place (core/links), not hardcoded in the markup as well.
  ($("setting-source") as HTMLAnchorElement).href = REPO_URL;
  const nameEl = $("setting-name") as HTMLInputElement;
  const pageSizeEl = $("setting-pagesize") as HTMLSelectElement;
  const paginatedEl = $("setting-paginated") as HTMLInputElement;
  const themeEl = $("setting-theme") as HTMLSelectElement;
  const aiEl = $("setting-ai") as HTMLSelectElement;
  const mapEl = $("setting-map") as HTMLSelectElement;
  const turnUrlEl = $("setting-turn-url") as HTMLInputElement;
  const turnUserEl = $("setting-turn-user") as HTMLInputElement;
  const turnPassEl = $("setting-turn-pass") as HTMLInputElement;
  const turnStatusEl = $("setting-turn-status");
  const buildEl = $("setting-build");
  const updateEl = $("setting-update") as HTMLButtonElement;
  const updateStatusEl = $("setting-update-status");
  const progressEl = $("setting-update-progress");
  const tabs = Array.from(dlgEl.querySelectorAll<HTMLButtonElement>(".settings-tab"));

  let returnFocus: HTMLElement | null = null;
  let registration: ServiceWorkerRegistration | null = null;
  let applyingUpdate = false;

  // --- panes -------------------------------------------------------------------

  /** Show one pane and mark its tab, moving focus onto the tab unless the dialog is opening. */
  function showPane(pane: string, focus = true): void {
    for (const tab of tabs) {
      const on = tab.dataset.pane === pane;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1; // one tab stop for the rail; arrows move within it
      $(tab.getAttribute("aria-controls")!).hidden = !on;
      if (on && focus) tab.focus();
    }
  }
  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener("click", () => showPane(tab.dataset.pane!));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      showPane(tabs[(i + step + tabs.length) % tabs.length]!.dataset.pane!);
    });
  }

  // --- (i) tooltips -------------------------------------------------------------

  // The long explanations are worth having and worth not reading four times over. Each
  // one stays in the markup, hidden, and its (i) button shows it on hover, on keyboard
  // focus and on tap. Positioned fixed, because the pane it sits in scrolls and clips.
  let tipEl: HTMLElement | null = null;
  let openTipBtn: HTMLButtonElement | null = null;
  function hideTip(): void {
    if (tipEl) tipEl.hidden = true;
    openTipBtn?.setAttribute("aria-expanded", "false");
    openTipBtn = null;
  }
  function showTip(btn: HTMLButtonElement): void {
    const text = $(btn.dataset.tip!).textContent ?? "";
    if (!text) return;
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "settings-tip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = text;
    tipEl.hidden = false;
    // Below the button, pulled back inside the viewport on both axes.
    const r = btn.getBoundingClientRect();
    const box = tipEl.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - box.width - 8));
    const below = r.bottom + 6;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${below + box.height > window.innerHeight - 8 ? Math.max(8, r.top - box.height - 6) : below}px`;
    btn.setAttribute("aria-expanded", "true");
    openTipBtn = btn;
  }
  for (const btn of Array.from(dlgEl.querySelectorAll<HTMLButtonElement>(".settings-info"))) {
    // The text is also the button's own tooltip, so it is reachable without JavaScript
    // positioning and is what a screen reader reads out.
    btn.title = $(btn.dataset.tip!).textContent ?? "";
    btn.addEventListener("mouseenter", () => showTip(btn));
    btn.addEventListener("mouseleave", hideTip);
    btn.addEventListener("focus", () => showTip(btn));
    btn.addEventListener("blur", hideTip);
    btn.addEventListener("click", (e) => {
      e.preventDefault(); // a tap must not also toggle the field this label belongs to
      if (openTipBtn === btn) hideTip();
      else showTip(btn);
    });
  }

  // --- updates -------------------------------------------------------------------

  /**
   * Check for a newer deploy, and on a second press let it in.
   *
   * The worker holds a new build back until every window is closed, which is right for the
   * chunks a running page may still need and wrong for anyone who keeps the app open. The
   * button is the way to say "now", and the page reloads onto it immediately.
   */
  async function updateButtonPressed(): Promise<void> {
    const reg = registration;
    if (!reg) return;
    if (reg.waiting) {
      applyingUpdate = true;
      updateStatusEl.textContent = t("app.updateApplying");
      progressEl.hidden = false; // the reload is the end of it, so this bar just runs out
      navigator.serviceWorker.addEventListener("controllerchange", once(() => location.reload()));
      reg.waiting.postMessage("omnitext-skip-waiting");
      return;
    }
    // The check goes to the network and can sit there for seconds. Without this the
    // dialog looks like it ignored the press.
    updateEl.disabled = true;
    progressEl.hidden = false;
    updateStatusEl.textContent = t("app.updateChecking");
    const result = await checkForUpdate(reg);
    updateEl.disabled = false;
    progressEl.hidden = true;
    updateStatusEl.textContent =
      result === "ready" ? t("app.updateFound")
      : result === "failed" ? t("app.updateCheckFailed")
      : t("app.updateCurrent");
    if (result === "ready") updateEl.textContent = t("app.updateApply");
  }

  // --- relay -------------------------------------------------------------------

  const turnFromDialog = () => ({
    url: turnUrlEl.value.trim(),
    username: turnUserEl.value.trim(),
    credential: turnPassEl.value,
  });

  /**
   * Say whether the relay as typed would be used, and if not, why.
   *
   * A relay that is wrong fails at connection time, minutes later, with nothing pointing at
   * the field that caused it. Saying so here is the whole value of the field having a check.
   */
  function showTurnStatus(): TurnProblem | null {
    const { problem } = turnServers(turnFromDialog());
    turnStatusEl.textContent =
      problem === "scheme"
        ? t("app.turnBadScheme")
        : problem === "credentials"
          ? t("app.turnNeedCreds")
          : problem === null
            ? t("app.turnOk")
            : "";
    return problem;
  }

  // --- open / close / save -------------------------------------------------------

  function open(): void {
    returnFocus = document.activeElement as HTMLElement | null;
    const s = getSettings();
    nameEl.value = s.name;
    pageSizeEl.value = s.pageSize;
    paginatedEl.checked = s.paginated;
    themeEl.value = s.theme;
    aiEl.value = s.aiDownloads;
    mapEl.value = s.mapBasemap;
    turnUrlEl.value = s.turn?.url ?? "";
    turnUserEl.value = s.turn?.username ?? "";
    turnPassEl.value = s.turn?.credential ?? "";
    showTurnStatus();
    buildEl.textContent = BUILD_ID;
    // No worker means no deploy to check against: the packaged app and the dev server both
    // carry their build with them, so the number is worth showing and the button is not.
    updateEl.hidden = !registration;
    updateEl.textContent = registration?.waiting ? t("app.updateApply") : t("app.checkUpdates");
    updateStatusEl.textContent = registration?.waiting ? t("app.updateFound") : "";
    progressEl.hidden = true;
    showPane("general", false); // always open on the pane most people came for
    dlgEl.hidden = false;
    tabs[0]!.focus(); // the first field is on another pane now; start on the rail
  }

  function close(): void {
    hideTip();
    dlgEl.hidden = true;
    returnFocus?.focus();
    returnFocus = null;
  }

  function save(): void {
    // A typed-in relay that would not be used keeps the dialog open. Saving it silently
    // would leave the person believing they had configured one.
    const turn = turnFromDialog();
    if (turn.url && showTurnStatus() !== null) {
      showPane("sharing", false); // the field at fault may be on a pane that is not showing
      turnUrlEl.focus();
      return;
    }
    const theme: Theme = themeEl.value === "light" ? "light" : themeEl.value === "dark" ? "dark" : "system";
    const themeChanged = theme !== getSettings().theme;
    saveSettings({
      name: nameEl.value.trim(),
      pageSize: pageSizeEl.value === "letter" ? "letter" : "a4",
      paginated: paginatedEl.checked,
      theme,
      turn,
      aiDownloads: aiEl.value === "allow" ? "allow" : aiEl.value === "deny" ? "deny" : "ask",
      mapBasemap: mapEl.value === "allow" ? "allow" : mapEl.value === "deny" ? "deny" : "ask",
    });
    if (themeChanged) {
      applyThemeAttribute(theme);
      host.onThemeChanged(theme);
    }
    close();
  }

  for (const el of [turnUrlEl, turnUserEl, turnPassEl]) {
    el.addEventListener("input", () => void showTurnStatus());
  }
  updateEl.addEventListener("click", () => void updateButtonPressed());
  $("btn-settings").addEventListener("click", open);
  $("settings-cancel").addEventListener("click", close);
  $("settings-save").addEventListener("click", save);
  dlgEl.addEventListener("click", (e) => {
    if (e.target === dlgEl) close();
  });
  dlgEl.addEventListener("keydown", (e) => host.trapModalTab(dlgEl.querySelector(".modal-card") as HTMLElement, e));
  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || dlgEl.hidden) return;
    if (openTipBtn) hideTip(); // a tooltip is the innermost thing open: close that first
    else close();
  });
  // The tooltip is positioned against the viewport, so anything that moves the button
  // under it leaves it stranded.
  window.addEventListener("resize", hideTip);
  dlgEl.querySelector(".settings-panes")?.addEventListener("scroll", hideTip);

  return {
    open,
    setRegistration(reg) {
      registration = reg;
    },
    isApplyingUpdate: () => applyingUpdate,
  };
}
