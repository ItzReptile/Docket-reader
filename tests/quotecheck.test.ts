import { describe, expect, test } from "bun:test";
import { checkQuote } from "../src/quotecheck.ts";

const comment =
  "I strongly urge the FAA to require epinephrine auto-injectors on every flight.\n\n" +
  "Anaphylaxis is a rapidly progressing, life‑threatening emergency. My son’s reaction began 20 minutes after takeoff.";

function slice(c: string, quote: string) {
  const r = checkQuote(c, quote);
  return r.ok ? c.slice(r.start, r.end) : r.error;
}

describe("checkQuote", () => {
  test("exact quote passes and returns the original span", () => {
    expect(slice(comment, "require epinephrine auto-injectors on every flight")).toBe(
      "require epinephrine auto-injectors on every flight",
    );
  });

  test("case, whitespace, curly quotes and a trailing period are ignored", () => {
    expect(slice(comment, '"My son\'s reaction   began 20 minutes after takeoff."')).toBe(
      "My son’s reaction began 20 minutes after takeoff",
    );
    expect(slice(comment, "i strongly urge the faa")).toBe("I strongly urge the FAA");
  });

  test("a quote spanning a paragraph break still matches", () => {
    expect(checkQuote(comment, "on every flight. Anaphylaxis is a rapidly progressing").ok).toBe(true);
  });

  test("changed words fail", () => {
    expect(checkQuote(comment, "require epinephrine injectors on every flight").ok).toBe(false);
    expect(checkQuote(comment, "Anaphylaxis is a rapidly progressing life threatening emergency").ok).toBe(false);
  });

  test("an ellipsis splice fails with a clear reason", () => {
    const r = checkQuote(comment, "I strongly urge the FAA ... on every flight");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("...");
  });

  test("too-short quotes fail unless they are the whole comment", () => {
    expect(checkQuote(comment, "the FAA").ok).toBe(false);
    expect(checkQuote("I support this.", "I support this").ok).toBe(true);
  });

  test("overlong quotes fail", () => {
    const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
    expect(checkQuote(long, long).ok).toBe(false);
  });
});
