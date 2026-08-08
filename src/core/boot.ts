/**
 * Chooses the document a cold start ends up showing.
 *
 * The sources race. An installed PWA launched through the OS "Open with" receives its
 * file from the launch queue on the queue's own schedule, which can be at any point
 * while the crash-recovery snapshot is still loading. Mounting whatever finished last
 * therefore let a recovered (or blank) document land on top of the file the user asked
 * the OS to open.
 *
 * So the OS is asked twice over: `osOpen` is re-read before every mount rather than
 * sampled once, and its answer is awaited rather than assumed. Awaiting is what keeps a
 * file that turns out to be unreadable from leaving the app with no document at all.
 */
export interface BootSources<S> {
  /** The in-flight OS open, or null if the OS has not handed anything over (yet). */
  osOpen: () => Promise<boolean> | null;
  /** Boot-time openers, polled in order; true means one of them took the screen. */
  openers: Array<() => Promise<boolean>>;
  /** The crash-recovery snapshot, or null. Reports its own failures. */
  loadSnapshot: () => Promise<S | null>;
  /** Mount a recovered snapshot; false when there was nothing worth restoring. */
  mountSnapshot: (snapshot: S) => Promise<boolean>;
  mountBlank: () => Promise<void>;
}

export async function bootDocument<S>(sources: BootSources<S>): Promise<void> {
  const osTook = async (): Promise<boolean> => {
    const pending = sources.osOpen();
    return pending ? await pending : false;
  };

  for (const open of sources.openers) {
    if (await osTook()) return;
    if (await open()) return;
  }
  if (await osTook()) return;
  const snapshot = await sources.loadSnapshot();
  if (await osTook()) return;
  if (snapshot && (await sources.mountSnapshot(snapshot))) return;
  if (await osTook()) return;
  await sources.mountBlank();
}
