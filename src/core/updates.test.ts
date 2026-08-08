import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, once, type RegistrationLike, type WorkerLike } from "./updates";

function worker(state = "installing"): WorkerLike & { settle(to: string): void } {
  const listeners = new Set<() => void>();
  return {
    state,
    postMessage: () => undefined,
    addEventListener: (_t, cb) => void listeners.add(cb),
    removeEventListener: (_t, cb) => void listeners.delete(cb),
    settle(to: string) {
      this.state = to;
      for (const cb of [...listeners]) cb();
    },
  };
}

function registration(over: Partial<RegistrationLike> = {}): RegistrationLike {
  return { installing: null, waiting: null, update: async () => undefined, ...over };
}

describe("checkForUpdate", () => {
  it("reports current when the server has nothing newer", async () => {
    expect(await checkForUpdate(registration())).toBe("current");
  });

  it("reports ready when a newer build is already held back", async () => {
    expect(await checkForUpdate(registration({ waiting: worker("installed") }))).toBe("ready");
  });

  it("reports failed when the check cannot reach the server", async () => {
    const reg = registration({ update: async () => { throw new Error("offline"); } });
    expect(await checkForUpdate(reg)).toBe("failed");
  });

  // Answering while a download is in flight is the trap: "up to date" is what someone
  // acts on, so the check has to wait for the worker to settle before saying it.
  it("waits for a download in flight before answering", async () => {
    const installing = worker();
    const reg = { installing, waiting: null as WorkerLike | null, update: async () => undefined };
    const answer = checkForUpdate(reg);
    let settled = false;
    void answer.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // still downloading, so no answer yet

    reg.waiting = installing;
    installing.settle("installed");
    expect(await answer).toBe("ready");
  });

  it("reports current when a first install activates with nothing held back", async () => {
    const installing = worker();
    const reg = registration({ installing });
    const answer = checkForUpdate(reg);
    installing.settle("activated");
    expect(await answer).toBe("current");
  });

  it("reports failed when the download goes redundant", async () => {
    const installing = worker();
    const reg = registration({ installing });
    const answer = checkForUpdate(reg);
    installing.settle("redundant");
    expect(await answer).toBe("failed");
  });

  it("answers even if the worker settled before the listener was attached", async () => {
    expect(await checkForUpdate(registration({ installing: worker("installed") }))).toBe("current");
  });
});

describe("once", () => {
  it("runs the action a single time", () => {
    const action = vi.fn();
    const guarded = once(action);
    guarded();
    guarded();
    guarded();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
