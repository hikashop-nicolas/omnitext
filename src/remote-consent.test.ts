import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRemote, setRemoteConsentHandler, type RemoteRequest } from "localml/consent";

const settings = { aiDownloads: "ask" as "ask" | "allow" | "deny" };
vi.mock("./settings", () => ({
  getSettings: () => settings,
  saveSettings: (patch: Partial<typeof settings>) => Object.assign(settings, patch),
}));
const { formatSize, installRemoteConsent } = await import("./remote-consent");

const req: RemoteRequest = { feature: "translate", hosts: ["huggingface.co"], sizeMb: 500, label: "M2M-100" };

afterEach(() => setRemoteConsentHandler(null));

describe("remote consent in Omnitext", () => {
  it("lets downloads through once they are allowed in Settings, without asking", async () => {
    settings.aiDownloads = "allow";
    const notify = vi.fn();
    installRemoteConsent(notify);
    expect(await requestRemote(req)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses when turned off, and says where to turn it back on", async () => {
    settings.aiDownloads = "deny";
    const notify = vi.fn();
    installRemoteConsent(notify);
    expect(await requestRemote(req)).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("writes sizes the way a person reads them", () => {
    expect(formatSize(10)).toBe("10 MB");
    expect(formatSize(1000)).toBe("1 GB");
    expect(formatSize(1500)).toBe("1.5 GB");
    expect(formatSize(undefined)).toBe("");
  });
});
