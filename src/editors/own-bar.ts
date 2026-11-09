/**
 * A viewer with a bottom bar of its own takes the app's status bar's place on the phone, and the view
 * switcher (the eye button) moves into that bar, so the way to another view stays one tap away.
 * Returns what puts the button back where it was.
 */
export function adoptViewButton(slot: HTMLElement): () => void {
  const button = document.getElementById("view-btn");
  const status = document.getElementById("status");
  document.body.classList.add("ot-own-bar");
  if (!button || !status) return () => document.body.classList.remove("ot-own-bar");
  slot.append(button);
  return () => {
    // Before the viewer's own DOM goes: the button must outlive it.
    status.append(button);
    document.body.classList.remove("ot-own-bar");
  };
}
