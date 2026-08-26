import { describe, expect, it } from "vitest";
import { parseEml } from "./emailviewer.impl";

// A .eml may repeat a header, and the header block may fold one value over several lines.
// The viewer shows From, To and Cc, so how the parser resolves those decides what the reader
// sees. postal-mime 3 changed both answers (first-wins, document order); these pin them down.

const eml = (lines: string[]): Uint8Array =>
  new TextEncoder().encode([...lines, "", "Body text.", ""].join("\r\n"));

describe("email header normalisation", () => {
  it("takes the first of a repeated single-value header", async () => {
    const email = await parseEml(eml([
      "From: First Sender <first@example.com>",
      "From: Second Sender <second@example.com>",
      "Subject: First subject",
      "Subject: Second subject",
      "Content-Type: text/plain; charset=utf-8",
    ]));
    expect(email.from).toBe("First Sender <first@example.com>");
    expect(email.subject).toBe("First subject");
  });

  it("keeps recipients in the order the message lists them", async () => {
    const email = await parseEml(eml([
      "From: Sender <sender@example.com>",
      "To: Alpha <alpha@example.com>, Beta <beta@example.com>",
      "To: Gamma <gamma@example.com>",
      "Cc: Delta <delta@example.com>, Epsilon <epsilon@example.com>",
      "Content-Type: text/plain; charset=utf-8",
    ]));
    expect(email.to).toEqual([
      "Alpha <alpha@example.com>",
      "Beta <beta@example.com>",
      "Gamma <gamma@example.com>",
    ]);
    expect(email.cc).toEqual([
      "Delta <delta@example.com>",
      "Epsilon <epsilon@example.com>",
    ]);
  });

  it("joins a subject folded across lines back into one", async () => {
    const email = await parseEml(eml([
      "From: Sender <sender@example.com>",
      "Subject: A subject that is folded",
      " across two lines",
      "Content-Type: text/plain; charset=utf-8",
    ]));
    expect(email.subject).toBe("A subject that is folded across two lines");
  });

  it("falls back to a placeholder when there is no subject", async () => {
    const email = await parseEml(eml([
      "From: Sender <sender@example.com>",
      "Content-Type: text/plain; charset=utf-8",
    ]));
    expect(email.subject).toBe("(no subject)");
    expect(email.to).toEqual([]);
    expect(email.text?.trim()).toBe("Body text.");
  });
});
