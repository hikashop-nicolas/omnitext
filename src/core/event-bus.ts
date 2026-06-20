import type { CoreEvents, CoreHooks, Disposable, EventBus } from "./types";

type AnyHandler = (p: unknown) => void;
type AnyHook = (c: unknown) => void | Promise<void>;

/**
 * Typed pub/sub. Notifications (on/emit) are fire-and-forget; hooks (hook/runHook)
 * run in registration order and may mutate the context (e.g. set cancel = true).
 */
export class DefaultEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<AnyHandler>>();
  private readonly hooks = new Map<string, AnyHook[]>();

  on<E extends keyof CoreEvents>(
    event: E,
    handler: (p: CoreEvents[E]) => void,
  ): Disposable {
    const key = event as string;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    const h = handler as AnyHandler;
    set.add(h);
    return { dispose: () => set!.delete(h) };
  }

  emit<E extends keyof CoreEvents>(event: E, payload: CoreEvents[E]): void {
    const set = this.listeners.get(event as string);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[omnitext] listener for "${String(event)}" threw`, err);
      }
    }
  }

  hook<H extends keyof CoreHooks>(
    name: H,
    handler: (ctx: CoreHooks[H]) => void | Promise<void>,
  ): Disposable {
    const key = name as string;
    let arr = this.hooks.get(key);
    if (!arr) {
      arr = [];
      this.hooks.set(key, arr);
    }
    const h = handler as AnyHook;
    arr.push(h);
    return {
      dispose: () => {
        const i = arr!.indexOf(h);
        if (i >= 0) arr!.splice(i, 1);
      },
    };
  }

  async runHook<H extends keyof CoreHooks>(
    name: H,
    ctx: CoreHooks[H],
  ): Promise<CoreHooks[H]> {
    const arr = this.hooks.get(name as string);
    if (!arr) return ctx;
    for (const h of [...arr]) {
      await h(ctx);
    }
    return ctx;
  }
}
