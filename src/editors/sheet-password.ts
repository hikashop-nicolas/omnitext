import { t } from "../i18n";

/** The app's password dialog for an encrypted workbook; null when it is cancelled. */
export function askWorkbookPassword(wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement as HTMLElement | null;
    const back = document.createElement("div");
    back.className = "modal";
    const card = document.createElement("form");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "sheet-pw-title");

    const title = document.createElement("h2");
    title.className = "modal-title";
    title.id = "sheet-pw-title";
    title.textContent = t("sheet.passwordTitle");
    const field = document.createElement("label");
    field.className = "modal-field";
    const label = document.createElement("span");
    label.textContent = t("sheet.passwordLabel");
    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    field.append(label, input);
    const err = document.createElement("p");
    err.className = "modal-hint ot-sheet-pw-err";
    err.setAttribute("aria-live", "polite");
    err.textContent = wrong ? t("sheet.passwordWrong") : "";
    err.hidden = !wrong;

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = t("app.cancel");
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "btn btn-primary";
    ok.textContent = t("sheet.passwordOpen");
    actions.append(cancel, ok);
    card.append(title, field, err, actions);
    back.appendChild(card);

    const finish = (answer: string | null) => {
      back.remove();
      document.removeEventListener("keydown", onKey, true);
      returnFocus?.focus();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      finish(null);
    };
    card.addEventListener("submit", (e) => {
      e.preventDefault();
      finish(input.value);
    });
    cancel.addEventListener("click", () => finish(null));
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    input.focus();
  });
}
