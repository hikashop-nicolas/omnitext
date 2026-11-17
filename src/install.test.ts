import { describe, expect, it } from "vitest";
import { manualRoute } from "./install";

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};

describe("manualRoute", () => {
  it("names the browser's own way to install when it gives the page no prompt", () => {
    expect(manualRoute(UA.safariMac, 0)).toBe("safariMac");
    expect(manualRoute(UA.iphone, 5)).toBe("safariIos");
    expect(manualRoute(UA.firefoxWin, 0)).toBe("firefox");
    expect(manualRoute(UA.chromeAndroid, 5)).toBe("android");
    expect(manualRoute(UA.chromeMac, 0)).toBe("menu");
    expect(manualRoute(UA.edgeWin, 0)).toBe("menu");
  });

  it("treats an iPad asking for the desktop site as iOS", () => {
    expect(manualRoute(UA.safariMac, 5)).toBe("safariIos");
  });
});
