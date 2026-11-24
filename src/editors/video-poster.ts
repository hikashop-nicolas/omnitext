// A video's poster frame, drawn by the browser: the slide engine is built without video decoders and takes this
// picture instead. Null when the browser cannot play the clip; the video still goes in, without a poster.

const LONG_SIDE = 1920;
const TIMEOUT_MS = 8000;

function once(el: HTMLMediaElement, ok: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (e: Event) => {
      el.removeEventListener(ok, done);
      el.removeEventListener("error", done);
      if (e.type === "error") reject(new Error("the browser cannot play this video"));
      else resolve();
    };
    el.addEventListener(ok, done);
    el.addEventListener("error", done);
  });
}

/** A PNG of the frame at `atSeconds` (clamped into the clip), or null. */
export async function videoPosterPng(bytes: Uint8Array, mime: string, atSeconds = 0.1): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || "video/mp4" }));
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const work = (async () => {
    const meta = once(video, "loadeddata");
    video.src = url;
    await meta;
    const end = Number.isFinite(video.duration) ? video.duration : 0;
    const seeked = once(video, "seeked");
    video.currentTime = Math.min(atSeconds, Math.max(0, end - 0.01));
    await seeked;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const k = Math.min(1, LONG_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  })();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
