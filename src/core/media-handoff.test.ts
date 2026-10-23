import { afterEach, describe, expect, it } from "vitest";
import { activeQueue, handOverFiles, naturalCompare, relativePath, setActiveQueue, takeHandedOverFiles } from "./media-handoff";

afterEach(() => {
  handOverFiles(null);
  setActiveQueue(null);
});

describe("handing a selection to the media editor", () => {
  it("gives the files to whoever takes them first, and only once", () => {
    const files = [new File(["x"], "a.mp3"), new File(["x"], "b.mp3")];
    handOverFiles(files);
    expect(takeHandedOverFiles()).toEqual(files);
    expect(takeHandedOverFiles(), "the second taker gets nothing").toBeNull();
  });

  it("hands over nothing once the app has cleared it", () => {
    handOverFiles([new File(["x"], "a.mp3")]);
    handOverFiles(null);
    expect(takeHandedOverFiles()).toBeNull();
  });
});

describe("the queue that is playing", () => {
  const queue = (n: number) => ({ length: () => n, toM3u: () => "#EXTM3U\n", suggestedName: () => "x.m3u8" });

  it("is only a queue when it holds more than one entry", () => {
    setActiveQueue(queue(1));
    expect(activeQueue()).toBeNull();
    setActiveQueue(queue(3));
    expect(activeQueue()?.suggestedName()).toBe("x.m3u8");
  });

  it("is gone once cleared", () => {
    setActiveQueue(queue(3));
    setActiveQueue(null);
    expect(activeQueue()).toBeNull();
  });
});

describe("ordering picked files", () => {
  it("counts the way a person does", () => {
    expect(["ep10.mkv", "ep2.mkv", "Ep1.mkv"].sort(naturalCompare)).toEqual(["Ep1.mkv", "ep2.mkv", "ep10.mkv"]);
  });

  it("orders by where a file sat in a picked folder", () => {
    const a = new File(["x"], "01.mp3");
    Object.defineProperty(a, "webkitRelativePath", { value: "Album/CD2/01.mp3" });
    const b = new File(["x"], "09.mp3");
    Object.defineProperty(b, "webkitRelativePath", { value: "Album/CD1/09.mp3" });
    expect([a, b].sort((x, y) => naturalCompare(relativePath(x), relativePath(y)))).toEqual([b, a]);
    expect(relativePath(new File(["x"], "loose.mp3"))).toBe("loose.mp3");
  });
});
