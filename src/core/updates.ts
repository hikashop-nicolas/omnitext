/**
 * Whether this window is running the newest deploy, and how to get onto it.
 *
 * The service worker deliberately does not take over while a window is still open, so
 * assets a running page might still ask for never disappear underneath it. The cost is
 * that a PWA which is never fully closed can serve an old build indefinitely, with
 * nothing on screen saying so. These two functions are the way to ask and the way to
 * say yes.
 */

export interface WorkerLike {
  state: string;
  postMessage(data: unknown): void;
  addEventListener(type: "statechange", cb: () => void): void;
  removeEventListener(type: "statechange", cb: () => void): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  update(): Promise<unknown>;
}

/** "ready" means a newer build is downloaded and held back, waiting to be let in. */
export type UpdateCheck = "current" | "ready" | "failed";

export async function checkForUpdate(reg: RegistrationLike): Promise<UpdateCheck> {
  try {
    await reg.update();
  } catch {
    return "failed"; // offline, or the server did not answer
  }
  if (reg.waiting) return "ready";
  // A worker that is still downloading is neither current nor ready yet. Answering
  // "up to date" here is the answer someone would act on, and it would be wrong.
  if (reg.installing && !(await settles(reg.installing))) return "failed";
  return reg.waiting ? "ready" : "current";
}

/** Resolves false if the worker went redundant, i.e. the install failed. */
function settles(worker: WorkerLike): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ok: boolean): void => {
      worker.removeEventListener("statechange", onChange);
      resolve(ok);
    };
    const onChange = (): void => {
      if (worker.state === "installed" || worker.state === "activated") finish(true);
      else if (worker.state === "redundant") finish(false);
    };
    worker.addEventListener("statechange", onChange);
    onChange(); // it may have settled before the listener was attached
  });
}

/**
 * Run an action at most once, however many times its trigger fires.
 *
 * Reloading is the action: the controller can change more than once around an update,
 * and a page that reloads on each one reloads forever.
 */
export function once(action: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    action();
  };
}
