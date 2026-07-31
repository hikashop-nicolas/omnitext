import { describe, expect, it } from "vitest";
import { turnServers } from "./turn";

// Reading a relay out of what someone typed into a settings box.
//
// The rule behind every case here: a half-configured relay must not look configured. It
// would fail at connection time, minutes later, with nothing pointing at the field that
// was wrong.

describe("a user-supplied relay", () => {
  it("is absent by default, which is not an error", () => {
    expect(turnServers(null)).toEqual({ servers: [], problem: "empty" });
    expect(turnServers({ url: "  ", username: "", credential: "" }).problem).toBe("empty");
  });

  it("takes a relay with its credentials", () => {
    const { servers, problem } = turnServers({
      url: "turn:relay.example.org:3478",
      username: "someone",
      credential: "a-secret",
    });
    expect(problem).toBeNull();
    expect(servers).toEqual([
      { urls: ["turn:relay.example.org:3478"], username: "someone", credential: "a-secret" },
    ]);
  });

  it("takes several, separated by commas or spaces", () => {
    const { servers } = turnServers({
      url: "turn:a.example.org:3478, turns:b.example.org:5349",
      username: "u",
      credential: "c",
    });
    expect(servers[0].urls).toEqual(["turn:a.example.org:3478", "turns:b.example.org:5349"]);
  });

  // The likely mistake, and the one worth refusing loudly: a stun: URL here would be
  // accepted by the browser, do nothing for the case this field exists for, and leave the
  // person believing they had configured a relay.
  it("refuses a URL that is not a relay", () => {
    expect(turnServers({ url: "stun:stun.example.org:3478", username: "u", credential: "c" })).toEqual({
      servers: [],
      problem: "scheme",
    });
    expect(turnServers({ url: "relay.example.org", username: "u", credential: "c" }).problem).toBe("scheme");
    expect(turnServers({ url: "turn:a.example.org, stun:b.example.org", username: "u", credential: "c" }).problem)
      .toBe("scheme");
  });

  it("refuses a relay missing half its credentials", () => {
    expect(turnServers({ url: "turn:a.example.org", username: "u", credential: "" }).problem).toBe(
      "credentials",
    );
    expect(turnServers({ url: "turn:a.example.org", username: "", credential: "c" }).problem).toBe(
      "credentials",
    );
  });

  it("accepts turns: as readily as turn:", () => {
    expect(turnServers({ url: "TURNS:a.example.org:5349", username: "u", credential: "c" }).problem).toBeNull();
  });
});
