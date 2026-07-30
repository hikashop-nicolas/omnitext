import { describe, expect, it } from "vitest";
import { newRoomKey, parseRoomKey, roomLink, withoutRoom } from "./link";

const BASE = "https://example.org/omnitext/";

describe("collaboration link", () => {
  it("round-trips a generated key through a link", () => {
    const key = newRoomKey();
    expect(parseRoomKey(new URL(roomLink(key, BASE)).hash)).toEqual(key);
  });

  it("keeps both halves in the fragment, so the server never sees them", () => {
    const key = newRoomKey();
    const url = new URL(roomLink(key, BASE));
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/omnitext/");
    expect(url.hash).toContain(key.secret);
  });

  it("mints a different room and secret every time", () => {
    const keys = Array.from({ length: 50 }, newRoomKey);
    expect(new Set(keys.map((k) => k.roomId)).size).toBe(50);
    expect(new Set(keys.map((k) => k.secret)).size).toBe(50);
  });

  it("leaves other fragment parameters alone", () => {
    const key = { roomId: "room", secret: "sh" };
    const link = roomLink(key, `${BASE}#view=split`);
    expect(new URL(link).hash).toBe("#view=split&collab=room.sh");
    expect(parseRoomKey(new URL(link).hash)).toEqual(key);
  });

  it("replaces a room already in the fragment rather than appending one", () => {
    const link = roomLink({ roomId: "new", secret: "key" }, `${BASE}#collab=old.secret`);
    expect(new URL(link).hash).toBe("#collab=new.key");
  });

  it("strips the room back out again", () => {
    const cleaned = withoutRoom(`${BASE}#view=split&collab=room.sh`);
    expect(new URL(cleaned).hash).toBe("#view=split");
    expect(parseRoomKey(new URL(cleaned).hash)).toBeNull();
  });

  it.each([
    ["", "an empty fragment"],
    ["#", "a bare hash"],
    ["#view=split", "an unrelated parameter"],
    ["#collab=", "no value"],
    ["#collab=roomonly", "no secret"],
    ["#collab=room.secret.extra", "too many parts"],
    ["#collab=room.sec ret", "a space in the secret"],
    ["#collab=ro om.secret", "a space in the room"],
  ])("rejects %s (%s)", (hash) => {
    expect(parseRoomKey(hash)).toBeNull();
  });

  it("accepts a fragment with or without its leading hash", () => {
    expect(parseRoomKey("collab=room.sh")).toEqual({ roomId: "room", secret: "sh" });
    expect(parseRoomKey("#collab=room.sh")).toEqual({ roomId: "room", secret: "sh" });
  });

  it("gives a secret with enough entropy to be worth calling one", () => {
    // 16 random bytes, base64url: 22 characters and no padding.
    const { secret } = newRoomKey();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
