// Hands a trace to Perfetto UI in a new tab, with its postMessage protocol: PING until the page
// answers PONG, then post {perfetto: {buffer, title, fileName}} (docs/visualization/deep-linking-to-perfetto-ui.md).

export const PERFETTO_ORIGIN = "https://ui.perfetto.dev";

export type HandoffResult = "sent" | "blocked" | "timeout";

interface Target {
  closed: boolean;
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface HandoffEnv {
  open(url: string): Target | null;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
}

export interface Handoff {
  result: Promise<HandoffResult>;
  cancel(): void;
}

export function sendToPerfetto(
  bytes: Uint8Array,
  name: string,
  env: HandoffEnv = window as unknown as HandoffEnv,
  opts: { every?: number; timeout?: number } = {},
): Handoff {
  // No noopener: the opened page's handle is how the trace gets there.
  const win = env.open(PERFETTO_ORIGIN);
  if (!win) return { result: Promise.resolve("blocked"), cancel: () => {} };
  let stop = () => {};
  const result = new Promise<HandoffResult>((resolve) => {
    const started = Date.now();
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PERFETTO_ORIGIN || e.source !== (win as unknown) || e.data !== "PONG") return;
      // A fresh copy, transferred so it is not cloned a second time.
      const buffer = bytes.slice().buffer;
      win.postMessage({ perfetto: { buffer, title: name, fileName: name } }, PERFETTO_ORIGIN, [buffer]);
      stop();
      resolve("sent");
    };
    const timer = setInterval(() => {
      if (win.closed || Date.now() - started > (opts.timeout ?? 60_000)) {
        stop();
        resolve("timeout");
        return;
      }
      win.postMessage("PING", PERFETTO_ORIGIN);
    }, opts.every ?? 100);
    env.addEventListener("message", onMessage);
    stop = () => {
      clearInterval(timer);
      env.removeEventListener("message", onMessage);
    };
  });
  return { result, cancel: () => stop() };
}
